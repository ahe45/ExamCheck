CREATE TABLE IF NOT EXISTS identity_transition_state (
  id TINYINT UNSIGNED NOT NULL,
  schema_version INT UNSIGNED NOT NULL DEFAULT 1,
  write_mode ENUM('LEGACY', 'DUAL', 'CANONICAL') NOT NULL DEFAULT 'LEGACY',
  read_mode ENUM('LEGACY', 'SHADOW', 'CANARY', 'CANONICAL') NOT NULL DEFAULT 'LEGACY',
  phase ENUM('EXPANDED', 'BACKFILLING', 'BACKFILLED', 'SHADOWING', 'CANARY', 'CANONICAL', 'BLOCKED') NOT NULL DEFAULT 'EXPANDED',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  last_backfill_run_id CHAR(36) NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_identity_transition_state_user FOREIGN KEY (updated_by) REFERENCES app_user(id),
  CONSTRAINT ck_identity_transition_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS identity_backfill_run (
  id CHAR(36) NOT NULL,
  status ENUM('RUNNING', 'SUCCEEDED', 'BLOCKED', 'FAILED') NOT NULL,
  source_high_water_mark BIGINT UNSIGNED NOT NULL DEFAULT 0,
  exact_count INT UNSIGNED NOT NULL DEFAULT 0,
  issue_count INT UNSIGNED NOT NULL DEFAULT 0,
  report_json JSON NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_identity_backfill_run_status (status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS identity_backfill_checkpoint (
  run_id CHAR(36) NOT NULL,
  entity_type VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  last_source_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  processed_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (run_id, entity_type),
  CONSTRAINT fk_identity_backfill_checkpoint_run FOREIGN KEY (run_id) REFERENCES identity_backfill_run(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS identity_migration_issue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id CHAR(36) NOT NULL,
  entity_type VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_id BIGINT UNSIGNED NULL,
  issue_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  details_json JSON NULL,
  status ENUM('OPEN', 'RESOLVED', 'ACCEPTED') NOT NULL DEFAULT 'OPEN',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_identity_migration_issue_run_source (run_id, entity_type, source_id, issue_code),
  KEY ix_identity_migration_issue_status (status, issue_code),
  CONSTRAINT fk_identity_migration_issue_run FOREIGN KEY (run_id) REFERENCES identity_backfill_run(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS identity_shadow_observation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  observation_type VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_high_water_mark BIGINT UNSIGNED NOT NULL DEFAULT 0,
  old_row_count INT UNSIGNED NOT NULL,
  new_row_count INT UNSIGNED NOT NULL,
  match_count INT UNSIGNED NOT NULL,
  mismatch_count INT UNSIGNED NOT NULL,
  old_only_count INT UNSIGNED NOT NULL,
  new_only_count INT UNSIGNED NOT NULL,
  ambiguous_count INT UNSIGNED NOT NULL,
  observed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_identity_shadow_observation_type (observation_type, observed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS identity_canary_user (
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_identity_canary_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS identity_canary_admission (
  admission_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (admission_id),
  CONSTRAINT fk_identity_canary_admission FOREIGN KEY (admission_id) REFERENCES admission(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO identity_transition_state (id) VALUES (1);
