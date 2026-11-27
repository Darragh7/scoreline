FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir Django==5.2.6

COPY . .

EXPOSE 8000

# --insecure: let runserver serve css/js from static/ even when DJANGO_DEBUG=false
# (the compose default); without it every page loads unstyled and without its scripts.
CMD ["sh", "-c", "python manage.py migrate --noinput && exec python manage.py runserver --insecure 0.0.0.0:8000"]
