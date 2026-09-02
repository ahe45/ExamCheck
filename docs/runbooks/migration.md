# 데이터베이스 마이그레이션·전환 실행서

> 상태: 안전 절차 템플릿  
> 현재 코드 기준: migration `001`–`037`
> 운영 적용 상태: 미승인·미실행 (`027`–`037`은 로컬/합성 MariaDB 검증만 완료)

## 1. 원칙

- 적용된 migration 파일은 수정하지 않고 새 번호의 forward migration만 추가한다.
- schema expand와 데이터 backfill을 분리한다.
- 애플리케이션 요청 처리 중 DDL이나 전체 backfill을 실행하지 않는다.
- expand 단계에서는 기존 Web/API와 호환되는 nullable column, 신규 table, index, 기본 OFF feature flag만 추가한다.
- rollback은 무조건 drop이 아니다. expand 산출물은 비활성 상태로 두고 feature flag 복귀와 forward repair를 우선한다.
- ambiguous/unmapped 행을 자동 선택하거나 원문 개인정보를 로그에 남기지 않는다.

## 2. 진입 조건

다음 항목이 모두 충족되어야 목표 identity migration을 작성·적용할 수 있다.

1. `docs/data-model-decision-register.md`의 D-01~D-22 승인 revision과 적용 범위가 확인됨
2. `docs/adr/0002-target-identity-model-proposal.md`의 Accepted revision이 확인됨
3. `docs/runbooks/backup-restore.md` 리허설이 최신 schema에서 성공함
4. 익명화 staging 또는 승인된 격리 복원 환경이 준비됨
5. migration `001`~`037` checksum과 기존 기준(`026`)→latest(`037`) 테스트가 통과하고,
   `schema_migration.status <> 'APPLIED'`인 이력이 없음
6. 현재 데이터의 exact/unmapped/ambiguous, 범위 용량, 권한 mode 집계가 보존됨
7. 작업 창, 중단 임계치, 담당자와 rollback 의사결정자가 정해짐

충족되지 않은 항목이 있으면 현재 모델의 테스트·문서·순수 진단 도구만 개선할 수 있다.

2026-08-28 현재 D-01–D-22와 ADR 원칙은 승인됐고, `027`–`037`의 fresh·재실행·`026`→`037`
합성 MariaDB 검증은 통과했다. 그러나 승인 복원본, 운영 lock·성능, backup/restore, live dual-write와
target read/write 전체 계약 증적은 아직 검증하지 않았다. 또한 현재 비식별 진단에서 ADMISSION 범위
중복과 union capacity 부족이 남아 있으므로 운영 backfill·CANARY·CANONICAL은 No-Go다.

## 3. 단계별 실행

### G0 — 결정과 책임

- 변경 ID, 버전, 작업 창, 승인자, on-call을 기록한다.
- 지원할 old/new Web·API·DB 조합을 확정한다.
- legacy 할당·고립 수험생·기존 출력 작업의 처리 정책을 기록한다.

### G1 — 백업·복원

- 최신 운영 snapshot을 승인된 격리 환경에 복원한다.
- RPO/RTO와 schema/비식별 데이터 집계를 검증한다.
- 실패하면 이후 단계를 실행하지 않는다.

### G2 — schema expand

- 목표 identity schema expand와 전환 통제·불변성 후보는 `027`~`037`이며, 이후 변경은 새 번호의 forward
  migration만 사용한다.
- 신규 FK는 backfill 전에 nullable로 추가하고 기존 쓰기를 깨지 않게 한다.
- 신규 unique는 dry-run 충돌 0 또는 승인된 quarantine 이후에만 활성화한다.
- migration manifest에 크기·SHA-256·선행/후행 조건을 기록한다.
- fresh 적용, 재실행, N-1→N, checksum 변조 차단을 검증한다.
- 각 신규 migration은 SQL 실행 전에 `APPLYING`, 성공 후 `APPLIED`, 실패 후 `FAILED`로 기록된다.
  `APPLYING` 또는 `FAILED`가 한 건이라도 있으면 이후 실행은 자동으로 중단한다.

### G3 — dry-run·dual-write

- dry-run은 원문 대신 내부 숫자 ID, 건수, 분류 코드만 출력한다.
- old/new 쓰기는 하나의 DB transaction과 공통 lock order를 사용한다.
- feature flag 기본값은 OFF다.
- 한쪽 write나 audit가 실패하면 전체 rollback한다.
- duplicate-key 경합, deadlock/lock timeout, idempotent retry를 실제 MariaDB 두 연결에서 검증한다.

### G4 — backfill

- `db:backfill:identity`는 격리 복원본 전용 command이며 운영 DB 이름을 거부한다. 운영 control
  plane 승인 전에는 우회 옵션을 추가하지 않는다.
- 재실행 가능한 별도 command/job으로 실행한다.
- checkpoint에는 last source ID, high-water mark, 처리/성공/실패/격리 건수만 저장한다.
- chunk 크기와 대기 시간을 조절할 수 있게 하고 lock wait와 DB latency를 관찰한다.
- exact 1건만 반영하며 ambiguous/unmapped는 승인된 quarantine에 남긴다.
- 중단 후 같은 checkpoint에서 중복 없이 재개되는지 검증한다.

