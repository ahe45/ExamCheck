# 데이터 모델 전환 Go/No-Go 게이트

> 기준 제안: [ADR 0002](./adr/0002-target-identity-model-proposal.md)  
> 작성일: 2026-08-28  
> 현재 상태: `001`~`026`은 로컬 적용·재실행 검증 완료. N-1(`025`)→latest(`026`) upgrade harness와
> 합성 입력용 정규화·dry-run·shadow 비교 도구는 준비했지만 목표 identity 모델의 schema/data 변경,
> live DB 진단, backfill, dual-write, read/write cutover는 수행하지 않음. 025는 인쇄 요청 지문,
> 026은 감사 request ID 폭만 보강해 둘 다 이 전환 범위에 포함되지 않음.

## 1. 목적과 적용 범위

이 문서는 수험생·일정·가번호 목표 모델을 expand, dual-write, backfill, shadow read, cutover하는 각 단계의 승인 조건과 즉시 중단 조건을 정의한다.

다음 작업에는 반드시 이 게이트를 적용한다.

- `exam_cycle`, `admission`, `operation_slot`, `schedule_segment` 도입
- `candidate`, `candidate_registration` 도입
- 사용자 전형 배정의 이름 → ID 전환
- 가번호 설정·범위·할당·마감의 ID 전환
- roster, 대시보드, 교시 선택, 출력·양식 projection 전환
- legacy write 중단과 기존 컬럼·테이블 제거

## 2. 현재 확인된 사실과 미확인 항목

### 2.1 재현 가능한 비식별 기준선

| 기준                                           |                                 현재값 |
| ---------------------------------------------- | -------------------------------------: |
| migration                                      | 로컬 적용·소스 모두 26개 (`001`–`026`) |
| 업로드 행 / candidate 후보                     |                              138 / 138 |
| admission / operation slot / segment 후보      |                              1 / 6 / 6 |
| exact registration 후보                        |                                    138 |
| 복수 일정 수험번호 그룹                        |                                      0 |
| 고립 활성 `examinee`                           |                                      8 |
| 할당 전체 / exact mapping / legacy 미매핑      |                             11 / 6 / 5 |
| 설정 / 범위 / 운영 상태                        |                              2 / 6 / 1 |
| segment 범위 합 / 범위 합집합 / 대상자         |                         138 / 39 / 138 |
| 겹치는 범위 쌍                                 |                                     15 |
| 사진                                           |                                      0 |
| print job / registration exact mapping         |                                  3 / 0 |
| 사용자 권한 계정 / implicit-all 계정 / 배정 행 |                              1 / 0 / 1 |

### 2.2 현재 알 수 없는 것

- 로컬 DB가 실제 운영 데이터의 완전한 복제인지 여부
- 운영 DB의 동일 집계값과 peak 규모
- 승인된 운영 복원본에 NFKC를 적용했을 때의 전형·교시·공간 이름 충돌 수
- `SYSTEM` 수험번호 범위가 DB 전체 수명인지 시험 주기인지
- 5개 레거시 할당과 8개 고립 `examinee`가 운영 이력인지 sample인지
- 기존 출력 작업 3건의 실제 업무 대상
- 현재 사용자 배정 1건이 `ALL` 의도인지 `ASSIGNED` 의도인지
- 운영 사진이 개인 단위인지 registration 단위인지
- backup 보관 위치, 보존 기간, 암호화·접근 정책, 복원 RTO/RPO
- 익명화 staging DB 제공 일정과 운영 규모 성능·lock 검증 환경

CI용 MariaDB 11.4 service, fresh 임시 DB 검증, N-1(`025`)→latest(`026`) upgrade 시나리오는
구성됐지만 운영 backup 복원본이나 익명화 staging을 대신하지 않는다. `identity-transition`의
순수 도구는 NFKC·trim·수험번호 선행 0 보존, exact/unmapped/ambiguous/conflict·범위 용량 분류,
salted HMAC projection 비교를 합성 fixture로 검증한다. DB나 API에 연결되지 않았으며 원문 PII를
보고서에 직렬화하지 않는다.

미확인 항목을 기본값으로 추정해 schema나 데이터를 변경하지 않는다.

## 3. 외부 결정 게이트

아래 항목은 업무 책임자, 개인정보/운영 책임자, 개발 책임자의 기록된 승인이 필요하다.

