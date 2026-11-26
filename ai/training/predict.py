"""Stage 9: train the final model on ALL history and predict upcoming fixtures.

    # 1. train on every finished match and save a versioned model
    python -m ai.training.predict train --matches PATH/matches.csv --version v1

    # 2. predict fixtures (football-data.org JSON, a flat JSON list, or a CSV; several files allowed)
    python -m ai.training.predict fixtures --model ai/training/models/v1 \\
        --matches PATH/matches.csv --fixtures fixtures.json --out predictions.json

The model is the one season_eval.py evaluates: the pipeline's own CV picks it from
fe.SELECTED_FEATURES, now on every finished match. Output uses the backend's names:
home_win, draw, away_win (probabilities that sum to 1).

Features for a fixture are built by running the SAME feature code as training on
`history + that fixture`, so training and serving cannot drift apart. Fixtures are processed in
groups (same calendar week, no team twice) and a group never sees another group's fixtures,
so an unknown result is never invented. Cost: one feature build (~half a minute per league)
per group. Predictions are meant to be produced by a scheduled batch job and stored, not
computed per web request.

SECURITY: model.joblib is a pickle file and can run code when loaded. Only load models that
this team produced; never one from an unknown source.
"""
import argparse
import json
import platform
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from . import features as fe
from . import preprocessing as pp
from . import season_eval as se
from . import train as tr
from .teams import COMPETITION_CODES, canonical_team

DEFAULT_MODEL_DIR = Path(__file__).parent / "models"
MODEL_FILE, META_FILE = "model.joblib", "metadata.json"
OUTPUT_NAMES = {"H": "home_win", "D": "draw", "A": "away_win"}
STALE_HISTORY_DAYS = 21  # warn when the history ends this long before a fixture
FIXTURE_ID_PREFIX = "__fixture__"


@dataclass
class ModelBundle:
    model: object
    features: list
    version: str
    metadata: dict


# ---------------------------------------------------------------- training / saving

def train_final_model(history: pd.DataFrame, version: str, cache_dir=None, refresh: bool = False) -> ModelBundle:
    """Select (time-ordered CV) and fit the pipeline model on every finished match in `history`.

    history: output of preprocessing.load_static_csv (optionally merged with API data).
    """
    table = se.build_feature_table(history, cache_dir, refresh)
    cols = list(fe.SELECTED_FEATURES)
    best, model, scores = tr.select_model(table[cols], table["result"])
    metadata = {
        "model_version": version,
        "trained_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data": {"first_match": str(table["date"].min().date()), "last_match": str(table["date"].max().date()),
                 "n_matches": int(len(table)), "competitions": sorted(table["competition"].unique())},
        "features": cols,
        "labels": tr.LABELS,
        "output_names": OUTPUT_NAMES,
        "selected_model": best,
        "cv_log_loss": scores.round(6).to_dict("records"),
        "libraries": _library_versions(),
    }
    return ModelBundle(model, cols, version, metadata)


def _library_versions() -> dict:
    import sklearn
    import scipy
    return {"python": platform.python_version(), "pandas": pd.__version__, "numpy": np.__version__,
            "scikit-learn": sklearn.__version__, "scipy": scipy.__version__}


def save_bundle(bundle: ModelBundle, out_dir) -> Path:
    path = Path(out_dir) / bundle.version
    path.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle.model, path / MODEL_FILE)
    (path / META_FILE).write_text(json.dumps(bundle.metadata, indent=2), encoding="utf-8")
    (path / "README.txt").write_text(
        f"{bundle.version}\n\nLoad with ai.training.predict.load_bundle(<this folder>).\n"
        "Input features are listed in metadata.json. Probabilities: home_win, draw, away_win.\n\n"
        "SECURITY: model.joblib is a pickle file and can run code when loaded.\n"
        "Only load models produced by this team, never one from an unknown source.\n", encoding="utf-8")
    return path


def load_bundle(path) -> ModelBundle:
    path = Path(path)
    metadata = json.loads((path / META_FILE).read_text(encoding="utf-8"))
    if metadata["features"] != list(fe.SELECTED_FEATURES):
        raise ValueError(f"model was trained on features {metadata['features']} but the code now selects "
                         f"{list(fe.SELECTED_FEATURES)}; retrain with `python -m ai.training.predict train`")
    return ModelBundle(joblib.load(path / MODEL_FILE), metadata["features"], metadata["model_version"], metadata)


# ---------------------------------------------------------------- fixtures: reading

def _week_start(dates: pd.Series) -> pd.Series:
    """Monday of each date's week (the same weekly cut-off features.dixon_coles uses)."""
    return dates.dt.tz_convert(None).dt.normalize() - pd.to_timedelta(dates.dt.weekday, unit="D")


def _competition_code(value):
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    code = str(value).strip()
    return COMPETITION_CODES.get(code, code.upper())


