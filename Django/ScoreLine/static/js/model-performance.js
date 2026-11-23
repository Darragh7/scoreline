/* ScoreLine model performance table + chart (about.html#performance).
   The numbers are the offline evaluation results (see docs/model_evaluation_2024_25.md and
   docs/model_card.md); they are not part of predictions.json, so they live here. */
(function () {
    'use strict';

    // Key of the model whose output is in predictions.json (the final ensemble)
    var LIVE_MODEL = 'ensemble';

    var PERF = {
        validation: {
            label: 'Validation', season: '2024/25', n_matches: 1752,
            rows: [
                { model: 'Bookmakers (margin removed)', key: 'bookmakers', kind: 'benchmark', log_loss: 0.9606, brier: 0.5706, rps: 0.1935, accuracy: 0.5474 },
                { model: 'Ensemble (Elo + Poisson)', key: 'ensemble', kind: 'model', log_loss: 0.9819, brier: 0.5851, rps: 0.1996, accuracy: 0.5342 },
                { model: 'Poisson', key: 'poisson', kind: 'model', log_loss: 0.9848, brier: 0.5867, rps: 0.2008, accuracy: 0.528 },
                { model: 'LR + XGBoost (average)', key: 'lr_xgb_average', kind: 'model', log_loss: 0.985, brier: 0.5868, rps: 0.2, accuracy: 0.54 },
                { model: 'XGBoost', key: 'xgboost', kind: 'model', log_loss: 0.9867, brier: 0.5877, rps: 0.2007, accuracy: 0.5394 },
                { model: 'Logistic regression', key: 'logistic_regression', kind: 'model', log_loss: 0.9869, brier: 0.5882, rps: 0.2002, accuracy: 0.5354 },
                { model: 'Random forest', key: 'random_forest', kind: 'model', log_loss: 0.9877, brier: 0.5887, rps: 0.2012, accuracy: 0.5268 },
                { model: 'Elo', key: 'elo', kind: 'model', log_loss: 0.988, brier: 0.5894, rps: 0.2014, accuracy: 0.532 },
                { model: 'Elo (training seasons ≤ 2023/24)', key: 'elo_train', kind: 'baseline', note: 'In-sample, 10,781 matches', log_loss: 0.9967, brier: 0.5948, rps: 0.2036, accuracy: 0.5165 },
                { model: 'Historical frequencies', key: 'hist_freq', kind: 'baseline', log_loss: 1.0774, brier: 0.6526, rps: 0.2327, accuracy: 0.4201 },
                { model: 'Always home win', key: 'always_home', kind: 'baseline', log_loss: null, brier: null, rps: null, accuracy: 0.4201 }
            ]
        },
        test: {
            label: 'Final test', season: '2025/26', n_matches: 1752,
            rows: [
                { model: 'Bookmakers (margin removed)', key: 'bookmakers', kind: 'benchmark', log_loss: 0.9783, brier: 0.5826, rps: 0.1978, accuracy: 0.5337 },
                { model: 'Logistic regression', key: 'logistic_regression', kind: 'model', log_loss: 0.9916, brier: 0.591, rps: 0.2018, accuracy: 0.5223 },
                { model: 'Ensemble (Elo + Poisson)', key: 'ensemble', kind: 'model', log_loss: 0.9922, brier: 0.5914, rps: 0.202, accuracy: 0.5143 },
                { model: 'XGBoost', key: 'xgboost', kind: 'model', log_loss: 0.9964, brier: 0.5941, rps: 0.2031, accuracy: 0.5183 },
                { model: 'Elo', key: 'elo', kind: 'model', log_loss: 0.9971, brier: 0.5948, rps: 0.2036, accuracy: 0.5114 },
                { model: 'Poisson', key: 'poisson', kind: 'model', log_loss: 0.9981, brier: 0.5952, rps: 0.2035, accuracy: 0.5183 }
            ]
        }
    };

    var METRIC_INFO = {
        accuracy: { label: 'Accuracy', lowerBetter: false, fmt: function (v) { return (v * 100).toFixed(1) + '%'; } },
        log_loss: { label: 'Log loss', lowerBetter: true, fmt: function (v) { return v.toFixed(4); } },
        brier: { label: 'Brier score', lowerBetter: true, fmt: function (v) { return v.toFixed(4); } },
        rps: { label: 'RPS', lowerBetter: true, fmt: function (v) { return v.toFixed(4); } }
    };
    var COLORS = { model: '#ff5c7a', live: '#ff1744', benchmark: '#7dd3fc', baseline: '#9ca3af' };

    var $ = function (id) { return document.getElementById(id); };
    if (!$('perfPanel')) return;
    var current = 'test';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function colorOf(r) { return r.kind === 'model' ? (r.key === LIVE_MODEL ? COLORS.live : COLORS.model) : COLORS[r.kind]; }

    function render() {
        var set = PERF[current];
        document.querySelectorAll('#perfTabs [role="tab"]').forEach(function (t) {
            var on = t.getAttribute('data-set') === current;
            t.setAttribute('aria-selected', String(on));
            t.tabIndex = on ? 0 : -1;
            t.className = 'px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider border transition-colors ' +
                (on ? 'bg-ctaRed border-ctaRed text-white shadow-red-glow' : 'bg-sportCard border-sportBorder text-gray-300 hover:text-white hover:border-gray-500');
            if (on) $('perfPanel').setAttribute('aria-labelledby', t.id);
        });
        $('perfCaption').textContent = set.label + ' season ' + set.season + ' · ' + set.n_matches.toLocaleString('en-GB') + ' matches the models never saw during training';

        var models = set.rows.filter(function (r) { return r.kind === 'model'; });
        var best = {};
        Object.keys(METRIC_INFO).forEach(function (k) {
            var vals = models.map(function (r) { return r[k]; }).filter(function (v) { return v != null; });
            best[k] = METRIC_INFO[k].lowerBetter ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
        });

        $('perfBody').innerHTML = set.rows.map(function (r) {
            var tag = r.kind === 'benchmark' ? '<span class="ml-2 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">Benchmark</span>'
                : r.kind === 'baseline' ? '<span class="ml-2 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-300 border border-gray-500/30">Baseline</span>' : '';
            var live = r.key === LIVE_MODEL ? '<span class="ml-2 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-activeRed/15 text-activeRed border border-activeRed/30" title="This model produces the predictions on the predictor page">Live model</span>' : '';
            var name = esc(r.model) + (r.note ? '<span class="block text-[10px] text-gray-400">' + esc(r.note) + '</span>' : '');
            function cell(k) {
                var v = r[k];
                if (v == null) return '<td class="py-2.5 px-2 text-right text-gray-500">—</td>';
                var isBest = r.kind === 'model' && v === best[k];
                return '<td class="py-2.5 px-2 text-right ' + (isBest ? 'text-white font-bold' : r.kind === 'model' ? 'text-gray-200' : 'text-gray-400') + '">' +
                    (isBest ? '<span class="text-activeRed mr-1" aria-label="best">★</span>' : '') + METRIC_INFO[k].fmt(v) + '</td>';
            }
            return '<tr class="border-b border-sportBorder/60 ' + (r.kind !== 'model' ? 'bg-black/20' : '') + '">' +
                '<th scope="row" class="py-2.5 pr-2 text-left font-semibold ' + (r.kind === 'model' ? 'text-white' : 'text-gray-300') + '">' + name + tag + live + '</th>' +
                cell('log_loss') + cell('brier') + cell('rps') + cell('accuracy') + '</tr>';
        }).join('');

        renderChart();
    }

    function renderChart() {
        var set = PERF[current];
        var metric = $('chartMetric').value;
        var info = METRIC_INFO[metric];
        $('chartTitle').textContent = info.label + (info.lowerBetter ? ' (lower is better)' : ' (higher is better)');
        var rows = set.rows.filter(function (r) { return r[metric] != null; });
        rows.sort(function (a, b) { return info.lowerBetter ? a[metric] - b[metric] : b[metric] - a[metric]; });

        var html = '';
        if (metric === 'accuracy') {
            rows.forEach(function (r) {
                var w = r[metric] / 0.6 * 100;
                html += '<div class="grid grid-cols-[minmax(0,9.5rem)_1fr_3.2rem] items-center gap-2 py-1" title="' + esc(r.model) + ': ' + info.fmt(r[metric]) + '">' +
                    '<span class="text-[11px] text-gray-300 truncate">' + esc(r.model) + '</span>' +
                    '<span class="relative h-3"><span class="absolute inset-y-0 left-0 rounded-r" style="width:' + Math.min(100, w).toFixed(1) + '%;background:' + colorOf(r) + '"></span></span>' +
                    '<span class="text-[11px] text-gray-200 text-right tabular">' + info.fmt(r[metric]) + '</span></div>';
            });
            html += '<div class="grid grid-cols-[minmax(0,9.5rem)_1fr_3.2rem] gap-2 mt-1"><span></span><span class="flex justify-between text-[10px] text-gray-500 tabular border-t border-sportBorder pt-1"><span>0%</span><span>20%</span><span>40%</span><span>60%</span></span><span></span></div>';
            $('chartNote').textContent = 'Always picking the home side is right 42.0% of the time. Every model clears that, and the bookmakers set the ceiling.';
        } else {
            var vals = rows.map(function (r) { return r[metric]; });
            var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
            var pad = (hi - lo) * 0.08 || 0.01;
            lo -= pad; hi += pad;
            rows.forEach(function (r) {
                var x = (r[metric] - lo) / (hi - lo) * 100;
                html += '<div class="grid grid-cols-[minmax(0,9.5rem)_1fr_3.6rem] items-center gap-2 py-1" title="' + esc(r.model) + ': ' + info.fmt(r[metric]) + '">' +
                    '<span class="text-[11px] text-gray-300 truncate">' + esc(r.model) + '</span>' +
                    '<span class="relative h-3"><span class="absolute inset-x-0 top-1/2 h-px bg-sportBorder"></span>' +
                    '<span class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full ring-2 ring-[#16181d]" style="left:' + x.toFixed(1) + '%;background:' + colorOf(r) + '"></span></span>' +
                    '<span class="text-[11px] text-gray-200 text-right tabular">' + info.fmt(r[metric]) + '</span></div>';
            });
            html += '<div class="grid grid-cols-[minmax(0,9.5rem)_1fr_3.6rem] gap-2 mt-1"><span></span><span class="flex justify-between text-[10px] text-gray-500 tabular border-t border-sportBorder pt-1"><span>' + lo.toFixed(3) + '</span><span>' + hi.toFixed(3) + '</span></span><span></span></div>';
            $('chartNote').textContent = 'Axis is zoomed in (it does not start at zero) so the small but real gaps between models are visible. Leftmost is best.';
        }
        html += '<div class="flex flex-wrap gap-4 text-[10px] text-gray-400 mt-3">' +
            '<span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background:' + COLORS.model + '" aria-hidden="true"></span>Our models</span>' +
            '<span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background:' + COLORS.live + '" aria-hidden="true"></span>Live model</span>' +
            '<span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background:' + COLORS.benchmark + '" aria-hidden="true"></span>Bookmakers</span>' +
            '<span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full" style="background:' + COLORS.baseline + '" aria-hidden="true"></span>Baselines</span></div>';
        $('perfChart').innerHTML = '<div role="img" aria-label="' + esc(info.label) + ' by model; the table beside it holds the same numbers.">' + html + '</div>';
    }

    function renderTakeaway() {
        function row(set, key) { return (PERF[set].rows.filter(function (r) { return r.key === key; })[0]) || {}; }
        var ensT = row('test', LIVE_MODEL), bookT = row('test', 'bookmakers'), hist = row('validation', 'hist_freq'), home = row('validation', 'always_home');
        $('perfTakeaway').innerHTML =
            '<strong class="text-white"><i class="fa-solid fa-lightbulb text-activeRed mr-1" aria-hidden="true"></i>What this means:</strong> ' +
            'our models pick the right result about <strong class="text-white">51–54%</strong> of the time, against <strong class="text-white">' + (home.accuracy * 100).toFixed(0) + '%</strong> for "always back the home side", and their log loss (≈0.98–1.00) is well below the ' + hist.log_loss.toFixed(3) + ' you get from historical frequencies alone. ' +
            'The bookmakers are still slightly sharper (log loss ' + bookT.log_loss.toFixed(3) + ' vs ' + ensT.log_loss.toFixed(3) + ' for the live ensemble on the 2025/26 test). They see team news, injuries and market money that our models don’t.';
    }

    var tabs = document.querySelectorAll('#perfTabs [role="tab"]');
    tabs.forEach(function (t, i) {
        t.addEventListener('click', function () { current = t.getAttribute('data-set'); render(); });
        t.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
            next.focus(); next.click();
        });
    });
    $('chartMetric').addEventListener('change', renderChart);

    render();
    renderTakeaway();
})();
