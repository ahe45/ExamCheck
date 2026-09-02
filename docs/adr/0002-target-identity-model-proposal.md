# ADR 0002: 목표 수험생·일정·가번호 identity 모델

- 상태: **Accepted**
- 작성일: 2026-08-28
- 승인자·승인일: 사용자 / 2026-08-28
- 적용 범위: 목표 identity 모델(`027+`)
- 기준 스키마: migration `001`~`026`
- 관련 결정: [ADR 0001](./0001-pseudonym-unique-scope.md)
- 결정 기록: [목표 데이터 모델 외부 결정 기록부](../data-model-decision-register.md) revision 2
- 변경 범위: 목표 모델 설계와 schema expand 작성 승인. 운영 적용·backfill·cutover는 별도 게이트 대상이다.

## 1. 목적

현재 모델은 수험생 개인, 업로드 행, 전형, 교시, 가번호 설정, 마감, 출력이 이름 문자열과 여러 호환 테이블을 통해 연결된다. 이 구조는 현재 한 전형·한 학년도 데이터에는 동작하지만 다음 경우에 같은 업무 대상을 안정적으로 가리키기 어렵다.

- 같은 수험번호가 여러 교시에 등록되는 경우
- 전형명·교시명·건물명 같은 표시 이름이 변경되는 경우
- 같은 날짜·시간에 모집단위·전공·고사실별 가번호 범위를 운영하는 경우
- 설정, 할당, 마감, 출력 이력에 서로 다른 일정 정보가 섞이는 경우
- 개발자 메뉴에서 수험번호·가번호 유일 정책을 변경하는 경우

목표는 다음 원칙을 만족하는 ID 기반 모델을 정의하는 것이다.

1. 수험생 개인과 특정 일정의 등록을 분리한다.
2. 시험 주기, 전형, 운영 교시, 범위 segment를 대체키로 연결한다.
3. 표시 이름은 관계 키가 아니라 표시값 또는 이력 snapshot으로 사용한다.
4. 개발자 메뉴의 유일 정책과 실제 DB unique 제약이 항상 같은 범위를 표현한다.
5. 구 모델을 즉시 삭제하지 않고 dual-write, backfill, shadow read, reconciliation을 거쳐 전환한다.
6. 정확히 매핑할 수 없는 레거시 데이터는 추정하거나 삭제하지 않는다.

이 문서의 목표 모델과 D-01~D-22 권장안은 2026-08-28 승인됐다. schema expand와 비운영
검증은 진행할 수 있지만, 개인정보 backup/restore, 운영 backfill과 read/write cutover는
[데이터 모델 컷오버 게이트](../data-model-cutover-gates.md)를 별도로 통과해야 한다. 보존 기간,
expiry, 관찰 기간·처리량·성능 임계치처럼 숫자가 정해지지 않은 항목은 원칙 승인 상태이며 운영
전환 전에 별도 확정한다.

## 2. 확인한 현재 상태

### 2.1 migration에서 확인한 모델 변화

`001`~`025`를 순서대로 검토했다.

| migration   | identity 관점의 핵심 변화                                                                     |
| ----------- | --------------------------------------------------------------------------------------------- |
| `001`~`003` | `app_user`, `examinee`, 문자열 `exam_name`, `pseudonym_setting`, `pseudonym_assignment` 생성  |
| `004`~`006` | 초기 호환 수험생·계정 sample 추가                                                             |
| `007`       | `form_template` 추가                                                                          |
| `008`~`009` | 일정과 인적 정보를 한 행에 가진 `candidate_record`, 행 단위 `candidate_photo` 추가            |
| `010`~`012` | 일정별 가번호 범위와 운영 정책 추가. 범위 identity가 날짜·시간에서 전체 segment 문자열로 확장 |
| `013`       | 전형명을 문자열로 저장하는 사용자 접근 배정 추가                                              |
| `014`       | 단일 `system_profile`과 개발자 역할 추가                                                      |
| `015`~`017` | 전형별 설정, 자동 추첨, 문자열 일정 키 기반 운영 마감 추가                                    |
| `018`       | 계정 표시명 제거                                                                              |
| `019`~`021` | 개발자 유일 정책, `candidate_record_id`, 가번호 scope key, 레거시 할당 보정 추가              |
| `022`       | 전형 설정 optimistic version 추가                                                             |
| `023`       | 출력 요청 idempotency key 추가                                                                |
| `024`       | 계정 session version 추가                                                                     |
| `025`       | 출력 요청 지문 추가                                                                           |

현재의 `candidate_record_id` 연결과 scope key는 운영 가능한 안전 보강이지만 독립된 일정·등록 모델을 대신하지는 않는다.

### 2.2 로컬 DB 읽기 전용 집계 교차 확인

2026-08-28에 현재 로컬 연결 DB에 대해 `SELECT` 집계만 수행했다. 수험번호, 이름, 생년월일, 사진, 가번호 원문은 출력하거나 문서에 기록하지 않았다.

