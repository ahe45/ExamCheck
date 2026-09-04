ALTER TABLE print_job
  DROP FOREIGN KEY IF EXISTS fk_print_job_template,
  MODIFY COLUMN template_id BIGINT UNSIGNED NULL COMMENT '출력 생성에 사용한 라벨 양식. 양식 삭제 시 NULL',
  DROP COLUMN IF EXISTS template_version;

ALTER TABLE label_template
  ADD COLUMN IF NOT EXISTS description VARCHAR(500) NULL AFTER name;

UPDATE label_template
SET layout_json = JSON_OBJECT(
  'widthMm', 75,
  'heightMm', 45,
  'dpi', 203,
  'elements', JSON_ARRAY(
    JSON_OBJECT('id', 'title', 'kind', 'text', 'xMm', 4, 'yMm', 3, 'widthMm', 67, 'heightMm', 4,
                'content', '수험생 라벨', 'fontSizeMm', 3.2, 'align', 'left'),
    JSON_OBJECT('id', 'examNo', 'kind', 'text', 'xMm', 4, 'yMm', 9, 'widthMm', 67, 'heightMm', 5,
                'content', '수험번호 {{candidate.examNo}}', 'fontSizeMm', 3.2, 'align', 'left'),
    JSON_OBJECT('id', 'room', 'kind', 'text', 'xMm', 4, 'yMm', 15, 'widthMm', 67, 'heightMm', 4,
                'content', '{{candidate.buildingName}} {{candidate.roomName}}', 'fontSizeMm', 2.8, 'align', 'left'),
    JSON_OBJECT('id', 'barcode', 'kind', 'barcode', 'xMm', 4, 'yMm', 21, 'widthMm', 67, 'heightMm', 13,
                'content', '{{candidate.labelBarcode}}', 'showText', TRUE),
    JSON_OBJECT('id', 'examDate', 'kind', 'text', 'xMm', 4, 'yMm', 38, 'widthMm', 67, 'heightMm', 3,
                'content', '{{candidate.examDate}}', 'fontSizeMm', 2.3, 'align', 'left')
  )
)
WHERE layout_json IS NULL;

DELETE FROM label_template
WHERE code = 'PRINTER_TEST';

UPDATE print_job job
INNER JOIN label_template current ON current.id = job.template_id
INNER JOIN label_template replacement
  ON replacement.code = current.code
 AND NOT EXISTS (
   SELECT 1
   FROM label_template preferred
   WHERE preferred.code = replacement.code
     AND (
       preferred.active > replacement.active
       OR (preferred.active = replacement.active AND preferred.version > replacement.version)
       OR (preferred.active = replacement.active AND preferred.version = replacement.version AND preferred.id > replacement.id)
     )
 )
SET job.template_id = replacement.id;

DELETE older
FROM label_template older
INNER JOIN label_template newer
  ON newer.code = older.code
 AND (
   newer.active > older.active
   OR (newer.active = older.active AND newer.version > older.version)
   OR (newer.active = older.active AND newer.version = older.version AND newer.id > older.id)
 );

UPDATE print_job job
LEFT JOIN label_template template ON template.id = job.template_id
SET job.template_id = NULL
WHERE template.id IS NULL;

ALTER TABLE label_template
  DROP INDEX uq_label_template_code_version,
  ADD UNIQUE KEY uq_label_template_code (code),
  DROP COLUMN version,
  DROP COLUMN lifecycle_state,
  MODIFY COLUMN description VARCHAR(500) NULL COMMENT '라벨 양식 설명',
  MODIFY COLUMN layout_json JSON NOT NULL COMMENT '라벨 크기, 해상도, 배치 요소를 저장한 구조화 편집 데이터',
  COMMENT = '프린터 라벨 출력에 사용하는 현재 양식과 편집 레이아웃을 관리한다.';

ALTER TABLE pseudonym_setting
  ADD COLUMN label_template_id BIGINT UNSIGNED NULL AFTER print_preassigned_label,
  ADD KEY ix_pseudonym_setting_label_template (label_template_id),
  ADD CONSTRAINT fk_pseudonym_setting_label_template
    FOREIGN KEY (label_template_id) REFERENCES label_template(id) ON DELETE SET NULL;

UPDATE pseudonym_setting setting_row
SET label_template_id = (
  SELECT template.id
  FROM label_template template
  WHERE template.active = TRUE
  ORDER BY CASE WHEN template.code = 'PSEUDONYM_LABEL' THEN 0 ELSE 1 END, template.id
  LIMIT 1
)
WHERE setting_row.label_template_id IS NULL;

ALTER TABLE print_job
  ADD CONSTRAINT fk_print_job_template
    FOREIGN KEY (template_id) REFERENCES label_template(id) ON DELETE SET NULL;
