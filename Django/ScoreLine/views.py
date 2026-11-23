from django.shortcuts import render
from django.http import HttpResponse

def landing(request):
    return render(request,"index.html")

def home(request):
    return render(request,"index.html")

def about(request):
    return render(request,"about.html")

def predictor(request):
    return render(request,"predictor.html")

def conatct(request):
    return render(request,"contact.html")