| 항목                                                         |                                확인값 |
| ------------------------------------------------------------ | ------------------------------------: |
| 적용 migration                                               |                    25개 (`001`~`025`) |
| `candidate_record` 행 / 고유 수험번호                        |                             138 / 138 |
| 연결 가능한 시험명 / 전형                                    |                                 1 / 1 |
| 운영 교시 후보 / schedule segment 후보                       |                                 6 / 6 |
| 시험연도와 `system_profile.academic_year` 불일치 행          |                                     0 |
| 연결 시험명과 현재 `DEFAULT_EXAM_NAME` 불일치 행             |                                     0 |
| 복수 일정 수험번호 그룹                                      |                                     0 |
| 현재 일정키 중복 그룹 / 목표 registration 자연키 중복 그룹   |                                 0 / 0 |
| `candidate_record`에만 있는 수험생                           |                                     0 |
| 활성 `examinee`이지만 `candidate_record`가 없는 행           |                                     8 |
| 가번호 할당 전체 / 정확한 일정 매핑 / 레거시 미매핑          |                            11 / 6 / 5 |
| 빈 전형명을 가진 레거시 할당                                 |                                     5 |
| 설정 / 범위 / 운영 마감 행                                   |                             2 / 6 / 1 |
| exact 전형 설정에 연결되지 않는 segment 범위                 |                                     0 |
| 범위 키 재계산 불일치                                        |                                     0 |
| 현재 유일 정책                                               | 수험번호 `SYSTEM`, 가번호 `ADMISSION` |
| segment별 범위 용량 합 / 범위 합집합 용량 / 대상 행          |                        138 / 39 / 138 |
| 서로 겹치는 범위 쌍                                          |                                    15 |
| 사전 가번호가 채워진 `candidate_record`                      |                                     0 |
| 사진                                                         |                                     0 |
| 출력 작업 전체 / 단일 registration으로 연결 가능한 출력 작업 |                                 3 / 0 |
| 사용자 권한 계정 / 전형 배정 0건 계정 / 배정 행              |                             1 / 0 / 1 |
| 현재 모든 전형과 동일하게 배정된 사용자                      |                                     1 |

위 집계는 migration `025`를 포함한 로컬 DB에서 다시 확인했다. 025는 인쇄 요청 지문만
추가하므로 표의 identity 관련 aggregate는 이전 기준선과 동일하며, 목표 identity 모델의 테이블이나
데이터는 변경하지 않는다.

이후 적용한 async scrypt, 업로드·사진 검증, 인쇄 멱등성·서버 정책, 워크스테이션 트랜잭션,
Controller DTO 검증도 현 모델의 운영 안전 보강이다. 이러한 완료 항목을 목표
`schedule/registration` identity cutover 완료 근거로 사용하지 않는다.

기존 [데이터 정합성 기준선](../data-integrity-baseline.md)의 138개 업로드 행, 6개 일정, 11개 할당, 6개 정확 매핑, 5개 레거시 미매핑, 8개 고립 `examinee`, 범위 겹침 15쌍을 다시 확인했다.

추가로 확인된 중요한 사실은 다음과 같다.

- 현재 `ADMISSION` 가번호 유일 정책에서 segment별 용량 합은 138이지만 범위 합집합은 39개뿐이다. 전형 전체 138명에게 모두 서로 다른 가번호를 부여할 수 없다.
- 전형·교시·모집단위·건물·고사실 표시값에는 앞뒤 공백 이상이 없고, 현재 collation 기준 distinct 수와 byte distinct 수도 같다.
- 그러나 MariaDB 집계만으로 NFKC 정규화 충돌을 증명할 수 없으므로 **NFKC 충돌 수는 미확인**이다.
- 전형·교시·모집단위·건물·고사실 코드 열은 현재 138행 모두 비어 있다. `major`와 `major_code`도 모두 비어 있으므로 지금은 코드를 자연키로 사용할 수 없다.
- 출력 작업 3건은 현재 `candidate_record` 한 건으로도 연결되지 않는다. 과거 출력 snapshot으로 보존해야 하며 임의 연결하면 안 된다.
- 현재 한 사용자에게 한 전형이 배정되어 있고 그 전형은 현재 전체 전형과 같다. 이것이 명시적 `ASSIGNED` 의도인지, 당시 전체 접근을 나타낸 것인지는 데이터만으로 판별할 수 없다.

## 3. 용어와 경계

| 용어                                | 정의                                                                    | 현재 대응                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 시험 주기(`exam_cycle`)             | 한 학교의 한 운영 연도·모집/시험 주기를 묶는 최상위 업무 범위           | `system_profile.academic_year`, `DEFAULT_EXAM_NAME`, `examinee.exam_name`의 조합 |
| 전형(`admission`)                   | 시험 주기 안에서 권한과 가번호 정책을 공유하는 전형                     | `candidate_record.admission`                                                     |
| 운영 교시(`operation_slot`)         | 전형 + 시험일자 + 시작시간 + 교시. 사용자 선택과 등록 완료(마감)의 단위 | 날짜·시간·교시명·전형명 문자열 조합                                              |
| 일정 segment(`schedule_segment`)    | 한 운영 교시 안에서 모집단위·전공·건물·고사실을 묶은 범위 설정 단위     | `pseudonym_time_range`의 전체 일정 문자열 조합                                   |
| 수험생(`candidate`)                 | 시험 주기 안의 한 인적·수험번호 identity                                | `examinee`와 `candidate_record`의 인적 필드가 이중 원본                          |
| 수험 등록(`candidate_registration`) | 한 수험생이 한 운영 교시의 특정 segment에 등록된 사실                   | `candidate_record` 한 행                                                         |
| 가번호 정책(`pseudonym_policy`)     | 전형별 부여 방식과 운영 스위치                                          | `pseudonym_setting`                                                              |
| 가번호 범위(`pseudonym_range`)      | segment별 숫자 범위와 순차 cursor                                       | `pseudonym_time_range`                                                           |
| 운영 상태(`pseudonym_operation`)    | 운영 교시의 열림/마감 상태                                              | 문자열 복합키 `pseudonym_operation`                                              |
| 가번호 할당(`pseudonym_assignment`) | 등록 행에 실제 가번호를 부여한 현재 결과                                | `candidate_record_id`가 있으면 일정 연결, 없으면 레거시                          |

