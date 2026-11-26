/* ScoreLine competitions: the ONE place competition codes are mapped to names and colours.
   To add a league, add an entry here (code as written in predictions.json). Order = tab order.
   Exposed as window.SLCompetitions. */
(function () {
    'use strict';

    var LIST = [
        { code: 'PL',  name: 'Premier League', country: 'England', color: '#a78bfa' },
        { code: 'PD',  name: 'La Liga',        country: 'Spain',   color: '#fb923c' },
        { code: 'BL1', name: 'Bundesliga',     country: 'Germany', color: '#facc15' },
        { code: 'SA',  name: 'Serie A',        country: 'Italy',   color: '#60a5fa' },
        { code: 'FL1', name: 'Ligue 1',        country: 'France',  color: '#2dd4bf' }
    ];
    var FALLBACK_COLOR = '#9ca3af';

    var byCode = {};
    LIST.forEach(function (c) { byCode[c.code] = c; });

    /** Always returns an object, so a code missing from LIST still renders (named by its code). */
    function get(code) {
        return byCode[code] || { code: code, name: code, country: '', color: FALLBACK_COLOR, unknown: true };
    }

    window.SLCompetitions = {
        list: LIST,
        get: get,
        order: function (code) { var i = LIST.indexOf(byCode[code]); return i === -1 ? LIST.length : i; }
    };
})();
