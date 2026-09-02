# 리팩토링 진행 현황

> 갱신일: 2026-08-28  
> 기준 계획: `REFACTORING_PLAN.md` 0.2

## 실행 배치와 현재 상태

| 작업                                     | 상태                                    | 확인 근거                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-001 Git 추적·제외 목록 감사           | 완료                                    | `.env`, `setup/`, IDE 설정, 임시 산출물, build cache 제외. staged 456개·53.5MB, 100MiB 초과 및 고신뢰 비밀키·토큰 패턴 없음 확인                                                                                                                                                                                                    |
| RF-002 레거시 자산 격리                  | 프로젝트 내 원본 정리 완료              | 삭제 전 인벤토리와 대표 자산 SHA-256을 기록한 뒤, 2026-08-28 사용자 명시 요청으로 Git 미추적 `setup/` 2,209개 파일(401,552,387 bytes)을 영구 삭제했다. 외부 사본·자격증명 유효성·재배포 권한은 프로젝트 밖의 별도 감사 범위                                                                                                         |
| RF-003 DB backup/restore rehearsal       | 대기                                    | 개인정보 복제 정책과 격리 복원 위치 확정 필요                                                                                                                                                                                                                                                                                       |
| RF-004 실행 기준선 수집                  | 로컬 기준선 완료                        | Node/npm/build/DB inventory와 핵심 관리자·사용자 화면 FHD/QHD 수동 검수 완료. `npm run metrics:baseline`으로 소스·테스트·CSS·migration·build asset 크기를 재현 가능하게 수집. 공식 visual 기준 이미지는 RF-023에서 관리하며 API golden fixture는 계속 필요                                                                          |
| RF-005 기준 commit/tag                   | 완료                                    | 최초 commit `83c43e5`, 태그 `refactor-baseline-2026-08-28`을 공개 `origin/master`에 게시                                                                                                                                                                                                                                            |
| RF-010 MariaDB 통합 테스트 harness       | 로컬·원격 검증 완료                     | 운영 `DB_NAME`을 사용하지 않는 nonce DB 생성·전체 migration·삭제 안전장치와 잔존 0건 확인. 기준 commit의 GitHub Actions MariaDB 11.4 integration 성공                                                                                                                                                                               |
| RF-011 Nest HTTP E2E 최소 harness        | 완료                                    | 임시 포트에서 실제 Controller/AuthGuard/RolesGuard와 path/query/body DTO 경계를 검증. 공통 오류·request ID·CORS뿐 아니라 수험생 업로드, 가번호 부여/설정, 양식 저장, 출력 작업의 역할별 201/200/401/403/400 업무 경계를 확인. DB 트랜잭션은 MariaDB integration 범위로 분리                                                         |
| RF-012 안전한 초기 계정 seed             | 완료                                    | 기존 계정은 덮어쓰지 않고 누락된 계정만 생성, 결정적 단위 테스트 추가                                                                                                                                                                                                                                                               |
| RF-013 개발자 계정 보호                  | 완료                                    | 일반 계정 API의 DEVELOPER 수정·삭제 차단 및 역할 회귀 테스트                                                                                                                                                                                                                                                                        |
| RF-014 인증·운영 보안 기준               | 코드 완료                               | 운영 JWT·초기 계정 기본 비밀번호 fail-fast, async scrypt, 계정 변경 시 session 무효화, CORS allowlist, 보안 헤더, 로그인 제한, 공통 오류·request ID 적용. 운영 proxy와 다중 인스턴스 공유 제한기는 배포 환경 검증 필요                                                                                                              |
| RF-015 운영 경합 잠금 검증               | 통합 검증 완료                          | 서로 다른 실제 MariaDB connection에서 close→assign, assign→settings, close→reopen의 대기·최신 상태 재확인·rollback·감사 이력 검증                                                                                                                                                                                                   |
| RF-016 settings cursor·범위 검증         | 통합 검증 완료                          | 실제 DB에서 cursor 보존과 기존 할당을 제외하는 범위 변경 rollback 검증                                                                                                                                                                                                                                                              |
| RF-020 정적 품질 기준                    | 로컬 검증 완료                          | Prettier·ESLint에 더해 API/Web TypeScript의 `noUnusedLocals`·`noUnusedParameters`를 활성화. 최종 로컬 snapshot에서 `npm run check` 통과                                                                                                                                                                                             |
| RF-021 React 테스트 harness              | 완료                                    | 공통 컴포넌트·hook과 주요 modal/controller의 회귀 테스트를 유지하고 업로드 오류·ESC·busy 경계를 추가                                                                                                                                                                                                                                |
| RF-022 브라우저 smoke                    | 로컬 검증 완료                          | 역할별 번들 Chromium smoke 3개×HD·HD+·FHD·QHD 4개 viewport=12개와 FHD 변경 workflow 5개, 총 17/17 통과. RF-023 visual 18개를 포함한 전체 브라우저 검증도 35/35 통과. nonce DB·동적 포트·runner 소유 PID 종료를 적용했고 정상 종료 후 `examcheck_e2e_*` 잔존 0건 확인                                                                |
| RF-023 visual baseline                   | 완료                                    | 로그인·관리자 5개·개발자 설정·사용자 2개 등 9개 화면을 FHD/QHD에서 비교하는 공식 visual 18개 구성. Windows/Linux 기준 이미지 분리, 번들 Chromium·로컬 Fontsource 글꼴·재시도 0을 고정하고 CI는 Ubuntu 24.04에서 기준 갱신 없이 Linux 이미지만 비교. `test:visual:update`는 명시적 육안 승인 후 로컬에서만 실행                      |
| RF-024 CI와 `npm run check`              | 완료                                    | 로컬 `npm run check`, integration과 browser smoke/workflow 검증 완료. CI는 정적·단위·coverage, MariaDB 11.4 integration, 17개 browser smoke/workflow 및 별도 18개 visual regression 작업을 정의하며 기준 이미지를 자동 갱신하지 않음                                                                                                |
| RF-025 migration checksum·동시 실행 잠금 | 로컬 검증 완료                          | SHA-256·원본 파일 누락·서버 advisory lock에 더해 내부 상태를 `APPLYING/APPLIED/FAILED`로 기록. 실제 MariaDB에서 첫 DDL 뒤 후속 SQL 실패, 부분 컬럼과 `FAILED` 잔존, 재실행 차단을 검증. 실패 SQL·오류 원문·입력값은 metadata에 저장하지 않으며 운영 repair/restore는 별도 승인                                                      |
| RF-026 감사 request ID 스키마 정합       | 로컬 검증 완료                          | HTTP가 허용하는 최대 128자 request ID가 mutation 감사 저장을 실패시키지 않도록 `audit_log.request_id`를 `VARCHAR(128)`로 확장. fresh·재실행과 N-1(`025`)→latest(`026`)에서 기존 행 보존 및 128자 실제 감사 저장을 검증                                                                                                              |
| RF-030·032 데이터 진단                   | 로컬 기준선 완료                        | 개인정보 원문 없이 복수 일정·orphan·범위 밖·중복·범위 겹침을 `docs/data-integrity-baseline.md`에 집계. 현재 로컬 DB의 할당 11건 중 정확 일정 매핑 6건, 레거시 미매핑 5건 확인. 운영 원본을 대표한다는 보장은 없음                                                                                                                   |
| RF-031 정규화 충돌 진단                  | 격리 도구 검증 완료·승인 복원본 대기    | NFKC·trim·선행 0 보존 dry-run에 더해 재실행 가능한 격리 backfill과 consistent-snapshot HMAC verifier를 구현. 후보자·사진·설정·범위·운영·배정·계정·인쇄 9종을 source bridge로 비교하며 사진 BLOB과 PII 원문은 observation에 저장하지 않음. 합성 단위 및 nonce MariaDB fixture 검증일 뿐 승인된 복원본·운영 데이터 진단은 미수행      |
| RF-033 / P0-4 번호 유일 정책             | 좁은 수직 슬라이스 완료                 | 개발자 메뉴에서 수험번호 `SYSTEM/SCHEDULE`, 가번호 `ADMISSION/SCHEDULE` 정책을 저장하고, 설정 축소 전 충돌 검증·일정별 할당 식별·레거시 보정을 구현. 기본값은 `SYSTEM/ADMISSION`. 결정 근거는 `docs/adr/0001-pseudonym-unique-scope.md`. **Phase 5 전체 데이터 모델 전환은 진행 중이며 완료가 아님**                                |
| RF-034 candidate/slot/segment 목표 ERD   | 원칙 승인·격리 schema 검증 완료         | D-01–D-22와 ADR 0002의 `exam_cycle → admission → operation_slot → schedule_segment`, candidate/registration 분리 및 source bridge를 027–032 expand schema에 반영. fresh/upgrade MariaDB 제약 검증만 완료했으며 운영 DB 적용은 No-Go                                                                                                 |
| RF-035 exam cycle·빈 admission mapping   | 격리 fixture 검증 완료·승인 복원본 대기 | 빈 admission은 global default policy로, 이름 alias는 정규화 후 exact mapping만 허용하고 ambiguous/unmapped는 issue로 보존. 격리 backfill의 checkpoint·재실행·legacy reservation을 MariaDB fixture에서 검증했으나 승인된 운영 복원본 집계는 없음                                                                                     |
| RF-036 목표 모델 expand·전환 control     | 소스 구현·격리 검증 완료                | migration 027–032 target expand, 033 transition/backfill/shadow control, 034 증적·분리 승인·상태 이력, 035 재출력 이력, 036 shadow batch, 037 불변 trigger를 작성. `001`–`037` fresh·재실행과 `026`→`037` 기존 행 보존 upgrade를 로컬 MariaDB에서 검증. 운영 backup/restore·적용·승격은 미수행이며 계속 No-Go                       |
| RF-037 첫 업무 read shadow/canary 연결   | 개발자 정책 수직 슬라이스 완료          | 개발자 번호 유일 정책 GET을 같은 transaction connection의 legacy/target projection과 `IdentityReadRouter`에 연결. SHADOW는 legacy 응답과 HMAC 집계 observation을 남기고, CANARY는 명시 대상에게만 target 정책을 반환한다. 실제 MariaDB 일치·불일치/선택 회귀 검증 완료. dashboard·roster·설정·운영·출력의 나머지 read 연결은 미완료 |

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
- `identity-transition`에는 정규화·dry-run과 함께 legacy/dual/canonical write coordinator,
  legacy/shadow/canary/canonical read router, HMAC 집계 observation, user/admission canary allowlist와
  권한 교집합 fail-closed 경계를 마련했다. 격리 backfill·shadow verifier·transition CLI는 모두
  `--confirm-isolated-copy`와 안전한 DB 이름을 강제한다. 이는 운영 traffic 또는 cutover 증거가 아니다.
