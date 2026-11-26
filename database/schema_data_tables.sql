-- Scoreline: football data tables (one table per CSV file)
-- Database: PostgreSQL (Supabase)
--
-- Run this AFTER schema.sql (users / user_passwords).
-- Tables are listed in dependency order: team_names -> matches -> everything else.
--
-- Notes
--  * Column names are lowercase snake_case so nobody has to use quotes in SQL.
--    The CSV column "AS" (away shots) is a reserved word in SQL, so it is away_shots.
--  * A match is identified by (match_date, home_team, away_team). This is unique in
--    every CSV, so it is the primary key of matches, and the per-match tables
--    (features, elo_features, odds, poisson_predictions, model_predictions_val)
--    point back to it with a foreign key.
--  * Columns are in the same order as the CSV files, so loading is a straight copy.
--  * Row Level Security is on for every table with no policies, so the public API
--    cannot read or write them. The backend connects directly to Postgres.

-- ---------------------------------------------------------------------------
-- team_names.csv
-- ---------------------------------------------------------------------------
CREATE TABLE team_names (
    division       VARCHAR(3)  NOT NULL,
    team_name      VARCHAR(50) NOT NULL,
    canonical_name VARCHAR(50) NOT NULL,
    PRIMARY KEY (team_name),
    CONSTRAINT team_division_valid CHECK (division IN ('D1', 'E0', 'F1', 'I1', 'SP1'))
);

-- ---------------------------------------------------------------------------
-- matches.csv  (results and match stats)
-- division: D1 Bundesliga, E0 Premier League, F1 Ligue 1, I1 Serie A, SP1 La Liga
-- result: H home win, D draw, A away win
-- ---------------------------------------------------------------------------
CREATE TABLE matches (
    division              VARCHAR(3)  NOT NULL,
    match_date            DATE        NOT NULL,
    home_team             VARCHAR(50) NOT NULL REFERENCES team_names (team_name),
    away_team             VARCHAR(50) NOT NULL REFERENCES team_names (team_name),
    home_goals            SMALLINT    NOT NULL,
    away_goals            SMALLINT    NOT NULL,
    result                CHAR(1)     NOT NULL,
    home_shots            SMALLINT,
    away_shots            SMALLINT,
    home_shots_on_target  SMALLINT,
    away_shots_on_target  SMALLINT,
    home_corners          SMALLINT,
    away_corners          SMALLINT,
    home_yellows          SMALLINT,
    away_yellows          SMALLINT,
    home_reds             SMALLINT,
    away_reds             SMALLINT,
    season                VARCHAR(7)  NOT NULL,
    source_file           VARCHAR(20),
    league                VARCHAR(30) NOT NULL,
    PRIMARY KEY (match_date, home_team, away_team),
    CONSTRAINT match_division_valid CHECK (division IN ('D1', 'E0', 'F1', 'I1', 'SP1')),
    CONSTRAINT match_teams_differ   CHECK (home_team <> away_team),
    CONSTRAINT match_goals_valid    CHECK (home_goals >= 0 AND away_goals >= 0),
    CONSTRAINT match_result_matches_goals CHECK (
        (result = 'H' AND home_goals > away_goals)
        OR (result = 'D' AND home_goals = away_goals)
        OR (result = 'A' AND home_goals < away_goals)
    ),
    CONSTRAINT match_stats_valid CHECK (
        COALESCE(home_shots, 0) >= 0 AND COALESCE(away_shots, 0) >= 0
        AND COALESCE(home_shots_on_target, 0) >= 0 AND COALESCE(away_shots_on_target, 0) >= 0
        AND COALESCE(home_corners, 0) >= 0 AND COALESCE(away_corners, 0) >= 0
        AND COALESCE(home_yellows, 0) >= 0 AND COALESCE(away_yellows, 0) >= 0
        AND COALESCE(home_reds, 0) >= 0 AND COALESCE(away_reds, 0) >= 0
    )
);

