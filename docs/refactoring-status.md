# 리팩토링 진행 현황

> 갱신일: 2026-08-28  
> 기준 계획: `REFACTORING_PLAN.md` 0.2

## 실행 배치와 현재 상태

| 작업                                     | 상태                         | 확인 근거                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-001 Git 추적·제외 목록 감사           | 완료                         | `.env`, `setup/`, IDE 설정, 임시 산출물, build cache 제외. staged 456개·53.5MB, 100MiB 초과 및 고신뢰 비밀키·토큰 패턴 없음 확인                                                                                                                                                                     |
| RF-002 레거시 자산 격리                  | 부분 완료                    | `docs/legacy-inventory.md`, 대표 자산 SHA-256, Authenticode 서명 상태, `setup/` ignore를 기록했다. 원본 출처 증빙·재배포 권한·개인정보 포함 여부가 승인되지 않았으므로 완료로 보지 않음                                                                                                              |
| RF-003 DB backup/restore rehearsal       | 대기                         | 개인정보 복제 정책과 격리 복원 위치 확정 필요                                                                                                                                                                                                                                                        |
| RF-004 실행 기준선 수집                  | 로컬 기준선 완료             | Node/npm/build/DB inventory와 핵심 관리자·사용자 화면 FHD/QHD 수동 검수 완료. `npm run metrics:baseline`으로 소스·테스트·CSS·migration·build asset 크기를 재현 가능하게 수집. 승인된 screenshot/API golden fixture는 계속 필요                                                                       |
| RF-005 기준 commit/tag                   | 완료                         | 최초 commit `83c43e5`, 태그 `refactor-baseline-2026-08-28`을 공개 `origin/master`에 게시                                                                                                                                                                                                             |
| RF-010 MariaDB 통합 테스트 harness       | 로컬·원격 검증 완료          | 운영 `DB_NAME`을 사용하지 않는 nonce DB 생성·전체 migration·삭제 안전장치와 잔존 0건 확인. 기준 commit의 GitHub Actions MariaDB 11.4 integration 성공                                                                                                                                                |
| RF-011 Nest HTTP E2E 최소 harness        | 완료                         | 임시 포트에서 실제 Controller/AuthGuard/RolesGuard와 path/query/body DTO 경계를 검증. 공통 오류·request ID·CORS뿐 아니라 수험생 업로드, 가번호 부여/설정, 양식 저장, 출력 작업의 역할별 201/200/401/403/400 업무 경계를 확인. DB 트랜잭션은 MariaDB integration 범위로 분리                          |
| RF-012 안전한 초기 계정 seed             | 완료                         | 기존 계정은 덮어쓰지 않고 누락된 계정만 생성, 결정적 단위 테스트 추가                                                                                                                                                                                                                                |
| RF-013 개발자 계정 보호                  | 완료                         | 일반 계정 API의 DEVELOPER 수정·삭제 차단 및 역할 회귀 테스트                                                                                                                                                                                                                                         |
| RF-014 인증·운영 보안 기준               | 코드 완료                    | 운영 JWT·초기 계정 기본 비밀번호 fail-fast, async scrypt, 계정 변경 시 session 무효화, CORS allowlist, 보안 헤더, 로그인 제한, 공통 오류·request ID 적용. 운영 proxy와 다중 인스턴스 공유 제한기는 배포 환경 검증 필요                                                                               |
| RF-015 운영 경합 잠금 검증               | 통합 검증 완료               | 서로 다른 실제 MariaDB connection에서 close→assign, assign→settings, close→reopen의 대기·최신 상태 재확인·rollback·감사 이력 검증                                                                                                                                                                    |
| RF-016 settings cursor·범위 검증         | 통합 검증 완료               | 실제 DB에서 cursor 보존과 기존 할당을 제외하는 범위 변경 rollback 검증                                                                                                                                                                                                                               |
| RF-020 정적 품질 기준                    | 로컬 검증 완료               | Prettier·ESLint에 더해 API/Web TypeScript의 `noUnusedLocals`·`noUnusedParameters`를 활성화. 최종 로컬 snapshot에서 `npm run check` 통과                                                                                                                                                              |
| RF-021 React 테스트 harness              | 완료                         | 공통 컴포넌트·hook과 주요 modal/controller의 회귀 테스트를 유지하고 업로드 오류·ESC·busy 경계를 추가                                                                                                                                                                                                 |
| RF-022 브라우저 smoke                    | 로컬 검증 완료               | 역할별 Chrome smoke 3개×HD·HD+·FHD·QHD 4개 viewport=12개와 FHD 변경 workflow 5개, 총 17/17 통과. nonce DB·동적 포트·runner 소유 PID 종료를 적용했고 정상 종료 후 `examcheck_e2e_*` 잔존 0건 확인                                                                                                     |
| RF-023 visual baseline                   | 부분 완료                    | FHD/QHD 수동·자동 캡처와 overflow 검사는 있으나 사용자 승인 golden 이미지 및 pixel diff gate는 없음                                                                                                                                                                                                  |
| RF-024 CI와 `npm run check`              | 완료                         | 로컬 `npm run check`, integration, 브라우저 17/17과 기준 commit의 GitHub Actions `static-and-unit`, `integration`, `browser-smoke` 세 작업 모두 성공                                                                                                                                                 |
| RF-025 migration checksum·동시 실행 잠금 | 로컬 검증 완료               | SHA-256·원본 파일 누락·서버 advisory lock에 더해 내부 상태를 `APPLYING/APPLIED/FAILED`로 기록. 실제 MariaDB에서 첫 DDL 뒤 후속 SQL 실패, 부분 컬럼과 `FAILED` 잔존, 재실행 차단을 검증. 실패 SQL·오류 원문·입력값은 metadata에 저장하지 않으며 운영 repair/restore는 별도 승인                       |
| RF-026 감사 request ID 스키마 정합       | 로컬 검증 완료               | HTTP가 허용하는 최대 128자 request ID가 mutation 감사 저장을 실패시키지 않도록 `audit_log.request_id`를 `VARCHAR(128)`로 확장. fresh·재실행과 N-1(`025`)→latest(`026`)에서 기존 행 보존 및 128자 실제 감사 저장을 검증                                                                               |
| RF-030·032 데이터 진단                   | 로컬 기준선 완료             | 개인정보 원문 없이 복수 일정·orphan·범위 밖·중복·범위 겹침을 `docs/data-integrity-baseline.md`에 집계. 현재 로컬 DB의 할당 11건 중 정확 일정 매핑 6건, 레거시 미매핑 5건 확인. 운영 원본을 대표한다는 보장은 없음                                                                                    |
| RF-031 정규화 충돌 진단                  | 안전 도구 완료·실데이터 대기 | NFKC·trim·선행 0 보존, exact/unmapped/ambiguous/conflict·범위 용량을 집계하는 순수 dry-run과 salted HMAC shadow 비교 도구·합성 테스트를 추가. DB/API에 연결하지 않았고 승인된 복원본·운영 데이터 진단은 수행하지 않음                                                                                |
| RF-033 / P0-4 번호 유일 정책             | 좁은 수직 슬라이스 완료      | 개발자 메뉴에서 수험번호 `SYSTEM/SCHEDULE`, 가번호 `ADMISSION/SCHEDULE` 정책을 저장하고, 설정 축소 전 충돌 검증·일정별 할당 식별·레거시 보정을 구현. 기본값은 `SYSTEM/ADMISSION`. 결정 근거는 `docs/adr/0001-pseudonym-unique-scope.md`. **Phase 5 전체 데이터 모델 전환은 진행 중이며 완료가 아님** |
| RF-034–036 목표 identity 전환            | 승인 대기                    | ADR 0002와 G0–G8 게이트 초안 및 합성 진단 도구만 준비. D-01–D-22, 개인정보 backup/restore, 목표 ERD, 027+ identity migration과 운영 cutover는 미수행. 026은 이 전환과 무관한 감사 컬럼 안전 확장                                                                                                     |

