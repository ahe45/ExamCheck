ALTER TABLE pseudonym_setting
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER enable_bulk_draw,
  ADD CONSTRAINT ck_pseudonym_setting_version CHECK (version >= 1);
