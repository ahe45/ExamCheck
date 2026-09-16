-- Retire only the two built-in templates seeded by migration 007.
-- Preserve the three operation forms and any independently created user templates.
DELETE FROM form_template
WHERE code IN ('PSEUDONYM_SLIP', 'CANDIDATE_CONFIRMATION');
