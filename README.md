# ScoreLine

Pre-match football predictions (home win / draw / away win), with a plain HTML/CSS/JS frontend and a Python backend + machine-learning engine.

| Page | File |
|---|---|
| Home | `index.html` |
| Match predictor | `predictor.html` (+ `js/predictor.js`) |
| About us & methodology | `about.html` |
| Contact / feedback | `contact.html` (+ `js/contact.js`) |

Shared code: `js/layout.js` (navbar, footer, mobile menu, modals), `js/api.js` (**all** backend calls), `js/probability.js` (Poisson grid, rounding), `js/tailwind-config.js`, `css/styles.css`. Demo data lives in `data/mock/`. Backend integration notes: [BACKEND_INTEGRATION.md](BACKEND_INTEGRATION.md).

---

## Running locally

The pages call `fetch()` (for the API and the demo JSON), which browsers block for pages opened as `file://`. **Always open the site through a local web server** at `http://localhost:5500/`.

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

### 3. Mock mode vs the live API

Everything is configured at the top of [`js/api.js`](js/api.js):

```js
var CONFIG = {
    API_BASE_URL: 'http://localhost:8000', // backend origin, no trailing slash ('' = same origin)
    MODE: 'auto',                          // 'auto' | 'live' | 'mock'
    ...
};
```

- `auto` (default): tries the live API. If it can't be reached, or an endpoint doesn't exist yet, the page switches to the JSON files in `data/mock/` and shows an amber **"Demo data"** badge.
- `live`: API only. Failures show an error instead of demo data.
- `mock`: never calls the API.

You can also override per visit without editing code: `predictor.html?mode=mock` or `predictor.html?mode=live&api=http://127.0.0.1:8000`.

In demo mode, the 8 sample fixtures (see **Browse fixtures**) show real model output from the sample CSV rows. Any other team pairing shows a clearly labelled **"Demo estimate"** generated from illustrative ratings, and recent form is labelled **illustrative**.

### 4. Running the backend alongside the frontend

The frontend expects the endpoints described in [BACKEND_INTEGRATION.md](BACKEND_INTEGRATION.md) on port **8000**, and the backend must allow the CORS origin **`http://localhost:5500`**.

**Django** (target backend, once the API views exist):

```powershell
.\.venv\Scripts\Activate.ps1
cd Django
python manage.py runserver 8000
```

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
