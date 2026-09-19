CREATE TABLE IF NOT EXISTS pseudonym_admission_lock (
 exam_name VARCHAR(200) NOT NULL,
 admission_name VARCHAR(200) NOT NULL,
 PRIMARY KEY (exam_name, admission_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate_import_lock (
 examinee_no VARCHAR(100) NOT NULL PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX ix_candidate_operation ON candidate_record
 (admission, exam_date, start_time, period_name, status, id);
CREATE INDEX ix_candidate_exam_admission ON candidate_record (exam_name, admission, status);
CREATE INDEX ix_time_range_operation ON pseudonym_time_range (setting_id, exam_date, exam_time, period_name, admission);

CREATE TABLE IF NOT EXISTS pseudonym_operation_mutex (
 exam_name VARCHAR(200) NOT NULL, exam_date DATE NOT NULL, exam_time VARCHAR(5) NOT NULL,
 period_name VARCHAR(100) NOT NULL, admission_name VARCHAR(200) NOT NULL,
 PRIMARY KEY (exam_name, exam_date, exam_time, period_name, admission_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate_upload_session (
 id CHAR(36) NOT NULL PRIMARY KEY,
 owner_id BIGINT UNSIGNED NOT NULL,
 kind ENUM('WORKBOOK','PHOTO_ARCHIVE') NOT NULL,
 status ENUM('PARSING','PREVIEW','QUEUED','RUNNING','SUCCEEDED','FAILED') NOT NULL,
 file_name VARCHAR(255) NOT NULL,
 checksum CHAR(64) NOT NULL,
 state_checksum CHAR(64) NULL,
 policy VARCHAR(32) NULL,
 preview_json LONGTEXT NULL,
 result_json LONGTEXT NULL,
 error_message VARCHAR(1000) NULL,
 processed INT UNSIGNED NOT NULL DEFAULT 0,
 total INT UNSIGNED NOT NULL DEFAULT 0,
 expires_at DATETIME(3) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 KEY ix_upload_owner (owner_id, created_at),
 KEY ix_upload_expiry (expires_at),
 CONSTRAINT fk_upload_owner FOREIGN KEY (owner_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
