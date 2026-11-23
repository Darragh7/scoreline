from django.urls import path
from . import views

#URLconfig
urlpatterns=[
    path('', views.landing),
    path('home', views.home, name='home'),
    path('predictor', views.predictor, name='predictor'),
    path('about', views.about, name='about'),
    path('contact', views.conatct, name='contact')
]
