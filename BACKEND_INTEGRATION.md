# Backend integration: ScoreLine frontend ↔ API

> **Update (Nov 2026): the predictor page now reads `predictions.json` only.**
> It loads the agreed file format (`docs/prediction_format.md`) from `PREDICTIONS_ENDPOINT` when that is set in `js/api.js`, otherwise from `data/predictions.json`. A backend endpoint only needs to return that same JSON document (or just its `predictions` list), for example `GET /api/predictions/`.
> **"Pick two teams"** uses `ScoreLineAPI.getMatchupPrediction(competition, home, away)` in `js/api.js`. Today it only finds fixtures that are already in `predictions.json` (or the reversed fixture) and never estimates numbers. Predicting **any** two teams needs a new endpoint, for example `GET /predictions/matchup?competition=PL&home=Liverpool&away=Arsenal`, that runs the ensemble from `ai/training/predict.py` on request with the latest ratings/form and returns the same fields as a `predictions.json` entry (`home_win`, `draw`, `away_win`, `flags`, `model_version`). It isn't built yet; once it is, call it from the `'none'` branch of `getMatchupPrediction`.
> The demo data in `data/mock/` has been removed, and the frontend **no longer calls** `/api/leagues/`, `/api/teams/`, `/api/fixtures/`, `/api/predict/`, `/api/form/` or `/api/model-performance/`. The sections below describing those endpoints are kept for history only. The model performance numbers now live in `js/model-performance.js` (shown on `about.html#performance`). `/api/contact/` and `/api/csrf/` are still used by the contact form.

Status: **the frontend is not connected to a live backend yet.**

---

## 1. Could the frontend connect? No. Here's why

I audited the repo read-only and changed no backend code. There was no git history to inspect: this folder has no `.git` directory, so `git branch -a` / `git log` couldn't be run, and git isn't installed on this machine. The repo contains **two** Python backends, and neither serves what the predictor needs.

### `backend/` (FastAPI, the one `README`/`setup.ps1` start)

| Endpoint | What it does | Usable by predictor? |
|---|---|---|
| `GET /` and `GET /health` | Status JSON | Only as a health check |
| `GET /matches/?competition=PL&date_from=&date_to=&status=` | Proxies **football-data.org** live fixtures. Needs `FOOTBALL_API_KEY`. Returns `{ matches: [{ id, home_team, away_team, date, status, home_score, away_score }] }` | Not for historical predictions. Uses football-data.org competition codes (`PL`, `PD`, `FL1`) and team names (`"Arsenal FC"`), not the CSV codes (`E0`, `SP1`, `F1`) and names (`"Arsenal"`) |
| `GET /predictions/{match_id}` | **Hard-coded stub**: always `{ home_win: 0.45, draw: 0.30, away_win: 0.25 }` (`app/services/prediction_service.py`) | No model behind it |

Other gaps:
- **No CORS middleware**, so a browser on `localhost:5500` is blocked from calling it.
- No contact/feedback endpoint.
- `ai/training/train.py` and `preprocessing.py` are **empty**. No trained models or CSVs are in the repo (`*.csv`, `*.pkl`, `*.joblib` are git-ignored).

### `Django/` (project `Practice`, app folder `ScoreLine`): a skeleton that doesn't start

- `settings.py` → `INSTALLED_APPS` lists **`'webplay'`**, and `Practice/urls.py` includes `webplay.urls`, but no `webplay` package exists. The app folder is `ScoreLine/`, whose `AppConfig.name` is `'webplay'`. `manage.py runserver` fails with `ModuleNotFoundError: No module named 'webplay'`.
- `ScoreLine/views.py` renders `land2.html` and `landing.html`, which don't exist.
- The templates use `{% url 'predictor' %}`, `'about'` and `'contact'`, but only `'home'` is defined, and there is no predictor template. `contact.html` fills an `extra_scripts` block that `base.html` doesn't define.
- No API views, no CORS, no CSRF endpoint, no ML code.
- `Pipfile` pins Python 3.9, but `requirements.txt` pins Django 5.2.6 (needs Python ≥ 3.10), and the FastAPI code uses `X | None` syntax (Python ≥ 3.10).

**Root cause of "only index.html works":** the pages were Django templates. `.vscode/launch.json` opened `Templates/index.html` directly over `file://`, so `{% url %}` tags became literal broken links. `about.html` and `contact.html` (`{% extends %}`) can't render without Django, and `predictor.html` didn't exist. The frontend is now standalone static HTML in the project root, and the Django templates are untouched.

I also couldn't run either backend locally: **Python isn't installed** on this machine (only the Microsoft Store alias).

