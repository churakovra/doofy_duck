ALTER TABLE core_runs
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'in_progress',
  ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'not_ready';

-- Early RUN schema revisions used pending_verification/verified as lifecycle
-- values. Remove whichever status check was installed before translating rows.
DO $$ DECLARE constraint_row record; index_row record; BEGIN
  FOR constraint_row IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'core_runs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE core_runs DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;

  -- Drop the old partial uniqueness predicate before changing lifecycle values.
  FOR index_row IN
    SELECT indexrelid::regclass AS index_name FROM pg_index
    WHERE indrelid = 'core_runs'::regclass
      AND indisunique
      AND pg_get_indexdef(indexrelid) ILIKE '%pending_verification%'
  LOOP
    EXECUTE format('DROP INDEX %s', index_row.index_name);
  END LOOP;
  EXECUTE 'DROP INDEX IF EXISTS core_one_active_run_per_account';
END $$;

UPDATE core_runs SET status = CASE status
  WHEN 'pending_verification' THEN 'completion_pending'
  WHEN 'verified' THEN 'completed'
  ELSE status
END
WHERE status IN ('pending_verification','verified');

DO $$ BEGIN
  ALTER TABLE core_runs ADD CONSTRAINT core_runs_status_check
    CHECK (status IN ('active','completion_pending','completed','rejected','abandoned'));
  CREATE UNIQUE INDEX core_one_active_run_per_account
    ON core_runs(account_id) WHERE status IN ('active','completion_pending');
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'core_runs'::regclass AND conname = 'core_runs_verification_status_check') THEN
    ALTER TABLE core_runs ADD CONSTRAINT core_runs_verification_status_check
      CHECK (verification_status IN ('in_progress','verified','rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'core_runs'::regclass AND conname = 'core_runs_delivery_status_check') THEN
    ALTER TABLE core_runs ADD CONSTRAINT core_runs_delivery_status_check
      CHECK (delivery_status IN ('not_ready','pending','delivered','rejected'));
  END IF;
END $$;

UPDATE core_runs SET verification_status = CASE
  WHEN status IN ('completion_pending','completed') THEN 'verified'
  WHEN status IN ('rejected','abandoned') THEN 'rejected'
  ELSE 'in_progress'
END;
UPDATE core_runs SET delivery_status = CASE
  WHEN status = 'completion_pending' THEN 'pending'
  WHEN status = 'completed' THEN 'delivered'
  WHEN status = 'rejected' THEN 'rejected'
  ELSE 'not_ready'
END;

ALTER TABLE core_checkpoints
  ADD COLUMN IF NOT EXISTS input_batch jsonb NOT NULL DEFAULT '[]'::jsonb;