| ID   | 필요한 결정                 | 선택지 또는 결정 내용                                            | 승인 전 금지                                    |
| ---- | --------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| D-01 | 시험 주기 identity          | cycle code 원본, 표시 시험명 원본, 학년도와 시험기간             | `DEFAULT_EXAM_NAME`을 임의 cycle ID로 고정      |
| D-02 | 수험번호 `SYSTEM` 의미      | 모든 연도 DB 전체 또는 한 exam cycle                             | candidate claim scope 구현·정책 이름 변경       |
| D-03 | 동일 수험번호 인적 identity | 같은 cycle의 복수 교시는 동일인으로 간주, 이름/생년 충돌 처리    | 마지막 업로드 행으로 인적정보 자동 덮기         |
| D-04 | 전형 identity               | 외부 코드 도입 계획, 코드가 없을 때 이름 alias, 전형명 변경 절차 | 이름 변경을 신규 전형 또는 자동 merge로 처리    |
| D-05 | slot identity               | 교시 코드/이름 우선순위, 종료시간 포함 여부, timezone            | 문자열 조합을 무검증 surrogate mapping으로 사용 |
| D-06 | segment identity            | 모집단위·전공·건물·고사실 구성과 빈 값 규칙                      | 코드 공란을 임의 코드로 채우기                  |
| D-07 | 수험번호 정규화             | NFKC, 공백, 허용문자, 선행 0, 최대 길이                          | 정규화 충돌 보고 없이 unique 생성               |
| D-08 | 가번호 표시                 | canonical 숫자, 선행 0 자릿수, 전형/segment별 display width      | 문자열 `001`과 `1`을 다른 번호로 취급           |
| D-09 | 가번호 유일 범위            | `ADMISSION`/`SCHEDULE` 의미와 사전부여 포함 전체 경로 적용       | 개발자 설정과 claim unique 제약을 다르게 구현   |
| D-10 | 범위 겹침·용량              | 겹침 금지 또는 합집합 용량만 보장, 연속 배치 규칙                | 현재 39개 합집합으로 138명 canonical 운영 전환  |
| D-11 | 레거시 할당 5건             | 운영 이력 보존, 승인 mapping, sample 삭제                        | 자동 삭제·임의 registration 연결·번호 재사용    |
| D-12 | 고립 `examinee` 8건         | 운영 이력/호환 조회 보존, candidate 이관, sample 정리            | 자동 삭제 또는 첫 일정 생성                     |
| D-13 | 기존 출력 3건               | immutable legacy 보존, 외부 증거로 mapping, retention            | 수험번호 추정으로 신규 FK 채움                  |
| D-14 | 계정 전형 범위              | 현재 사용자별 `ALL`/`ASSIGNED`; 새 전형 추가 시 동작             | 배정 행 수만으로 목표 mode를 자동 추정          |
| D-15 | 사진 identity·보존          | candidate 공통 사진 또는 registration별 사진, 보존·파기·접근     | 동일 수험번호 사진 자동 병합                    |
| D-16 | 빈 전형 fallback 설정       | 전역 기본 유지, 전형별 복제, legacy 보존/제외                    | 첫 전형에 자동 연결                             |
| D-17 | 양식 lifecycle              | draft/publish/version/metadata 수정과 과거 버전 보존             | 현재 active 동작을 근거 없이 변경               |
| D-18 | 인쇄 재시도·보존            | expiry, 재출력 사유, retention, 실패 상태                        | 만료·재출력·폐기 정책을 코드 기본값으로 확정    |
| D-19 | 관찰 기준                   | 최소 운영 기간/처리 건수, mismatch·latency·error 기준            | 정량 기준 없는 read/canonical cutover           |

결정 기록에는 결정자, 일시, 적용 exam cycle, 예외 목록, 되돌림 조건을 포함한다.

| D-20 | 마감 해제 삭제 의미 | current projection 삭제, event/audit 보존 또는 법적 hard delete | 이력 보존 정책 없이 assignment event 삭제 |
| D-21 | 재부여 history | 한 현재값 + append-only events, 또는 별도 revision 모델 | 기존 assignment를 audit 없이 overwrite |
| D-22 | template projection 호환 | tag alias 기간, null fallback, 지원 종료 버전 | 신규 모델에 없는 tag를 조용히 빈 값으로 처리 |

## 4. Gate G0 — 설계 승인

### Go 조건

- ADR 0002의 계층과 ID 경계가 승인됨
- D-01~D-10의 identity·정규화·유일성·범위 결정 완료
- D-20·D-21의 assignment 이력 의미 결정 완료
- 관계별 natural key와 surrogate key가 표로 확정됨
- 개발자 메뉴의 두 유일 정책이 claim unique 제약과 같은 의미임을 리뷰함
- history 테이블에 cascade delete를 사용하지 않는 원칙 승인
- 역할별 API identity 계약과 compatibility 기간 승인

### No-Go

