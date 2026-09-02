CREATE TABLE IF NOT EXISTS form_template_deletion (
  code VARCHAR(100) NOT NULL,
  deleted_by BIGINT UNSIGNED NOT NULL,
  deleted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (code),
  KEY ix_form_template_deletion_deleted_at (deleted_at),
  CONSTRAINT fk_form_template_deletion_user FOREIGN KEY (deleted_by) REFERENCES app_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
