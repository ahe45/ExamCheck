ALTER TABLE label_template
  ADD COLUMN default_copies TINYINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '라벨 양식의 기본 인쇄 매수 (1~10매)' AFTER layout_json,
  ADD CONSTRAINT chk_label_template_default_copies CHECK (default_copies BETWEEN 1 AND 10);
