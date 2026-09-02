CREATE TABLE IF NOT EXISTS candidate_identity_photo (
  candidate_id BIGINT UNSIGNED NOT NULL,
  source_candidate_record_id BIGINT UNSIGNED NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  content LONGBLOB NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (candidate_id),
  UNIQUE KEY uq_candidate_identity_photo_source (source_candidate_record_id),
  CONSTRAINT fk_candidate_identity_photo_candidate FOREIGN KEY (candidate_id) REFERENCES candidate(id),
  CONSTRAINT fk_candidate_identity_photo_source FOREIGN KEY (source_candidate_record_id) REFERENCES candidate_record(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
