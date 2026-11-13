CREATE TABLE firebridge.explanation_request_keys (
    requested_by text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    job_id uuid NOT NULL REFERENCES firebridge.api_jobs(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (requested_by,idempotency_key)
);
CREATE INDEX explanation_request_keys_job ON firebridge.explanation_request_keys(job_id);
