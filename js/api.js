/* ============================================================================
   ScoreLine API client: the ONLY place the frontend fetches data.
   Exposed as window.ScoreLineAPI.

   PREDICTIONS (predictor page)
   ----------------------------
   Predictions come from one predictions.json document (format: docs/prediction_format.md).
   Sources are tried in order; the first one that answers with valid JSON wins:

     1. PREDICTIONS_ENDPOINT  a backend URL that returns the same document (or just its
                              "predictions" list). null = no backend endpoint yet, so it is
                              skipped and the browser console stays clean. When the backend
                              serves it, set e.g. 'http://localhost:8000/api/predictions/'
                              or '/api/predictions/' (same origin).
     2. PREDICTIONS_FILE      the static file, relative to the page. If Django serves the
                              page, point this at the copy in the static folder,
                              e.g. '/static/data/predictions.json'.

   Per-visit override (testing): predictor.html?predictions=data/other.json

   CONTACT FORM (contact page)
   ---------------------------
   API_BASE_URL  Where the backend lives (no trailing slash). '' = same origin.
   MODE          'auto' : try the live API, fall back to a local demo response
                 'live' : live API only, show errors instead of falling back
                 'mock' : never call the API
   Per-visit overrides: ?mode=mock  ?mode=live&api=http://127.0.0.1:8000
   ========================================================================== */