-- ---------------------------------------------------------------------------
-- features.csv  (model input features)
-- suffix _h = home team, _a = away team, _diff = home minus away
-- y: 0 = home win, 1 = draw, 2 = away win
-- Many feature values are empty early in a season / for new teams (NULL is expected).
-- ---------------------------------------------------------------------------
CREATE TABLE features (
    division         VARCHAR(3)  NOT NULL,
    match_date       DATE        NOT NULL,
    season           VARCHAR(7)  NOT NULL,
    home_team        VARCHAR(50) NOT NULL,
    away_team        VARCHAR(50) NOT NULL,
    pts5_h           DOUBLE PRECISION,
    pts10_h          DOUBLE PRECISION,
    pts_venue5_h     DOUBLE PRECISION,
    gf5_h            DOUBLE PRECISION,
    gf10_h           DOUBLE PRECISION,
    gf_venue5_h      DOUBLE PRECISION,
    ga5_h            DOUBLE PRECISION,
    ga10_h           DOUBLE PRECISION,
    ga_venue5_h      DOUBLE PRECISION,
    sf5_h            DOUBLE PRECISION,
    sa5_h            DOUBLE PRECISION,
    sotf5_h          DOUBLE PRECISION,
    sota5_h          DOUBLE PRECISION,
    rest_days_h      DOUBLE PRECISION,
    n_prev_h         SMALLINT    NOT NULL,
    pts5_a           DOUBLE PRECISION,
    pts10_a          DOUBLE PRECISION,
    pts_venue5_a     DOUBLE PRECISION,
    gf5_a            DOUBLE PRECISION,
    gf10_a           DOUBLE PRECISION,
    gf_venue5_a      DOUBLE PRECISION,
    ga5_a            DOUBLE PRECISION,
    ga10_a           DOUBLE PRECISION,
    ga_venue5_a      DOUBLE PRECISION,
    sf5_a            DOUBLE PRECISION,
    sa5_a            DOUBLE PRECISION,
    sotf5_a          DOUBLE PRECISION,
    sota5_a          DOUBLE PRECISION,
    rest_days_a      DOUBLE PRECISION,
    n_prev_a         SMALLINT    NOT NULL,
    pts5_diff        DOUBLE PRECISION,
    gf5_diff         DOUBLE PRECISION,
    ga5_diff         DOUBLE PRECISION,
    pts10_diff       DOUBLE PRECISION,
    sotf5_diff       DOUBLE PRECISION,
    sota5_diff       DOUBLE PRECISION,
    rest_days_diff   DOUBLE PRECISION,
    home_elo_pre     DOUBLE PRECISION NOT NULL,
    away_elo_pre     DOUBLE PRECISION NOT NULL,
    elo_diff         DOUBLE PRECISION NOT NULL,
    div_d1           SMALLINT    NOT NULL,
    div_e0           SMALLINT    NOT NULL,
    div_f1           SMALLINT    NOT NULL,
    div_i1           SMALLINT    NOT NULL,
    div_sp1          SMALLINT    NOT NULL,
    y                SMALLINT    NOT NULL,
    PRIMARY KEY (match_date, home_team, away_team),
    FOREIGN KEY (match_date, home_team, away_team)
        REFERENCES matches (match_date, home_team, away_team),
    CONSTRAINT features_division_valid CHECK (division IN ('D1', 'E0', 'F1', 'I1', 'SP1')),
    CONSTRAINT features_n_prev_valid   CHECK (n_prev_h >= 0 AND n_prev_a >= 0),
    CONSTRAINT features_div_flags_valid CHECK (
        div_d1 IN (0, 1) AND div_e0 IN (0, 1) AND div_f1 IN (0, 1)
        AND div_i1 IN (0, 1) AND div_sp1 IN (0, 1)
        AND div_d1 + div_e0 + div_f1 + div_i1 + div_sp1 = 1
    ),
    CONSTRAINT features_y_valid CHECK (y IN (0, 1, 2))
);

-- ---------------------------------------------------------------------------
-- elo_features.csv  (Elo ratings and Elo-based probabilities)
-- ---------------------------------------------------------------------------
CREATE TABLE elo_features (
    division      VARCHAR(3)  NOT NULL,
    match_date    DATE        NOT NULL,
    season        VARCHAR(7)  NOT NULL,
    home_team     VARCHAR(50) NOT NULL,
    away_team     VARCHAR(50) NOT NULL,
    home_elo_pre  DOUBLE PRECISION NOT NULL,
    away_elo_pre  DOUBLE PRECISION NOT NULL,
    elo_diff      DOUBLE PRECISION NOT NULL,
    elo_p_home    DOUBLE PRECISION NOT NULL,
    elo_p_draw    DOUBLE PRECISION NOT NULL,
    elo_p_away    DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (match_date, home_team, away_team),
    FOREIGN KEY (match_date, home_team, away_team)
        REFERENCES matches (match_date, home_team, away_team),
    CONSTRAINT elo_division_valid CHECK (division IN ('D1', 'E0', 'F1', 'I1', 'SP1')),
    CONSTRAINT elo_probs_valid CHECK (
        elo_p_home BETWEEN 0 AND 1 AND elo_p_draw BETWEEN 0 AND 1 AND elo_p_away BETWEEN 0 AND 1
        AND abs(elo_p_home + elo_p_draw + elo_p_away - 1) <= 0.001
    )
);

