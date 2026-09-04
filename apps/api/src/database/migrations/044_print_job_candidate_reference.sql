ALTER TABLE print_job
  ADD COLUMN candidate_record_id BIGINT UNSIGNED NULL AFTER business_ref,
  ADD KEY ix_print_job_candidate_sent (candidate_record_id, status, sent_at),
  ADD CONSTRAINT fk_print_job_candidate_record
    FOREIGN KEY (candidate_record_id) REFERENCES candidate_record(id) ON DELETE SET NULL;

UPDATE print_job job
INNER JOIN (
  SELECT examinee_no, MIN(id) AS candidate_record_id
  FROM candidate_record
  GROUP BY examinee_no
  HAVING COUNT(*) = 1
) candidate ON candidate.examinee_no = job.business_ref
SET job.candidate_record_id = candidate.candidate_record_id
WHERE job.label_type = 'PSEUDONYM_LABEL' AND job.candidate_record_id IS NULL;

ALTER TABLE print_job
  MODIFY COLUMN candidate_record_id BIGINT UNSIGNED NULL COMMENT '라벨을 출력한 수험생 데이터 레코드 식별자';
