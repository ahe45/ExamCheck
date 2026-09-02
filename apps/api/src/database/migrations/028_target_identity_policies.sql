CREATE TABLE IF NOT EXISTS number_uniqueness_policy (
  exam_cycle_id BIGINT UNSIGNED NOT NULL,
  examinee_scope ENUM('SYSTEM', 'SCHEDULE') NOT NULL DEFAULT 'SYSTEM',
  pseudonym_scope ENUM('ADMISSION', 'SCHEDULE') NOT NULL DEFAULT 'ADMISSION',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (exam_cycle_id),
  CONSTRAINT fk_number_uniqueness_policy_cycle FOREIGN KEY (exam_cycle_id) REFERENCES exam_cycle(id),
  CONSTRAINT fk_number_uniqueness_policy_user FOREIGN KEY (updated_by) REFERENCES app_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate_number_claim (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidate_id BIGINT UNSIGNED NOT NULL,
  registration_id BIGINT UNSIGNED NULL,
  scope_kind ENUM('SYSTEM', 'SCHEDULE') NOT NULL,
  exam_cycle_id BIGINT UNSIGNED NOT NULL,
  operation_slot_id BIGINT UNSIGNED NULL,
  scope_key BINARY(32) NOT NULL,
  owner_key BINARY(32) NOT NULL,
  examinee_no_canonical VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_candidate_number_claim_owner (owner_key),
  UNIQUE KEY uq_candidate_number_claim_scope_number (scope_key, examinee_no_canonical),
  KEY ix_candidate_number_claim_cycle (exam_cycle_id, scope_kind),
  CONSTRAINT fk_candidate_number_claim_candidate FOREIGN KEY (candidate_id) REFERENCES candidate(id),
  CONSTRAINT fk_candidate_number_claim_registration FOREIGN KEY (registration_id) REFERENCES candidate_registration(id),
  CONSTRAINT fk_candidate_number_claim_cycle FOREIGN KEY (exam_cycle_id) REFERENCES exam_cycle(id),
  CONSTRAINT fk_candidate_number_claim_slot FOREIGN KEY (operation_slot_id) REFERENCES operation_slot(id),
  CONSTRAINT ck_candidate_number_claim_scope CHECK (
    (scope_kind = 'SYSTEM' AND operation_slot_id IS NULL AND registration_id IS NULL)
    OR (scope_kind = 'SCHEDULE' AND operation_slot_id IS NOT NULL AND registration_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate_registration_slot_claim (
  registration_id BIGINT UNSIGNED NOT NULL,
  candidate_id BIGINT UNSIGNED NOT NULL,
  operation_slot_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (registration_id),
  UNIQUE KEY uq_candidate_registration_slot_claim (candidate_id, operation_slot_id),
  CONSTRAINT fk_candidate_registration_slot_claim_registration FOREIGN KEY (registration_id) REFERENCES candidate_registration(id) ON DELETE CASCADE,
  CONSTRAINT fk_candidate_registration_slot_claim_candidate FOREIGN KEY (candidate_id) REFERENCES candidate(id),
  CONSTRAINT fk_candidate_registration_slot_claim_slot FOREIGN KEY (operation_slot_id) REFERENCES operation_slot(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pseudonym_policy (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  exam_cycle_id BIGINT UNSIGNED NOT NULL,
  scope_kind ENUM('DEFAULT', 'ADMISSION') NOT NULL,
  admission_id BIGINT UNSIGNED NULL,
  scope_key BINARY(32) NOT NULL,
  source_setting_id BIGINT UNSIGNED NULL,
  assignment_method ENUM('DRAW', 'SEQUENTIAL', 'MATCHING', 'PREASSIGNED') NOT NULL DEFAULT 'DRAW',
  auto_draw_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_draw_delay_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  print_preassigned_label BOOLEAN NOT NULL DEFAULT FALSE,
  auto_assign_absentees_on_close BOOLEAN NOT NULL DEFAULT FALSE,
  delete_absentee_info_on_reopen BOOLEAN NOT NULL DEFAULT FALSE,
  use_candidate_photos BOOLEAN NOT NULL DEFAULT TRUE,
  enable_bulk_draw BOOLEAN NOT NULL DEFAULT FALSE,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pseudonym_policy_scope (scope_key),
  UNIQUE KEY uq_pseudonym_policy_admission (admission_id),
  UNIQUE KEY uq_pseudonym_policy_source (source_setting_id),
  KEY ix_pseudonym_policy_cycle (exam_cycle_id, scope_kind),
  CONSTRAINT fk_pseudonym_policy_cycle FOREIGN KEY (exam_cycle_id) REFERENCES exam_cycle(id),
  CONSTRAINT fk_pseudonym_policy_admission FOREIGN KEY (admission_id) REFERENCES admission(id),
  CONSTRAINT fk_pseudonym_policy_source FOREIGN KEY (source_setting_id) REFERENCES pseudonym_setting(id),
  CONSTRAINT fk_pseudonym_policy_user FOREIGN KEY (updated_by) REFERENCES app_user(id),
  CONSTRAINT ck_pseudonym_policy_scope CHECK (
    (scope_kind = 'DEFAULT' AND admission_id IS NULL)
    OR (scope_kind = 'ADMISSION' AND admission_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pseudonym_range (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pseudonym_policy_id BIGINT UNSIGNED NOT NULL,
  schedule_segment_id BIGINT UNSIGNED NOT NULL,
  source_time_range_id BIGINT UNSIGNED NULL,
  range_start_value BIGINT UNSIGNED NOT NULL,
  range_end_value BIGINT UNSIGNED NOT NULL,
  next_value BIGINT UNSIGNED NOT NULL,
  display_width SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pseudonym_range_policy_segment (pseudonym_policy_id, schedule_segment_id),
  UNIQUE KEY uq_pseudonym_range_source (source_time_range_id),
  KEY ix_pseudonym_range_segment (schedule_segment_id),
  CONSTRAINT fk_pseudonym_range_policy FOREIGN KEY (pseudonym_policy_id) REFERENCES pseudonym_policy(id),
  CONSTRAINT fk_pseudonym_range_segment FOREIGN KEY (schedule_segment_id) REFERENCES schedule_segment(id),
  CONSTRAINT fk_pseudonym_range_source FOREIGN KEY (source_time_range_id) REFERENCES pseudonym_time_range(id),
  CONSTRAINT fk_pseudonym_range_user FOREIGN KEY (updated_by) REFERENCES app_user(id),
  CONSTRAINT ck_pseudonym_range_values CHECK (
    range_start_value > 0
    AND range_start_value <= range_end_value
    AND next_value >= range_start_value
    AND next_value <= range_end_value + 1
    AND display_width BETWEEN 1 AND 100
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
