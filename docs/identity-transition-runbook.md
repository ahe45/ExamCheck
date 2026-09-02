# 목표 identity 모델 전환 운영 절차서

> 상태: 운영 초안 — 실제 운영 DB에서 실행하지 않음
>
> 작성일: 2026-08-28
>
> 기준: [ADR 0002](./adr/0002-target-identity-model-proposal.md),
> [결정 기록부](./data-model-decision-register.md),
> [전환 게이트](./data-model-cutover-gates.md)

## 1. 목적과 상태 표기

이 문서는 목표 identity 모델을 `expand → backfill → validate → shadow → canary → canonical`
순서로 전환할 때 운영자가 확인할 진입·중단·롤백 조건과 증거를 정의한다. 기존 모델을 즉시
삭제하거나 이름 문자열을 추정 연결하는 절차가 아니다.

상태 표기는 다음 의미로만 사용한다.

| 표기      | 의미                                                                          |
| --------- | ----------------------------------------------------------------------------- |
| 구현됨    | 저장소에 코드·DDL이 있고 합성 또는 로컬 테스트 근거가 있음                    |
| 검증 필요 | 구현 후보는 있으나 승인된 복원본, 운영 규모, 실제 요청 경로에서 증명하지 않음 |
| 미구현    | 운영에 필요한 command, adapter, metric, 승인된 상태 전환 경로가 아직 없음     |
| 차단      | 선행 조건을 만족하지 않아 다음 단계로 갈 수 없음                              |

`구현됨`은 운영 적용 승인을 뜻하지 않는다. 운영 DB에서 얻지 않은 로컬·합성 결과를 운영 증거로
표시하지 않는다.

## 2. 현재 기준선과 전환 상태

2026-08-28 기준 비식별 로컬 집계는 다음과 같다. 로컬 DB가 운영 DB의 완전한 복제라는 보장은 없다.

| 항목                                      |   현재 로컬 값 |
| ----------------------------------------- | -------------: |
| 업로드 행 / exact registration 후보       |      138 / 138 |
| admission / slot / segment 후보           |      1 / 6 / 6 |
| 가번호 할당 전체 / exact / legacy 미매핑  |     11 / 6 / 5 |
| 고립 활성 수험생                          |              8 |
| 기존 출력 / registration exact mapping    |          3 / 0 |
| segment 범위 용량 합 / 합집합 / 대상 인원 | 138 / 39 / 138 |
| 서로 겹치는 범위 쌍                       |             15 |

현재 저장소 상태는 다음처럼 해석한다.

| 구성요소                                       | 상태      | 운영 의미                                                                                            |
| ---------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| D-01~D-22와 ADR 0002                           | 구현됨    | 사용자에게 원칙 승인됨. 숫자로 된 보존·성능·관찰값은 별도 확정 필요                                  |
| NFKC·trim 정규화, dry-run 분류, salted 비교    | 구현됨    | 순수 함수와 합성 테스트 근거만 있음                                                                  |
| 목표 schema expand migration `027`~`037`       | 검증 필요 | fresh·재실행·`026`→`037` 로컬 MariaDB 검증 완료. 승인 복원본·운영 lock/성능 검증 필요                |
| 전환 상태·checkpoint·증적·승인·상태 이력 구조  | 구현됨    | 033~037과 로컬 MariaDB 제약 검증 완료. 운영 적용·증적 확보는 하지 않음                               |
| 격리 backfill command와 checkpoint 재개        | 검증 필요 | 격리 DB 전용 구현·synthetic MariaDB 검증. 운영 DB 실행은 CLI에서 차단                                |
| 주요 업무 write의 동일 transaction dual-write  | 검증 필요 | 후보자·사진·설정·범위·할당·마감·계정 경로에 구현. 전체 계약·운영 경합 증거 필요                      |
| live old/new shadow query adapter·metric·alert | 부분 구현 | 개발자 번호 정책 read의 same-transaction 비교·observation은 구현. 나머지 read와 운영 alert 증적 필요 |
| canary 대상 선택과 실제 read routing           | 부분 구현 | 개발자 번호 정책은 명시 사용자 canary를 MariaDB에서 검증. dashboard·roster·설정·운영·출력은 미연결   |
| canonical read/write와 legacy projection       | 부분 구현 | 주요 write와 개발자 정책 read 수직 경로만 존재. 전체 호환 write/read·rollback 경로는 미완성          |
| 증적·분리 승인 기반 단계 전환 CLI              | 구현됨    | 격리 DB만 허용. 운영 DB 이름은 거부하고 CANONICAL은 명시적 수동 확인 없이는 차단                     |