---

## 2. API contract the frontend expects

All calls go through `js/api.js`. Base URL = `API_BASE_URL` (default `http://localhost:8000`). JSON in, JSON out. Probabilities are decimals 0–1 that sum to ~1 (the frontend renormalises and rounds to 100%).

**League codes** are football-data.co.uk `Div` codes (`E0`, `SP1`, `F1`, …). **Team names** use the CSV spelling (`"Man United"`, `"Paris SG"`). **Model keys:**

| key | label |
|---|---|
| `logistic_regression` | Logistic Regression (frontend default: best on 2025/26 test) |
| `random_forest` | Random Forest |
| `xgboost` | XGBoost |
| `poisson` | Poisson |
| `elo` | Elo |
| `ensemble` | Ensemble (Elo + Poisson). Optional: the frontend computes the mean of `elo` + `poisson` if omitted |
| `lr_xgb_average` | LR + XGBoost (average). Optional: computed client-side if omitted |

Use `null` for a model that has no output for a fixture. The UI shows "No output for this fixture".

### `GET /api/leagues/`
```json
{ "leagues": [
    { "code": "E0",  "name": "Premier League", "country": "England" },
    { "code": "SP1", "name": "La Liga",        "country": "Spain" },
    { "code": "F1",  "name": "Ligue 1",        "country": "France" }
] }
```
The UI is data-driven: add `D1`/`I1` here and they appear.

### `GET /api/teams/?league=E0`
```json
{ "league": "E0", "teams": ["Arsenal", "Aston Villa", "Bournemouth", "..."] }
```

### `GET /api/fixtures/?season=2024/25&league=E0&date=2024-08-16`
All params optional. `seasons` lists every season that has predictions (newest first).
```json
{
  "seasons": ["2025/26", "2024/25"],
  "fixtures": [
    { "id": "E0-20240816-man-united-fulham", "league": "E0", "date": "2024-08-16",
      "season": "2024/25", "home_team": "Man United", "away_team": "Fulham" }
  ]
}
```

### `POST /api/predict/`
Request (`fixture_id` is sent when the user clicked a fixture from the list):
```json
{ "home_team": "Man United", "away_team": "Fulham", "league": "E0",
  "model": "logistic_regression", "fixture_id": "E0-20240816-man-united-fulham" }
```
Response: **return every model**, not only the requested one, because the page shows a comparison table:
```json
{
  "home_team": "Man United", "away_team": "Fulham", "league": "E0",
  "fixture": { "id": "E0-20240816-man-united-fulham", "date": "2024-08-16", "season": "2024/25" },
  "source": "model_output",
  "expected_goals": { "home": 1.64, "away": 1.19 },
  "models": {
    "logistic_regression": { "home": 0.5261, "draw": 0.2278, "away": 0.2461 },
    "random_forest":       { "home": 0.5317, "draw": 0.2536, "away": 0.2146 },
    "xgboost":             { "home": 0.51,   "draw": 0.25,   "away": 0.24 },
    "poisson":             { "home": 0.4787, "draw": 0.2442, "away": 0.2771 },
    "elo":                 { "home": 0.50,   "draw": 0.26,   "away": 0.24 }
  }
}
```
- `fixture`: `null` for a free-choice match-up that isn't a scheduled or historical fixture (the model then predicts from the teams' latest pre-match features).
- `source`: `"model_output"` (from the predictions CSV or a live model run). `"demo_estimate"` is used only by mock mode.
- `expected_goals`: the Poisson model's `exp_home_goals` / `exp_away_goals`. The browser computes the 0–5 scoreline grid from these.
- Errors: unknown team, same team twice, etc. → **HTTP 400/422** with `{ "detail": "message" }`. The UI shows the message. 404/5xx in auto mode trigger the demo-data fallback.

### `GET /api/form/?league=E0&home_team=Man%20United&away_team=Fulham&n=5&before=2024-08-16`
Last `n` results per team before `before` (fixture date, optional), plus recent head-to-head. Source: `matches.csv`.
```json
{
  "home": { "team": "Man United", "matches": [
    { "date": "2024-05-25", "opponent": "Brighton", "venue": "A",
      "goals_for": 2, "goals_against": 0, "result": "W" }
  ] },
  "away": { "team": "Fulham", "matches": [ "..." ] },
  "head_to_head": [
    { "date": "2024-02-24", "home_team": "Man United", "away_team": "Fulham", "home_goals": 1, "away_goals": 2 }
  ]
}
```
Matches are ordered most recent first. `venue` is `H`/`A` and `result` is `W`/`D`/`L` from that team's perspective.

