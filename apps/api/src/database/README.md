# 데이터베이스 실행 경계

## 명령

- `npm run db:setup`: 데이터베이스가 없으면 생성하고, 마이그레이션 후 누락된 초기 계정을 생성한다.
- `npm run db:migrate`: 데이터베이스가 없으면 생성하고 마이그레이션만 실행한다.
- `npm run db:bootstrap`: 이미 마이그레이션된 데이터베이스에서 누락된 초기 계정만 생성한다.
- `npm run db:backfill:identity`: 기존 행을 목표 identity 모델로 투영하는 격리 복원본 전용 backfill이다.
- `npm run db:verify:identity-shadow`: legacy/target source bridge를 같은 consistent snapshot에서 비교하는 격리 검증이다.
- `npm run db:transition:identity`: 증적·승인·단계 승격·비상 rollback을 rehearsal하는 격리 전용 transition CLI다.

`db:bootstrap`은 스키마를 생성하지 않는다. 신규 환경은 `db:setup`을 사용하거나 `db:migrate`를 먼저 실행해야 한다.

## Identity 전환 CLI의 격리 안전 경계

세 identity CLI는 운영 명령이 아니다. 모두 기존 DB에 연결하며 DB를 생성하지 않고, 다음 두 조건을
동시에 만족하지 않으면 연결 또는 변경을 거부한다.

1. `--confirm-isolated-copy`를 명시한다.
2. `DB_NAME`에 경계가 분명한 `it`, `test`, `shadow`, `sandbox`, `staging`, `refactor` 표식 중 하나가 있다.

DB 이름 표식은 실수 방지 장치일 뿐 승인이나 격리를 증명하지 않는다. 운영 DB 이름을 바꾸거나 복제본에
표식만 붙여 우회해서는 안 되며, 접근 통제·네트워크 격리·복제 승인·폐기 절차가 갖춰진 복원본에서만
사용한다. 현재 migration 기준은 `001`~`037`이고, 이 CLI의 합성/nonce MariaDB 성공은 운영 DB 적용,
backup/restore 완료 또는 read/write 승격 증거가 아니다.

API workspace에서의 기본 실행 형태는 다음과 같다.

```text
npm run db:backfill:identity -- --confirm-isolated-copy --exam-name="<승인된 시험명>" --chunk-size=100
npm run db:backfill:identity -- --confirm-isolated-copy --exam-name="<승인된 시험명>" --resume=<기존 run UUID>
npm run db:verify:identity-shadow -- --confirm-isolated-copy
npm run db:transition:identity -- <record-evidence|request|attach-evidence|approve|apply|rollback> --confirm-isolated-copy <필수 옵션>
```

- backfill은 advisory lock, source high-water mark와 entity checkpoint를 사용한다. 완료 보고가
  `SUCCEEDED`가 아니면 종료 코드 2이며, issue를 임의 수정하거나 새 run으로 숨기지 않는다.
- shadow verifier는 `IDENTITY_SHADOW_HMAC_SECRET`을 환경변수로 받아야 하며 최소 32 bytes여야 한다.
  secret을 CLI 인자나 로그에 쓰지 않는다. 후보자·사진·설정·범위·운영·배정·계정·인쇄 9종을
  HMAC 비교하고 `identity_shadow_observation`에는 집계만 추가한다. 사진 BLOB은 조회하지 않는다.
  mismatch가 하나라도 있으면 종료 코드 2다. 한 실행의 9종은 하나의 완료 batch와 동일한
  `identity_source_mutation_watermark.sequence`를 사용한다. 이 sequence는 allowlisted 업무 감사가
  같은 transaction으로 insert될 때 singleton row를 잠가 증가하며 `AUTH_*`와 observation 저장은
  제외된다. 따라서 clean batch 이후 업무 commit은 다음 승격 전에 재검증을 요구한다.
- transition CLI의 evidence와 승인은 격리 rehearsal DB 안에서만 유효하다. 서로 다른 승인자,
  유효 기간, 단계 순서, observation 임계치가 충족돼도 그것을 운영 승인으로 복사하지 않는다.
- backfill과 transition은 격리 DB를 변경하며, shadow verifier도 observation 행을 추가하므로 완전한
  read-only 명령은 아니다. 실행 전 복원 지점과 폐기 책임자를 확인한다.
- 운영 DB migration, backfill, evidence 등록 또는 승격은 현재 **No-Go**이며 별도 승인 절차 없이는
  실행하지 않는다.

## 마이그레이션 체크섬

`schema_migration.checksum`은 기존 데이터베이스와 호환되도록 nullable 컬럼으로 확장된다.

- 체크섬이 이미 기록된 적용 파일은 현재 SHA-256 값과 비교하며, 값이 다르면 후속 변경 전에 실행을 중단한다.
- `schema_migration`에 적용 이력이 있지만 migrations 디렉터리에서 원본 파일을 찾을 수 없는 경우에도 실행을 중단한다.
- 체크섬 도입 전에 적용되어 값이 `NULL`인 이력은 최초 실행 시 **현재 파일 내용을 신뢰 기준선으로 삼아 1회 기록**한다.
- 따라서 최초 기준선 기록은 과거에 파일이 수정되지 않았음을 증명하지 못한다. 기준선이 기록된 이후의 변경부터 확실하게 감지한다.
- 기존 `001`~`037` 마이그레이션은 수정하지 않고, 스키마 변경은 번호가 증가한 새 파일로 추가한다.

