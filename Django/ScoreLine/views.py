import json

from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET


def index(request):
    return render(request, 'index.html')


def predictor(request):
    return render(request, 'predictor.html')


def about(request):
    return render(request, 'about.html')


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
