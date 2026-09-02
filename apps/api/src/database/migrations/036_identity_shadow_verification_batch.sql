CREATE TABLE IF NOT EXISTS identity_source_mutation_watermark (
  id TINYINT UNSIGNED NOT NULL,
  sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT ck_identity_source_mutation_watermark_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO identity_source_mutation_watermark (id, sequence) VALUES (1, 0);

CREATE TRIGGER trg_audit_log_identity_source_mutation_watermark
AFTER INSERT ON audit_log
FOR EACH ROW
UPDATE identity_source_mutation_watermark
SET sequence = sequence + 1
WHERE id = 1
  AND NEW.event_type IN (
    'ACCOUNT_CREATED',
    'ACCOUNT_UPDATED',
    'ACCOUNT_DELETED',
    'CANDIDATE_WORKBOOK_IMPORTED',
    'CANDIDATE_PHOTO_ARCHIVE_IMPORTED',
    'SYSTEM_PROFILE_UPDATED',
    'WORKSTATION_CREATED',
    'FORM_TEMPLATE_SAVED',
    'FORM_TEMPLATE_METADATA_UPDATED',
    'PSEUDONYM_SETTING_UPDATED',
    'PSEUDONYM_OPERATION_CLOSED',
    'PSEUDONYM_OPERATION_REOPENED',
    'PSEUDONYM_ASSIGNED',
    'PRINT_JOB_CREATED',
    'PRINT_JOB_SENT',
    'PRINT_JOB_FAILED',
    'PRINT_JOB_EXPIRED',
    'PRINT_JOB_REISSUED'
  );

CREATE TABLE IF NOT EXISTS identity_shadow_verification_batch (
  id CHAR(36) NOT NULL,
  status ENUM('RUNNING', 'COMPLETED') NOT NULL DEFAULT 'RUNNING',
  observation_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_identity_shadow_batch_status (status, completed_at),
  CONSTRAINT ck_identity_shadow_batch_status CHECK (
    (status = 'RUNNING' AND completed_at IS NULL)
    OR (status = 'COMPLETED' AND completed_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE identity_shadow_observation
  ADD COLUMN verification_batch_id CHAR(36) NULL AFTER id,
  ADD UNIQUE KEY uq_identity_shadow_observation_batch_type (verification_batch_id, observation_type),
  ADD KEY ix_identity_shadow_observation_batch (verification_batch_id, observed_at),
  ADD CONSTRAINT fk_identity_shadow_observation_batch
    FOREIGN KEY (verification_batch_id) REFERENCES identity_shadow_verification_batch(id);
