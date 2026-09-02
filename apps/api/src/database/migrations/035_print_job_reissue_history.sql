CREATE TABLE IF NOT EXISTS print_job_reissue_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_print_job_id CHAR(36) NOT NULL,
  reissued_print_job_id CHAR(36) NOT NULL,
  reissue_type ENUM('RETRY', 'REPRINT') NOT NULL,
  reason_code VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_print_job_reissue_event_reissued (reissued_print_job_id),
  KEY ix_print_job_reissue_event_source (source_print_job_id, occurred_at),
  CONSTRAINT fk_print_job_reissue_event_source FOREIGN KEY (source_print_job_id) REFERENCES print_job(id),
  CONSTRAINT fk_print_job_reissue_event_reissued FOREIGN KEY (reissued_print_job_id) REFERENCES print_job(id),
  CONSTRAINT fk_print_job_reissue_event_actor FOREIGN KEY (actor_user_id) REFERENCES app_user(id),
  CONSTRAINT ck_print_job_reissue_event_distinct CHECK (source_print_job_id <> reissued_print_job_id),
  CONSTRAINT ck_print_job_reissue_event_reason CHECK (
    (reissue_type = 'RETRY' AND reason_code IN ('CLIENT_SEND_RETRY', 'PRINTER_RECOVERY'))
    OR
    (reissue_type = 'REPRINT' AND reason_code IN ('LABEL_DAMAGED', 'PRINT_QUALITY_ISSUE', 'OPERATOR_REQUEST'))
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TRIGGER trg_print_job_reissue_event_no_update
BEFORE UPDATE ON print_job_reissue_event
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'print_job_reissue_event is append-only';

CREATE TRIGGER trg_print_job_reissue_event_no_delete
BEFORE DELETE ON print_job_reissue_event
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'print_job_reissue_event is append-only';