기본 안전 상태는 전환 기능 비활성화와 `write=LEGACY`, `read=LEGACY`다. 운영자가 DB의 상태 행을
직접 수정하지 않는다. 전환 CLI는 격리 복원본 검증 전용이며 운영 DB 실행 경로는 의도적으로
제공하지 않는다. 운영 control plane이 별도 승인되기 전에는 운영 phase를 변경하지 않는다.

## 3. 모든 단계에 적용하는 불변 규칙

- 기존 migration, legacy 컬럼·테이블·unique 제약을 수정하거나 삭제하지 않는다.
- exact 1건이 아닌 mapping은 선택하지 않고 `unmapped`, `ambiguous`, `conflict`로 격리한다.
- 레거시 할당 5건, 고립 수험생 8건, 기존 출력 3건은 추정·삭제·재번호 부여하지 않는다.
- 목표 모델의 수험번호 `SYSTEM` 범위는 `exam_cycle`이다.
- 가번호는 numeric canonical 값과 display width를 분리한다.
- `ADMISSION`은 전형 안의 범위 중복을 금지하고 union capacity가 전체 대상 수 이상이어야 한다.
- `SCHEDULE`은 서로 다른 slot 간 번호 재사용을 허용하지만 같은 slot 안의 범위는 겹칠 수 없다.
- old/new write와 audit는 하나의 DB transaction에서 모두 성공하거나 모두 rollback한다.
- assignment, operation event, audit, print snapshot history에 cascade delete를 사용하지 않는다.
- DDL 실패는 자동 rollback됐다고 간주하지 않는다. MariaDB implicit commit을 고려해 즉시 중단하고
  `FAILED` 근거를 보존한 뒤 forward repair 또는 검증된 restore 중 하나를 승인받는다.
- feature flag, 단계 상태와 application 배포 버전은 한 변경 기록에서 함께 관리한다.

## 4. 운영 DB 적용 전 필수 승인

다음 표의 `필수` 항목이 하나라도 비어 있으면 expand를 포함한 운영 DB 변경은 No-Go다.

| 분류        | 필수 승인·증거                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------- |
| 대상        | 정확한 DB/cluster, 환경, schema version, 배포 commit, migration manifest·SHA-256                |
| 개인정보    | DB 소유자와 개인정보 책임자의 복제 범위, 사진·비밀번호 hash masking 여부, 접근자 목록           |
| backup      | 저장 위치, 전송·보관 암호화, key 분리, 보존·파기 책임자, RPO/RTO, 복원 rehearsal 성공           |
| 실행 창     | maintenance window, 예상 DDL 시간·lock 영향, 최대 허용 부하, 중단 판단자와 rollback 담당자      |
| 운영 임계치 | error rate, latency, lock wait, deadlock, replica lag, 최소 관찰 기간·처리량의 숫자             |
| 데이터 진단 | 승인된 복원본의 NFKC 충돌, exact/unmapped/ambiguous, unique 충돌, 범위 겹침·union capacity 보고 |
| 예외        | legacy 5건·고립 8건·출력 3건이 승인된 legacy 분류와 정확히 일치한다는 검토                      |
| 비밀·관측   | shadow HMAC secret 저장·회전·접근 정책, PII가 없는 metric·log·alert schema                      |
| 호환성      | old Web/new API와 new Web/old API 계약, template tag alias 종료 조건                            |
| 출력        | canonical 출력 단계 전 PDF·Browser Print·GT800 실기기와 재시도·snapshot 검수                    |
| 최종 서명   | 단계, 실행자, 승인자, 일시, 근거 링크, 허용된 예외, 되돌림 기준                                 |

보존 기간, print expiry·최대 재시도, alias 지원 기간, 최소 shadow 관찰량과 성능 임계치는 원칙만
승인됐고 구체 숫자는 아직 확정되지 않았다. 관련 단계 진입 전에 실제 값을 기록한다.

## 5. 단계별 실행 절차

### 5.1 Expand

