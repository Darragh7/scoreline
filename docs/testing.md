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

How models are evaluated, (not unit tested)

- Matches are split by time: a chronological 80/20 train/test split, with time-ordered cross-validation on the training set only. A random split would let the model see the future.
- Log loss is the main metric because we predict 3 probabilities, not just the winner. Brier score and accuracy are reported alongside it to better contextualize results.
- Candidates are compared against an always-predict-the-prior baseline, and feature sets were chosen by a train-only ablation. The test set was used once, at the end only after training.
