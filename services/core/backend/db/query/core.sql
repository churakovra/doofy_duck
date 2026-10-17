-- name: GetRunForAccount :one
SELECT id::text, account_id::text, status, verification_status, delivery_status, life_index, seed, simulation_version, generator_version, config_id, state::text, checkpoint_sequence, writer_generation, active_ticks, last_contact, completed_at, completion_reason, writer_token_hash FROM core_runs WHERE id = $1 AND account_id = $2;

-- name: GetCurrentRun :one
SELECT * FROM core_runs WHERE account_id = $1 AND status IN ('active','completion_pending') ORDER BY created_at DESC LIMIT 1;

-- name: LeaseOutbox :many
SELECT event_id, run_id, body FROM core_outbox
WHERE (status = 'pending' AND next_attempt_at <= now()) OR (status = 'leased' AND lease_until <= now())
ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED;