## 4. 제안하는 목표 관계

```text
system_profile
  └─ number_uniqueness_policy
  └─ exam_cycle
       └─ admission
            ├─ pseudonym_policy
            ├─ user_admission_assignment
            └─ operation_slot
                 ├─ pseudonym_operation
                 └─ schedule_segment
                      ├─ pseudonym_range
                      └─ candidate_registration
                           ├─ candidate_number_claim
                           └─ pseudonym_assignment
                                └─ pseudonym_number_claim

candidate
  ├─ candidate_photo
  └─ candidate_registration

pseudonym_operation_event
pseudonym_assignment_event
print_job ── immutable print_projection_snapshot
form_template ── template_data_projection
audit_log
```

관계의 FK는 대체키를 사용한다. 자연키는 업로드 행을 같은 업무 객체에 연결하고 중복을 차단하는 용도로만 사용한다.

## 5. 테이블별 목표 계약

아래 컬럼명과 타입은 승인된 목표 계약이다. 실제 DDL은 기존 migration을 수정하지 않고 `027+`
schema expand로 작성한다. 운영 DB 적용과 backfill은 익명화 fixture 검증과 backup/restore 게이트를
통과한 뒤 별도 승인한다.

### 5.1 `exam_cycle`

권장 컬럼:

- `id BIGINT UNSIGNED` PK
- `system_profile_id TINYINT UNSIGNED` FK
- `cycle_code VARCHAR(100)` — 시스템 내부에서 불변인 코드
- `display_name VARCHAR(200)` — 화면에 표시할 시험명
- `academic_year SMALLINT UNSIGNED`
- `status ENUM('DRAFT','ACTIVE','CLOSED','ARCHIVED')`
- `starts_on`, `ends_on`, 생성·수정 actor와 시간

권장 제약:

- `UNIQUE(system_profile_id, cycle_code)`
- 같은 profile에서 `ACTIVE`를 한 개만 허용하는 세부 전환 절차는 별도 current-pointer 또는 claim으로 보장한다.

현재 데이터의 후보 mapping은 한 건이다. 학년도, 연결 시험명, `DEFAULT_EXAM_NAME`이 현재는 일치한다.
불변 `cycle_code` 생성 원본, 표시명, 시작·종료일과 active 전환 절차는 운영값으로 별도 확정하며
그 전에는 현재 문자열을 임의의 불변 코드로 간주하지 않는다.

### 5.2 `admission`

권장 컬럼:

- `id BIGINT UNSIGNED` PK
- `exam_cycle_id` FK
- `source_code VARCHAR(100) NULL`
- `display_name VARCHAR(200)`
- `canonical_name VARCHAR(200) COLLATE utf8mb4_bin`
- `identity_key VARCHAR(260) COLLATE utf8mb4_bin` — `CODE:<정규화 코드>` 또는 승인된 `NAME:<정규화 이름>`
- `status`, 생성·수정 actor와 시간

권장 제약:

- `UNIQUE(exam_cycle_id, identity_key)`
- 코드가 있는 경우 `UNIQUE(exam_cycle_id, source_code)`

현재 모든 `admission_code`가 비어 있으므로 최초 backfill은 정규화 이름 기반의 임시 identity key를 사용해야 한다. 이후 코드가 들어왔다고 이름 기반 행을 자동 병합하거나 새 ID로 교체하지 않는다. 검토된 alias/rekey 작업으로 같은 surrogate ID를 유지한다.

### 5.3 `operation_slot`

권장 컬럼:

- `id BIGINT UNSIGNED` PK
- `admission_id` FK
- `exam_date DATE`
- `start_time TIME`
- `end_time TIME NULL`
- `period_code VARCHAR(100) NULL`
- `period_name VARCHAR(100)` 및 `period_canonical_name`
- `identity_key` — 코드가 있으면 코드, 없으면 정규화 교시명
- `status`

권장 제약:

- `UNIQUE(admission_id, exam_date, start_time, identity_key)`

`operation_slot`은 사용자 로그인 후 선택, 명단 조회, 다른 교시 수험생 안내, 등록 완료(마감)의 단위다. 건물·고사실은 slot identity에 넣지 않는다. 현재 6개 후보가 모두 정확히 한 개의 slot으로 집계된다.

### 5.4 `schedule_segment`

권장 컬럼:

- `id BIGINT UNSIGNED` PK
- `operation_slot_id` FK
- 모집단위·전공·건물·고사실의 `source_code`, `display_name`, `canonical_name`
- `identity_key VARBINARY(32)` — 네 구성요소의 versioned canonical encoding digest
- `status`

권장 제약:

