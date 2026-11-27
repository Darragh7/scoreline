import json
import logging
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from django.contrib import messages
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .models import ContactMessage


logger = logging.getLogger(__name__)


# ensure_csrf_cookie: the pages' JavaScript (login/sign-up pop-ups, contact form) sends the
# csrftoken cookie back in the X-CSRFToken header, so every page makes sure it is set.
@ensure_csrf_cookie
def index(request):
    return render(request, 'index.html')


@ensure_csrf_cookie
def predictor(request):
    return render(request, 'predictor.html')


@ensure_csrf_cookie
def about(request):
    return render(request, 'about.html')


@ensure_csrf_cookie
def contact(request):
    return render(request, 'contact.html')


@require_GET
def predictions_api(request):
    """Return predictions.json as-is (format: docs/prediction_format.md).

    The file is never committed; its path comes from settings.PREDICTIONS_FILE
    (environment variable PREDICTIONS_FILE, default: <repo>/data/predictions.json).
    """
    path = settings.PREDICTIONS_FILE
    try:
        with open(path, 'rb') as fh:
            raw = fh.read()
        json.loads(raw)  # refuse to serve a broken file
    except FileNotFoundError:
        return JsonResponse({'detail': 'No predictions file found. Set PREDICTIONS_FILE or copy predictions.json to data/.'}, status=404)
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'detail': 'The predictions file is not valid JSON.'}, status=500)
    response = HttpResponse(raw, content_type='application/json')
    response['Cache-Control'] = 'no-cache'
    return response


# ---- Contact form ----

CONTACT_SUBJECTS = {value for value, _label in ContactMessage.SUBJECT_CHOICES}
CONTACT_MESSAGE_MIN, CONTACT_MESSAGE_MAX = 10, 1000


def _clean_contact(data):
    """Validate the contact form payload (same rules as static/js/contact.js)."""
    errors = {}

    def text(key):
        value = data.get(key)
        return value.strip() if isinstance(value, str) else ''

    full_name = text('full_name')
    if len(full_name) < 2:
        errors['full_name'] = ['Enter your full name.']
    elif len(full_name) > 100:
        errors['full_name'] = ['Your name is too long (maximum 100 characters).']

    email = text('email')
    try:
        validate_email(email)
        if len(email) > 100:
            raise ValidationError('too long')
    except ValidationError:
        errors['email'] = ['Enter an email address like name@example.com.']

    phone = text('phone')
    if phone:
        digits = re.sub(r'\D', '', phone)
        if not re.fullmatch(r'[+\d][\d\s().-]*', phone) or not 7 <= len(digits) <= 15 or len(phone) > 20:
            errors['phone'] = ['Enter a valid phone number (7–15 digits), or leave it blank.']

    subject = text('subject')
    if subject not in CONTACT_SUBJECTS:
        errors['subject'] = ['Choose what your feedback is about.']

    message = text('message')
    if not CONTACT_MESSAGE_MIN <= len(message) <= CONTACT_MESSAGE_MAX:
        errors['message'] = [f'Your message needs {CONTACT_MESSAGE_MIN}–{CONTACT_MESSAGE_MAX} characters.']

    rating = data.get('rating')
    if rating in (None, '', 0):
        rating = None
    elif not isinstance(rating, int) or isinstance(rating, bool) or not 1 <= rating <= 5:
        errors['rating'] = ['Rating must be between 1 and 5.']

    page = text('page')[:200]

    cleaned = {
        'full_name': full_name, 'email': email, 'phone': phone, 'subject': subject,
        'message': message, 'rating': rating, 'page': page,
    }
    return cleaned, errors


@require_POST
def contact_api(request):
    """POST /api/contact/ { full_name, email, phone, subject, message, rating } -> { ok: true, id }."""
    try:
        data = json.loads(request.body or b'{}')
    except (ValueError, UnicodeDecodeError):
        data = None
    if not isinstance(data, dict):
        return JsonResponse({'detail': 'Send the form as a JSON object.'}, status=400)

    cleaned, errors = _clean_contact(data)
    if errors:
        return JsonResponse({'detail': 'Please fix the highlighted fields.', 'errors': errors}, status=400)

    saved = ContactMessage.objects.create(**cleaned)
    return JsonResponse({'ok': True, 'id': saved.pk}, status=201)


