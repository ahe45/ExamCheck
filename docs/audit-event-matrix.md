# 감사 이벤트·트랜잭션 매트릭스

> 기준일: 2026-08-28  
> 범위: 현재 API의 업무 변경과 인증 감사 경계

## 공통 기록 형식

성공한 업무 변경은 `MutationAuditRepository.record(executor, record)`를 사용한다. 호출자가 연 트랜잭션의
`PoolConnection`을 `executor`로 그대로 전달하므로 업무 데이터와 감사 로그가 함께 commit되거나 함께 rollback된다.

| 열               | 의미                                                               |
| ---------------- | ------------------------------------------------------------------ |
| `event_type`     | 아래 매트릭스의 안정적인 이벤트 이름                               |
| `actor_user_id`  | 로그인 사용자 ID. 시스템 행위처럼 사용자가 없으면 null             |
| `workstation_id` | 관련 워크스테이션 ID. 관계가 없으면 null                           |
| `print_job_id`   | 관련 출력 작업 UUID. 관계가 없으면 null                            |
| `request_id`     | 현재 HTTP 비동기 context의 요청 추적 ID. 명시값이 있으면 우선 사용 |
| `details`        | 이벤트별 허용 필드만 담은 JSON                                     |

선택 `requestId`와 이벤트에 관계없는 correlation ID는 누락 상태를 SQL `NULL`로 정규화한다. `details`는
공통 기록기가 JSON 문자열로 직렬화하며, 호출부가 SQL `JSON_OBJECT`를 직접 조립하지 않는다.

공통 기록기는 이벤트별 details 키·값뿐 아니라 연계 envelope도 런타임에 검사한다. `WORKSTATION_CREATED`는
`workstationId`가 필수이고 `printJobId`는 금지한다. `PRINT_JOB_*` 이벤트는 두 ID가 모두 필수이며, 나머지
이벤트에는 두 ID를 전달할 수 없다. 워크스테이션 생성 이벤트의 envelope와 details에 기록된 `workstationId`는
서로 같아야 한다. 수험생 XLSX·사진 ZIP 집계는 전체 건수와 세부 건수의 합이 일치해야 하고, 운영 이벤트 날짜는
실제 달력 날짜여야 한다.

## 성공 mutation 매트릭스

| 기능         | mutation                        | 성공 이벤트                        | 업무 변경과 감사의 원자성 | 현재 `details` 허용 필드                                                                                                                                                                                                         |
| ------------ | ------------------------------- | ---------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 계정         | 생성                            | `ACCOUNT_CREATED`                  | 동일 transaction          | `userId`, `loginId`, `role`                                                                                                                                                                                                      |
| 계정         | 수정·비밀번호/권한 변경         | `ACCOUNT_UPDATED`                  | 동일 transaction          | `userId`, `loginId`, `role`, `passwordChanged`                                                                                                                                                                                   |
| 계정         | 비활성화                        | `ACCOUNT_DELETED`                  | 동일 transaction          | `userId`                                                                                                                                                                                                                         |
| 수험생       | XLSX 반영                       | `CANDIDATE_WORKBOOK_IMPORTED`      | 동일 transaction          | `totalRows`, `inserted`, `updated`, `skipped`, `policy`, `checksum`                                                                                                                                                              |
| 수험생 사진  | ZIP 반영                        | `CANDIDATE_PHOTO_ARCHIVE_IMPORTED` | 동일 transaction          | `totalFiles`, `uploaded`, `updated`, `skipped`, `duplicateCount`, `policy`, `checksum`                                                                                                                                           |
| 개발자 설정  | 시스템 기본 정보·번호 정책 저장 | `SYSTEM_PROFILE_UPDATED`           | 동일 transaction          | `schoolName`, `academicYear`, `systemName`, `examineeNoUniqueness`, `pseudonymNoUniqueness`                                                                                                                                      |
| 개발자 설정  | 로고 저장                       | `SYSTEM_LOGO_UPDATED`              | 동일 transaction          | `fileName`, `mimeType`                                                                                                                                                                                                           |
| 개발자 설정  | 로고 삭제                       | `SYSTEM_LOGO_REMOVED`              | 동일 transaction          | 없음                                                                                                                                                                                                                             |
| 개발자 계정  | 본인 비밀번호 변경              | `DEVELOPER_PASSWORD_CHANGED`       | 동일 transaction          | `developerUserId`                                                                                                                                                                                                                |
| 워크스테이션 | 생성                            | `WORKSTATION_CREATED`              | 동일 transaction          | `workstationId`, `code`; envelope에 `workstationId`                                                                                                                                                                              |
| 양식         | 저장                            | `FORM_TEMPLATE_SAVED`              | 동일 transaction          | `code`, `templateId`, `active`, `riskCount`                                                                                                                                                                                      |
| 양식         | 제목·설명 수정                  | `FORM_TEMPLATE_METADATA_UPDATED`   | 동일 transaction          | `code`, `templateId`                                                                                                                                                                                                             |
| 가번호 설정  | 범위·부여 정책 저장             | `PSEUDONYM_SETTING_UPDATED`        | 동일 transaction          | `settingId`, `version`, `assignmentMethod`, `rangeCount`, `autoDrawEnabled`, `autoDrawDelaySeconds`, `printPreassignedLabel`, `autoAssignAbsenteesOnClose`, `deleteAbsenteeInfoOnReopen`, `useCandidatePhotos`, `enableBulkDraw` |
| 가번호 운영  | 등록 완료(마감)                 | `PSEUDONYM_OPERATION_CLOSED`       | 동일 transaction          | `operationId`, `examDate`, `examTime`, `periodName`, `admissionName`, `autoAssignedAbsenteeCount`                                                                                                                                |
| 가번호 운영  | 마감 해제                       | `PSEUDONYM_OPERATION_REOPENED`     | 동일 transaction          | `operationId`, `examDate`, `examTime`, `periodName`, `admissionName`, `deletedAbsenteeCount`                                                                                                                                     |
| 가번호       | 추첨·순차·매칭·사전부여         | `PSEUDONYM_ASSIGNED`               | 동일 transaction          | `assignmentId`, `candidateRecordId`, `examineeNo`, `pseudonymNo`, `mode`                                                                                                                                                         |
| 출력         | 작업 생성                       | `PRINT_JOB_CREATED`                | 동일 transaction          | `jobNo`, `copies`; envelope에 `workstationId`, `printJobId`                                                                                                                                                                      |
| 출력         | Browser Print 전송 성공         | `PRINT_JOB_SENT`                   | 동일 transaction          | `status`; envelope에 `workstationId`, `printJobId`                                                                                                                                                                               |
| 출력         | Browser Print 전송 실패         | `PRINT_JOB_FAILED`                 | 동일 transaction          | `status`, `errorRecorded`; envelope에 `workstationId`, `printJobId`                                                                                                                                                              |
| 출력         | 만료된 READY 작업 완료 시도     | `PRINT_JOB_EXPIRED`                | 동일 transaction          | `requestedStatus`, `status`; envelope에 `workstationId`, `printJobId`                                                                                                                                                            |
| 출력         | 실패 재시도·전송 완료 재출력    | `PRINT_JOB_REISSUED`               | 동일 transaction          | `reissueType`, 고정 `reasonCode`; envelope에 `workstationId`, 새 `printJobId`                                                                                                                                                    |

