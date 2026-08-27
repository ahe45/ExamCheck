ALTER TABLE system_profile
  ADD COLUMN examinee_no_uniqueness ENUM('SYSTEM', 'SCHEDULE') NOT NULL DEFAULT 'SYSTEM' AFTER system_name,
  ADD COLUMN pseudonym_no_uniqueness ENUM('ADMISSION', 'SCHEDULE') NOT NULL DEFAULT 'ADMISSION' AFTER examinee_no_uniqueness;

-- candidate_record has historically allowed the same examinee number in different
-- schedules. Preserve an already-used data shape instead of making the migration fail;
-- administrators can switch back to SYSTEM after resolving the reported duplicates.
UPDATE system_profile
SET examinee_no_uniqueness = 'SCHEDULE'
WHERE id = 1
  AND EXISTS (
    SELECT 1
    FROM candidate_record
    GROUP BY examinee_no
    HAVING COUNT(*) > 1
  );

ALTER TABLE pseudonym_assignment
  ADD COLUMN candidate_record_id BIGINT UNSIGNED NULL AFTER examinee_id,
  ADD COLUMN uniqueness_scope_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' AFTER admission_name,
  ADD KEY ix_pseudonym_assignment_examinee (examinee_id),
  ADD KEY ix_pseudonym_assignment_candidate_record (candidate_record_id),
  ADD CONSTRAINT fk_pseudonym_assignment_candidate_record
    FOREIGN KEY (candidate_record_id) REFERENCES candidate_record(id);

-- Link legacy assignments to one deterministic candidate schedule where possible.
-- Rows without a candidate_record remain readable legacy rows and continue to reserve
-- their admission-wide number through the empty scope key.
UPDATE pseudonym_assignment pa
INNER JOIN examinee e ON e.id = pa.examinee_id
SET pa.candidate_record_id = (
  SELECT MIN(cr.id)
  FROM candidate_record cr
  WHERE cr.examinee_no = e.examinee_no
    AND cr.admission = pa.admission_name
)
WHERE pa.candidate_record_id IS NULL;