**현재 상태: 검증 필요.** 목표 테이블과 nullable bridge, 정책·이력·전환 제어용 DDL 후보가 있어도
운영 복원본과 운영 규모 검증 전에는 운영 준비 완료가 아니다.

진입 조건:

- 4절의 운영 DB 적용 전 필수 승인이 모두 기록됨
- backup 파일 생성뿐 아니라 격리 DB restore rehearsal과 비식별 aggregate 검증이 성공함
- fresh DB와 N-1에서 `027+`까지 적용, checksum, 재실행, 기존 행 보존 테스트가 성공함
- 운영 복원본에서 index build 시간, lock 영향, 저장공간 증가와 `EXPLAIN ANALYZE`가 승인값 이내임
- 서비스는 전환 기능 OFF, legacy read/write 상태임
- 신규 컬럼은 nullable 또는 안전한 default이고 legacy write가 계속 동작함

실행·증거:

1. 실행 대상과 migration checksum을 두 사람이 대조한다.
2. [migration 절차](./runbooks/migration.md)에 따라 한 번에 한 승인된 환경에서 expand를 적용한다.
3. migration 상태, schema·FK·unique·check 제약, 기존 테이블 count와 핵심 legacy read를 검증한다.
4. 애플리케이션은 legacy mode로 기동하고 readiness와 역할별 read-only smoke를 수행한다.
5. 시작·종료 시각, 적용 파일, 소요 시간, lock wait, 오류와 비식별 count를 증거에 남긴다.

즉시 중단:

- checksum 불일치, dirty/부분 적용, 예상하지 않은 table/column 변경
- 기존 행 count·checksum·핵심 read 불일치
- DDL 시간이 maintenance window 또는 승인 lock 임계치를 초과
- 애플리케이션이 legacy mode에서 기동·조회되지 않음

롤백:

- 전환 기능을 계속 OFF로 유지하고 legacy read/write만 사용한다.
- 신규 expand 객체를 즉시 drop하지 않는다. 부분 DDL 상태를 고정하고 추가 migration 실행을 막는다.
- 데이터 손상이 없으면 승인된 forward repair를, 손상 가능성이 있으면 검증된 backup restore를 사용한다.
- 원인과 마지막 성공 migration을 기록하고 새 승인 없이 재실행하지 않는다.

### 5.2 Backfill

**현재 상태: 검증 필요(운영 실행 차단).** 격리 DB 전용 command와 checkpoint 재개, chunk 처리,
주요 업무 write의 same-transaction dual-write는 합성 MariaDB와 단위 회귀로 검증됐다. 그러나 승인
복원본 규모·전체 업무 계약·운영 경합 검증이 끝나지 않았으므로 운영 backfill을 실행할 수 없다.

진입 조건:

- Expand 완료 증거와 최신 restore point가 있음
- old/new write와 audit를 같은 transaction에서 수행하는 dual-write가 통합·경합 테스트를 통과함
- backfill command가 chunk size, entity별 checkpoint, high-water mark, idempotent resume를 지원함
- 승인된 복원본 dry-run에서 exact·예외·충돌 집계가 재현됨
- `unmapped`, `ambiguous`, normalization/unique conflict를 자동 선택하지 않는 quarantine 경로가 있음
- 기본 OFF인 독립 feature flag와 즉시 legacy-only로 복귀하는 절차가 검증됨

실행·증거:

1. legacy read를 유지한 채 dual-write를 켜고 한쪽 실패 시 양쪽 rollback되는지 canary mutation으로 확인한다.
2. source high-water mark를 고정하고 entity 의존 순서에 따라 작은 chunk로 처리한다.
3. 각 chunk의 시작·종료 source ID, 처리·exact·skip·issue 수와 소요 시간을 checkpoint에 기록한다.
4. 이미 exact인 행은 같은 target ID인지 확인하고 idempotent skip한다.
5. high-water mark 이후 dual-written 행을 따라잡고 증분 reconciliation을 수행한다.
6. 완료 상태는 source 전체가 exact 또는 승인된 legacy exception으로 분류됐을 때만 기록한다.

필수 결과:

- `candidate_record` 138건이 exact registration 또는 승인된 예외로 분류됨
- exact assignment 6건은 같은 registration과 값으로 연결됨
- legacy assignment 5건은 예약 번호를 유지한 legacy history로 남음
- 고립 수험생 8건과 기존 출력 3건은 추정 FK 없이 legacy history로 남음
- range 6건과 operation 1건의 exact mapping이 확인됨

