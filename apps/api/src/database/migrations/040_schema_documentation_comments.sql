CREATE TEMPORARY TABLE schema_table_comment_catalog (
  table_name VARCHAR(64) NOT NULL PRIMARY KEY,
  table_comment VARCHAR(1024) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_table_comment_catalog (table_name, table_comment) VALUES
  ('admission', '시험 회차에 속한 전형의 표준 식별 정보와 운영 상태를 관리한다.'),
  ('admission_identity_alias', '전형 코드와 명칭의 이전 값 및 대체 식별값을 관리한다.'),
  ('app_user', '시스템 로그인 계정, 권한, 전형 접근 범위와 세션 버전을 관리한다.'),
  ('audit_log', '사용자 요청과 주요 업무 처리에 대한 감사 이력을 기록한다.'),
  ('candidate', '표준화된 수험생 신원과 수험번호 정보를 관리한다.'),
  ('candidate_identity_photo', '표준 수험생 신원에 연결된 증명사진 원본을 관리한다.'),
  ('candidate_number_claim', '수험번호 유일성 범위별 수험생 번호 점유 정보를 관리한다.'),
  ('candidate_photo', '업로드 수험생 원본 레코드에 연결된 증명사진을 관리한다.'),
  ('candidate_pseudonym_assignment', '표준 응시 등록 건에 확정된 가번호 배정 결과를 관리한다.'),
  ('candidate_record', '파일로 업로드한 수험생 및 시험 편성 원본 데이터를 관리한다.'),
  ('candidate_registration', '표준 수험생과 시험 일정 구간의 응시 등록 관계를 관리한다.'),
  ('candidate_registration_slot_claim', '응시 등록 건이 점유한 시험 운영 시간대를 관리한다.'),
  ('examinee', '기존 운영 방식의 수험생 기본 정보와 라벨 식별값을 관리한다.'),
  ('exam_cycle', '학년도별 시험 운영 회차와 유효 기간을 관리한다.'),
  ('form_template', 'PDF 생성에 사용하는 양식 메타데이터와 편집 레이아웃을 관리한다.'),
  ('form_template_deletion', '삭제된 양식 코드와 삭제 주체 및 시각을 기록한다.'),
  ('identity_backfill_checkpoint', '신원 전환 백필 작업의 엔터티별 진행 위치를 기록한다.'),
  ('identity_backfill_run', '신원 전환 백필 실행 결과와 검증 보고서를 관리한다.'),
  ('identity_canary_admission', '신규 신원 모델을 우선 적용할 카나리 전형을 관리한다.'),
  ('identity_canary_user', '신규 신원 모델을 우선 적용할 카나리 사용자를 관리한다.'),
  ('identity_migration_issue', '신원 마이그레이션 과정에서 발견된 데이터 문제를 관리한다.'),
  ('identity_shadow_observation', '기존 모델과 신규 모델의 그림자 읽기 비교 결과를 기록한다.'),
  ('identity_shadow_verification_batch', '신원 그림자 검증 관측치를 묶는 실행 배치를 관리한다.'),
  ('identity_source_mutation_watermark', '신원 원본 데이터 변경 순서의 상한값을 관리한다.'),
  ('identity_transition_gate_evidence', '신원 전환 단계 승격에 필요한 검증 근거를 관리한다.'),
  ('identity_transition_history_evidence', '신원 상태 전환 이력과 검증 근거의 연결을 관리한다.'),
  ('identity_transition_request', '신원 읽기·쓰기 단계 전환 요청과 처리 상태를 관리한다.'),
  ('identity_transition_request_approval', '신원 단계 전환 요청에 대한 역할별 승인을 관리한다.'),
  ('identity_transition_request_evidence', '신원 단계 전환 요청에 첨부된 검증 근거를 관리한다.'),
  ('identity_transition_state', '현재 신원 모델의 읽기·쓰기 모드와 전환 단계를 관리한다.'),
  ('identity_transition_state_history', '신원 모델 상태의 승격 및 긴급 롤백 이력을 기록한다.'),
  ('label_template', '프린터 라벨 출력을 위한 ZPL 템플릿 버전을 관리한다.'),
  ('legacy_pseudonym_reservation', '기존 가번호 배정에서 신규 모델로 예약 이관된 번호를 관리한다.'),
  ('number_uniqueness_policy', '시험 회차별 수험번호와 가번호의 유일성 범위를 관리한다.'),
  ('operation_slot', '전형별 시험 일자와 시간 단위의 운영 슬롯을 관리한다.'),
  ('print_job', '라벨 및 문서 출력 요청의 처리 상태와 재출력 관계를 관리한다.'),
  ('print_job_payload', '출력 작업에 전달되는 형식별 원본 페이로드를 관리한다.'),
  ('print_job_reissue_event', '출력 작업의 재발행 및 재출력 이력을 기록한다.'),
  ('print_projection_snapshot', '출력 시점에 확정된 데이터 투영본과 무결성 해시를 보관한다.'),
  ('pseudonym_assignment', '기존 운영 방식의 수험생 가번호 배정 결과를 관리한다.'),
  ('pseudonym_assignment_event', '가번호 배정·변경·해제와 관련된 사건 이력을 기록한다.'),
  ('pseudonym_number_claim', '유일성 범위별 가번호 점유 정보를 관리한다.'),
  ('pseudonym_operation', '기존 운영 방식의 일정별 가번호 부여 작업 상태를 관리한다.'),
  ('pseudonym_operation_event', '가번호 부여 작업의 마감 및 재개 사건을 기록한다.'),
  ('pseudonym_operation_state', '표준 운영 슬롯별 가번호 작업의 현재 상태를 관리한다.'),
  ('pseudonym_policy', '표준 시험 회차와 전형 범위별 가번호 부여 정책을 관리한다.'),
  ('pseudonym_range', '정책과 일정 구간별 사용 가능한 가번호 범위를 관리한다.'),
  ('pseudonym_setting', '기존 운영 방식의 시험·전형별 가번호 설정을 관리한다.'),
  ('pseudonym_time_range', '기존 운영 방식의 시험 일정별 가번호 범위를 관리한다.'),
  ('schedule_segment', '운영 슬롯을 모집단위·전공·고사실 기준으로 세분화한 일정을 관리한다.'),
  ('schema_migration', '적용된 데이터베이스 마이그레이션 버전과 검증 상태를 기록한다.'),
  ('system_profile', '학교, 학년도, 시스템 명칭과 번호 유일성 정책을 관리한다.'),
  ('user_admission_assignment', '기존 전형 명칭 기준 사용자 접근 권한을 관리한다.'),
  ('user_admission_scope_assignment', '표준 전형 식별자 기준 사용자 접근 권한을 관리한다.'),
  ('workstation', '출력 및 운영에 사용하는 작업 단말의 식별 정보와 상태를 관리한다.');

SET @schema_comment_previous_group_concat_max_len = @@SESSION.group_concat_max_len;
SET SESSION group_concat_max_len = 16777216;

DROP PROCEDURE IF EXISTS apply_schema_documentation_comments;

CREATE PROCEDURE apply_schema_documentation_comments()
BEGIN
  DECLARE finished INTEGER DEFAULT 0;
  DECLARE current_table_name VARCHAR(64);
  DECLARE current_table_comment VARCHAR(1024);
  DECLARE column_definitions LONGTEXT;
  DECLARE alter_statement LONGTEXT;

  DECLARE table_cursor CURSOR FOR
    SELECT catalog.table_name, catalog.table_comment
    FROM schema_table_comment_catalog catalog
    INNER JOIN information_schema.TABLES tables
      ON tables.TABLE_SCHEMA = DATABASE()
     AND tables.TABLE_NAME = catalog.table_name
     AND tables.TABLE_TYPE = 'BASE TABLE'
    ORDER BY catalog.table_name;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET finished = 1;

  OPEN table_cursor;

  comment_loop: LOOP
    FETCH table_cursor INTO current_table_name, current_table_comment;
    IF finished = 1 THEN
      LEAVE comment_loop;
    END IF;

    SELECT GROUP_CONCAT(
      CONCAT(
        'MODIFY COLUMN `', REPLACE(columns_info.COLUMN_NAME, '`', '``'), '` ',
        columns_info.COLUMN_TYPE,
        CASE
          WHEN columns_info.CHARACTER_SET_NAME IS NULL THEN ''
          ELSE CONCAT(
            ' CHARACTER SET ', columns_info.CHARACTER_SET_NAME,
            ' COLLATE ', columns_info.COLLATION_NAME
          )
        END,
        CASE WHEN columns_info.IS_NULLABLE = 'YES' THEN ' NULL' ELSE ' NOT NULL' END,
        CASE
          WHEN columns_info.COLUMN_DEFAULT IS NULL THEN ''
          ELSE CONCAT(' DEFAULT ', columns_info.COLUMN_DEFAULT)
        END,
        CASE WHEN columns_info.EXTRA = '' THEN '' ELSE CONCAT(' ', columns_info.EXTRA) END,
        ' COMMENT ', QUOTE(
          CASE
            WHEN columns_info.TABLE_NAME = 'schema_migration' AND columns_info.COLUMN_NAME = 'version'
              THEN '마이그레이션 파일 버전 및 파일명'
            WHEN columns_info.TABLE_NAME = 'schema_migration' AND columns_info.COLUMN_NAME = 'checksum'
              THEN '마이그레이션 SQL 내용의 SHA-256 체크섬'
            WHEN columns_info.TABLE_NAME = 'form_template' AND columns_info.COLUMN_NAME = 'layout_json'
              THEN '페이지, 개체, 출력 설정을 포함한 양식 레이아웃 JSON'
            WHEN columns_info.TABLE_NAME = 'candidate_record' AND columns_info.COLUMN_NAME LIKE 'opt%'
              THEN CONCAT('업로드 수험생 데이터의 선택 확장 항목 ', SUBSTRING(columns_info.COLUMN_NAME, 4))
            WHEN columns_info.COLUMN_NAME = 'id'
              THEN CONCAT(current_table_comment, ' 레코드의 고유 식별자')
            WHEN columns_info.COLUMN_NAME = 'code'
              THEN '업무에서 사용하는 고유 코드'
            WHEN columns_info.COLUMN_NAME = 'name'
              THEN '화면과 문서에 표시할 명칭'
            WHEN columns_info.COLUMN_NAME = 'display_name'
              THEN '사용자에게 표시하는 원본 명칭'
            WHEN columns_info.COLUMN_NAME = 'canonical_name'
              THEN '비교와 중복 판정에 사용하는 표준화 명칭'
            WHEN columns_info.COLUMN_NAME = 'description'
              THEN '대상에 대한 상세 설명'
            WHEN columns_info.COLUMN_NAME = 'status'
              THEN CONCAT(current_table_comment, ' 현재 처리 상태')
            WHEN columns_info.COLUMN_NAME = 'state'
              THEN CONCAT(current_table_comment, ' 현재 업무 상태')
            WHEN columns_info.COLUMN_NAME = 'phase'
              THEN '신원 모델 전환의 현재 단계'
            WHEN columns_info.COLUMN_NAME = 'enabled'
              THEN '기능 또는 대상의 사용 가능 여부'
            WHEN columns_info.COLUMN_NAME = 'active'
              THEN '현재 활성 상태 여부'
            WHEN columns_info.COLUMN_NAME = 'version'
              THEN '낙관적 잠금 또는 변경 추적에 사용하는 버전 번호'
            WHEN columns_info.COLUMN_NAME = 'created_at'
              THEN '레코드가 생성된 일시'
            WHEN columns_info.COLUMN_NAME = 'updated_at'
              THEN '레코드가 마지막으로 수정된 일시'
            WHEN columns_info.COLUMN_NAME = 'deleted_at'
              THEN '레코드가 삭제된 일시'
            WHEN columns_info.COLUMN_NAME = 'started_at'
              THEN '작업이 시작된 일시'
            WHEN columns_info.COLUMN_NAME = 'completed_at'
              THEN '작업이 완료된 일시'
            WHEN columns_info.COLUMN_NAME = 'requested_at'
              THEN '요청이 생성된 일시'
            WHEN columns_info.COLUMN_NAME = 'applied_at'
              THEN '변경 또는 마이그레이션이 적용된 일시'
            WHEN columns_info.COLUMN_NAME = 'cancelled_at'
              THEN '요청이 취소된 일시'
            WHEN columns_info.COLUMN_NAME = 'occurred_at'
              THEN '업무 사건이 발생한 일시'
            WHEN columns_info.COLUMN_NAME = 'observed_at'
              THEN '검증 결과를 관측한 일시'
            WHEN columns_info.COLUMN_NAME = 'valid_until'
              THEN '검증 근거 또는 데이터의 유효 종료 일시'
            WHEN columns_info.COLUMN_NAME = 'assigned_at'
              THEN '가번호가 배정된 일시'
            WHEN columns_info.COLUMN_NAME = 'closed_at'
              THEN '업무가 마감된 일시'
            WHEN columns_info.COLUMN_NAME = 'reopened_at'
              THEN '업무가 다시 열린 일시'
            WHEN columns_info.COLUMN_NAME = 'last_reopened_at'
              THEN '업무가 마지막으로 다시 열린 일시'
            WHEN columns_info.COLUMN_NAME = 'expires_at'
              THEN '출력 요청 또는 데이터의 만료 일시'
            WHEN columns_info.COLUMN_NAME = 'dispatched_at'
              THEN '출력 작업이 단말로 전달된 일시'
            WHEN columns_info.COLUMN_NAME = 'sent_at'
              THEN '출력 전송이 완료된 일시'
            WHEN columns_info.COLUMN_NAME = 'failed_at'
              THEN '처리가 실패한 일시'
            WHEN columns_info.COLUMN_NAME = 'exam_date'
              THEN '시험이 시행되는 날짜'
            WHEN columns_info.COLUMN_NAME = 'start_time'
              THEN '시험 또는 운영의 시작 시각'
            WHEN columns_info.COLUMN_NAME = 'end_time'
              THEN '시험 또는 운영의 종료 시각'
            WHEN columns_info.COLUMN_NAME = 'exam_time'
              THEN '시험이 시작되는 시각'
            WHEN columns_info.COLUMN_NAME = 'birth_date'
              THEN '수험생 생년월일'
            WHEN columns_info.COLUMN_NAME = 'academic_year'
              THEN '시험 운영 기준 학년도'
            WHEN columns_info.COLUMN_NAME = 'exam_name'
              THEN '시험의 표시 명칭'
            WHEN columns_info.COLUMN_NAME = 'admission_name'
              THEN '전형의 표시 명칭'
            WHEN columns_info.COLUMN_NAME = 'examinee_no'
              THEN '수험생에게 부여된 수험번호'
            WHEN columns_info.COLUMN_NAME = 'examinee_no_display'
              THEN '입력 형식을 유지한 화면 표시용 수험번호'
            WHEN columns_info.COLUMN_NAME = 'examinee_no_canonical'
              THEN '비교와 유일성 판정에 사용하는 표준화 수험번호'
            WHEN columns_info.COLUMN_NAME = 'temporary_no'
              THEN '수험생 데이터에 포함된 임시 번호'
            WHEN columns_info.COLUMN_NAME = 'pseudonym_no'
              THEN '수험생에게 배정된 가번호'
            WHEN columns_info.COLUMN_NAME = 'pseudonym_value'
              THEN '숫자형으로 저장한 가번호 값'
            WHEN columns_info.COLUMN_NAME = 'preassigned_value'
              THEN '사전에 지정된 가번호 값'
            WHEN columns_info.COLUMN_NAME = 'display_width'
              THEN '가번호를 0 채움으로 표시할 전체 자릿수'
            WHEN columns_info.COLUMN_NAME = 'preassigned_display_width'
              THEN '사전 지정 가번호의 표시 자릿수'
            WHEN columns_info.COLUMN_NAME = 'range_start'
              THEN '사용 가능한 가번호 범위의 시작값'
            WHEN columns_info.COLUMN_NAME = 'range_end'
              THEN '사용 가능한 가번호 범위의 종료값'
            WHEN columns_info.COLUMN_NAME = 'range_start_value'
              THEN '표준 가번호 범위의 시작값'
            WHEN columns_info.COLUMN_NAME = 'range_end_value'
              THEN '표준 가번호 범위의 종료값'
            WHEN columns_info.COLUMN_NAME IN ('next_sequence', 'next_value')
              THEN '다음 자동 배정에 사용할 가번호 값'
            WHEN columns_info.COLUMN_NAME = 'assignment_method'
              THEN '가번호를 선택하고 배정하는 정책 방식'
            WHEN columns_info.COLUMN_NAME = 'assignment_mode'
              THEN '해당 가번호가 실제 배정된 방식'
            WHEN columns_info.COLUMN_NAME = 'is_absentee'
              THEN '결시자 배정 건 여부'
            WHEN columns_info.COLUMN_NAME = 'auto_assigned_on_close'
              THEN '작업 마감 시 자동 배정된 건 여부'
            WHEN columns_info.COLUMN_NAME = 'closed'
              THEN '가번호 부여 작업의 마감 여부'
            WHEN columns_info.COLUMN_NAME = 'auto_draw_enabled'
              THEN '대기 후 가번호 자동 추첨 사용 여부'
            WHEN columns_info.COLUMN_NAME = 'auto_draw_delay_seconds'
              THEN '가번호 자동 추첨까지 기다리는 초 단위 시간'
            WHEN columns_info.COLUMN_NAME = 'print_preassigned_label'
              THEN '사전 지정 가번호의 라벨 출력 여부'
            WHEN columns_info.COLUMN_NAME = 'auto_assign_absentees_on_close'
              THEN '마감 시 미배정 결시자 자동 배정 여부'
            WHEN columns_info.COLUMN_NAME = 'delete_absentee_info_on_reopen'
              THEN '재개 시 자동 생성된 결시자 정보 삭제 여부'
            WHEN columns_info.COLUMN_NAME = 'use_candidate_photos'
              THEN '수험생 사진 사용 여부'
            WHEN columns_info.COLUMN_NAME = 'enable_bulk_draw'
              THEN '가번호 일괄 추첨 허용 여부'
            WHEN columns_info.COLUMN_NAME = 'file_name'
              THEN '업로드된 파일의 원본 이름'
            WHEN columns_info.COLUMN_NAME = 'mime_type'
              THEN '파일 콘텐츠의 MIME 형식'
            WHEN columns_info.COLUMN_NAME = 'content'
              THEN '파일의 바이너리 원본 데이터'
            WHEN columns_info.COLUMN_NAME = 'content_hash'
              THEN '파일 콘텐츠 무결성 확인용 SHA-256 해시'
            WHEN columns_info.COLUMN_NAME = 'source_hash'
              THEN '원본 데이터 변경 및 중복 판정용 해시'
            WHEN columns_info.COLUMN_NAME = 'identity_key'
              THEN '표준화된 업무 속성으로 생성한 신원 식별 해시'
            WHEN columns_info.COLUMN_NAME = 'scope_key'
              THEN '유일성 적용 범위를 식별하는 해시 키'
            WHEN columns_info.COLUMN_NAME = 'owner_key'
              THEN '번호 점유 주체를 식별하는 해시 키'
            WHEN columns_info.COLUMN_NAME = 'uniqueness_scope_key'
              THEN '기존 가번호 유일성 범위를 식별하는 키'
            WHEN columns_info.COLUMN_NAME = 'schedule_key'
              THEN '시험 일정 속성 조합으로 생성한 고유 키'
            WHEN columns_info.COLUMN_NAME = 'checksum'
              THEN '내용 변경 여부를 확인하기 위한 체크섬'
            WHEN columns_info.COLUMN_NAME = 'request_fingerprint'
              THEN '출력 요청 내용의 중복 판정용 지문 해시'
            WHEN columns_info.COLUMN_NAME = 'projection_digest'
              THEN '출력 데이터 투영본의 무결성 해시'
            WHEN columns_info.COLUMN_NAME = 'layout_json'
              THEN '양식 레이아웃 및 출력 설정 JSON'
            WHEN columns_info.COLUMN_NAME IN ('details', 'details_json')
              THEN '처리 결과와 부가 정보를 담은 상세 데이터'
            WHEN columns_info.COLUMN_NAME = 'report_json'
              THEN '백필 실행 결과와 검증 내역을 담은 JSON 보고서'
            WHEN columns_info.COLUMN_NAME = 'projection_json'
              THEN '출력 시점에 확정한 데이터 투영 JSON'
            WHEN columns_info.COLUMN_NAME = 'payload'
              THEN '프린터 또는 출력기로 전달할 원본 데이터'
            WHEN columns_info.COLUMN_NAME = 'format'
              THEN '출력 페이로드의 데이터 형식'
            WHEN columns_info.COLUMN_NAME = 'zpl_template'
              THEN 'Zebra 프린터에서 사용하는 ZPL 명령 템플릿'
            WHEN columns_info.COLUMN_NAME = 'logo_data'
              THEN '시스템에 등록한 학교 로고 바이너리 데이터'
            WHEN columns_info.COLUMN_NAME = 'role'
              THEN '계정에 부여된 시스템 권한 역할'
            WHEN columns_info.COLUMN_NAME = 'login_id'
              THEN '로그인에 사용하는 고유 계정 ID'
            WHEN columns_info.COLUMN_NAME = 'password_hash'
              THEN '단방향 해시 처리된 로그인 비밀번호'
            WHEN columns_info.COLUMN_NAME = 'session_version'
              THEN '기존 로그인 세션 무효화에 사용하는 세션 버전'
            WHEN columns_info.COLUMN_NAME = 'admission_scope_mode'
              THEN '계정이 접근할 수 있는 전형 범위 방식'
            WHEN columns_info.COLUMN_NAME = 'event_type'
              THEN '기록된 업무 사건의 종류'
            WHEN columns_info.COLUMN_NAME = 'reason_code'
              THEN '처리 또는 전환 사유를 나타내는 코드'
            WHEN columns_info.COLUMN_NAME = 'error_code'
              THEN '실패 원인을 분류하는 오류 코드'
            WHEN columns_info.COLUMN_NAME = 'error_message'
              THEN '실패 원인에 대한 상세 오류 메시지'
            WHEN columns_info.COLUMN_NAME = 'request_id'
              THEN '요청 또는 추적 단위를 식별하는 값'
            WHEN columns_info.COLUMN_NAME = 'idempotency_key'
              THEN '동일 출력 요청의 중복 실행 방지 키'
            WHEN columns_info.COLUMN_NAME = 'job_no'
              THEN '사용자와 운영자가 확인하는 출력 작업 번호'
            WHEN columns_info.COLUMN_NAME = 'label_type'
              THEN '출력할 라벨 또는 문서의 업무 종류'
            WHEN columns_info.COLUMN_NAME = 'business_ref'
              THEN '출력 요청과 연결되는 업무 참조값'
            WHEN columns_info.COLUMN_NAME = 'copies'
              THEN '요청한 출력 매수'
            WHEN columns_info.COLUMN_NAME = 'reprint_reason'
              THEN '재출력을 요청한 사유'
            WHEN columns_info.COLUMN_NAME = 'reissue_type'
              THEN '출력 작업 재발행의 종류'
            WHEN columns_info.COLUMN_NAME = 'category'
              THEN '양식의 업무 분류'
            WHEN columns_info.COLUMN_NAME = 'usage_scope'
              THEN '양식을 사용할 수 있는 제공 범위'
            WHEN columns_info.COLUMN_NAME = 'school_name'
              THEN '시스템을 운영하는 학교 또는 기관 명칭'
            WHEN columns_info.COLUMN_NAME = 'system_name'
              THEN '화면에 표시되는 시스템 명칭'
            WHEN columns_info.COLUMN_NAME = 'examinee_no_uniqueness'
              THEN '수험번호 중복을 허용하지 않는 업무 범위'
            WHEN columns_info.COLUMN_NAME = 'pseudonym_no_uniqueness'
              THEN '가번호 중복을 허용하지 않는 업무 범위'
            WHEN columns_info.COLUMN_NAME = 'location'
              THEN '작업 단말이 설치된 장소'
            WHEN columns_info.COLUMN_NAME = 'actor_user_id'
              THEN '해당 업무 사건을 수행한 사용자 식별자'
            WHEN columns_info.COLUMN_NAME IN ('created_by', 'requested_by', 'assigned_by', 'recorded_by', 'linked_by')
              THEN '레코드 생성 또는 업무 처리를 수행한 사용자 식별자'
            WHEN columns_info.COLUMN_NAME IN ('updated_by', 'applied_by', 'approved_by', 'verified_by')
              THEN '레코드 변경 또는 승인을 수행한 사용자 식별자'
            WHEN columns_info.COLUMN_NAME IN ('deleted_by', 'closed_by', 'reopened_by', 'last_reopened_by')
              THEN '삭제, 마감 또는 재개 처리를 수행한 사용자 식별자'
            WHEN columns_info.COLUMN_NAME LIKE '%\_id'
              THEN CONCAT('연관된 ', REPLACE(SUBSTRING(columns_info.COLUMN_NAME, 1, LENGTH(columns_info.COLUMN_NAME) - 3), '_', ' '), ' 레코드 식별자')
            WHEN columns_info.COLUMN_NAME LIKE '%\_code'
              THEN CONCAT(REPLACE(SUBSTRING(columns_info.COLUMN_NAME, 1, LENGTH(columns_info.COLUMN_NAME) - 5), '_', ' '), ' 업무 코드')
            WHEN columns_info.COLUMN_NAME LIKE '%\_name'
              THEN CONCAT(REPLACE(SUBSTRING(columns_info.COLUMN_NAME, 1, LENGTH(columns_info.COLUMN_NAME) - 5), '_', ' '), ' 표시 명칭')
            WHEN columns_info.COLUMN_NAME LIKE 'is\_%'
              THEN CONCAT(REPLACE(SUBSTRING(columns_info.COLUMN_NAME, 4), '_', ' '), ' 여부')
            ELSE CONCAT(current_table_comment, '에서 사용하는 `', columns_info.COLUMN_NAME, '` 값')
          END
        )
      )
      ORDER BY columns_info.ORDINAL_POSITION
      SEPARATOR ', '
    ) INTO column_definitions
    FROM information_schema.COLUMNS columns_info
    WHERE columns_info.TABLE_SCHEMA = DATABASE()
      AND columns_info.TABLE_NAME = current_table_name;

    SET alter_statement = CONCAT(
      'ALTER TABLE `', REPLACE(current_table_name, '`', '``'), '` ',
      'COMMENT = ', QUOTE(current_table_comment), ', ',
      column_definitions
    );
    SET @schema_comment_alter_statement = alter_statement;
    PREPARE schema_comment_statement FROM @schema_comment_alter_statement;
    EXECUTE schema_comment_statement;
    DEALLOCATE PREPARE schema_comment_statement;
  END LOOP;

  CLOSE table_cursor;
END;

CALL apply_schema_documentation_comments();

DROP PROCEDURE apply_schema_documentation_comments;
DROP TEMPORARY TABLE schema_table_comment_catalog;

SET SESSION group_concat_max_len = @schema_comment_previous_group_concat_max_len;
SET @schema_comment_previous_group_concat_max_len = NULL;
SET @schema_comment_alter_statement = NULL;