- `UNIQUE(operation_slot_id, identity_key)`

빈 값과 구분자가 있는 문자열 단순 연결은 사용하지 않는다. 각 값은 길이 prefix가 있는 canonical encoding 또는 안정적인 JSON 배열로 직렬화한 뒤 version prefix와 함께 SHA-256을 계산한다. digest 충돌이 발견되면 canonical payload도 비교하고 fail closed한다.

현재 데이터에서는 segment 후보도 6개다. 모든 코드가 비어 있으므로 최초 mapping은 표시 이름을 사용한다. 향후 코드 도입 시 자동으로 새 segment를 만들지 않고 기존 ID에 source alias를 연결한다.

### 5.5 `candidate`

권장 컬럼:

- `id BIGINT UNSIGNED` PK
- `exam_cycle_id` FK
- `examinee_no_display VARCHAR(100)`
- `examinee_no_canonical VARCHAR(100) COLLATE utf8mb4_bin`
- `name`, `birth_date`, `status`
- 인적정보의 `source_revision` 또는 `source_hash`
- 생성·수정 actor와 시간

권장 제약:

- `UNIQUE(exam_cycle_id, examinee_no_canonical)`

한 시험 주기 안에서 같은 수험번호는 하나의 인적 identity다. `SCHEDULE` 정책은 같은 candidate가 여러 slot에 등록되는 것을 허용하는 것이지, 일정마다 서로 다른 candidate를 만드는 의미가 아니다. 같은 수험번호의 이름·생년월일이 서로 다르면 마지막 행으로 덮지 않고 identity 충돌로 격리한다.

목표 모델의 `SYSTEM`은 `exam_cycle` 범위다. 실제 등록 허용 범위는
`candidate_number_claim`이 담당하며 cycle별 claim scope로 DB에서 최종 보호한다.

### 5.6 `candidate_registration`

권장 컬럼:

- `id BIGINT UNSIGNED` PK
- `candidate_id` FK
- `schedule_segment_id` FK
- `source_candidate_record_id BIGINT UNSIGNED NULL` — 전환 기간의 bridge
- `designated_sort`, `group_name`, `opt1`~`opt3`
- 사전 가번호 `preassigned_value BIGINT UNSIGNED NULL`, `preassigned_display_width SMALLINT NULL`
- `status ENUM('ACTIVE','CANCELLED')`
- `source_hash`, 생성·수정 시간

권장 제약:

- `UNIQUE(source_candidate_record_id)` — bridge가 존재하는 동안
- `UNIQUE(candidate_id, schedule_segment_id)`
- 별도의 claim으로 `candidate_id`가 같은 slot 안에서 segment를 중복 점유하지 못하게 한다.

`candidate_record`의 날짜·시간·전형·공간 필드는 registration에서 제거하고 FK를 통해 읽는다. 업로드 원문의 표시값은 별도 import batch snapshot 또는 audit digest로 보존한다.

### 5.7 `candidate_photo`

승인된 기본안은 `candidate_id`당 현재 사진 한 건이다. 사진은 사람 속성이며 같은 수험생이 여러 교시에 등록되어도 중복 BLOB을 만들 필요가 없기 때문이다.

현재 로컬 DB에는 사진이 0건이다. candidate 기준으로 이관하되 hash가 충돌하는 사진은 자동
병합하지 않고 격리한다. 접근권한, 보존·파기 기간과 registration override 필요 여부는 개인정보
정책과 운영 sample을 확인해 별도 운영값으로 확정한다.

### 5.8 `number_uniqueness_policy`와 `candidate_number_claim`

개발자 메뉴의 수험번호·가번호 정책은 단일 원본이어야 한다.

권장 정책 행:

- `exam_cycle_id` PK/FK
- `examinee_scope ENUM('SYSTEM','SCHEDULE')`
- `pseudonym_scope ENUM('ADMISSION','SCHEDULE')`
- `version`, `updated_by`, `updated_at`

목표 모델 정책은 exam cycle 단위로 저장한다. 현 profile 단위 값은 각 cycle의 초기값으로
명시적으로 이관하고 compatibility adapter 외에는 암묵 fallback을 두지 않는다.

수험번호 DB 제약은 `candidate_number_claim`으로 표현한다.

- `registration_id` unique FK
- `scope_kind ENUM('SYSTEM','SCHEDULE')`
- `scope_key BINARY(32)`
- `examinee_no_canonical`
- `UNIQUE(scope_key, examinee_no_canonical)`

scope key 정의:

- `SYSTEM`: `exam_cycle_id`의 versioned encoding.
- `SCHEDULE`: `operation_slot_id`의 versioned encoding.

정책 변경은 profile/policy 행을 잠근 같은 transaction에서 모든 claim을 재계산한다. `SCHEDULE → SYSTEM` 변환 시 unique 충돌이 하나라도 있으면 원문 번호 없이 충돌 그룹 수만 반환하고 전체 rollback한다. 업로드와 정책 변경은 같은 정책 행 잠금 순서를 사용한다.

### 5.9 `pseudonym_policy`와 `pseudonym_range`

`pseudonym_policy` 권장 컬럼:

- `id`, `admission_id UNIQUE`
- `version`
- `assignment_method`
- 자동 추첨, 지연 시간, 사전부여 라벨 출력, 결시자 처리, 사진, 일괄 추첨 스위치
- `updated_by`, 생성·수정 시간