마감 중 자동 결시자 가번호는 개별 `PSEUDONYM_ASSIGNED` 이벤트를 만들지 않고
`PSEUDONYM_OPERATION_CLOSED.autoAssignedAbsenteeCount` 집계로 기록한다. 이 동작은 현재 계약을 보존한 것이다.

가번호 설정 감사에는 대상 `settingId`, 저장 결과의 optimistic `version`, 부여 방식, 자동 추첨 지연시간,
범위 개수와 boolean 정책 값만 기록한다.
시험명·전형명·수험번호·가번호 원문과 범위 시작·종료 번호는 기록하지 않는다. 감사 저장이 실패하면 설정 변경도
같은 transaction에서 rollback된다.

## 실패·거부 이벤트 정책

| 경로                                    | 현재 정책                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 성공 mutation의 업무 SQL 또는 감사 실패 | 전체 transaction rollback. 성공 이벤트는 남지 않고 업무 변경도 commit되지 않음                                         |
| validation·충돌·권한 거부               | mutation 전 또는 transaction 안에서 예외 처리. 현재 별도 실패 감사 이벤트는 없음                                       |
| 로그인 성공·실패·차단                   | `AUTH_LOGIN_SUCCEEDED`, `AUTH_LOGIN_FAILED`, `AUTH_LOGIN_BLOCKED`를 요청 ID와 함께 별도 DB 경로에서 best-effort로 기록 |
| 로그인 감사 저장 실패                   | 인증 결과를 뒤집지 않고 개인정보 없는 경고 로그만 남김                                                                 |

인증 감사는 업무 transaction이 존재하지 않으므로 의도적으로 `MutationAuditRepository`로 합치지 않는다.
현재 로그인 감사 상세에는 원문 아이디와 IP 대신 `loginIdHash`, `ipHash`, `reason`만 저장한다.
별도 인증 감사 writer도 이벤트별 reason, 64자리 SHA-256 hash, actor와 request ID, 정확한 details 키를
런타임에 검증한다. 계약 위반이나 저장 실패는 인증 결과를 바꾸지 않고 `false`를 반환한다.

## 민감정보 금지 필드

감사 `details`, 애플리케이션 로그, 예외 메시지에는 다음 값을 넣지 않는다.

- 비밀번호 원문·hash, JWT·Authorization 헤더, cookie, secret, encryption key
- 수험생 이름, 생년월일, 사진 BLOB/base64, 사진 ZIP·XLSX 원문 행
- 양식의 HTML/layout 전체, 인쇄 ZPL/PDF payload, 파일 원문
- 프린터 실패 원문에 포함될 수 있는 장치·사용자 데이터. 출력 감사에는 `errorRecorded`만 저장
- 재시도·재출력 자유문구. 출력 재발행 감사에는 허용 목록의 `reasonCode`만 저장
- 임의 request body/query/header 전체, DB 오류 SQL·parameter 원문

계정 이벤트의 `loginId`와 `PSEUDONYM_ASSIGNED`의 `examineeNo`, `pseudonymNo`는 기존 운영 추적 계약을
보존하기 위해 현재 DB 감사에 남기는 승인된 식별자 예외다. 가번호 할당에는 일정별 유일 정책에서도 대상을
구분할 수 있도록 `assignmentId`, `candidateRecordId`를 함께 기록한다. 이 식별자들은 외부 로그나 관측
플랫폼으로 복제하지 않으며, 향후 개인정보 보존 기간과 조회 권한을 승인할 때 masking 범위를 결정한다.

## 현재 후속 항목

- HTTP 밖의 batch/worker mutation에 별도 correlation ID를 부여하는 정책
- 권한 거부·중요 충돌의 감사 이벤트·허용 필드 확정
- 감사 로그 보존 기간, 조회 권한, archive/partition, 삭제·익명화 정책 승인
- 다중 인스턴스 환경에서 인증 best-effort 감사 실패를 수집할 내구성 경로 결정
