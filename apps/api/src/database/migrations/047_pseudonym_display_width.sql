ALTER TABLE pseudonym_setting
  ADD COLUMN display_width SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER range_end;

UPDATE pseudonym_setting
SET display_width = GREATEST(CHAR_LENGTH(CAST(range_start AS CHAR)), CHAR_LENGTH(CAST(range_end AS CHAR)));

ALTER TABLE pseudonym_setting
  MODIFY COLUMN display_width SMALLINT UNSIGNED NOT NULL COMMENT '가번호 앞자리 0을 포함한 표시 자릿수';

ALTER TABLE pseudonym_time_range
  ADD COLUMN display_width SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER range_end;

UPDATE pseudonym_time_range
SET display_width = GREATEST(CHAR_LENGTH(CAST(range_start AS CHAR)), CHAR_LENGTH(CAST(range_end AS CHAR)));

ALTER TABLE pseudonym_time_range
  MODIFY COLUMN display_width SMALLINT UNSIGNED NOT NULL COMMENT '해당 일정 가번호의 앞자리 0을 포함한 표시 자릿수';
