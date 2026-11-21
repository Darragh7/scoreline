/* ============================================================================
   ScoreLine API client: the ONLY place the frontend talks to the backend.
   Exposed as window.ScoreLineAPI. See BACKEND_INTEGRATION.md for the contract.

   CONFIGURATION
   -------------
   API_BASE_URL  Where the backend lives (no trailing slash). '' = same origin
                 (use this when Django serves the frontend itself).
   MODE          'auto' : try the live API, fall back to demo data if it can't be
                          reached or the endpoint doesn't exist (default)
                 'live' : live API only, show errors instead of falling back
                 'mock' : never call the API; use data/mock/*.json

   Per-visit overrides (handy for testing, no code change needed):
     predictor.html?mode=mock
     predictor.html?mode=live&api=http://127.0.0.1:8000
   ========================================================================== */
(function () {
    'use strict';

    var CONFIG = {
        API_BASE_URL: 'http://localhost:8000',
        MODE: 'auto',
        TIMEOUT_MS: 6000,
        MOCK_BASE: 'data/mock/'
    };

    // ---- URL overrides --------------------------------------------------------
    try {
        var qs = new URLSearchParams(location.search);
        var m = qs.get('mode');
        if (m === 'auto' || m === 'live' || m === 'mock') CONFIG.MODE = m;
        var api = qs.get('api');
        if (api && /^https?:\/\//.test(api)) CONFIG.API_BASE_URL = api.replace(/\/+$/, '');
    } catch (e) { /* old browser: keep defaults */ }

    // ---- Data-source state ------------------------------------------------------
    // 'unknown' until the first request; then 'live' or 'mock'. Once we fall back to
    // mock in auto mode we stay there for this page view so live and demo data never mix.
    var state = { source: CONFIG.MODE === 'mock' ? 'mock' : 'unknown', reason: CONFIG.MODE === 'mock' ? 'Mock mode is switched on in js/api.js.' : '' };
    var listeners = [];
    function setSource(source, reason) {
        if (state.source === source && state.reason === reason) return;
        state.source = source; state.reason = reason || '';
        listeners.forEach(function (fn) { try { fn(getStatus()); } catch (e) { console.error(e); } });
    }
    function getStatus() { return { source: state.source, reason: state.reason, mode: CONFIG.MODE, baseUrl: CONFIG.API_BASE_URL }; }

    function ApiError(message, status, details) {
        var e = new Error(message);
        e.name = 'ApiError'; e.status = status || 0; e.details = details || null;
        return e;
    }

    // ---- CSRF (Django) ----------------------------------------------------------
    function readCookie(name) {
        var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : null;
    }
    var csrfToken = null;
    async function ensureCsrfToken() {
        // Cookies are shared across ports on the same host, so a csrftoken cookie set by
        // Django on localhost:8000 is readable from a page on localhost:5500.
        csrfToken = csrfToken || readCookie('csrftoken');
        if (csrfToken) return csrfToken;
        try {
            var res = await fetchWithTimeout(CONFIG.API_BASE_URL + '/api/csrf/', { method: 'GET', credentials: 'include' });
            if (res.ok) {
                var body = await res.json().catch(function () { return {}; });
                csrfToken = body.csrfToken || readCookie('csrftoken');
            }
        } catch (e) { /* endpoint optional; the backend may exempt these views instead */ }
        return csrfToken;
    }

    // ---- Low-level fetch -------------------------------------------------------
    async function fetchWithTimeout(url, options) {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, CONFIG.TIMEOUT_MS);
        try { return await fetch(url, Object.assign({}, options, { signal: ctrl.signal })); }
        finally { clearTimeout(timer); }
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

    /** Errors that mean "the API isn't there" (so auto mode should use demo data) */
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
                setSource('mock', err.message + ' Showing demo data instead.');
                return mockFn();
            }
            throw err;
        }
    }

    // ==========================================================================
    // MOCK BACKEND (data/mock/*.json + clearly labelled demo generation)
    // ==========================================================================
    var mockCache = {};
    async function loadMock(name) {
        if (!mockCache[name]) {
            mockCache[name] = fetch(CONFIG.MOCK_BASE + name, { cache: 'no-cache' }).then(function (r) {
                if (!r.ok) throw ApiError('Demo data file ' + name + ' could not be loaded (HTTP ' + r.status + ').', r.status);
                return r.json();
            }).catch(function (e) {
                delete mockCache[name];
                if (e.name === 'ApiError') throw e;
                throw ApiError('Demo data could not be loaded. Open the site through a local web server (see README), not from the file system.', 0);
            });
        }
        return mockCache[name];
    }
    function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    async function teamRating(league, name) {
        var t = await loadMock('teams.json');
        var list = t.teams[league] || [];
        for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i].rating;
        return 1600;
    }

    /** Demo-only prediction from illustrative ratings (used when a fixture isn't in the sample data) */
    function demoModels(home, away, rh, ra) {
        var P = window.SLProb;
        var rand = P.seededRandom(P.hashString(home + '|' + away));
        var diff = rh - ra;
        var lh = Math.max(0.35, 1.45 * Math.exp(diff / 520));
        var la = Math.max(0.3, 1.15 * Math.exp(-diff / 520));
        var poisson = P.outcomesFromLambdas(lh, la);

        var dElo = diff + 65; // home advantage in Elo points
        var e = 1 / (1 + Math.pow(10, -dElo / 400));
        var pd = 0.29 - 0.16 * Math.abs(e - 0.5);
        var elo = { home: (1 - pd) * e, draw: pd, away: (1 - pd) * (1 - e) };

        function jitter(base, amt) {
            return P.normalize({
                home: Math.max(0.02, base.home + (rand() - 0.5) * amt),
                draw: Math.max(0.02, base.draw + (rand() - 0.5) * amt * 0.6),
                away: Math.max(0.02, base.away + (rand() - 0.5) * amt)
            });
        }
        var blend = P.normalize({ home: (poisson.home + elo.home) / 2, draw: (poisson.draw + elo.draw) / 2, away: (poisson.away + elo.away) / 2 });
        return {
            expected_goals: { home: +lh.toFixed(3), away: +la.toFixed(3) },
            models: {
                logistic_regression: round4(jitter(blend, 0.04)),
                random_forest: round4(jitter(blend, 0.08)),
                xgboost: round4(jitter(blend, 0.06)),
                poisson: round4(poisson),
                elo: round4(P.normalize(elo))
            }
        };
    }
    function round4(p) { return { home: +p.home.toFixed(4), draw: +p.draw.toFixed(4), away: +p.away.toFixed(4) }; }

    var mock = {
        leagues: async function () { await delay(150); return loadMock('leagues.json'); },
        teams: async function (league) {
            var t = await loadMock('teams.json');
            return { league: league, teams: (t.teams[league] || []).map(function (x) { return x.name; }).sort() };
        },
        fixtures: async function (params) {
            var f = await loadMock('fixtures.json');
            var seasons = Array.from(new Set(f.fixtures.map(function (x) { return x.season; }))).sort().reverse();
            var list = f.fixtures.filter(function (x) {
                return (!params.season || x.season === params.season) &&
                    (!params.league || x.league === params.league) &&
                    (!params.date || x.date === params.date);
            }).map(function (x) {
                return { id: x.id, league: x.league, date: x.date, season: x.season, home_team: x.home_team, away_team: x.away_team };
            });
            return { seasons: seasons, fixtures: list };
        },
        predict: async function (req) {
            await delay(450);
            var f = await loadMock('fixtures.json');
            var match = f.fixtures.filter(function (x) {
                return (req.fixture_id ? x.id === req.fixture_id : true) &&
                    x.league === req.league && x.home_team === req.home_team && x.away_team === req.away_team;
            }).sort(function (a, b) { return b.date.localeCompare(a.date); })[0];
            if (match) {
                return {
                    home_team: match.home_team, away_team: match.away_team, league: match.league,
                    fixture: { id: match.id, date: match.date, season: match.season },
                    source: 'model_output',
                    expected_goals: match.expected_goals,
                    models: JSON.parse(JSON.stringify(match.models))
                };
            }
            var rh = await teamRating(req.league, req.home_team), ra = await teamRating(req.league, req.away_team);
            var demo = demoModels(req.home_team, req.away_team, rh, ra);
            return {
                home_team: req.home_team, away_team: req.away_team, league: req.league,
                fixture: null, source: 'demo_estimate',
                expected_goals: demo.expected_goals, models: demo.models
            };
        },
        form: async function (params) {
            await delay(200);
            var P = window.SLProb;
            var t = await loadMock('teams.json');
            var teams = (t.teams[params.league] || []).map(function (x) { return x; });
            var n = params.n || 5;
            var end = params.before ? new Date(params.before) : new Date('2024-05-25');
            function ratingOf(name) { for (var i = 0; i < teams.length; i++) if (teams[i].name === name) return teams[i].rating; return 1600; }
            function play(home, away, rand) {
                var d = ratingOf(home) - ratingOf(away);
                return { hg: P.samplePoisson(Math.max(0.35, 1.45 * Math.exp(d / 520)), rand), ag: P.samplePoisson(Math.max(0.3, 1.15 * Math.exp(-d / 520)), rand) };
            }
            function teamForm(team) {
                var rand = P.seededRandom(P.hashString('form|' + team));
                var opps = teams.filter(function (x) { return x.name !== params.home_team && x.name !== params.away_team; });
                var out = [];
                for (var i = 0; i < n; i++) {
                    var opp = opps[Math.floor(rand() * opps.length)].name;
                    var atHome = rand() > 0.5;
                    var r = atHome ? play(team, opp, rand) : play(opp, team, rand);
                    var gf = atHome ? r.hg : r.ag, ga = atHome ? r.ag : r.hg;
                    var dt = new Date(end.getTime() - (i + 1) * 7 * 86400000);
                    out.push({ date: dt.toISOString().slice(0, 10), opponent: opp, venue: atHome ? 'H' : 'A', goals_for: gf, goals_against: ga, result: gf > ga ? 'W' : gf === ga ? 'D' : 'L' });
                }
                return { team: team, matches: out };
            }
            var rand = P.seededRandom(P.hashString('h2h|' + [params.home_team, params.away_team].sort().join('|')));
            var h2h = [];
            for (var i = 0; i < 5; i++) {
                var homeSide = i % 2 === 0 ? params.home_team : params.away_team;
                var awaySide = homeSide === params.home_team ? params.away_team : params.home_team;
                var r = play(homeSide, awaySide, rand);
                var dt = new Date(end.getTime() - (i * 182 + 40) * 86400000);
                h2h.push({ date: dt.toISOString().slice(0, 10), home_team: homeSide, away_team: awaySide, home_goals: r.hg, away_goals: r.ag });
            }
            return { illustrative: true, home: teamForm(params.home_team), away: teamForm(params.away_team), head_to_head: h2h };
        },
        performance: async function () { await delay(100); return loadMock('model_performance.json'); },
        contact: async function (payload) {
            await delay(600);
            console.info('[ScoreLine mock] Contact form payload (not sent anywhere):', payload);
            return { ok: true, id: 'mock-' + Date.now(), mock: true };
        }
    };

    // ---- Shared post-processing -----------------------------------------------
    /** Fill derived models (ensemble = mean of Elo + Poisson; LR + XGBoost average) when their parts exist */
    function addDerivedModels(pred) {
        var m = pred.models || (pred.models = {});
        function avg(a, b) { return a && b ? round4(window.SLProb.normalize({ home: (a.home + b.home) / 2, draw: (a.draw + b.draw) / 2, away: (a.away + b.away) / 2 })) : null; }
        if (!m.ensemble) m.ensemble = avg(m.elo, m.poisson);
        if (!m.lr_xgb_average) m.lr_xgb_average = avg(m.logistic_regression, m.xgboost);
        return pred;
    }

    function qsOf(params) {
        var parts = [];
        Object.keys(params).forEach(function (k) {
            if (params[k] !== undefined && params[k] !== null && params[k] !== '') parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        });
        return parts.length ? '?' + parts.join('&') : '';
    }

    // ==========================================================================
    // PUBLIC API
    // ==========================================================================
    window.ScoreLineAPI = {
        config: CONFIG,
        getStatus: getStatus,
        onStatusChange: function (fn) { listeners.push(fn); fn(getStatus()); },

        /** GET /api/leagues/ -> { leagues: [{ code, name, country }] } */
        getLeagues: function () { return request('GET', '/api/leagues/', undefined, mock.leagues); },

        /** GET /api/teams/?league=E0 -> { league, teams: ["Arsenal", ...] } */
        getTeams: function (league) {
            return request('GET', '/api/teams/' + qsOf({ league: league }), undefined, function () { return mock.teams(league); });
        },

        /** GET /api/fixtures/?season=&league=&date= -> { seasons: [...], fixtures: [{ id, league, date, season, home_team, away_team }] } */
        getFixtures: function (params) {
            params = params || {};
            return request('GET', '/api/fixtures/' + qsOf(params), undefined, function () { return mock.fixtures(params); });
        },

        /** POST /api/predict/ { home_team, away_team, league, model, fixture_id? } -> prediction (see contract) */
        predict: function (req) {
            return request('POST', '/api/predict/', req, function () { return mock.predict(req); }).then(addDerivedModels);
        },

        /** GET /api/form/?league=&home_team=&away_team=&n=5 -> { home: {team, matches}, away: {...}, head_to_head: [...] } */
        getForm: function (params) {
            return request('GET', '/api/form/' + qsOf(params), undefined, function () { return mock.form(params); });
        },

        /** GET /api/model-performance/ -> { default_model, validation: {...}, test: {...} } */
        getModelPerformance: function () { return request('GET', '/api/model-performance/', undefined, mock.performance); },

        /** POST /api/contact/ { full_name, email, phone, subject, message, rating } -> { ok: true, id } */
        submitContact: function (payload) {
            return request('POST', '/api/contact/', payload, function () { return mock.contact(payload); });
        }
    };
})();
