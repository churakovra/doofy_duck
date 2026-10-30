-- Gameplay verification is terminal before Platform acknowledges delivery.
-- Keep delivery retries/rejections out of the run lifecycle and active-run lock.
UPDATE core_runs
SET status = 'completed'
WHERE status = 'completion_pending'
  AND verification_status = 'verified';

UPDATE core_runs
SET status = 'completed'
WHERE status = 'rejected'
  AND verification_status = 'verified';
