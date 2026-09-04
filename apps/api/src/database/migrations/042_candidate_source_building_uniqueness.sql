ALTER TABLE candidate_record
  DROP INDEX uq_candidate_record_source,
  ADD UNIQUE KEY uq_candidate_record_source
    (examinee_no, exam_date, start_time, period_name, building_name);
