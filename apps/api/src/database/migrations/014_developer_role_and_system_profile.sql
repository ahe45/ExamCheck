ALTER TABLE app_user
  MODIFY COLUMN role ENUM('ADMIN', 'OPERATOR', 'VIEWER', 'DEVELOPER') NOT NULL DEFAULT 'VIEWER';

CREATE TABLE IF NOT EXISTS system_profile (
  id TINYINT UNSIGNED NOT NULL,
  school_name VARCHAR(200) NOT NULL,
  academic_year SMALLINT UNSIGNED NOT NULL,
  system_name VARCHAR(200) NOT NULL,
  logo_file_name VARCHAR(255) NULL,
  logo_mime_type VARCHAR(100) NULL,
  logo_data MEDIUMBLOB NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_system_profile_updated_by FOREIGN KEY (updated_by) REFERENCES app_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO system_profile (id, school_name, academic_year, system_name)
VALUES (1, '한국대학교', 2026, '가번호 관리 시스템');