즉시 중단:

- 한 source가 둘 이상의 target에 연결되거나 같은 source의 재실행 결과가 달라짐
- dual-write 일부 commit, audit 누락, duplicate-key 처리 불일치
- checkpoint와 high-water mark가 불일치하거나 재개 결과가 최초 실행과 다름
- PII 원문이 log, report, issue details, metric label에 나타남
- DB 부하·오류·lock·replica lag가 승인 임계치를 초과

롤백:

- 새 write를 중단하고 승인된 상태 전환 command로 `LEGACY/LEGACY`, phase `BLOCKED`를 기록한다.
- backfill job을 중지하고 마지막 성공 checkpoint와 high-water mark를 보존한다.
- target 행을 자동 삭제하지 않는다. legacy read를 원본으로 유지하고 원인을 분석한다.
- legacy 데이터가 변형됐거나 partial commit 가능성이 있으면 복원 여부를 별도 승인받는다.

### 5.3 Validate와 reconciliation

**현재 상태: 합성 도구 구현됨, 실제 DB 검증 필요.** 로컬 fixture 결과는 운영 backfill 완료 증거가
아니다.

진입 조건:

- backfill run이 종료됐고 증분 catch-up 시점이 고정됨
- old/new를 같은 transaction snapshot 또는 같은 high-water mark로 읽을 수 있음
- 비교 salt가 승인된 secret 저장소에서 제공되고 report에는 포함되지 않음

검증 항목:

- cycle, admission, slot, segment, candidate, registration의 source/target count
- exact, unmapped, ambiguous, normalization conflict와 승인된 legacy exception
- 수험번호·가번호 claim unique, range 내부 값, cursor와 union capacity
- 사용자별 `ALL/ASSIGNED` admission ID 집합
- roster 대상·할당·결시·마감 상태와 template tag key/value projection
- assignment·operation event, audit, immutable print snapshot 보존

통과 조건:

- exact 대상 mismatch 0
- 승인된 legacy exception 외 open issue 0
- 권한 밖 admission 노출, 다른 slot 할당·마감, 다른 registration 출력 참조 0
- 모든 count·digest 보고서가 같은 high-water mark와 schema version을 가짐

중단·롤백:

- mismatch가 1건이라도 있으면 shadow/canary로 이동하지 않고 legacy read를 유지한다.
- 분류별 내부 ID와 비식별 digest만 남기고 target 수정은 별도 repair run으로 수행한다.
- repair 후 전체 validation을 새 run ID로 다시 실행한다. 기존 결과를 덮어쓰지 않는다.

### 5.4 Shadow read

**현재 상태: 격리 batch 구현·첫 live 수직 경로 연결.** 9종 old/new query adapter와 consistent-snapshot
HMAC 비교, aggregate observation 저장은 격리 MariaDB에서 검증됐다. 인증된 개발자 번호 정책 GET은
같은 transaction connection에서 legacy/target을 비교하고 현재 source high-water mark와 aggregate
observation을 기록한다. 나머지 업무 read, metric·alert와 운영 secret 회전은 구현·검증되지 않았다.

진입 조건:

- Validate 통과, dual-write 안정화, open issue 0
- live old/new adapter가 같은 요청 snapshot/high-water mark를 사용함
- HMAC secret이 최소 강도와 회전 정책을 충족하고 로그·DB 보고서에 저장되지 않음
- observation type별 alert와 자동 legacy-only 전환 또는 운영 중단 절차가 검증됨
- D-19의 최소 관찰 기간·처리량과 성능 임계치 숫자가 승인됨

실행 원칙:

- 사용자 응답은 계속 legacy projection으로 제공한다.
- new projection은 내부 비교에만 사용하고 raw row나 PII를 외부 관측 플랫폼으로 보내지 않는다.
- roster, 권한, 설정·범위, 할당·마감, 출력·template을 별도 observation type으로 비교한다.
- count, salted digest와 분류별 mismatch 수를 저장하고 phase별 누적과 최근 구간을 함께 본다.

즉시 중단:

- exact mismatch, old-only/new-only, ambiguous가 승인 예외 밖에서 1건 이상 발생
- 권한·교시·registration 오참조 또는 unique/range 위반
- shadow query가 승인 latency·DB 부하 임계치를 초과
- HMAC secret 또는 PII 원문 노출

