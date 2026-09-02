CREATE TABLE IF NOT EXISTS identity_transition_gate_evidence (
  id CHAR(36) NOT NULL,
  evidence_type ENUM(
    'BACKUP_RESTORE',
    'ROLLBACK_REHEARSAL',
    'TARGET_READ_CONTRACT_READY',
    'TARGET_WRITE_CONTRACT_READY',
    'CANARY_VALIDATION',
    'LEGACY_COMPATIBILITY'
  ) NOT NULL,
  result ENUM('PASSED', 'FAILED') NOT NULL,
  reference_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  elapsed_minutes INT UNSIGNED NULL,
  observed_at DATETIME(3) NOT NULL,
  valid_until DATETIME(3) NOT NULL,
  recorded_by BIGINT UNSIGNED NOT NULL,
  verified_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_identity_gate_evidence_lookup (evidence_type, result, valid_until),
  CONSTRAINT fk_identity_gate_evidence_recorded_by FOREIGN KEY (recorded_by) REFERENCES app_user(id),
  CONSTRAINT fk_identity_gate_evidence_verified_by FOREIGN KEY (verified_by) REFERENCES app_user(id),
  CONSTRAINT ck_identity_gate_evidence_separation CHECK (recorded_by <> verified_by),
  CONSTRAINT ck_identity_gate_evidence_window CHECK (valid_until > observed_at),
  CONSTRAINT ck_identity_gate_evidence_elapsed CHECK (
    (evidence_type = 'ROLLBACK_REHEARSAL' AND elapsed_minutes IS NOT NULL)
    OR (evidence_type <> 'ROLLBACK_REHEARSAL' AND elapsed_minutes IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS identity_transition_request (
  id CHAR(36) NOT NULL,
  target_stage ENUM('DUAL', 'SHADOW', 'CANARY', 'CANONICAL') NOT NULL,
  status ENUM('PENDING', 'APPLIED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  expected_state_version INT UNSIGNED NOT NULL,
  reason_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  minimum_compared_entity_count BIGINT UNSIGNED NULL,
  minimum_observation_minutes INT UNSIGNED NULL,
  maximum_rollback_minutes INT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  applied_by BIGINT UNSIGNED NULL,
  canonical_manual_confirmed_by BIGINT UNSIGNED NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  applied_at DATETIME(3) NULL,
  cancelled_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_identity_transition_request_status (status, requested_at),
  CONSTRAINT fk_identity_transition_request_requested_by FOREIGN KEY (requested_by) REFERENCES app_user(id),
  CONSTRAINT fk_identity_transition_request_applied_by FOREIGN KEY (applied_by) REFERENCES app_user(id),
  CONSTRAINT fk_identity_transition_request_canonical_by FOREIGN KEY (canonical_manual_confirmed_by)
    REFERENCES app_user(id),
  CONSTRAINT ck_identity_transition_request_version CHECK (expected_state_version > 0),
  CONSTRAINT ck_identity_transition_request_rollback CHECK (maximum_rollback_minutes > 0),
  CONSTRAINT ck_identity_transition_request_observation CHECK (
    (
      target_stage IN ('CANARY', 'CANONICAL')
      AND minimum_compared_entity_count IS NOT NULL
      AND minimum_compared_entity_count > 0
      AND minimum_observation_minutes IS NOT NULL
      AND minimum_observation_minutes > 0
    )
    OR (
      target_stage IN ('DUAL', 'SHADOW')
      AND minimum_compared_entity_count IS NULL
      AND minimum_observation_minutes IS NULL
    )
  ),
  CONSTRAINT ck_identity_transition_request_terminal CHECK (
    (status = 'PENDING' AND applied_by IS NULL AND applied_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'APPLIED' AND applied_by IS NOT NULL AND applied_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'CANCELLED' AND applied_by IS NULL AND applied_at IS NULL AND cancelled_at IS NOT NULL)
  ),
  CONSTRAINT ck_identity_transition_request_manual CHECK (
    (target_stage = 'CANONICAL') OR canonical_manual_confirmed_by IS NULL
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS identity_transition_request_evidence (
  request_id CHAR(36) NOT NULL,
  evidence_id CHAR(36) NOT NULL,
  linked_by BIGINT UNSIGNED NOT NULL,
  linked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (request_id, evidence_id),
  CONSTRAINT fk_identity_request_evidence_request FOREIGN KEY (request_id)
    REFERENCES identity_transition_request(id),
  CONSTRAINT fk_identity_request_evidence_evidence FOREIGN KEY (evidence_id)
    REFERENCES identity_transition_gate_evidence(id),
  CONSTRAINT fk_identity_request_evidence_linked_by FOREIGN KEY (linked_by) REFERENCES app_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS identity_transition_request_approval (
  request_id CHAR(36) NOT NULL,
  approval_type ENUM('OPERATIONS', 'DATA_OWNER', 'PRIVACY', 'CANONICAL_OWNER') NOT NULL,
  approved_by BIGINT UNSIGNED NOT NULL,
  approved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (request_id, approval_type),
  UNIQUE KEY uq_identity_request_approval_actor (request_id, approved_by),
  CONSTRAINT fk_identity_request_approval_request FOREIGN KEY (request_id)
    REFERENCES identity_transition_request(id),
  CONSTRAINT fk_identity_request_approval_user FOREIGN KEY (approved_by) REFERENCES app_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS identity_transition_state_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id CHAR(36) NULL,
  event_type ENUM('PROMOTION', 'EMERGENCY_ROLLBACK') NOT NULL,
  from_write_mode ENUM('LEGACY', 'DUAL', 'CANONICAL') NOT NULL,
  from_read_mode ENUM('LEGACY', 'SHADOW', 'CANARY', 'CANONICAL') NOT NULL,
  from_phase ENUM('EXPANDED', 'BACKFILLING', 'BACKFILLED', 'SHADOWING', 'CANARY', 'CANONICAL', 'BLOCKED') NOT NULL,
  to_write_mode ENUM('LEGACY', 'DUAL', 'CANONICAL') NOT NULL,
  to_read_mode ENUM('LEGACY', 'SHADOW', 'CANARY', 'CANONICAL') NOT NULL,
  to_phase ENUM('EXPANDED', 'BACKFILLING', 'BACKFILLED', 'SHADOWING', 'CANARY', 'CANONICAL', 'BLOCKED') NOT NULL,
  from_state_version INT UNSIGNED NOT NULL,
  to_state_version INT UNSIGNED NOT NULL,
  reason_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_identity_state_history_target (to_phase, created_at),
  CONSTRAINT fk_identity_state_history_request FOREIGN KEY (request_id)
    REFERENCES identity_transition_request(id),
  CONSTRAINT fk_identity_state_history_actor FOREIGN KEY (actor_user_id) REFERENCES app_user(id),
  CONSTRAINT ck_identity_state_history_version CHECK (to_state_version = from_state_version + 1),
  CONSTRAINT ck_identity_state_history_request CHECK (
    (event_type = 'PROMOTION' AND request_id IS NOT NULL)
    OR (event_type = 'EMERGENCY_ROLLBACK' AND request_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS identity_transition_history_evidence (
  history_id BIGINT UNSIGNED NOT NULL,
  evidence_id CHAR(36) NOT NULL,
  PRIMARY KEY (history_id, evidence_id),
  CONSTRAINT fk_identity_history_evidence_history FOREIGN KEY (history_id)
    REFERENCES identity_transition_state_history(id),
  CONSTRAINT fk_identity_history_evidence_evidence FOREIGN KEY (evidence_id)
    REFERENCES identity_transition_gate_evidence(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
