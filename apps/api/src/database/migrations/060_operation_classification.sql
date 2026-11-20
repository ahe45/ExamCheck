ALTER TABLE system_profile
  ADD COLUMN classification_method ENUM(
    'NONE', 'ADMISSION', 'UNIT', 'MAJOR', 'BUILDING', 'ROOM', 'WAITING_ROOM', 'DATE', 'PERIOD', 'GROUP'
  ) NOT NULL DEFAULT 'ADMISSION';

CREATE TABLE user_classification_assignment (
  user_id BIGINT UNSIGNED NOT NULL,
  classification_method VARCHAR(20) NOT NULL,
  scope_key VARCHAR(80) NOT NULL,
  PRIMARY KEY (user_id, classification_method, scope_key),
  CONSTRAINT fk_user_classification_assignment_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
);

INSERT INTO user_classification_assignment (user_id, classification_method, scope_key)
SELECT u.id, 'ADMISSION', '*'
FROM app_user u
WHERE u.role IN ('OPERATOR', 'VIEWER')
  AND NOT EXISTS (SELECT 1 FROM user_admission_assignment a WHERE a.user_id = u.id);

ALTER TABLE pseudonym_assignment ADD COLUMN operation_scope_key VARCHAR(80) NULL;

CREATE VIEW operation_candidate_record AS
SELECT scoped.*,
  CASE WHEN scoped.classification_method = 'ADMISSION' THEN scoped.admission
       ELSE CONCAT('~', scoped.classification_method, ':', SHA2(scoped.scope_value, 256)) END AS operation_scope,
  CASE WHEN scoped.classification_method = 'NONE' THEN '전체'
       WHEN scoped.scope_value = '' THEN '미지정'
       ELSE REPLACE(scoped.scope_value, CHAR(31), ' · ') END AS operation_scope_label
FROM (
  SELECT cr.*,
    CASE cr.classification_method
      WHEN 'NONE' THEN ''
      WHEN 'UNIT' THEN TRIM(cr.unit_name)
      WHEN 'MAJOR' THEN TRIM(cr.major)
      WHEN 'BUILDING' THEN TRIM(cr.building_name)
      WHEN 'ROOM' THEN IF(TRIM(cr.room_name) = '', '', CONCAT_WS(CHAR(31), NULLIF(TRIM(cr.building_name), ''), TRIM(cr.room_name)))
      WHEN 'WAITING_ROOM' THEN IF(TRIM(cr.waiting_room) = '', '', CONCAT_WS(CHAR(31), NULLIF(TRIM(cr.building_name), ''), TRIM(cr.waiting_room)))
      WHEN 'DATE' THEN DATE_FORMAT(cr.exam_date, '%Y-%m-%d')
      WHEN 'PERIOD' THEN TRIM(cr.period_name)
      WHEN 'GROUP' THEN TRIM(cr.group_name)
      ELSE cr.admission
    END AS scope_value
  FROM (
    -- Candidate row locks should not upgrade the shared system-profile lock.
    SELECT records.*,
      (SELECT classification_method FROM system_profile WHERE id = 1) AS classification_method
    FROM candidate_record records
  ) cr
) scoped;
