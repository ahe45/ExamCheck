CREATE TABLE IF NOT EXISTS exam_cycle (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  system_profile_id TINYINT UNSIGNED NOT NULL,
  cycle_code VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  academic_year SMALLINT UNSIGNED NOT NULL,
  starts_on DATE NULL,
  ends_on DATE NULL,
  status ENUM('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_exam_cycle_profile_code (system_profile_id, cycle_code),
  KEY ix_exam_cycle_profile_status (system_profile_id, status),
  CONSTRAINT fk_exam_cycle_profile FOREIGN KEY (system_profile_id) REFERENCES system_profile(id),
  CONSTRAINT fk_exam_cycle_created_by FOREIGN KEY (created_by) REFERENCES app_user(id),
  CONSTRAINT fk_exam_cycle_updated_by FOREIGN KEY (updated_by) REFERENCES app_user(id),
  CONSTRAINT ck_exam_cycle_dates CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admission (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  exam_cycle_id BIGINT UNSIGNED NOT NULL,
  source_code VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  display_name VARCHAR(200) NOT NULL,
  canonical_name VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  identity_key BINARY(32) NOT NULL,
  status ENUM('ACTIVE', 'INACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admission_cycle_id (exam_cycle_id, id),
  UNIQUE KEY uq_admission_cycle_identity (exam_cycle_id, identity_key),
  UNIQUE KEY uq_admission_cycle_source_code (exam_cycle_id, source_code),
  KEY ix_admission_cycle_status (exam_cycle_id, status),
  CONSTRAINT fk_admission_cycle FOREIGN KEY (exam_cycle_id) REFERENCES exam_cycle(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admission_identity_alias (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  exam_cycle_id BIGINT UNSIGNED NOT NULL,
  admission_id BIGINT UNSIGNED NOT NULL,
  alias_type ENUM('CODE', 'NAME') NOT NULL,
  alias_value VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  alias_key BINARY(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admission_identity_alias_cycle (exam_cycle_id, alias_key),
  KEY ix_admission_identity_alias_admission (admission_id),
  CONSTRAINT fk_admission_identity_alias_cycle FOREIGN KEY (exam_cycle_id) REFERENCES exam_cycle(id),
  CONSTRAINT fk_admission_identity_alias_admission FOREIGN KEY (exam_cycle_id, admission_id)
    REFERENCES admission(exam_cycle_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operation_slot (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admission_id BIGINT UNSIGNED NOT NULL,
  exam_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NULL,
  period_code VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  period_name VARCHAR(100) NOT NULL,
  period_canonical_name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  identity_key BINARY(32) NOT NULL,
  status ENUM('ACTIVE', 'INACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_operation_slot_admission_identity (admission_id, identity_key),
  KEY ix_operation_slot_schedule (admission_id, exam_date, start_time),
  CONSTRAINT fk_operation_slot_admission FOREIGN KEY (admission_id) REFERENCES admission(id),
  CONSTRAINT ck_operation_slot_times CHECK (end_time IS NULL OR start_time <= end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schedule_segment (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_slot_id BIGINT UNSIGNED NOT NULL,
  unit_code VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  unit_name VARCHAR(200) NOT NULL DEFAULT '',
  major_code VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  major_name VARCHAR(200) NOT NULL DEFAULT '',
  building_code VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  building_name VARCHAR(200) NOT NULL DEFAULT '',
  room_code VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  room_name VARCHAR(200) NOT NULL DEFAULT '',
  identity_key BINARY(32) NOT NULL,
  status ENUM('ACTIVE', 'INACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_schedule_segment_slot_identity (operation_slot_id, identity_key),
  KEY ix_schedule_segment_room (operation_slot_id, building_name, room_name),
  CONSTRAINT fk_schedule_segment_slot FOREIGN KEY (operation_slot_id) REFERENCES operation_slot(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  exam_cycle_id BIGINT UNSIGNED NOT NULL,
  source_examinee_id BIGINT UNSIGNED NULL,
  examinee_no_display VARCHAR(100) NOT NULL,
  examinee_no_canonical VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  birth_date DATE NOT NULL,
  source_hash BINARY(32) NOT NULL,
  status ENUM('ACTIVE', 'QUARANTINED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_candidate_cycle_number (exam_cycle_id, examinee_no_canonical),
  UNIQUE KEY uq_candidate_source_examinee (source_examinee_id),
  KEY ix_candidate_cycle_name (exam_cycle_id, name),
  CONSTRAINT fk_candidate_cycle FOREIGN KEY (exam_cycle_id) REFERENCES exam_cycle(id),
  CONSTRAINT fk_candidate_source_examinee FOREIGN KEY (source_examinee_id) REFERENCES examinee(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate_registration (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidate_id BIGINT UNSIGNED NOT NULL,
  schedule_segment_id BIGINT UNSIGNED NOT NULL,
  source_candidate_record_id BIGINT UNSIGNED NULL,
  designated_sort VARCHAR(100) NOT NULL DEFAULT '',
  group_name VARCHAR(100) NOT NULL DEFAULT '',
  opt1 VARCHAR(500) NOT NULL DEFAULT '',
  opt2 VARCHAR(500) NOT NULL DEFAULT '',
  opt3 VARCHAR(500) NOT NULL DEFAULT '',
  preassigned_value BIGINT UNSIGNED NULL,
  preassigned_display_width SMALLINT UNSIGNED NULL,
  source_hash BINARY(32) NOT NULL,
  status ENUM('ACTIVE', 'CANCELLED', 'QUARANTINED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_candidate_registration_source (source_candidate_record_id),
  UNIQUE KEY uq_candidate_registration_segment (candidate_id, schedule_segment_id),
  KEY ix_candidate_registration_segment_status (schedule_segment_id, status),
  CONSTRAINT fk_candidate_registration_candidate FOREIGN KEY (candidate_id) REFERENCES candidate(id),
  CONSTRAINT fk_candidate_registration_segment FOREIGN KEY (schedule_segment_id) REFERENCES schedule_segment(id),
  CONSTRAINT fk_candidate_registration_source FOREIGN KEY (source_candidate_record_id) REFERENCES candidate_record(id),
  CONSTRAINT ck_candidate_registration_preassigned CHECK (
    (preassigned_value IS NULL AND preassigned_display_width IS NULL)
    OR (
      preassigned_value IS NOT NULL
      AND preassigned_display_width IS NOT NULL
      AND preassigned_value > 0
      AND preassigned_display_width BETWEEN 1 AND 100
    )
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
