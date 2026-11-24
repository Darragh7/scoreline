# Scoreline model card

This card describes the model the app uses (the `ai/training` pipeline model) and, in the appendix, the earlier research pipeline in `ai/ml_pipeline` that was used to build the benchmark and the first results.

## 1. Purpose

Scoreline estimates the probability of a **home win, draw and away win** for matches in five leagues: Premier League, La Liga, Bundesliga, Serie A and Ligue 1.

- **Intended use:** information and entertainment on the Scoreline website.
- **Not for:** betting or gambling decisions. The probabilities are estimates, not guarantees, and the site shows a "not betting advice" disclaimer.
- **Output:** `home_win`, `draw` and `away_win` (they sum to 1), plus the model version, written to `predictions.json` by `python -m ai.training.predict fixtures`. Each prediction also carries `flags` that warn about unknown teams or history that ends well before the match.

## 2. The model

- **Code:** `ai/training` (features, model selection, evaluation) and `ai/training/predict.py` (training and prediction).
- **Model:** a scaled multinomial logistic regression. It is chosen by the pipeline's own time-ordered cross-validation from five candidates (logistic regression, a context mixture-of-experts model, random forest, histogram gradient boosting and an always-predict-the-prior baseline). On the full history the cross-validation log losses were 0.9895, 0.9912, 0.9935, 1.0008 and 1.0761 respectively.
- **Version v1:** trained on 14,535 matches (2018/19 up to 20 September 2026, which includes all of 2025/26 and the start of 2026/27). Metadata is saved next to the model in `ai/training/models/v1/` (`metadata.json`). The model file (`model.joblib`) is git-ignored, so it is regenerated with `python -m ai.training.predict train` or shared by the ML team.
- **Security:** `model.joblib` is a pickle file and can run code when loaded. Only load models produced by this project.

## 3. Features (4)

Chosen by the pipeline's train-only feature ablation. Every feature uses only matches that kicked off before the one being predicted (checked by automated tests).

| Feature | Meaning |
|---|---|
| `elo_diff` | Elo rating gap between the two teams |
| `ewm_gd_diff` | Gap in recent goal-difference form (exponentially weighted) |
| `dc_p_home`, `dc_p_draw` | Home-win and draw probabilities from a Dixon-Coles goals model, re-fitted weekly with more weight on recent matches |

## 4. Data

- **Results:** football-data.co.uk CSV files (5 leagues, 2018/19 onward), cleaned by `ai/ml_pipeline/clean.py` and loaded with `preprocessing.load_static_csv`.
- **Upcoming fixtures:** football-data.org API v4 (needs `FOOTBALL_API_KEY`). Team names from both sources are mapped to one canonical name by `ai/training/teams.py`.
- **Bookmaker odds** (mostly Pinnacle closing prices, average margin 2.9%) are used **only as a benchmark**, never as a model input.
- **Result split:** 43.3% home wins, 25.3% draws, 31.4% away wins. Average goals per match: 1.54 home, 1.26 away.
- **Licensing:** football-data.org is covered in `docs/security/licensing-and-disclaimers.md`. The football-data.co.uk data and its odds are listed there as not yet reviewed, so their terms must be checked and recorded before any public or commercial use.

## 5. How it was evaluated

- **Time-based, never random:** the model is selected and trained only on seasons before the one evaluated, then scored on that season (`ai/training/season_eval.py`, full report in `docs/model_evaluation_2024_25.md`).
- **Metrics:** log loss and Brier score (lower is better), ranked probability score (RPS, lower is better) and accuracy (the share of matches where the most likely outcome happened). A paired bootstrap interval says whether a difference between two models is real.
- **Final test season:** 2025/26 was not used to choose between models in the validation reported below, but the deployed model v1 is trained on it, so it cannot serve as a test of v1. The honest test of v1 is forward testing on matches played after 20 September 2026, which it has not seen. A separate final test would need a model trained only through 2024/25, and the pipeline's author should confirm that 2025/26 data was not used in the earlier feature selection.

## 6. Results on the validation season 2024/25 (1,752 matches)

These results come from the same pipeline trained only on seasons before 2024/25, not from v1 itself, which is also trained on 2024/25.