## 이번 연속 리팩토링 배치

- API 환경값을 시작 시 한 번 검증·해석하는 불변 typed `AppConfig`로 통합하고 HTTP, DB, JWT/session,
  로그인 제한, 기본 시험명, 출력 작업 만료 설정을 명시적 주입으로 전환했다. 빈 값·잘못된 숫자·운영
  secret 오류는 각 설정 계약에 따라 시작 단계에서 실패한다.
- 역할 문자열을 Controller마다 반복하는 대신 중앙 permission matrix와 `@RequirePermissions`를
  적용했다. 개발자는 모든 권한, 관리자는 개발자 설정을 제외한 관리 권한, 운영자와 조회자는
  허용된 업무 권한만 갖는다. 전형 데이터 범위는 기존 admission scope 검증을 계속 함께 적용한다.
- 상태 변경 감사 저장을 공통 `MutationAuditRepository`로 통합하고 이벤트별 허용 details와
  workstation/print-job envelope를 타입과 런타임 exact 계약으로 강제한다. 승인된 운영 추적 예외인
  계정 `loginId`와 가번호 할당의 `examineeNo`·`pseudonymNo`는 매트릭스에 명시하고 외부 관측
  플랫폼으로 복제하지 않는다. HTTP request ID는 비동기 context를 통해 mutation·인증 감사까지
  연결되며, HTTP 밖의 worker correlation은 후속이다.
