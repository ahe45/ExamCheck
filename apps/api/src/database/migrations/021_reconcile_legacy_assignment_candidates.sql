-- 019 could only infer a legacy assignment's schedule from examinee number and
-- admission. Keep that inferred link only when there is exactly one possible
-- candidate_record. Ambiguous or missing links remain legacy admission-wide rows.
UPDATE pseudonym_assignment pa
INNER JOIN schema_migration migration_019
  ON migration_019.version = '019_number_uniqueness_policies.sql'
INNER JOIN examinee e ON e.id = pa.examinee_id
INNER JOIN system_profile sp ON sp.id = 1
LEFT JOIN (
  SELECT e2.id AS examinee_id,
         cr.admission AS admission_name,
         COUNT(cr.id) AS candidate_count,
         MIN(cr.id) AS candidate_record_id
  FROM examinee e2
  LEFT JOIN candidate_record cr ON cr.examinee_no = e2.examinee_no
  GROUP BY e2.id, cr.admission
) candidate_match
  ON candidate_match.examinee_id = pa.examinee_id
 AND candidate_match.admission_name = pa.admission_name
LEFT JOIN candidate_record matched_candidate
  ON matched_candidate.id = candidate_match.candidate_record_id
SET pa.candidate_record_id = CASE
      WHEN COALESCE(candidate_match.candidate_count, 0) = 1
        THEN candidate_match.candidate_record_id
      ELSE NULL
    END,
    pa.uniqueness_scope_key = CASE
      WHEN COALESCE(candidate_match.candidate_count, 0) = 1
       AND sp.pseudonym_no_uniqueness = 'SCHEDULE'
        THEN SHA2(CONCAT_WS(
          CHAR(31),
          DATE_FORMAT(matched_candidate.exam_date, '%Y-%m-%d'),
          matched_candidate.start_time,
          matched_candidate.period_name,
          matched_candidate.admission
        ), 256)
      ELSE ''
    END
WHERE pa.assigned_at <= migration_019.applied_at;
