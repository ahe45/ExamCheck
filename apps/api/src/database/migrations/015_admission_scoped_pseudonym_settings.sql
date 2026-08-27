ALTER TABLE pseudonym_setting
  ADD COLUMN admission_name VARCHAR(200) NOT NULL DEFAULT '' AFTER exam_name,
  DROP INDEX uq_pseudonym_setting_exam_name,
  ADD UNIQUE KEY uq_pseudonym_setting_exam_admission (exam_name, admission_name);

ALTER TABLE pseudonym_assignment
  ADD COLUMN admission_name VARCHAR(200) NOT NULL DEFAULT '' AFTER exam_name;

UPDATE pseudonym_assignment pa
SET admission_name = COALESCE((
  SELECT cr.admission
  FROM examinee e
  INNER JOIN candidate_record cr ON cr.examinee_no = e.examinee_no
  WHERE e.id = pa.examinee_id
  ORDER BY cr.id
  LIMIT 1
), '');

ALTER TABLE pseudonym_assignment
  DROP INDEX uq_pseudonym_assignment_exam_number,
  ADD UNIQUE KEY uq_pseudonym_assignment_exam_admission_number (exam_name, admission_name, pseudonym_no);
