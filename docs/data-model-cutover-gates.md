# 데이터 모델 전환 Go/No-Go 게이트

> 기준 제안: [ADR 0002](./adr/0002-target-identity-model-proposal.md)  
> 작성일: 2026-08-28  
> 현재 상태: D-01–D-22 원칙과 ADR 0002는 사용자에게 2026-08-28 승인됐고, migration
> `027`–`037`과 격리 backfill·shadow·transition 도구는 소스 및 nonce MariaDB에서 검증됨.
> backup/restore, 운영 DB 적용, 운영 backfill, 실제 traffic dual-write/shadow, read/write 승격은
> 아직 게이트를 통과하지 않았으며 계속 No-Go다. 보존기간·관찰량·성능 임계치의 구체 숫자는
> 운영 전환 전에 별도 확정한다.

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

| 기준                                           |                                                       현재값 |
| ---------------------------------------------- | -----------------------------------------------------------: |
| migration                                      | 진단 기준 DB `001`–`026`; 현재 소스·격리 harness `001`–`037` |
| 업로드 행 / candidate 후보                     |                                                    138 / 138 |
| admission / operation slot / segment 후보      |                                                    1 / 6 / 6 |
| exact registration 후보                        |                                                          138 |
| 복수 일정 수험번호 그룹                        |                                                            0 |
| 고립 활성 `examinee`                           |                                                            8 |
| 할당 전체 / exact mapping / legacy 미매핑      |                                                   11 / 6 / 5 |
| 설정 / 범위 / 운영 상태                        |                                                    2 / 6 / 1 |
| segment 범위 합 / 범위 합집합 / 대상자         |                                               138 / 39 / 138 |
| 겹치는 범위 쌍                                 |                                                           15 |
| 사진                                           |                                                            0 |
| print job / registration exact mapping         |                                                        3 / 0 |
| 사용자 권한 계정 / implicit-all 계정 / 배정 행 |                                                    1 / 0 / 1 |

### 2.2 현재 알 수 없는 것

- 로컬 DB가 실제 운영 데이터의 완전한 복제인지 여부
- 운영 DB의 동일 집계값과 peak 규모
- 승인된 운영 복원본에 NFKC를 적용했을 때의 전형·교시·공간 이름 충돌 수
- backup 보관 위치, 보존 기간, 암호화·접근 정책, 복원 RTO/RPO
- 사진·출력 이력의 보존·파기 기간, 인쇄 expiry·최대 재시도
- shadow 관찰 기간·처리량, latency·오류율·lock 임계치
- 익명화 staging DB 제공 일정과 운영 규모 성능·lock 검증 환경

CI용 MariaDB 11.4 service, `001`~`037` fresh·재실행, `026`→`037` 기존 행 보존 upgrade가
구성됐다. 격리 backfill과 consistent-snapshot shadow verifier도 nonce MariaDB 합성 fixture에
연결해 검증했다. verifier는 후보자·사진·설정·범위·운영·배정·계정·인쇄를 source bridge로
비교하고, 사진 BLOB은 조회/HMAC 입력에서 제외하며 HMAC으로 얻은 분류 집계만
`identity_shadow_observation`에 기록한다. 이 결과는 운영 backup 복원본이나 익명화 staging,
운영 traffic을 대신하지 않는다.

미확인 운영값을 코드 기본값으로 추정하거나 운영 DB 적용·cutover 조건으로 사용하지 않는다.

## 3. 외부 결정 게이트

사용자가 2026-08-28 D-01~D-22 권장안을 목표 모델 범위로 승인했다. 상세 결정·예외는
[결정 기록부 revision 2](./data-model-decision-register.md)에 있다. 실행 게이트에 직접 영향을 주는
결정은 다음과 같다.

- 계층은 `exam_cycle → admission → operation_slot → schedule_segment`이고 candidate와
  registration을 분리한다. `SYSTEM`은 exam cycle 범위다.
- 수험번호는 NFKC·trim 후 선행 0을 보존한다. 가번호는 numeric canonical 값과 display width를
  분리한다.
- `ADMISSION`은 전형 내 범위 중복을 금지하고 union capacity를 충족해야 한다. `SCHEDULE`은 다른
  slot 간 재사용을 허용하되 같은 slot 안에서는 중복을 금지한다.
- 레거시 할당 5건, 고립 수험생 8건, 출력 3건은 추정·삭제하지 않고 legacy history로 보존한다.
- 계정 scope는 명시적 `ALL/ASSIGNED`, 사진은 candidate 기준, 빈 전형 설정은 global default다.
- published template과 과거 출력 snapshot은 immutable이고, reopen·재부여는 current projection과
  append-only history를 분리한다. 필수 template 값 누락은 오류다.
- exact old/new mismatch가 0일 때만 cutover할 수 있다.

보존 기간, expiry, 관찰 기간·처리량과 성능 임계치는 **원칙 승인/세부 운영값 별도 확정**이다.
값이 정해지기 전에는 관련 운영 게이트를 통과한 것으로 보지 않는다.

## 4. Gate G0 — 설계 승인

### Go 조건

