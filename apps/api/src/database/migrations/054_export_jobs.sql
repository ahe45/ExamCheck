ALTER TABLE candidate_upload_session MODIFY COLUMN kind ENUM('WORKBOOK','PHOTO_ARCHIVE','CANDIDATE_EXPORT') NOT NULL COMMENT '작업 종류: 명단 등록, 사진 등록, 명단 내보내기';
ALTER TABLE pseudonym_setting MODIFY COLUMN label_template_id BIGINT UNSIGNED NULL COMMENT '전형에 지정된 라벨 양식 식별자';
ALTER TABLE system_profile MODIFY COLUMN history_reset_password_hash VARCHAR(255) NULL COMMENT '운영 이력 초기화 확인 비밀번호 해시';
