ALTER TABLE pseudonym_assignment
  ADD COLUMN is_absentee BOOLEAN NOT NULL DEFAULT FALSE AFTER assignment_mode,
  ADD COLUMN auto_assigned_on_close BOOLEAN NOT NULL DEFAULT FALSE AFTER is_absentee;

CREATE TABLE IF NOT EXISTS pseudonym_operation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  exam_name VARCHAR(200) NOT NULL,
  exam_date DATE NOT NULL,
  exam_time VARCHAR(5) NOT NULL,
  period_name VARCHAR(100) NOT NULL,
  admission_name VARCHAR(200) NOT NULL,
  closed BOOLEAN NOT NULL DEFAULT FALSE,
  closed_by BIGINT UNSIGNED NULL,
  closed_at DATETIME(3) NULL,
  reopened_by BIGINT UNSIGNED NULL,
  reopened_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pseudonym_operation_schedule (exam_name, exam_date, exam_time, period_name, admission_name),
  KEY ix_pseudonym_operation_closed (closed, exam_date),
  CONSTRAINT fk_pseudonym_operation_closed_by FOREIGN KEY (closed_by) REFERENCES app_user(id),
  CONSTRAINT fk_pseudonym_operation_reopened_by FOREIGN KEY (reopened_by) REFERENCES app_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
