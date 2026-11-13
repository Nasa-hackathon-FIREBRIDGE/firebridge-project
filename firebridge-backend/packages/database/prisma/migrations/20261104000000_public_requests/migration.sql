-- Public API: no identity is written for new jobs or analysis request keys.
-- Historical requester metadata is preserved verbatim, but no longer determines reuse.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM firebridge.api_jobs GROUP BY idempotency_key HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM firebridge.analysis_request_keys GROUP BY idempotency_key HAVING count(*) > 1)
  THEN RAISE EXCEPTION 'Public idempotency requires review of duplicate historical keys; no rows have been changed';
  END IF;
END $$;
ALTER TABLE firebridge.api_jobs ALTER COLUMN requested_by DROP NOT NULL;
CREATE UNIQUE INDEX jobs_public_request_key ON firebridge.api_jobs(idempotency_key);
ALTER TABLE firebridge.analysis_request_keys DROP CONSTRAINT analysis_request_keys_pkey;
ALTER TABLE firebridge.analysis_request_keys ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE firebridge.analysis_request_keys ADD PRIMARY KEY(idempotency_key);
COMMIT;