### G5 — shadow read

- 같은 snapshot/high-water mark에서 old/new 결과를 비교한다.
- 정렬·표시를 canonical 형식으로 변환한 뒤 16바이트 이상 비밀 salt를 사용한 HMAC-SHA256 digest로 비교한다.
- mismatch 보고서에는 entity 종류, 내부 ID, 분류 코드만 기록한다.
- 권한 밖 전형 노출, 다른 교시 혼입, 가번호 충돌은 한 건이라도 즉시 중단한다.
- system-profile, candidate, candidate-photo, pseudonym-setting, pseudonym-range, operation, assignment,
  account-scope, print-snapshot의 고정 9개 observation type을 같은 phase window에서 모두 생성한다.

### G6 — read canary

- 개발자 진단 → 관리자 read-only → 비운영 전형/교시 → 사용자 roster → 설정/할당/마감 read → 출력 projection 순으로 독립 flag를 켠다.
- 각 단계의 오류율, latency, row count, mismatch와 권한 노출을 확인한다.
- 중단 시 해당 flag만 OFF하고 old read로 복귀한다.
- 승격 요청에는 observation 행 수가 아니라
  `SUM(match + mismatch + old-only + new-only + ambiguous)`로 계산한 최소 비교 entity 처리량과 최소
  관찰 시간을 명시한다.
- 표본 존재, 최소 비교 entity 처리량, 최초~최종 표본 기간, mismatch/old-only/new-only/ambiguous 0을
  9개 type별로 각각 확인한다. type 누락이나 한 type만의 충분한 표본은 No-Go다.
- `identity_canary_user` 또는 `identity_canary_admission` 대상이 최소 1개 없으면 승격하지 않는다.

### G7 — canonical write

- 승인된 관찰 기간 또는 처리 건수 동안 mismatch 0이어야 한다.
- 최신 backup/restore 리허설과 실제 프린터·PDF 검수가 완료되어야 한다.
- 신규 write를 canonical로 전환하되 compatibility projection은 승인 기간 동안 유지한다.
- 임계치 초과 시 read/write flag를 이전 상태로 복귀하고 high-water mark를 고정한다.
- `TARGET_READ_CONTRACT_READY`, `TARGET_WRITE_CONTRACT_READY`, canary validation, legacy compatibility와
  operations/data owner/privacy/canonical owner의 분리 승인이 모두 있어야 한다.
- CANONICAL은 자동 승격하지 않는다. 요청마다 명시적인 수동 확인을 기록한다.

### G7.1 — `034` 전환 command 안전 경계

`db:transition:identity`는 증적 기록 → 요청 생성 → 증적 연결 → 분리 승인 → 적용 순서를 강제한다.
증적 `observed_at`이 미래이거나 유효기간이 끝났으면 승격에 사용하지 않는다. 운영 DB 실행은
제공하지 않으며 `--confirm-isolated-copy`와 격리 목적이 드러나는 DB 이름을 함께 요구한다.

각 승격은 상태 행을 잠근 transaction 안에서 target 관계 invariant와 현재 range를 다시 검증한다.
candidate-registration cycle/slot, policy/admission cycle, range policy/segment admission,
assignment registration/operation slot, candidate·pseudonym claim scope, print registration/assignment/slot의
고정 집계가 모두 0이어야 한다. 이어서 `ADMISSION` admission 전체 또는 `SCHEDULE` slot별 범위 중복과
union capacity deficit을 재계산한다. 보고·오류에는 고정 코드와 count만 사용하고 후보자·번호·사진·출력
원문은 포함하지 않는다.

비상 `LEGACY` 복귀는 사고 대응을 지연시키지 않도록 actor와 안전한 reason code, 잠근 상태 갱신과
append-only 이력만 필수다. backup/rollback/compatibility 증적 부족으로 이를 차단하지 않는다. 비상
`DUAL` 복귀는 target write 계약이 유효하고 마지막 backfill이 성공했으며 open issue가 0일 때만 허용한다.

### G8 — contract

- legacy 사용량 0, 이전 binary 배포 불가, 보존 정책 충족, 최신 복원 리허설 성공 후 별도 승인한다.
- column/table/index 제거는 작은 migration으로 나누고 각 단계 뒤 무결성·API·브라우저 검사를 수행한다.
- 일반 정리 작업이나 자동 cleanup에 포함하지 않는다.

## 4. dirty migration 대응과 복구

### 4.1 감지와 즉시 조치

실행기가 `Dirty migration state detected`로 중단되면 같은 명령을 반복하지 않는다. 승인된 DB
관리 채널에서 다음 비식별 조회로 상태만 확인한다.

```sql
SELECT version, checksum, status, applied_at
FROM schema_migration
WHERE status <> 'APPLIED'
ORDER BY version;
```