롤백:

- shadow read flag를 OFF하고 legacy read/write를 유지한다.
- 실패 시점과 high-water mark를 고정하고 observation을 삭제하지 않는다.
- mismatch 원인에 따라 dual-write도 OFF할지 incident 승인자가 결정한다.

### 5.5 Canary read

**현재 상태: 첫 수직 경로 검증 완료/나머지 업무 read 미연결.** 개발자 번호 정책은 선택된 canary
사용자에게 target 값을 반환하고 비선택 사용자는 legacy 값을 유지하는 경계를 실제 MariaDB에서
검증했다. 관리자 dashboard, roster, 전형 설정, 운영, 출력의 read 분기는 아직 연결되지 않았다.

진입 조건:

- 승인된 기간·처리량 동안 shadow exact mismatch 0
- 역할별 API·브라우저·FHD/QHD 회귀와 old/new client 교차 호환 성공
- canary 사용자와 admission이 비운영 또는 승인된 저위험 범위로 명시됨
- 각 read 영역이 서로 독립적으로 켜지고 한 flag가 다른 영역을 암묵 활성화하지 않음
- 24시간 연락 가능한 중단 판단자와 즉시 legacy 복귀 경로가 있음

확대 순서:

1. 개발자 진단 read
2. 관리자 dashboard/read-only
3. 승인된 비운영 admission 또는 slot
4. 사용자 교시 선택과 roster
5. 설정·할당·마감 read
6. 출력 projection

각 단계에서 사용자 응답, shadow 결과, error·latency·lock 지표와 권한 집합을 확인한 뒤 다음 단계로
간다. write는 검증된 dual-write를 유지하고 canary 단계에서 canonical write로 바꾸지 않는다.

즉시 중단·롤백:

- old/new 대상 수 또는 값 mismatch, 권한 밖 노출, stale/다른 slot 데이터, 출력 오참조
- UI/API 계약 또는 printer/PDF 회귀
- 승인 임계치 초과
- 해당 read flag를 즉시 OFF하고 old read projection으로 복귀한다. expand schema는 제거하지 않는다.

### 5.6 Canonical read/write

**현재 상태: 차단·미구현.** 현재 기본 `ADMISSION` 정책에서 segment 범위 용량 합은 138이지만
합집합은 39뿐이고 138명을 대상으로 범위가 겹치는 쌍이 15개다. 승인된 D-10은 ADMISSION 범위
중복을 금지하고 union capacity 충족을 요구하므로 범위를 수정·재검증하기 전 canonical 전환은
금지된다.

추가 진입 조건:

- G0~G6의 모든 증거와 최신 schema backup/restore rehearsal이 보존됨
- 범위 중복 0, union capacity ≥ 대상 수, claim unique 충돌 0
- 승인된 기간·처리량 동안 shadow와 canary exact mismatch 0
- canonical repository와 legacy compatibility projection/outbox가 모든 mutation에서 통합 검증됨
- old/new client 종료 계획, template alias 기간과 실제 사용량이 확인됨
- PDF·Browser Print·GT800 실기기 검수 완료
- window 동안 실행자, on-call, rollback 담당자와 최종 승인자가 대기

전환 순서:

1. 모든 write를 멈추지 않아도 되는지 마지막 high-water mark reconciliation으로 확인한다.
2. 승인된 작은 범위에서 canonical read를 먼저 사용하고 legacy projection 비교를 계속한다.
3. canonical write를 켜되 legacy compatibility write/projection은 승인 기간 동안 유지한다.
4. 정책 변경, 할당, 마감, reopen, 출력의 audit와 mismatch·unique metric을 강화한다.
5. 승인 관찰 기간이 끝날 때까지 legacy schema와 restore 경로를 유지한다.

즉시 중단:

- exact mismatch 1건 이상 또는 승인되지 않은 exception
- unique/range 위반, 일부 write commit, audit 누락
- 권한 범위 확대, 다른 registration/slot 참조, 출력 snapshot 오염
- backup/restore 불능, 성능·오류 임계치 초과

롤백:

- canonical read/write flag를 이전 승인 상태로 되돌리고 legacy projection으로 복귀한다.
- incident high-water mark를 고정하고 중복 재처리를 막는다.
- expand schema와 target history는 삭제하지 않는다. 원인 수정은 forward repair로 수행한다.
- legacy write가 이미 종료됐거나 호환 projection이 불완전하면 자동 복귀하지 말고 서비스 write를
  차단한 뒤 restore 또는 repair를 승인받는다.

