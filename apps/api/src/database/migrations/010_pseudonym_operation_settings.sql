ALTER TABLE pseudonym_setting
  ADD COLUMN assignment_method ENUM('DRAW', 'MATCHING', 'PREASSIGNED') NOT NULL DEFAULT 'DRAW' AFTER next_sequence,
  ADD COLUMN auto_assign_absentees_on_close BOOLEAN NOT NULL DEFAULT FALSE AFTER assignment_method,
  ADD COLUMN delete_absentee_info_on_reopen BOOLEAN NOT NULL DEFAULT FALSE AFTER auto_assign_absentees_on_close,
  ADD COLUMN use_candidate_photos BOOLEAN NOT NULL DEFAULT TRUE AFTER delete_absentee_info_on_reopen,
  ADD COLUMN enable_bulk_draw BOOLEAN NOT NULL DEFAULT FALSE AFTER use_candidate_photos;

CREATE TABLE IF NOT EXISTS pseudonym_time_range (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  setting_id BIGINT UNSIGNED NOT NULL,
  exam_date DATE NOT NULL,
  exam_time VARCHAR(5) NOT NULL,
  range_start INT UNSIGNED NOT NULL,
  range_end INT UNSIGNED NOT NULL,
  next_sequence INT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pseudonym_time_range_schedule (setting_id, exam_date, exam_time),
  CONSTRAINT fk_pseudonym_time_range_setting FOREIGN KEY (setting_id) REFERENCES pseudonym_setting(id) ON DELETE CASCADE,
  CONSTRAINT fk_pseudonym_time_range_updated_by FOREIGN KEY (updated_by) REFERENCES app_user(id),
  CONSTRAINT ck_pseudonym_time_range_values CHECK (range_start <= range_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO pseudonym_time_range
  (setting_id, exam_date, exam_time, range_start, range_end, next_sequence, updated_by)
SELECT ps.id, cr.exam_date, cr.start_time, ps.range_start, ps.range_end, ps.next_sequence, ps.updated_by
FROM pseudonym_setting ps
CROSS JOIN (SELECT DISTINCT exam_date, start_time FROM candidate_record) cr;
