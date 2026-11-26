"""Stage 8 (evaluate, extended): compare models against baselines and bookmaker odds.

Pure functions on probability frames with columns A, D, H (the convention in train.py).
Adds what train.evaluate does not report: ranked probability score (RPS), per-group
breakdowns, calibration tables and a "better / tied / worse" verdict from the paired
bootstrap that already lives in train.paired_bootstrap_ci.
"""
import numpy as np
import pandas as pd

from .train import LABELS, paired_bootstrap_ci, prob_metrics

MARKET_COLUMNS = {"A": "market_p_away", "D": "market_p_draw", "H": "market_p_home"}


def rps(y, proba: pd.DataFrame) -> float:
    """Ranked probability score for the ordered outcomes A < D < H (lower is better).

    Unlike log loss it knows that predicting a draw when the home team wins is "less wrong"
    than predicting an away win.
    """
    labels = list(proba.columns)
    P = proba.to_numpy(float)
    onehot = (np.asarray(y)[:, None] == np.array(labels)[None, :]).astype(float)
    cum_p = np.cumsum(P, axis=1)[:, :-1]
    cum_y = np.cumsum(onehot, axis=1)[:, :-1]
    return float(np.mean(np.sum((cum_p - cum_y) ** 2, axis=1) / (len(labels) - 1)))


def market_proba(df: pd.DataFrame) -> pd.DataFrame:
    """Bookmaker probabilities as an A/D/H frame (rows renormalised to sum to 1)."""
    P = df[[MARKET_COLUMNS[label] for label in LABELS]].to_numpy(float)
    return pd.DataFrame(P / P.sum(axis=1, keepdims=True), index=df.index, columns=LABELS)


def season_masks(df: pd.DataFrame, season: int) -> tuple[pd.Series, pd.Series]:
    """(train, evaluate) masks: everything before `season`, and `season` itself."""
    return df["season"] < season, df["season"] == season


def score_table(y, probas: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """One row per model: n, log loss, Brier, RPS, accuracy (sorted by log loss)."""
    rows = []
    for name, proba in probas.items():
        m = prob_metrics(y, proba)
        rows.append({"model": name, "n": len(y), "log_loss": m["log_loss"], "brier": m["brier"],
                     "rps": rps(y, proba), "accuracy": m["accuracy"]})
    return pd.DataFrame(rows).sort_values("log_loss").reset_index(drop=True)


def compare_with_reference(y, probas: dict[str, pd.DataFrame], reference: str,
                           n_boot: int = 2000, seed: int = 0) -> pd.DataFrame:
    """Average log-loss difference vs `reference` with a 95% bootstrap interval.

    Negative = better than the reference. If the interval contains 0 the verdict is "tied":
    the difference could be luck. Matches are resampled, so this reflects one season's noise.
    """
    rows = []
    for name, proba in probas.items():
        if name == reference:
            continue
        diff, low, high = paired_bootstrap_ci(y, proba, probas[reference], n_boot=n_boot, seed=seed)
        verdict = "better" if high < 0 else "worse" if low > 0 else "tied"
        rows.append({"model": name, "reference": reference, "diff": diff, "ci_low": low,
                     "ci_high": high, "verdict": verdict})
    return pd.DataFrame(rows)


def log_loss_by_group(y, probas: dict[str, pd.DataFrame], groups) -> pd.DataFrame:
    """Log loss per group (e.g. competition) for every model: rows = models, columns = groups."""
    y, groups = np.asarray(y), np.asarray(groups)
    out = {}
    for name, proba in probas.items():
        out[name] = {g: prob_metrics(y[groups == g], proba[groups == g])["log_loss"]
                     for g in sorted(set(groups))}
    return pd.DataFrame(out).T


def calibration_table(y, proba: pd.DataFrame, outcome: str, bins: int = 8) -> pd.DataFrame:
    """Predicted vs observed frequency of one outcome (A, D or H) in quantile bins.

    With ~200 matches per bin, gaps under about 5 points are noise.
    """
    p = proba[outcome].to_numpy(float)
    hit = (np.asarray(y) == outcome).astype(float)
    try:
        binned = pd.qcut(p, q=bins, duplicates="drop")
    except ValueError:  # (almost) constant predictions cannot be split into quantile bins
        binned = pd.Series(0, index=range(len(p)))
    table = (pd.DataFrame({"predicted": p, "observed": hit, "bin": np.asarray(binned)})
             .groupby("bin", observed=True)
             .agg(n=("observed", "size"), predicted=("predicted", "mean"), observed=("observed", "mean"))
             .reset_index(drop=True))
    if table.empty:  # qcut gave no usable bins: fall back to a single bin
        table = pd.DataFrame({"n": [len(p)], "predicted": [p.mean()], "observed": [hit.mean()]})
    table.attrs["avg_gap"] = float((table["n"] * (table["observed"] - table["predicted"]).abs()).sum()
                                   / table["n"].sum())
    return table