## 적용 상태와 dirty 차단

실행기는 업무 migration 번호를 추가하지 않고 내부 메타데이터인 `schema_migration.status`를
additive하게 확장한다. 기존 이력은 컬럼 기본값에 따라 `APPLIED`로 유지된다.

- 새 파일을 실행하기 전에 버전·체크섬과 `APPLYING` 상태를 먼저 기록한다.
- SQL과 메타데이터 전이가 모두 성공하면 `APPLIED`, 실패하면 rollback을 시도한 뒤 `FAILED`로
  전환한다.
- 프로세스 중단으로 `APPLYING`이 남거나 실패가 `FAILED`로 기록된 경우, 다음 실행은 체크섬 보정이나
  다른 migration을 시작하기 전에 즉시 차단된다.
- 메타데이터에는 버전, SHA-256 체크섬, 상태와 기존 `applied_at`만 저장한다. 실패 SQL, DB 오류
  원문, 입력값이나 자격증명은 저장하지 않는다.
- `APPLYING`/`FAILED` 행을 삭제하거나 임의로 `APPLIED`로 바꾸어 자동 재실행해서는 안 된다.
  승인된 forward repair 또는 전체 DB 복원은 `docs/runbooks/migration.md`를 따른다.

## 동시 실행 잠금

모든 마이그레이션 실행은 MariaDB/MySQL의 `GET_LOCK`으로 서버 단위 advisory lock을 획득한 뒤 시작한다. 잠금 이름은 `examcheck_schema_migration_v1`로 고정하며 CLI 기본 대기 시간은 30초다.

- 다른 `db:migrate` 또는 `db:setup`이 실행 중이면 최대 30초 대기한 뒤 명확한 오류로 중단한다.
- 잠금을 획득한 실행은 성공·검증 실패·SQL 실패 여부와 관계없이 `finally`에서 `RELEASE_LOCK`을 호출한다.
- 잠금 획득 전에 실패했거나 `GET_LOCK`이 0/NULL을 반환하면 마이그레이션 스키마를 변경하지 않는다.

## DDL 트랜잭션 제한

마이그레이션별로 트랜잭션 경계를 사용하지만 MySQL/MariaDB의 많은 DDL 문장은 암묵적으로 커밋되며
롤백되지 않을 수 있다. 실패 시 일부 DDL과 `FAILED` 메타데이터가 함께 남을 수 있으며, 이 상태는
의도적으로 자동 재실행되지 않는다. 다음 원칙을 따른다.

- 운영 반영 전에 백업과 스테이징 검증을 수행한다.
- 새 마이그레이션은 가능한 한 확장 방식과 재실행 가능한 단계로 작성한다.
- DDL과 데이터 변환이 복잡하면 여러 개의 작은 마이그레이션으로 분리한다.

## 실제 MariaDB 통합 검사

루트에서 `npm run check:integration`을 실행하면 integration 코드 타입 검사 후 임시 MariaDB에서
현재 `001`~`037` migration, `026`→`037` upgrade, identity backfill/shadow와 가번호 트랜잭션
경합을 검증한다. 일반 `npm test`는 DB에 연결하지 않는다.

통합 harness는 `.env`의 호스트·포트·계정만 사용하며 `DB_NAME`을 무시한다. 코드가 생성하고 registry에 기록한 `examcheck_it_<32자리 nonce>` 데이터베이스만 삭제할 수 있다. 자세한 안전장치와 현재 범위는 `docs/mariadb-integration-testing.md`를 참고한다.

## 초기 계정

초기 계정 bootstrap은 `admin`, `가번호`, `dev` 중 누락된 로그인 ID만 생성한다. 이미 존재하는 계정의 비밀번호 해시, 권한, 활성 상태는 변경하지 않는다. 운영 환경의 초기 비밀번호 검증도 실제로 누락된 계정에 대해서만 수행한다.

## 기본 문서 양식

`050_default_operation_form_templates.sql`은 2026-09-16 양식 관리에 저장된 **가번호 부여대장**, **결시자 명단**, **수험생 사진대장**을 기본 항목으로 추가한다. 문서 내용, 데이터태그의 표시 형식, 데이터 블록, 여백, 페이지 번호 등 저장된 편집 설정을 함께 포함한다. 기존 기본 양식인 가번호표와 수험생 확인표도 유지된다.

새 설치 시 `start-server.bat` 또는 `npm run db:setup`으로 자동 적용된다. 기존 서버에서는 같은 코드나 이름의 양식이 있으면 수정 내용과 활성 상태를 그대로 유지하며, 없는 양식만 추가한다. 마이그레이션은 한 번만 적용되므로 이후 사용자가 수정하거나 삭제한 기본 양식은 서버를 다시 시작해도 덮어쓰거나 복원하지 않는다.
