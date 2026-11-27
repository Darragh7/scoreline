# ScoreLine

Pre-match football predictions (home win / draw / away win), with an HTML/CSS/JS frontend served by Django, a FastAPI backend (accounts, matches) on Supabase PostgreSQL, and a Python machine-learning engine.

The site is served by **Django**. The pages are templates in `Django/ScoreLine/Templates/`, and their CSS/JS is in `Django/ScoreLine/static/`:

| Page | Template | URL |
|---|---|---|
| Home | `index.html` | `/` |
| Match predictor | `predictor.html` (+ `static/js/predictor.js`) | `/predictor.html` |
| About us & methodology | `about.html` (+ `static/js/model-performance.js`) | `/about.html` |
| Contact / feedback | `contact.html` (+ `static/js/contact.js`) | `/contact.html` |
| Account landing page | `land2.html` | `/landing/` |

Shared code in `Django/ScoreLine/static/js/`: `layout.js` (navbar, footer, mobile menu, login/sign-up pop-ups), `api.js` (**all** data loading), `competitions.js` (competition codes → names/colours), `probability.js` (rounding to 100%, confidence labels), `tailwind-config.js`, plus `static/css/styles.css`. `Templates/predictor.old.html` (an earlier predictor that used made-up team ratings) and the `base.html` it extends are kept for reference only; no view renders them. Backend integration notes: [BACKEND_INTEGRATION.md](BACKEND_INTEGRATION.md).

> The root `css/` and `js/` folders are older copies of `Django/ScoreLine/static/` and no page uses them any more. Edit the files in `Django/ScoreLine/static/`.

Django endpoints used by the pages:

| URL | What it does |
|---|---|
| `GET /api/predictions/` | Returns `data/predictions.json` (or the file in `PREDICTIONS_FILE`) |
| `POST /api/contact/` | Saves a contact-form message (Django database; view them at `/admin/`) |
| `GET /api/session/` | `{ signed_in, first_name }` for the navbar |
| `POST /login/`, `/signup/`, `/logout/` | Accounts, passed on to the FastAPI `/users` API (`BACKEND_API_URL`, default `http://localhost:8002`) |

---

## First-time setup

1. Create your local environment file in the project root and fill it in:

   ```powershell
   Copy-Item .env.example .env
   ```

   Set `SECRET_KEY` and `DJANGO_SECRET_KEY` to unique strong secrets (generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"`), and `DATABASE_URL` to your Supabase PostgreSQL connection string (needed for login/sign-up). For local development set `DJANGO_DEBUG=true`. Both Django and FastAPI read this `.env` automatically. Keep it private; it is git-ignored.

2. Add the predictions file. The predictor page shows only what is in `predictions.json`, the file written by the ML pipeline (format: `docs/prediction_format.md`). Copy the latest file to **`data/predictions.json`** in the project root. It is git-ignored and must never be committed. Django serves it at `/api/predictions/` (to use a file somewhere else, set `PREDICTIONS_FILE`). Fixtures whose kickoff has passed are shown as played, so refresh the file regularly.

---

## Running locally

### Option A: Docker (website + API)

Install and start Docker Desktop, then from the project root:

```powershell
docker compose up --build
```

- Django website: <http://localhost:8000/>
- FastAPI documentation: <http://localhost:8002/docs>
- FastAPI/database readiness: <http://localhost:8002/ready>

`data/` is mounted into the website container, so `data/predictions.json` is picked up without rebuilding. The website starts even if the database isn't reachable; only login/sign-up need it. Stop with **Ctrl+C**, or use `docker compose up --build -d` / `docker compose down`.

### Option B: Python, no Docker

```powershell
cd Django
pip install pipenv      # once
pipenv install          # installs Django from the Pipfile
pipenv run python manage.py migrate
pipenv run python manage.py runserver 8000
```

Then open **http://localhost:8000/**. Or press **F5** in VS Code: *ScoreLine: Chrome* / *ScoreLine: Edge* start the `Run Django (port 8000)` task and open the site.

For login/sign-up, also run the FastAPI backend on port 8002 (after `setup.ps1` has created `.venv`):

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --app-dir backend --port 8002
```

Docs are then at http://127.0.0.1:8002/docs. Without it the site still works, and the login pop-ups say sign-in is unavailable.

### Option C: Quick preview without Python

```powershell
powershell -ExecutionPolicy Bypass -File .\preview.ps1
```

Then open **http://localhost:8000/** (or press F5 and pick *ScoreLine: preview without Python*). It builds a copy of the Django pages in `.preview/` with the template tags filled in and serves it with `serve.ps1`. Re-run it after editing templates or static files. It's a stand-in for Django, not the real thing: the predictor works, but login and the contact form need the real Django server.

Entries in `predictions.json` with missing or invalid fields are skipped (the page says how many), unknown fields are ignored, and a non-empty `flags` list shows a **Limited data** note.

NOTE: If you run into issues with permissions, try:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

---

## Project docs

- [Kubernetes deployment guide](docs/development-deployment.md)
- [Development process](docs/DEV_PROCESS.pdf)
- [Security documentation](docs/security/)
- [Licensing review and prediction disclaimer](docs/security/licensing-and-disclaimers.md)

---

*ScoreLine predictions are for analytical insight, not betting advice.*