- ADR 0002의 계층과 ID 경계가 승인됨
- D-01~D-10의 identity·정규화·유일성·범위 결정 완료
- D-20·D-21의 assignment 이력 의미 결정 완료
- 관계별 natural key와 surrogate key가 표로 확정됨
- 개발자 메뉴의 두 유일 정책이 claim unique 제약과 같은 의미임을 리뷰함
- history 테이블에 cascade delete를 사용하지 않는 원칙 승인
- 역할별 API identity 계약과 compatibility 기간 승인

### 현재 판정

설계 원칙과 schema expand 작성은 **Go**다. compatibility 종료 기간의 숫자와 운영 증거는 후속
게이트 항목으로 남는다. 현재 39/138 범위 부족은 schema 작성을 막지 않지만 운영 backfill과
canonical cutover를 막는다.

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

- 신규 migration은 기존 `001`~`037`을 수정하지 않음
- 직전 배포 migration에서 신규 migration으로 올리는 N-1→latest 시나리오가 있고 기존 행 보존,
  nullable/default 동작, 재실행을 검증
- nullable FK, 신규 테이블, 신규 인덱스만 추가하고 legacy write를 유지
- 대량 backfill SQL이 DDL migration에 포함되지 않음
- MariaDB DDL 암묵적 commit을 고려한 forward-repair 또는 restore 절차가 있음
- fresh DB, 현재 snapshot 복제 DB, 재실행 checksum 검증을 모두 통과
- 예상 index build 시간과 lock 영향이 maintenance window 안에 있음
- migration 파일과 manifest checksum이 review됨

### 현재 상태

`027`–`032` 목표 identity expand, 033 transition/backfill/shadow control, 034 증적·분리 승인·
상태 이력, 035 재출력 이력, 036 완결 shadow batch, 037 발행 양식·이력·출력 snapshot 불변
trigger가 작성됐다. `001`–`037` fresh 적용·재실행·체크섬과 기존 `026` 행을 보존하는
`026`→`037` upgrade를 nonce MariaDB에서 검증했다. 이는 **schema 후보의 합성·격리
증거**다. 승인된 backup 복원, 실제 데이터 분포, index build 시간·lock 영향과 운영
`schema_migration` 적용 이력은 확인하지 않았으므로 운영 schema 적용에 대한 G2 판정은 No-Go다.

## 7. Gate G3 — mapping dry-run과 dual-write

현재 저장소에는 정규화·dry-run 외에 DB transition state, legacy/dual/canonical write
coordinator, legacy/shadow/canary/canonical read router, user/admission canary allowlist, 권한
교집합 fail-closed helper가 있다. 격리 backfill은 checkpoint·high-water mark·issue 분류를
저장하고 일부 업무 write의 target projection hook도 같은 transaction 경계에 연결됐다. 다만
승인된 복원 DB의 전체 dry-run, 모든 업무 write의 dual rollback·경합 증거, 운영 feature flag
rehearsal과 old/new API compatibility 증거는 없으므로 Gate G3는 통과하지 않았다.

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

현재 `db:backfill:identity`는 `--confirm-isolated-copy`와 격리 DB 이름을 강제하고 advisory lock,
source high-water mark, entity별 checkpoint, PII 없는 issue, `--resume` 재개 경계를 제공한다.
합성 MariaDB fixture에서 exact projection, legacy reservation, immutable print snapshot과 재실행을
검증했다. 승인된 복원본의 138개 candidate/예외 집계, 중단 복구 rehearsal와 운영 부하 증거는
없으므로 이는 G4 완료 증거가 아니다.

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
- print job 3건은 승인된 결정에 따라 immutable legacy snapshot으로 남음
- high-water mark 이후 증분 reconciliation 완료

### No-Go

- checkpoint와 live write watermark가 불일치
- 같은 source가 둘 이상의 target ID에 연결
- unique 충돌을 무시하거나 임의 번호 변경
- backfill 중 운영 오류율·DB latency·replica lag가 승인 기준 초과

## 9. Gate G5 — shadow read

격리 `db:verify:identity-shadow`는 한 `REPEATABLE READ` consistent snapshot에서 9개 source-bridge
projection을 HMAC 비교하고 match/mismatch/old-only/new-only/ambiguous 집계만 저장한다. 후보자
사진은 file name·MIME·content hash만 비교하고 BLOB은 읽지 않는다. 재실행, target hash 변조,
print snapshot 누락, cleanup 복합 오류 보존을 단위·nonce MariaDB에서 검증했다. read router의
SHADOW/CANARY 경계도 구현됐지만 HMAC key 회전, 운영 query 성능, metric/alert, 승인 관찰 기간과
실제 traffic 증거는 없으므로 Gate G5는 통과하지 않았다.

036은 한 consistent snapshot의 9개 관찰을 하나의 `COMPLETED` batch로 묶고, 모두 같은
`identity_source_mutation_watermark.sequence`를 기록한다. 이 sequence는 승인된 identity·print·
workstation mutation 감사가 `audit_log`에 같은 transaction으로 들어올 때 singleton row를 잠가
증가한다. 이 직렬화는 동시 transaction의 audit ID와 commit 순서가 어긋나도 누락을 막는다.
`AUTH_*` 로그인 감사와 observation 저장은 sequence를 바꾸지 않으며, verifier와 gate는 같은 값을
비교한다. 업무 변경+감사 원자성 계약, trigger/application allowlist 일치, 동시 commit blocking은
테스트 증거로 유지한다. 이 계약 밖의 직접 DB 변경이나 audit 누락은 즉시 No-Go다.

