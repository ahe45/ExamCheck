ALTER TABLE print_job
  ADD COLUMN request_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER idempotency_key;
