/* ScoreLine probability helpers (pure functions, no DOM). Exposed as window.SLProb */
(function () {
    'use strict';

    var KEYS = ['home', 'draw', 'away'];

    function normalize(p) {
        var s = p.home + p.draw + p.away;
        if (!s) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
        return { home: p.home / s, draw: p.draw / s, away: p.away / s };
    }

    /**
     * Round probabilities to whole percentages that sum to exactly 100 (largest-remainder method).
     * Ties go to home, then draw, then away.
     */
    function toPercents(p) {
        var n = normalize(p);
        var raw = KEYS.map(function (k) { return n[k] * 100; });
        var floors = raw.map(Math.floor);
        var rem = 100 - floors.reduce(function (s, v) { return s + v; }, 0);
        var order = raw.map(function (v, i) { return { i: i, frac: Math.round((v - Math.floor(v)) * 1e6) }; })
            .sort(function (x, y) { return (y.frac - x.frac) || (x.i - y.i); });
        for (var k = 0; k < rem; k++) floors[order[k].i] += 1;
        var out = {};
        KEYS.forEach(function (key, i) { out[key] = floors[i]; });
        return out;
    }

    /** Key of the most likely outcome ('home' | 'draw' | 'away'); ties go to home, then draw. */
    function mostLikely(p) {
        var best = 'home';
        ['draw', 'away'].forEach(function (k) { if (p[k] > p[best]) best = k; });
        return best;
    }

    /**
     * Confidence label from the top outcome's rounded percentage (the number the user sees).
     * Thresholds live here only; CONFIDENCE_RULE is the plain-English version for tooltips.
     */
    var CONFIDENCE_LEVELS = [
        { min: 60, label: 'Strong favourite', tone: 'strong' },
        { min: 45, label: 'Favourite',        tone: 'medium' },
        { min: 0,  label: 'Close match',      tone: 'neutral' }
    ];
    var CONFIDENCE_RULE = 'Based on the most likely outcome: 60% or more = Strong favourite, 45–59% = Favourite, under 45% = Close match.';

    function confidence(p) {
        var pct = toPercents(p);
        var pick = mostLikely(p);
        var top = pct[pick];
        for (var i = 0; i < CONFIDENCE_LEVELS.length; i++) {
            if (top >= CONFIDENCE_LEVELS[i].min) {
                return { label: CONFIDENCE_LEVELS[i].label, tone: CONFIDENCE_LEVELS[i].tone, pick: pick, percent: top, score: p[pick] };
            }
        }
    }

    window.SLProb = {
        normalize: normalize,
        toPercents: toPercents,
        mostLikely: mostLikely,
        confidence: confidence,
        CONFIDENCE_RULE: CONFIDENCE_RULE
    };
})();