(function () {
    'use strict';

    var CONFIG = {
        API_BASE_URL: 'http://localhost:8000',
        MODE: 'auto',
        TIMEOUT_MS: 6000,
        PREDICTIONS_ENDPOINT: null,
        PREDICTIONS_FILE: 'data/predictions.json'
    };

    // ---- Page-level overrides ---------------------------------------------------
    // A page can set window.SCORELINE_CONFIG before loading this file (the Django templates
    // do this to use the /api/predictions/ endpoint and same-origin API calls).
    if (window.SCORELINE_CONFIG && typeof window.SCORELINE_CONFIG === 'object') {
        Object.keys(CONFIG).forEach(function (k) {
            if (Object.prototype.hasOwnProperty.call(window.SCORELINE_CONFIG, k)) CONFIG[k] = window.SCORELINE_CONFIG[k];
        });
    }

    // ---- URL overrides --------------------------------------------------------
    try {
        var qs = new URLSearchParams(location.search);
        var m = qs.get('mode');
        if (m === 'auto' || m === 'live' || m === 'mock') CONFIG.MODE = m;
        var api = qs.get('api');
        if (api && /^https?:\/\//.test(api)) CONFIG.API_BASE_URL = api.replace(/\/+$/, '');
        var pf = qs.get('predictions');
        // Only http(s) URLs or plain relative paths (no javascript:, data:, etc.)
        if (pf && (/^https?:\/\//.test(pf) || !/^[a-z][a-z0-9+.-]*:/i.test(pf))) {
            CONFIG.PREDICTIONS_ENDPOINT = null;
            CONFIG.PREDICTIONS_FILE = pf;
        }
    } catch (e) { /* old browser: keep defaults */ }

    function ApiError(message, status, details) {
        var e = new Error(message);
        e.name = 'ApiError'; e.status = status || 0; e.details = details || null;
        return e;
    }

    async function fetchWithTimeout(url, options) {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS);
        try { return await fetch(url, Object.assign({}, options, { signal: ctrl.signal })); }
        finally { clearTimeout(timer); }
    }

    // ==========================================================================
    // PREDICTIONS
    // ==========================================================================
    var OUTCOME_FIELDS = ['home_win', 'draw', 'away_win'];

    function nonEmptyString(v) { return typeof v === 'string' && v.trim() !== ''; }
    function isProb(v) { return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1; }

    /**
     * Turn one raw entry into the shape the page uses, or return null if a required field is
     * missing or invalid. Unknown fields are ignored; field order doesn't matter.
     */
    function normalizePrediction(raw, index) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        if (!nonEmptyString(raw.competition) || !nonEmptyString(raw.home_team) || !nonEmptyString(raw.away_team)) return null;
        if (!nonEmptyString(raw.kickoff)) return null;
        var kickoff = new Date(raw.kickoff);
        if (isNaN(kickoff.getTime())) return null;
        for (var i = 0; i < OUTCOME_FIELDS.length; i++) if (!isProb(raw[OUTCOME_FIELDS[i]])) return null;
        var sum = raw.home_win + raw.draw + raw.away_win;
        if (!(sum > 0)) return null;

        var matchId = (typeof raw.match_id === 'number' && isFinite(raw.match_id)) || nonEmptyString(raw.match_id) ? raw.match_id : null;
        var flags = Array.isArray(raw.flags) ? raw.flags.filter(nonEmptyString).map(function (f) { return f.trim(); }) : [];

        return {
            key: matchId != null ? 'm' + String(matchId) : 'i' + index,
            match_id: matchId,
            competition: raw.competition.trim(),
            home_team: raw.home_team.trim(),
            away_team: raw.away_team.trim(),
            kickoff: kickoff,
            // Re-normalised so rounding noise (spec allows ±0.0002) can't skew the display
            probs: { home: raw.home_win / sum, draw: raw.draw / sum, away: raw.away_win / sum },
            flags: flags
        };
    }

    function normalizeDocument(doc, source) {
        var list = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.predictions) ? doc.predictions : null);
        if (!list) throw ApiError('The predictions data is not in the expected format (no "predictions" list).', 200);
        var meta = Array.isArray(doc) ? {} : doc;
        var generated = nonEmptyString(meta.generated_at) ? new Date(meta.generated_at) : null;

        var predictions = [], skipped = 0;
        list.forEach(function (raw, i) {
            var p = normalizePrediction(raw, i);
            if (p) predictions.push(p); else skipped++;
        });
        if (skipped) console.warn('[ScoreLine] Skipped ' + skipped + ' prediction(s) with missing or invalid fields.');

        return {
            model_version: nonEmptyString(meta.model_version) ? meta.model_version.trim() : null,
            generated_at: generated && !isNaN(generated.getTime()) ? generated : null,
            predictions: predictions,
            skipped: skipped,
            total: list.length,
            source: source
        };
    }

    async function fetchJson(url, isEndpoint) {
        var res;
        try {
            res = isEndpoint
                ? await fetchWithTimeout(url, { headers: { 'Accept': 'application/json' }, credentials: 'include' })
                : await fetch(url, { cache: 'no-cache', headers: { 'Accept': 'application/json' } });
        } catch (e) {
            if (location.protocol === 'file:') throw ApiError('The page was opened from the file system, so the browser blocked loading the data. Open it through a local web server instead (see README).', 0);
            throw ApiError(e.name === 'AbortError' ? 'The predictions source took too long to respond.' : 'Could not reach the predictions source.', 0);
        }
        if (!res.ok) throw ApiError(res.status === 404 ? 'No predictions file was found at ' + url + '.' : 'Loading predictions failed (HTTP ' + res.status + ').', res.status);
        try { return await res.json(); }
        catch (e) { throw ApiError('The predictions file is not valid JSON.', res.status); }
    }

    var predictionsPromise = null;
    function getPredictions(options) {
        if (predictionsPromise && !(options && options.reload)) return predictionsPromise;
        predictionsPromise = (async function () {
            var lastErr = null;
            var sources = [];
            if (CONFIG.PREDICTIONS_ENDPOINT) sources.push({ url: CONFIG.PREDICTIONS_ENDPOINT, endpoint: true });
            if (CONFIG.PREDICTIONS_FILE) sources.push({ url: CONFIG.PREDICTIONS_FILE, endpoint: false });
            for (var i = 0; i < sources.length; i++) {
                try {
                    var doc = await fetchJson(sources[i].url, sources[i].endpoint);
                    return normalizeDocument(doc, sources[i].url);
                } catch (err) {
                    lastErr = err;
                    if (i < sources.length - 1) console.info('[ScoreLine] ' + err.message + ' Trying the next source.');
                }
            }
            throw lastErr || ApiError('No predictions source is configured in js/api.js.', 0);
        })();
        predictionsPromise.catch(function () { predictionsPromise = null; });
        return predictionsPromise;
    }

    // ==========================================================================
    // TEAMS & MATCHUP LOOKUP (built on predictions.json)
    // ==========================================================================
    function sameName(a, b) { return a.trim().toLowerCase() === b.trim().toLowerCase(); }

    /** Sorted team names that appear in predictions.json for one competition. */
    async function getTeams(competition) {
        var data = await getPredictions();
        var set = {};
        data.predictions.forEach(function (p) {
            if (p.competition !== competition) return;
            set[p.home_team] = true; set[p.away_team] = true;
        });
        return Object.keys(set).sort(function (a, b) { return a.localeCompare(b); });
    }

    /**
     * Prediction for "home vs away" in a competition.
     *
     * TODAY this only looks the fixture up in predictions.json, because the model only scores
     * scheduled fixtures. It never estimates numbers for a pairing that isn't in the file.
     *
     * BACKEND TODO: predicting ANY two teams needs a backend endpoint, for example
     *   GET /predictions/matchup?competition=PL&home=Liverpool&away=Arsenal
     * that runs the ensemble from ai/training/predict.py on request (using the latest team
     * ratings/form) and returns the same fields as a predictions.json entry. When it exists,
     * call it here for the 'none' case and return { status: 'found', prediction } instead.
     *
     * Resolves to:
     *   { status: 'found',    prediction }                exact fixture is in the file
     *   { status: 'reversed', prediction }                only "away vs home" is in the file
     *   { status: 'none',     related: [prediction...] }  no fixture; related = other fixtures
     *                                                      involving either team, by kickoff
     */
    async function getMatchupPrediction(competition, home, away) {
        var data = await getPredictions();
        var inComp = data.predictions.filter(function (p) { return p.competition === competition; });
        // If a pairing appears more than once, prefer the next one to kick off, else the latest
        function pick(list) {
            var now = Date.now();
            var future = list.filter(function (p) { return p.kickoff.getTime() > now; }).sort(function (a, b) { return a.kickoff - b.kickoff; });
            if (future.length) return future[0];
            return list.sort(function (a, b) { return b.kickoff - a.kickoff; })[0] || null;
        }
        var exact = pick(inComp.filter(function (p) { return sameName(p.home_team, home) && sameName(p.away_team, away); }));
        if (exact) return { status: 'found', prediction: exact };
        var reversed = pick(inComp.filter(function (p) { return sameName(p.home_team, away) && sameName(p.away_team, home); }));
        if (reversed) return { status: 'reversed', prediction: reversed };
        var related = inComp.filter(function (p) {
            return sameName(p.home_team, home) || sameName(p.away_team, home) || sameName(p.home_team, away) || sameName(p.away_team, away);
        }).sort(function (a, b) { return a.kickoff - b.kickoff; });
        return { status: 'none', related: related };
    }

    // ==========================================================================
    // CONTACT FORM (live API with demo fallback)
    // ==========================================================================
    var state = { source: CONFIG.MODE === 'mock' ? 'mock' : 'unknown', reason: CONFIG.MODE === 'mock' ? 'Mock mode is switched on in js/api.js.' : '' };
    var listeners = [];
    function setSource(source, reason) {
        if (state.source === source && state.reason === reason) return;
        state.source = source; state.reason = reason || '';
        listeners.forEach(function (fn) { try { fn(getStatus()); } catch (e) { console.error(e); } });
    }
    function getStatus() { return { source: state.source, reason: state.reason, mode: CONFIG.MODE, baseUrl: CONFIG.API_BASE_URL }; }

    // CSRF (Django)
    function readCookie(name) {
        var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
    }
    var csrfToken = null;
    async function ensureCsrfToken() {
        csrfToken = csrfToken || readCookie('csrftoken');
        if (csrfToken) return csrfToken;
        try {
            var res = await fetchWithTimeout(CONFIG.API_BASE_URL + '/api/csrf/', { method: 'GET', credentials: 'include' });
            if (res.ok) {
                var body = await res.json().catch(function () { return {}; });
                csrfToken = body.csrfToken || readCookie('csrftoken');
            }
        } catch (e) { /* endpoint optional */ }
        return csrfToken;
    }

    async function liveRequest(method, path, body) {
        var headers = { 'Accept': 'application/json' };
        var opts = { method: method, headers: headers, credentials: 'include' };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        if (method !== 'GET') {
            var token = await ensureCsrfToken();
            if (token) headers['X-CSRFToken'] = token;
        }
        var res;
        try {
            res = await fetchWithTimeout(CONFIG.API_BASE_URL + path, opts);
        } catch (e) {
            throw ApiError(e.name === 'AbortError' ? 'The ScoreLine API took too long to respond.' : 'Could not reach the ScoreLine API (is it running, and is CORS configured?).', 0);
        }
        var data = null;
        var text = await res.text();
        if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
        if (!res.ok) {
            var msg = (data && (data.detail || data.error || data.message)) || ('The ScoreLine API returned HTTP ' + res.status + '.');
            throw ApiError(msg, res.status, data);
        }
        if (data === null) throw ApiError('The ScoreLine API returned a response that was not JSON.', res.status);
        return data;
    }

    function isUnavailable(err) {
        return err.status === 0 || err.status === 404 || err.status === 405 || err.status === 501 || err.status >= 500 ||
            (err.status === 200 && /not JSON/.test(err.message));
    }

    async function request(method, path, body, mockFn) {
        if (CONFIG.MODE === 'mock' || state.source === 'mock') {
            if (state.source !== 'mock') setSource('mock', 'Mock mode is switched on in js/api.js.');
            return mockFn();
        }
        try {
            var data = await liveRequest(method, path, body);
            setSource('live', 'Connected to ' + (CONFIG.API_BASE_URL || location.origin));
            return data;
        } catch (err) {
            if (CONFIG.MODE === 'auto' && isUnavailable(err) && state.source !== 'live') {
                setSource('mock', err.message + ' Using a local demo response instead.');
                return mockFn();
            }
            throw err;
        }
    }

    function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    async function mockContact(payload) {
        await delay(600);
        console.info('[ScoreLine mock] Contact form payload (not sent anywhere):', payload);
        return { ok: true, id: 'mock-' + Date.now(), mock: true };
    }

    // ==========================================================================
    // PUBLIC API
    // ==========================================================================
    window.ScoreLineAPI = {
        config: CONFIG,
        getStatus: getStatus,
        onStatusChange: function (fn) { listeners.push(fn); fn(getStatus()); },

        /**
         * Load and validate predictions.json ->
         * { model_version, generated_at: Date|null, predictions: [{ key, match_id, competition, home_team,
         *   away_team, kickoff: Date, probs: {home, draw, away}, flags: [] }], skipped, total, source }
         */
        getPredictions: getPredictions,

        /** Sorted team names in predictions.json for a competition code (e.g. 'PL'). */
        getTeams: getTeams,

        /** Look up home vs away (see the BACKEND TODO above getMatchupPrediction). */
        getMatchupPrediction: getMatchupPrediction,

        /** POST /api/contact/ { full_name, email, phone, subject, message, rating } -> { ok: true, id } */
        submitContact: function (payload) {
            return request('POST', '/api/contact/', payload, function () { return mockContact(payload); });
        }
    };
})();
