/* ScoreLine predictor page: "Pick two teams" + upcoming fixtures, built on predictions.json.
   Depends on js/competitions.js (SLCompetitions), js/probability.js (SLProb), js/api.js (ScoreLineAPI). */
(function () {
    'use strict';

    var API = window.ScoreLineAPI;
    var P = window.SLProb;
    var C = window.SLCompetitions;

    var OUTCOME_LABEL = { home: 'Home win', draw: 'Draw', away: 'Away win' };
    var DEFAULT_LEAGUE = 'PL';
    var PAGE_SIZE = 6;

    var state = {
        data: null,
        league: null,        // league picked in the form
        fxComp: DEFAULT_LEAGUE,
        q: '',
        fxLimit: PAGE_SIZE,
        showPlayed: false,
        requestId: 0
    };

    var $ = function (id) { return document.getElementById(id); };

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function fold(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
    function prefersReducedMotion() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }

    // ======================================================================
    // Dates (user's local time zone)
    // ======================================================================
    function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
    function dayKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
    function fmtTime(d) { return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
    function fmtDay(d) { return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
    function fmtKickoff(d) {
        return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + ', ' +
            d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    }
    function dayHeading(d) {
        var diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
        var rel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : '';
        return (rel ? rel + ' · ' : '') + fmtDay(d);
    }
    function hasKickedOff(p) { return p.kickoff.getTime() <= Date.now(); }

    // ======================================================================
    // Flags -> plain English
    // ======================================================================
    function explainFlag(flag) {
        var i = flag.indexOf(':');
        var type = i === -1 ? flag : flag.slice(0, i);
        var value = i === -1 ? '' : flag.slice(i + 1).trim();
        if (type === 'unknown_team') {
            return (value || 'One team') + ' has no match history in this league in our data (for example, a newly promoted club), so its strength rating starts from a default value.';
        }
        if (type === 'history_ends') {
            var d = new Date(value + 'T00:00:00Z');
            var when = isNaN(d) ? value : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
            return 'The results data ends on ' + when + ', more than three weeks before this match, so recent form is missing.';
        }
        return 'The model flagged the data behind this prediction (' + flag + ').';
    }

    // ======================================================================
    // Accessible combobox (ARIA 1.2 pattern), recovered from the original "Build a match" form
    // ======================================================================
    function Combobox(input, onChange) {
        var wrap = input.parentElement;
        var list = wrap.querySelector('[role="listbox"]');
        var toggle = wrap.querySelector('[data-combo-toggle]');
        var options = [], excluded = null, active = -1, value = '';

        function exactMatch() {
            var q = input.value.trim().toLowerCase();
            return options.filter(function (o) { return o.toLowerCase() === q; })[0] || '';
        }
        function filtered() {
            var q = fold(input.value.trim());
            if (q && exactMatch()) q = ''; // exact match: show everything
            return options.filter(function (o) { return !q || fold(o).indexOf(q) !== -1; });
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
                    (dis ? ' aria-disabled="true" title="A team can’t play itself"' : '') + '>' + esc(o) + (dis ? ' <span class="text-[10px] uppercase">(other side)</span>' : '') + '</li>';
            }).join('');
            if (active >= 0) {
                input.setAttribute('aria-activedescendant', list.id + '-opt-' + active);
                var el = $(list.id + '-opt-' + active);
                if (el) el.scrollIntoView({ block: 'nearest' });
            } else input.removeAttribute('aria-activedescendant');
        }
        function open() { if (!options.length || input.disabled) return; list.classList.remove('hidden'); input.setAttribute('aria-expanded', 'true'); render(); }
        function close() { list.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
        function commit(v) {
            if (v === excluded) return;
            value = v; input.value = v; close(); onChange();
        }
        function resolveTyped() {
            var match = exactMatch();
            if (match) { value = match; input.value = match; } else value = '';
            onChange();
            return value;
        }

        input.addEventListener('input', function () { value = ''; active = 0; open(); onChange(); });
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
        list.addEventListener('mousedown', function (e) { e.preventDefault(); });
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
            /** Current team without side effects: the committed value, or an exact typed match */
            peek: function () { return value || exactMatch(); },
            setValue: function (v) {
                var m = options.filter(function (o) { return o.toLowerCase() === String(v || '').toLowerCase(); })[0] || '';
                value = m; input.value = m;
            },
            input: input
        };
    }

    var homeBox, awayBox;

    // ======================================================================
    // League & teams
    // ======================================================================
    function renderLeagueChips() {
        $('leagueGroup').innerHTML = C.list.map(function (c) {
            return '<label class="shrink-0 cursor-pointer">' +
                '<input type="radio" name="league" value="' + esc(c.code) + '" class="peer sr-only-custom">' +
                '<span class="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-sportBorder bg-sportCard text-gray-300 text-xs font-bold uppercase tracking-wide whitespace-nowrap transition-colors ' +
                'peer-checked:border-activeRed peer-checked:text-white peer-checked:bg-activeRed/15 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-activeRed hover:border-gray-500">' +
                '<span class="w-2 h-2 rounded-full" style="background:' + esc(c.color) + '" aria-hidden="true"></span>' + esc(c.name) + '</span></label>';
        }).join('');
    }

    async function selectLeague(code) {
        state.league = code;
        var radio = document.querySelector('input[name="league"][value="' + code + '"]');
        if (radio) radio.checked = true;
        var teams = await API.getTeams(code);
        if (state.league !== code) return;
        homeBox.setOptions(teams); awayBox.setOptions(teams);
        homeBox.input.disabled = awayBox.input.disabled = !teams.length;
        homeBox.input.placeholder = teams.length ? 'Search home team…' : 'No teams in the predictions file';
        awayBox.input.placeholder = teams.length ? 'Search away team…' : 'No teams in the predictions file';
        clearFieldErrors();
        syncForm();
    }

    /** Keep exclusions and the Predict button in step with the pickers */
    function syncForm() {
        if (!homeBox) return;
        var h = homeBox.peek(), a = awayBox.peek();
        homeBox.setExcluded(a); awayBox.setExcluded(h);
        var ready = !!(state.league && h && a && h !== a);
        $('predictBtn').disabled = !ready;
        $('predictHint').textContent = !h || !a ? 'Pick both teams to see the prediction.'
            : h === a ? 'A team can’t play itself. Choose a different away team.' : '';
        $('predictHint').classList.toggle('hidden', ready);
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
        var h = homeBox.peek(), a = awayBox.peek();
        if (!h) { setFieldError('home', homeBox.input.value ? 'Pick a team from the list.' : 'Choose a home team.'); ok = false; }
        if (!a) { setFieldError('away', awayBox.input.value ? 'Pick a team from the list.' : 'Choose an away team.'); ok = false; }
        if (h && a && h === a) { setFieldError('away', 'A team can’t play itself. Choose a different away team.'); ok = false; }
        if (!ok) {
            var firstBad = document.querySelector('#predictForm [aria-invalid="true"]');
            if (firstBad) firstBad.focus();
        }
        return ok ? { league: state.league, home: h, away: a } : null;
    }

    // ======================================================================
    // Prediction flow
    // ======================================================================
    async function runPrediction(req, opts) {
        opts = opts || {};
        var id = ++state.requestId;
        var region = $('resultRegion');
        region.setAttribute('aria-busy', 'true');
        try {
            var res = await API.getMatchupPrediction(req.league, req.home, req.away);
            if (id !== state.requestId) return;
            renderResult(res, req);
            updateUrl(req);
        } catch (err) {
            if (id !== state.requestId) return;
            region.innerHTML = '<div class="rounded-3xl bg-activeRed/10 border border-activeRed/40 p-6 text-center" role="alert">' +
                '<p class="text-sm text-gray-200">' + esc(err.message || 'Something went wrong while looking up the prediction.') + '</p></div>';
        } finally {
            if (id === state.requestId) region.setAttribute('aria-busy', 'false');
        }
        if (opts.scroll !== false) {
            var top = region.getBoundingClientRect().top;
            if (top < 0 || top > window.innerHeight * 0.6) region.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
        }
        var title = $('resultTitle');
        if (title && opts.focus !== false) title.focus({ preventScroll: true });
    }

    function updateUrl(req) {
        try {
            var q = new URLSearchParams(location.search);
            q.set('league', req.league); q.set('home', req.home); q.set('away', req.away);
            history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash);
        } catch (e) { /* ignore */ }
    }

    /** Fill the form with a fixture and show its prediction */
    async function loadFixture(p, opts) {
        if (state.league !== p.competition) await selectLeague(p.competition);
        homeBox.setValue(p.home_team); awayBox.setValue(p.away_team);
        clearFieldErrors(); syncForm();
        await runPrediction({ league: p.competition, home: p.home_team, away: p.away_team }, opts);
    }

    function swapTeams() {
        var h = homeBox.peek(), a = awayBox.peek();
        homeBox.setExcluded(null); awayBox.setExcluded(null);
        homeBox.setValue(a); awayBox.setValue(h);
        clearFieldErrors(); syncForm();
    }

    // ======================================================================
    // Result rendering
    // ======================================================================
    function teamName(p, key) { return key === 'home' ? p.home_team : p.away_team; }
    function pickText(p, pct, pick) { return pick === 'draw' ? 'Draw – ' + pct.draw + '%' : teamName(p, pick) + ' win – ' + pct[pick] + '%'; }

    var TONE_CLS = {
        strong: 'bg-activeRed/15 border-activeRed/50 text-white',
        medium: 'bg-amber-500/10 border-amber-500/40 text-amber-200',
        neutral: 'bg-gray-500/15 border-gray-500/50 text-gray-200'
    };

    function versus(home, away) {
        // On phones, names with a long single word (e.g. "Strasbourg", "Monchengladbach") get a smaller size
        var longest = Math.max.apply(null, (home + ' ' + away).split(/\s+/).map(function (w) { return w.length; }));
        var cls = (longest >= 10 ? 'text-base' : longest >= 8 ? 'text-lg' : 'text-xl') + ' sm:text-4xl';
        return '<h3 id="resultTitle" tabindex="-1" class="grid grid-cols-[1fr_auto_1fr] items-center gap-3 focus:outline-none">' +
            '<span class="text-right min-w-0"><span class="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Home</span><span class="block ' + cls + ' font-black text-white uppercase italic leading-tight [overflow-wrap:break-word] [hyphens:auto]">' + esc(home) + '</span></span>' +
            '<span class="text-activeRed font-teko text-2xl sm:text-3xl" aria-label="versus">VS</span>' +
            '<span class="text-left min-w-0"><span class="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Away</span><span class="block ' + cls + ' font-black text-white uppercase italic leading-tight [overflow-wrap:break-word] [hyphens:auto]">' + esc(away) + '</span></span>' +
        '</h3>';
    }

    function renderFound(p) {
        var pct = P.toPercents(p.probs);
        var pick = P.mostLikely(p.probs);
        var conf = P.confidence(p.probs);
        var played = hasKickedOff(p);
        var comp = C.get(p.competition);

        function seg(cls, key) {
            var w = pct[key];
            return '<div class="' + cls + '" style="width:' + Math.max(w, 0.0001) + '%">' + (w >= 9 ? w + '%' : '') + '</div>';
        }
        function box(key) {
            var isPick = key === pick;
            var swatch = key === 'home' ? 'bg-outHome' : key === 'draw' ? 'bg-outDraw' : 'bg-outAway';
            return '<div class="relative rounded-2xl p-3 sm:p-4 text-center border ' + (isPick ? 'border-activeRed bg-activeRed/10 shadow-red-glow' : 'border-sportBorder bg-sportCard') + '">' +
                (isPick ? '<span class="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-ctaRed text-white text-[9px] font-black uppercase tracking-widest whitespace-nowrap">Most likely</span>' : '') +
                '<div class="flex items-center justify-center gap-1.5 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-gray-300"><span class="w-2.5 h-2.5 rounded-sm ' + swatch + '" aria-hidden="true"></span>' + OUTCOME_LABEL[key] + '</div>' +
                '<div class="font-teko text-4xl sm:text-6xl leading-none mt-2 ' + (isPick ? 'text-white' : 'text-gray-200') + ' tabular">' + pct[key] + '<span class="text-xl sm:text-2xl text-gray-400">%</span></div>' +
                '<div class="text-[11px] text-gray-400 mt-1 truncate">' + (key === 'draw' ? 'Shared points' : esc(teamName(p, key))) + '</div>' +
            '</div>';
        }

        var flags = p.flags.length
            ? '<div class="mt-6 rounded-2xl bg-amber-500/10 border border-amber-500/40 p-4">' +
                '<p class="flex items-center gap-2 text-amber-300 text-xs font-bold uppercase tracking-wider mb-1.5"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> Limited data</p>' +
                p.flags.map(function (f) { return '<p class="text-sm text-gray-200 leading-relaxed">' + esc(explainFlag(f)) + '</p>'; }).join('') +
                '<p class="text-xs text-gray-400 mt-1.5">The prediction is still shown, but treat it with extra caution.</p></div>'
            : '';

        return '<article class="glass-panel-active rounded-3xl p-5 sm:p-8" aria-labelledby="resultTitle">' +
            '<p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400 font-semibold mb-5">' +
                '<span class="inline-flex items-center gap-1.5 text-gray-200 uppercase tracking-wider"><span class="w-2 h-2 rounded-full" style="background:' + esc(comp.color) + '" aria-hidden="true"></span>' + esc(comp.name) + '</span>' +
                '<span aria-hidden="true">·</span><time datetime="' + esc(p.kickoff.toISOString()) + '">' + esc(fmtKickoff(p.kickoff)) + '</time>' +
                (played ? '<span class="ml-1 px-2 py-0.5 rounded-full bg-gray-500/20 border border-gray-500/40 text-gray-300 text-[10px] font-bold uppercase tracking-wider" title="Kickoff time has passed. Results aren’t part of the predictions file.">Played</span>' : '') +
            '</p>' +
            '<div class="mb-6">' + versus(p.home_team, p.away_team) + '</div>' +
            '<div class="prob-bar" aria-hidden="true">' + seg('seg-home', 'home') + seg('seg-draw', 'draw') + seg('seg-away', 'away') + '</div>' +
            '<p class="sr-only-custom">' + esc(p.home_team) + ' win ' + pct.home + ' percent, draw ' + pct.draw + ' percent, ' + esc(p.away_team) + ' win ' + pct.away + ' percent.</p>' +
            '<div class="flex justify-between text-[10px] uppercase tracking-wider text-gray-400 mt-1.5 mb-7" aria-hidden="true"><span class="truncate">' + esc(p.home_team) + '</span><span>Draw</span><span class="truncate text-right">' + esc(p.away_team) + '</span></div>' +
            '<div class="grid grid-cols-3 gap-2 sm:gap-4">' + box('home') + box('draw') + box('away') + '</div>' +
            '<div class="mt-6 flex flex-wrap items-center justify-between gap-3">' +
                '<p class="text-base font-bold text-white">' + esc(pickText(p, pct, pick)) + '</p>' +
                '<span class="sl-tooltip">' +
                    '<span tabindex="0" aria-describedby="confTip" class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold uppercase tracking-wider ' + TONE_CLS[conf.tone] + '"><i class="fa-solid fa-gauge-high" aria-hidden="true"></i>' + esc(conf.label) + '</span>' +
                    '<span id="confTip" role="tooltip" class="sl-tooltip-panel" style="left:auto;right:0;transform:none;">' + esc(P.CONFIDENCE_RULE) + '</span>' +
                '</span>' +
            '</div>' +
            flags +
            '<p class="mt-6 text-[11px] text-gray-500">Percentages are rounded so they total exactly 100%.' + (p.match_id != null ? ' Match ID ' + esc(p.match_id) + '.' : '') + '</p>' +
        '</article>';
    }

    function noticePanel(icon, title, body) {
        return '<div class="glass-panel rounded-3xl border border-sportBorder p-5 sm:p-7">' +
            '<div class="flex items-start gap-4">' +
                '<div class="w-10 h-10 shrink-0 rounded-xl bg-activeRed/10 border border-activeRed/30 flex items-center justify-center text-activeRed" aria-hidden="true"><i class="fa-solid ' + icon + '"></i></div>' +
                '<div class="min-w-0 flex-1"><h3 id="resultTitle" tabindex="-1" class="text-lg font-black text-white uppercase italic tracking-tight focus:outline-none">' + title + '</h3>' + body + '</div>' +
            '</div></div>';
    }

    function renderResult(res, req) {
        var region = $('resultRegion');
        if (res.status === 'found') {
            region.innerHTML = renderFound(res.prediction);
            return;
        }
        if (res.status === 'reversed') {
            var r = res.prediction;
            region.innerHTML = noticePanel('fa-right-left', 'This fixture is the other way round',
                '<p class="text-sm text-gray-300 leading-relaxed mt-1">There’s no prediction for <strong class="text-white">' + esc(req.home) + '</strong> (home) vs <strong class="text-white">' + esc(req.away) + '</strong> (away). ' +
                'The scheduled fixture is <strong class="text-white">' + esc(r.home_team) + '</strong> at home to <strong class="text-white">' + esc(r.away_team) + '</strong>, ' + esc(fmtKickoff(r.kickoff)) + '.</p>' +
                '<button type="button" data-swap class="mt-4 px-5 py-2.5 bg-ctaRed hover:bg-ctaRedHover text-white font-bold rounded-xl uppercase tracking-wider text-xs inline-flex items-center gap-2"><i class="fa-solid fa-right-left" aria-hidden="true"></i> Swap teams to see it</button>');
            return;
        }
        var related = res.related || [];
        var upcoming = related.filter(function (p) { return !hasKickedOff(p); });
        var shown = upcoming.length ? upcoming : related;
        var listTitle = upcoming.length ? 'Upcoming fixtures for these teams' : (related.length ? 'These teams’ fixtures in the current file (already kicked off)' : '');
        region.innerHTML = noticePanel('fa-calendar-xmark', 'No prediction for this matchup yet',
            '<p class="text-sm text-gray-300 leading-relaxed mt-1">Our model predicts upcoming scheduled fixtures, and <strong class="text-white">' + esc(req.home) + '</strong> vs <strong class="text-white">' + esc(req.away) + '</strong> isn’t one of them right now. We don’t estimate numbers for matchups that aren’t scheduled.</p>' +
            (shown.length
                ? '<p class="text-xs font-bold text-gray-400 uppercase tracking-wider mt-5 mb-1">' + listTitle + '</p><ul class="divide-y divide-sportBorder/60 -mx-3">' + shown.map(function (p) { return rowHtml(p, { showDate: true }); }).join('') + '</ul>'
                : '<p class="text-sm text-gray-400 mt-4">Neither team has a fixture in the current predictions file.</p>'));
    }

    // ======================================================================
    // Fixture rows
    // ======================================================================
    function rowHtml(p, opts) {
        opts = opts || {};
        var pct = P.toPercents(p.probs);
        var pick = P.mostLikely(p.probs);
        var played = hasKickedOff(p);
        var favLabel = pick === 'draw' ? 'Draw' : teamName(p, pick);
        function team(key) {
            return '<span class="' + (pick === key ? 'text-white font-bold' : 'text-gray-300') + '">' + esc(teamName(p, key)) + '</span>';
        }
        var flag = p.flags.length
            ? ' <i class="fa-solid fa-circle-exclamation text-amber-400 text-[11px]" aria-hidden="true" title="Limited data"></i><span class="sr-only-custom">(limited data)</span>'
            : '';
        var meta = [];
        if (opts.showComp) meta.push(esc(C.get(p.competition).name));
        if (opts.showDate) meta.push(esc(fmtDay(p.kickoff)));
        if (played) meta.push('Played');

        return '<li><button type="button" data-key="' + esc(p.key) + '" class="w-full text-left grid grid-cols-[3rem_1fr_auto] sm:grid-cols-[3.5rem_1fr_6rem_3.5rem] items-center gap-x-3 gap-y-1.5 px-3 py-3.5 rounded-xl hover:bg-white/[0.04] focus-visible:bg-white/[0.04] transition-colors' + (played ? ' opacity-70' : '') + '">' +
            '<span class="text-sm text-gray-400 tabular">' + esc(fmtTime(p.kickoff)) + '</span>' +
            '<span class="min-w-0 text-sm leading-snug">' + team('home') + ' <span class="text-gray-500 text-xs">vs</span> ' + team('away') + flag +
                (meta.length ? '<span class="block text-[11px] text-gray-500 mt-0.5">' + meta.join(' · ') + '</span>' : '') + '</span>' +
            '<span class="hidden sm:flex mini-bar" aria-hidden="true"><span style="width:' + pct.home + '%"></span><span style="width:' + pct.draw + '%"></span><span style="width:' + pct.away + '%"></span></span>' +
            '<span class="text-right text-sm font-bold text-white tabular" title="' + esc(favLabel) + ' ' + pct[pick] + '%">' + pct[pick] + '%<span class="sr-only-custom"> ' + esc(pick === 'draw' ? 'draw most likely' : favLabel + ' to win') + '</span></span>' +
            // On phones the bar sits under the teams
            '<span class="sm:hidden col-start-2 col-span-2 mini-bar" aria-hidden="true"><span style="width:' + pct.home + '%"></span><span style="width:' + pct.draw + '%"></span><span style="width:' + pct.away + '%"></span></span>' +
        '</button></li>';
    }

    function groupedRows(list, opts) {
        var html = '', lastDay = null;
        list.forEach(function (p) {
            var k = dayKey(p.kickoff);
            if (k !== lastDay) {
                if (lastDay !== null) html += '</ul>';
                html += '<h3 class="text-xs font-bold text-gray-400 uppercase tracking-wider mt-6 mb-1 px-3">' + esc(dayHeading(p.kickoff)) + '</h3><ul class="divide-y divide-sportBorder/60">';
                lastDay = k;
            }
            html += rowHtml(p, opts);
        });
        return html + (lastDay !== null ? '</ul>' : '');
    }

    function renderTabs() {
        var searching = !!state.q.trim();
        $('fxTabs').innerHTML = C.list.map(function (c) {
            var on = !searching && state.fxComp === c.code;
            return '<button type="button" role="tab" id="fxtab-' + esc(c.code) + '" data-comp="' + esc(c.code) + '" aria-selected="' + on + '" aria-controls="fxPanel" tabindex="' + (state.fxComp === c.code ? 0 : -1) + '" ' +
                'class="fx-tab shrink-0 px-3 sm:px-4 py-3 -mb-px border-b-2 border-transparent text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-colors ' +
                (searching ? 'text-gray-600' : 'text-gray-400 hover:text-white') + '">' + esc(c.name) + '</button>';
        }).join('');
        $('fxPanel').setAttribute('aria-labelledby', 'fxtab-' + state.fxComp);
    }

    function renderFixtures() {
        if (!state.data) return;
        renderTabs();
        var q = fold(state.q.trim());
        var searching = !!q;
        var all = state.data.predictions.filter(function (p) {
            return searching ? (fold(p.home_team).indexOf(q) !== -1 || fold(p.away_team).indexOf(q) !== -1) : p.competition === state.fxComp;
        });
        var byKick = function (a, b) { return (a.kickoff - b.kickoff) || (C.order(a.competition) - C.order(b.competition)); };
        var upcoming = all.filter(function (p) { return !hasKickedOff(p); }).sort(byKick);
        var played = all.filter(hasKickedOff).sort(byKick);
        var scope = searching ? 'for “' + esc(state.q.trim()) + '”' : esc(C.get(state.fxComp).name);
        var opts = { showComp: searching };

        var html = '';
        if (searching) html += '<p class="text-xs text-gray-500 px-3 pt-4">Searching all leagues · <button type="button" data-clear class="text-activeRed font-semibold hover:underline">Clear</button></p>';

        if (upcoming.length) {
            html += groupedRows(upcoming.slice(0, state.fxLimit), opts);
            if (upcoming.length > state.fxLimit) {
                html += '<div class="pt-4 text-center"><button type="button" data-more class="px-5 py-2 rounded-full border border-sportBorder text-xs font-bold uppercase tracking-wider text-gray-300 hover:text-white hover:border-gray-500">Show more (' + (upcoming.length - state.fxLimit) + ')</button></div>';
            }
        } else {
            html += '<p class="text-sm text-gray-400 px-3 py-8 text-center">' + (all.length ? 'No upcoming fixtures ' + scope + ' in the current predictions file.' : 'No fixtures ' + scope + ' in the current predictions file.') + '</p>';
        }

        if (played.length) {
            html += '<div class="mt-4 pt-2 border-t border-sportBorder/60">' +
                '<button type="button" data-played aria-expanded="' + state.showPlayed + '" class="w-full flex items-center justify-between px-3 py-3 text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-white">' +
                    '<span>' + (state.showPlayed ? 'Hide' : 'Show') + ' ' + played.length + ' fixture' + (played.length === 1 ? '' : 's') + ' that already kicked off</span>' +
                    '<i class="fa-solid fa-chevron-down transition-transform ' + (state.showPlayed ? 'rotate-180' : '') + '" aria-hidden="true"></i></button>' +
                (state.showPlayed ? groupedRows(played, opts) : '') + '</div>';
        }
        $('fxPanel').innerHTML = html;
    }

    function findByKey(key) {
        var list = state.data ? state.data.predictions : [];
        for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
        return null;
    }

    // ======================================================================
    // Init
    // ======================================================================
    function showLoadError(err) {
        var msg = esc((err && err.message) || 'The predictions couldn’t be loaded.');
        $('resultRegion').innerHTML = '<div class="rounded-3xl bg-activeRed/10 border border-activeRed/40 p-6 sm:p-8 text-center" role="alert">' +
            '<p class="text-white font-bold mb-1">Predictions couldn’t be loaded</p><p class="text-sm text-gray-300 mb-4">' + msg + '</p>' +
            '<button type="button" id="retryBtn" class="px-5 py-2.5 bg-ctaRed hover:bg-ctaRedHover text-white font-bold rounded-xl uppercase tracking-wider text-xs inline-flex items-center gap-2"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Try again</button></div>';
        $('fxPanel').innerHTML = '<p class="text-sm text-gray-400 px-3 py-8 text-center">Fixtures will appear here once the predictions load.</p>';
        $('leagueGroup').innerHTML = '';
        $('retryBtn').addEventListener('click', function () { start(true); });
    }

    async function start(reload) {
        try {
            state.data = await API.getPredictions({ reload: !!reload });
        } catch (err) {
            showLoadError(err);
            return;
        }
        $('resultRegion').innerHTML = '';
        var d = state.data;
        var meta = 'Model ' + esc(d.model_version || 'unknown');
        if (d.generated_at) meta += ' · updated ' + esc(d.generated_at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }));
        if (d.skipped) meta += ' · ' + d.skipped + ' incomplete entr' + (d.skipped === 1 ? 'y' : 'ies') + ' skipped';
        $('metaLine').innerHTML = meta;

        renderLeagueChips();

        var q = new URLSearchParams(location.search);
        var qLeague = (q.get('league') || '').toUpperCase();
        var known = C.list.some(function (c) { return c.code === qLeague; });
        var league = known ? qLeague : DEFAULT_LEAGUE;
        state.fxComp = league;
        await selectLeague(league);
        renderFixtures();

        var qh = q.get('home'), qa = q.get('away');
        if (known && qh && qa) {
            homeBox.setValue(qh); awayBox.setValue(qa); syncForm();
            var h = homeBox.peek(), a = awayBox.peek();
            if (h && a && h !== a) runPrediction({ league: league, home: h, away: a }, { scroll: false, focus: false });
            else showFormError('The link names a team that isn’t in the ' + C.get(league).name + ' fixtures, so nothing was predicted.');
        }
    }

    function init() {
        homeBox = Combobox($('homeTeam'), function () { setFieldError('home'); syncForm(); });
        awayBox = Combobox($('awayTeam'), function () { setFieldError('away'); syncForm(); });

        $('leagueGroup').addEventListener('change', function (e) {
            if (e.target.name === 'league') { selectLeague(e.target.value); }
        });
        $('swapBtn').addEventListener('click', swapTeams);
        $('predictForm').addEventListener('submit', function (e) {
            e.preventDefault();
            var v = validate();
            if (v) runPrediction(v);
        });

        $('resultRegion').addEventListener('click', function (e) {
            if (e.target.closest('[data-swap]')) { swapTeams(); var v = validate(); if (v) runPrediction(v); return; }
            var row = e.target.closest('[data-key]');
            if (row) { var p = findByKey(row.getAttribute('data-key')); if (p) loadFixture(p); }
        });

        $('fxTabs').addEventListener('click', function (e) {
            var b = e.target.closest('[data-comp]');
            if (!b) return;
            state.fxComp = b.getAttribute('data-comp');
            state.q = ''; $('teamSearch').value = '';
            state.fxLimit = PAGE_SIZE; state.showPlayed = false;
            renderFixtures();
            var again = $('fxtab-' + state.fxComp); if (again) again.focus();
        });
        $('fxTabs').addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            var codes = C.list.map(function (c) { return c.code; });
            var i = codes.indexOf(state.fxComp);
            var next = codes[(i + (e.key === 'ArrowRight' ? 1 : codes.length - 1)) % codes.length];
            e.preventDefault();
            $('fxtab-' + next).click();
        });
        var searchTimer = null;
        $('teamSearch').addEventListener('input', function () {
            var v = this.value;
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function () { state.q = v; state.fxLimit = PAGE_SIZE; state.showPlayed = false; renderFixtures(); }, 150);
        });
        $('fxPanel').addEventListener('click', function (e) {
            if (e.target.closest('[data-more]')) { state.fxLimit += PAGE_SIZE; renderFixtures(); return; }
            if (e.target.closest('[data-played]')) {
                state.showPlayed = !state.showPlayed; renderFixtures();
                var t = $('fxPanel').querySelector('[data-played]'); if (t) t.focus();
                return;
            }
            if (e.target.closest('[data-clear]')) { state.q = ''; $('teamSearch').value = ''; renderFixtures(); $('teamSearch').focus(); return; }
            var row = e.target.closest('[data-key]');
            if (row) { var p = findByKey(row.getAttribute('data-key')); if (p) loadFixture(p); }
        });

        start(false);
    }

    init();
})();
