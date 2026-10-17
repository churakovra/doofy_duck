CREATE TABLE IF NOT EXISTS core_runs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  life_index integer NOT NULL DEFAULT 0 CHECK (life_index >= 0),
  seed bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  simulation_version text NOT NULL,
  generator_version text NOT NULL,
  config_id text NOT NULL,
  state jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('active','completion_pending','completed','rejected','abandoned')),
  checkpoint_sequence bigint NOT NULL DEFAULT -1,
  active_ticks bigint NOT NULL DEFAULT 0 CHECK (active_ticks BETWEEN 0 AND 216000),
  writer_generation bigint NOT NULL DEFAULT 1,
  writer_token_hash bytea NOT NULL,
  last_contact timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completion_reason text CHECK (completion_reason IS NULL OR completion_reason IN ('death','flight_cap')),
  completion_event_id uuid,
  UNIQUE (id, account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS core_one_active_run_per_account ON core_runs(account_id) WHERE status IN ('active','completion_pending');
CREATE INDEX IF NOT EXISTS core_runs_account_created ON core_runs(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS core_checkpoints (
  run_id uuid NOT NULL REFERENCES core_runs(id),
  checkpoint_sequence bigint NOT NULL CHECK (checkpoint_sequence >= 0),
  idempotency_key text NOT NULL,
  request_hash bytea NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, checkpoint_sequence),
  UNIQUE (run_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS core_outbox (
  event_id uuid PRIMARY KEY,
  run_id uuid NOT NULL UNIQUE REFERENCES core_runs(id),
  body jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','delivered','rejected')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS core_outbox_ready ON core_outbox(next_attempt_at) WHERE status IN ('pending','leased');

CREATE TABLE IF NOT EXISTS core_outages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL,
  recovered_at timestamptz,
  CHECK (recovered_at IS NULL OR recovered_at >= started_at)
);
