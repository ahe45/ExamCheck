# MariaDB 통합 테스트

## 목적

단위 테스트가 재현하기 어려운 실제 InnoDB 행 잠금, 두 연결 간 대기 순서, 트랜잭션 rollback, 마이그레이션 실행을 로컬 MariaDB에서 검증한다. 기본 `npm test`와 분리해 일반 개발 검사는 DB 없이 실행한다.

## 실행

```bash
npm run check:integration
```

이 명령은 통합 테스트 코드 타입 검사 후 다음 시나리오를 실행한다.

- 빈 데이터베이스에 전체 migration `001`~`026` 적용
- 같은 migration을 다시 실행해 전체 SHA-256 체크섬 검증
- 합성 migration의 첫 DDL은 성공하고 후속 SQL은 실패하게 만들어, rollback되지 않은 컬럼과
  `schema_migration.status = 'FAILED'`가 함께 남으며 재실행이 dirty-state 오류로 차단되는지 검증
- 직전 N-1(`025`)까지만 구성한 DB에 기존 인쇄 작업을 넣고 latest(`026`) 적용 후 기존 행·nullable
  요청 지문을 보존하고 `audit_log.request_id`가 128자로 확장됐는지 확인하며 전체 migration 재실행
- 순차 가번호 부여 후 설정 재저장 시 일정별 cursor 보존
- 기존 할당을 범위 밖으로 만드는 설정 변경 거부와 rollback
- 실제 두 DB 연결에서 `등록 완료(마감)`과 가번호 부여가 경합할 때 마감 이후 부여 거부
- 가번호 부여가 설정 행을 잠근 동안 범위 변경이 대기하고, 최신 할당을 제외하는 변경은 rollback
- 마감이 운영 행을 잠근 동안 재개가 대기하고, 마감 commit 후 최신 상태를 읽어 정상 재개하며 양쪽 감사 이력 보존
- 서버 advisory lock을 다른 연결이 보유하면 동시 migration이 timeout되고, 해제 후 전체 체크섬 검증 성공
- `SCHEDULE` 정책에서 동일 수험번호와 가번호를 서로 다른 두 교시에 사용할 수 있고, 충돌이 남은 상태에서 `SYSTEM`/`ADMISSION`으로 축소하면 원문 번호 없이 저장 거부
- 019 이전 할당은 대응 일정이 정확히 하나일 때만 연결하고, 0개·복수 후보는 미매핑으로 보존하며 019 이후 할당은 재작성하지 않음
- 계정 비밀번호·권한·활성 상태와 개발자 비밀번호 변경 후 기존 session version 무효화
- 수험생 XLSX·사진 ZIP 업로드의 검증 실패 rollback, 업무 write·비식별 감사 로그 원자성, 마감·범위·번호 정책 재검증
- 인쇄 요청의 서버측 사전부여·라벨 정책 확인, 사용자별 멱등 키·요청 지문 충돌·만료·상태 CAS·감사 로그
- 설정 optimistic version 충돌과 워크스테이션 등록·감사 로그의 트랜잭션 원자성

정확한 파일·테스트 개수는 최종 병합 시 `npm run check:integration` 출력에서 기록한다. 각 파일은
고유한 nonce 데이터베이스를 만들며, 기본적으로 전체 `001`~`026` migration을 적용한다. upgrade
시나리오는 harness의 `migrateThrough`로 N-1까지만 구성한 뒤 같은 DB에 나머지 migration을
적용한다. 모든 시나리오는 자신이 만든 DB만 정리한다.

CI의 MariaDB 11.4 service에서도 `npm run check:integration`을 실행하도록
`.github/workflows/ci.yml`에 정의했다. 최초 기준 commit `83c43e5`의
[Quality Gate](https://github.com/ahe45/ExamCheck/actions/runs/33125056778)에서 integration 작업이
성공했으며, 이후 migration 변경 때마다 같은 원격 검증을 다시 통과해야 한다.

## 데이터 안전장치

- `.env`에서는 DB 호스트·포트·사용자·비밀번호만 읽는다.
- `.env`의 `DB_NAME`은 읽거나 사용하지 않는다.
- 데이터베이스 이름은 코드가 생성한 `examcheck_it_`와 32자리 UUID 조합만 허용한다.
- 생성 registry, 이름 정규식, 현재 pool의 `SELECT DATABASE()`, `INFORMATION_SCHEMA` 결과가 모두 일치해야 삭제할 수 있다.
- 테스트 준비나 검증이 실패해도 `finally` 경로에서 자신이 만든 데이터베이스만 정리한다.
- 삭제 후 `INFORMATION_SCHEMA`에서 잔존 여부를 다시 확인한다.

운영 데이터베이스의 테이블이나 행은 이 테스트에서 읽거나 수정하지 않는다.

## 현재 한계

- 로컬 MariaDB 접근 권한이 없는 환경에서는 별도 통합 검사가 실패한다.
- MySQL/MariaDB DDL은 암묵적으로 commit될 수 있으므로 migration 실패 복구를 transaction rollback만으로
  보장하지 않는다. 실행기는 `APPLYING`/`FAILED` 상태를 남기고 후속 실행을 차단하지만, 부분 DDL의
  forward repair 또는 전체 복원 판단은 운영 승인과 `docs/runbooks/migration.md` 절차가 필요하다.
- advisory lock은 같은 MariaDB 서버의 examcheck 마이그레이션을 의도적으로 직렬화한다. 서로 다른 테스트 DB도 같은 고정 잠금명을 사용하므로 동시에 migration하는 경우 대기할 수 있다.
- 번호 정책의 기본값은 수험번호 `SYSTEM`, 가번호 `ADMISSION`이며 개발자 설정에서 `SCHEDULE`로 변경할 수 있다. 이 검증은 RF-033/P0-4의 좁은 수직 슬라이스만 다루며 Phase 5 전체 데이터 모델 전환을 보장하지 않는다.
- 일정 identity는 현재 `candidate_record_id`와 결정적 scope key를 사용한다. 정확히 매핑할 수 없는 레거시 할당은 admission 범위로 계속 예약되며, 독립 `schedule/registration` 모델 전환은 후속 작업이다.
- CI의 빈 임시 DB는 운영 backup을 복원한 staging, 실제 데이터 분포, 운영 부하와 lock 시간을 대신하지 않는다.
- N-1 harness는 현재 저장소의 `025`→`026`만 검증한다. 실제 다음 배포의 N-1→N은 신규 migration
  추가 때 같은 방식으로 갱신해야 하며 익명화 운영 snapshot→N 검증을 대신하지 않는다.
- `identity-transition`의 정규화·dry-run·shadow 비교는 합성 순수 함수 테스트이며 이 MariaDB
  harness의 live data backfill 또는 shadow query에 연결되지 않았다.
