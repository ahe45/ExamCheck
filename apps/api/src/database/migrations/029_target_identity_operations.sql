CREATE TABLE IF NOT EXISTS pseudonym_operation_state (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_slot_id BIGINT UNSIGNED NOT NULL,
  source_operation_id BIGINT UNSIGNED NULL,
  state ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  closed_by BIGINT UNSIGNED NULL,
  closed_at DATETIME(3) NULL,
  last_reopened_by BIGINT UNSIGNED NULL,
  last_reopened_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pseudonym_operation_state_slot (operation_slot_id),
  UNIQUE KEY uq_pseudonym_operation_state_source (source_operation_id),
  KEY ix_pseudonym_operation_state_status (state, updated_at),
  CONSTRAINT fk_pseudonym_operation_state_slot FOREIGN KEY (operation_slot_id) REFERENCES operation_slot(id),
  CONSTRAINT fk_pseudonym_operation_state_source FOREIGN KEY (source_operation_id) REFERENCES pseudonym_operation(id),
  CONSTRAINT fk_pseudonym_operation_state_closed_by FOREIGN KEY (closed_by) REFERENCES app_user(id),
  CONSTRAINT fk_pseudonym_operation_state_reopened_by FOREIGN KEY (last_reopened_by) REFERENCES app_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate_pseudonym_assignment (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  registration_id BIGINT UNSIGNED NOT NULL,
  pseudonym_operation_id BIGINT UNSIGNED NOT NULL,
  source_assignment_id BIGINT UNSIGNED NULL,
  pseudonym_value BIGINT UNSIGNED NOT NULL,
  display_width SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  assignment_mode ENUM('RANDOM', 'SEQUENTIAL', 'MANUAL', 'PREASSIGNED') NOT NULL,
  is_absentee BOOLEAN NOT NULL DEFAULT FALSE,
  auto_assigned_on_close BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_by BIGINT UNSIGNED NOT NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_candidate_pseudonym_assignment_registration (registration_id),
  UNIQUE KEY uq_candidate_pseudonym_assignment_source (source_assignment_id),
  KEY ix_candidate_pseudonym_assignment_operation (pseudonym_operation_id, assigned_at),
  CONSTRAINT fk_candidate_pseudonym_assignment_registration FOREIGN KEY (registration_id) REFERENCES candidate_registration(id),
  CONSTRAINT fk_candidate_pseudonym_assignment_operation FOREIGN KEY (pseudonym_operation_id) REFERENCES pseudonym_operation_state(id),
  CONSTRAINT fk_candidate_pseudonym_assignment_source FOREIGN KEY (source_assignment_id) REFERENCES pseudonym_assignment(id),
  CONSTRAINT fk_candidate_pseudonym_assignment_user FOREIGN KEY (assigned_by) REFERENCES app_user(id),
  CONSTRAINT ck_candidate_pseudonym_assignment_value CHECK (
    pseudonym_value > 0 AND display_width BETWEEN 1 AND 100
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pseudonym_number_claim (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assignment_id BIGINT UNSIGNED NOT NULL,
  scope_kind ENUM('ADMISSION', 'SCHEDULE') NOT NULL,
  admission_id BIGINT UNSIGNED NOT NULL,
  operation_slot_id BIGINT UNSIGNED NULL,
  scope_key BINARY(32) NOT NULL,
  pseudonym_value BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pseudonym_number_claim_assignment (assignment_id),
  UNIQUE KEY uq_pseudonym_number_claim_scope_value (scope_key, pseudonym_value),
  KEY ix_pseudonym_number_claim_admission (admission_id, scope_kind),
  CONSTRAINT fk_pseudonym_number_claim_assignment FOREIGN KEY (assignment_id) REFERENCES candidate_pseudonym_assignment(id) ON DELETE CASCADE,
  CONSTRAINT fk_pseudonym_number_claim_admission FOREIGN KEY (admission_id) REFERENCES admission(id),
  CONSTRAINT fk_pseudonym_number_claim_slot FOREIGN KEY (operation_slot_id) REFERENCES operation_slot(id),
  CONSTRAINT ck_pseudonym_number_claim_scope CHECK (
    pseudonym_value > 0
    AND ((scope_kind = 'ADMISSION' AND operation_slot_id IS NULL)
      OR (scope_kind = 'SCHEDULE' AND operation_slot_id IS NOT NULL))
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pseudonym_operation_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM('CLOSED', 'REOPENED') NOT NULL,
  auto_assigned_absentee_count INT UNSIGNED NOT NULL DEFAULT 0,
  removed_current_absentee_count INT UNSIGNED NOT NULL DEFAULT 0,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_pseudonym_operation_event_operation (operation_id, occurred_at),
  CONSTRAINT fk_pseudonym_operation_event_operation FOREIGN KEY (operation_id) REFERENCES pseudonym_operation_state(id),
  CONSTRAINT fk_pseudonym_operation_event_user FOREIGN KEY (actor_user_id) REFERENCES app_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pseudonym_assignment_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assignment_id BIGINT UNSIGNED NULL,
  registration_id BIGINT UNSIGNED NOT NULL,
  operation_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM('ASSIGNED', 'ABSENTEE_AUTO_ASSIGNED', 'CURRENT_REMOVED_ON_REOPEN') NOT NULL,
  pseudonym_value BIGINT UNSIGNED NOT NULL,
  display_width SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  assignment_mode ENUM('RANDOM', 'SEQUENTIAL', 'MANUAL', 'PREASSIGNED') NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_pseudonym_assignment_event_registration (registration_id, occurred_at),
  KEY ix_pseudonym_assignment_event_operation (operation_id, occurred_at),
  CONSTRAINT fk_pseudonym_assignment_event_assignment FOREIGN KEY (assignment_id) REFERENCES candidate_pseudonym_assignment(id) ON DELETE SET NULL,
  CONSTRAINT fk_pseudonym_assignment_event_registration FOREIGN KEY (registration_id) REFERENCES candidate_registration(id),
  CONSTRAINT fk_pseudonym_assignment_event_operation FOREIGN KEY (operation_id) REFERENCES pseudonym_operation_state(id),
  CONSTRAINT fk_pseudonym_assignment_event_user FOREIGN KEY (actor_user_id) REFERENCES app_user(id),
  CONSTRAINT ck_pseudonym_assignment_event_value CHECK (
    pseudonym_value > 0 AND display_width BETWEEN 1 AND 100
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS legacy_pseudonym_reservation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  exam_cycle_id BIGINT UNSIGNED NOT NULL,
  admission_id BIGINT UNSIGNED NULL,
  source_assignment_id BIGINT UNSIGNED NOT NULL,
  scope_key BINARY(32) NOT NULL,
  pseudonym_value BIGINT UNSIGNED NOT NULL,
  reason_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_legacy_pseudonym_reservation_source (source_assignment_id),
  UNIQUE KEY uq_legacy_pseudonym_reservation_scope_value (scope_key, pseudonym_value),
  CONSTRAINT fk_legacy_pseudonym_reservation_cycle FOREIGN KEY (exam_cycle_id) REFERENCES exam_cycle(id),
  CONSTRAINT fk_legacy_pseudonym_reservation_admission FOREIGN KEY (admission_id) REFERENCES admission(id),
  CONSTRAINT fk_legacy_pseudonym_reservation_source FOREIGN KEY (source_assignment_id) REFERENCES pseudonym_assignment(id),
  CONSTRAINT ck_legacy_pseudonym_reservation_value CHECK (pseudonym_value > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
