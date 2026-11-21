/* ScoreLine probability helpers (pure functions, no DOM). Exposed as window.SLProb */
(function () {
    'use strict';

    function factorial(n) { var r = 1; for (var i = 2; i <= n; i++) r *= i; return r; }

    function poissonPmf(k, lambda) {
        return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
    }

    /** grid[h][a] = P(home scores h, away scores a), independent Poisson, 0..max goals each */
    function scoreGrid(lambdaHome, lambdaAway, max) {
        max = max == null ? 5 : max;
        var grid = [];
        for (var h = 0; h <= max; h++) {
            grid[h] = [];
            for (var a = 0; a <= max; a++) grid[h][a] = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
        }
        return grid;
    }

    function topScores(grid, n) {
        var list = [];
        grid.forEach(function (row, h) { row.forEach(function (p, a) { list.push({ home: h, away: a, p: p }); }); });
        list.sort(function (x, y) { return y.p - x.p; });
        return list.slice(0, n || 5);
    }

    /** Home/draw/away probabilities from a full Poisson grid (0..10 goals, renormalised) */
    function outcomesFromLambdas(lh, la) {
        var g = scoreGrid(lh, la, 10), h = 0, d = 0, a = 0;
        g.forEach(function (row, i) { row.forEach(function (p, j) { if (i > j) h += p; else if (i === j) d += p; else a += p; }); });
        return normalize({ home: h, draw: d, away: a });
    }

    function normalize(p) {
        var s = p.home + p.draw + p.away;
        if (!s) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
        return { home: p.home / s, draw: p.draw / s, away: p.away / s };
    }

    /**
     * Round probabilities to percentages that sum to exactly 100 (largest-remainder method).
     * decimals = 0 -> integers, 1 -> one decimal place.
     */
    function toPercents(p, decimals) {
        decimals = decimals || 0;
        var scale = Math.pow(10, decimals), total = 100 * scale;
        var n = normalize(p);
        var keys = ['home', 'draw', 'away'];
        var raw = keys.map(function (k) { return n[k] * total; });
        var floors = raw.map(Math.floor);
        var rem = total - floors.reduce(function (s, v) { return s + v; }, 0);
        // Round the remainders so float noise can't break ties; ties go to home, then draw, then away.
        var order = raw.map(function (v, i) { return { i: i, frac: Math.round((v - Math.floor(v)) * 1e6) }; })
            .sort(function (x, y) { return (y.frac - x.frac) || (x.i - y.i); });
        for (var k = 0; k < rem; k++) floors[order[k].i] += 1;
        var out = {};
        keys.forEach(function (key, i) { out[key] = floors[i] / scale; });
        return out;
    }

    function mostLikely(p) {
        var best = 'home';
        ['draw', 'away'].forEach(function (k) { if (p[k] > p[best]) best = k; });
        return best;
    }

    /** Plain-English confidence label for a 3-way prediction */
    function confidence(p) {
        var n = normalize(p);
        var vals = [n.home, n.draw, n.away].sort(function (a, b) { return b - a; });
        var top = vals[0], gap = vals[0] - vals[1];
        var pick = mostLikely(n);
        if (pick === 'draw') return { label: 'Too close to call', tone: 'neutral', detail: 'A draw is the single most likely result, but no outcome stands out.' };
        if (top >= 0.65) return { label: 'Strong favourite', tone: 'strong', detail: 'One side is a clear favourite on paper.' };
        if (top >= 0.5) return { label: 'Clear favourite', tone: 'strong', detail: 'One side is favoured, but an upset is far from unlikely.' };
        if (gap >= 0.1) return { label: 'Slight favourite', tone: 'medium', detail: 'There is a modest edge for one side.' };
        return { label: 'Close match', tone: 'neutral', detail: 'The outcomes are finely balanced.' };
    }

    // Deterministic pseudo-random numbers (used only to generate demo data)
    function hashString(str) {
        var h = 2166136261;
        for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }
    function seededRandom(seed) {
        var t = seed >>> 0;
        return function () {
            t += 0x6D2B79F5;
            var r = Math.imul(t ^ (t >>> 15), 1 | t);
            r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
    }
    function samplePoisson(lambda, rand) {
        var L = Math.exp(-lambda), k = 0, p = 1;
        do { k++; p *= rand(); } while (p > L);
        return k - 1;
    }

    window.SLProb = {
        poissonPmf: poissonPmf,
        scoreGrid: scoreGrid,
        topScores: topScores,
        outcomesFromLambdas: outcomesFromLambdas,
        normalize: normalize,
        toPercents: toPercents,
        mostLikely: mostLikely,
        confidence: confidence,
        hashString: hashString,
        seededRandom: seededRandom,
        samplePoisson: samplePoisson
    };
})();