| Model | Log loss | Brier | RPS | Accuracy |
|---|---|---|---|---|
| Historical frequencies (benchmark) | 1.0774 | 0.6526 | 0.2327 | 42.0% |
| Elo only | 0.9856 | 0.5878 | 0.2008 | 53.0% |
| Dixon-Coles (raw probabilities) | 0.9850 | 0.5870 | 0.2010 | 52.3% |
| **Pipeline model (deployed)** | **0.9827** | **0.5858** | **0.2001** | **52.8%** |
| Average of pipeline, Elo and Dixon-Coles | 0.9822 | 0.5855 | 0.2000 | 52.6% |
| Bookmakers (margin removed) | 0.9606 | 0.5706 | 0.1935 | 54.8% |

- Every model clearly beats the benchmark that ignores team strength.
- **The pipeline model is statistically tied with Elo only** (difference -0.0029, 95% interval -0.0075 to +0.0014), and the average is also tied (-0.0035, interval -0.0074 to +0.0004). The simple model performs as well as the more complex ones.
- **Bookmaker odds are better** (the pipeline model is 0.0221 worse, 95% interval 0.0148 to 0.0296). They are closing prices and include injuries and lineups that the model does not have. They are better in every league, most in the Bundesliga.
- One season has about 1,750 matches, so differences under roughly 0.01 to 0.02 in log loss are noise.

## 7. Calibration

On 2024/25 the predicted probabilities were close to observed frequencies: average gaps of 2.7 points (away win), 2.7 (draw) and 1.7 (home win), within what noise explains at about 220 matches per bin. Home wins were slightly over-predicted and away wins slightly under-predicted, consistent with 2024/25 having fewer home wins (42.0%) than the earlier seasons it was trained on (43.4%; 43.3% over the full history in section 4). No recalibration is applied.

## 8. Limitations

- **No lineup, injury, transfer or expected-goals data**, which is the main reason bookmakers do better.
- **Football is highly random.** Expect about 50 to 55% accuracy. Draws are about 25% of matches, but the model almost never picks a draw as the single most likely result, so accuracy cannot reward draw predictions.
- **League matches only:** cup and European fixtures are not in the data, so rest and fatigue are understated.
- **Newly promoted teams** have little history and their predictions are less reliable. Unknown teams start from a default rating and are flagged.
- **History must be fresh.** Predictions are only as current as the results file. If the history ends more than 21 days before a match, the prediction carries a `history_ends` flag.
- The 2019/20 and 2020/21 seasons, when many matches were played without fans, are in the training data.
- The model describes the past and can drift as teams and styles change.

## 9. How to reproduce

From `ai/ml_pipeline` (data preparation), then from the repository root:

```
python ingest.py historical --start 2018 --end 2026
python clean.py
python odds.py                       # only needed for the bookmaker benchmark

python -m ai.training.season_eval --matches <matches.csv> --odds <odds.csv> --season 2024 --out docs/model_evaluation_2024_25.md
python -m ai.training.predict train --matches <matches.csv> --version v1
python -m ai.training.predict fixtures --model ai/training/models/v1 --matches <matches.csv> --fixtures <fixtures.json> --out predictions.json
```

Raw and cleaned data and trained models are not stored in Git. Re-run the commands to regenerate them. Tests: `python -m pytest ai/training/tests`.

## 10. Monitoring and updates

- After matches finish, predictions should be compared with results (weekly log loss and accuracy). This is not built yet.
- **Proposed retraining trigger:** weekly log loss worse than the Elo baseline for four weeks in a row (to be agreed with the team).
- New versions get a new name (v2, ...) and are compared on a fresh, untouched period before replacing this one.

## Appendix: the research pipeline (`ai/ml_pipeline`)

Built first, as an independent implementation, to produce the baselines, the bookmaker benchmark and the evaluation method. It trains a larger feature set (45 features) and averages four models (Elo, Poisson, logistic regression, XGBoost). Its results agree with the pipeline above: on 2024/25 the four-model average reached log loss 0.9819 (accuracy 53.4%), and on 2025/26 (a season the team has now seen, so it is no longer an untouched test) it reached 0.9922 (accuracy 51.4%) against 0.9783 (53.4%) for the bookmakers and 0.9971 (51.1%) for Elo. It beat Elo by a small, consistent margin (about 0.004 to 0.005) on both seasons. The deployed pipeline model reaches the same level with only 4 features, which is why it is used. The research ensemble is not deployed.