- 수험생·계정·사용자 운영 그리드의 정렬·필터 헤더와 client-grid 동작을 공통 컴포넌트/hook으로
  통합했다. 화면별 컬럼·페이지네이션 차이는 adapter 입력으로 유지한다.
- 양식 편집기 UI/CSS는 실제 편집 route에서만 lazy load하고, PDF에 필요한 값 포맷팅은
  `examlist-template-editor/core`만 import하도록 분리했다. 일반 운영 route가 편집기 본체를
  정적 import하지 않는 경계 테스트를 추가했다.
- `identity-transition`에는 승인된 입력만 받는 순수 정규화·dry-run·shadow digest 도구를
  마련했다. 이는 합성 테스트용 안전 기반이며 live DB backfill, dual-write 또는 cutover가 아니다.
- MariaDB harness는 특정 migration까지만 구성할 수 있으며, 직전 N-1(`025`) 상태의 기존 행을
  보존한 채 latest(`026`)로 올리고 재실행하는 upgrade 시나리오를 추가했다.
- backup/restore와 migration 실행 절차는 `docs/runbooks/`에 문서화했지만 실제 개인정보 backup,
  복원 리허설, staging·운영 적용은 하지 않았다.
- candidates, accounts와 pseudonyms의 orchestration을 application/use-case와 repository로 분리하고,
  업무 service의 직접 SQL 및 repository의 transaction 소유를 금지하는 architecture 회귀 테스트를
  추가했다. migration·bootstrap 같은 인프라 경계는 이 규칙의 명시적 범위 밖이다.
- candidate·pseudonym domain은 Nest·DTO·repository에 의존하지 않는 순수 규칙으로 유지하고,
  repository는 SQL·row mapping만 담당하도록 회귀 테스트로 고정했다.
- 관리자 대시보드와 전형 설정 목록은 서버 집계 API와 TanStack Query로 전환해 전체 수험생 row
  전송과 전형별 N+1을 제거했다. 비활성 메뉴에서는 대시보드 query를 실행하지 않는다.
- 인증·세션·교시·개발자 설정·집계·업로드·가번호 운영의 고위험 성공 응답을 Web Zod schema로
  검증하고, 저장된 사용자 교시는 서버에서 재검증한다. modal은 `inert`/`aria-hidden`과 focus trap,
  ESC·focus restore 계약을 공통 hook으로 유지한다.
- 수험생 XLSX·사진 ZIP 미리보기는 actor·파일 SHA-256·잠금 전 DB 상태·유일 정책·30분 TTL을 HMAC
  서명한 티켓을 발급한다. 반영 티켓은 URL이 아닌 `X-Candidate-Preview-Token` 헤더로만 보내고,
  transaction에서 상태를 다시 확인한 뒤 사용자가 선택한 정책으로 실행 계획을 재생성한다.
- 사용자 수험생 controller의 자동추첨 preview/카운트다운과 사진 요청 취소·stale guard·object URL
  생명주기를 별도 hook으로 분리했다. 교시 전환 취소, 자동추첨 1회, 늦은 사진 무시와 URL revoke
  계약은 회귀 테스트로 유지한다.