1. 애플리케이션 배포와 모든 migration 실행을 중지하고 변경 ID와 DB 별칭을 기록한다.
2. 해당 버전의 원본 SQL 파일과 manifest SHA-256이 일치하는지 확인한다.
3. `INFORMATION_SCHEMA`와 migration별 postcondition으로 부분 적용된 table/column/index/constraint만
   식별한다. 수험번호, 성명, 가번호 등 원문 행 값은 증거에 복사하지 않는다.
4. `APPLYING`은 프로세스 중단으로 결과를 알 수 없는 상태, `FAILED`는 실행기가 실패를 확인한
   상태로 취급한다. 둘 다 자동 재실행 금지 상태다.
5. `schema_migration` 행 삭제, checksum 덮어쓰기, 검증 전 `APPLIED` 변경은 금지한다. 메타데이터만
   지워도 암묵적으로 commit된 DDL은 복구되지 않는다.

실행기는 실패 SQL, DB 오류 원문이나 입력값을 `schema_migration`에 저장하지 않는다. 조사 기록에도
SQL의 값 literal, 연결 문자열, 비밀번호와 개인정보를 남기지 않는다.

### 4.2 forward repair 경로

부분 적용 상태를 원래 migration의 최종 postcondition으로 안전하게 완성할 수 있을 때만 선택한다.

1. dirty DB의 승인된 snapshot을 격리 환경에 복원해 동일 상태를 재현한다.
2. 적용된 DDL과 아직 적용되지 않은 단계를 구분하고, 원본 migration 파일은 수정하지 않은 채 누락된
   단계만 수행하는 별도 검토 SQL과 검증 쿼리를 작성한다.
3. 격리 환경에서 repair를 두 번 검증하고 schema, constraint, 비식별 row count, 애플리케이션
   read-only smoke가 모두 기대값인지 확인한다.
4. 운영 승인과 동료 검토 후 작업 창에서 repair를 적용한다. 원래 migration의 **전체** postcondition과
   manifest checksum이 확인된 뒤에만 아래 상태 전이를 수행하며, 영향 행이 정확히 1건이어야 한다.

```sql
UPDATE schema_migration
SET status = 'APPLIED'
WHERE version = ?
  AND checksum = ?
  AND status IN ('APPLYING', 'FAILED');
```

5. `npm run db:migrate`를 다시 실행해 기존 전 버전 checksum 검증과 후속 migration 적용을 수행한다.
6. repair 전후 schema diff, 비식별 검증값, 실행자·검토자·승인자와 결과를 같은 변경 ID에 연결한다.

repair SQL 자체를 새 업무 migration처럼 번호만 올려 우회해서는 안 된다. dirty 차단을 먼저 해소하지
않으면 실행기는 후속 파일을 실행하지 않으며, 원래 postcondition을 입증할 수 없다면 복원 경로를
선택한다.

### 4.3 전체 복원 경로

부분 상태의 안전한 완성을 증명할 수 없거나 DDL 제거가 데이터 손실을 유발할 수 있으면 실패 시점
이전의 일관된 전체 DB 백업을 복원한다.

1. `docs/runbooks/backup-restore.md`의 승인·암호화·격리 복원 절차를 따른다.
2. `schema_migration` 테이블만 되돌리지 않고 schema와 데이터를 같은 snapshot으로 복원한다.
3. 복원 DB에서 dirty 행 0건, manifest checksum 일치, schema·constraint·비식별 집계 일치를 확인한다.
4. readiness와 역할별 read-only smoke 후 변경 책임자가 재시도 또는 배포 철회를 결정한다.
5. 승인된 보관·파기 정책에 따라 실패 DB snapshot과 조사 산출물을 처리한다.

백업·복원 리허설이 없거나 snapshot 시점·무결성을 확인할 수 없으면 No-Go를 유지한다.

## 5. 공통 중단 조건

- migration checksum 불일치 또는 부분 적용 상태
- backup/restore 검증 실패
- dual-write 일부 commit 또는 audit 누락
- exact 대상 old/new mismatch 1건 이상
- 권한 범위 확대나 다른 전형·교시 데이터 노출
- 가번호 범위 부족, 겹침, unique 위반
- 승인하지 않은 legacy 행 변경·삭제
- PII 원문이 로그·metric·audit·보고서에 포함됨
- lock wait, deadlock, API 오류율, latency가 승인 임계치를 넘음

## 6. 배치 기록 양식

| 항목                                    | 값   |
| --------------------------------------- | ---- |
| 변경 ID / release                       | 미정 |
| migration 범위와 checksum               | 미정 |
| 적용 환경·DB 별칭                       | 미정 |
| high-water mark                         | 미정 |
| feature flag 초기/최종 상태             | 미정 |
| source / exact / ambiguous / unmapped   | 미정 |
| shadow match / mismatch                 | 미정 |
| lock wait / deadlock / 오류율 / latency | 미정 |
| 실행자 / 검토자 / 승인자                | 미정 |
| 시작 / 종료 시각                        | 미정 |
| rollback 또는 forward repair 결과       | 미정 |
| 최종 Go/No-Go                           | 미정 |

모든 증거는 원문 개인정보와 비밀값을 제거한 뒤 같은 변경 ID로 연결한다.