- MariaDB harness는 migration `001`~`037` fresh·재실행과 기존 `026` 데이터를 보존하는
  `026`→`037` upgrade, 합성 identity backfill·shadow 비교를 검증한다. nonce 임시 DB 결과이며
  승인된 운영 snapshot 복원·성능 검증을 대신하지 않는다.
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
- 2026-08-28 최종 로컬 완료 배치에서 identity 전환 coordinator/read router의 런타임 의존성을
  명시적으로 주입해 계정 생성·전형 설정 저장·개발자 정책 저장·가번호 부여에서 발생하던 HTTP 500을
  제거했다. 비활성 identity 전환 상태의 계정 생성과 전형 범위 계정 생성을 실제 MariaDB 회귀
  테스트로 추가하고, 게시·보관 양식 version의 불변 trigger 계약도 최신 migration과 일치시켰다.
- 이어진 read 전환 배치에서는 인증된 개발자 설정 조회의 번호 정책을 첫 실제 shadow/canary 업무
  경로로 연결했다. 비교 시점의 source mutation high-water mark를 자동 기록하고, canary 사용자가
  아니면 target이 준비돼 있어도 legacy 응답을 유지한다. 공개 system-profile 응답과 다른 업무 read는
  아직 legacy 경로를 사용한다.

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