legacy 컬럼·테이블 drop은 canonical 전환의 일부가 아니다. compatibility 사용량 0, 법적 보존기간,
최신 restore rehearsal과 별도 maintenance 승인을 모두 충족한 뒤 G8 contract 단계에서만 수행한다.

## 6. 단계 전환과 공통 중단 기준

권장 상태 조합은 다음과 같다. backfill은 legacy read/write 상태에서 수행하고 성공·open issue 0을
확인한 뒤에만 DUAL로 승격한다. 이는 상태 저장 구조의 의미이며 운영 DB 직접 수정 지시가 아니다.

| 단계          | write mode  | read mode   | phase 예시    | 다음 단계 필수 근거                        |
| ------------- | ----------- | ----------- | ------------- | ------------------------------------------ |
| expand 완료   | `LEGACY`    | `LEGACY`    | `EXPANDED`    | restore·schema·legacy smoke                |
| backfill      | `LEGACY`    | `LEGACY`    | `BACKFILLING` | checkpoint·증분 reconciliation             |
| validate 완료 | `LEGACY`    | `LEGACY`    | `BACKFILLED`  | 성공 run·open blocking issue 0             |
| dual-write    | `DUAL`      | `LEGACY`    | `BACKFILLED`  | target write 계약·backup·rollback 증적     |
| shadow        | `DUAL`      | `SHADOW`    | `SHADOWING`   | target read/write 계약 증적                |
| canary        | `DUAL`      | `CANARY`    | `CANARY`      | 비교 entity 처리량·기간·불일치 0           |
| canonical     | `CANONICAL` | `CANONICAL` | `CANONICAL`   | canary 검수·수동 확인·G7 최종 분리 승인    |
| 중단          | `LEGACY`    | `LEGACY`    | `BLOCKED`     | actor·reason 상태 이력, incident 전체 검증 |

### 6.1 034~037 승격 게이트

각 승격 요청은 `expected state version`, reason code, 최대 rollback 분, 그리고 CANARY/CANONICAL이면
최소 비교 entity 처리량과 최소 관찰 분을 명시한다. 처리량은 observation 레코드 개수가 아니라
`SUM(match + mismatch + old-only + new-only + ambiguous)`다. 이 기준은 전체 합계 한 번이 아니라 아래
9개 observation type **각각**에 적용한다.

1. `identity-shadow.system-profile.v1`
2. `identity-shadow.candidate.v1`
3. `identity-shadow.candidate-photo.v1`
4. `identity-shadow.pseudonym-setting.v1`
5. `identity-shadow.pseudonym-range.v1`
6. `identity-shadow.operation.v1`
7. `identity-shadow.assignment.v1`
8. `identity-shadow.account-scope.v1`
9. `identity-shadow.print-snapshot.v1`

| 목표        | 필수 연결 증적                                                                                                     | 필수 분리 승인                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `DUAL`      | backup/restore, rollback rehearsal, `TARGET_WRITE_CONTRACT_READY`                                                  | operations, data owner                           |
| `SHADOW`    | 위 증적 + `TARGET_READ_CONTRACT_READY`                                                                             | operations, data owner                           |
| `CANARY`    | backup/rollback, target read/write 계약, 성공 backfill, open issue 0, mismatch·one-sided·ambiguous 0, allowlist 1+ | operations, data owner, privacy                  |
| `CANONICAL` | 위 증적 + canary validation, legacy compatibility, 명시적 수동 확인                                                | operations, data owner, privacy, canonical owner |

- evidence recorder와 verifier는 달라야 하며, 요청자와 각 필수 승인자도 서로 분리한다.
- `observed_at`이 미래이거나 `valid_until`이 지난 증적은 사용하지 않는다.
- target read 계약 증적은 후보자·설정·운영·계정·출력 adapter와 계약 테스트 전체를 대표해야 한다.
- phase 진입 이후 9개 type마다 표본이 1개 이상 있어야 하고, 각 type의 최초~최종 표본 기간과 비교
  entity 처리량이 요청 임계치를 각각 충족해야 한다. 한 type의 대량 표본으로 다른 type의 누락이나
  부족을 보충할 수 없다.
