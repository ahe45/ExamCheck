# 가번호 관리 시스템

수험번호를 인식한 뒤 운영 정책에 따라 중복 없이 가번호를 부여하고 이력을 관리하는 웹 시스템입니다. Zebra GT800 라벨 출력은 부여된 가번호를 현장에서 인쇄할 때 선택적으로 사용하는 부가 기능입니다.

## 현재 구성

- `apps/web`: React + TypeScript + Vite, 권한별 로그인·가번호 부여·관리자 양식 편집·선택적 라벨 출력
- `apps/api`: NestJS + MariaDB 11.4/MySQL 호환 DB, 인증·수험생 조회·가번호 부여·양식 버전·출력 작업 API
- `apps/api/src/database/migrations`: 버전 관리되는 MariaDB/MySQL 호환 SQL 스키마
- `vendor/examlist-template-editor-1.1.0.tgz`: ExamList에서 가져온 동일 양식 편집기 패키지
- `docs`: 실기기 POC 전에 채워야 할 환경/장비 체크 문서

## 시작하기

Node.js 20 이상이 필요합니다.

```bash
npm install
npm run db:setup
npm run dev
```

- 웹: `http://localhost:5173`
- 관리자 로그인 후: `http://localhost:5173/admin`
- 가번호 부여 담당자 로그인 후: `http://localhost:5173/operation/select`
- API 상태: `http://localhost:3100/api/v1/health`

로컬 개발용 초기 계정은 `npm run db:setup`에서 비밀번호가 아직 없는 경우에만 생성합니다.

- 관리자: `admin` / `1234`
- 사용자: `가번호` / `1234`
- 개발자: `dev` / `1234`

새 데이터베이스 기준으로 가번호가 아직 부여되지 않은 화면 테스트용 수험번호는 `20260005`~`20260008`입니다. `20260008`에는 사전 가번호가 등록되어 있어 네 번째 방식을 확인할 수 있습니다.

운영 환경에서는 `.env`의 `JWT_SECRET`, `ADMIN_INITIAL_PASSWORD`, `USER_INITIAL_PASSWORD`,
`DEVELOPER_INITIAL_PASSWORD`를 반드시 별도 값으로 설정해야 합니다.

로컬 `.env`는 U-Form과 같은 MySQL 서버 접속 정보를 사용하되 `DB_NAME=examcheck`로 분리합니다. `.env`는 Git에 포함되지 않습니다.

기본 프린터 모드는 `mock`입니다. 실제 PC에서 Zebra Browser Print를 검증할 때 공식 배포본의 `BrowserPrint.js`를 `apps/web/public/vendor/BrowserPrint.js`에 두고 `VITE_PRINTER_MODE=browser-print`로 변경합니다. 프린터 전송은 성공 콜백 이후에도 물리 인쇄 완료가 아닌 “데이터 전송됨”으로 표시합니다.

출력 작업에 기록할 워크스테이션 코드는 PC별 빌드 환경의 `VITE_WORKSTATION_CODE`로 지정합니다.
로컬 기본값 `WS-DEV-001`은 초기 스키마에 등록되지만, 운영에서는 PC별 코드를 서버에 먼저 등록하고
각 PC에 서로 다른 값을 배포해야 합니다.

관리자 화면의 시스템 설정은 등록된 전형별로 부여 방식과 운영 정책을 관리하고, 실제 수험생 일정 segment별 가번호 시작·종료 범위와 순차 부여 위치를 저장합니다. 가번호는 선택한 유일 정책에 대응하는 DB 고유 제약과 트랜잭션으로 중복을 방지하며, 사전 등록 번호는 추첨·순차 부여에서 예약 번호로 제외합니다.

개발자 메뉴에서는 번호 유일 범위를 운영 정책에 맞게 선택할 수 있습니다.

- 수험번호: 시스템 전체에서 한 번만 사용하거나, 날짜·시간·교시별로 재사용
- 가번호: 전형 전체에서 한 번만 사용하거나, 날짜·시간·교시별로 재사용