- 이름 문자열을 계속 FK로 사용하는 설계
- policy switch가 애플리케이션 사전 조회만 믿고 DB unique로 보호되지 않는 설계
- `ADMISSION` 정책에서 현재 범위 합집합 39개로 138명을 모두 부여할 수 없는 상태
- NFKC 규칙과 충돌 처리 없이 backfill key를 생성하는 설계

## 5. Gate G1 — 개인정보·백업·복원 준비

### 사전 승인

- 운영 DB 소유자와 개인정보 처리 책임자가 backup 복제 범위를 승인
- backup 위치가 명시되고 workspace, 개인 임시 폴더, 소스 저장소 밖에 있음
- 전송·보관 암호화, 접근자, key 관리, 보존 기간, 파기 절차가 문서화됨
- 사진 BLOB과 비밀번호 hash 포함 여부 및 masking 정책이 승인됨
- RPO, RTO, maintenance window가 확정됨

### 복원 리허설

1. MariaDB 11.4 호환 방식으로 일관된 snapshot을 생성한다.
2. 파일 크기와 SHA-256을 별도 기록한다. 경로와 secret은 로그에 남기지 않는다.
3. 네트워크가 격리된 별도 DB와 별도 계정으로 복원한다.
4. 스키마, migration checksum, 테이블별 비식별 count, FK·unique, 최근 audit 시각을 검증한다.
5. 애플리케이션 readiness와 핵심 read-only smoke를 수행한다.
6. 실제 소요 시간을 RTO와 비교한다.
7. 리허설 DB를 승인된 절차로 파기하고 파기 증거를 남긴다.

### No-Go

- 검증된 복원본 없이 backup 파일 생성만 완료한 상태
- 운영 DB 이름을 테스트 harness가 사용할 수 있는 상태
- 암호화 key와 backup이 같은 위치에 저장됨
- 누가 언제 복원할지 정해지지 않음
- 복원 후 aggregate가 기준선과 다르거나 migration checksum이 불일치

## 6. Gate G2 — schema expand 후보

### Go 조건

- 신규 migration은 기존 `001`~`026`을 수정하지 않음
- 직전 배포 migration에서 신규 migration으로 올리는 N-1→latest 시나리오가 있고 기존 행 보존,
  nullable/default 동작, 재실행을 검증
- nullable FK, 신규 테이블, 신규 인덱스만 추가하고 legacy write를 유지
- 대량 backfill SQL이 DDL migration에 포함되지 않음
- MariaDB DDL 암묵적 commit을 고려한 forward-repair 또는 restore 절차가 있음
- fresh DB, 현재 snapshot 복제 DB, 재실행 checksum 검증을 모두 통과
- 예상 index build 시간과 lock 영향이 maintenance window 안에 있음
- migration 파일과 manifest checksum이 review됨

### 현재 상태

`001`~`026` 현 모델 migration은 로컬 개발 DB와 fresh 임시 DB에서 적용·재실행·체크섬을
검증했다. `025_print_job_request_fingerprint.sql`은 출력 요청 안전성을, 026은 HTTP 계약과 맞춘
감사 request ID 폭을 보강하며 둘 다 목표 identity 모델 expand에 포함되지 않는다. **목표 모델용
expand migration(후속 027 이상)은 작성하거나 적용하지 않았다.** G0와 G1이 끝나기 전에는 목표
모델 expand를 시작하지 않는다.

## 7. Gate G3 — mapping dry-run과 dual-write

현재 저장소의 `identity-transition` 순수 함수는 이 단계의 보고서 schema와 분류·비식별 원칙을
합성 데이터로 먼저 고정한다. 승인된 복원 DB를 읽는 command, checkpoint, quarantine 저장소,
dual-write feature flag는 아직 없으므로 Gate G3를 통과한 상태가 아니다.

### dry-run 필수 출력

원문 대신 다음 집계만 출력한다.

- source/target 전체 수
- exact, unmapped, ambiguous, normalization-collision 수
- entity 종류와 비식별 source ID 범위
- 코드 공란 수, name-alias 사용 수
- policy scope별 unique conflict group 수
- 범위 합집합 용량과 대상 수
- 사용자 `ALL/ASSIGNED` mapping 수
- legacy exception 분류별 수

### dual-write Go 조건

- old/new write가 같은 DB transaction을 사용
- audit도 같은 transaction에 기록
- 한쪽 실패 시 양쪽 rollback 통합 테스트 통과
- idempotent retry와 duplicate-key 경합 테스트 통과
- policy/slot/range/registration lock order가 코드와 문서에 동일
- dual-write feature flag가 기본 OFF이고 즉시 rollback 가능
- old API/new API compatibility test 통과

