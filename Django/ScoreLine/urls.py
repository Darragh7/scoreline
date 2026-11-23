from django.urls import path
from . import views

# URL paths match the page filenames so the links inside the pages
# (and the navbar built by js/layout.js) work unchanged.
urlpatterns = [
    path('', views.index, name='home'),
    path('index.html', views.index, name='index'),
    path('predictor.html', views.predictor, name='predictor'),
    path('about.html', views.about, name='about'),
    path('contact.html', views.contact, name='contact'),
    path('api/predictions/', views.predictions_api, name='predictions_api'),

    # Short aliases (also reachable under /ScoreLine/, see Practice/urls.py)
    path('home', views.index),
    path('predictor', views.predictor),
    path('about', views.about),
    path('contact', views.contact),
]
