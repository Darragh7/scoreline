import json

import numpy as np
import pandas as pd
import pytest

from ai.training import features as fe
from ai.training import predict as pr
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
    """Made-up 8-team league: seasons 2022-2025 (finished) as a cleaned-history CSV."""
    rng = np.random.default_rng(0)
    strength = {t: rng.normal(0, 0.3) for t in TEAMS}
    rows = []
    for season in range(2022, 2026):
        for r, rd in enumerate(_rounds(TEAMS)):
            date = pd.Timestamp(f"{season}-08-13") + pd.DateOffset(days=7 * r)
            for home, away in rd:
                hg = rng.poisson(np.exp(0.25 + strength[home] - strength[away] * 0.5))
                ag = rng.poisson(np.exp(strength[away] - strength[home] * 0.5))
                rows.append(("E0", date.date().isoformat(), home, away, hg, ag))
    path = tmp_path_factory.mktemp("league") / "matches.csv"
    pd.DataFrame(rows, columns=["Div", "Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG"]).to_csv(path, index=False)
    return str(path)


@pytest.fixture(scope="module")
def history(league):
    return pp.load_static_csv(league)


@pytest.fixture(scope="module")
def bundle(history, tmp_path_factory):
    return pr.train_final_model(history, "vtest", cache_dir=tmp_path_factory.mktemp("cache"))


def _fixtures(rows):
    df = pd.DataFrame(rows, columns=["id", "competition", "home_team", "away_team", "date"])
    df["date"] = pd.to_datetime(df["date"], utc=True)
    return df


# the made-up history ends on 2025-11-12, so these are "the next round"
NEXT_ROUND = [(101, "PL", "Arsenal", "Chelsea", "2025-11-19T15:00:00Z"),
              (102, "PL", "Liverpool", "Everton", "2025-11-19T17:30:00Z"),
              (103, "PL", "Fulham", "Brentford", "2025-11-20T14:00:00Z")]


def test_bundle_records_what_was_trained(bundle, history):
    assert bundle.features == fe.SELECTED_FEATURES and bundle.version == "vtest"
    meta = bundle.metadata
    assert meta["data"]["n_matches"] == len(history) and meta["data"]["competitions"] == ["PL"]
    assert meta["selected_model"] in {r["model"] for r in meta["cv_log_loss"]}
    assert meta["output_names"] == {"H": "home_win", "D": "draw", "A": "away_win"}


def test_save_and_load_roundtrip_gives_identical_predictions(bundle, tmp_path):
    folder = pr.save_bundle(bundle, tmp_path)
    assert {p.name for p in folder.iterdir()} == {"model.joblib", "metadata.json", "README.txt"}
    loaded = pr.load_bundle(folder)
    X = pd.DataFrame({c: [0.1, -0.2] for c in fe.SELECTED_FEATURES})
    X["dc_p_home"], X["dc_p_draw"] = [0.5, 0.3], [0.25, 0.3]
    np.testing.assert_allclose(bundle.model.predict_proba(X), loaded.model.predict_proba(X))
    assert loaded.version == "vtest"


def test_load_bundle_refuses_a_model_trained_on_other_features(bundle, tmp_path):
    folder = pr.save_bundle(bundle, tmp_path)
    meta_path = folder / "metadata.json"
    meta = json.loads(meta_path.read_text())
    meta["features"] = ["elo_diff"]
    meta_path.write_text(json.dumps(meta))
    with pytest.raises(ValueError, match="retrain"):
        pr.load_bundle(folder)


def test_predictions_are_valid_probabilities_in_the_backend_names(bundle, history):
    out = pr.predict_fixtures(bundle, history, _fixtures(NEXT_ROUND), progress=lambda *_: None)
    assert len(out) == 3 and list(out["id"]) == [101, 102, 103]
    probs = out[["home_win", "draw", "away_win"]].to_numpy(float)
    assert np.isfinite(probs).all() and (probs > 0).all() and (probs < 1).all()
    np.testing.assert_allclose(probs.sum(axis=1), 1.0, atol=1e-6)
    assert set(out["model_version"]) == {"vtest"} and all(f == [] for f in out["flags"])


def test_serving_features_match_the_training_features_for_the_same_match(history, bundle, tmp_path):
    """No training/serving skew: a played match, rebuilt as a fixture from the matches before it."""
    table = se.build_feature_table(history, cache_dir=tmp_path)
    target = table[table["season"] == 2024].iloc[40]
    before = history[history["date"] < target["date"]]
    fixture = _fixtures([(1, "PL", target["home_team"], target["away_team"], target["date"])])
    served = pr.fixture_features(before, fixture).iloc[0]
    trained = table.loc[table["id"] == target["id"], fe.SELECTED_FEATURES].iloc[0]
    np.testing.assert_allclose(served[["elo_diff", "ewm_gd_diff"]].astype(float), trained[["elo_diff", "ewm_gd_diff"]].astype(float), atol=1e-9)
    np.testing.assert_allclose(served[["dc_p_home", "dc_p_draw"]].astype(float), trained[["dc_p_home", "dc_p_draw"]].astype(float), atol=2e-3)


def test_features_ignore_results_played_after_the_fixture(history):
    fixture = _fixtures([(1, "PL", "Arsenal", "Chelsea", "2025-12-06T15:00:00Z")])
    cutoff = pd.Timestamp("2025-12-06", tz="UTC")
    past = history[history["date"] < cutoff]
    future = history[history["date"] >= cutoff].copy()
    future["home_score"], future["away_score"] = 9, 0  # absurd results that must not matter
    altered = pd.concat([past, future])
    pd.testing.assert_frame_equal(pr.fixture_features(past, fixture), pr.fixture_features(altered, fixture))


