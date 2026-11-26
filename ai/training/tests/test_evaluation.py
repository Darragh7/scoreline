import numpy as np
import pandas as pd
import pytest

from ai.training import evaluation as ev
from ai.training.train import LABELS


def frame(rows):
    return pd.DataFrame(rows, columns=LABELS)


def test_rps_is_zero_for_a_perfect_forecast_and_known_value_for_uniform():
    y = np.array(["H", "A", "D"])
    perfect = frame([[0, 0, 1], [1, 0, 0], [0, 1, 0]])
    assert ev.rps(y, perfect) == pytest.approx(0.0)
    uniform = frame([[1 / 3, 1 / 3, 1 / 3]] * 3)
    assert ev.rps(y[:1], uniform.iloc[:1]) == pytest.approx(5 / 18)  # same for a home or an away win


def test_rps_punishes_a_far_miss_more_than_a_near_miss():
    y = np.array(["H"])
    near = frame([[0.0, 1.0, 0.0]])  # predicted draw, home won
    far = frame([[1.0, 0.0, 0.0]])  # predicted away win, home won
    assert ev.rps(y, near) < ev.rps(y, far)


def test_score_table_ranks_by_log_loss_and_reports_all_metrics():
    y = pd.Series(["H", "A", "D", "H"])
    good = frame([[0.05, 0.05, 0.9], [0.9, 0.05, 0.05], [0.05, 0.9, 0.05], [0.05, 0.05, 0.9]])
    flat = frame([[1 / 3, 1 / 3, 1 / 3]] * 4)
    table = ev.score_table(y, {"flat": flat, "good": good})
    assert list(table["model"]) == ["good", "flat"]
    assert list(table.columns) == ["model", "n", "log_loss", "brier", "rps", "accuracy"]
    assert table.loc[0, "accuracy"] == 1.0 and (table["n"] == 4).all()
    assert table.loc[1, "log_loss"] == pytest.approx(np.log(3))


def _signal_data(n=800, seed=0):
    rng = np.random.default_rng(seed)
    strong = rng.random(n) < 0.5
    true = np.where(strong[:, None], [[0.1, 0.1, 0.8]], [[0.8, 0.1, 0.1]])
    y = np.array([rng.choice(LABELS, p=p) for p in true])
    return y, pd.DataFrame(true, columns=LABELS)


def test_compare_with_reference_flags_a_real_difference_and_a_tie():
    y, truth = _signal_data()
    uniform = pd.DataFrame(np.full((len(y), 3), 1 / 3), columns=LABELS)
    out = ev.compare_with_reference(y, {"truth": truth, "uniform": uniform, "copy": uniform.copy()},
                                    reference="uniform", n_boot=300)
    verdicts = dict(zip(out["model"], out["verdict"]))
    assert verdicts == {"truth": "better", "copy": "tied"}
    assert out.loc[out["model"] == "truth", "diff"].iloc[0] < 0


def test_log_loss_by_group_splits_by_group():
    y, truth = _signal_data(400)
    groups = np.where(np.arange(len(y)) % 2 == 0, "PL", "SA")
    table = ev.log_loss_by_group(y, {"truth": truth}, groups)
    assert list(table.columns) == ["PL", "SA"]
    assert table.loc["truth"].between(0.3, 1.0).all()


def test_calibration_table_matches_predictions_when_forecasts_are_calibrated():
    rng = np.random.default_rng(1)
    p = rng.uniform(0.1, 0.9, 4000)
    y = np.where(rng.random(4000) < p, "H", "A")
    proba = pd.DataFrame({"A": 1 - p, "D": 0.0, "H": p})
    table = ev.calibration_table(y, proba, "H", bins=8)
    assert list(table.columns) == ["n", "predicted", "observed"]
    assert table["n"].sum() == 4000
    assert table.attrs["avg_gap"] < 0.04


def test_market_proba_uses_ahd_order_and_sums_to_one():
    df = pd.DataFrame({"market_p_home": [0.5, 0.2], "market_p_draw": [0.3, 0.3], "market_p_away": [0.2, 0.5]},
                      index=[10, 11])
    proba = ev.market_proba(df)
    assert list(proba.columns) == ["A", "D", "H"] and list(proba.index) == [10, 11]
    assert proba.loc[10, "H"] == pytest.approx(0.5) and proba.loc[11, "A"] == pytest.approx(0.5)
    assert proba.sum(axis=1).tolist() == pytest.approx([1.0, 1.0])


def test_season_masks_train_on_earlier_seasons_only():
    df = pd.DataFrame({"season": [2022, 2023, 2024, 2024, 2025]})
    train, test = ev.season_masks(df, 2024)
    assert train.tolist() == [True, True, False, False, False]
    assert test.tolist() == [False, False, True, True, False]


def test_calibration_table_copes_with_constant_predictions():
    y = np.array(["H", "A", "H", "D"] * 50)
    proba = pd.DataFrame({"A": 0.3, "D": 0.2, "H": 0.5}, index=range(len(y)))
    table = ev.calibration_table(y, proba, "H", bins=8)
    assert len(table) == 1 and table.loc[0, "n"] == 200
    assert table.loc[0, "predicted"] == pytest.approx(0.5) and table.loc[0, "observed"] == pytest.approx(0.5)
    assert table.attrs["avg_gap"] == pytest.approx(0.0)
