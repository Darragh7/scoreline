/* ScoreLine predictor page. Depends on js/probability.js (SLProb) and js/api.js (ScoreLineAPI). */
(function () {
    'use strict';

    var API = window.ScoreLineAPI;
    var P = window.SLProb;

    // Display order = selector order. Default = best performer on the 2025/26 final test.
    var MODELS = [
        { key: 'logistic_regression', label: 'Logistic Regression', note: 'Best on 2025/26 final test' },
        { key: 'ensemble', label: 'Ensemble (Elo + Poisson)', note: 'Best on 2024/25 validation' },
        { key: 'xgboost', label: 'XGBoost' },
        { key: 'lr_xgb_average', label: 'LR + XGBoost (average)' },
        { key: 'random_forest', label: 'Random Forest' },
        { key: 'poisson', label: 'Poisson' },
        { key: 'elo', label: 'Elo' }
    ];
    var DEFAULT_MODEL = 'logistic_regression';
    var OUTCOME_LABEL = { home: 'Home win', draw: 'Draw', away: 'Away win' };

    var state = {
        leagues: [],
        leagueNames: {},
        league: null,
        teams: [],
        model: DEFAULT_MODEL,
        prediction: null,
        form: null,
        fixtures: [],
        perf: null,
        perfSet: 'test',
        requestId: 0,
        lastRequest: null
    };

    var $ = function (id) { return document.getElementById(id); };

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function modelLabel(key) { for (var i = 0; i < MODELS.length; i++) if (MODELS[i].key === key) return MODELS[i].label; return key; }
    function fmtDate(iso) {
        if (!iso) return '';
        var d = new Date(iso + 'T12:00:00');
        return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }
    function fmtShortDate(iso) {
        var d = new Date(iso + 'T12:00:00');
        return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
    }

    // ======================================================================
    // Data-source badge
    // ======================================================================
    API.onStatusChange(function (s) {
        var badge = $('sourceBadge'), tip = $('sourceBadgeTip');
        if (s.source === 'live') {
            badge.className = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/50 bg-emerald-500/10 text-xs font-bold uppercase tracking-wider text-emerald-300';
            badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400" aria-hidden="true"></span> Live API';
            tip.textContent = s.reason;
        } else if (s.source === 'mock') {
            badge.className = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/50 bg-amber-500/10 text-xs font-bold uppercase tracking-wider text-amber-300';
            badge.innerHTML = '<i class="fa-solid fa-flask" aria-hidden="true"></i> Demo data';
            tip.textContent = s.reason + ' Demo data uses the sample model outputs; other match-ups are illustrative estimates.';
        }
    });

    // ======================================================================
    // Accessible combobox (ARIA 1.2 pattern)
    // ======================================================================
    function Combobox(input, onCommit) {
        var wrap = input.parentElement;
        var list = wrap.querySelector('[role="listbox"]');
        var toggle = wrap.querySelector('[data-combo-toggle]');
        var options = [], excluded = null, active = -1, value = '';

        function filtered() {
            var q = input.value.trim().toLowerCase();
            var all = options.slice();
            if (q && all.some(function (o) { return o.toLowerCase() === q; })) q = ''; // exact match: show everything
            return all.filter(function (o) { return !q || o.toLowerCase().indexOf(q) !== -1; });
        }
        function render() {
            var items = filtered();
            active = Math.min(active, items.length - 1);
            if (!items.length) {
                list.innerHTML = '<li class="px-3 py-2 text-sm text-gray-400" role="presentation">No teams match "' + esc(input.value) + '"</li>';
                return;
            }
            list.innerHTML = items.map(function (o, i) {
                var dis = o === excluded;
                return '<li role="option" id="' + list.id + '-opt-' + i + '" data-value="' + esc(o) + '" aria-selected="' + (i === active) + '"' +
                    (dis ? ' aria-disabled="true" title="A team can’t play itself"' : '') + '>' + esc(o) + (dis ? ' <span class="text-[10px] uppercase">(selected opposite)</span>' : '') + '</li>';
            }).join('');
            if (active >= 0) {
                input.setAttribute('aria-activedescendant', list.id + '-opt-' + active);
                var el = $(list.id + '-opt-' + active);
                if (el) el.scrollIntoView({ block: 'nearest' });
            } else input.removeAttribute('aria-activedescendant');
        }
        function open() { if (!options.length) return; list.classList.remove('hidden'); input.setAttribute('aria-expanded', 'true'); render(); }
        function close() { list.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
        function commit(v) {
            if (v === excluded) return;
            value = v; input.value = v; close(); onCommit(v);
        }
        function resolveTyped() {
            var q = input.value.trim().toLowerCase();
            var match = options.filter(function (o) { return o.toLowerCase() === q; })[0];
            if (match) { value = match; input.value = match; }
            else value = '';
            return value;
        }

        input.addEventListener('input', function () { value = ''; active = 0; open(); });
        input.addEventListener('focus', open);
        input.addEventListener('click', open);
        input.addEventListener('blur', function () { setTimeout(function () { close(); resolveTyped(); }, 150); });
        input.addEventListener('keydown', function (e) {
            var items = filtered();
            if (e.key === 'ArrowDown') { e.preventDefault(); if (list.classList.contains('hidden')) open(); active = Math.min(items.length - 1, active + 1); render(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
            else if (e.key === 'Enter') {
                if (!list.classList.contains('hidden') && active >= 0 && items[active]) { e.preventDefault(); commit(items[active]); }
            }
            else if (e.key === 'Escape') { if (!list.classList.contains('hidden')) { e.preventDefault(); e.stopPropagation(); close(); } }
            else if (e.key === 'Tab') { close(); resolveTyped(); }
        });
        list.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep focus in input
        list.addEventListener('click', function (e) {
            var li = e.target.closest('[role="option"]');
            if (li && li.getAttribute('aria-disabled') !== 'true') commit(li.getAttribute('data-value'));
        });
        toggle.addEventListener('mousedown', function (e) { e.preventDefault(); });
        toggle.addEventListener('click', function () {
            if (list.classList.contains('hidden')) { input.focus(); open(); } else close();
        });

        return {
            setOptions: function (opts) { options = opts.slice(); if (value && options.indexOf(value) === -1) { value = ''; input.value = ''; } },
            setExcluded: function (v) { excluded = v || null; },
            getValue: function () { return value || resolveTyped(); },
            setValue: function (v) { value = options.indexOf(v) !== -1 ? v : ''; input.value = value; },
            input: input
        };
    }

    var homeBox, awayBox;

    // ======================================================================
    // Controls
    // ======================================================================
    function renderLeagues() {
        var g = $('leagueGroup');
        g.style.gridTemplateColumns = 'repeat(' + Math.min(state.leagues.length, 3) + ', minmax(0, 1fr))';
        g.innerHTML = state.leagues.map(function (l) {
            return '<label class="relative cursor-pointer">' +
                '<input type="radio" name="league" value="' + esc(l.code) + '" class="peer sr-only-custom">' +
                '<span class="flex flex-col items-center justify-center text-center h-full px-2 py-2.5 rounded-xl border border-sportBorder bg-sportCard text-gray-300 text-xs font-bold uppercase tracking-wide transition-colors ' +
                'peer-checked:border-activeRed peer-checked:text-white peer-checked:bg-activeRed/15 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-activeRed hover:border-gray-500">' +
                esc(l.name) + '<span class="text-[10px] text-gray-400 font-semibold normal-case tracking-normal">' + esc(l.country || l.code) + '</span></span></label>';
        }).join('');
        g.addEventListener('change', function (e) { if (e.target.name === 'league') selectLeague(e.target.value, true); });

        var fx = $('fxLeague');
        state.leagues.forEach(function (l) {
            var o = document.createElement('option'); o.value = l.code; o.textContent = l.name; fx.appendChild(o);
        });
    }

    async function selectLeague(code, userInitiated) {
        if (state.league === code && !userInitiated) return;
        state.league = code;
        var radio = document.querySelector('input[name="league"][value="' + code + '"]');
        if (radio) radio.checked = true;
        homeBox.input.disabled = awayBox.input.disabled = true;
        homeBox.input.placeholder = awayBox.input.placeholder = 'Loading teams…';
        try {
            var res = await API.getTeams(code);
            state.teams = res.teams || [];
            homeBox.setOptions(state.teams); awayBox.setOptions(state.teams);
            syncExclusions();
            clearFieldErrors();
        } catch (err) {
            showFormError('Could not load teams: ' + err.message);
        } finally {
            homeBox.input.disabled = awayBox.input.disabled = false;
            homeBox.input.placeholder = 'Search home team…';
            awayBox.input.placeholder = 'Search away team…';
        }
    }

    function syncExclusions() {
        homeBox.setExcluded(awayBox.getValue());
        awayBox.setExcluded(homeBox.getValue());
    }

    function renderModelSelect() {
        $('modelSelect').innerHTML = MODELS.map(function (m) {
            return '<option value="' + m.key + '"' + (m.key === state.model ? ' selected' : '') + '>' + esc(m.label) + (m.note ? ' (' + m.note + ')' : '') + '</option>';
        }).join('');
    }

    function setFieldError(which, msg) {
        var input = $(which + 'Team'), err = $(which + 'TeamError');
        input.classList.toggle('field-invalid', !!msg);
        input.setAttribute('aria-invalid', msg ? 'true' : 'false');
        err.textContent = msg || '';
        err.classList.toggle('hidden', !msg);
    }
    function clearFieldErrors() { setFieldError('home'); setFieldError('away'); showFormError(''); }
    function showFormError(msg) { var e = $('formError'); e.textContent = msg; e.classList.toggle('hidden', !msg); }

    function validate() {
        clearFieldErrors();
        var ok = true;
        if (!state.league) { showFormError('Choose a league first.'); ok = false; }
        var h = homeBox.getValue(), a = awayBox.getValue();
        if (!h) { setFieldError('home', homeBox.input.value ? 'Pick a team from the list.' : 'Choose a home team.'); ok = false; }
        if (!a) { setFieldError('away', awayBox.input.value ? 'Pick a team from the list.' : 'Choose an away team.'); ok = false; }
        if (h && a && h === a) { setFieldError('away', 'A team can’t play itself. Choose a different away team.'); ok = false; }
        if (!ok) {
            var firstBad = document.querySelector('#predictForm [aria-invalid="true"]');
            if (firstBad) firstBad.focus();
        }
        return ok ? { home: h, away: a } : null;
    }

    // ======================================================================
    // States
    // ======================================================================
    function showState(which) {
        ['stateEmpty', 'stateLoading', 'stateError', 'resultCard'].forEach(function (id) { $(id).classList.toggle('hidden', id !== which); });
        $('resultRegion').setAttribute('aria-busy', which === 'stateLoading' ? 'true' : 'false');
        $('details').classList.toggle('hidden', which !== 'resultCard');
    }

    // ======================================================================
    // Prediction flow
    // ======================================================================
    async function runPrediction(req) {
        var id = ++state.requestId;
        state.lastRequest = req;
        var btn = $('predictBtn');
        btn.disabled = true;
        btn.querySelector('span').textContent = 'Predicting…';
        showState('stateLoading');
        if (window.innerWidth < 1024) $('resultRegion').scrollIntoView({ behavior: 'smooth', block: 'start' });

        try {
            var pred = await API.predict({ home_team: req.home, away_team: req.away, league: req.league, model: state.model, fixture_id: req.fixtureId || undefined });
            if (id !== state.requestId) return;
            var form = null;
            try {
                form = await API.getForm({ league: req.league, home_team: req.home, away_team: req.away, n: 5, before: pred.fixture ? pred.fixture.date : undefined });
            } catch (e) { form = { error: e.message }; }
            if (id !== state.requestId) return;
            state.prediction = pred;
            state.form = form;
            renderAll();
            showState('resultCard');
            updateUrl(req);
            $('resultTitle') && $('resultTitle').focus({ preventScroll: true });
        } catch (err) {
            if (id !== state.requestId) return;
            $('errorMessage').textContent = err.message || 'Something went wrong while fetching the prediction.';
            showState('stateError');
        } finally {
            if (id === state.requestId) {
                btn.disabled = false;
                btn.querySelector('span').textContent = 'Predict';
            }
        }
    }

    function updateUrl(req) {
        try {
            var q = new URLSearchParams(location.search);
            q.set('league', req.league); q.set('home', req.home); q.set('away', req.away); q.set('model', state.model);
            if (req.fixtureId) q.set('fixture', req.fixtureId); else q.delete('fixture');
            history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash);
        } catch (e) { /* ignore */ }
    }

    /** Model actually shown: the selected one, or the best available fallback */
    function effectiveModel(pred) {
        var m = pred.models || {};
        if (m[state.model]) return { key: state.model, fallback: false };
        for (var i = 0; i < MODELS.length; i++) if (m[MODELS[i].key]) return { key: MODELS[i].key, fallback: true };
        return null;
    }

    function renderAll() {
        renderResultCard();
        renderComparison();
        renderGoals();
        renderForm();
    }

    function renderResultCard() {
        var pred = state.prediction, card = $('resultCard');
        var eff = effectiveModel(pred);
        var leagueName = state.leagueNames[pred.league] || pred.league;
        var meta = [esc(leagueName)];
        if (pred.fixture) { meta.push(esc(fmtDate(pred.fixture.date))); if (pred.fixture.season) meta.push('Season ' + esc(pred.fixture.season)); }

        var sourceChip = pred.source === 'demo_estimate'
            ? '<span class="sl-tooltip"><span tabindex="0" aria-describedby="srcTip" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/40 text-amber-300 text-[11px] font-bold uppercase tracking-wider"><i class="fa-solid fa-flask" aria-hidden="true"></i> Demo estimate</span>' +
              '<span id="srcTip" role="tooltip" class="sl-tooltip-panel" style="left:auto;right:0;transform:none;">This match-up isn’t in the sample model output, so these numbers are generated from illustrative team ratings to demo the page. Connect the backend for real model predictions.</span></span>'
            : '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold uppercase tracking-wider"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Model output</span>';

        var head =
            '<div class="flex flex-wrap items-center justify-between gap-3 mb-5">' +
                '<p class="text-xs text-gray-400 font-semibold uppercase tracking-wider">' + meta.join(' · ') + '</p>' + sourceChip +
            '</div>' +
            '<h2 id="resultTitle" tabindex="-1" class="grid grid-cols-[1fr_auto_1fr] items-center gap-3 mb-6 focus:outline-none">' +
                '<span class="text-right"><span class="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Home</span><span class="block text-2xl sm:text-4xl font-black text-white uppercase italic leading-tight break-words">' + esc(pred.home_team) + '</span></span>' +
                '<span class="text-activeRed font-teko text-2xl sm:text-3xl" aria-label="versus">VS</span>' +
                '<span class="text-left"><span class="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Away</span><span class="block text-2xl sm:text-4xl font-black text-white uppercase italic leading-tight break-words">' + esc(pred.away_team) + '</span></span>' +
            '</h2>';

        if (!eff) {
            card.innerHTML = head + '<p class="text-sm text-gray-300">None of the models returned probabilities for this fixture.</p>';
            return;
        }

        var p = pred.models[eff.key];
        var pct = P.toPercents(p, 0);
        var pick = P.mostLikely(p);
        var conf = P.confidence(p);
        var toneCls = conf.tone === 'strong' ? 'bg-activeRed/15 border-activeRed/50 text-white' : conf.tone === 'medium' ? 'bg-amber-500/10 border-amber-500/40 text-amber-200' : 'bg-gray-500/15 border-gray-500/50 text-gray-200';

        var fallbackNote = eff.fallback
            ? '<p class="mb-4 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2"><i class="fa-solid fa-circle-info mr-1" aria-hidden="true"></i>' + esc(modelLabel(state.model)) + ' has no output for this fixture, so ' + esc(modelLabel(eff.key)) + ' is shown instead.</p>'
            : '';

        function seg(cls, key, label) {
            var w = pct[key];
            return '<div class="' + cls + '" style="width:' + Math.max(w, 0.0001) + '%" data-tip="' + label + ': ' + pct[key] + '%">' + (w >= 11 ? w + '%' : '') + '</div>';
        }
        function box(key, team) {
            var isPick = key === pick;
            var swatch = key === 'home' ? 'bg-outHome' : key === 'draw' ? 'bg-outDraw' : 'bg-outAway';
            return '<div class="relative rounded-2xl p-4 text-center border ' + (isPick ? 'border-activeRed bg-activeRed/10 shadow-red-glow' : 'border-sportBorder bg-sportCard') + '">' +
                (isPick ? '<span class="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-ctaRed text-white text-[9px] font-black uppercase tracking-widest whitespace-nowrap">Most likely</span>' : '') +
                '<div class="flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-300"><span class="w-2.5 h-2.5 rounded-sm ' + swatch + '" aria-hidden="true"></span>' + OUTCOME_LABEL[key] + '</div>' +
                '<div class="font-teko text-5xl sm:text-6xl leading-none mt-2 ' + (isPick ? 'text-white' : 'text-gray-200') + ' tabular">' + pct[key] + '<span class="text-2xl text-gray-400">%</span></div>' +
                '<div class="text-[11px] text-gray-400 mt-1 truncate">' + esc(team) + '</div>' +
            '</div>';
        }

        var summary;
        if (pick === 'draw') summary = esc(modelLabel(eff.key)) + ' rates a draw as the single most likely result (' + pct.draw + '%), with ' + esc(pred.home_team) + ' on ' + pct.home + '% and ' + esc(pred.away_team) + ' on ' + pct.away + '%.';
        else {
            var fav = pick === 'home' ? pred.home_team : pred.away_team;
            var notWin = 100 - pct[pick];
            summary = esc(modelLabel(eff.key)) + ' gives <strong class="text-white">' + esc(fav) + '</strong> a ' + pct[pick] + '% chance of winning. That still leaves a ' + notWin + '% chance they don’t.';
        }

        card.innerHTML = head + fallbackNote +
            '<div class="flex flex-wrap items-center gap-2 mb-4">' +
                '<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold uppercase tracking-wider ' + toneCls + '"><i class="fa-solid fa-gauge-high" aria-hidden="true"></i>' + esc(conf.label) + '</span>' +
                '<span class="text-xs text-gray-400">' + esc(conf.detail) + '</span>' +
            '</div>' +
            '<div class="prob-bar mb-2" aria-hidden="true">' + seg('seg-home', 'home', 'Home win') + seg('seg-draw', 'draw', 'Draw') + seg('seg-away', 'away', 'Away win') + '</div>' +
            '<p class="sr-only-custom">Home win ' + pct.home + ' percent, draw ' + pct.draw + ' percent, away win ' + pct.away + ' percent. Most likely: ' + OUTCOME_LABEL[pick] + '.</p>' +
            '<div class="flex justify-between text-[10px] uppercase tracking-wider text-gray-400 mb-6" aria-hidden="true"><span>' + esc(pred.home_team) + '</span><span>Draw</span><span>' + esc(pred.away_team) + '</span></div>' +
            '<div class="grid grid-cols-3 gap-2 sm:gap-4 mb-6">' + box('home', pred.home_team) + box('draw', 'Shared points') + box('away', pred.away_team) + '</div>' +
            '<p class="text-sm text-gray-300 leading-relaxed">' + summary + '</p>' +
            '<p class="mt-4 text-[11px] text-gray-400"><i class="fa-solid fa-microchip mr-1 text-activeRed" aria-hidden="true"></i>Model: <strong class="text-gray-200">' + esc(modelLabel(eff.key)) + '</strong> · percentages are rounded so they always total 100%.</p>';
    }

    function renderComparison() {
        var pred = state.prediction, eff = effectiveModel(pred);
        $('compareBody').innerHTML = MODELS.map(function (m) {
            var p = pred.models[m.key];
            var isSel = eff && eff.key === m.key;
            var rowCls = 'border-b border-sportBorder/60 ' + (isSel ? 'bg-activeRed/10' : '');
            var nameBtn = '<button type="button" data-model="' + m.key + '" class="text-left font-semibold ' + (isSel ? 'text-white' : 'text-gray-300 hover:text-activeRed') + (p ? '' : ' cursor-not-allowed opacity-60') + '"' +
                (p ? '' : ' disabled') + ' aria-pressed="' + isSel + '">' + (isSel ? '<i class="fa-solid fa-caret-right text-activeRed mr-1" aria-hidden="true"></i>' : '') + esc(m.label) + '</button>';
            if (!p) {
                return '<tr class="' + rowCls + '"><th scope="row" class="py-2.5 pr-2 font-normal text-left">' + nameBtn + '</th><td colspan="4" class="py-2.5 px-2 text-xs text-gray-400 italic">No output for this fixture</td></tr>';
            }
            var pc = P.toPercents(p, 1), pick = P.mostLikely(p);
            function cell(k) { return '<td class="py-2.5 px-2 text-right ' + (k === pick ? 'text-white font-bold' : 'text-gray-300') + '">' + pc[k].toFixed(1) + '%</td>'; }
            return '<tr class="' + rowCls + '"><th scope="row" class="py-2.5 pr-2 font-normal text-left">' + nameBtn + '</th>' + cell('home') + cell('draw') + cell('away') +
                '<td class="py-2.5 pl-3"><div class="mini-bar" data-tip="' + esc(m.label) + ': H ' + pc.home.toFixed(1) + '% · D ' + pc.draw.toFixed(1) + '% · A ' + pc.away.toFixed(1) + '%">' +
                '<span style="width:' + pc.home + '%"></span><span style="width:' + pc.draw + '%"></span><span style="width:' + pc.away + '%"></span></div></td></tr>';
        }).join('');
    }

    function renderGoals() {
        var pred = state.prediction, panel = $('goalsPanel');
        var xg = pred.expected_goals;
        if (!xg || xg.home == null || xg.away == null) {
            panel.innerHTML = '<p class="text-sm text-gray-400">No expected-goals estimate is available for this fixture.</p>';
            return;
        }
        var grid = P.scoreGrid(xg.home, xg.away, 5);
        var top = P.topScores(grid, 5);
        var covered = grid.reduce(function (s, r) { return s + r.reduce(function (a, b) { return a + b; }, 0); }, 0);
        var maxP = top[0].p;

        var xgHtml =
            '<div class="grid grid-cols-2 gap-3 mb-6">' +
                '<div class="rounded-2xl bg-sportCard border border-sportBorder p-4 text-center"><div class="text-[11px] font-bold uppercase tracking-wider text-gray-400 truncate">' + esc(pred.home_team) + '</div>' +
                    '<div class="font-teko text-5xl text-white leading-none mt-1 tabular">' + xg.home.toFixed(2) + '</div><div class="text-[11px] text-gray-400">expected goals</div></div>' +
                '<div class="rounded-2xl bg-sportCard border border-sportBorder p-4 text-center"><div class="text-[11px] font-bold uppercase tracking-wider text-gray-400 truncate">' + esc(pred.away_team) + '</div>' +
                    '<div class="font-teko text-5xl text-white leading-none mt-1 tabular">' + xg.away.toFixed(2) + '</div><div class="text-[11px] text-gray-400">expected goals</div></div>' +
            '</div>';

        var topHtml = '<h3 class="text-xs font-bold text-gray-300 uppercase tracking-wider mb-3">Most likely exact scores</h3><ol class="space-y-2 mb-6">' +
            top.map(function (s, i) {
                var pc = (s.p * 100).toFixed(1);
                return '<li class="grid grid-cols-[2rem_4.5rem_1fr_3.5rem] items-center gap-2 text-sm">' +
                    '<span class="text-xs text-gray-400 tabular">#' + (i + 1) + '</span>' +
                    '<span class="font-bold text-white tabular">' + s.home + ' – ' + s.away + '</span>' +
                    '<span class="h-2.5 rounded-r bg-sportBorder overflow-hidden"><span class="block h-full rounded-r bg-activeRed" style="width:' + (s.p / maxP * 100).toFixed(1) + '%"></span></span>' +
                    '<span class="text-right text-gray-300 tabular">' + pc + '%</span></li>';
            }).join('') + '</ol>';

        var rows = '';
        for (var h = 0; h <= 5; h++) {
            rows += '<tr><th scope="row" class="text-[11px] text-gray-400 font-semibold pr-1 text-right">' + h + '</th>';
            for (var a = 0; a <= 5; a++) {
                var v = grid[h][a], alpha = Math.min(1, v / maxP);
                var dark = alpha > 0.55;
                rows += '<td style="background:rgba(255,23,68,' + (0.06 + alpha * 0.85).toFixed(3) + ')" class="' + (dark ? 'text-white font-bold' : 'text-gray-300') + ' rounded" data-tip="' +
                    esc(pred.home_team) + ' ' + h + ' – ' + a + ' ' + esc(pred.away_team) + ': ' + (v * 100).toFixed(1) + '%">' + (v * 100).toFixed(1) + '</td>';
            }
            rows += '</tr>';
        }
        var heat =
            '<details class="group">' +
                '<summary class="cursor-pointer text-xs font-bold text-gray-300 uppercase tracking-wider mb-3 list-none flex items-center gap-2 hover:text-activeRed">' +
                    '<i class="fa-solid fa-chevron-right text-[10px] transition-transform group-open:rotate-90" aria-hidden="true"></i> Full scoreline grid (0–5 goals)</summary>' +
                '<div class="overflow-x-auto"><table class="score-grid border-separate border-spacing-[2px] mx-auto">' +
                    '<caption class="text-[11px] text-gray-400 pb-2">Probability (%) of each exact score. Rows: ' + esc(pred.home_team) + ' goals; columns: ' + esc(pred.away_team) + ' goals.</caption>' +
                    '<thead><tr><th></th>' + [0, 1, 2, 3, 4, 5].map(function (n) { return '<th scope="col" class="text-[11px] text-gray-400 font-semibold">' + n + '</th>'; }).join('') + '</tr></thead>' +
                    '<tbody>' + rows + '</tbody></table></div>' +
            '</details>';

        panel.innerHTML = xgHtml + topHtml + heat +
            '<p class="text-[11px] text-gray-400 mt-4">Calculated in your browser from the Poisson model’s expected goals, treating each team’s goals as independent. Scores up to 5–5 cover ' + (covered * 100).toFixed(1) + '% of all outcomes. Because of that simplification, these scores can differ slightly from the headline model.</p>';
    }

    function renderForm() {
        var f = state.form, panel = $('formPanel'), pred = state.prediction;
        if (!f || f.error) {
            panel.innerHTML = '<p class="text-sm text-gray-400">Recent form isn’t available right now' + (f && f.error ? ' (' + esc(f.error) + ')' : '') + '.</p>';
            return;
        }
        function teamCol(side) {
            var t = f[side];
            if (!t || !t.matches || !t.matches.length) return '<div><h3 class="font-bold text-white mb-2">' + esc(side === 'home' ? pred.home_team : pred.away_team) + '</h3><p class="text-sm text-gray-400">No recent matches found.</p></div>';
            var pts = t.matches.reduce(function (s, m) { return s + (m.result === 'W' ? 3 : m.result === 'D' ? 1 : 0); }, 0);
            var badges = t.matches.map(function (m) {
                var word = m.result === 'W' ? 'Win' : m.result === 'D' ? 'Draw' : 'Loss';
                return '<span class="form-badge form-' + m.result + '" title="' + word + ' ' + m.goals_for + '–' + m.goals_against + ' vs ' + esc(m.opponent) + '"><span aria-hidden="true">' + m.result + '</span><span class="sr-only-custom">' + word + '</span></span>';
            }).join('');
            var rows = t.matches.map(function (m) {
                return '<li class="flex items-center justify-between gap-3 py-1.5 border-b border-sportBorder/50 text-xs">' +
                    '<span class="text-gray-400 tabular w-16 shrink-0">' + esc(fmtShortDate(m.date)) + '</span>' +
                    '<span class="flex-1 text-gray-200 truncate">' + (m.venue === 'H' ? 'vs ' : '@ ') + esc(m.opponent) + '</span>' +
                    '<span class="font-bold tabular ' + (m.result === 'W' ? 'text-emerald-400' : m.result === 'L' ? 'text-red-400' : 'text-gray-300') + '">' + m.goals_for + '–' + m.goals_against + '</span></li>';
            }).join('');
            return '<div>' +
                '<div class="flex items-baseline justify-between gap-2 mb-2"><h3 class="font-bold text-white">' + esc(t.team) + '</h3><span class="text-xs text-gray-400">' + pts + ' pts from ' + t.matches.length + '</span></div>' +
                '<div class="flex gap-1.5 mb-1" role="list" aria-label="Last ' + t.matches.length + ' results, most recent first">' + badges.replace(/<span class="form-badge/g, '<span role="listitem" class="form-badge') + '</div>' +
                '<p class="text-[10px] text-gray-400 uppercase tracking-wider mb-3">Most recent first</p>' +
                '<ul>' + rows + '</ul></div>';
        }
        var h2h = (f.head_to_head || []);
        var tally = { home: 0, draw: 0, away: 0 };
        h2h.forEach(function (m) {
            if (m.home_goals === m.away_goals) tally.draw++;
            else {
                var winner = m.home_goals > m.away_goals ? m.home_team : m.away_team;
                if (winner === pred.home_team) tally.home++; else tally.away++;
            }
        });
        var h2hHtml = '<div>' +
            '<h3 class="font-bold text-white mb-2">Head-to-head</h3>' +
            (h2h.length
                ? '<p class="text-xs text-gray-400 mb-3">' + esc(pred.home_team) + ' <strong class="text-white">' + tally.home + '</strong> · Draws <strong class="text-white">' + tally.draw + '</strong> · ' + esc(pred.away_team) + ' <strong class="text-white">' + tally.away + '</strong></p>' +
                  '<ul>' + h2h.map(function (m) {
                      return '<li class="grid grid-cols-[4rem_1fr_auto_1fr] items-center gap-2 py-1.5 border-b border-sportBorder/50 text-xs">' +
                          '<span class="text-gray-400 tabular">' + esc(fmtShortDate(m.date)) + '</span>' +
                          '<span class="text-right text-gray-200 truncate">' + esc(m.home_team) + '</span>' +
                          '<span class="font-bold text-white tabular px-1">' + m.home_goals + '–' + m.away_goals + '</span>' +
                          '<span class="text-gray-200 truncate">' + esc(m.away_team) + '</span></li>';
                  }).join('') + '</ul>'
                : '<p class="text-sm text-gray-400">No previous meetings in the data.</p>') +
            '</div>';

        panel.innerHTML =
            (f.illustrative ? '<p class="mb-5 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2"><i class="fa-solid fa-flask mr-1" aria-hidden="true"></i><strong>Illustrative demo results, not real match history.</strong> Connect the backend (<code>/api/form/</code>) to show actual results from matches.csv.</p>' : '') +
            '<div class="grid grid-cols-1 md:grid-cols-3 gap-8">' + teamCol('home') + teamCol('away') + h2hHtml + '</div>';
    }

    // ======================================================================
    // Fixture browser
    // ======================================================================
    async function loadFixtures(initial) {
        var list = $('fixtureList');
        try {
            var params = { season: $('fxSeason').value || undefined, league: $('fxLeague').value || undefined };
            var res = await API.getFixtures(params);
            if (initial || !$('fxSeason').options.length) {
                $('fxSeason').innerHTML = (res.seasons || []).map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('') || '<option value="">All seasons</option>';
                if (initial && res.seasons && res.seasons.length && !params.season) {
                    // reload filtered to the latest season
                    $('fxSeason').value = res.seasons[0];
                    res.fixtures = res.fixtures.filter(function (f) { return f.season === res.seasons[0]; });
                }
            }
            state.fixtures = res.fixtures || [];
            var dates = Array.from(new Set(state.fixtures.map(function (f) { return f.date; }))).sort();
            var keep = $('fxDate').value;
            $('fxDate').innerHTML = '<option value="">All dates</option>' + dates.map(function (d) { return '<option value="' + d + '">' + esc(fmtShortDate(d)) + '</option>'; }).join('');
            if (dates.indexOf(keep) !== -1) $('fxDate').value = keep;
            renderFixtures();
        } catch (err) {
            list.innerHTML = '<p class="text-sm text-red-300" role="alert"><i class="fa-solid fa-triangle-exclamation mr-1" aria-hidden="true"></i>Could not load fixtures: ' + esc(err.message) + '</p>';
            $('fxCount').textContent = '';
        }
    }

    function renderFixtures() {
        var date = $('fxDate').value;
        var items = state.fixtures.filter(function (f) { return !date || f.date === date; })
            .sort(function (a, b) { return a.date.localeCompare(b.date) || a.league.localeCompare(b.league); });
        $('fxCount').textContent = items.length + ' fixture' + (items.length === 1 ? '' : 's');
        if (!items.length) { $('fixtureList').innerHTML = '<p class="text-sm text-gray-400">No fixtures match these filters.</p>'; return; }
        var groups = {};
        items.forEach(function (f) { (groups[f.date] = groups[f.date] || []).push(f); });
        var current = state.prediction && state.prediction.fixture ? state.prediction.fixture.id : null;
        $('fixtureList').innerHTML = Object.keys(groups).map(function (d) {
            return '<div><h3 class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 sticky top-0 bg-[#16181d] py-1 z-10">' + esc(fmtDate(d)) + '</h3><ul class="space-y-2">' +
                groups[d].map(function (f) {
                    var on = f.id === current;
                    return '<li><button type="button" data-fixture="' + esc(f.id) + '" aria-pressed="' + on + '" class="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ' +
                        (on ? 'border-activeRed bg-activeRed/10' : 'border-sportBorder bg-sportCard hover:border-activeRed/60') + '">' +
                        '<span class="shrink-0 w-10 text-center text-[10px] font-black text-activeRed bg-activeRed/10 border border-activeRed/30 rounded px-1 py-0.5">' + esc(f.league) + '</span>' +
                        '<span class="flex-1 min-w-0 text-sm text-white font-semibold truncate">' + esc(f.home_team) + ' <span class="text-gray-400 font-normal">vs</span> ' + esc(f.away_team) + '</span>' +
                        '<i class="fa-solid fa-chevron-right text-xs text-gray-500" aria-hidden="true"></i></button></li>';
                }).join('') + '</ul></div>';
        }).join('');
    }

    async function loadFixture(id) {
        var f = state.fixtures.filter(function (x) { return x.id === id; })[0];
        if (!f) return;
        await selectLeague(f.league);
        homeBox.setValue(f.home_team); awayBox.setValue(f.away_team); syncExclusions();
        clearFieldErrors();
        await runPrediction({ league: f.league, home: f.home_team, away: f.away_team, fixtureId: f.id });
        renderFixtures();
    }

    // ======================================================================
    // Model performance
    // ======================================================================
    var METRIC_INFO = {
        accuracy: { label: 'Accuracy', lowerBetter: false, fmt: function (v) { return (v * 100).toFixed(1) + '%'; } },
        log_loss: { label: 'Log loss', lowerBetter: true, fmt: function (v) { return v.toFixed(4); } },
        brier: { label: 'Brier score', lowerBetter: true, fmt: function (v) { return v.toFixed(4); } },
        rps: { label: 'RPS', lowerBetter: true, fmt: function (v) { return v.toFixed(4); } }
    };

    async function loadPerformance() {
        try {
            state.perf = await API.getModelPerformance();
            renderPerformance();
        } catch (err) {
            $('perfBody').innerHTML = '<tr><td colspan="5" class="py-6 text-center text-red-300" role="alert">Could not load model performance: ' + esc(err.message) + '</td></tr>';
        }
    }

    function renderPerformance() {
        var set = state.perf[state.perfSet];
        if (!set) return;
        document.querySelectorAll('#perfTabs [role="tab"]').forEach(function (t) {
            var on = t.getAttribute('data-set') === state.perfSet;
            t.setAttribute('aria-selected', String(on));
            t.tabIndex = on ? 0 : -1;
            t.className = 'px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider border transition-colors ' +
                (on ? 'bg-ctaRed border-ctaRed text-white shadow-red-glow' : 'bg-sportCard border-sportBorder text-gray-300 hover:text-white hover:border-gray-500');
            if (on) $('perfPanel').setAttribute('aria-labelledby', t.id);
        });
        $('perfCaption').textContent = set.label + ' season ' + set.season + ' · ' + set.n_matches.toLocaleString() + ' matches the models never saw during training';

        var models = set.rows.filter(function (r) { return r.kind === 'model'; });
        var best = {};
        Object.keys(METRIC_INFO).forEach(function (k) {
            var vals = models.map(function (r) { return r[k]; }).filter(function (v) { return v != null; });
            best[k] = METRIC_INFO[k].lowerBetter ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
        });

        $('perfBody').innerHTML = set.rows.map(function (r) {
            var tag = r.kind === 'benchmark' ? '<span class="ml-2 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">Benchmark</span>'
                : r.kind === 'baseline' ? '<span class="ml-2 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-300 border border-gray-500/30">Baseline</span>' : '';
            var selectable = r.kind === 'model' && MODELS.some(function (m) { return m.key === r.key; });
            var name = esc(r.model) + (r.note ? '<span class="block text-[10px] text-gray-400">' + esc(r.note) + '</span>' : '');
            function cell(k) {
                var v = r[k];
                if (v == null) return '<td class="py-2.5 px-2 text-right text-gray-500">—</td>';
                var isBest = r.kind === 'model' && v === best[k];
                return '<td class="py-2.5 px-2 text-right ' + (isBest ? 'text-white font-bold' : r.kind === 'model' ? 'text-gray-200' : 'text-gray-400') + '">' +
                    (isBest ? '<span class="text-activeRed mr-1" aria-label="best">★</span>' : '') + METRIC_INFO[k].fmt(v) + '</td>';
            }
            return '<tr class="border-b border-sportBorder/60 ' + (r.kind !== 'model' ? 'bg-black/20' : '') + '">' +
                '<th scope="row" class="py-2.5 pr-2 text-left font-semibold ' + (r.kind === 'model' ? 'text-white' : 'text-gray-300') + '">' + name + tag +
                (selectable && r.key === DEFAULT_MODEL ? '<span class="ml-2 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-activeRed/15 text-activeRed border border-activeRed/30">Default</span>' : '') + '</th>' +
                cell('log_loss') + cell('brier') + cell('rps') + cell('accuracy') + '</tr>';
        }).join('');

        renderPerfChart();
        renderTakeaway();
    }

    function renderPerfChart() {
        var set = state.perf[state.perfSet];
        var metric = $('chartMetric').value;
        var info = METRIC_INFO[metric];
        $('chartTitle').textContent = info.label + (info.lowerBetter ? ' (lower is better)' : ' (higher is better)');
        var rows = set.rows.filter(function (r) { return r[metric] != null; });
        rows.sort(function (a, b) { return info.lowerBetter ? a[metric] - b[metric] : b[metric] - a[metric]; });

        var W = 100; // percentage-based layout
        var html = '';
        if (metric === 'accuracy') {
            // Bars from zero
            rows.forEach(function (r) {
                var w = r[metric] / 0.6 * W;
                var color = r.kind === 'model' ? (r.key === DEFAULT_MODEL ? '#ff1744' : '#ff5c7a') : r.kind === 'benchmark' ? '#7dd3fc' : '#6b7280';
                html += '<div class="grid grid-cols-[minmax(0,9.5rem)_1fr_3.2rem] items-center gap-2 py-1" data-tip="' + esc(r.model) + ': ' + info.fmt(r[metric]) + '">' +
                    '<span class="text-[11px] text-gray-300 truncate">' + esc(r.model) + '</span>' +
                    '<span class="relative h-3"><span class="absolute inset-y-0 left-0 rounded-r" style="width:' + Math.min(100, w).toFixed(1) + '%;background:' + color + '"></span></span>' +
                    '<span class="text-[11px] text-gray-200 text-right tabular">' + info.fmt(r[metric]) + '</span></div>';
            });
            html += '<div class="grid grid-cols-[minmax(0,9.5rem)_1fr_3.2rem] gap-2 mt-1"><span></span><span class="flex justify-between text-[10px] text-gray-500 tabular border-t border-sportBorder pt-1"><span>0%</span><span>20%</span><span>40%</span><span>60%</span></span><span></span></div>';
            $('chartNote').textContent = 'Always picking the home side is right 42.0% of the time. Every model clears that, and the bookmakers set the ceiling.';
        } else {
            // Dot plot: axis need not start at zero for dots
            var vals = rows.map(function (r) { return r[metric]; });
            var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
            var pad = (hi - lo) * 0.08 || 0.01;
            lo -= pad; hi += pad;
            rows.forEach(function (r) {
                var x = (r[metric] - lo) / (hi - lo) * 100;
                var color = r.kind === 'model' ? (r.key === DEFAULT_MODEL ? '#ff1744' : '#ff5c7a') : r.kind === 'benchmark' ? '#7dd3fc' : '#9ca3af';
                html += '<div class="grid grid-cols-[minmax(0,9.5rem)_1fr_3.6rem] items-center gap-2 py-1" data-tip="' + esc(r.model) + ': ' + info.fmt(r[metric]) + '">' +
                    '<span class="text-[11px] text-gray-300 truncate">' + esc(r.model) + '</span>' +
                    '<span class="relative h-3"><span class="absolute inset-x-0 top-1/2 h-px bg-sportBorder"></span>' +
                    '<span class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full ring-2 ring-[#16181d]" style="left:' + x.toFixed(1) + '%;background:' + color + '"></span></span>' +
                    '<span class="text-[11px] text-gray-200 text-right tabular">' + info.fmt(r[metric]) + '</span></div>';
            });
            html += '<div class="grid grid-cols-[minmax(0,9.5rem)_1fr_3.6rem] gap-2 mt-1"><span></span><span class="flex justify-between text-[10px] text-gray-500 tabular border-t border-sportBorder pt-1"><span>' + lo.toFixed(3) + '</span><span>' + hi.toFixed(3) + '</span></span><span></span></div>';
            $('chartNote').textContent = 'Axis is zoomed in (it does not start at zero) so the small but real gaps between models are visible. Leftmost is best.';
        }
        html += '<div class="flex flex-wrap gap-4 text-[10px] text-gray-400 mt-3">' +
            '<span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background:#ff5c7a" aria-hidden="true"></span>Our models</span>' +
            '<span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background:#ff1744" aria-hidden="true"></span>Default model</span>' +
            '<span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background:#7dd3fc" aria-hidden="true"></span>Bookmakers</span>' +
            '<span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background:#9ca3af" aria-hidden="true"></span>Baselines</span></div>';
        $('perfChart').innerHTML = '<div role="img" aria-label="' + esc(info.label) + ' by model; the table on this page holds the same numbers.">' + html + '</div>';
    }

    function renderTakeaway() {
        var v = state.perf.validation, t = state.perf.test;
        function row(set, key) { return (set.rows.filter(function (r) { return r.key === key; })[0]) || {}; }
        var lrT = row(t, 'logistic_regression'), bookT = row(t, 'bookmakers'), hist = row(v, 'hist_freq'), home = row(v, 'always_home');
        $('perfTakeaway').innerHTML =
            '<strong class="text-white"><i class="fa-solid fa-lightbulb text-activeRed mr-1" aria-hidden="true"></i>What this means:</strong> ' +
            'our models pick the right result about <strong class="text-white">52–54%</strong> of the time, against <strong class="text-white">' + (home.accuracy * 100).toFixed(0) + '%</strong> for "always back the home side", and their log loss (≈0.98–1.00) is well below the ' + hist.log_loss.toFixed(3) + ' you get from historical frequencies alone. ' +
            'The bookmakers are still slightly sharper (log loss ' + bookT.log_loss.toFixed(3) + ' vs ' + lrT.log_loss.toFixed(3) + ' for Logistic Regression on the 2025/26 test). They see team news, injuries and market money that our models don’t.';
    }

    // ======================================================================
    // Chart hover tooltips (any element with data-tip)
    // ======================================================================
    function initTooltips() {
        var tip = $('chartTip');
        document.addEventListener('mousemove', function (e) {
            var el = e.target.closest && e.target.closest('[data-tip]');
            if (!el) { tip.classList.add('hidden'); return; }
            tip.textContent = el.getAttribute('data-tip');
            tip.classList.remove('hidden');
            var x = e.clientX + 14, y = e.clientY + 14;
            var r = tip.getBoundingClientRect();
            if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
            if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 14;
            tip.style.left = x + 'px'; tip.style.top = y + 'px';
        });
        document.addEventListener('scroll', function () { tip.classList.add('hidden'); }, { passive: true });
    }

    // ======================================================================
    // Init
    // ======================================================================
    async function init() {
        homeBox = Combobox($('homeTeam'), function () { syncExclusions(); setFieldError('home'); });
        awayBox = Combobox($('awayTeam'), function () { syncExclusions(); setFieldError('away'); });

        var q = new URLSearchParams(location.search);
        var qModel = q.get('model');
        if (qModel && MODELS.some(function (m) { return m.key === qModel; })) state.model = qModel;
        renderModelSelect();
        initTooltips();

        $('modelSelect').addEventListener('change', function () {
            state.model = this.value;
            if (state.prediction) { renderResultCard(); renderComparison(); if (state.lastRequest) updateUrl(state.lastRequest); }
        });
        $('compareBody').addEventListener('click', function (e) {
            var b = e.target.closest('[data-model]');
            if (!b || b.disabled) return;
            state.model = b.getAttribute('data-model');
            $('modelSelect').value = state.model;
            renderResultCard(); renderComparison();
            if (state.lastRequest) updateUrl(state.lastRequest);
        });
        $('swapBtn').addEventListener('click', function () {
            var h = homeBox.getValue(), a = awayBox.getValue();
            homeBox.setExcluded(null); awayBox.setExcluded(null);
            homeBox.setValue(a); awayBox.setValue(h); syncExclusions(); clearFieldErrors();
        });
        $('predictForm').addEventListener('submit', function (e) {
            e.preventDefault();
            var v = validate();
            if (v) runPrediction({ league: state.league, home: v.home, away: v.away });
        });
        $('retryBtn').addEventListener('click', function () { if (state.lastRequest) runPrediction(state.lastRequest); });
        $('fixtureList').addEventListener('click', function (e) {
            var b = e.target.closest('[data-fixture]');
            if (b) loadFixture(b.getAttribute('data-fixture'));
        });
        $('fxSeason').addEventListener('change', function () { $('fxDate').value = ''; loadFixtures(false); });
        $('fxLeague').addEventListener('change', function () { loadFixtures(false); });
        $('fxDate').addEventListener('change', renderFixtures);
        $('chartMetric').addEventListener('change', function () { if (state.perf) renderPerfChart(); });
        var tabs = document.querySelectorAll('#perfTabs [role="tab"]');
        tabs.forEach(function (t, i) {
            t.addEventListener('click', function () { state.perfSet = t.getAttribute('data-set'); if (state.perf) renderPerformance(); });
            t.addEventListener('keydown', function (e) {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                next.focus(); next.click();
            });
        });

        // Leagues first: this request also decides live vs demo mode.
        try {
            var res = await API.getLeagues();
            state.leagues = res.leagues || [];
            state.leagues.forEach(function (l) { state.leagueNames[l.code] = l.name; });
            renderLeagues();
        } catch (err) {
            $('leagueGroup').innerHTML = '<p class="col-span-3 text-sm text-red-300" role="alert">Could not load leagues: ' + esc(err.message) + '</p>';
            showFormError('The predictor can’t start because the league list failed to load.');
            loadPerformance();
            return;
        }

        loadFixtures(true);
        loadPerformance();

        var qLeague = q.get('league');
        var startLeague = state.leagueNames[qLeague] ? qLeague : (state.leagues[0] && state.leagues[0].code);
        if (startLeague) await selectLeague(startLeague);
        var qh = q.get('home'), qa = q.get('away');
        if (qLeague && qh && qa && state.teams.indexOf(qh) !== -1 && state.teams.indexOf(qa) !== -1 && qh !== qa) {
            homeBox.setValue(qh); awayBox.setValue(qa); syncExclusions();
            runPrediction({ league: qLeague, home: qh, away: qa, fixtureId: q.get('fixture') || undefined });
        }
    }

    init();
})();