`pseudonym_range` 권장 컬럼:

- `id`, `pseudonym_policy_id`, `schedule_segment_id`
- `range_start_value BIGINT UNSIGNED`
- `range_end_value BIGINT UNSIGNED`
- `next_value BIGINT UNSIGNED`
- `display_width SMALLINT UNSIGNED`
- `version`, `updated_by`, 시간

권장 제약:

- `UNIQUE(pseudonym_policy_id, schedule_segment_id)`
- 시작값 ≤ 종료값, cursor가 범위 안에 있다는 check
- 각 범위 용량은 해당 segment의 활성 registration 수와 일치

가번호는 문자열이 아니라 양의 canonical 숫자와 표시 자릿수를 분리한다. 예를 들어 표시 `001`은 값 `1`, 자릿수 `3`이다. 비교·범위·유일성은 값으로 처리하고 출력에서 자릿수를 적용한다.

`ADMISSION` 정책에서는 전형 안의 모든 segment 범위 중복을 금지하고 합집합이 전체 등록 인원
이상이어야 한다. `SCHEDULE`은 서로 다른 slot 간 번호 재사용을 허용하지만 같은 slot 안의 segment
범위는 겹칠 수 없다. 현재 합집합 39개로 138명을 수용할 수 없으므로 범위를 수정하기 전 canonical
cutover는 금지한다.

빈 `admission_name` 설정은 특정 전형에 붙이지 않고 명시적 global default로 보존한다. 전형별
override가 있으면 이를 우선하고, 없을 때만 global default를 적용한다.

### 5.10 `pseudonym_operation`과 event history

현재 상태 행 권장 컬럼:

- `id`, `operation_slot_id UNIQUE`
- `state ENUM('OPEN','CLOSED')`
- `version`
- `closed_by`, `closed_at`, `last_reopened_by`, `last_reopened_at`

별도 `pseudonym_operation_event`에는 `CLOSED`, `REOPENED`, 자동 결시자 처리 결과를 append-only로 기록한다. 상태 변경과 event/audit는 같은 transaction이어야 한다.

마감과 할당은 항상 같은 `operation_slot_id` 상태 행을 먼저 `FOR UPDATE`로 잠근다. 이름 복합키마다 잠금 순서가 달라지는 현재 위험을 제거한다.

### 5.11 `pseudonym_assignment`와 `pseudonym_number_claim`

현재 할당 권장 컬럼:

- `id`, `candidate_registration_id UNIQUE`, `pseudonym_operation_id`
- `pseudonym_value BIGINT UNSIGNED`
- `display_width SMALLINT UNSIGNED`
- `assignment_mode`, `is_absentee`, `auto_assigned_on_close`
- `assigned_by`, `assigned_at`

유일 정책은 `pseudonym_number_claim`으로 최종 보호한다.

- `assignment_id UNIQUE` FK
- `scope_kind ENUM('ADMISSION','SCHEDULE')`
- `scope_key BINARY(32)`
- `pseudonym_value BIGINT UNSIGNED`
- `UNIQUE(scope_key, pseudonym_value)`

scope key 정의:

- `ADMISSION`: `admission_id`
- `SCHEDULE`: `operation_slot_id`

정책 변경은 assignment와 claim을 같은 transaction에서 다시 계산한다. 레거시 미매핑 5건은
canonical assignment로 만들지 않고 immutable legacy reservation/history로 보존한다. claim에서
제외했다는 이유로 번호를 재사용하면 안 된다.

재개 시 현재 assignment/absence projection만 해제하고 `pseudonym_assignment_event`, audit, 이미
생성된 print snapshot은 보존한다. 부여·해제·재부여는 append-only event로 기록하며 법적·개인정보
보존 정책 없이 이력을 hard delete하지 않는다.

### 5.12 사용자 전형 접근 scope

`app_user`에 `admission_scope_mode ENUM('ALL','ASSIGNED')`를 명시하고 `user_admission_assignment`는 `admission_name` 대신 `admission_id` FK를 저장한다.

권장 규칙:

- `ADMIN`, `DEVELOPER`: 역할 권한으로 전체 접근
- 사용자 `ALL`: assignment 행 없이 현재와 미래 전형 전체 접근
- 사용자 `ASSIGNED`: 한 개 이상의 `admission_id`만 접근
- `ASSIGNED`인데 배정 행이 0개인 상태는 저장 차단

현재 “배정 행 0개면 전체”라는 암묵 규칙을 제거한다. 현 무배정 계정은 `ALL`, 배정 계정은 exact
admission ID의 `ASSIGNED`로 이관한다. `ASSIGNED`인데 배정 행이 0개인 상태는 저장하지 않는다.

### 5.13 출력과 양식 projection

신규 `TemplateDataProjection`은 `candidate_registration_id` 또는 `operation_slot_id`를 입력받아 기존 data tag 계약으로 투영한다.

주요 원칙:

- `candidate.*` 인적 필드는 candidate에서 읽는다.
- 전형·교시·공간 필드는 registration → segment → slot → admission에서 읽는다.
- 가번호는 assignment의 canonical 값과 display width로 렌더링한다.
- 기존 tag 이름은 compatibility alias로 유지하고 필수 신규 필드가 없으면 빈 값 대신 명시적 오류로 중단한다.
- 출력 시점의 이름, 일정, 가번호, template code/version을 immutable snapshot으로 저장한다.
- template draft는 수정할 수 있지만 published version은 immutable이며 정정은 새 version으로 만든다.
- 인쇄 실패·재시도를 구분하고 재출력 사유, actor와 시각을 append-only audit로 남긴다.