- 각 type의 mismatch, old-only, new-only, ambiguous가 하나라도 있으면 CANARY/CANONICAL을 차단한다.
- 승격에 사용하는 최신 관찰은 9개 type이 모두 들어 있는 하나의 `COMPLETED` batch여야 한다.
  각 observation의 source watermark는 요청 시점의 `identity_source_mutation_watermark.sequence`와
  모두 같아야 하며, 마지막 clean batch 후 하나의 승인 대상 mutation이라도 commit되면 재검증 전에
  승격하지 않는다.
- 036의 `audit_log` trigger는 shadow 대상 identity·print·workstation 업무 이벤트 allowlist에 대해서만
  singleton sequence를 같은 transaction 안에서 증가시킨다. singleton row lock이 동시 commit을
  직렬화하므로 단순 `MAX(audit_log.id)`에서 발생할 수 있는 out-of-order commit 누락을 허용하지 않는다.
  인증 `AUTH_*` 감사와 shadow observation 저장은 sequence를 증가시키지 않는다. verifier는 consistent
  snapshot 안에서 sequence를 한 번 읽고 9개 observation에 같은 값을 기록한다.
- 이 watermark는 9개 domain의 변경 경로가 업무 변경과 allowlisted 감사를 같은 transaction에 기록한다는
  계약을 전제로 한다. 감사 매트릭스·application transaction 테스트와 DB trigger/application allowlist
  일치 및 MariaDB 동시성 테스트를 증거로 유지하며, audit 없는 변경 경로가 발견되면 즉시 No-Go다.
- 모든 승격 직전에 candidate-registration cycle/slot, policy-admission cycle,
  range-policy-segment admission, assignment-registration-operation slot, candidate/pseudonym claim scope,
  print registration/assignment/slot 관계를 aggregate count로 다시 계산한다. 필수 집계가 누락되거나
  count가 0이 아니면 fail-closed다.
- 모든 승격 직전에 현재 active admission/slot의 range를 다시 읽어 `ADMISSION`은 admission 전체,
  `SCHEDULE`은 slot별로 overlap pair와 union capacity/deficit을 계산한다. 겹침이나 deficit이 있으면
  이전 backfill 보고서가 성공했더라도 승격하지 않는다.
- 범위 재계산에는 전형별 `ADMISSION` override를 우선하고 override가 없을 때 같은 cycle의 `DEFAULT`만
  적용한다. 범위 기반인 `DRAW`·`SEQUENTIAL`만 계산하며 `MATCHING`·`PREASSIGNED`를 빈 범위로 오인해
  차단하지 않는다.
- 이 승격 직전 검사는 고정 invariant/issue code와 aggregate count만 판정에 사용한다. 후보자·수험번호·
  가번호·사진·출력 payload 또는 개별 위반 행을 반환하거나 상태 이력에 저장하지 않는다.
- CANONICAL은 자동 승격할 수 없고 CLI의 별도 수동 확인과 네 종류 승인이 모두 필요하다.
- 비상 `LEGACY` 복귀는 사고 대응을 막지 않도록 actor와 안전한 reason code만으로 항상 허용하고
  append-only history를 남긴다. 비상 `DUAL` 복귀는 유효한 target write 계약과 성공 backfill을 요구한다.

CLI는 `npm run db:transition:identity -w @examcheck/api -- <command>` 형식으로 실행하되
`--confirm-isolated-copy`와 이름에 `it/test/shadow/sandbox/staging/refactor` 경계가 있는 DB만 허용한다.
운영 DB 우회 옵션은 없으며, 증적 기록→요청→증적 연결→분리 승인→적용 순으로 사용한다.

단계와 무관하게 다음은 즉시 No-Go다.

- backup/restore 검증 실패 또는 migration checksum·dirty 상태 이상
- old/new 일부 commit, audit 누락, exact mismatch 1건 이상
- ambiguous/unmapped 자동 연결이나 history 삭제
- 권한 밖 데이터, 다른 slot/registration 참조
- 수험번호·이름·생년월일·사진·가번호 원문 노출
- DB unique와 개발자 메뉴 정책 의미 불일치
- `ADMISSION` 범위 중복 또는 union capacity 부족
- 승인된 오류·latency·lock·replica lag 임계치 초과

## 7. PII 없는 보고 규칙

