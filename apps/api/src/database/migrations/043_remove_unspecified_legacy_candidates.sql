-- 041 마이그레이션이 구 examinee 데이터를 보존하려고 만든 임시 수험생 레코드 중
-- 전형을 복구할 수 없어 대시보드에 '미지정 전형'으로 노출되는 항목을 정리한다.
-- 정상 업로드 데이터는 period_name='기존 데이터', start_time='00:00' 조합을 사용하지 않는다.
DELETE assignment
FROM pseudonym_assignment assignment
INNER JOIN candidate_record candidate ON candidate.id = assignment.candidate_record_id
WHERE TRIM(candidate.admission) = ''
  AND candidate.period_name = '기존 데이터'
  AND candidate.start_time = '00:00';

DELETE photo
FROM candidate_photo photo
INNER JOIN candidate_record candidate ON candidate.id = photo.candidate_record_id
WHERE TRIM(candidate.admission) = ''
  AND candidate.period_name = '기존 데이터'
  AND candidate.start_time = '00:00';

DELETE FROM candidate_record
WHERE TRIM(admission) = ''
  AND period_name = '기존 데이터'
  AND start_time = '00:00';
