CREATE TABLE IF NOT EXISTS user_admission_assignment (
  user_id BIGINT UNSIGNED NOT NULL,
  admission_name VARCHAR(200) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, admission_name),
  KEY ix_user_admission_assignment_admission (admission_name),
  CONSTRAINT fk_user_admission_assignment_user
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO user_admission_assignment (user_id, admission_name)
SELECT u.id, admissions.admission_name
FROM app_user u
CROSS JOIN (
  SELECT DISTINCT admission AS admission_name
  FROM candidate_record
  WHERE admission <> ''
) admissions
WHERE u.role IN ('OPERATOR', 'VIEWER') AND u.enabled = TRUE;