## 이번 배치에서 함께 제거한 회귀 위험

- 계정 전형 배정의 조회·검증·저장·감사 로그를 같은 DB 트랜잭션 연결로 통일
- 마감·자동 결시자 부여·재개 삭제·상태 통계에 시험명과 전형 범위를 명시
- 관리자 시스템 설정과 양식 편집기의 메뉴 이동·뒤로가기·로그아웃·새로고침 dirty 보호
- 수험생 조회·사진·가번호 부여·자동 추첨·명단·출력 응답의 수험생/교시 stale 결과 차단
- 저장 확인 중 예외, 중복 저장, 교시 변경 후 이전 busy/notice 상태 잔존 방지
- DB 생성·migration·초기 계정 bootstrap을 독립 명령으로 분리하고 기존 `db:setup` 호환 유지
- 체크섬 불일치와 적용 이력에 대응하는 SQL 원본 파일 누락을 후속 migration 전에 차단
- 임시 MariaDB 이름·소유권·현재 연결 DB를 중복 검증해 운영 DB 삭제 경로 차단
- 운영 실행과 HTTP E2E의 prefix·CORS·ValidationPipe 초기화 경로 통일
- 마이그레이션 전체 실행을 `GET_LOCK`/`RELEASE_LOCK`으로 감싸 같은 DB 서버의 중복 실행 차단
- DDL implicit commit 뒤 실패하면 `FAILED`를 남기고 다음 checksum backfill·migration 실행을
  차단해 부분 적용 상태의 조용한 재실행 방지
- 개발자 메뉴의 번호 유일 정책을 접근 가능한 라디오 선택지로 제공하고 기존 dirty·새로고침·통합 저장·토스트 흐름에 연결
- 일정별 가번호 할당에 `candidate_record_id`와 결정적 scope key를 기록하고, 더 좁은 정책으로 변경할 때 개인정보 원문 없이 충돌 건수만 반환
- 019 이전 레거시 할당은 정확히 한 개의 수험생 일정과 매칭되는 경우에만 연결하고, 모호하거나 누락된 5건은 보존
- 일정별 가번호 정책에서도 일정에 연결할 수 없는 레거시 5건의 번호를 전형 전체 예약 번호로 취급해 재사용을 차단
- XLSX/ZIP 업로드의 파일 signature, ZIP 경로·항목 수·압축/해제 크기·비율, 사진 magic byte·픽셀 상한을 검증하고 업무 write와 이벤트별 허용 감사 로그를 같은 트랜잭션으로 처리
- 업로드 중 파일·탭·반영 정책 변경을 비활성화하고, 잘못된 성공 응답은 실제 양식 오류로 오인하지 않는 안전한 공통 응답 오류로 처리
- 인쇄 작업은 서버의 사전부여·라벨 정책을 재확인하고 사용자별 멱등 키·요청 지문·만료·상태 CAS·감사 로그로 중복 및 payload 바꿔치기를 차단
- 라벨 작업 생성 요청이 응답하기 전 연속 클릭해도 Web의 동기 ref guard가 `createPrintJob`을 한
  번만 호출하도록 보장
- 워크스테이션 등록과 감사 로그를 같은 트랜잭션으로 처리하고 클라이언트 코드는 `VITE_WORKSTATION_CODE` 한 곳에서 주입
- Controller path/query 입력을 DTO로 검증하고 auth/accounts/developer/bootstrap의 동기식 암호 연산을 async scrypt로 전환
- 사용자 운영 화면의 조회·명단·모달을 controller/component로 분리하고 전역 CSS를 기능별 진입점으로 나눔
- 사용자 PDF 생성은 수험생별(`CANDIDATE`), 고사실별(`ROOM`), 시험 전체(`EXAM`) 양식에 연결. 일반 문서의 바코드·QR 이미지 생성은 후속
- 운영 명단 Excel은 클라이언트 행을 받지 않고 서버가 권한·교시·허용 필터/정렬 조건으로 canonical 데이터를 재조회하며 10,000행 상한을 강제
- 수험생 워크북 키·DB 열·운영 보호 여부를 하나의 typed 필드 정의로 통합하고 전체 필드 XLSX→DB→API 왕복을 MariaDB에서 검증
- Browser Print의 스크립트·프린터 조회·전송 callback에 제한시간과 첫 응답 경계를 적용하고 늦거나 중복된 callback을 무시
- PDF 사진 요청 동시성을 4개로 제한하고 취소·이미지/렌더 제한시간·진행 상태·late completion 차단을 적용
- 양식 latest/active/version/metadata 트랜잭션의 현재 동작을 특성화 테스트로 고정하고 잘못된 로그인 제한 환경값은 시작 시 fail-fast

