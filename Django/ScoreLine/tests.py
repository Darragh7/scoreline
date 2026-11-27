import json
from io import BytesIO
from urllib.error import HTTPError, URLError
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from ScoreLine.views import (
    AuthenticationBackendUnavailable,
    _call_auth_backend,
    _decode_backend_response,
    _store_account_session,
)


class AuthenticationBackendHelperTests(SimpleTestCase):

    def test_decode_backend_response_accepts_json_objects(self):
        self.assertEqual(_decode_backend_response(b'{"detail":"invalid"}'), {"detail": "invalid"})

    def test_decode_backend_response_returns_empty_object_for_invalid_json(self):
        self.assertEqual(_decode_backend_response(b"not json"), {})
        self.assertEqual(_decode_backend_response(b"[]"), {})

    @patch("ScoreLine.views.urlopen")
    @override_settings(BACKEND_API_URL="https://backend.test")
    def test_call_auth_backend_sends_json_post_and_decodes_response(self, urlopen):
        response = urlopen.return_value.__enter__.return_value
        response.status = 201
        response.read.return_value = b'{"user":{"user_id":123}}'
        payload = {"email": "ada@example.com", "password": "secret"}

        result = _call_auth_backend("signup", payload)

        self.assertEqual(result, (201, {"user": {"user_id": 123}}))
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://backend.test/users/signup")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(json.loads(request.data), payload)
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 5)

    @patch("ScoreLine.views.urlopen")
    def test_call_auth_backend_decodes_http_error_response(self, urlopen):
        urlopen.side_effect = HTTPError(
            "http://localhost:8002/users/login",
            401,
            "Unauthorized",
            hdrs=None,
            fp=BytesIO(b'{"detail":"Invalid credentials"}'),
        )

        result = _call_auth_backend("login", {"identifier": "ada@example.com"})

        self.assertEqual(result, (401, {"detail": "Invalid credentials"}))

    @patch("ScoreLine.views.urlopen", side_effect=URLError("connection refused"))
    def test_call_auth_backend_wraps_network_errors(self, _urlopen):
        with self.assertRaises(AuthenticationBackendUnavailable):
            _call_auth_backend("login", {})

    def test_store_account_session_rejects_incomplete_backend_response(self):
        request = type("Request", (), {"session": {}})()

        with self.assertRaises(AuthenticationBackendUnavailable):
            _store_account_session(request, {"user": {"user_id": "123"}})


class AuthenticationViewTests(TestCase):

    @patch("ScoreLine.views._call_auth_backend")
    def test_signup_creates_session_after_backend_success(self, call_backend):
        call_backend.return_value = (
            201,
            {"user": {"user_id": 123, "first_name": "Ada"}},
        )

        response = self.client.post(
            reverse("signup"),
            {
                "first_name": "Ada",
                "last_name": "Lovelace",
                "email": "ada@example.com",
                "password": "correct horse battery staple",
            },
        )

        self.assertRedirects(response, reverse("landing"))
        self.assertEqual(self.client.session["user_id"], 123)
        call_backend.assert_called_once_with(
            "signup",
            {
                "first_name": "Ada",
                "last_name": "Lovelace",
                "email": "ada@example.com",
                "phone": "",
                "password": "correct horse battery staple",
            },
        )

    @patch("ScoreLine.views._call_auth_backend")
    def test_login_rejects_invalid_credentials_without_creating_session(
        self, call_backend
    ):
        call_backend.return_value = (
            401,
            {"detail": "Invalid email, phone, or password"},
        )

        response = self.client.post(
            reverse("login"),
            {"identifier": "ada@example.com", "password": "wrong password"},
        )

        self.assertRedirects(response, reverse("landing"))
        self.assertNotIn("user_id", self.client.session)

    @patch("ScoreLine.views._call_auth_backend")
    def test_login_creates_session_after_backend_success(self, call_backend):
        call_backend.return_value = (
            200,
            {"user": {"user_id": 321, "first_name": "Ada"}},
        )

        response = self.client.post(
            reverse("login"),
            {"identifier": "ada@example.com", "password": "correct password"},
        )

        self.assertRedirects(response, reverse("landing"))
        self.assertEqual(self.client.session["user_id"], 321)

    def test_logout_clears_the_account_session(self):
        session = self.client.session
        session["user_id"] = 321
        session["first_name"] = "Ada"
        session.save()

        response = self.client.post(reverse("logout"))

        self.assertRedirects(response, reverse("landing"))
        self.assertNotIn("user_id", self.client.session)

    def test_landing_page_forms_include_csrf_tokens(self):
        response = self.client.get(reverse("landing"))

        self.assertContains(response, 'action="/login/"')
        self.assertContains(response, 'action="/signup/"')
        self.assertContains(response, 'name="csrfmiddlewaretoken"')


class AccountJsonReplyTests(TestCase):
    """The navbar pop-ups (static/js/layout.js) call the same views and expect JSON."""

    @patch("ScoreLine.views._call_auth_backend")
    def test_login_returns_json_for_popup(self, call_backend):
        call_backend.return_value = (200, {"user": {"user_id": 7, "first_name": "Ada"}})

        response = self.client.post(
            reverse("login"),
            {"identifier": "ada@example.com", "password": "correct password"},
            HTTP_ACCEPT="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"], {"first_name": "Ada"})
        session = self.client.get(reverse("session_api")).json()
        self.assertEqual(session, {"signed_in": True, "first_name": "Ada"})

    @patch("ScoreLine.views._call_auth_backend", side_effect=AuthenticationBackendUnavailable)
    def test_signup_reports_unavailable_backend_as_json(self, _call_backend):
        response = self.client.post(reverse("signup"), {}, HTTP_ACCEPT="application/json")

        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.json()["ok"])

    def test_session_api_when_signed_out(self):
        self.assertEqual(self.client.get(reverse("session_api")).json(), {"signed_in": False, "first_name": None})

    def test_pages_set_csrf_cookie(self):
        response = self.client.get(reverse("home"))
        self.assertIn("csrftoken", response.cookies)


class ContactApiTests(TestCase):

    def valid_payload(self, **overrides):
        payload = {
            "full_name": "Ada Lovelace",
            "email": "ada@example.com",
            "phone": None,
            "subject": "bug_report",
            "message": "The predictor page shows the wrong kickoff time.",
            "rating": 4,
            "page": "/contact.html",
        }
        payload.update(overrides)
        return payload

    def post(self, payload):
        return self.client.post(reverse("contact_api"), json.dumps(payload), content_type="application/json")

    def test_valid_message_is_saved(self):
        from ScoreLine.models import ContactMessage

        response = self.post(self.valid_payload())

        self.assertEqual(response.status_code, 201)
        saved = ContactMessage.objects.get(pk=response.json()["id"])
        self.assertEqual(saved.email, "ada@example.com")
        self.assertEqual(saved.rating, 4)

    def test_invalid_fields_are_reported_per_field(self):
        response = self.post(self.valid_payload(email="nope", message="short", subject="spam"))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.json()["errors"]), {"email", "message", "subject"})

    def test_rejects_non_object_body(self):
        response = self.client.post(reverse("contact_api"), "[]", content_type="application/json")
        self.assertEqual(response.status_code, 400)
