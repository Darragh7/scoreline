# Database (Supabase / PostgreSQL)

The Scoreline database runs on Supabase (PostgreSQL). Everything is defined in SQL files in this folder.

## Files

| File | What it does |
|---|---|
| `schema.sql` | `users` and `user_passwords` tables |
| `schema_data_tables.sql` | 10 tables for the football data (one per CSV file) |
| `load_csvs.py` | Loads the CSV files into those tables |

## Tables

**Users**
- `users`: user ID (100-999, auto-generated), first and last name, email and/or phone (at least one required). Phone numbers must be an Irish mobile (`+353 8XXXXXXXX`) or an Indian mobile (`+91 XXXXXXXXXX`), with one space after the country code.
- `user_passwords`: password hash, linked to `users` by foreign key. The hashing is done by the backend before saving.

**Football data** (one table per CSV)
- `team_names`: 156 teams and their league
- `matches`: 14,535 matches with results and match stats. A match is identified by date + home team + away team.
- `features`, `elo_features`, `odds`, `poisson_predictions`, `model_predictions_val`: per-match model inputs and predictions. Each row points to a match in `matches` by foreign key.
- `baseline_metrics`, `final_test`, `evaluation_val`: model evaluation results (log loss, Brier score, RPS, accuracy)

## Setting up from scratch

1. In the Supabase SQL Editor, run `schema.sql`, then `schema_data_tables.sql`.
2. Create a `.env` file in the repo's top folder (never commit it) with the Session pooler connection string from Supabase's **Connect** button:

        DATABASE_URL=postgresql://postgres.xxxx:YOUR-PASSWORD@...pooler.supabase.com:5432/postgres

3. Get the CSV files from the team and put them in a folder **outside the repo** (the data is not stored in GitHub).
4. Install the packages and run the loader:

        pip install psycopg2-binary python-dotenv
        python database/load_csvs.py path/to/csv_folder

The loader runs in one transaction, so if any file fails, nothing is loaded. If the tables already have data it stops. Add `--reload` to empty the 10 data tables and load them again (`users` and `user_passwords` are not touched).

## Security

- Row Level Security is on for every table, and the public API roles (`anon`, `authenticated`) have no access. The frontend reads data through the backend only.
- Never commit the database password, the connection string or the CSV data. `.env` is ignored by Git.
- Supabase free projects pause after about a week of low activity. If the database stops responding, open the project in the Supabase dashboard and click **Resume project**.