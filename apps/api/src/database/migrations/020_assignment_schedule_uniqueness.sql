ALTER TABLE pseudonym_assignment
  DROP INDEX uq_pseudonym_assignment_examinee,
  DROP INDEX uq_pseudonym_assignment_exam_admission_number,
  ADD UNIQUE KEY uq_pseudonym_assignment_candidate (candidate_record_id),
  ADD UNIQUE KEY uq_pseudonym_assignment_number_scope
    (exam_name, admission_name, uniqueness_scope_key, pseudonym_no);
