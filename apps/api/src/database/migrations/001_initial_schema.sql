CREATE TABLE IF NOT EXISTS app_user (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  login_id VARCHAR(100) NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  role ENUM('ADMIN', 'OPERATOR', 'VIEWER') NOT NULL DEFAULT 'VIEWER',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_user_login_id (login_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS label_template (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(100) NOT NULL,
  version INT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  zpl_template TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_label_template_code_version (code, version),
  CONSTRAINT fk_label_template_created_by FOREIGN KEY (created_by) REFERENCES app_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workstation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  location VARCHAR(200) NULL,
  description VARCHAR(500) NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_workstation_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS print_job (
  id CHAR(36) NOT NULL,
  job_no VARCHAR(100) NOT NULL,
  label_type VARCHAR(100) NOT NULL,
  business_ref VARCHAR(200) NULL,
  template_id BIGINT UNSIGNED NOT NULL,
  template_version INT UNSIGNED NOT NULL,
  workstation_id BIGINT UNSIGNED NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  copies INT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('CREATED', 'READY', 'DISPATCHING', 'SENT', 'FAILED', 'CANCELLED', 'EXPIRED') NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  dispatched_at DATETIME(3) NULL,
  sent_at DATETIME(3) NULL,
  failed_at DATETIME(3) NULL,
  error_code VARCHAR(100) NULL,
  error_message TEXT NULL,
  original_job_id CHAR(36) NULL,
  reprint_reason VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_print_job_job_no (job_no),
  KEY ix_print_job_workstation_created (workstation_id, created_at),
  KEY ix_print_job_status_expires (status, expires_at),
  CONSTRAINT fk_print_job_template FOREIGN KEY (template_id) REFERENCES label_template(id),
  CONSTRAINT fk_print_job_workstation FOREIGN KEY (workstation_id) REFERENCES workstation(id),
  CONSTRAINT fk_print_job_requested_by FOREIGN KEY (requested_by) REFERENCES app_user(id),
  CONSTRAINT fk_print_job_original FOREIGN KEY (original_job_id) REFERENCES print_job(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS print_job_payload (
  print_job_id CHAR(36) NOT NULL,
  format VARCHAR(20) NOT NULL DEFAULT 'ZPL',
  payload MEDIUMTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (print_job_id),
  CONSTRAINT fk_print_job_payload_job FOREIGN KEY (print_job_id) REFERENCES print_job(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_type VARCHAR(100) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  workstation_id BIGINT UNSIGNED NULL,
  print_job_id CHAR(36) NULL,
  request_id VARCHAR(100) NULL,
  details JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_audit_log_created_at (created_at),
  KEY ix_audit_log_print_job (print_job_id),
  CONSTRAINT fk_audit_log_actor FOREIGN KEY (actor_user_id) REFERENCES app_user(id),
  CONSTRAINT fk_audit_log_workstation FOREIGN KEY (workstation_id) REFERENCES workstation(id),
  CONSTRAINT fk_audit_log_print_job FOREIGN KEY (print_job_id) REFERENCES print_job(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO app_user (login_id, display_name, role)
VALUES ('system', 'System', 'ADMIN');

INSERT IGNORE INTO workstation (code, name, location, description)
VALUES ('WS-DEV-001', '개발용 워크스테이션', 'Development', 'Mock Printer 기본 워크스테이션');

INSERT IGNORE INTO label_template (code, version, name, zpl_template, active, created_by)
SELECT 'PRINTER_TEST', 1, 'GT800 테스트 라벨',
       '^XA^PW600^LL300^FO40,30^A0N,35,35^FDPRINTER TEST^FS^FO40,90^A0N,25,25^FDZEBRA GT800^FS^FO40,140^BCN,80,Y,N,N^FD1234567890^FS^XZ',
       TRUE, id
FROM app_user WHERE login_id = 'system';
