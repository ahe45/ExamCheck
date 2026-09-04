ALTER TABLE candidate_record
  MODIFY COLUMN birth_date DATE NULL COMMENT '수험생 생년월일. 기존 운영 데이터에 값이 없으면 NULL',
  ADD COLUMN exam_name VARCHAR(200) NOT NULL DEFAULT '' AFTER name,
  ADD COLUMN label_barcode VARCHAR(100) NOT NULL DEFAULT '' AFTER temporary_no,
  ADD COLUMN status ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE' AFTER label_barcode;

UPDATE candidate_record candidate
INNER JOIN examinee legacy ON legacy.examinee_no = candidate.examinee_no
SET candidate.exam_name = legacy.exam_name,
    candidate.label_barcode = legacy.label_barcode,
    candidate.status = legacy.status,
    candidate.designated_sort = CASE
      WHEN candidate.designated_sort = '' THEN legacy.seat_no
      ELSE candidate.designated_sort
    END,
    candidate.temporary_no = CASE
      WHEN candidate.temporary_no = '' THEN COALESCE(legacy.preassigned_pseudonym_no, '')
      ELSE candidate.temporary_no
    END;

INSERT INTO candidate_record (
  designated_sort, admission, unit_name, exam_date, start_time, period_name,
  building_name, room_name, examinee_no, temporary_no, label_barcode, status,
  name, exam_name, birth_date
)
SELECT legacy.seat_no,
       COALESCE((SELECT MIN(assignment.admission_name)
                 FROM pseudonym_assignment assignment
                 WHERE assignment.examinee_id = legacy.id), ''),
       '', legacy.exam_date, '00:00', '기존 데이터',
       '', legacy.room_name, legacy.examinee_no,
       COALESCE(legacy.preassigned_pseudonym_no, ''), legacy.label_barcode, legacy.status,
       legacy.name, legacy.exam_name, NULL
FROM examinee legacy
LEFT JOIN candidate_record candidate ON candidate.examinee_no = legacy.examinee_no
WHERE candidate.id IS NULL;

UPDATE pseudonym_assignment assignment
INNER JOIN examinee legacy ON legacy.id = assignment.examinee_id
INNER JOIN (
  SELECT examinee_no, MIN(id) AS candidate_record_id
  FROM candidate_record
  GROUP BY examinee_no
) candidate ON candidate.examinee_no = legacy.examinee_no
SET assignment.candidate_record_id = candidate.candidate_record_id
WHERE assignment.candidate_record_id IS NULL;

ALTER TABLE pseudonym_assignment
  DROP FOREIGN KEY fk_pseudonym_assignment_examinee,
  DROP INDEX ix_pseudonym_assignment_examinee,
  MODIFY COLUMN candidate_record_id BIGINT UNSIGNED NOT NULL COMMENT '연관된 수험생 데이터 레코드 식별자',
  DROP COLUMN examinee_id;

DELETE template
FROM form_template template
INNER JOIN form_template_deletion deletion ON deletion.code = template.code;

DROP TABLE form_template_deletion;

DROP TRIGGER IF EXISTS trg_print_job_reissue_event_no_update;
DROP TRIGGER IF EXISTS trg_print_job_reissue_event_no_delete;
DROP TRIGGER IF EXISTS trg_audit_log_identity_source_mutation_watermark;

ALTER TABLE print_job
  DROP FOREIGN KEY fk_print_job_registration,
  DROP FOREIGN KEY fk_print_job_canonical_assignment,
  DROP FOREIGN KEY fk_print_job_operation_slot,
  DROP FOREIGN KEY fk_print_job_original,
  DROP INDEX ix_print_job_registration,
  DROP INDEX fk_print_job_canonical_assignment,
  DROP INDEX ix_print_job_operation_slot,
  DROP INDEX fk_print_job_original,
  DROP COLUMN candidate_registration_id,
  DROP COLUMN canonical_assignment_id,
  DROP COLUMN operation_slot_id,
  DROP COLUMN original_job_id,
  DROP COLUMN reprint_reason;

ALTER TABLE app_user
  DROP COLUMN admission_scope_mode;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS identity_transition_history_evidence;
DROP TABLE IF EXISTS identity_transition_request_evidence;
DROP TABLE IF EXISTS identity_transition_request_approval;
DROP TABLE IF EXISTS identity_transition_state_history;
DROP TABLE IF EXISTS identity_transition_gate_evidence;
DROP TABLE IF EXISTS identity_transition_request;
DROP TABLE IF EXISTS identity_shadow_observation;
DROP TABLE IF EXISTS identity_shadow_verification_batch;
DROP TABLE IF EXISTS identity_backfill_checkpoint;
DROP TABLE IF EXISTS identity_migration_issue;
DROP TABLE IF EXISTS identity_backfill_run;
DROP TABLE IF EXISTS identity_canary_admission;
DROP TABLE IF EXISTS identity_canary_user;
DROP TABLE IF EXISTS identity_source_mutation_watermark;
DROP TABLE IF EXISTS identity_transition_state;
DROP TABLE IF EXISTS print_job_reissue_event;
DROP TABLE IF EXISTS print_projection_snapshot;
DROP TABLE IF EXISTS pseudonym_assignment_event;
DROP TABLE IF EXISTS pseudonym_operation_event;
DROP TABLE IF EXISTS pseudonym_number_claim;
DROP TABLE IF EXISTS candidate_registration_slot_claim;
DROP TABLE IF EXISTS candidate_number_claim;
DROP TABLE IF EXISTS candidate_identity_photo;
DROP TABLE IF EXISTS legacy_pseudonym_reservation;
DROP TABLE IF EXISTS user_admission_scope_assignment;
DROP TABLE IF EXISTS candidate_pseudonym_assignment;
DROP TABLE IF EXISTS pseudonym_operation_state;
DROP TABLE IF EXISTS pseudonym_range;
DROP TABLE IF EXISTS pseudonym_policy;
DROP TABLE IF EXISTS candidate_registration;
DROP TABLE IF EXISTS schedule_segment;
DROP TABLE IF EXISTS operation_slot;
DROP TABLE IF EXISTS admission_identity_alias;
DROP TABLE IF EXISTS number_uniqueness_policy;
DROP TABLE IF EXISTS candidate;
DROP TABLE IF EXISTS admission;
DROP TABLE IF EXISTS exam_cycle;
DROP TABLE IF EXISTS examinee;

SET FOREIGN_KEY_CHECKS = 1;

ALTER TABLE candidate_record
  MODIFY COLUMN exam_name VARCHAR(200) NOT NULL COMMENT '시험의 표시 명칭',
  MODIFY COLUMN label_barcode VARCHAR(100) NOT NULL COMMENT '라벨과 스캔에 사용하는 수험생 바코드',
  MODIFY COLUMN status ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE' COMMENT '수험생 데이터의 현재 처리 상태';

ALTER TABLE candidate_record
  COMMENT = '수험생 기본 정보, 시험 편성, 라벨 식별값을 통합 관리한다.';