### No-Go

- exact 1건이 아닌 mapping을 자동 선택
- PII 원문을 reconciliation log, metric label, audit details에 기록
- audit 실패를 무시하고 업무 write만 commit
- 사용자 요청 중 DDL 실행
- 서로 다른 transaction에 old/new write 수행

## 8. Gate G4 — backfill

### command 요구사항

- migration SQL과 별도인 재실행 가능한 job
- chunk 크기, last source ID, high-water mark, 시작·종료 시각, 성공·실패 수 저장
- 이미 exact mapping된 행은 동일 결과로 skip
- ambiguous/unmapped는 quarantine하고 계속 진행할지 승인된 정책을 따름
- SIGINT/프로세스 종료 후 checkpoint부터 안전하게 재개
- 부하 제한과 lock wait timeout 설정
- 원문 PII 없는 진행 로그

### 완료 조건

- `candidate_record` 138행이 exact registration 또는 승인된 예외로 분류
- mapped assignment 6건이 동일 registration과 값으로 연결
- legacy assignment 5건이 승인된 reservation 분류로 유지
- 고립 examinee 8건이 승인된 분류로 유지
- range 6건과 operation 1건의 exact mapping 확인
- print job 3건은 승인 없이는 legacy snapshot으로 남음
- high-water mark 이후 증분 reconciliation 완료

### No-Go

- checkpoint와 live write watermark가 불일치
- 같은 source가 둘 이상의 target ID에 연결
- unique 충돌을 무시하거나 임의 번호 변경
- backfill 중 운영 오류율·DB latency·replica lag가 승인 기준 초과

## 9. Gate G5 — shadow read

salted HMAC으로 두 projection의 count·digest·mismatch 분류만 비교하는 순수 도구와 합성 테스트는
있다. salt 저장·회전 정책, live old/new query adapter, metric/alert, 관찰 기간은 구현·승인되지
않았으므로 이는 shadow read 운영 증거가 아니다.

### 비교 방식

- 같은 transaction snapshot 또는 같은 high-water mark 기준
- 정렬과 표시 형식을 정규화한 뒤 row별 salted digest 비교
- roster 대상 수, 할당 수, 결시 수, 마감 상태, 범위 cursor, 권한 admission 집합 비교
- template tag key 집합과 값 digest 비교
- mismatch에는 entity 종류, 내부 ID, 분류 코드만 기록

### Go 조건

- exact 대상 mismatch 0
- 승인된 legacy exception만 남음
- 역할별 admin/developer/user API와 브라우저 smoke 통과
- HD·HD+에서 핵심 요소 가시성·가로 overflow 회귀가 없고 FHD/QHD에서 기능·가로/세로 overflow와
  반응형 확대 하한 회귀가 없음
- 신규 query의 `EXPLAIN ANALYZE`와 index row scan이 승인 기준 내
- D-19에서 정한 최소 관찰 기간 또는 처리 건수 충족
- D-22의 template tag alias·fallback 계약이 승인됨

### 즉시 중단

- 권한 밖 전형이 한 건이라도 노출됨
- 다른 slot의 assignment 또는 마감 상태가 표시됨
- 동일 요청 old/new 대상 수가 다름
- 가번호 unique 위반 또는 범위 밖 할당 발생
- 출력 snapshot이 다른 registration을 참조
- mismatch log에 PII 원문이 기록됨

## 10. Gate G6 — read cutover canary

### 순서

1. 개발자 계정의 진단 read
2. 관리자 dashboard/read-only 화면
3. 선택한 비운영 전형 또는 승인된 canary slot
4. 사용자 교시 선택과 roster
5. 설정·할당·마감의 read side
6. 출력 projection

각 단계는 독립 feature flag를 사용한다. 한 flag가 다른 단계까지 암묵적으로 활성화하지 않는다.

### rollback

- 신규 read flag OFF
- old read projection으로 즉시 복귀
- dual-write는 mismatch 원인에 따라 유지 또는 중단
- incident 시각과 high-water mark를 고정하고 재처리 금지 범위를 기록

DB expand는 rollback 시 삭제하지 않는다. 사용되지 않는 신규 테이블은 격리 상태로 두고 원인 분석 후 forward repair한다.

## 11. Gate G7 — canonical write 전환

이 단계는 Phase 11의 별도 승인 대상이다.

### Go 조건

- 모든 G0~G6 evidence가 보존됨
- 최소 관찰 기준 충족
- old/new Web/API 교차 호환 종료 계획 공지
- printer와 PDF 경로의 실제 운영 검수 완료
- backup/restore 리허설을 최신 schema로 다시 수행
- on-call 담당자, rollback 담당자, 의사결정자가 window 동안 대기

