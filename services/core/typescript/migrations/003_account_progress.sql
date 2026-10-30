CREATE TABLE IF NOT EXISTS core_account_progress (
  account_id uuid PRIMARY KEY,
  best_score bigint NOT NULL DEFAULT 0 CHECK (best_score >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
