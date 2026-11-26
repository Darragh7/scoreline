"""Season-based evaluation of the ai/training pipeline against baselines and bookmaker odds.

Answers: "how good is the model the pipeline selects, compared with simple baselines and the
bookmakers, on a season it was not trained on?"

    python -m ai.training.season_eval --matches PATH/matches.csv --odds PATH/odds.csv --season 2024

--matches  cleaned history (ai/ml_pipeline/clean.py output, read by preprocessing.load_static_csv)
--odds     bookmaker probabilities (ai/ml_pipeline/odds.py output); optional, adds the benchmark
--season   start year of the season to evaluate (2024 = 2024/25). The model is selected and
           trained ONLY on earlier seasons, using the pipeline's own time-ordered CV.

Seasons from FINAL_TEST_SEASON (2025/26) on are the held-out final test: use them once, after
every choice is made, with --confirm-final-test. Do not re-run to improve the number.

Features are built per competition (Elo, form and Dixon-Coles are league-specific), then the
leagues are pooled for training and evaluation. Building takes a few minutes the first time and
is cached as CSV under ai/training/data/ (git-ignored); use --refresh to rebuild.
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import evaluation as ev
from . import features as fe
from . import preprocessing as pp
from . import train as tr

DEFAULT_CACHE_DIR = Path(__file__).parent / "data"
FINAL_TEST_SEASON = 2025  # 2025/26: held out for one final, honest test


def _competition_table(group: pd.DataFrame, cache_dir, refresh: bool) -> pd.DataFrame:
    """Cleaned matches + features for ONE competition (+ id, competition, season columns)."""
    competition = group["competition"].iloc[0]
    df = pp.label_result(pp.clean(pp.load_api_matches(group[pp.API_COLUMNS].to_dict("records"))))
    cache = None
    if cache_dir is not None:
        cache = Path(cache_dir) / f"season_eval_features_{competition}_{len(df)}_{df['date'].max():%Y%m%d}.csv"
    if cache is not None and cache.exists() and not refresh:
        feats = pd.read_csv(cache, index_col=0)
        print(f"  {competition}: {len(df)} matches, features loaded from cache")
    else:
        print(f"  {competition}: {len(df)} matches, building features (can take a minute)...")
        feats = fe.build_extended_features(df)
        if cache is not None:
            cache.parent.mkdir(parents=True, exist_ok=True)
            feats.to_csv(cache)
    return df.join(feats).merge(group[["id", "competition", "season"]], on="id", how="left")


def build_feature_table(static: pd.DataFrame, cache_dir=None, refresh: bool = False) -> pd.DataFrame:
    """One pooled, date-sorted table: match columns + every extended feature + competition, season."""
    parts = [_competition_table(g, cache_dir, refresh) for _, g in static.groupby("competition", sort=True)]
    table = pd.concat(parts, ignore_index=True)
    return table.sort_values("date", kind="stable").reset_index(drop=True)


def attach_market(table: pd.DataFrame, odds: pd.DataFrame) -> pd.DataFrame:
    """Add market_p_home/draw/away by (home, away, calendar day). Matches without odds stay NaN."""
    odds = odds.assign(_day=odds["date"].dt.normalize()).drop(columns=["date"])
    odds = odds.drop_duplicates(["home_team", "away_team", "_day"])
    merged = table.assign(_day=table["date"].dt.normalize()).merge(
        odds, on=["home_team", "away_team", "_day"], how="left")
    return merged.drop(columns="_day")


def _frame(model, X: pd.DataFrame, index) -> pd.DataFrame:
    # tr._aligned_proba is the pipeline's own helper (handles classes missing from a fold).
    return pd.DataFrame(tr._aligned_proba(model, X, tr.LABELS), index=index, columns=tr.LABELS)


def evaluate_season(table: pd.DataFrame, season: int, features=None, n_boot: int = 2000) -> dict:
    """Select + train on seasons < `season`, evaluate on `season`. Returns all tables in a dict."""
    cols = list(features or fe.SELECTED_FEATURES)
    has_market = "market_p_home" in table.columns
    train_mask, eval_mask = ev.season_masks(table, season)
    train, test = table[train_mask], table[eval_mask]
    without_odds = 0
    if has_market:
        keep = test["market_p_home"].notna()
        without_odds, test = int((~keep).sum()), test[keep]
    if train.empty or test.empty:
        raise ValueError(f"season {season}: {len(train)} training rows and {len(test)} evaluation rows")

    y_train = train["result"]
    best, model, selection = tr.select_model(train[cols], y_train)  # CV on training seasons only
    selected_name = f"Pipeline model ({best})"

    prior = y_train.value_counts(normalize=True).reindex(tr.LABELS).fillna(0.0).to_numpy()
    elo = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)).fit(train[["elo_diff"]], y_train)
    dc = test[["dc_p_away", "dc_p_draw", "dc_p_home"]].to_numpy(float)
    probas = {
        selected_name: _frame(model, test[cols], test.index),
        "Historical frequencies": pd.DataFrame(np.tile(prior, (len(test), 1)), index=test.index, columns=tr.LABELS),
        "Elo only": _frame(elo, test[["elo_diff"]], test.index),
        "Dixon-Coles (raw)": pd.DataFrame(dc / dc.sum(axis=1, keepdims=True), index=test.index, columns=tr.LABELS),
    }
    probas["Average (pipeline + Elo + Dixon-Coles)"] = (
        probas[selected_name] + probas["Elo only"] + probas["Dixon-Coles (raw)"]) / 3
    if has_market:
        probas["Bookmakers (margin removed)"] = ev.market_proba(test)

    y = test["result"]
    comparisons = [ev.compare_with_reference(y, probas, "Elo only", n_boot)]
    if has_market:
        comparisons.append(ev.compare_with_reference(y, probas, "Bookmakers (margin removed)", n_boot))
    return {
        "season": season, "n_train": len(train), "n_eval": len(test), "n_without_odds": without_odds,
        "selected": best, "selected_name": selected_name, "features": cols, "selection": selection,
        "scores": ev.score_table(y, probas),
        "comparisons": comparisons,
        "by_competition": ev.log_loss_by_group(y, probas, test["competition"]),
        "calibration": {o: ev.calibration_table(y, probas[selected_name], o) for o in tr.LABELS},
    }


def _md_table(df: pd.DataFrame, digits: int = 4) -> str:
    cols = list(df.columns)
    lines = ["| " + " | ".join(str(c) for c in cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for row in df.itertuples(index=False, name=None):  # keeps each column's own type (ints stay ints)
        cells = [f"{v:.{digits}f}" if isinstance(v, (float, np.floating)) else str(v) for v in row]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def format_report(result: dict) -> str:
    season = result["season"]
    names = {"A": "Away win", "D": "Draw", "H": "Home win"}
    out = [
        f"# Season evaluation: {season}/{(season + 1) % 100:02d}",
        "",
        f"- Trained on {result['n_train']} matches from seasons before {season}; evaluated on {result['n_eval']} matches.",
        f"- Model chosen by time-ordered CV on the training seasons: **{result['selected']}**; features: {', '.join(result['features'])}.",
    ]
    if result["n_without_odds"]:
        out.append(f"- {result['n_without_odds']} matches without bookmaker odds were left out of every row, so all rows are comparable.")
    out += ["", "## Scores (lower is better, except accuracy)", "", _md_table(result["scores"]), "",
            "## Are the differences real? (average log-loss difference, 95% bootstrap interval)", "",
            "Negative = better than the reference; if the interval contains 0 the models are tied.", ""]
    for comparison in result["comparisons"]:
        out += [f"Reference: **{comparison['reference'].iloc[0]}**", "", _md_table(comparison.drop(columns="reference")), ""]
    out += ["## Log loss by competition", "",
            _md_table(result["by_competition"].reset_index().rename(columns={"index": "model"})), "",
            "Each league has only a few hundred matches, so do not rank close models within one league.", "",
            f"## Calibration of {result['selected_name']}", "",
            "Predicted vs observed frequency in quantile bins; gaps under about 5 points are noise at this size.", ""]
    for outcome in tr.LABELS:
        table = result["calibration"][outcome]
        out += [f"{names[outcome]}: average gap {table.attrs['avg_gap'] * 100:.1f} points", "", _md_table(table), ""]
    out += ["## Model selection (CV log loss on the training seasons)", "",
            _md_table(result["selection"]), ""]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Season-based evaluation of the ai/training pipeline.")
    parser.add_argument("--matches", required=True, help="cleaned history CSV (clean.py output)")
    parser.add_argument("--odds", help="bookmaker probabilities CSV (odds.py output)")
    parser.add_argument("--season", type=int, default=2024, help="start year of the season to evaluate")
    parser.add_argument("--competitions", nargs="+", help="PL PD BL1 SA FL1 (default: all in the file)")
    parser.add_argument("--cache-dir", default=str(DEFAULT_CACHE_DIR))
    parser.add_argument("--no-cache", action="store_true", help="do not read or write the feature cache")
    parser.add_argument("--refresh", action="store_true", help="rebuild cached features")
    parser.add_argument("--n-boot", type=int, default=2000)
    parser.add_argument("--out", help="also write the report to this Markdown file")
    parser.add_argument("--confirm-final-test", action="store_true",
                        help=f"required for seasons from {FINAL_TEST_SEASON} on (the held-out final test)")
    args = parser.parse_args(argv)

    if args.season >= FINAL_TEST_SEASON and not args.confirm_final_test:
        print(f"Season {args.season} is the held-out final test. Use it once, after all choices are made, "
              f"by adding --confirm-final-test. Nothing was run.")
        return 2

    static = pp.load_static_csv(args.matches, competition=args.competitions)
    if static.empty:
        print("No matches found for those competitions.")
        return 1
    print(f"Loaded {len(static)} matches. Building features per competition:")
    table = build_feature_table(static, None if args.no_cache else args.cache_dir, args.refresh)
    if args.odds:
        table = attach_market(table, pp.load_odds_csv(args.odds))
    report = format_report(evaluate_season(table, args.season, n_boot=args.n_boot))
    print("\n" + report)
    if args.out:
        Path(args.out).write_text(report, encoding="utf-8")
        print(f"\nReport written to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
