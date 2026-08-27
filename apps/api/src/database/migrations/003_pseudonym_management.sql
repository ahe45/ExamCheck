ALTER TABLE examinee
  ADD COLUMN preassigned_pseudonym_no VARCHAR(50) NULL AFTER label_barcode;

CREATE TABLE IF NOT EXISTS pseudonym_setting (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  exam_name VARCHAR(200) NOT NULL,
  range_start INT UNSIGNED NOT NULL,
  range_end INT UNSIGNED NOT NULL,
  next_sequence INT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pseudonym_setting_exam_name (exam_name),
  CONSTRAINT fk_pseudonym_setting_updated_by FOREIGN KEY (updated_by) REFERENCES app_user(id),
  CONSTRAINT ck_pseudonym_setting_range CHECK (range_start <= range_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pseudonym_assignment (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  examinee_id BIGINT UNSIGNED NOT NULL,
  exam_name VARCHAR(200) NOT NULL,
  pseudonym_no VARCHAR(50) NOT NULL,
  assignment_mode ENUM('RANDOM', 'SEQUENTIAL', 'MANUAL', 'PREASSIGNED') NOT NULL,
  assigned_by BIGINT UNSIGNED NOT NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pseudonym_assignment_examinee (examinee_id),
  UNIQUE KEY uq_pseudonym_assignment_exam_number (exam_name, pseudonym_no),
  KEY ix_pseudonym_assignment_assigned_at (assigned_at),
  CONSTRAINT fk_pseudonym_assignment_examinee FOREIGN KEY (examinee_id) REFERENCES examinee(id),
  CONSTRAINT fk_pseudonym_assignment_user FOREIGN KEY (assigned_by) REFERENCES app_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE examinee SET preassigned_pseudonym_no = '1501' WHERE examinee_no = '20260001';
UPDATE examinee SET preassigned_pseudonym_no = '1502' WHERE examinee_no = '20260002';
UPDATE examinee SET preassigned_pseudonym_no = '1503' WHERE examinee_no = '20260003';

INSERT IGNORE INTO pseudonym_setting
  (exam_name, range_start, range_end, next_sequence, active, updated_by)
SELECT '2026년도 자격시험', 1001, 1999, 1001, TRUE, id
FROM app_user WHERE login_id = 'system';

INSERT IGNORE INTO label_template (code, version, name, zpl_template, active, created_by)
SELECT 'PSEUDONYM_LABEL', 1, '가번호 라벨',
       '^XA^PW600^LL360^FO35,25^A0N,28,28^FDPSEUDONYM NUMBER^FS^FO35,75^A0N,70,70^FD{{PSEUDONYM_NO}}^FS^FO35,165^BCN,95,Y,N,N^FD{{PSEUDONYM_NO}}^FS^FO35,300^A0N,18,18^FDEXAM: {{EXAMINEE_NO}}^FS^XZ',
       TRUE, id
FROM app_user WHERE login_id = 'system';