# ---- Accounts: login / signup / logout (from main, Mark) ----



class AuthenticationBackendUnavailable(Exception):
    pass


def _decode_backend_response(body):
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _call_auth_backend(endpoint, payload):
    request = Request(
        f"{settings.BACKEND_API_URL}/users/{endpoint}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, _decode_backend_response(response.read())
    except HTTPError as error:
        return error.code, _decode_backend_response(error.read())
    except (URLError, TimeoutError, OSError) as error:
        logger.error("Authentication backend request failed")
        raise AuthenticationBackendUnavailable from error


def _store_account_session(request, response_data):
    if not isinstance(response_data, dict):
        raise AuthenticationBackendUnavailable("Invalid authentication response")
    account = response_data.get("user")
    if (
        not isinstance(account, dict)
        or not isinstance(account.get("user_id"), int)
        or not isinstance(account.get("first_name"), str)
    ):
        raise AuthenticationBackendUnavailable("Invalid authentication response")

    request.session.cycle_key()
    request.session["user_id"] = account["user_id"]
    request.session["first_name"] = account["first_name"]


def _wants_json(request):
    """True for the fetch() calls made by the site's login/sign-up pop-ups (static/js/layout.js)."""
    return "application/json" in request.headers.get("Accept", "")


def _account_reply(request, ok, message, status):
    """JSON for the pop-ups; otherwise a flash message and a redirect to the landing page."""
    if _wants_json(request):
        body = {"ok": ok, "message": message}
        if ok:
            body["user"] = {"first_name": request.session.get("first_name", "")}
        return JsonResponse(body, status=status)
    (messages.success if ok else messages.error)(request, message)
    return redirect("landing")


@require_GET
def session_api(request):
    """GET /api/session/ -> { signed_in, first_name } (used by the navbar)."""
    first_name = request.session.get("first_name")
    signed_in = "user_id" in request.session
    return JsonResponse({"signed_in": signed_in, "first_name": first_name if signed_in else None})


def landing(request):
    return render(request, "land2.html")


@require_POST
def signup(request):
    payload = {
        "first_name": request.POST.get("first_name", ""),
        "last_name": request.POST.get("last_name", ""),
        "email": request.POST.get("email", ""),
        "phone": request.POST.get("phone", ""),
        "password": request.POST.get("password", ""),
    }
    try:
        status_code, response_data = _call_auth_backend("signup", payload)
        if status_code == 201:
            _store_account_session(request, response_data)
            return _account_reply(request, True, "Your account has been created.", 201)
        if status_code == 409:
            return _account_reply(request, False, "An account with that email or phone already exists.", 409)
        if status_code == 422:
            return _account_reply(
                request,
                False,
                "Check your first and last name, enter a valid email or supported "
                "phone number, and use a password of 8–128 characters. Phone "
                "formats: +353 8XXXXXXXX or +91 XXXXXXXXXX.",
                422,
            )
        return _account_reply(request, False, "We could not create your account. Please try again.", 502)
    except AuthenticationBackendUnavailable:
        return _account_reply(request, False, "Sign up is temporarily unavailable. Please try again.", 503)


@require_POST
def login(request):
    payload = {
        "identifier": request.POST.get("identifier", ""),
        "password": request.POST.get("password", ""),
    }
    try:
        status_code, response_data = _call_auth_backend("login", payload)
        if status_code == 200:
            _store_account_session(request, response_data)
            return _account_reply(request, True, "You are signed in.", 200)
        if status_code == 401:
            return _account_reply(request, False, "Invalid email, phone, or password.", 401)
        if status_code == 422:
            return _account_reply(request, False, "Enter your email or phone and password.", 422)
        return _account_reply(request, False, "We could not sign you in. Please try again.", 502)
    except AuthenticationBackendUnavailable:
        return _account_reply(request, False, "Sign in is temporarily unavailable. Please try again.", 503)


@require_POST
def logout(request):
    request.session.flush()
    return _account_reply(request, True, "You are signed out.", 200)
