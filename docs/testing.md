# Testing

Full development test suite

## CI/CD

GitHub Actions runs on pushes and pull requests. It builds the backend Docker image and scans the repository for secrets; separate workflows run the backend, Django and ML tests when their files change. The image is built without being pushed to a registry.

## Unit Testing

Unit tests cover the backend API and services, Django pages and authentication. They check expected responses and validation, exercise authentication flows with the backend mocked, and cover data handling and model behaviour. Run the relevant suite from the repository root:

```
python -m pytest backend/tests
cd Django && python manage.py test webplay
```

## Acceptance Tests

Acceptance tests (ATs) are written as checklists on each feature's Trello card, on the sprint/product backlog. Each AT is a plain-language pass/fail condition that the card's owner checks before the card is done. We used them to agree what defines "done", from a user's and products point of view, rather than only checking that code runs during development .

## Model Testing

The ML pipeline lives in `ai/training/` and is tested with pytest:

```
python -m pytest ai/training/tests
```

What we test and why:

- **Data pull** (`test_data_pull.py`): The football-data.org client is configured so that tests never use the API quota (which is a constraint of the free tier we are using). It checks request parameters, the single retry on a 429 rate-limit per day response, caching, and a clear error when `FOOTBALL_API_KEY` is missing.
- **No leakage** (`test_features.py`, `test_extended_features.py`): It is vital that every feature must use only matches that kicked off before the one being predicted. The tests check that a match's own score never feeds its features, and that matches sharing a kickoff time can't see each other. Leakage can inflate model performance, so this is the most important test to run.
- **Feature sanity**: The tests check that the expected columns are present with no NaNs, that defined defaults apply for teams with no history, and that the rest-days cap and Elo direction behave as expected during feature engineering.
- **Valid probabilities**: Dixon-Coles score matrices sum to 1, and the model outputs (including the context Mixture of Experts model) are valid home, draw and away probabilities.
- **EDA helpers** (`test_eda.py`): Correlation, VIF and outcome-rate helpers are checked on small synthetic data where the answer is known in advance.
- **Pipeline smoke test** (`test_pipeline.py`): Runs the whole pipeline end to end on a small dataset, so a broken connection between modules shows up at the get go.
- **Static history and team names** (`test_static_data.py`, `test_teams.py`): The cleaned football-data.co.uk history is loaded in the same shape as API data, matches from both sources are merged without duplicates (the API row wins), and different spellings of one club ("Man United", "Manchester United FC") resolve to one canonical name. Without this, Elo and form would silently treat one club as two teams.
- **Evaluation helpers** (`test_evaluation.py`, `test_season_eval.py`): Ranked probability score is checked against known values, the bootstrap verdict ("better / tied / worse") is checked on data where the answer is known, and calibration tables are checked on forecasts that are calibrated by construction. The season runner is tested to train only on seasons before the one it evaluates, to leave out matches without bookmaker odds, and to refuse the held-out final-test season unless it is explicitly confirmed.
- **Prediction** (`test_predict.py`): A saved model reloads and gives identical predictions, outputs are valid home_win / draw / away_win probabilities that sum to 1, and teams without history or stale history are flagged instead of failing. The key test checks there is no training/serving skew: a played match rebuilt as a fixture from the matches before it gets the same features as in training. Further tests check that features ignore results played after the fixture, and that fixtures never feed each other (same-week fixtures sharing a team are processed separately).

- AI assistance was used to help write some of these tests.

How models are evaluated, (not unit tested)

- Matches are split by time: a chronological 80/20 train/test split, with time-ordered cross-validation on the training set only. A random split would let the model see the future.
- Log loss is the main metric because we predict 3 probabilities, not just the winner. Brier score and accuracy are reported alongside it to better contextualize results.
- Candidates are compared against an always-predict-the-prior baseline, and feature sets were chosen by a train-only ablation. The test set was used once, at the end only after training.

Season-based evaluation (`ai/training/season_eval.py`, report in `docs/model_evaluation_2024_25.md`)

- The model is selected and trained only on seasons before the one being evaluated (for example 2018/19 to 2023/24 for 2024/25), using the pipeline's own time-ordered cross-validation, then scored on the evaluated season.
- It is compared with simple baselines (historical frequencies, Elo only, raw Dixon-Coles) and with bookmaker probabilities (closing odds with the margin removed). Bookmaker odds are a benchmark only and are never a model input.
- Log loss, Brier score and ranked probability score are reported with a paired bootstrap interval, so a difference between two models is only called real when the interval excludes zero. One season is about 1,750 matches, so differences under roughly 0.01 to 0.02 in log loss are noise.
- Calibration is checked by comparing predicted and observed frequencies in quantile bins.
- The 2025/26 season is held out as the final test. The runner refuses it unless `--confirm-final-test` is passed, and it should be run once, after every choice is made.

```
python -m ai.training.season_eval --matches <matches.csv> --odds <odds.csv> --season 2024 --out docs/model_evaluation_2024_25.md
```