### 허용 필드

- report schema version, run/observation ID, environment 식별자와 배포 commit
- source high-water mark, 내부 numeric source/target ID 또는 비가역 salted digest
- entity/observation type과 고정된 issue code
- total, exact, skipped, unmapped, ambiguous, conflict, old-only, new-only, mismatch count
- observation type별 sample 수·비교 entity 수·최초/최종 시각과 고정 relationship invariant별 위반 count
- range capacity sum, union capacity, 대상 수, deficit, 중복 pair count
- 시작·종료 시각, duration, chunk size, latency percentile, lock wait·deadlock·error 집계
- 승인자, 실행자, rollback 판단자와 감사 request ID

### 금지 필드

- 수험번호, 가번호, 이름, 생년월일, 전화번호 등 원문 또는 일부 마스킹 원문
- 사진·문서·출력 payload, template에 렌더링된 개인정보
- HMAC salt/secret, 비밀번호 hash, DB credential, backup 경로·암호화 key
- PII를 포함할 수 있는 raw SQL parameter, exception 원문, row JSON
- PII 또는 고카디널리티 ID를 metric label·alert 제목·외부 trace attribute로 사용

`details_json` 같은 범용 필드에는 allowlist schema를 적용한다. 자유 형식 객체나 DB 오류 원문을
저장하지 않는다. digest는 목적·버전 구분자를 포함한 HMAC으로 만들고 환경별 secret을 사용한다.
secret 없는 일반 SHA-256만으로 낮은 엔트로피 번호를 가명처리했다고 간주하지 않는다.

보고서는 최소 다음 형태의 집계만 포함한다.

```json
{
  "schemaVersion": 1,
  "runId": "uuid",
  "entityType": "candidate_registration",
  "sourceHighWaterMark": 0,
  "counts": {
    "source": 0,
    "target": 0,
    "exact": 0,
    "unmapped": 0,
    "ambiguous": 0,
    "conflict": 0,
    "mismatch": 0
  }
}
```

예시의 값은 형식 설명용이며 운영 수치를 나타내지 않는다.

## 8. 단계별 증거 패키지

각 단계의 Go/No-Go 회의에는 다음 자료를 같은 release/run ID로 묶는다.

- 승인된 ADR·결정 revision과 이 절차서 version
- 배포 commit, migration manifest·checksum, feature flag·상태 version
- backup/restore rehearsal 결과, 소요 시간과 aggregate 검증
- mapping dry-run, backfill checkpoint, issue·reconciliation 보고서
- shadow/canary observation과 mismatch 0 증거
- MariaDB query plan, 부하·lock·deadlock·replica lag 결과
- API contract, 단위·통합·E2E·브라우저·역할별 권한 결과
- template/PDF/Browser Print/GT800 검수 결과
- 실행자·승인자·window·on-call·rollback 담당자와 실제 판단

승인 문구는 `단계`, `대상 환경`, `release/run ID`, `예외`, `진입 가능 여부`를 명시한다. 단순히
“테스트 통과” 또는 “문제 없음”으로 기록하지 않는다.

## 9. 현재 결론과 다음 안전 단계

현재 가능한 것은 목표 schema 후보와 backfill·shadow·canary 코드의 비운영 구현 및 fresh/합성
테스트다. 운영 DB 적용, live backfill, shadow, canary와 canonical 전환을 완료했다고 표현할 수 없다.

다음 안전 단계는 순서대로 다음과 같다.

1. 개인정보 backup 위치·보존·파기·접근·RPO/RTO를 확정하고 격리 restore rehearsal을 완료한다.
2. `027`~`037` expand를 승인된 복원본에서 재검증하고 운영 lock·성능 근거를 수집한다.
3. 격리 DB backfill 결과를 재현하고 same-transaction dual-write의 전체 업무 계약을 완료한다.
4. 실제 old/new query adapter, observation·metric·alert와 독립 canary routing을 구현·검증한다.
5. 현재 `ADMISSION` 범위 중복 15쌍을 제거하고 union capacity를 39에서 대상 138 이상으로 확보한다.
6. 보존기간·expiry·관찰량·성능 임계치 숫자와 출력 실기기 검수를 완료한 뒤 단계별 승인을 받는다.

5번이 해결되고 모든 선행 게이트가 통과되기 전까지 canonical read/write는 명시적으로 **차단**한다.
