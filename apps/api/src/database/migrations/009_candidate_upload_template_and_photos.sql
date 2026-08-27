ALTER TABLE candidate_record
  ADD COLUMN waiting_room VARCHAR(200) NOT NULL DEFAULT '' AFTER room_code,
  ADD COLUMN gender VARCHAR(50) NOT NULL DEFAULT '' AFTER group_name,
  MODIFY track VARCHAR(200) NOT NULL DEFAULT '',
  MODIFY admission_code VARCHAR(100) NOT NULL DEFAULT '',
  MODIFY series VARCHAR(200) NOT NULL DEFAULT '',
  MODIFY unit_code VARCHAR(100) NOT NULL DEFAULT '',
  MODIFY period_code VARCHAR(100) NOT NULL DEFAULT '',
  MODIFY building_code VARCHAR(100) NOT NULL DEFAULT '',
  MODIFY room_code VARCHAR(100) NOT NULL DEFAULT '';

ALTER TABLE candidate_record
  DROP INDEX uq_candidate_record_exam_period,
  ADD UNIQUE KEY uq_candidate_record_source (examinee_no, exam_date, start_time, period_name);

CREATE TABLE IF NOT EXISTS candidate_photo (
  candidate_record_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  content LONGBLOB NOT NULL,
  content_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (candidate_record_id),
  CONSTRAINT fk_candidate_photo_record FOREIGN KEY (candidate_record_id) REFERENCES candidate_record(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