-- ---------------------------------------------------------------------------
-- odds.csv  (bookmaker odds converted to probabilities, margin removed)
-- ---------------------------------------------------------------------------
CREATE TABLE odds (
    match_date     DATE        NOT NULL,
    home_team      VARCHAR(50) NOT NULL,
    away_team      VARCHAR(50) NOT NULL,
    odds_source    VARCHAR(30) NOT NULL,
    market_margin  DOUBLE PRECISION NOT NULL,
    market_p_home  DOUBLE PRECISION NOT NULL,
    market_p_draw  DOUBLE PRECISION NOT NULL,
    market_p_away  DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (match_date, home_team, away_team),
    FOREIGN KEY (match_date, home_team, away_team)
        REFERENCES matches (match_date, home_team, away_team),
    CONSTRAINT odds_margin_valid CHECK (market_margin >= 0),
    CONSTRAINT odds_probs_valid CHECK (
        market_p_home BETWEEN 0 AND 1 AND market_p_draw BETWEEN 0 AND 1 AND market_p_away BETWEEN 0 AND 1
        AND abs(market_p_home + market_p_draw + market_p_away - 1) <= 0.001
    )
);

-- ---------------------------------------------------------------------------
-- poisson_predictions.csv  (Poisson model: expected goals and probabilities)
-- ---------------------------------------------------------------------------
CREATE TABLE poisson_predictions (
    division        VARCHAR(3)  NOT NULL,
    match_date      DATE        NOT NULL,
    season          VARCHAR(7)  NOT NULL,
    home_team       VARCHAR(50) NOT NULL,
    away_team       VARCHAR(50) NOT NULL,
    exp_home_goals  DOUBLE PRECISION NOT NULL,
    exp_away_goals  DOUBLE PRECISION NOT NULL,
    poisson_p_home  DOUBLE PRECISION NOT NULL,
    poisson_p_draw  DOUBLE PRECISION NOT NULL,
    poisson_p_away  DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (match_date, home_team, away_team),
    FOREIGN KEY (match_date, home_team, away_team)
        REFERENCES matches (match_date, home_team, away_team),
    CONSTRAINT poisson_division_valid CHECK (division IN ('D1', 'E0', 'F1', 'I1', 'SP1')),
    CONSTRAINT poisson_goals_valid CHECK (exp_home_goals >= 0 AND exp_away_goals >= 0),
    CONSTRAINT poisson_probs_valid CHECK (
        poisson_p_home BETWEEN 0 AND 1 AND poisson_p_draw BETWEEN 0 AND 1 AND poisson_p_away BETWEEN 0 AND 1
        AND abs(poisson_p_home + poisson_p_draw + poisson_p_away - 1) <= 0.001
    )
);

-- ---------------------------------------------------------------------------
-- model_predictions_val.csv  (validation-season predictions from the ML models)
-- ---------------------------------------------------------------------------
CREATE TABLE model_predictions_val (
    division                        VARCHAR(3)  NOT NULL,
    match_date                      DATE        NOT NULL,
    season                          VARCHAR(7)  NOT NULL,
    home_team                       VARCHAR(50) NOT NULL,
    away_team                       VARCHAR(50) NOT NULL,
    logistic_regression_p_home      DOUBLE PRECISION NOT NULL,
    logistic_regression_p_draw      DOUBLE PRECISION NOT NULL,
    logistic_regression_p_away      DOUBLE PRECISION NOT NULL,
    random_forest_p_home            DOUBLE PRECISION NOT NULL,
    random_forest_p_draw            DOUBLE PRECISION NOT NULL,
    random_forest_p_away            DOUBLE PRECISION NOT NULL,
    xgboost_p_home                  DOUBLE PRECISION NOT NULL,
    xgboost_p_draw                  DOUBLE PRECISION NOT NULL,
    xgboost_p_away                  DOUBLE PRECISION NOT NULL,
    lr_and_xgboost_average_p_home   DOUBLE PRECISION NOT NULL,
    lr_and_xgboost_average_p_draw   DOUBLE PRECISION NOT NULL,
    lr_and_xgboost_average_p_away   DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (match_date, home_team, away_team),
    FOREIGN KEY (match_date, home_team, away_team)
        REFERENCES matches (match_date, home_team, away_team),
    CONSTRAINT mpv_division_valid CHECK (division IN ('D1', 'E0', 'F1', 'I1', 'SP1')),
    CONSTRAINT mpv_logreg_valid CHECK (
        logistic_regression_p_home BETWEEN 0 AND 1 AND logistic_regression_p_draw BETWEEN 0 AND 1
        AND logistic_regression_p_away BETWEEN 0 AND 1
        AND abs(logistic_regression_p_home + logistic_regression_p_draw + logistic_regression_p_away - 1) <= 0.001
    ),
    CONSTRAINT mpv_forest_valid CHECK (
        random_forest_p_home BETWEEN 0 AND 1 AND random_forest_p_draw BETWEEN 0 AND 1
        AND random_forest_p_away BETWEEN 0 AND 1
        AND abs(random_forest_p_home + random_forest_p_draw + random_forest_p_away - 1) <= 0.001
    ),
    CONSTRAINT mpv_xgboost_valid CHECK (
        xgboost_p_home BETWEEN 0 AND 1 AND xgboost_p_draw BETWEEN 0 AND 1
        AND xgboost_p_away BETWEEN 0 AND 1
        AND abs(xgboost_p_home + xgboost_p_draw + xgboost_p_away - 1) <= 0.001
    ),
    CONSTRAINT mpv_average_valid CHECK (
        lr_and_xgboost_average_p_home BETWEEN 0 AND 1 AND lr_and_xgboost_average_p_draw BETWEEN 0 AND 1
        AND lr_and_xgboost_average_p_away BETWEEN 0 AND 1
        AND abs(lr_and_xgboost_average_p_home + lr_and_xgboost_average_p_draw + lr_and_xgboost_average_p_away - 1) <= 0.001
    )
);

