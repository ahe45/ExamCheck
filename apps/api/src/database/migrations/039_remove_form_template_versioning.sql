DROP TRIGGER IF EXISTS trg_form_template_immutable_version;
DROP TRIGGER IF EXISTS trg_form_template_immutable_delete;

UPDATE form_template
SET supersedes_id = NULL
WHERE supersedes_id IS NOT NULL;

ALTER TABLE form_template
  DROP FOREIGN KEY fk_form_template_published_by,
  DROP FOREIGN KEY fk_form_template_supersedes,
  DROP CONSTRAINT ck_form_template_lifecycle,
  DROP INDEX ix_form_template_lifecycle,
  DROP INDEX uq_form_template_code_version;

DELETE older
FROM form_template older
INNER JOIN form_template current
  ON current.code = older.code
 AND (
   current.version > older.version
   OR (current.version = older.version AND current.id > older.id)
 );

ALTER TABLE form_template
  ADD UNIQUE KEY uq_form_template_code (code),
  DROP COLUMN version,
  DROP COLUMN lifecycle_state,
  DROP COLUMN published_by,
  DROP COLUMN published_at,
  DROP COLUMN supersedes_id;
