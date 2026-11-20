# Prediction format (`predictions.json`)

The ML pipeline writes one JSON file per run. This is the agreed shape for the backend, database and frontend. An illustrative example is in `docs/examples/predictions.example.json` (made-up fixtures, not real matches).

Produced by: `python -m ai.training.predict fixtures --model <model folder> --matches <history.csv> --fixtures <fixtures> --out predictions.json`

## Shape

```json
{
  "model_version": "v1",
  "generated_at": "2026-11-18T12:00:00+00:00",
  "predictions": [
    {
      "match_id": 900001,
      "competition": "PL",
      "home_team": "Arsenal",
      "away_team": "Chelsea",
      "kickoff": "2026-11-21T15:00:00Z",
      "home_win": 0.6692,
      "draw": 0.209,
      "away_win": 0.1218,
      "flags": []
    }
  ]
}
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `model_version` | string | Version of the model that produced the file (for example `v1`) |
| `generated_at` | string | When the file was produced, ISO 8601 in UTC |
| `predictions` | list | One object per fixture |
| `match_id` | integer, string or null | The football-data.org match id when the fixture came from the API, so a prediction can be looked up by the id the backend already uses. `null` if the fixture had no id |
| `competition` | string | `PL`, `PD`, `BL1`, `SA` or `FL1` |
| `home_team`, `away_team` | string | Canonical club names (for example `Manchester United`, not `Manchester United FC`) |
| `kickoff` | string | Kickoff time, UTC, `YYYY-MM-DDTHH:MM:SSZ` |
| `home_win`, `draw`, `away_win` | number | Probabilities between 0 and 1, rounded to 4 decimals. They sum to 1 within 0.0002 |
| `flags` | list of strings | Warnings about the data behind this prediction. Empty means none |

## Flags

The prediction is still produced when a flag is present. Consumers should show a "limited data" note instead of hiding it.

| Flag | Meaning |
|---|---|
| `unknown_team:<name>` | The team has no history in that league (for example a newly promoted club). Its rating started from a default |
| `history_ends:<YYYY-MM-DD>` | The results data ends more than 21 days before the match, so recent form is missing |

## Rules

- **Do not rely on the order** of fields or predictions. **Ignore unknown fields**, so new optional fields can be added without breaking consumers.
- **Breaking changes** (renaming or removing a field, changing a type or meaning) need agreement from the backend, database and frontend owners first.
- The names `home_win`, `draw` and `away_win` match `backend/app/schemas/prediction_schema.py`, and `GET /predictions/{match_id}` can return them as they are.
- The file is not committed to Git. Consumers read it from a path set in configuration.

## Reading it from the backend (suggested)

`PredictionService.predict(match_id)` loads the file (path from an environment variable such as `PREDICTIONS_FILE`), finds the entry whose `match_id` matches, and returns `home_win`, `draw` and `away_win` (plus `flags` and `model_version` if useful). If the match is not in the file, return a clear "no prediction yet" response, not made-up numbers. The backend container only copies `app/`, so it cannot import the `ai` code; reading this file is what keeps the two apart.