더 강한 범위로 변경할 때 기존 데이터에 충돌이 있으면 설정과 데이터 변경을 모두 취소합니다. 기본값은 수험번호 `시스템 전체`, 가번호 `전형 전체`입니다.

인증 비밀번호는 async scrypt로 검증하며 계정 비밀번호·권한·활성 상태 변경 시 기존 세션을
무효화합니다. 운영 설정은 JWT secret과 초기 계정 기본 비밀번호를 차단하고 CORS allowlist,
보안 헤더, 로그인 제한, 공통 오류·request ID를 적용합니다.

API 환경값은 시작 시 불변 typed `AppConfig`로 한 번 해석하고 HTTP, DB, JWT/session, 로그인 제한,
기본 시험명, 출력 작업 만료 설정에 명시적으로 주입합니다. 잘못된 숫자나 허용되지 않은 운영
secret은 요청 처리 중이 아니라 시작 단계에서 차단합니다. API 접근은 중앙 permission matrix로
관리하며 역할 권한과 사용자별 전형 범위를 함께 검사합니다.

상태 변경 감사는 공통 저장 경계를 사용하고 HTTP request ID를 비동기 context로 전달해 요청
로그·mutation 감사·인증 감사를 연계합니다. 수험번호·이름·생년월일 같은 개인정보 원문을
request log나 진단 metric에 기록하지 않습니다.

수험생 XLSX와 사진 ZIP은 확장자만 신뢰하지 않고 파일 signature, ZIP 경로·항목 수·압축/해제
크기·비율, 이미지 magic byte·픽셀 상한을 확인합니다. 업로드 변경과 비식별 감사 로그는 같은
DB 트랜잭션으로 처리합니다.

가번호 부여 담당자 화면은 다음 네 가지 방식을 지원합니다.

1. 지정 범위의 미사용 번호 중 무작위 추첨
2. 지정 범위에서 다음 미사용 번호를 순차 부여
3. 지정 범위의 번호를 직접 입력하고 중복 확인 후 부여
4. 수험생에게 미리 등록된 가번호를 불러와 선택적으로 라벨 출력

## 일반 양식 편집과 출력

Crystal Reports는 사용하지 않습니다. 관리자 페이지의 `양식 편집기`에서 ExamList와 동일한 편집기를 사용해 일반 문서·명단 템플릿을 만들고, 저장할 때마다 새 버전으로 보관합니다.

현재 적용 버전은 `examlist-template-editor 1.1.0`입니다. 다중 페이지 전환, 페이지별 설정, HTML 정리, 문서 영역 초과 검사, OPT10, 생성 객체와 최신 ExamList 편집기 레이아웃을 포함합니다. 편집기 UI와 CSS는 편집 화면에서만 lazy load하고, 일반 PDF 출력에 필요한 값 포맷팅은 패키지의 `core` 진입점만 사용합니다.

- 제공 범위: 수험생별, 고사실별, 시험 전체
- 기본 제공 양식: 가번호표, 수험생 확인표
- 데이터 태그: 시스템·학교·수험생·시험 분류·고사실·결시·사진·옵션·집계 항목 54개
- 사용자 제공: 활성 양식을 가번호 부여 완료 화면에서 선택하고 현재 운영 명단으로 PDF 생성

수험생별 양식은 수험생마다 한 페이지를 만들고, 고사실별 양식은 고사건물·고사실별 명단과 집계로 페이지를 나누며, 시험 전체 양식은 현재 운영 범위의 전체 명단과 집계를 사용합니다. 세 범위 모두 사용자 인쇄 모달의 PDF 생성에 연결되어 있습니다. 바코드와 QR 개체는 편집기에서 배치할 수 있지만 일반 문서 출력용 이미지 생성기는 후속 구현 범위입니다. Zebra ZPL 라벨 출력은 이 일반 양식 기능과 별도로 유지됩니다.