`print_job.business_ref`의 수험번호 문자열을 FK처럼 사용하지 않는다. 신규 작업은 `candidate_registration_id`, `pseudonym_assignment_id`, `operation_slot_id`를 참조하고, 기존 `print_job_payload`와 snapshot은 변경하지 않는다.

현재 출력 작업 3건은 registration에 매핑되지 않는다. immutable legacy 출력 이력으로 보존하고
신규 FK를 임의로 채우지 않는다. `SENT`는 물리 출력 완료가 아니라 Browser Print로 전송 성공이라는
현재 의미를 유지한다. expiry, 최대 재시도, 사진·출력 보존 기간은 별도 운영값으로 확정한다.

## 6. 자연키와 대체키 원칙

| 대상        | 관계에 쓰는 키              | 업로드·중복 판별 자연키                                  |
| ----------- | --------------------------- | -------------------------------------------------------- |
| 시험 주기   | `exam_cycle.id`             | profile + 승인된 cycle code                              |
| 전형        | `admission.id`              | cycle + source code, 없으면 승인된 normalized-name alias |
| 운영 교시   | `operation_slot.id`         | admission + 날짜 + 시작시간 + period identity            |
| segment     | `schedule_segment.id`       | slot + 모집단위·전공·건물·고사실 identity                |
| 수험생      | `candidate.id`              | cycle + canonical 수험번호                               |
| 등록        | `candidate_registration.id` | candidate + segment, 추가로 candidate-number claim       |
| 가번호 정책 | `pseudonym_policy.id`       | admission unique                                         |
| 범위        | `pseudonym_range.id`        | policy + segment unique                                  |
| 운영 상태   | `pseudonym_operation.id`    | slot unique                                              |
| 할당        | `pseudonym_assignment.id`   | registration unique + number claim                       |
| 출력        | UUID `print_job.id`         | 요청자 + idempotency key                                 |

표시 이름을 FK로 사용하지 않으며 이름 수정은 ID를 바꾸지 않는다. 외부 source code가 없는 현재 데이터는 name alias를 사용해 backfill하되, 그 alias는 canonical ID가 생성된 뒤 표시 이름 변경과 분리한다.

## 7. 문자열과 숫자 정규화 계약

### 7.1 공통 문자열

애플리케이션 경계에서 다음 순서를 versioned 규칙으로 적용한다.

1. 문자열 타입 검증
2. Unicode NFKC
3. Unicode 앞뒤 공백 제거
4. 업무상 이름 필드의 연속 내부 공백 축약 여부는 별도 운영값으로 확정
5. 빈 문자열은 optional 필드에서 `NULL`, 필수 필드에서는 오류
6. 표시값은 별도로 보존

canonical 비교 컬럼은 `utf8mb4_bin` 계열로 저장해 DB collation의 대소문자·악센트 병합에 의존하지 않는다. 코드 필드는 NFKC·trim 후 ASCII 대문자화를 적용한다. 한글 표시 이름은 case folding하지 않는다.

정규화 규칙에는 `normalization_version`을 둔다. 규칙 변경 시 기존 값을 암묵적으로 다시 쓰지 않고 충돌 진단과 명시적 rekey 절차를 거친다.

### 7.2 수험번호

- 숫자 타입으로 바꾸지 않는다.
- NFKC와 trim을 적용하되 선행 0은 보존한다.
- 제어 문자와 구분 문자는 허용 문자 정책 확정 후 거부한다.
- 원문 표시값과 canonical 값을 함께 둔다.

### 7.3 가번호

- NFKC 후 ASCII 숫자만 허용한다.
- 양의 정수 canonical 값과 표시 자릿수를 분리한다.
- `001`과 `1`은 유일성 관점에서 같은 값이다.
- 범위와 cursor는 canonical 값으로 계산한다.

### 7.4 날짜와 시간

- 날짜는 MariaDB `DATE`, 시간은 `TIME`으로 저장한다.
- API는 `YYYY-MM-DD`, `HH:mm` 24시간 형식을 사용한다.
- 학교 timezone은 profile/cycle 설정으로 명시하고, 감사·출력 timestamp는 timezone 또는 UTC 기준을 함께 기록한다.

## 8. 현재 → 목표 필드 mapping

