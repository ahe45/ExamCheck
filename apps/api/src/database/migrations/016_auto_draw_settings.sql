ALTER TABLE pseudonym_setting
  ADD COLUMN auto_draw_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER assignment_method,
  ADD COLUMN auto_draw_delay_seconds INT UNSIGNED NOT NULL DEFAULT 3 AFTER auto_draw_enabled;