Windows 드라이버, Zebra Browser Print, GT800 USB 진단은 라벨 출력을 사용하는 전형의 사용자 운영 화면에서 `설정 → 프린터 설정`으로 진입합니다. 일반 브라우저는 Windows의 설치 드라이버 목록을 직접 읽을 수 없으므로 GT800 검색 성공 시에만 드라이버 동작을 “확인됨”으로 표시합니다. 설치 파일은 인증된 관리자·운영 사용자와 개발자만 고정된 허용 목록에서 내려받을 수 있습니다.

라벨 출력은 가번호 부여 이후 사용자가 기능을 연 경우에만 프린터를 진단합니다. 서버는 요청 화면을 신뢰하지 않고 실제 일정의 `PREASSIGNED`·라벨 출력 설정을 다시 확인한 뒤 추적 가능한 ZPL 출력 작업을 만듭니다. 사용자별 멱등 키와 요청 지문으로 다른 요청의 payload 재사용을 막고, Web도 첫 작업 생성 요청이 진행 중일 때 두 번째 클릭이 작업을 중복 생성하지 못하도록 막습니다. 전송 결과는 `SENT` 또는 `FAILED`로 기록하며 실패 시 자동 재전송하지 않습니다. Browser Print 스크립트와 SDK callback에는 제한 시간이 적용되며, `SENT`는 물리 출력 완료가 아니라 데이터 전송 완료를 뜻합니다.

설치 화면의 다운로드 버튼은 프로젝트 루트 `drivers/` 폴더에 있는 아래 파일을 API를 통해 첨부파일로 제공합니다. API는 이 두 파일만 허용하며 임의 파일 경로나 폴더 목록은 노출하지 않습니다.

- `zd51177415-certified.exe`: Windows 프린터 드라이버
- `zebra-browser-print-windows-v132489.exe`: Zebra Browser Print

설치 파일 제공과 배포 범위는 Zebra 라이선스와 조직 내부 소프트웨어 배포 정책을 준수해야 합니다. 자세한 설치 순서는 `docs/driver-installation.md`를 참고하세요.

## 주요 명령

```bash
npm run dev
npm run build
npm run test
npm run test:coverage
npm run test:e2e
npm run typecheck
npm run check
npm run check:integration
npm run metrics:baseline
npm run db:setup
npm run db:migrate
npm run db:bootstrap
```

`db:setup`은 데이터베이스 생성, 마이그레이션, 누락 초기 계정 생성을 한 번에 수행합니다. `db:migrate`는 계정을 건드리지 않고 스키마만 준비하며, `db:bootstrap`은 이미 준비된 스키마에 누락 초기 계정만 생성합니다. 현재 소스와 로컬 검증 기준은 migration `001`~`026`이며, 적용 파일은 SHA-256 체크섬과 advisory lock으로 검증합니다. 실행 중에는 내부 `schema_migration.status`를 `APPLYING`→`APPLIED` 또는 `FAILED`로 기록하며, 중단·실패 상태가 남으면 승인된 forward repair나 전체 복원 전까지 다음 실행을 차단합니다. `026`은 HTTP request ID 계약에 맞춰 `audit_log.request_id`를 `VARCHAR(128)`로 확장한 현 모델 보강이며 목표 identity 모델 변경이 아닙니다. 이 로컬 검증은 운영 DB 배포 완료를 의미하지 않습니다.

