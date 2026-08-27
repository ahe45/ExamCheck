# 현재 아키텍처

> 기준일: 2026-08-28  
> 스키마 기준: migration `001`~`026`  
> 범위: 최초 기준 commit `83c43e5` / 태그 `refactor-baseline-2026-08-28`

## 시스템 경계

가번호 관리 시스템은 React Web과 NestJS API, MariaDB 11.4 호환 스키마로 구성된 모듈형
모놀리스다. Zebra GT800 출력은 핵심 가번호 업무와 분리된 선택 기능이며, 브라우저의 Zebra
Browser Print 어댑터가 서버에서 생성한 ZPL 작업을 전송한다.

```text
React Web
  ├─ 로그인 / 관리자 / 개발자 / 사용자 운영 화면
  ├─ 공통 API client, Dialog, Toast, Grid, navigation guard
  ├─ ExamList 양식 편집기 adapter와 PDF projection
  └─ PrinterAdapter (mock 또는 Browser Print)
          │ HTTPS/JSON·multipart
NestJS API
  ├─ AuthGuard + permission matrix + admission scope
  ├─ Controller + DTO + 공통 오류/request ID
  ├─ Application/Service: 정책·트랜잭션·감사 orchestration
  ├─ Repository: SQL·row mapping
  └─ 파일 검증 / Excel·ZIP / ZPL 렌더링 adapter
          │ mysql2 prepared statement
MariaDB
  ├─ candidate_record / examinee
  ├─ pseudonym_setting / range / assignment / operation
  ├─ form_template / label_template / print_job
  └─ app_user / admission assignment / audit / system_profile
```

## Web 구조

- `features/app-shell`: 세션, 시스템 프로필, 프린터 runtime과 역할별 route 조립
- `features/candidates`: 관리자 수험생 그리드, XLSX·사진 ZIP 업로드
- `features/setup`: 대시보드와 전형별 가번호 설정
- `features/developer`: 학교·학년도·로고와 번호 유일 정책
- `features/accounts`: 계정과 전형 접근 범위
- `features/candidate`: 교시 선택, 수험생 조회, 가번호 부여·마감·인쇄
- `features/templates`: 목록, 메타데이터, 편집기 workspace, PDF projection
- `shared/api`, `shared/components`, `shared/hooks`, `shared/navigation`: 공통 계약

서버 상태 호출은 `shared/api` 경계를 통해 수행한다. 인증·세션·교시·개발자 설정과 신규 집계·업로드
같은 고위험 응답은 런타임 schema로도 확인하고, 형식이 맞지 않으면 공통 안전 오류로 처리한다.
대시보드와 전형 설정 overview는 TanStack Query를 사용하며 각각 목적별 집계 API와 최대 3회의
고정 batch query를 사용해 전체 수험생 row 전송과 전형별 N+1을 피한다. 역할별 그리드는 공통 정렬·필터 상태와
헤더를 사용하되 페이지네이션, 열 정의와 행 동작은 화면 adapter로 유지한다. 편집기 본체와 CSS는
편집 route에서만 지연 로딩하며 일반 PDF 출력은 패키지의 `core` 진입점만 사용한다.

## API 구조와 의존 방향

업무 모듈은 Controller → Service/Application → Repository 순서로 의존한다.

- Controller: DTO 검증이 끝난 입력과 인증 사용자를 전달한다.
- Service/Application: 권한 이후의 업무 불변조건, 트랜잭션, 감사 순서를 소유한다.
- Repository: SQL, 잠금 질의, row mapping만 소유하며 transaction을 시작하거나 commit하지 않는다.
- Domain/helper: DB와 HTTP를 모르는 순수 검증·계산을 제공한다.

수험생, 인증, 개발자 설정, 계정, 양식, 워크스테이션, 인쇄 작업과 가번호 업무는 repository
경계를 사용한다. 로그인 보안 감사 writer와 health probe는 그 자체가 인프라 adapter이므로 작은
직접 DB 경계를 유지한다.

상태 mutation 감사는 가능한 경우 업무 write와 같은 connection/transaction에 기록한다. 로그인
실패처럼 업무 transaction이 없는 이벤트는 별도 인증 감사 writer를 사용한다. HTTP request ID는
비동기 context를 통해 요청 로그와 mutation 감사에 전달된다. migration `026`은 이 HTTP 계약의
최대 길이 128자와 맞도록 `audit_log.request_id`를 `VARCHAR(128)`로 확장한다. 이는 현 모델의 감사
상관관계 저장 폭 보강이며 목표 identity 모델의 schema/data 전환이 아니다.

## 현재 데이터 모델의 의미

- 수험생 일정의 현재 식별 행은 `candidate_record`다.
- `examinee`는 활성 상태와 레거시 호환을 위해 함께 존재하므로 아직 완전한 단일 원본이 아니다.
- 가번호 할당은 가능한 경우 `candidate_record_id`와 결정적 schedule scope key를 기록한다.
- 개발자 설정의 기본 유일 정책은 수험번호 `SYSTEM`, 가번호 `ADMISSION`이다.
- 개발자는 수험번호를 `SYSTEM/SCHEDULE`, 가번호를 `ADMISSION/SCHEDULE`로 바꿀 수 있다.
- 더 강한 범위로 전환할 때 aggregate 충돌 진단을 먼저 수행하고 충돌 시 transaction 전체를
  취소한다. 오류에는 수험번호·가번호·이름 원문을 포함하지 않는다.
- migration `019` 이전 할당 중 정확히 한 일정과 매핑되는 행만 연결하며, 자동 판정할 수 없는
  레거시 행은 삭제하지 않는다. 일정별 정책에서도 이 미매핑 행의 번호는 전형 전체 예약 번호로
  취급해 새 일정에서 재사용하지 않는다.

수험생 XLSX·사진 ZIP 미리보기는 actor, 파일 checksum, 후보 DB snapshot, 만료 시각을 HMAC 서명한
stateless ticket을 발급한다. XLSX snapshot에는 수험번호 유일 정책도 포함한다. 반영 use case는 같은
파일과 사용자인지 검증하고 transaction lock 뒤 snapshot을 다시 확인한 후에만 선택 정책으로 실행
계획과 감사 기록을 만든다. 이 경계는 현재 동기 브라우저 업로드의 TOCTOU를 차단하지만 durable
staging/import batch나 대용량 재개 기능을 의미하지 않는다.

이 모델은 현재 업무를 안전하게 유지하는 수직 슬라이스다. 독립 시험 주기·일정·등록 identity와
dual-write/cutover는 아직 적용하지 않았다.

## 실행·검증 경계

- `npm run check`: format, lint, API/Web 타입, 단위·HTTP 경계, build
- `npm run check:integration`: nonce MariaDB의 migration·동시성·rollback·정책 검증
- `npm run test:e2e`: 매 실행마다 별도 nonce DB와 동적 포트를 사용하는 역할·업무 브라우저 검증
- `npm run metrics:baseline`: 비민감 소스·테스트·CSS·migration·build 크기 수집

운영 DB, 개인정보 backup, 실제 GT800와 승인된 golden screenshot은 로컬·원격 자동 검증
경계 밖이다. 원격 Quality Gate는 기준 commit에서 통과했다.