def test_fixtures_never_feed_each_other():
    """Same-week fixtures sharing a team are split; each is predicted from history only."""
    fx = _fixtures([(1, "PL", "Arsenal", "Chelsea", "2026-08-15T15:00:00Z"),      # Saturday
                    (2, "PL", "Arsenal", "Everton", "2026-08-12T19:45:00Z"),      # same week (Wed), Arsenal again
                    (3, "PL", "Liverpool", "Fulham", "2026-08-16T14:00:00Z"),     # same week, different teams
                    (4, "PL", "Brentford", "Burnley", "2026-08-22T15:00:00Z")])   # the following week
    groups = pr._week_groups(fx)
    assert sorted(sorted(g["id"]) for g in groups) == [[1], [2, 3], [4]]
    for group in groups:  # no team twice in a group, one calendar week per group
        teams = list(group["home_team"]) + list(group["away_team"])
        assert len(teams) == len(set(teams))
        assert group["date"].pipe(pr._week_start).nunique() == 1


def test_unknown_team_and_stale_history_are_flagged_not_fatal(bundle, history):
    fx = _fixtures([(7, "PL", "Arsenal", "Brand New FC", "2027-03-01T15:00:00Z")])
    out = pr.predict_fixtures(bundle, history, fx, progress=lambda *_: None)
    flags = out.loc[0, "flags"]
    assert "unknown_team:Brand New FC" in flags and any(f.startswith("history_ends:") for f in flags)
    assert out.loc[0, ["home_win", "draw", "away_win"]].astype(float).sum() == pytest.approx(1.0)


def test_competition_is_inferred_from_the_home_team_when_missing(bundle, history):
    fx = _fixtures([(8, None, "Arsenal", "Chelsea", "2026-08-15T15:00:00Z")])
    assert pr.predict_fixtures(bundle, history, fx, progress=lambda *_: None).loc[0, "competition"] == "PL"
    with pytest.raises(ValueError, match="cannot tell"):
        pr.predict_fixtures(bundle, history, _fixtures([(9, None, "Nowhere FC", "Arsenal", "2026-08-15T15:00:00Z")]),
                            progress=lambda *_: None)


def test_load_fixtures_reads_api_json_flat_json_and_csv(tmp_path):
    api = {"competition": {"code": "PL"}, "matches": [
        {"id": 5, "utcDate": "2026-08-15T15:00:00Z", "homeTeam": {"name": "Manchester United FC"},
         "awayTeam": {"name": "Fulham FC"}}]}
    (tmp_path / "api.json").write_text(json.dumps(api))
    (tmp_path / "flat.json").write_text(json.dumps([{"match_id": 6, "home_team": "Man United", "away_team": "Fulham",
                                                     "date": "2026-08-15T15:00:00Z", "competition": "E0"}]))
    pd.DataFrame([{"id": 7, "home_team": "Man United", "away_team": "Fulham", "date": "2026-08-15 15:00:00",
                   "competition": "PL"}]).to_csv(tmp_path / "f.csv", index=False)
    for name in ("api.json", "flat.json", "f.csv"):
        df = pr.load_fixtures(tmp_path / name)
        assert df.loc[0, "home_team"] == "Manchester United" and df.loc[0, "away_team"] == "Fulham"
        assert df.loc[0, "competition"] == "PL" and str(df["date"].dt.tz) == "UTC"


def test_cli_trains_then_predicts_end_to_end(league, tmp_path, capsys):
    models = tmp_path / "models"
    assert pr.main(["train", "--matches", league, "--out", str(models), "--version", "v1",
                    "--cache-dir", str(tmp_path / "cache")]) == 0
    fixtures_file, out_file = tmp_path / "fx.json", tmp_path / "pred.json"
    fixtures_file.write_text(json.dumps([{"id": 11, "home_team": "Arsenal", "away_team": "Chelsea",
                                          "date": "2026-08-15T15:00:00Z", "competition": "PL"}]))
    assert pr.main(["fixtures", "--model", str(models / "v1"), "--matches", league, "--fixtures", str(fixtures_file),
                    "--out", str(out_file)]) == 0
    payload = json.loads(out_file.read_text())
    assert payload["model_version"] == "v1" and len(payload["predictions"]) == 1
    p = payload["predictions"][0]
    assert p["match_id"] == 11 and p["kickoff"] == "2026-08-15T15:00:00Z"
    assert p["home_win"] + p["draw"] + p["away_win"] == pytest.approx(1.0, abs=2e-4)
    assert "Wrote 1 predictions" in capsys.readouterr().out


def test_cli_accepts_several_fixture_files_and_merges_them(league, tmp_path):
    models = tmp_path / "models"
    assert pr.main(["train", "--matches", league, "--out", str(models), "--version", "v2",
                    "--cache-dir", str(tmp_path / "cache")]) == 0
    first, second, out_file = tmp_path / "a.json", tmp_path / "b.json", tmp_path / "pred.json"
    first.write_text(json.dumps([{"id": 1, "home_team": "Arsenal", "away_team": "Chelsea", "date": "2025-11-19T15:00:00Z"}]))
    second.write_text(json.dumps([{"id": 2, "home_team": "Liverpool", "away_team": "Everton", "date": "2025-11-19T17:30:00Z"}]))
    assert pr.main(["fixtures", "--model", str(models / "v2"), "--matches", league,
                    "--fixtures", str(first), str(second), "--out", str(out_file)]) == 0
    assert [p["match_id"] for p in json.loads(out_file.read_text())["predictions"]] == [1, 2]
