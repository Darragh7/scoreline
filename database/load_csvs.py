"""Load the Scoreline CSV files into the Supabase / PostgreSQL tables.

Usage (from the repo root, with the CSV files in one folder):
    python database/load_csvs.py path/to/csv_folder
    python database/load_csvs.py path/to/csv_folder --reload   # empty the data tables first

Needs:  pip install psycopg2-binary python-dotenv
Config: DATABASE_URL in your local .env file (never commit it).

Everything runs in ONE transaction: if any file fails, nothing is loaded.
The CSV headers are checked against what the tables expect before loading.
"""
import argparse
import csv
import io
import os
import re
import sys

import psycopg2
from dotenv import load_dotenv

MATCH_KEY = ["Div", "Date", "Season", "HomeTeam", "AwayTeam"]

# table -> (csv file, expected CSV header, table columns in the same order)
# Tables are listed in load order (parents before children).
TABLES = {
    "team_names": (
        "team_names.csv",
        ["Div", "TeamName", "CanonicalName"],
        ["division", "team_name", "canonical_name"],
    ),
    "matches": (
        "matches.csv",
        ["Div", "Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "FTR", "HS", "AS", "HST", "AST",
         "HC", "AC", "HY", "AY", "HR", "AR", "Season", "SourceFile", "League"],
        ["division", "match_date", "home_team", "away_team", "home_goals", "away_goals", "result",
         "home_shots", "away_shots", "home_shots_on_target", "away_shots_on_target",
         "home_corners", "away_corners", "home_yellows", "away_yellows", "home_reds", "away_reds",
         "season", "source_file", "league"],
    ),
}

FEATURE_STATS = (
    ["pts5", "pts10", "pts_venue5", "gf5", "gf10", "gf_venue5", "ga5", "ga10", "ga_venue5",
     "sf5", "sa5", "sotf5", "sota5", "rest_days", "n_prev"]
)
features_header = (
    MATCH_KEY
    + [f"{s}_h" for s in FEATURE_STATS]
    + [f"{s}_a" for s in FEATURE_STATS]
    + ["pts5_diff", "gf5_diff", "ga5_diff", "pts10_diff", "sotf5_diff", "sota5_diff",
       "rest_days_diff", "home_elo_pre", "away_elo_pre", "elo_diff",
       "div_D1", "div_E0", "div_F1", "div_I1", "div_SP1", "y"]
)
features_columns = ["division", "match_date", "season", "home_team", "away_team"] + [
    c.lower() for c in features_header[5:]
]
TABLES["features"] = ("features.csv", features_header, features_columns)

TABLES["elo_features"] = (
    "elo_features.csv",
    MATCH_KEY + ["home_elo_pre", "away_elo_pre", "elo_diff", "elo_p_home", "elo_p_draw", "elo_p_away"],
    ["division", "match_date", "season", "home_team", "away_team",
     "home_elo_pre", "away_elo_pre", "elo_diff", "elo_p_home", "elo_p_draw", "elo_p_away"],
)
TABLES["odds"] = (
    "odds.csv",
    ["Date", "HomeTeam", "AwayTeam", "odds_source", "market_margin",
     "market_p_home", "market_p_draw", "market_p_away"],
    ["match_date", "home_team", "away_team", "odds_source", "market_margin",
     "market_p_home", "market_p_draw", "market_p_away"],
)
TABLES["poisson_predictions"] = (
    "poisson_predictions.csv",
    MATCH_KEY + ["exp_home_goals", "exp_away_goals", "poisson_p_home", "poisson_p_draw", "poisson_p_away"],
    ["division", "match_date", "season", "home_team", "away_team",
     "exp_home_goals", "exp_away_goals", "poisson_p_home", "poisson_p_draw", "poisson_p_away"],
)
_mpv_models = ["logistic_regression", "random_forest", "xgboost", "lr_and_xgboost_average"]
_mpv_cols = [f"{m}_p_{o}" for m in _mpv_models for o in ("home", "draw", "away")]
TABLES["model_predictions_val"] = (
    "model_predictions_val.csv",
    MATCH_KEY + _mpv_cols,
    ["division", "match_date", "season", "home_team", "away_team"] + _mpv_cols,
)
_metric_cols = ["log_loss", "brier", "rps", "accuracy"]
TABLES["baseline_metrics"] = (
    "baseline_metrics.csv",
    ["model", "season", "n_matches"] + _metric_cols,
    ["model", "season", "n_matches"] + _metric_cols,
)
TABLES["final_test"] = (
    "final_test.csv",
    ["model", "season", "n_matches"] + _metric_cols,
    ["model", "season", "n_matches"] + _metric_cols,
)
TABLES["evaluation_val"] = (
    "evaluation_val.csv",
    ["model", "n"] + _metric_cols,
    ["model", "n"] + _metric_cols,
)


# Whole-number columns. Some CSVs store them as "8.0" (because of empty cells), which an
# integer column rejects, so "8.0" is turned into "8" before loading.
INT_COLUMNS = {
    "home_shots", "away_shots", "home_shots_on_target", "away_shots_on_target",
    "home_corners", "away_corners", "home_yellows", "away_yellows", "home_reds", "away_reds",
    "n_prev_h", "n_prev_a", "div_d1", "div_e0", "div_f1", "div_i1", "div_sp1", "y",
    "n_matches", "n",
}
WHOLE_FLOAT = re.compile(r"^-?\d+\.0+$")


def read_header(path):
    with open(path, encoding="utf-8-sig") as f:
        return f.readline().strip().split(",")


def cleaned_csv(path, columns):
    """Return the CSV as an in-memory file with whole numbers written without '.0'."""
    int_idx = [i for i, c in enumerate(columns) if c in INT_COLUMNS]
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    with open(path, encoding="utf-8-sig", newline="") as f:
        for n, row in enumerate(csv.reader(f)):
            if n > 0:  # skip the header row
                for i in int_idx:
                    if WHOLE_FLOAT.match(row[i]):
                        row[i] = row[i].split(".")[0]
            writer.writerow(row)
    out.seek(0)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv_dir", help="folder containing the CSV files")
    parser.add_argument("--reload", action="store_true", help="empty the data tables before loading")
    args = parser.parse_args()

    # Check all files and headers BEFORE touching the database.
    for table, (csv_name, header, _cols) in TABLES.items():
        path = os.path.join(args.csv_dir, csv_name)
        if not os.path.isfile(path):
            sys.exit(f"Missing file: {path}")
        if read_header(path) != header:
            sys.exit(f"{csv_name}: header does not match what the table expects.\n"
                     f"  expected: {header}\n  found:    {read_header(path)}")

    load_dotenv()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set. Put it in your local .env file.")

    conn = psycopg2.connect(url)
    try:
        with conn, conn.cursor() as cur:  # one transaction: commit at the end, rollback on error
            if args.reload:
                cur.execute("TRUNCATE " + ", ".join(TABLES) + ";")
                print("Emptied data tables.")
            for table, (csv_name, _header, cols) in TABLES.items():
                cur.execute(f"SELECT count(*) FROM {table};")
                if cur.fetchone()[0] > 0:
                    sys.exit(f"{table} already has rows. Use --reload to replace the data.")
                sql = f"COPY {table} ({', '.join(cols)}) FROM STDIN WITH (FORMAT csv, HEADER true)"
                cur.copy_expert(sql, cleaned_csv(os.path.join(args.csv_dir, csv_name), cols))
                cur.execute(f"SELECT count(*) FROM {table};")
                print(f"{table:24s} {cur.fetchone()[0]:>7d} rows")
        print("Done. All tables loaded.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
