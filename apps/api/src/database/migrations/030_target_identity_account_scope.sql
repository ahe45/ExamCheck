ALTER TABLE app_user
  ADD COLUMN admission_scope_mode ENUM('ALL', 'ASSIGNED') NULL AFTER role;

CREATE TABLE IF NOT EXISTS user_admission_scope_assignment (
  user_id BIGINT UNSIGNED NOT NULL,
  admission_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, admission_id),
  KEY ix_user_admission_scope_admission (admission_id),
  CONSTRAINT fk_user_admission_scope_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_admission_scope_admission FOREIGN KEY (admission_id) REFERENCES admission(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
