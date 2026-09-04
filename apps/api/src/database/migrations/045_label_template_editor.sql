ALTER TABLE label_template
  ADD COLUMN lifecycle_state ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'ARCHIVED' AFTER active,
  ADD COLUMN layout_json JSON NULL AFTER zpl_template;

UPDATE label_template
SET lifecycle_state = CASE WHEN active = TRUE THEN 'PUBLISHED' ELSE 'ARCHIVED' END,
    layout_json = JSON_OBJECT(
      'widthMm', 75,
      'heightMm', 45,
      'dpi', 203,
      'elements', JSON_ARRAY(
        JSON_OBJECT('id', 'title', 'kind', 'text', 'xMm', 4.4, 'yMm', 3.1, 'widthMm', 66, 'heightMm', 4,
                    'content', 'PSEUDONYM NUMBER', 'fontSizeMm', 3.5, 'align', 'left'),
        JSON_OBJECT('id', 'pseudonym', 'kind', 'text', 'xMm', 4.4, 'yMm', 9.4, 'widthMm', 66, 'heightMm', 9,
                    'content', '{{PSEUDONYM_NO}}', 'fontSizeMm', 8.7, 'align', 'left'),
        JSON_OBJECT('id', 'barcode', 'kind', 'barcode', 'xMm', 4.4, 'yMm', 20.6, 'widthMm', 66, 'heightMm', 12,
                    'content', '{{PSEUDONYM_NO}}', 'showText', TRUE),
        JSON_OBJECT('id', 'examinee', 'kind', 'text', 'xMm', 4.4, 'yMm', 37.5, 'widthMm', 66, 'heightMm', 3,
                    'content', 'EXAM: {{EXAMINEE_NO}}', 'fontSizeMm', 2.3, 'align', 'left')
      )
    )
WHERE code = 'PSEUDONYM_LABEL' AND layout_json IS NULL;

ALTER TABLE label_template
  MODIFY COLUMN lifecycle_state ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL COMMENT '라벨 양식 버전의 편집 및 사용 상태',
  MODIFY COLUMN layout_json JSON NULL COMMENT '라벨 크기, 해상도, 배치 요소를 저장한 구조화 편집 데이터';
