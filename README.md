# ScoreLine

Pre-match football predictions (home win / draw / away win), with a plain HTML/CSS/JS frontend and a Python backend + machine-learning engine.

| Page | File |
|---|---|
| Home | `index.html` |
| Match predictor | `predictor.html` (+ `js/predictor.js`) |
| About us & methodology | `about.html` |
| Contact / feedback | `contact.html` (+ `js/contact.js`) |

Shared code: `js/layout.js` (navbar, footer, mobile menu, modals), `js/api.js` (**all** data loading), `js/competitions.js` (competition codes → names/colours), `js/probability.js` (rounding to 100%, confidence labels), `js/model-performance.js` (about page results table), `js/tailwind-config.js`, `css/styles.css`. Backend integration notes: [BACKEND_INTEGRATION.md](BACKEND_INTEGRATION.md).

---

## Running locally

The pages call `fetch()` (for `data/predictions.json` and the API), which browsers block for pages opened as `file://`. **Always open the site through a local web server** at `http://localhost:5500/`.

### 1. Open the project in VS Code

```powershell
cd "path\to\scoreline-Frontend"
code .
```

If `code` isn't recognised: in VS Code use **File → Open Folder…**. To enable the command, on Windows re-run the VS Code installer and tick **"Add to PATH"**. On macOS open the Command Palette and run **"Shell Command: Install 'code' command in PATH"**.

VS Code will offer the recommended extensions (`.vscode/extensions.json`): **Live Server**, Prettier and Tailwind CSS IntelliSense.

### 2. Start a local server (pick one)

| Option | How |
|---|---|
| **Live Server** (VS Code) | Right-click `index.html` → **Open with Live Server**, or click **Go Live** in the status bar. Settings in `.vscode/settings.json` use port 5500 and the project root. |
| **F5 in VS Code** | Choose *ScoreLine: Chrome* or *ScoreLine: Edge*. The `Serve ScoreLine (port 5500)` task starts the server automatically if nothing is running yet. |
| **PowerShell (no installs)** | `powershell -ExecutionPolicy Bypass -File .\serve.ps1`, then stop it with Ctrl+C. Use `-Port 5501` for another port. |
| **Python** | `python -m http.server 5500` from the project root (needs a real Python install). |

Then open **http://localhost:5500/index.html**.

### 3. Predictions data (`data/predictions.json`)

The predictor page shows only what is in `predictions.json`, the file written by the ML pipeline (format: `docs/prediction_format.md` on the main branch). Copy the latest file to **`data/predictions.json`**. It is git-ignored and must never be committed.

Where it is loaded from is set at the top of [`js/api.js`](js/api.js):

```js
PREDICTIONS_ENDPOINT: null,                     // backend URL returning the same JSON; tried first when set
PREDICTIONS_FILE: 'data/predictions.json'      // static fallback (use the static-folder path if Django serves the page)
```

Per-visit override for testing: `predictor.html?predictions=data/other.json`. Entries with missing or invalid fields are skipped (the page says how many), unknown fields are ignored, and a non-empty `flags` list shows a **Limited data** badge.

The contact form still uses `API_BASE_URL` / `MODE` (`auto` | `live` | `mock`, or `?mode=mock`): in `auto` it falls back to a local demo response when the backend is not running.

### 4. Running the backend alongside the frontend

The frontend expects the endpoints described in [BACKEND_INTEGRATION.md](BACKEND_INTEGRATION.md) on port **8000**, and the backend must allow the CORS origin **`http://localhost:5500`**.

**Django** (serves the whole site):

```powershell
.\.venv\Scripts\Activate.ps1
cd Django
python manage.py runserver 8000
```

Then open **http://localhost:8000/**. The pages are Django templates in `Django/ScoreLine/Templates/` (`index.html`, `predictor.html`, `about.html`, `contact.html`), with CSS/JS in `Django/ScoreLine/static/`. Predictions are served at `/api/predictions/` from `data/predictions.json` (override with the `PREDICTIONS_FILE` environment variable). The older templates were kept as `*.old.html`.

> The root `css/` and `js/` folders and `ScoreLine/static/` are copies of each other. After editing one, copy the change to the other (or run the static site only from one place).

Install `django-cors-headers` and set `CORS_ALLOWED_ORIGINS = ["http://localhost:5500"]`, `CORS_ALLOW_CREDENTIALS = True`, `CSRF_TRUSTED_ORIGINS = ["http://localhost:5500"]`. Details are in BACKEND_INTEGRATION.md.

**FastAPI** (what `setup.ps1` currently sets up; it has `/matches/` and a stub `/predictions/{id}`, not the predictor contract yet):

Run setup.ps1 to create the virtual environment and install dependencies, then:

```powershell
.\.venv\Scripts\Activate.ps1
cd backend; python -m uvicorn app.main:app --reload
```

This starts FastAPI on http://127.0.0.1:8000 (docs at `/docs`). FastAPI needs `CORSMiddleware` with `allow_origins=["http://localhost:5500"]` before the browser can call it.

NOTE: If you run into issues with permissions, try:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

---

*ScoreLine predictions are for analytical insight, not betting advice.*