| 현재 원본                                 | 목표                                 | 처리                                                      |
| ----------------------------------------- | ------------------------------------ | --------------------------------------------------------- |
| `system_profile.academic_year`            | `exam_cycle.academic_year`           | 후보값. 시험일자의 연도와 현재 138행 모두 일치            |
| `DEFAULT_EXAM_NAME`, `examinee.exam_name` | `exam_cycle.cycle_code/display_name` | 현재 불일치 0. code 원본·기간은 별도 운영값 확정          |
| `candidate_record.admission(_code)`       | `admission`                          | 코드는 모두 빈 값. normalized-name alias 필요             |
| 날짜·시작시간·교시                        | `operation_slot`                     | 현재 6개 후보                                             |
| 모집단위·전공·건물·고사실                 | `schedule_segment`                   | 현재 6개 후보, 코드 전체 공란                             |
| 수험번호·이름·생년월일                    | `candidate`                          | `candidate_record`를 우선 후보로 하고 `examinee`와 비교   |
| `candidate_record` 한 행                  | `candidate_registration`             | source ID bridge로 1:1 backfill 후보                      |
| `candidate_photo.candidate_record_id`     | `candidate_photo.candidate_id`       | 동일 candidate 사진 hash 충돌 진단 후 전환. 현재 0건      |
| `candidate_record.temporary_no`           | registration 사전 가번호 값/자릿수   | 현재 채워진 행 0                                          |
| exact `pseudonym_setting`                 | `pseudonym_policy`                   | 전형 ID로 연결, version 유지                              |
| 빈 전형 `pseudonym_setting`               | global default                       | 특정 전형에 추정 연결하지 않고 override fallback으로 보존 |
| `pseudonym_time_range`                    | `pseudonym_range`                    | 현재 6개 모두 exact segment 후보에 매핑                   |
| mapped `pseudonym_assignment` 6건         | canonical assignment                 | registration FK로 backfill 가능                           |
| unmapped assignment 5건                   | legacy reservation                   | 자동 추정·삭제 금지                                       |
| `pseudonym_operation`                     | slot 상태 + event                    | 현재 1건은 exact slot 후보에 매핑 가능                    |
| `user_admission_assignment`               | admission ID assignment              | 무배정은 `ALL`, exact 배정은 `ASSIGNED`로 이관            |
| `print_job` 3건                           | immutable legacy print history       | 현재 registration 매핑 불가, FK 채움 금지                 |

## 9. 무중단 compatibility 전환 순서

각 5A~5F 수직 단위는 다음 순서를 반복한다.

1. **설계 승인**: 이 ADR과 외부 결정, natural key, 보존 정책 승인
2. **schema expand**: nullable FK·신규 테이블·feature flag만 추가. 구 컬럼과 unique는 유지
3. **mapping dry-run**: 원문을 노출하지 않고 exact/unmapped/ambiguous/normalization-collision 수 집계
4. **dual-write 배포**: 구/신규 write를 같은 DB transaction과 audit 경계에서 실행
5. **high-water mark**: backfill snapshot의 마지막 source ID와 시각 기록
6. **chunk backfill**: 재실행 가능한 별도 command에서 checkpoint·성공·실패·미매핑을 기록
7. **incremental reconciliation**: high-water mark 이후 live write를 따라잡음
8. **shadow read**: 같은 요청 snapshot에서 old/new projection을 PII 없는 digest와 집계로 비교
9. **read flag canary**: 개발자·관리자, 일부 전형, 전체 순으로 신규 read 활성화
10. **관찰**: 승인된 기간 또는 처리 건수 동안 mismatch, 오류율, latency, lock wait 관찰
11. **canonical 후보 release**: Phase 11 승인을 받아 신규 write/read를 원본으로 전환
12. **contract**: 보존 기간과 복원 리허설 이후에만 legacy write·컬럼·테이블 제거

dual-write 중 한쪽이 실패하면 같은 transaction 전체를 rollback한다. DB 밖의 프린터 전송은 transaction에 포함할 수 없으므로 outbox/print job 상태와 idempotency로 재시도한다.

### 9.1 단계별 shadow 비교 대상

| 단계        | old                            | new                                          | 비교 기준                                                    |
| ----------- | ------------------------------ | -------------------------------------------- | ------------------------------------------------------------ |
| 5A identity | `candidate_record` 문자열 조합 | cycle/admission/slot/segment/registration ID | 행 수, exact/unmapped/ambiguous, canonical digest            |
| 5B roster   | 기존 roster SQL                | registration projection                      | 순서 독립 row digest, 배정/결시 집계                         |
| 5C 권한     | 전형명 목록·0건 fallback       | mode + admission ID                          | 사용자별 허용 admission ID 집합                              |
| 5D 설정     | setting/range 문자열           | policy/range FK                              | 정책 version, 범위, cursor, segment coverage                 |
| 5E 운영     | 기존 assignment/operation      | registration/slot 참조                       | 할당 값·mode·상태·마감 집계                                  |
| 5F 출력     | 기존 data tag 조립             | template projection                          | tag key별 normalized digest, template/version/payload digest |

PII 원문은 mismatch 로그에 남기지 않는다. 내부 source ID, 분류 코드, 개수, 고정 길이 salted digest만 허용한다.

## 10. 조회·쓰기 및 잠금 규칙

- upload, 정책 변경, 할당, 마감은 공통 lock order를 사용한다: uniqueness policy → admission policy → operation slot/state → range → registration/claim.
- unique 위반은 정상 경합 결과로 처리하고 사용자에게 원문 없는 `409`를 반환한다.
- 설정 optimistic version은 admission policy의 version으로 이어간다.
- roster 조회는 하나의 consistent snapshot에서 registration, assignment, operation을 읽는다.
- backfill은 일반 migration DDL에 포함하지 않는다.
- assignment, operation event, audit, print snapshot에는 `ON DELETE CASCADE`를 사용하지 않는다.
- candidate/admission/slot 삭제는 기본적으로 status 전환이며 history가 참조하는 ID는 물리 삭제하지 않는다.