def load_fixtures(path) -> pd.DataFrame:
    """Read fixtures from CSV, a flat JSON list, or football-data.org JSON ({"matches": [...]}).

    Returns columns: id, competition (or None), home_team, away_team, date (UTC).
    """
    path = Path(path)
    if path.suffix.lower() == ".csv":
        raw = pd.read_csv(path).to_dict("records")
        top_competition = None
    else:
        payload = json.loads(path.read_text(encoding="utf-8"))
        raw = payload["matches"] if isinstance(payload, dict) and "matches" in payload else payload
        top_competition = (payload.get("competition") or {}).get("code") if isinstance(payload, dict) else None
    rows = []
    for item in raw:
        if "homeTeam" in item:  # football-data.org shape
            rows.append({"id": item.get("id"), "home_team": item["homeTeam"]["name"],
                         "away_team": item["awayTeam"]["name"], "date": item.get("utcDate"),
                         "competition": (item.get("competition") or {}).get("code") or top_competition})
        else:
            rows.append({"id": item.get("id", item.get("match_id")), "home_team": item["home_team"],
                         "away_team": item["away_team"], "date": item["date"], "competition": item.get("competition")})
    df = pd.DataFrame(rows, columns=["id", "competition", "home_team", "away_team", "date"])
    df["date"] = pd.to_datetime(df["date"], utc=True)
    df["home_team"], df["away_team"] = df["home_team"].map(canonical_team), df["away_team"].map(canonical_team)
    df["competition"] = df["competition"].map(_competition_code)
    return df


# ---------------------------------------------------------------- fixtures: features

def _week_groups(fixtures: pd.DataFrame) -> list[pd.DataFrame]:
    """Split fixtures so each group is one calendar week with no team appearing twice.

    Within a group no fixture can influence another (Elo/form are per team, and the weekly
    Dixon-Coles cut-off excludes the whole week), so placeholder results never leak.
    """
    groups = []
    week = _week_start(fixtures["date"])
    for _, part in fixtures.assign(_week=week).sort_values("date", kind="stable").groupby("_week"):
        buckets: list[tuple[set, list]] = []
        for idx, row in part.iterrows():
            teams = {row["home_team"], row["away_team"]}
            for used, members in buckets:
                if not used & teams:
                    used |= teams
                    members.append(idx)
                    break
            else:
                buckets.append((set(teams), [idx]))
        groups += [fixtures.loc[members] for _, members in buckets]
    return groups


def fixture_features(history: pd.DataFrame, fixtures: pd.DataFrame, columns=None) -> pd.DataFrame:
    """Model features for fixtures of ONE competition, from `history` (finished matches, API-shaped).

    Runs the training feature code on history + fixture placeholders (0-0, never used by the
    fixtures themselves). Returns a frame indexed like `fixtures`.
    """
    cols = list(columns or fe.SELECTED_FEATURES)
    base = history[pp.API_COLUMNS].to_dict("records")
    parts = []
    for group in _week_groups(fixtures):
        placeholders = [{"id": f"{FIXTURE_ID_PREFIX}{idx}", "home_team": r["home_team"], "away_team": r["away_team"],
                         "date": r["date"], "status": "FINISHED", "home_score": 0, "away_score": 0}
                        for idx, r in group.iterrows()]
        df = pp.label_result(pp.clean(pp.load_api_matches(base + placeholders)))
        df = df.join(fe.build_extended_features(df))
        mine = df[df["id"].astype(str).str.startswith(FIXTURE_ID_PREFIX)].copy()
        mine.index = mine["id"].astype(str).str[len(FIXTURE_ID_PREFIX):].astype(int)
        parts.append(mine[cols])
    return pd.concat(parts).reindex(fixtures.index)


# ---------------------------------------------------------------- predicting