`npm run check`는 DB 없이 코드 형식·lint·전체 타입 검사·단위/HTTP 경계 테스트·빌드를 수행합니다.
업무 서비스의 직접 SQL과 repository의 transaction 소유를 금지하는 architecture 회귀 테스트도 이
경계에 포함됩니다. 수험생·가번호 설정/부여·양식·출력의 실제 Controller/Guard/DTO HTTP 계약은
별도 업무 HTTP 경계 suite로 검증합니다.
`npm run check:integration`은 `.env`의 MariaDB 서버에 임시 `examcheck_it_<nonce>` 데이터베이스를
만들고 실제 병렬 트랜잭션을 검증한 뒤 자신이 만든 데이터베이스만 삭제합니다. 운영 `DB_NAME`은
통합 테스트에서 사용하지 않습니다. fresh DB뿐 아니라 N-1(`025`)에서 latest(`026`)로 올릴 때
기존 행이 보존되고 재실행 가능한지도 확인합니다. `npm run test:e2e`는 역할별 핵심 화면 3개를
HD(1366×768), HD+(1600×900), FHD(1920×1080), QHD(2560×1440) Chrome에서 검사하는 12개 smoke와
FHD 변경 작업 5개를 합쳐 총 17개 시나리오로 구성됩니다. 실행기는 매번
`examcheck_e2e_<nonce>` DB와 동적 API/Web 포트를 만들고 자신이 시작한 정확한 프로세스 PID만
종료한 뒤 DB 잔존 여부를 확인합니다. 작은 해상도에서는 핵심 요소 가시성과 가로 overflow를,
FHD/QHD에서는 세로 overflow와 반응형 확대 하한까지 확인합니다. 2026-08-28 최종 로컬 실행에서
17개 시나리오가 모두 통과했고 테스트 서버는 정상 종료됐으며 `examcheck_e2e_*` DB 잔존은 0건이었습니다.

`npm run metrics:baseline`은 환경변수나 DB 내용을 읽지 않고 source/test/CSS/migration의 파일·줄
수와 production build asset byte를 JSON으로 출력합니다. 수치는 리팩토링 중 고정 문구로 복사하지
않고 최종 build 직후 출력값을 실행 시각·commit과 함께 보존합니다.

2026-08-28 최초 commit 전 최종 로컬 snapshot에서는 API 67 files/463 tests, Web 59 files/193 tests,
MariaDB integration 10 files/37 tests가 통과했습니다. source-map-aware coverage는 API
statements/lines 86.88%, branches 82.02%, functions 87.65%, Web statements/lines 63.96%, branches
77.25%, functions 63.79%입니다. 전체 API build는 565,271B, Web build는 2,145,107B이며 정확한
소스·테스트·CSS·migration 수치는 [리팩토링 기준선](./docs/refactoring-baseline.md)에 기록합니다.

동일한 품질 게이트는 `.github/workflows/ci.yml`에 정의되어 있으며 MariaDB 11.4 통합 테스트와
브라우저 seed/smoke를 별도 작업으로 실행합니다. 최초 기준 commit `83c43e5`에 대한
[GitHub Actions Quality Gate](https://github.com/ahe45/ExamCheck/actions/runs/33125056778)에서
정적·단위·coverage, MariaDB integration, 브라우저 smoke가 모두 통과했습니다.

## 리팩토링과 운영 전환 문서

- [현재 아키텍처](./docs/architecture/current.md): 실제 모듈·데이터·검증 경계
- [목표 아키텍처](./docs/architecture/target.md): 의존 규칙과 승인 전 전환 구조
- [리팩토링 진행 현황](./docs/refactoring-status.md): 완료·부분 완료·외부 승인 대기 구분
- [리팩토링 기준선](./docs/refactoring-baseline.md): 초기 snapshot과 재현 가능한 측정 절차
- [데이터 모델 전환 게이트](./docs/data-model-cutover-gates.md): identity expand부터 legacy 삭제까지의 Go/No-Go
- [백업·복원 runbook](./docs/runbooks/backup-restore.md): 승인된 격리 위치가 정해진 뒤 수행할 절차
- [migration runbook](./docs/runbooks/migration.md): fresh, N-1, staging, 운영 단계별 실행·중단 기준

`apps/api/src/identity-transition`의 정규화·dry-run·shadow 비교 코드는 합성 fixture로 전환 규칙을
검증하기 위한 안전 도구입니다. 승인된 운영 복원본을 읽지 않으며 DB/API, backfill, dual-write,
read/write cutover에 연결되지 않았습니다. 개인정보 backup/restore, 027+ 목표 모델 migration,
레거시 데이터 삭제, 운영 cutover, Browser Print 재배포와 실제 GT800 검수는 별도 승인과 증거가
있기 전까지 완료로 보지 않습니다. 최초 기준 commit `83c43e5`와
`refactor-baseline-2026-08-28` 태그는 `origin/master`에 게시됐습니다.