-- ---------------------------------------------------------------------------
-- Model evaluation results (small summary tables, no link to matches)
-- log_loss / brier / rps: lower is better. accuracy: share of correct predictions (0 to 1).
-- log_loss, brier, rps are empty for baselines that give no probabilities.
-- ---------------------------------------------------------------------------

-- baseline_metrics.csv
CREATE TABLE baseline_metrics (
    model      VARCHAR(60) NOT NULL,
    season     VARCHAR(40) NOT NULL,
    n_matches  INT         NOT NULL,
    log_loss   DOUBLE PRECISION,
    brier      DOUBLE PRECISION,
    rps        DOUBLE PRECISION,
    accuracy   DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (model, season),
    CONSTRAINT baseline_n_valid        CHECK (n_matches > 0),
    CONSTRAINT baseline_accuracy_valid CHECK (accuracy BETWEEN 0 AND 1)
);

-- final_test.csv
CREATE TABLE final_test (
    model      VARCHAR(60) NOT NULL,
    season     VARCHAR(40) NOT NULL,
    n_matches  INT         NOT NULL,
    log_loss   DOUBLE PRECISION NOT NULL,
    brier      DOUBLE PRECISION NOT NULL,
    rps        DOUBLE PRECISION NOT NULL,
    accuracy   DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (model, season),
    CONSTRAINT final_test_n_valid        CHECK (n_matches > 0),
    CONSTRAINT final_test_accuracy_valid CHECK (accuracy BETWEEN 0 AND 1)
);

-- evaluation_val.csv
CREATE TABLE evaluation_val (
    model     VARCHAR(60) NOT NULL,
    n         INT         NOT NULL,
    log_loss  DOUBLE PRECISION NOT NULL,
    brier     DOUBLE PRECISION NOT NULL,
    rps       DOUBLE PRECISION NOT NULL,
    accuracy  DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (model),
    CONSTRAINT evaluation_val_n_valid        CHECK (n > 0),
    CONSTRAINT evaluation_val_accuracy_valid CHECK (accuracy BETWEEN 0 AND 1)
);

-- ---------------------------------------------------------------------------
-- Security: Row Level Security on, no policies (same approach as users)
-- ---------------------------------------------------------------------------
ALTER TABLE team_names           ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE features             ENABLE ROW LEVEL SECURITY;
ALTER TABLE elo_features         ENABLE ROW LEVEL SECURITY;
ALTER TABLE odds                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE poisson_predictions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_predictions_val ENABLE ROW LEVEL SECURITY;
ALTER TABLE baseline_metrics     ENABLE ROW LEVEL SECURITY;
ALTER TABLE final_test           ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_val       ENABLE ROW LEVEL SECURITY;

-- The frontend reads data through the backend, never through Supabase's public API,
-- so the public API roles get no access at all (same as user_passwords).
-- The backend connects directly to Postgres and is not affected.
REVOKE ALL ON team_names, matches, features, elo_features, odds,
              poisson_predictions, model_predictions_val,
              baseline_metrics, final_test, evaluation_val
    FROM anon, authenticated;