### 비교 방식

- 같은 transaction snapshot 또는 같은 high-water mark 기준
- 정렬과 표시 형식을 정규화한 뒤 row별 salted digest 비교
- roster 대상 수, 할당 수, 결시 수, 마감 상태, 범위 cursor, 권한 admission 집합 비교
- template tag key 집합과 값 digest 비교
- mismatch에는 entity 종류, 내부 ID, 분류 코드만 기록

### Go 조건

- system-profile, candidate, candidate-photo, pseudonym-setting, pseudonym-range, operation, assignment,
  account-scope, print-snapshot 9개 type 각각에서 phase 진입 이후 표본이 존재함
- 9개 type 각각의 비교 entity 처리량과 최초~최종 표본 기간이 승인 임계치를 충족함
- 9개 type 각각에서 mismatch/old-only/new-only/ambiguous 0
- 승인된 legacy exception만 남음
- 역할별 admin/developer/user API와 브라우저 smoke 통과
- HD·HD+에서 핵심 요소 가시성·가로 overflow 회귀가 없고 FHD/QHD에서 기능·가로/세로 overflow와
  반응형 확대 하한 회귀가 없음
- 신규 query의 `EXPLAIN ANALYZE`와 index row scan이 승인 기준 내
- D-19에서 정한 최소 관찰 기간 또는 처리 건수 충족
- D-22의 template tag alias·fallback 계약이 승인됨
- candidate-registration cycle/slot, policy-admission cycle, range-policy-segment admission,
  assignment-registration-operation slot, claim scope/key, print registration/assignment/slot 불일치 집계 0
- 승격 직전 재계산한 `ADMISSION` admission 전체 또는 `SCHEDULE` slot별 range overlap 0과 union
  capacity deficit 0
- range 재계산은 전형 `ADMISSION` override 우선, 없으면 같은 cycle `DEFAULT`를 사용하고
  `DRAW`·`SEQUENTIAL` 방식에만 적용함. `MATCHING`·`PREASSIGNED`는 범위 용량 게이트 대상이 아님
- 승격 게이트 산출물은 고정 invariant/issue code와 aggregate count만 포함하며 개별 위반 행이나 PII
  원문을 반환·저장하지 않음

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
- 고정 9개 observation type 각각의 최소 관찰 기준 충족
- target 관계 invariant와 현재 range overlap/union capacity 재검증 통과
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
- 고정 observation type 누락 또는 type별 표본·기간·비교 처리량 부족
- 최신 완료 batch의 9개 watermark 불일치, 마지막 clean batch 뒤 allowlisted source mutation commit,
  업무 변경과 audit의 원자성 계약 이탈
- target 관계 invariant 집계 누락·불일치 또는 현재 range overlap/union capacity deficit
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

- migration `001`–`026` 기반 현 모델 inventory와 migration `001`–`037` source/checksum 기준선
- `001`–`037` fresh·재실행 및 기존 `026` 행 보존 후 `027`–`037`을 적용하는 MariaDB harness
- 현재→목표 entity/field source bridge와 expand schema
- 대체키·자연키·정규화·claim unique 설계 제안
- 비식별 로컬 집계와 기존 기준선 교차 확인
- NFKC·trim·선행 0 보존과 exact/unmapped/ambiguous/conflict·범위 용량을 분류하는 dry-run 기반
- 격리 backfill CLI와 checkpoint·issue·legacy reservation
- 원문 PII 없이 9개 projection을 비교하는 격리 consistent-snapshot shadow verifier
- 분리 승인·증적·단계 순서를 강제하는 격리 transition CLI와 append-only 상태 이력 schema
- dual-write/backfill/shadow-read/cutover 순서
- 단계별 Go/No-Go와 rollback 조건
- `docs/runbooks/backup-restore.md`와 `docs/runbooks/migration.md` 절차서 초안

현재 다음 항목은 차단 상태다.

- backup 위치·개인정보 복제 정책·복원 리허설
- 승인된 운영 복원본 또는 익명화 staging을 대상으로 한 실제 NFKC 충돌 진단
- 현재 `ADMISSION` 범위 용량 부족(합집합 39, 대상 138)
- 개인정보·출력 보존 기간, expiry와 재시도 한도 확정
- 관찰 기간·처리량, latency·오류율·lock 임계치 확정
- 익명화 staging과 운영 규모 성능 검증

따라서 schema expand 소스와 비운영 rehearsal 도구는 준비됐지만, 다음 운영 준비 단계는 여전히
backup/restore 게이트를 통과하고 승인된 익명화 복원 환경에서 `026`→`037`, mapping/backfill,
shadow 비교를 재현하는 것이다. 그 전에는 운영 migration 적용, backfill, transition evidence
등록·승격과 read/write cutover를 진행하지 않는다.
