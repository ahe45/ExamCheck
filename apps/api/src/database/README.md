# 데이터베이스 실행 경계

## 명령

- `npm run db:setup`: 데이터베이스가 없으면 생성하고, 마이그레이션 후 누락된 초기 계정을 생성한다.
- `npm run db:migrate`: 데이터베이스가 없으면 생성하고 마이그레이션만 실행한다.
- `npm run db:bootstrap`: 이미 마이그레이션된 데이터베이스에서 누락된 초기 계정만 생성한다.

`db:bootstrap`은 스키마를 생성하지 않는다. 신규 환경은 `db:setup`을 사용하거나 `db:migrate`를 먼저 실행해야 한다.

## 마이그레이션 체크섬

`schema_migration.checksum`은 기존 데이터베이스와 호환되도록 nullable 컬럼으로 확장된다.

- 체크섬이 이미 기록된 적용 파일은 현재 SHA-256 값과 비교하며, 값이 다르면 후속 변경 전에 실행을 중단한다.
- `schema_migration`에 적용 이력이 있지만 migrations 디렉터리에서 원본 파일을 찾을 수 없는 경우에도 실행을 중단한다.
- 체크섬 도입 전에 적용되어 값이 `NULL`인 이력은 최초 실행 시 **현재 파일 내용을 신뢰 기준선으로 삼아 1회 기록**한다.
- 따라서 최초 기준선 기록은 과거에 파일이 수정되지 않았음을 증명하지 못한다. 기준선이 기록된 이후의 변경부터 확실하게 감지한다.
- 기존 `001`~`018` 마이그레이션은 수정하지 않고, 스키마 변경은 번호가 증가한 새 파일로 추가한다.

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

루트에서 `npm run check:integration`을 실행하면 integration 코드 타입 검사 후 임시 MariaDB에서 전체 migration과 가번호 트랜잭션 경합을 검증한다. 일반 `npm test`는 DB에 연결하지 않는다.

통합 harness는 `.env`의 호스트·포트·계정만 사용하며 `DB_NAME`을 무시한다. 코드가 생성하고 registry에 기록한 `examcheck_it_<32자리 nonce>` 데이터베이스만 삭제할 수 있다. 자세한 안전장치와 현재 범위는 `docs/mariadb-integration-testing.md`를 참고한다.

## 초기 계정

초기 계정 bootstrap은 `admin`, `가번호`, `dev` 중 누락된 로그인 ID만 생성한다. 이미 존재하는 계정의 비밀번호 해시, 권한, 활성 상태는 변경하지 않는다. 운영 환경의 초기 비밀번호 검증도 실제로 누락된 계정에 대해서만 수행한다.