아래 결과는 2026-08-28 현재 작업 트리에서 전체 로컬 검증을 순차 실행한 최신 snapshot이다.
MariaDB와 브라우저 검증은 nonce 격리 DB를 사용하며 운영 데이터 적용·성능·실기기 증거로 확대
해석하지 않는다.

| 항목                  | 현재 판정                                                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 정적·단위 검증        | `npm run check` 통과: format·lint·API/Web typecheck·integration typecheck·단위/HTTP·architecture 경계·production build 성공. API 83 files/597 tests, Web 59 files/196 tests 통과                                                         |
| Coverage              | source-map-aware `npm run test:coverage` 통과. API 102 files/676 tests, statements/lines 89.35%, branches 81.93%, functions 92.58%; Web 59 files/196 tests, statements/lines 64.16%, branches 77.43%, functions 64.07%                   |
| MariaDB integration   | `npm run check:integration` 통과: 19 files/79 tests. fresh `001`~`037`, 재실행·체크섬·advisory lock·dirty-state·경합·rollback·정책·세션·업로드·출력·identity backfill/shadow/gate, 첫 업무 read shadow/canary와 `026`→`037` upgrade 포함 |
| Production build      | 성공. API build 565,271B, Web build 2,145,107B; main JS 282,610B, 운영 JS 57,086B, 편집기 lazy JS 569,761B. 편집기 500kB 경고는 남지만 일반 route와 정적 import 경계는 통과                                                              |
| 진단 기준 로컬 DB     | migration `001`~`037` 적용·재실행 검증. 기존 할당 11건 중 정확한 `candidate_record` 매핑 6건, 자동 결정할 수 없는 레거시 5건 보존                                                                                                        |
| Identity 전환 focused | API·integration TypeScript 검사와 전체 자동 검증 통과. migration manifest 기준 `001`~`037` fresh·재실행, `026`→`037` upgrade, 격리 backfill·shadow·gate·계정 mutation을 검증. 모두 합성·격리 증거이며 운영 적용 증거가 아님              |
| 실제 브라우저         | `npm run test:e2e` 35/35 통과: 12개 viewport 역할 smoke+5개 FHD mutation workflow+9개 화면×FHD/QHD visual 18개. FHD/QHD는 브라우저 UI를 제외한 CSS viewport이며 공식 기준 이미지는 Windows/Linux로 분리                                  |
| CI                    | Ubuntu 24.04·Playwright 번들 Chromium·로컬 Fontsource 글꼴로 browser smoke/workflow와 visual regression을 분리 실행. visual은 재시도 0이며 CI에서는 기준 이미지를 생성·갱신하지 않고 저장소의 Linux baseline만 비교                      |

## 다음 Go 조건

1. DB backup 보관 위치·개인정보 복제 정책·보존/파기 책임자를 승인한 뒤 `docs/runbooks/backup-restore.md`에 따라 restore rehearsal
2. 승인된 독립 `schedule/registration` 목표 모델을 운영 복원본에 적용하고 backfill→shadow→canary→canonical 단계별 증적·분리 승인과 rollback rehearsal 수행
3. PC별 워크스테이션 코드 배포, Zebra Browser Print 재배포 권한, GT800 USB 실기기 검증과 운영 배포 승인

수험번호와 가번호의 유일 범위는 개발자 메뉴에서 선택할 수 있으며 기본값은 각각 `SYSTEM`, `ADMISSION`이다. 일정별 가번호는 `candidate_record_id`와 일정 scope key로 구분한다. 공통 identity, 독립 일정/등록 모델, source bridge, backfill·shadow·dual-read/dual-write·승격 control의 소스와 격리 검증은 준비됐지만, 승인된 운영 복원본에서의 backfill과 단계별 cutover는 아직 수행하지 않았다. 정확히 매핑할 수 없는 레거시 할당 5건은 admission 범위 예약 번호로 보존하며 자동 삭제하지 않는다.