### 전환 원칙

- 신규 ID write를 canonical로 설정
- legacy write는 즉시 삭제하지 않고 compatibility 기간 동안 projection 또는 outbox로 유지
- 정책 변경, 할당, 마감, 출력에 대한 audit와 metric을 강화
- 승인 임계치 초과 시 read/write flag를 이전 상태로 복귀

## 12. Gate G8 — legacy contract와 삭제

다음 조건을 모두 만족하기 전에는 기존 테이블·컬럼·index를 drop하지 않는다.

- compatibility 사용량 0이 승인된 기간 동안 유지
- legacy API client 0 확인
- 모든 legacy exception의 보존·이관·삭제 결정 완료
- 법적·개인정보 보존 기간 충족
- contract migration 직전 backup과 복원 리허설 성공
- 삭제 대상 목록과 FK 영향이 review됨
- staging에서 contract + rollback rehearsal 성공

삭제는 별도 maintenance window와 별도 승인으로 실행한다. 자동 cleanup job에 포함하지 않는다.

## 13. 공통 즉시 No-Go 조건

다음 중 하나라도 발생하면 현재 단계를 중단하고 이전 안전 상태로 복귀한다.

- backup 또는 restore 검증 실패
- migration checksum 불일치 또는 dirty/부분 적용 상태
- old/new dual-write 일부 commit
- exact 대상 mismatch 1건 이상
- 승인되지 않은 ambiguous/unmapped 자동 연결
- 권한 범위 확대 또는 타 전형 데이터 노출
- 수험번호·이름·생년월일·사진·가번호 원문 로그 노출
- assignment/operation/audit/print history의 비의도 삭제
- DB unique와 개발자 메뉴 정책 의미 불일치
- `ADMISSION` 범위 합집합이 전체 부여 대상보다 작음
- lock wait, deadlock, API 오류율, latency가 승인 기준 초과
- old/new client compatibility 실패
- 실제 GT800/Browser Print 검증이 필요한 단계에서 실기기 증거 없음

## 14. 증거 패키지 체크리스트

각 Go/No-Go 회의에는 다음 자료를 하나의 변경 버전으로 묶는다.

- 승인된 ADR과 외부 결정표
- migration manifest와 checksum
- 익명화 fixture 생성·폐기 기록
- backup/restore 리허설 결과와 소요 시간
- mapping dry-run 집계
- backfill checkpoint와 reconciliation 결과
- shadow read mismatch 보고서
- query `EXPLAIN ANALYZE`와 부하 결과
- API contract, 단위·통합·E2E·브라우저 결과
- 역할별 권한 회귀 결과
- 프린터·PDF·template projection 검수 결과
- feature flag와 rollback 절차
- 변경 담당자, 승인자, window, on-call 연락 체계

## 15. 현재 결론

현재 다음 항목은 준비됐다.

- migration `001`~`026` 기반 현 모델 inventory와 로컬 적용·재실행·체크섬 검증
- N-1(`025`) 기존 행 보존 후 latest(`026`) 적용·재실행을 검증하는 MariaDB harness
- 현재→목표 entity/field mapping 제안
- 대체키·자연키·정규화·claim unique 설계 제안
- 비식별 로컬 집계와 기존 기준선 교차 확인
- NFKC·trim·선행 0 보존과 exact/unmapped/ambiguous/conflict·범위 용량을 분류하는 합성 dry-run 도구
- 원문 PII 없이 salted digest를 비교하는 합성 shadow projection 도구
- dual-write/backfill/shadow-read/cutover 순서
- 단계별 Go/No-Go와 rollback 조건
- `docs/runbooks/backup-restore.md`와 `docs/runbooks/migration.md` 절차서 초안

현재 다음 항목은 차단 상태다.

- backup 위치·개인정보 복제 정책·복원 리허설
- D-01~D-22 외부 결정
- 승인된 운영 복원본 또는 익명화 staging을 대상으로 한 실제 NFKC 충돌 진단
- 현재 `ADMISSION` 범위 용량 부족(합집합 39, 대상 138)
- 레거시 할당 5건, 고립 examinee 8건, 출력 작업 3건 처리 승인
- 사용자 `ALL/ASSIGNED` mode 승인
- 익명화 staging과 운영 규모 성능 검증

따라서 다음 안전 단계는 외부 결정을 기록하고 익명화 복원 환경에서 mapping dry-run을 재현하는
것이다. 그 전에는 목표 identity schema expand, backfill, read/write cutover를 진행하지 않는다.
