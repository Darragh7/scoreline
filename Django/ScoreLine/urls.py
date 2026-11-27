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
    path('api/contact/', views.contact_api, name='contact_api'),
    path('api/session/', views.session_api, name='session_api'),

    # Accounts (login/signup logic from main). Mark's landing page with the working forms.
    path('landing/', views.landing, name='landing'),
    path('signup/', views.signup, name='signup'),
    path('login/', views.login, name='login'),
    path('logout/', views.logout, name='logout'),

    # Short aliases (also reachable under /ScoreLine/, see Practice/urls.py)
    path('home', views.index),
    path('predictor', views.predictor),
    path('about', views.about),
    path('contact', views.contact),
]
