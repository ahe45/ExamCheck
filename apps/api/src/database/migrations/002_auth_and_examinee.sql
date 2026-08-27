ALTER TABLE app_user
  ADD COLUMN password_hash VARCHAR(255) NULL AFTER login_id;

CREATE TABLE IF NOT EXISTS examinee (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  examinee_no VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  exam_name VARCHAR(200) NOT NULL,
  exam_date DATE NOT NULL,
  room_name VARCHAR(100) NOT NULL,
  seat_no VARCHAR(50) NOT NULL,
  label_barcode VARCHAR(100) NOT NULL,
  status ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_examinee_no (examinee_no),
  UNIQUE KEY uq_examinee_label_barcode (label_barcode),
  KEY ix_examinee_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO examinee
  (examinee_no, name, exam_name, exam_date, room_name, seat_no, label_barcode)
VALUES
  ('20260001', '김민준', '2026년도 자격시험', '2026-09-12', 'A-101', '01', 'EX20260001'),
  ('20260002', '이서연', '2026년도 자격시험', '2026-09-12', 'A-101', '02', 'EX20260002'),
  ('20260003', '박지후', '2026년도 자격시험', '2026-09-12', 'A-102', '01', 'EX20260003');

INSERT IGNORE INTO label_template (code, version, name, zpl_template, active, created_by)
SELECT 'CANDIDATE_LABEL', 1, '수험생 라벨',
       '^XA^PW600^LL360^FO35,25^A0N,28,28^FDEXAM CANDIDATE^FS^FO35,70^A0N,26,26^FDNO: {{EXAMINEE_NO}}^FS^FO35,110^A0N,26,26^FDROOM: {{ROOM_NAME}}  SEAT: {{SEAT_NO}}^FS^FO35,155^BCN,95,Y,N,N^FD{{BARCODE}}^FS^FO35,285^A0N,20,20^FD{{EXAM_DATE}}^FS^XZ',
       TRUE, id
FROM app_user WHERE login_id = 'system';
