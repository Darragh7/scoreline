-- Scoreline: database schema
-- Database: PostgreSQL (Supabase)
-- Tables are listed in dependency order.

CREATE TABLE users (
    user_id INT PRIMARY KEY
        GENERATED ALWAYS AS IDENTITY (START WITH 100 MINVALUE 100 MAXVALUE 999),
    first_name VARCHAR(50) NOT NULL,
    last_name  VARCHAR(50) NOT NULL,
    email      VARCHAR(100) UNIQUE,
    phone      VARCHAR(20)  UNIQUE,
    CONSTRAINT user_id_3_digits CHECK (user_id BETWEEN 100 AND 999),
    CONSTRAINT contact_required CHECK (email IS NOT NULL OR phone IS NOT NULL),
    CONSTRAINT phone_format CHECK (
        phone ~ '^\+353 8[2-9][0-9]{7}$'
        OR phone ~ '^\+91 [6-9][0-9]{9}$'
    )
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- The frontend reads data through the backend, so the public API gets no access.
REVOKE ALL ON users FROM anon, authenticated;

CREATE TABLE user_passwords (
    user_id INT PRIMARY KEY
        REFERENCES users(user_id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_passwords ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON user_passwords FROM anon, authenticated;

-- Messages sent through the website's "Send a message" contact form.
-- Topic is stored as a short code; the frontend shows the full label.
--   match_model = Match Outcome Model & Probabilities
--   elo_data    = Player Elo Ratings & Match Data
--   bug_report  = Website / Predictor Bug Report
--   general     = General Inquiry or Feedback
CREATE TABLE contact_messages (
    message_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    email      VARCHAR(100) NOT NULL,
    topic      VARCHAR(20)  NOT NULL,
    message    TEXT         NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT contact_name_not_blank CHECK (length(trim(name)) > 0),
    CONSTRAINT contact_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    CONSTRAINT contact_topic_valid CHECK (topic IN ('match_model', 'elo_data', 'bug_report', 'general')),
    CONSTRAINT contact_message_length CHECK (length(trim(message)) BETWEEN 1 AND 2000)
);

ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

-- The frontend sends messages through the backend, so the public API gets no access.
REVOKE ALL ON contact_messages FROM anon, authenticated;