## 현재 자동 검증

아래 수치는 2026-08-28 최초 기준 commit `83c43e5` 직전에 다시 실행한 결과다. commit 이후 제품 코드나
산출물이 바뀌면 명령 원문과 `npm run metrics:baseline` JSON을 다시 수집한다.

| 항목                | 현재 판정                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 정적·단위 검증      | `npm run check` 통과: format·lint·API/Web typecheck·단위/HTTP·architecture 경계·production build 성공. API 67 files/463 tests, Web 59 files/193 tests 통과                                                          |
| Coverage            | source-map-aware `npm run test:coverage` 통과. API statements/lines 86.88%, branches 82.02%, functions 87.65%; Web statements/lines 63.96%, branches 77.25%, functions 63.79%                                       |
| MariaDB integration | `npm run check:integration` 통과: 10 files/37 tests. fresh `001`~`026`, 재실행·체크섬·advisory lock·dirty-state·경합·rollback·정책·세션·업로드·출력과 N-1(`025`)→latest(`026`) upgrade 포함                         |
| Production build    | 성공. API build 565,271B, Web build 2,145,107B; main JS 282,610B, 운영 JS 57,086B, 편집기 lazy JS 569,761B. 편집기 500kB 경고는 남지만 일반 route와 정적 import 경계는 통과                                         |
| 현재 로컬 DB        | migration `001`~`026` 적용·재실행 검증. 기존 할당 11건 중 정확한 `candidate_record` 매핑 6건, 자동 결정할 수 없는 레거시 5건 보존                                                                                   |
| 실제 브라우저       | `npm run test:e2e` 17/17 통과: 12개 viewport 역할 smoke+5개 FHD mutation workflow. QHD 좌측 패널 overflow 회귀를 수정·재검증했고 테스트 서버 정상 종료·nonce DB 잔존 0건 확인. 승인된 golden·pixel diff는 아직 없음 |
| CI                  | 기준 commit `83c43e5`의 [Quality Gate](https://github.com/ahe45/ExamCheck/actions/runs/33125056778) 성공. 정적·단위·coverage, MariaDB 11.4 integration, 브라우저 격리 seed/17개 Playwright 모두 통과                |

## 다음 Go 조건

1. 승인된 golden 이미지와 작은 해상도 기준을 정한 뒤 시각 diff gate 추가
2. DB backup 보관 위치·개인정보 복제 정책·보존/파기 책임자를 승인한 뒤 `docs/runbooks/backup-restore.md`에 따라 restore rehearsal
3. 일정 identity를 `candidate_record`에 계속 둘지 독립 `schedule/registration` 모델로 승격할지 목표 ERD와 cutover 승인
4. PC별 워크스테이션 코드 배포, Zebra Browser Print 재배포 권한, GT800 USB 실기기 검증과 운영 배포 승인

수험번호와 가번호의 유일 범위는 개발자 메뉴에서 선택할 수 있으며 기본값은 각각 `SYSTEM`, `ADMISSION`이다. 일정별 가번호는 `candidate_record_id`와 일정 scope key로 구분한다. 다만 이번 작업은 RF-033/P0-4의 좁은 수직 슬라이스다. 공통 identity, 독립 일정/등록 모델, roster read model, 설정·출력 projection과 dual-read/dual-write cutover를 포함하는 Phase 5A~5F 전체는 아직 남아 있다. 정확히 매핑할 수 없는 레거시 할당 5건은 admission 범위 예약 번호로 보존하며 자동 삭제하지 않는다.