## 11. 인덱스 후보와 검증 항목

DDL 작성 전에 익명화 운영 복제 DB에서 다음 인덱스를 `EXPLAIN ANALYZE`로 확인한다.

- `admission(exam_cycle_id, identity_key)` unique
- `operation_slot(admission_id, exam_date, start_time, identity_key)` unique
- `schedule_segment(operation_slot_id, identity_key)` unique
- `candidate(exam_cycle_id, examinee_no_canonical)` unique
- `candidate_registration(candidate_id, schedule_segment_id)` unique
- registration의 `schedule_segment_id, status` roster index
- candidate number claim의 `scope_key, examinee_no_canonical` unique
- `pseudonym_policy(admission_id)` unique
- `pseudonym_range(pseudonym_policy_id, schedule_segment_id)` unique
- `pseudonym_operation(operation_slot_id)` unique 및 state/time index
- `pseudonym_assignment(candidate_registration_id)` unique
- pseudonym number claim의 `scope_key, pseudonym_value` unique
- 권한 배정의 `user_id, admission_id` PK와 역방향 `admission_id, user_id`
- print projection의 registration/assignment/created_at 조회 index

현재 138행 로컬 데이터의 실행 계획은 운영 규모를 대표하지 않는다. 예상 peak 행 수, 전형 수, 교시 수, 동시 단말 수를 받은 뒤 row scan과 lock wait 기준을 확정한다.

## 12. 호환성 원칙

- 기존 API의 이름 기반 입력은 compatibility facade에서 ID를 정확히 한 건으로 해석할 때만 허용한다.
- 0건이면 not found, 2건 이상이면 ambiguous conflict로 중단한다.
- 신규 API는 `examCycleId`, `admissionId`, `operationSlotId`, `candidateRegistrationId`를 사용한다.
- old Web/new API와 new Web/old API 조합을 contract test로 검증한다.
- `DEFAULT_EXAM_NAME`은 mapping adapter 뒤로 옮긴 후 신규 코드에서 직접 참조하지 않는다.
- 기존 template data tag와 출력 payload는 compatibility alias로 유지한다. 종료 버전·기간은 사용량 0 증거 후 별도 확정한다.
- 레거시 assignment 5건, 고립 examinee 8건, 매핑 불가 print job 3건은 추정·삭제하지 않고 immutable legacy history로 보존한다.

## 13. 거부한 접근

### 이름 문자열을 그대로 FK처럼 유지

표시 이름 변경과 Unicode 표현 차이에 취약하고 권한·설정·마감이 서로 다른 행을 가리킬 수 있어 거부한다.

### `candidate_record`에 ID 컬럼만 계속 추가

한 행에 인적 identity, 일정, 공간, 업로드 옵션, 사전 가번호가 계속 섞여 update fan-out과 중복 원본을 해결하지 못하므로 목표 모델로는 거부한다. 다만 전환 source와 compatibility projection으로는 유지한다.

### 정책별로 unique index DDL을 매번 생성·삭제

운영 중 DDL lock과 부분 실패 위험이 크다. 고정 unique index를 가진 claim 행의 scope key를 transaction에서 변경하는 방식을 제안한다.

### hash만 저장하고 의미 컬럼을 버림

진단과 재계산이 불가능하므로 거부한다. scope kind, source ID, normalization version을 함께 저장하고 hash는 고정 길이 unique key로만 쓴다.

### 레거시 미매핑을 첫 일정·첫 전형에 자동 연결

운영 이력을 잘못 귀속할 수 있어 거부한다. exact 1건 mapping만 자동화한다.

### 한 번의 대형 migration과 즉시 cutover

MariaDB DDL의 암묵적 commit, 현 데이터의 미결정 항목, 출력·권한 호환 위험 때문에 거부한다.

## 14. Phase 5 준비 상태

| Phase            | 승인·준비된 항목                                                                     | 남은 실행 게이트                                           |
| ---------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 5A 공통 identity | 계층·ID·정규화 원칙, cycle 범위 SYSTEM, legacy 격리, 6 slot·6 segment 후보           | cycle 세부 운영값, NFKC 진단, schema expand·복원본 dry-run |
| 5B roster        | candidate/registration 분리, projection과 shadow digest 계약                         | 신규 schema/repository, 익명화 fixture, 운영 규모 실행계획 |
| 5C 권한          | 명시적 `ALL/ASSIGNED`와 이관 의미                                                    | 구현, 역할별 권한·compatibility 검증                       |
| 5D 설정·범위     | global default, 숫자/자릿수 분리, ADMISSION/SCHEDULE 겹침·용량 규칙                  | 현재 ADMISSION 합집합 39/138 해소                          |
| 5E 할당·마감     | legacy 5건 보존, current projection + append-only history, reopen 이력 보존          | 구현, transaction·경합·복원 검증                           |
| 5F 출력·양식     | 기존 출력 3건 보존, candidate 기준 사진, immutable published template, tag 오류 계약 | 보존기간·expiry·alias 종료값 확정, 출력·양식 실검증        |

현재 **설계 승인과 schema expand 작성**은 진행할 수 있다. 운영 backfill, shadow read,
read/canonical cutover는 backup/restore와 [컷오버 게이트](../data-model-cutover-gates.md)의 단계별
증거를 충족하기 전까지 차단한다.
