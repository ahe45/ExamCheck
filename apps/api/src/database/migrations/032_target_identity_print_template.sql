ALTER TABLE print_job
  ADD COLUMN candidate_registration_id BIGINT UNSIGNED NULL AFTER business_ref,
  ADD COLUMN canonical_assignment_id BIGINT UNSIGNED NULL AFTER candidate_registration_id,
  ADD COLUMN operation_slot_id BIGINT UNSIGNED NULL AFTER canonical_assignment_id,
  ADD KEY ix_print_job_registration (candidate_registration_id, created_at),
  ADD KEY ix_print_job_operation_slot (operation_slot_id, created_at),
  ADD CONSTRAINT fk_print_job_registration FOREIGN KEY (candidate_registration_id) REFERENCES candidate_registration(id),
  ADD CONSTRAINT fk_print_job_canonical_assignment FOREIGN KEY (canonical_assignment_id)
    REFERENCES candidate_pseudonym_assignment(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_print_job_operation_slot FOREIGN KEY (operation_slot_id) REFERENCES operation_slot(id);

CREATE TABLE IF NOT EXISTS print_projection_snapshot (
  print_job_id CHAR(36) NOT NULL,
  projection_json JSON NOT NULL,
  projection_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (print_job_id),
  CONSTRAINT fk_print_projection_snapshot_job FOREIGN KEY (print_job_id) REFERENCES print_job(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE form_template
  ADD COLUMN lifecycle_state ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'PUBLISHED' AFTER active,
  ADD COLUMN published_by BIGINT UNSIGNED NULL AFTER lifecycle_state,
  ADD COLUMN published_at DATETIME(3) NULL AFTER published_by,
  ADD COLUMN supersedes_id BIGINT UNSIGNED NULL AFTER published_at,
  ADD KEY ix_form_template_lifecycle (code, lifecycle_state, version),
  ADD CONSTRAINT fk_form_template_published_by FOREIGN KEY (published_by) REFERENCES app_user(id),
  ADD CONSTRAINT fk_form_template_supersedes FOREIGN KEY (supersedes_id) REFERENCES form_template(id);

UPDATE form_template
SET published_by = created_by,
    published_at = created_at
WHERE active = TRUE AND lifecycle_state = 'PUBLISHED' AND published_at IS NULL;

UPDATE form_template
SET lifecycle_state = 'ARCHIVED'
WHERE active = FALSE;

ALTER TABLE form_template
  ADD CONSTRAINT ck_form_template_lifecycle CHECK (
    (
      lifecycle_state = 'DRAFT'
      AND active = FALSE
      AND published_by IS NULL
      AND published_at IS NULL
    )
    OR (
      lifecycle_state = 'PUBLISHED'
      AND active = TRUE
      AND published_by IS NOT NULL
      AND published_at IS NOT NULL
    )
    OR (
      lifecycle_state = 'ARCHIVED'
      AND active = FALSE
      AND (
        (published_by IS NULL AND published_at IS NULL)
        OR (published_by IS NOT NULL AND published_at IS NOT NULL)
      )
    )
  );