### `GET /api/model-performance/`
Same shape as [`data/mock/model_performance.json`](data/mock/model_performance.json): `{ default_model, validation: { label, season, n_matches, rows: [...] }, test: {...} }`. Each row is `{ model, key, kind: "model"|"benchmark"|"baseline", log_loss, brier, rps, accuracy }`, with `null` for missing metrics.

### `POST /api/contact/`
```json
{ "full_name": "Alex Morgan", "email": "alex@example.com", "phone": null,
  "subject": "bug_report", "message": "The fixture list …", "rating": 4,
  "page": "/contact.html", "submitted_at": "2026-11-21T15:00:00.000Z" }
```
`subject` ∈ `general | prediction_accuracy | bug_report | feature_request | other`. `rating` is 1–5 or `null`. Return `201 { "ok": true, "id": 123 }`. For validation errors, return `400 { "detail": "…", "errors": { "email": ["Enter a valid email."] } }`. The form maps `errors` onto its fields. The honeypot field (`website`) is never sent: the browser drops spam submissions before calling the API. Re-check server-side anyway.

### `GET /api/csrf/` (Django only, recommended)
Sets the `csrftoken` cookie and returns `{ "csrfToken": "…" }`. Before every POST, `api.js` reads the `csrftoken` cookie, or calls this endpoint if the cookie is missing, and sends it as the **`X-CSRFToken`** header. Requests use `credentials: "include"`.

---

## 3. What the Django side needs

### 3.1 Fix the project skeleton
- Rename the app reference: in `settings.py` `INSTALLED_APPS`, replace `'webplay'` with `'ScoreLine'`. Set `ScoreLine/apps.py` → `name = 'ScoreLine'`, and in `Practice/urls.py` → `include('ScoreLine.urls')`. Alternatively, rename the folder to `webplay`.
- Align the Python version (≥ 3.10) across `Pipfile`, `requirements.txt` and the `Dockerfile`.

### 3.2 CORS + CSRF (frontend on :5500, Django on :8000)
```bash
pip install django-cors-headers
```
```python
# settings.py
INSTALLED_APPS += ["corsheaders"]
MIDDLEWARE.insert(0, "corsheaders.middleware.CorsMiddleware")   # must sit above CommonMiddleware

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", ["http://localhost:5500", "http://127.0.0.1:5500"])
CORS_ALLOW_CREDENTIALS = True                       # lets the csrftoken cookie travel
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS
CSRF_COOKIE_SAMESITE = "Lax"                        # fine for localhost (same site, different port)
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", ["localhost", "127.0.0.1"])
```
If Django serves the frontend itself (same origin), set `API_BASE_URL: ''` in `js/api.js` and CORS isn't needed.

### 3.3 Serving the model predictions
Simplest reliable approach: load the CSVs once at startup and answer from memory.

