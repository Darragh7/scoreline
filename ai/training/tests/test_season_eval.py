import numpy as np
import pandas as pd
import pytest

from ai.training import features as fe
from ai.training import preprocessing as pp
from ai.training import season_eval as se

TEAMS = ["Arsenal", "Chelsea", "Liverpool", "Everton", "Fulham", "Brentford", "Burnley", "Watford"]


def _rounds(teams):
    t, n, first = list(teams), len(teams), []
    for r in range(n - 1):
        first.append([(t[i], t[n - 1 - i]) if (i + r) % 2 == 0 else (t[n - 1 - i], t[i]) for i in range(n // 2)])
        t = [t[0], t[-1]] + t[1:-1]
    return first + [[(b, a) for a, b in rd] for rd in first]


@pytest.fixture(scope="module")
def league(tmp_path_factory):
    """Four seasons (2022-2025) of a made-up 8-team league, plus matching bookmaker probabilities."""
    rng = np.random.default_rng(0)
    strength = {t: rng.normal(0, 0.3) for t in TEAMS}
    rows, odds = [], []
    for season in range(2022, 2026):
        for r, rd in enumerate(_rounds(TEAMS)):
            date = pd.Timestamp(f"{season}-08-13") + pd.DateOffset(days=7 * r)
            for home, away in rd:
                hg = rng.poisson(np.exp(0.25 + strength[home] - strength[away] * 0.5))
                ag = rng.poisson(np.exp(strength[away] - strength[home] * 0.5))
                rows.append(("E0", date.date().isoformat(), home, away, hg, ag))
                p = rng.dirichlet([8, 4, 6])
                odds.append((date.date().isoformat(), home, away, "Test", 0.03, p[0], p[1], p[2]))
    folder = tmp_path_factory.mktemp("league")
    matches_path, odds_path = folder / "matches.csv", folder / "odds.csv"
    pd.DataFrame(rows, columns=["Div", "Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG"]).to_csv(matches_path, index=False)
    pd.DataFrame(odds, columns=["Date", "HomeTeam", "AwayTeam", "odds_source", "market_margin", "market_p_home",
                                "market_p_draw", "market_p_away"]).to_csv(odds_path, index=False)
    return str(matches_path), str(odds_path)


@pytest.fixture(scope="module")
def table(league, tmp_path_factory):
    static = pp.load_static_csv(league[0])
    return se.build_feature_table(static, cache_dir=tmp_path_factory.mktemp("cache"))


def test_load_odds_csv_uses_canonical_names_and_requires_columns(tmp_path):
    path = tmp_path / "odds.csv"
    pd.DataFrame({"Date": ["2024-08-17"], "HomeTeam": ["Man United"], "AwayTeam": ["Fulham"],
                  "market_p_home": [0.5], "market_p_draw": [0.3], "market_p_away": [0.2]}).to_csv(path, index=False)
    odds = pp.load_odds_csv(str(path))
    assert odds.loc[0, "home_team"] == "Manchester United" and str(odds["date"].dt.tz) == "UTC"
    bad = tmp_path / "bad.csv"
    pd.DataFrame({"Date": ["2024-08-17"]}).to_csv(bad, index=False)
    with pytest.raises(ValueError, match="missing columns"):
        pp.load_odds_csv(str(bad))


def test_attach_market_matches_on_calendar_day_not_kickoff_time():
    table = pd.DataFrame({"home_team": ["Manchester United", "Arsenal"], "away_team": ["Fulham", "Chelsea"],
                          "date": pd.to_datetime(["2024-08-17T14:00:00Z", "2024-08-18T14:00:00Z"], utc=True)})
    odds = pd.DataFrame({"home_team": ["Manchester United"], "away_team": ["Fulham"],
                         "date": pd.to_datetime(["2024-08-17"], utc=True), "market_p_home": [0.5],
                         "market_p_draw": [0.3], "market_p_away": [0.2], "odds_source": ["Test"]})
    merged = se.attach_market(table, odds)
    assert len(merged) == 2
    assert merged.loc[0, "market_p_home"] == 0.5 and pd.isna(merged.loc[1, "market_p_home"])


def test_feature_table_has_selected_features_and_labels(table):
    assert set(fe.SELECTED_FEATURES) <= set(table.columns)
    assert {"dc_p_away", "dc_p_draw", "dc_p_home", "result", "competition", "season"} <= set(table.columns)
    assert len(table) == 4 * 56 and set(table["competition"]) == {"PL"}
    assert table["date"].is_monotonic_increasing


def test_features_are_cached_and_reloaded_identically(league, tmp_path):
    static = pp.load_static_csv(league[0], seasons=[2022, 2023])
    first = se.build_feature_table(static, cache_dir=tmp_path)
    assert len(list(tmp_path.glob("season_eval_features_PL_*.csv"))) == 1
    second = se.build_feature_table(static, cache_dir=tmp_path)
    pd.testing.assert_frame_equal(first, second)


def test_evaluate_season_trains_only_on_earlier_seasons(table, league):
    full = se.attach_market(table, pp.load_odds_csv(league[1]))
    result = se.evaluate_season(full, 2024, n_boot=100)
    assert result["n_train"] == 2 * 56 and result["n_eval"] == 56 and result["n_without_odds"] == 0
    names = set(result["scores"]["model"])
    assert {"Historical frequencies", "Elo only", "Dixon-Coles (raw)", "Bookmakers (margin removed)",
            "Average (pipeline + Elo + Dixon-Coles)"} <= names
    assert any(n.startswith("Pipeline model (") for n in names)
    assert np.isfinite(result["scores"][["log_loss", "brier", "rps", "accuracy"]].to_numpy()).all()
    assert len(result["comparisons"]) == 2 and set(result["calibration"]) == {"A", "D", "H"}
    assert list(result["by_competition"].columns) == ["PL"]


def test_evaluate_season_without_odds_has_no_bookmaker_row(table):
    result = se.evaluate_season(table, 2024, n_boot=100)
    assert "Bookmakers (margin removed)" not in set(result["scores"]["model"])
    assert len(result["comparisons"]) == 1


def test_evaluate_season_without_training_data_raises(table):
    with pytest.raises(ValueError):
        se.evaluate_season(table, 2022)


def test_matches_without_odds_are_left_out_and_counted(table, league):
    odds = pp.load_odds_csv(league[1]).iloc[:-10]  # drop odds for the last 10 matches
    result = se.evaluate_season(se.attach_market(table, odds), 2025, n_boot=100)
    assert result["n_without_odds"] > 0 and result["n_eval"] + result["n_without_odds"] == 56


def test_final_test_season_needs_explicit_confirmation(capsys):
    assert se.main(["--matches", "does-not-matter.csv", "--season", "2025"]) == 2
    assert "--confirm-final-test" in capsys.readouterr().out


def test_cli_runs_end_to_end_and_writes_the_report(league, tmp_path, capsys):
    report = tmp_path / "report.md"
    code = se.main(["--matches", league[0], "--odds", league[1], "--season", "2024", "--cache-dir", str(tmp_path),
                    "--n-boot", "50", "--out", str(report)])
    assert code == 0
    text = report.read_text(encoding="utf-8")
    assert "# Season evaluation: 2024/25" in text and "Bookmakers (margin removed)" in text
    assert "Calibration of Pipeline model" in text and "Model selection" in text
    assert "Season evaluation" in capsys.readouterr().out
    assert se.main(["--matches", league[0], "--season", "2025", "--confirm-final-test",
                    "--cache-dir", str(tmp_path), "--n-boot", "50"]) == 0


def test_md_table_shows_whole_numbers_without_decimals_and_floats_to_four_places():
    df = pd.DataFrame({"n": [219, 220], "predicted": [0.08744, 0.5], "observed": [0.1, 0.25]})
    lines = se._md_table(df).splitlines()
    assert lines[0] == "| n | predicted | observed |"
    assert lines[2] == "| 219 | 0.0874 | 0.1000 |"
    assert lines[3] == "| 220 | 0.5000 | 0.2500 |"