def predict_fixtures(bundle: ModelBundle, history: pd.DataFrame, fixtures: pd.DataFrame, progress=print) -> pd.DataFrame:
    """Probabilities for each fixture: home_win, draw, away_win (+ flags describing data problems).

    history: preprocessing.load_static_csv output (needs competition). fixtures: load_fixtures output.
    Fixtures without a competition take the league their home team plays in.
    """
    team_league = pd.concat([history[["home_team", "competition"]].rename(columns={"home_team": "team"}),
                             history[["away_team", "competition"]].rename(columns={"away_team": "team"})])
    team_league = team_league.groupby("team")["competition"].agg(lambda s: s.value_counts().index[0])
    fx = fixtures.copy().reset_index(drop=True)
    fx["date"] = pd.to_datetime(fx["date"], utc=True)
    fx["competition"] = [c if isinstance(c, str) else team_league.get(h) for c, h in zip(fx["competition"], fx["home_team"])]
    if fx["competition"].isna().any():
        bad = fx.loc[fx["competition"].isna(), "home_team"].tolist()
        raise ValueError(f"cannot tell which league these fixtures belong to (unknown teams, no competition): {bad}")

    out = fx.copy()
    out[["home_win", "draw", "away_win"]] = np.nan
    out["flags"] = [[] for _ in range(len(out))]
    for competition, fixtures_c in fx.groupby("competition"):
        league_history = history[history["competition"] == competition]
        if league_history.empty:
            raise ValueError(f"no history for competition {competition}")
        known = set(league_history["home_team"]) | set(league_history["away_team"])
        last_date = league_history["date"].max()
        progress(f"  {competition}: {len(fixtures_c)} fixtures from {len(league_history)} past matches")
        X = fixture_features(league_history, fixtures_c, bundle.features)
        proba = pd.DataFrame(tr._aligned_proba(bundle.model, X, tr.LABELS), index=X.index, columns=tr.LABELS)
        for idx in fixtures_c.index:
            out.loc[idx, ["home_win", "draw", "away_win"]] = [proba.loc[idx, "H"], proba.loc[idx, "D"], proba.loc[idx, "A"]]
            flags = [f"unknown_team:{t}" for t in (fx.loc[idx, "home_team"], fx.loc[idx, "away_team"]) if t not in known]
            if (fx.loc[idx, "date"] - last_date).days > STALE_HISTORY_DAYS:
                flags.append(f"history_ends:{last_date.date()}")
            out.at[idx, "flags"] = flags
    out["model_version"] = bundle.version
    return out[["id", "competition", "home_team", "away_team", "date", "home_win", "draw", "away_win",
                "model_version", "flags"]]


def to_payload(predictions: pd.DataFrame, bundle: ModelBundle) -> dict:
    rows = []
    for r in predictions.itertuples(index=False):
        rows.append({"match_id": None if pd.isna(r.id) else (int(r.id) if float(r.id).is_integer() else r.id),
                     "competition": r.competition, "home_team": r.home_team, "away_team": r.away_team,
                     "kickoff": r.date.strftime("%Y-%m-%dT%H:%M:%SZ"),
                     "home_win": round(float(r.home_win), 4), "draw": round(float(r.draw), 4),
                     "away_win": round(float(r.away_win), 4), "flags": list(r.flags)})
    return {"model_version": bundle.version, "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "predictions": rows}


# ---------------------------------------------------------------- command line

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Train the final model and predict upcoming fixtures.")
    sub = parser.add_subparsers(dest="command", required=True)

    train = sub.add_parser("train", help="train on all history and save a versioned model")
    train.add_argument("--matches", required=True, help="cleaned history CSV (clean.py output)")
    train.add_argument("--competitions", nargs="+", help="PL PD BL1 SA FL1 (default: all in the file)")
    train.add_argument("--out", default=str(DEFAULT_MODEL_DIR), help="folder that will contain <version>/")
    train.add_argument("--version", default=datetime.now().strftime("v%Y%m%d"))
    train.add_argument("--cache-dir", default=str(se.DEFAULT_CACHE_DIR))
    train.add_argument("--no-cache", action="store_true")
    train.add_argument("--refresh", action="store_true")

    fixtures = sub.add_parser("fixtures", help="predict fixtures with a saved model")
    fixtures.add_argument("--model", required=True, help="folder created by `train` (contains model.joblib)")
    fixtures.add_argument("--matches", required=True, help="cleaned history CSV (clean.py output)")
    fixtures.add_argument("--fixtures", required=True, nargs="+",
                          help="one or more fixture files: football-data.org JSON, flat JSON list, or CSV")
    fixtures.add_argument("--out", required=True, help="JSON file to write")

    args = parser.parse_args(argv)
    if args.command == "train":
        history = pp.load_static_csv(args.matches, competition=args.competitions)
        if history.empty:
            print("No matches found for those competitions.")
            return 1
        print(f"Training on {len(history)} matches. Building features per competition:")
        bundle = train_final_model(history, args.version, None if args.no_cache else args.cache_dir, args.refresh)
        path = save_bundle(bundle, args.out)
        print(f"\nSelected model: {bundle.metadata['selected_model']} (features: {', '.join(bundle.features)})")
        print(pd.DataFrame(bundle.metadata["cv_log_loss"]).to_string(index=False))
        print(f"\nSaved to {path}")
        return 0

    bundle = load_bundle(args.model)
    history = pp.load_static_csv(args.matches)
    wanted = pd.concat([load_fixtures(f) for f in args.fixtures], ignore_index=True)
    print(f"Predicting {len(wanted)} fixtures with {bundle.version}:")
    result = predict_fixtures(bundle, history, wanted)
    payload = to_payload(result, bundle)
    Path(args.out).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    shown = result.drop(columns=["id", "model_version"]).assign(date=result["date"].dt.strftime("%Y-%m-%d %H:%M"))
    print("\n" + shown.round(3).to_string(index=False))
    flagged = int(sum(bool(f) for f in result["flags"]))
    print(f"\nWrote {len(payload['predictions'])} predictions to {args.out}" + (f" ({flagged} with warnings: see flags)" if flagged else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