```python
# ScoreLine/predictions.py  (sketch)
import pandas as pd
from functools import lru_cache
from django.conf import settings

MODELS = ["logistic_regression", "random_forest", "xgboost"]

@lru_cache
def tables():
    mp = pd.read_csv(settings.DATA_DIR / "model_predictions.csv", parse_dates=["Date"])
    po = pd.read_csv(settings.DATA_DIR / "poisson_predictions.csv", parse_dates=["Date"])
    df = mp.merge(po, on=["Div", "Date", "Season", "HomeTeam", "AwayTeam"], how="outer")
    matches = pd.read_csv(settings.DATA_DIR / "matches.csv", parse_dates=["Date"])
    return df, matches

def probs(row, prefix):
    cols = [f"{prefix}_p_home", f"{prefix}_p_draw", f"{prefix}_p_away"]
    if any(c not in row or pd.isna(row[c]) for c in cols):
        return None
    return {"home": float(row[cols[0]]), "draw": float(row[cols[1]]), "away": float(row[cols[2]])}

def prediction_for(row):
    out = {m: probs(row, m) for m in MODELS}
    out["poisson"] = probs(row, "poisson")
    out["elo"] = probs(row, "elo")   # add elo_p_* columns to the export
    return out
```
```python
# ScoreLine/views.py  (sketch)
import json
from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST
from django.views.decorators.csrf import ensure_csrf_cookie
from django.middleware.csrf import get_token

@require_GET
@ensure_csrf_cookie
def csrf(request):
    return JsonResponse({"csrfToken": get_token(request)})

@require_POST
def predict(request):
    body = json.loads(request.body or "{}")
    home, away, league = body.get("home_team"), body.get("away_team"), body.get("league")
    if not home or not away or home == away:
        return JsonResponse({"detail": "Choose two different teams."}, status=400)
    df, _ = tables()
    rows = df[(df.Div == league) & (df.HomeTeam == home) & (df.AwayTeam == away)].sort_values("Date")
    if rows.empty:
        # free match-up: run the trained models on the teams' latest pre-match features here
        return JsonResponse({"detail": "No prediction available for this match-up yet."}, status=422)
    r = rows.iloc[-1]
    return JsonResponse({
        "home_team": home, "away_team": away, "league": league,
        "fixture": {"id": f"{league}-{r.Date:%Y%m%d}-{slug(home)}-{slug(away)}",
                    "date": f"{r.Date:%Y-%m-%d}", "season": r.Season},
        "source": "model_output",
        "expected_goals": {"home": float(r.exp_home_goals), "away": float(r.exp_away_goals)}
                          if not pd.isna(r.get("exp_home_goals")) else None,
        "models": prediction_for(r),
    })
```
```python
# ScoreLine/urls.py
urlpatterns = [
    path("api/csrf/", views.csrf),
    path("api/leagues/", views.leagues),
    path("api/teams/", views.teams),
    path("api/fixtures/", views.fixtures),
    path("api/predict/", views.predict),
    path("api/form/", views.form),
    path("api/model-performance/", views.model_performance),
    path("api/contact/", views.contact),   # save to a Feedback model and/or send an email
]
```
- `leagues`/`teams`: distinct `Div` / `HomeTeam` values from the predictions table, filtered to the latest season.
- `form`: filter `matches.csv` by team and `Date < before`, take the last `n`, and compute W/D/L from `FTHG`/`FTAG`.
- `model-performance`: return the evaluation tables, exported once to JSON by the training pipeline.
- `contact`: validate with a Django `Form`, store it in a `Feedback` model (name, email, phone, subject, message, rating, created_at), and rate-limit by IP.

### 3.4 Environment / URL config
| Setting | Example | Where |
|---|---|---|
| `DATA_DIR` | `BASE_DIR / "data"` (CSV exports) | `settings.py` / env |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5500` (dev), `https://scoreline.example` (prod) | env |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | env |
| `SECRET_KEY`, `DEBUG` | from env. The current key is hard-coded in `settings.py` | env |
| Frontend `API_BASE_URL` | `http://localhost:8000` (dev) or `''` (same origin) | `js/api.js` |

### 3.5 If the team keeps FastAPI instead
Implement the same paths and add:
```python
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5500"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
```
FastAPI has no CSRF layer, so `/api/csrf/` isn't needed. `api.js` tolerates it being absent.

---

## 4. Switching between mock mode and the live API

In `js/api.js`:
```js
API_BASE_URL: 'http://localhost:8000',
MODE: 'auto',   // 'auto' = live, else demo data | 'live' = live only | 'mock' = demo only
```
Per-visit overrides: `?mode=mock`, `?mode=live`, `?api=http://127.0.0.1:8000`.

The badge in the predictor header shows the current source: green **Live API** or amber **Demo data** (hover it for the reason). After one failed live call in `auto` mode, the page stays on demo data for that page view so live and demo data never mix. Reload to retry.

**Quick test once the backend is up:** start Django on :8000, open `http://localhost:5500/predictor.html?mode=live`, and check the badge turns green. Any failing endpoint then shows its error message in the UI instead of silently falling back.

---

## 5. Data mismatches to confirm with the ML side
1. **League count.** Both evaluation seasons have **1,752** matches. That equals five leagues (PL 380 + La Liga 380 + Serie A 380 + Ligue 1 306 + Bundesliga 306), not the three in the samples (1,066). The **10,781** training matches likewise match five leagues over 2018/19–2023/24, including the shortened 2019/20 Ligue 1 season. So the models were probably trained and evaluated on `D1`/`I1` too. The frontend only lists E0/SP1/F1 in demo mode, but will show whatever `/api/leagues/` returns.
2. **Training span.** That arithmetic implies **six** training seasons (2018/19–2023/24), not "three seasons" as the old About text said.
3. **XGBoost and Elo** probabilities weren't in the sample rows, so in demo mode those models (and the ensemble) show "No output" for sample fixtures. Please include `xgboost_p_*` and `elo_p_*` columns in the export.
4. **"Player Elo".** The old site text claimed "overall player Elo ratings", but the data (football-data.co.uk) only has team-level results, and the Elo model rates teams. The site now says "Elo team-strength ratings".
5. **Team naming.** The FastAPI `/matches/` endpoint uses football-data.org names and codes (`"Manchester United FC"`, `PL`). Joining live fixtures to model predictions needs a name/code mapping table.
