ALTER TABLE print_job
  ADD COLUMN idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER requested_by,
  ADD UNIQUE KEY uq_print_job_request_idempotency (requested_by, idempotency_key);
