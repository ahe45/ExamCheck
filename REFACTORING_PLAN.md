# 가번호 관리 시스템 상세 리팩토링 계획서

> 작성일: 2026-08-27  
> 대상 저장소: `examcheck`  
> 문서 상태: 실행 중인 기준 계획(진행 증거는 `docs/refactoring-status.md`에서 관리)  
> 원칙: 이 문서는 기능을 새로 설계하는 문서가 아니라, 현재 동작과 데이터를 보존하면서 구조·품질·안전성을 단계적으로 개선하기 위한 기준 문서다.
> 기준 상태: 최초 기준 commit `83c43e5`, 태그 `refactor-baseline-2026-08-28`  
> 측정 환경: Windows NT 10.0.26200.0, Node.js 24.14.0, npm 11.9.0, Vite production build  
> 최초 분석 대상 schema: migration `018_drop_account_display_name.sql`까지  
> 현재 적용·검증 기준: migration `026_expand_audit_request_id.sql`까지. 기존 `001`~`025`는 불변이며, 목표 identity migration은 승인 후 `027` 이상만 사용

---

## 1. 요약 결론

현재 프로젝트는 로그인과 권한 분기, 수험생 데이터 업로드, 전형별 시스템 설정, 네 가지 가번호 부여 방식, 운영 마감, 양식 편집 및 PDF 생성, Zebra 프린터 연동 등 핵심 업무 범위를 빠르게 구현한 상태다. 기능 시제품으로서는 충분한 범위를 갖췄지만, 요구사항이 누적되면서 다음 세 가지 결합도가 빠르게 높아졌다.

1. 프런트엔드 화면 컴포넌트가 네트워크 요청, 업무 상태, 애니메이션, 출력, 그리드 상태를 함께 관리한다.
2. 백엔드 서비스가 업무 규칙, 권한 검사, 트랜잭션, Raw SQL, 파일 처리, Excel 생성까지 함께 관리한다.
3. `candidate_record`, `examinee`, 가번호 설정·할당 테이블의 책임과 고유성 범위가 완전히 일치하지 않는다.

따라서 이번 리팩토링은 폴더 이동이나 CSS 전면 재작성부터 시작하면 안 된다. 권장 순서는 다음과 같다.

1. **현 상태를 되돌릴 수 있는 기준점으로 고정한다.**
2. **업무 불변조건과 가번호 고유 범위를 확정한다.**
3. **DB·API·브라우저 특성화 테스트와 CI를 먼저 만든다.**
4. **비밀번호 초기화, 인증 기본값, 마이그레이션, 동시성 등 P0 위험을 먼저 제거한다.**
5. **DB는 expand → backfill → 검증 → 전환 → contract 순서로 점진 변경한다.**
6. **백엔드는 수직 기능 단위로 use case와 repository를 분리한다.**
7. **프런트엔드는 앱 셸·API 계층·공통 UI를 만든 뒤 화면을 하나씩 이관한다.**
8. **마지막에만 레거시 테이블, 죽은 코드, 미사용 CSS와 자산을 제거한다.**

현재 규모에는 마이크로서비스 전환, 전면 ORM 교체, UI 프레임워크 전면 교체가 필요하지 않다. **React + NestJS + 현재 MySQL 호환 운영 DB 기반의 모듈형 모놀리스**를 유지하면서 경계를 명확히 하는 것이 위험과 비용 대비 가장 적절하다. 정확한 DB 제품과 버전은 Phase 1 inventory 후 ADR로 확정한다.

### 1.1 한 페이지 실행 순서

| 순서 | 실행 단위                        | Go 조건                                                     | 주요 승인 역할                |
| ---: | -------------------------------- | ----------------------------------------------------------- | ----------------------------- |
|    1 | 업무 규칙·용어·지원 환경 확정    | 가번호 unique scope와 교시/세부 범위 계층 승인              | 제품 책임자, 현장 업무 책임자 |
|    2 | 저장소·DB·화면 기준선            | 기준 commit/tag, DB 복원 성공, 민감 자산 격리               | Tech Lead, DBA, 보안 담당     |
|    3 | 최소 운영 DB/API 특성화 harness  | P0 결함을 재현할 수 있음                                    | Backend, QA                   |
|    4 | P0 hotfix                        | 계정 초기화·권한·기본 secret·동시성·cursor 회귀 테스트 통과 | Backend, DBA, 보안 담당       |
|    5 | 전체 CI·브라우저 안전망          | 역할별 E2E와 FHD/QHD baseline 확보                          | Frontend, QA                  |
|    6 | 공통 계약·인프라                 | 오류·권한·감사·config·migration 경계 검증                   | Tech Lead, Backend            |
|    7 | 데이터 모델 수직 전환            | 하위 기능별 old/new 결과 mismatch 허용치 충족               | 제품 책임자, DBA              |
|    8 | 프런트 앱 셸·공통 UI·그리드 전환 | 기존 UX와 접근성·반응형 기준 통과                           | Frontend, QA, UI 승인자       |
|    9 | 업로드/양식/출력 독립 개선       | 각 파이프라인의 별도 완료 기준 충족                         | 기능별 책임자                 |
|   10 | 운영 전환·관찰                   | staging, 지표, alert, 배포 호환 matrix 통과                 | 운영, Tech Lead               |
|   11 | 신규 모델 canonical 전환         | 관찰 기간 또는 승인 처리량 동안 mismatch 0                  | 제품 책임자, DBA              |
|   12 | legacy contract 제거             | 별도 파괴적 변경 승인과 restore rehearsal                   | DBA, 운영 책임자              |

이 표의 순서는 완전한 선형 일정이 아니라 의존성 DAG다. 예를 들어 P0 hotfix는 최소 테스트 harness 직후 진행하고, Playwright·시각 회귀 기반의 확장은 병행할 수 있다. 반면 데이터 contract 삭제는 모든 관찰과 승인 후에만 진행한다.

---

## 2. 리팩토링 목표와 비목표

### 2.1 목표

- 현재 관리자·사용자·개발자 권한과 화면 흐름을 유지한다.
- 추첨, 순차부여, 매칭, 사전부여의 업무 규칙을 코드와 DB 제약에서 동일하게 표현한다.
- 수험생 데이터, 교시, 전형, 가번호 범위, 할당, 마감의 관계를 명시적으로 정규화한다.
- 리팩토링 중 데이터 손실·중복 가번호·마감 후 추가 등록이 발생하지 않도록 한다.
- 공통 그리드, 버튼, 모달, 토스트, 필터, 아이콘, 반응형 기준을 재사용 가능한 구조로 만든다.
- API 계약, 오류 형식, 권한 정책, 감사 로그, 설정 검증을 중앙화한다.
- FHD와 QHD에서 현재 승인된 UI를 보존하고, 실제 브라우저 검수를 자동화한다.
- 양식 편집기와 Zebra Browser Print를 교체 가능한 어댑터 경계로 격리한다.
- 빌드, 테스트, 마이그레이션, 배포, 백업·복원 절차를 반복 가능하게 만든다.
- 신규 요구사항을 작은 기능 단위로 안전하게 추가할 수 있는 구조를 만든다.

### 2.2 비목표

이번 리팩토링의 기본 범위에는 다음을 포함하지 않는다.

- 마이크로서비스 분리
- React, NestJS, 현재 MySQL 호환 운영 DB의 전면 교체. 단, 실제 DB 제품 확인 결과에 따른 호환성 보정은 포함한다.
- 모든 Raw SQL을 한 번에 ORM으로 변환
- 화면 디자인의 전면 재설계
- 업무 담당자 승인 없이 가번호 정책을 임의로 변경
- Browser Print 대신 별도 로컬 에이전트를 즉시 도입
- 기존 운영 데이터의 자동 정리 또는 삭제
- 기능 추가와 구조 변경을 한 번에 수행하는 대규모 재작성

기능 변경이 필요한 경우에는 별도의 요구사항과 인수 기준을 만들고, 리팩토링 변경과 가능한 한 다른 작업 단위로 분리한다.

---

## 3. 분석 범위와 현재 기준선

### 3.1 분석 대상

- 루트 npm workspace와 스크립트
- `apps/web`: React 19, TypeScript 5.9, Vite 7
- `apps/api`: NestJS 11, `mysql2/promise`를 사용하는 MySQL 호환 DB 서버. 실제 운영 제품이 MySQL인지 MariaDB인지와 정확한 버전은 착수 시 확인해야 한다.
- SQL 마이그레이션 001~~018(최초 분석 범위, 현재 진행 상태는 001~~026)
- 수험생 XLSX·사진 ZIP 처리
- 양식 편집기 패키지와 HTML/PDF 렌더링
- Zebra Windows 드라이버, Browser Print, Print Job 흐름
- 테스트, 문서, 환경변수, 레거시 설치 자산, 저장소 상태

### 3.2 정량 기준선

분석 시점의 대략적인 규모는 다음과 같다. 아직 기준 commit이 없으므로 모두 **2026-08-27 현재 작업 디렉터리 snapshot** 수치다. `node_modules`, 각 앱의 `dist`, 레거시 `setup/` 내부 소스는 애플리케이션 줄 수에서 제외했고, 실제 제품 소스·테스트·migration만 포함했다. 기준 commit 생성 후에는 같은 측정 스크립트를 `tools/metrics/collect-baseline`과 같은 위치에 고정해 재현 가능하게 만든다.

| 항목                              |               현재 상태 |
| --------------------------------- | ----------------------: |
| 프런트엔드 소스                   |              약 6,526줄 |
| 백엔드 운영 TypeScript            |              약 3,401줄 |
| TypeScript/TSX 파일               |                약 108개 |
| SQL 마이그레이션                  |          18개, 약 488줄 |
| 전역 CSS                          |            1개, 1,784줄 |
| Web 테스트                        |   6개 파일, 15개 테스트 |
| API 테스트                        |   4개 파일, 13개 테스트 |
| 총 자동 테스트                    |                    28개 |
| 작업공간의 미추적 레거시 `setup/` | 2,209개 파일, 약 383MiB |

복잡도가 집중된 주요 파일은 다음과 같다.

| 파일                                                          |                   규모/특징 | 주요 책임                                                      |
| ------------------------------------------------------------- | --------------------------: | -------------------------------------------------------------- |
| `apps/api/src/pseudonyms/pseudonyms.service.ts`               |                    약 707줄 | 설정, 범위, 추첨, 순차, 매칭, 사전부여, 마감, 감사, Excel, SQL |
| `apps/web/src/features/candidate/PseudonymAssignmentPage.tsx` | 약 714줄, 로컬 상태 약 38개 | 조회, 사진, 추첨, 마감, 출력, PDF, 필터, 그리드, 모달          |
| `apps/web/src/features/templates/FormTemplateManager.tsx`     |                    약 488줄 | 목록, 메타데이터, 편집기 생명주기, 저장, 미리보기              |
| `apps/api/src/candidates/candidates.service.ts`               |                    약 405줄 | XLSX, 비교, 저장, 사진 ZIP, export, operational sync           |
| `apps/web/src/features/setup/SystemSettingsPage.tsx`          |                    약 384줄 | 설정 초안, 범위 그리드, 일괄설정, 저장·이탈 확인               |
| `apps/web/src/styles.css`                                     |                     1,784줄 | 로그인, 관리자, 사용자, 모달, 그리드, 편집기 override 전체     |

### 3.3 검증 기준선

2026-08-27 분석 시점에 다음 명령은 모두 성공했다.

- `npm run typecheck`: API/Web 성공
- `npm test`: API 13개 + Web 15개, 총 28개 성공
- `npm run build`: API/Web 성공

현재 Web 프로덕션 빌드의 주요 산출물은 다음과 같다.

| 산출물            |      Raw |     Gzip |
| ----------------- | -------: | -------: |
| 메인 JS           | 938.46kB | 246.47kB |
| CSS               | 308.19kB |  44.89kB |
| jsPDF chunk       | 390.27kB | 128.73kB |
| html2canvas chunk | 202.36kB |  48.04kB |

Vite는 메인 JS가 500kB를 초과한다는 경고를 출력한다. 관리자 양식 관리, PDF 생성, 프린터 설정처럼 항상 필요하지 않은 기능을 route 또는 기능 단위로 지연 로딩할 여지가 크다.

현재 28개 테스트의 성공은 유용한 출발점이지만, 실제 운영 DB transaction, HTTP endpoint, 브라우저 DOM, 동시 요청, 실제 Zebra 장비를 검증하지 않는다. 따라서 “현재 테스트 성공”을 운영 안정성의 증거로 해석하지 않고, 이후 추가할 특성화 테스트의 최소 기준으로만 사용한다.

### 3.4 재현 가능한 기준선 수집 항목

기준 commit을 만든 뒤 다음 정보와 명령을 자동 수집한다.

- Git commit/tag와 dirty 상태
- OS, Node, npm, 브라우저, Windows 화면 배율
- DB 제품·정확한 버전, `sql_mode`, server/session timezone, charset, collation, 대소문자 비교 정책, CHECK 제약 적용 여부
- 주요 테이블 row 수와 DB 총 용량
- `npm ci`, `npm run typecheck`, `npm test`, `npm run build` 결과
- 소스 파일·줄 수의 포함/제외 규칙
- route별 JS/CSS gzip 크기
- API endpoint별 대표 응답 시간과 payload
- viewport·seed·frozen clock이 고정된 화면 캡처

현재 로컬 Node 24는 측정 환경일 뿐 최종 운영 표준 버전이 아니다. Phase 1에서 조직이 지원할 Node LTS와 package manager 버전을 별도로 고정한다.

### 3.5 저장소 기준선 위험

현재 Git 저장소에는 정상적인 최초 기준 커밋이 없다. 인덱스에 잡힌 파일은 소수이며 대부분의 프로젝트가 미추적 상태다. 따라서 리팩토링 전후 차이를 신뢰성 있게 비교하거나 특정 기능 단위로 롤백하기 어렵다.

리팩토링을 시작하기 전 반드시 다음을 수행해야 한다.

- 커밋 대상과 제외 대상을 검토한다.
- 민감정보와 대용량 레거시 자산을 격리한다.
- 현재 동작이 검증된 기준 커밋을 만든다.
- 기준 태그 `refactor-baseline-2026-08-28`을 생성한다.
- 이후 변경은 작고 독립적인 작업 단위로 커밋한다.

이 작업은 사용자 승인 없이 기존 파일을 삭제하거나 이동해서는 안 된다. 특히 `setup/`, DB 백업, 드라이버, 양식 패키지는 보관 정책을 먼저 확정한다.

---

## 4. 현재 아키텍처 요약

### 4.1 요청 흐름

```text
브라우저
  ├─ 로그인/관리자/교시선택/운영 화면
  ├─ 수험생 XLSX·사진 ZIP 업로드
  ├─ 양식 편집기 및 브라우저 PDF 생성
  └─ Zebra Browser Print
        ↓
React App
  ├─ App.tsx의 세션·권한·경로 분기
  ├─ 화면별 useState/useEffect
  ├─ shared/api의 fetch wrapper 및 일부 직접 fetch
  └─ 전역 styles.css
        ↓
NestJS Controller
  ├─ AuthGuard / RolesGuard
  ├─ ValidationPipe
  └─ 기능별 Service
        ↓
Service
  ├─ 업무 규칙
  ├─ 권한/전형 범위 확인
  ├─ 트랜잭션
  ├─ Raw SQL 및 row mapping
  ├─ Excel/ZIP/HTML/ZPL 처리
  └─ 일부 감사 로그
        ↓
MySQL 호환 운영 DB
```

### 4.2 현재 잘 되어 있는 부분

리팩토링은 이미 잘 분리된 경계를 보존하면서 진행해야 한다.

- TypeScript `strict`가 Web/API 모두 활성화돼 있다.
- 대부분의 SQL이 prepared statement를 사용한다.
- 가번호 핵심 변경에는 트랜잭션과 DB unique 제약을 사용한다.
- 무작위 추첨은 `crypto.randomInt`를 사용한다.
- 글로벌 ValidationPipe에 whitelist, forbidNonWhitelisted, transform이 적용돼 있다.
- 권한별 메뉴와 전형 접근 범위가 이미 구현돼 있다.
- `PrinterService`와 `PrinterAdapter`는 좋은 추상화 출발점이다.
- 드라이버 다운로드 파일은 allowlist로 제한돼 있다.
- ZPL 치환값에서 제어문자를 제거한다.
- SQL 마이그레이션이 파일 단위로 관리되고 있다.
- FHD/QHD UI 요구와 현장 프린터 제약이 기존 문서에 비교적 자세히 기록돼 있다.

---

## 5. 리팩토링 핵심 원칙

### 5.1 동작 보존 우선

- 먼저 현재 동작을 테스트로 기록하고 그다음 코드를 이동한다.
- 구조 변경 PR에 새로운 업무 규칙을 섞지 않는다.
- API 응답 형태와 URL은 전환 기간 동안 호환 facade를 유지한다.
- DB는 새 구조를 먼저 추가하고 검증 전에는 기존 구조를 삭제하지 않는다.

### 5.2 작은 수직 단위

`공통 폴더를 한 번에 재편`하는 대신 다음처럼 사용자가 확인할 수 있는 수직 기능 단위로 옮긴다.

1. 수험생 목록 조회
2. 계정 관리
3. 전형 설정 조회·저장
4. 가번호 단건 부여
5. 마감·재개
6. 양식 저장·출력
7. 수험생 업로드

각 단위는 테스트, 데이터 접근, UI, 문서까지 완결한 뒤 다음 단위로 이동한다.

### 5.3 업무 규칙과 기술 세부사항 분리

- 가번호 범위·부여·마감 규칙은 React 상태나 SQL 문자열 안에 두지 않는다.
- 트랜잭션 경계는 application use case가 소유한다.
- SQL과 DB row mapping은 repository 구현에 둔다.
- Controller는 DTO 검증, 사용자 컨텍스트 전달, 응답 변환만 담당한다.
- React page는 라우팅·권한·컴포넌트 조립만 담당하도록 축소한다.

### 5.4 데이터 변경은 expand-contract

```text
새 테이블/컬럼 추가
  → 기존 데이터 backfill
  → old/new 결과 비교
  → read 전환
  → write 전환
  → 관찰 기간
  → 기존 구조 제거
```

기존 001~025 마이그레이션은 수정하지 않는다. 026은 감사 request ID 폭만 넓힌 현 모델의
forward-only 보강이며 목표 identity 모델 변경과 무관하고, 적용 후에는 이 파일도 수정하지 않는다.
목표 identity 모델을 포함한 이후 변경은 027 이상의 forward-only 마이그레이션으로 추가한다. 아래에서
019 이후를 예고한 문장은 최초 계획 당시의 번호이며 현재 manifest 기준으로 다시 번호를 배정한다.

### 5.5 실제 브라우저·운영 DB와 동일한 제품 검증

- DB 통합 테스트는 SQLite 대체가 아니라 Phase 1에서 확인한 운영 DB와 같은 제품·major version에서 수행한다.
- UI는 1920×1080, 2560×1440, 1600×900, 1366×768에서 검수한다.
- 양식 편집기는 실제 ExamList 화면과 golden screenshot으로 비교한다.
- Zebra 출력은 mock 자동 테스트와 실제 Windows/GT800 수동 시험을 분리한다.

---

## 6. 업무 담당자와 먼저 확정해야 할 결정

다음 항목은 단순한 구현 세부사항이 아니라 DB 고유 제약과 마이그레이션 결과를 바꾸는 업무 결정이다. **데이터 모델 변경 단계에 들어가기 전에 서면으로 확정해야 한다.**

### 6.1 가번호와 일정의 관계

1. 동일 수험번호가 서로 다른 날짜·교시·전형에 여러 번 등장할 수 있는가?
2. 가번호는 전형 전체에서 유일한가, 날짜·교시별로 재사용 가능한가?
3. 모집단위·전공·건물·고사실까지 가번호 유일 범위를 나눌 수 있는가?
4. `동일 시작 번호 적용`은 서로 다른 범위에서 같은 번호 재사용을 의미하는가?
5. 사전 가번호의 유일성 범위도 일반 가번호와 동일한가?
6. 표시 형식 `001`과 `1`은 같은 가번호인가?

업무 용어와 코드값은 Phase 0에서 아래 표로 고정한다. 현재 코드의 매핑은 다음과 같으며, “매칭”은 **가번호 직접 입력 방식**을 의미한다.

| 업무 표시명 | 설정/DB code  | 할당 API code | 사용자 입력                 | 범위 설정                     | 부가 설정                    |
| ----------- | ------------- | ------------- | --------------------------- | ----------------------------- | ---------------------------- |
| 추첨        | `DRAW`        | `RANDOM`      | 수험번호, 선택 시 추첨 버튼 | 필요                          | 자동추첨, 지연시간, 일괄추첨 |
| 순차부여    | `SEQUENTIAL`  | `SEQUENTIAL`  | 수험번호                    | 필요                          | 다음 미사용 번호 사용        |
| 매칭        | `MATCHING`    | `MANUAL`      | 수험번호와 직접 입력 가번호 | 업무 승인 필요                | 입력값 중복·허용 범위 검증   |
| 사전부여    | `PREASSIGNED` | `PREASSIGNED` | 수험번호, 업로드된 사전값   | 일반 범위 사용 여부 승인 필요 | 라벨 출력 사용 여부          |

설정 code와 실행 code가 다른 이유를 계약에 명시하고, Web/API/DB가 임의의 별칭을 추가하지 못하도록 canonical enum을 한 곳에서 생성한다.

### 6.2 시험 주기와 일정 계층

1. `exam_cycle`은 학년도만으로 식별하는가, 같은 학년도에 여러 시험 주기를 허용하는가?
2. 현재 하드코딩된 `DEFAULT_EXAM_NAME`, `examinee.exam_name`, `system_profile.academic_year`가 다르면 backfill 우선순위는 무엇인가?
3. 학년도 변경 시 기존 수험생·설정·양식을 새 cycle과 어떻게 분리하는가?
4. 교시 선택·마감 단위는 `전형+날짜+시간+교시명`인가?
5. 모집단위·전공·건물·고사실은 교시 하위의 별도 segment인가?
6. 마감은 교시 전체 operation slot에 적용하는가, 세부 segment에 적용하는가?

### 6.3 업로드와 기존 운영 데이터의 관계

1. 동일 수험생·교시 데이터를 재업로드하면 기존 가번호를 유지하는가?
2. 업로드 파일에서 사라진 수험생은 삭제, 비활성, 유지 중 무엇인가?
3. 이미 마감된 교시의 수험생 데이터를 수정할 수 있는가?
4. 전형명이나 교시명이 변경되면 기존 계정 배정과 설정을 어떻게 이전하는가?
5. 사진은 수험생 개인 기준인가, 특정 일정 등록 기준인가?

### 6.4 마감·재개 정책

1. 마감 후 어떤 필드와 기능을 잠가야 하는가?
2. 결시자 자동 가번호는 실제 등록과 동일한 assignment인가, 별도 결시 기록인가?
3. 마감 해제 시 결시자 정보 삭제 옵션이 기존 수동 할당에는 영향을 주지 않아야 하는가?
4. 동일 교시에 여러 운영자가 접속할 때 마감 권한과 충돌 처리는 어떻게 할 것인가?
5. 마감·재개 요청은 반복 호출해도 같은 결과를 반환하는 멱등 동작이어야 하는가?

### 6.5 계정·권한·감사 정책

1. 개발자 계정은 단일 계정인가, 복수 계정을 허용하는가?
2. 전형 미배정 사용자의 전체 접근 규칙을 계속 유지하는가?
3. `VIEWER` 역할은 제거할 것인가, 읽기 전용 역할로 정식 지원할 것인가?
4. 계정 삭제는 실제 삭제가 아니라 비활성화로 계속 운영할 것인가?
5. 감사 로그와 수험생 사진·출력 이력의 보관 기간은 얼마인가?

### 6.6 인증·브라우저·배포 환경

1. 인증의 최종 모델을 `HttpOnly/Secure/SameSite cookie + CSRF`로 할지, Bearer token으로 유지할지 확정한다.
2. Bearer를 유지하면 저장 위치, XSS 대응, 만료·갱신·폐기 정책을 정한다.
3. 현재 sessionStorage key는 이관 기간에만 호환하고 제거 시점과 migration을 정한다.
4. 현장 Windows에서 지원할 Edge/Chrome 최소 버전과 Browser Print 호환 버전을 정한다.
5. `100dvh`, `inert`, container query를 지원하지 않는 브라우저의 fallback을 정한다.
6. Windows 화면 배율 100%, 125%, 150% 중 공식 지원 범위를 정한다.
7. CI 플랫폼, 운영 DB test 환경, Playwright 실행 환경, Windows 하드웨어 runner 방식을 정한다.
8. Web 정적 서버, API 프로세스, reverse proxy, TLS, SPA history fallback, secret 저장소를 정한다.

각 결정은 ADR(Architecture Decision Record)에 기록하고, DB 제약·API 테스트·UI 문구가 같은 규칙을 사용하도록 한다.

---

## 7. 우선순위별 문제 목록

## 7.1 P0 — 구조 변경 전 또는 초기에 반드시 해결

P0 항목은 근거 수준을 함께 관리한다. “가설”이나 “업무 결정 대기”는 수정부터 하지 않고 실패 재현 또는 데이터 진단을 먼저 수행한다.

| 항목                             | 현재 근거 상태                                                  |
| -------------------------------- | --------------------------------------------------------------- |
| Git 기준점 부재                  | 작업 디렉터리로 확인                                            |
| 레거시 자산·민감정보             | 파일 존재 확인, 실제 자격증명/개인정보 여부는 권한 감사 대기    |
| `db:setup` 계정 덮어쓰기         | 코드로 확인                                                     |
| 일정 모델과 가번호 모델 불일치   | 코드로 확인, 실제 복수 일정 데이터 영향은 업무/데이터 확인 대기 |
| close vs assign 경쟁             | 잠금 순서상 위험 확인, 결정적 병렬 재현 대기                    |
| 설정 저장 cursor 초기화          | 코드로 확인                                                     |
| DDL 부분 적용 위험               | DB 특성상 확인, 실제 서버 제품·버전 확인 대기                   |
| 기본 secret/비밀번호 fallback    | 코드로 확인                                                     |
| 일반 계정 API의 개발자 대상 보호 | 코드 경계로 확인                                                |
| 양식 HTML 신뢰 경계              | 코드로 확인, 기존 양식 영향 report-only 진단 대기               |

### P0-1. Git 기준점과 롤백 경로 부재

**현상**  
정상적인 최초 커밋이 없어 현재 상태와 리팩토링 상태를 안정적으로 비교할 수 없다.

**위험**

- 회귀가 발생해도 변경 단위를 특정하기 어렵다.
- DB/API/UI 변경을 함께 되돌리기 어렵다.
- 대용량 레거시 파일과 민감 파일이 실수로 첫 커밋에 들어갈 수 있다.

**조치**

- 커밋 대상 파일 목록을 검토한다.
- `.env`, 로그, 빌드 산출물, DB 원본, 레거시 자산 정책을 확인한다.
- typecheck/test/build 및 화면 캡처 후 기준 커밋과 태그를 만든다.
- 이후 기능별 작은 커밋과 변경 기록을 유지한다.

### P0-2. `setup/` 레거시 설치 자산과 민감정보 위험

**현상**  
`setup/`에는 약 2,209개 파일, 383MiB의 기존 프로그램 자산이 있고 설정 파일과 MDB 데이터 파일이 포함돼 있다. 해당 내용이 실제 운영 계정이나 개인정보인지 본 계획에서는 판단하지 않았다.

**위험**

- 소스 저장소에 자격증명 또는 개인정보가 들어갈 수 있다.
- Git 저장소가 대용량 바이너리로 급격히 커진다.
- 서명되지 않은 레거시 실행 파일이 최신 배포물과 혼동될 수 있다.

**조치**

- 권한 있는 담당자가 설정 계정의 유효성과 MDB의 개인정보 포함 여부를 확인한다.
- 실제 자격증명이면 즉시 회전한다.
- 레거시 자산은 접근 제한 저장소로 이동하고 소스 저장소에는 체크섬·목록·분석 문서만 둔다.
- 불가피한 바이너리는 Git LFS 또는 별도 artifact 저장소를 사용한다.
- Zebra 드라이버는 SHA-256, 원본 URL, 버전, 취득일, 재배포 승인 근거를 매니페스트로 관리한다.

### P0-3. `db:setup`이 기존 계정 비밀번호를 초기화

**근거**  
`apps/api/src/database/setup.ts`의 seed는 `ON DUPLICATE KEY UPDATE`에서 `password_hash`, role, enabled를 다시 기록한다. README의 “계정이 없을 때만 생성” 설명과 다르다.

**위험**

- 관리자·사용자·개발자가 변경한 비밀번호가 setup 재실행 후 초기값으로 돌아간다.
- 운영에서 알려진 초기 비밀번호로 되돌아가는 보안 사고가 발생할 수 있다.

**조치**

- 스키마 마이그레이션과 초기 계정 bootstrap을 분리한다.
- 기본 seed는 계정이 없을 때만 insert하고 기존 password/role/enabled를 변경하지 않는다.
- 강제 비밀번호 재설정은 별도 CLI와 명시적 대상, 감사 로그를 요구한다.
- 운영에서는 `1234` 기본 bootstrap을 금지하고 최초 로그인 변경 정책을 둔다.

**완료 기준**

- 설정 변경 후 `db:setup`을 반복해도 hash, role, enabled가 바뀌지 않는다.
- 이 동작을 운영 DB 통합 테스트로 고정한다.

### P0-4. 수험생 일정 모델과 가번호 할당 모델 불일치 가능성

**현상**

- `candidate_record`는 수험번호+날짜+시간+교시 단위 데이터를 보관한다.
- 기존 `examinee`는 수험번호당 한 행이다.
- `pseudonym_assignment`는 `examinee_id`를 참조하고 수험생당 하나의 할당을 허용한다.
- 업로드 동기화 과정에서 일정 정보가 기존 `examinee` 한 행으로 합쳐진다.

**위험**

- 같은 수험번호가 여러 일정에 있으면 한 교시의 가번호가 다른 교시에도 표시될 수 있다.
- 두 번째 일정에서 별도 가번호를 부여하지 못할 수 있다.
- 라벨과 명단에 마지막으로 덮인 일정 정보가 사용될 수 있다.

**조치**

- 6장의 업무 결정을 확정한다.
- `candidate`와 `candidate_registration` 또는 `candidate_schedule`을 분리한다.
- 가번호 할당은 특정 일정 등록 행을 참조한다.
- old/new 모델을 병행 채우고 결과를 비교한 뒤 전환한다.

### P0-5. 마감과 가번호 부여의 동시성 경쟁

**현상**  
할당이 일반 조회로 미마감 상태를 확인한 뒤 다른 행을 잠그고, 마감은 별도 잠금 순서를 사용한다. 요청 순서에 따라 마감 완료 직후 이미 시작된 할당이 통과할 가능성이 있다.

**조치**

- 현재 열린 교시에 operation 행이 없을 수 있으므로 assign/close가 모두 멱등적으로 open row를 먼저 보장한 뒤 `FOR UPDATE`로 잠근다.
- candidate를 먼저 비잠금 식별해 scope를 계산한 뒤 `operation → policy/range`를 잠그고 candidate를 `FOR UPDATE`로 다시 읽어 scope가 변하지 않았는지 검증한다. 신규 모델에서는 안정적인 registration/range ID를 먼저 해석해 `operation → policy/range → candidate registration → assignment` 잠금 순서를 사용한다.
- 조건부 UPDATE 또는 version을 사용한다.
- deadlock은 제한된 횟수만 재시도하고 409 오류 코드를 제공한다.

**완료 기준**

- assign/close 병렬 테스트에서 `closed_at` 이후 신규 assignment가 0건이다.
- 중복 마감 요청은 멱등적으로 처리된다.

### P0-6. 설정 저장 시 순차 상태 초기화와 기존 범위 모순

**현상**  
설정 저장 시 범위 행 전체를 삭제 후 재삽입해 `next_sequence`가 시작 번호로 초기화된다. 기존 assignment가 새 범위 안에 있는지도 검증하지 않는다.

**조치**

- 설정 본체와 범위 변경을 분리해 diff한다.
- 동일 범위는 UPDATE, 신규/삭제 범위만 INSERT/DELETE한다.
- 기존 가번호를 제외하는 범위 변경은 차단한다.
- 설정 version을 두어 낙관적 잠금을 적용한다.
- 변경 전후와 actor를 동일 트랜잭션의 감사 로그에 남긴다.

**완료 기준**

- 운영 정책 스위치만 변경해도 `next_sequence`가 유지된다.
- 이미 사용된 번호를 벗어나는 범위는 409로 거부된다.
- 두 관리자의 동시 저장 충돌이 감지된다.

### P0-7. 마이그레이션 실행기가 MySQL 계열 DDL rollback을 보장하지 못함

**현상**  
SQL 파일을 transaction으로 감싸지만 MySQL 계열 DDL은 implicit commit이 발생할 수 있다. 중간 실패 시 일부 DDL만 반영되고 migration 이력은 남지 않는 상태가 될 수 있다.

**조치**

- checksum과 lock을 제공하는 검증된 migration tool을 도입하거나 동등한 기능을 구현한다.
- 적용 파일 checksum을 저장하고 변경을 CI에서 차단한다.
- `GET_LOCK` 등으로 동시 실행을 막는다.
- schema migration, reference seed, demo fixture를 분리한다.
- 파괴적 변경은 expand/backfill/validate/contract로 나눈다.

**완료 기준**

- 빈 DB 001→latest, 직전 배포 N-1→latest, 익명화 운영 snapshot→latest가 통과한다.
- 두 인스턴스 동시 실행에서 하나만 lock을 획득한다.
- DDL 부분 적용을 감지하고 migration별 idempotent 재실행, forward repair 또는 backup restore 중 승인된 절차로 복구할 수 있다. checksum/lock만으로 자동 rollback된다고 가정하지 않는다.

### P0-8. 인증·환경설정의 안전한 운영 기본값 부재

**현상**

- 고정 개발용 JWT secret fallback이 있다.
- 초기 비밀번호 fallback이 `1234`다.
- 환경변수 타입·범위·운영 필수값을 시작 시 검증하지 않는다.
- 로그인 rate limit, 실패 감사, 토큰 폐기, 비밀번호 변경 후 기존 토큰 무효화가 없다.

**조치**

- typed config schema와 환경별 fail-fast 검증을 도입한다.
- production에서는 기본 secret/초기 비밀번호로 기동하지 못하게 한다.
- 검증된 JWT 라이브러리와 token/session version을 사용한다.
- 비밀번호 변경 시 기존 토큰을 무효화한다.
- 비동기 password hash, 로그인 rate limit, 실패 지연과 audit를 도입한다.
- Helmet, CSP, 요청 크기 제한, CORS allowlist를 중앙 설정한다.

### P0-9. 개발자 계정과 최상위 권한 보호 미흡

**현상**  
일반 계정 목록에서는 개발자를 숨기지만, 대상 ID를 직접 호출하면 일반 update/delete 흐름이 개발자 계정에 적용될 가능성이 있다. 개발자 비밀번호 변경도 현재 로그인한 개발자가 아니라 첫 활성 개발자 행을 선택하는 구현에 의존한다.

**조치**

- 일반 AccountManagement use case에서 DEVELOPER 대상 변경을 명시적으로 403 처리한다.
- 개발자 계정 변경은 전용 use case로 제한한다.
- 현재 사용자 ID를 기준으로 본인 비밀번호를 변경한다.
- 역할 우회 대신 permission matrix를 정의한다.

### P0-10. 저장 양식 HTML의 보안 경계 불명확

**현상**  
저장 양식 HTML이 렌더링 과정에서 `innerHTML`과 `document.write`에 전달된다.

**조치**

- 저장 시점과 렌더 시점 모두 allowlist sanitizer를 적용한다.
- script, event handler, `javascript:` URL, iframe/object/embed, 허용되지 않은 외부 URL과 위험 CSS를 차단한다.
- 실제 저장 양식 fixture로 기존 레이아웃 호환성을 검증한다.
- CSP와 별도 미리보기 sandbox를 검토한다.

## 7.2 P1 — 핵심 유지보수성과 확장성 개선

### P1-1. 대형 서비스와 페이지의 책임 과밀

백엔드 `PseudonymsService`, `CandidatesService`와 프런트엔드 `PseudonymAssignmentPage`, `FormTemplateManager`, `SystemSettingsPage`는 서로 다른 업무 흐름을 한 파일에서 처리한다. 파일을 단순 분할하는 것으로는 충분하지 않다. 다음 경계를 기준으로 분리한다.

- Domain: 범위, 번호, 상태 전이, 정책
- Application: assign, close, reopen, save setting, import 등 use case
- Infrastructure: SQL, Excel, ZIP, Browser Print, HTML renderer
- Presentation: Controller, DTO, React page/component

### P1-2. 권한과 전형 접근 검사 중복

전형 접근 판단이 examinees, pseudonyms, print-jobs 등에 중복돼 누락 가능성이 있다. 역할 이름 대신 다음과 같은 permission과 admission scope를 중앙 정책으로 관리한다.

- `candidate.read`
- `candidate.import`
- `pseudonym.assign`
- `operation.close`
- `operation.reopen`
- `settings.manage`
- `template.manage`
- `print.create`
- `account.manage`
- `developer.manage`

### P1-3. API DTO·오류·계약 불일치

- 일부 query는 `Record<string, string>`으로 받아 ValidationPipe를 우회한다.
- 문자열 trim 후 빈 값, 실제로 존재하지 않는 날짜·시간, 지나치게 큰 배열을 일관되게 차단하지 못한다.
- 프런트와 백엔드가 역할, 후보 필드, 일정 scope 타입을 각각 정의한다.
- UI가 한국어 오류 문자열을 해석해야 한다.

다음 공통 오류 형식을 목표로 한다.

```json
{
  "code": "PSEUDONYM_RANGE_CONFLICT",
  "message": "사용자에게 표시할 문구",
  "requestId": "...",
  "details": {}
}
```

OpenAPI에서 Web 타입·클라이언트를 생성하는 방식을 우선 검토한다. Nest DTO와 class-validator를 당장 모두 바꾸지 않고, API 계약을 한 방향으로 생성하는 것이 위험이 낮다.

OpenAPI 생성 TypeScript 타입만으로는 런타임 응답 검증이 되지 않는다. 다음 중 하나를 ADR로 선택하고 3중 수기 관리를 피한다.

- OpenAPI에서 runtime validator까지 생성
- 고위험 외부 경계만 Zod 등으로 검증하고 나머지는 생성 계약+contract test 사용

수험생 필드 저장은 현재 `candidateFieldKeys[index]`와 별도 DB column 배열의 위치가 같다는 전제에 의존한다. 필드 정의 객체 또는 명시적 mapper로 바꾸고, 모든 업로드 필드의 workbook → domain → DB → API round-trip 테스트를 추가한다.

### P1-4. 감사 로그와 트랜잭션 일관성 부족

계정, 설정, 업로드, 출력, 개발자 설정, 로그인 등 기능별 감사 범위와 원자성이 다르다. 공통 `AuditWriter`를 도입하고 use case의 동일 transaction/connection으로 다음 envelope를 기록한다.

- event code
- actor ID와 권한
- 대상 entity와 ID
- admission/schedule/workstation scope
- request ID
- 변경 전/후의 허용된 정보
- 성공 시각

비밀번호 hash, token, 사진 원본, 민감 데이터는 감사 details에 저장하지 않는다.

추상적인 공통 서비스 도입으로 끝내지 않고 login, account create/update/disable, admission assignment, candidate/photo import, system setting, developer setting/password, template save/publish, operation assign/close/reopen, print create/complete/reprint, driver download의 mutation/event inventory를 만든다. 각 행에 현재 transaction 상태, 목표 원자성, 실패 이벤트 저장 방식, before/after 허용 field를 기록한다.

### P1-5. 수험생 업로드의 메모리·성능·보안

- XLSX 전체와 기존 데이터 전체를 메모리에서 비교한다.
- ZIP 요청과 압축 해제를 큰 메모리 버퍼로 처리한다.
- 행과 사진마다 개별 SQL을 실행한다.
- 사진 파일명 포함 검색은 비슷한 수험번호를 잘못 매칭할 수 있다.

압축률·항목 수·magic byte·이미지 픽셀 제한과 파일 checksum을 우선 적용한다. 현재 브라우저 업로드는
사용자·파일·후보 데이터 상태·수험번호 유일 정책·만료 시각을 묶은 서명형 미리보기 티켓으로 반영을
보호한다. 미리보기는 선택 정책과 무관한 `신규/수정/동일` 원시 분류이며, 반영은 잠근 최신 상태에서
사용자가 선택한 정책으로 다시 계획한다. 대용량 운영 기준이 확정되면 durable staging table, import
batch, bulk upsert, streaming parser와 행별 오류 리포트를 후속 도입한다.

### P1-6. 서버 pagination/filter/sort 부재

수험생과 운영 명단을 전체 반환하고 브라우저에서 처리한다. 운영 최대 규모를 먼저 확인한 뒤 서버 pagination/filter/sort와 export 조건 공유를 도입한다. 대시보드와 설정 카드에는 목적별 집계 endpoint를 제공해 전형별 N+1 요청을 제거한다.

현재 운영 명단 Excel 생성은 클라이언트가 보낸 row 내용을 공식 데이터처럼 사용할 수 있으므로 개선 대상에 포함한다. export 요청은 scope, filter, sort만 받고 서버가 권한을 확인한 canonical roster를 다시 조회해야 한다. 화면 조회와 export는 동일한 query specification을 사용한다.

### P1-7. 프런트 라우팅·세션·서버 상태 분산

`App.tsx`와 `SetupPage.tsx`가 History API와 sessionStorage를 직접 관리한다. React Query는 health 한 곳에서만 사용한다.

- 명시적 Router와 protected route
- `SessionProvider`
- 관리자 중첩 route
- 교시 선택/운영 route guard
- 공통 401 처리
- route lazy loading
- 공통 navigation blocker
- TanStack Query의 query key/invalidation 정책

을 단계적으로 도입한다. 기존 URL과 sessionStorage key는 이관 기간 동안 유지한다.

다음 정확성 문제는 전체 Router 전환을 기다리지 않고 P0 hotfix 직후 먼저 보완한다.

- 양식 편집과 시스템 설정의 dirty 상태를 메뉴 이동, 뒤로가기, 새로고침, 로그아웃에서 임시 guard로 보호
- 저장된 교시 선택을 operation 진입 때 schedule ID, 권한, 현재 상태 기준으로 서버 재검증
- 사진 요청에 AbortController 또는 request ID 적용
- 자동 추첨 callback에서 대상 수험생과 schedule을 다시 검증
- countdown/animation을 leaf component로 격리

Router 도입 시 임시 guard를 공통 `NavigationBlocker`로 교체한다.

### P1-8. 사용자 운영 화면의 복합 상태와 비동기 경쟁

사용자 화면의 조회, 사진, 자동 추첨, 마감, 필터, PDF, 인쇄가 다수의 `useState`와 effect로 결합돼 있다. 연속 조회 시 이전 사진 응답이 뒤늦게 도착해 새 수험생 사진을 덮을 수 있고, 타이머가 전체 roster를 반복 렌더링할 수 있다.

- `idle → looking-up → ready → drawing/assigning → assigned` reducer/state machine
- 마감 상태의 별도 축
- AbortController 또는 request ID
- 추첨 타이머의 leaf component 격리
- fake timer 테스트

를 적용한다.

### P1-9. 그리드 기능의 중복

수험생, 계정, 사용자 운영 명단이 정렬, 필터, 전체선택, 빈 상태, 페이지네이션, 행 선택을 각각 구현한다. 먼저 headless `useDataGrid`를 추출하고 이후 `DataGrid`, `ColumnFilterPopover`, `Pagination`으로 통합한다.

사용자 운영 화면은 같은 코어를 사용하되 `pagination: false`, `selectableRows: true` 옵션을 사용한다. 서버/클라이언트 모드를 모두 지원하되 한 화면씩 이관한다.

### P1-10. 공통 UI와 디자인 토큰 부재

Toast, Dialog, Confirm, Button, IconButton, Popover, Brand, PageHeader, EmptyState가 화면별로 중복된다. 공통 UI는 단순 스타일뿐 아니라 다음 행동 계약을 포함해야 한다.

- 모든 modal의 ESC 종료
- focus trap과 최초 포커스
- 닫힌 후 trigger로 포커스 복귀
- 배경 inert와 스크롤 잠금
- `aria-modal`, 제목 연결
- 비동기 작업 중 종료 정책
- 아이콘+텍스트 버튼 규칙
- 우측 하단 관리자 토스트, 입력 하단 사용자 오류 등 placement 정책

### P1-11. 단일 전역 CSS와 반응형 규칙 누적

현재 `styles.css`에는 동일 selector의 반복 정의, 구버전 화면 selector, 17개의 `!important`, 화면별 서로 다른 최소 너비 기준, 외부 편집기 override가 함께 있다.

- `tokens.css`, `reset.css`, `globals.css`
- 공통 UI별 CSS
- feature별 CSS
- 외부 편집기 `integration-overrides.css`

로 점진 분리한다. CSS를 한 번에 다시 쓰지 않고 화면 단위로 옮긴다. FHD는 최소 기준, QHD는 제한적 확대, FHD 미만은 필요한 영역만 스크롤하는 계약을 토큰으로 고정한다.

### P1-12. 양식 버전·편집기 통합·PDF 생성

- 버전 저장과 metadata 수정의 불변성 규칙이 일치하지 않는다.
- 새 비활성 버전 저장 과정에서 활성 버전이 사라질 수 있다.
- 외부 editor DOM을 보정하는 코드가 feature에 강하게 결합돼 있다.
- PDF 생성이 브라우저 메모리와 동시 사진 다운로드에 의존한다.

`TemplateEditorAdapter`, immutable version, draft/published/archived lifecycle, layout schema version, sanitizer, PDF 진행률·취소·다운로드 동시성 제한을 도입한다.

단, draft/published/archived lifecycle과 완전한 version 불변성은 사용자 동작을 바꿀 수 있으므로 별도 제품 ADR 승인 전에는 강제하지 않는다. 먼저 현재 저장·활성 버전 동작을 특성화 테스트로 고정하고 adapter, 신뢰 경계, sanitize report-only, 성능 개선부터 수행한다.

데이터 모델 전환 전에 현재 저장된 모든 template의 data tag key를 inventory하고 `TemplateDataProjection` compatibility mapper를 만든다. 신규 모델이 기존 tag 값을 계속 제공하지 못하면 migration을 중단하거나 승인된 alias/fallback을 기록한다.

### P1-13. Print Job 상태 모델 미완성

DB enum에 비해 실제 상태 전이가 단순하고 idempotency, expiry, compare-and-set, 재출력 사유, 서버측 라벨 허용 정책이 부족하다.

- 명시적 state machine
- client request idempotency key
- READY → DISPATCHING → SENT/FAILED
- expiry 처리
- affectedRows 기반 조건부 전이
- 재출력 원본·사유
- 모든 상태 변경 audit

을 적용한다. `SENT`는 물리 출력 완료가 아니라 Browser Print로 데이터 전송이 완료됐다는 의미임을 유지한다.

### P1-14. 역할·시험명·접근 scope의 canonical identity 부재

- 설정과 실행의 역할 값이 `USER`, `OPERATOR`, `VIEWER`로 다르게 표현된다.
- `DEFAULT_EXAM_NAME`이 운영 화면과 시스템 설정 화면 여러 곳에서 scope 값으로 중복된다.
- 워크스테이션 코드가 개발 기본값에 의존한다.

Phase 4에서 canonical role/permission, exam cycle/admission/schedule ID, workstation identity 계약을 확정한다. 이름은 표시값과 history snapshot으로만 사용한다. `USER ↔ OPERATOR` 암묵적 변환을 제거하고 VIEWER의 유지 또는 폐기를 DB/API/Web에서 함께 처리한다.

## 7.3 P2 — 운영 품질과 장기 유지보수

- typed config와 DB pool graceful shutdown
- liveness/readiness 분리
- request ID와 구조화 로그
- DB pool, API latency, 로그인 실패, 할당 충돌, 업로드, 출력 실패 metric
- 백업·복원·배포·롤백 runbook
- 역할과 UI 명칭 정리, VIEWER 정책 결정
- `updated_at`, disabled metadata, 재활성화 정책
- 이름 기반 relation을 ID FK로 전환
- 가번호 숫자 canonical value와 표시 자릿수 분리
- Google Fonts 자체 호스팅과 오프라인 검증
- dependency 버전, Node LTS, packageManager 고정
- SBOM, 라이선스, 취약점 점검
- README, 실제 경로, 환경변수, 계획 문서의 불일치 정리
- 죽은 코드, 미사용 CSS, 이전 editor tarball 제거

---

## 8. 목표 아키텍처

## 8.1 저장소 구조

```text
apps/
  web/
    src/
      app/
        router/
        providers/
        error-boundary/
      pages/
      features/
        auth/
        candidates/
        accounts/
        settings/
        operation/
        templates/
        printer/
      entities/
        candidate/
        schedule/
        pseudonym/
        account/
        template/
      shared/
        api/
        ui/
        grid/
        lib/
        styles/

  api/
    src/
      common/
        config/
        database/
        errors/
        authz/
        audit/
        logging/
      modules/
        auth/
        accounts/
        candidates/
        schedules/
        pseudonyms/
        operation/
        templates/
        printing/
        system-profile/

packages/
  contracts/                 # OpenAPI 생성물 또는 공유 enum/value type
  template-editor-adapter/   # 필요할 경우 별도 workspace로 승격
```

폴더 구조 자체가 목표는 아니다. 실제 의존성 방향이 다음 규칙을 지켜야 한다.

```text
Presentation → Application → Domain
                         ↓
                  Repository Port
                         ↑
                  Infrastructure
```

Domain은 NestJS, DB driver, React, ExcelJS, Browser Print를 import하지 않는다.

`packages/*` 승격은 목표가 아니다. 두 개 이상의 소비자가 있거나, 독립 빌드·버전 호환 정책이 필요하거나, 별도 배포/배포 검증이 필요한 경우에만 workspace package로 만든다. 소비자가 Web 한 곳뿐인 editor adapter는 우선 `apps/web/src/features/templates/integration`에 두고, 필요성이 확인된 뒤 승격한다.

## 8.2 백엔드 모듈 내부 예시

```text
modules/pseudonyms/
  domain/
    pseudonym-number.ts
    pseudonym-range.ts
    assignment-method.ts
    operation-state.ts
    pseudonym-policy.ts
  application/
    assign-pseudonym.use-case.ts
    close-operation.use-case.ts
    reopen-operation.use-case.ts
    update-settings.use-case.ts
    get-operation-roster.query.ts
  infrastructure/
    mysql-pseudonym.repository.ts
    mysql-operation.repository.ts
    pseudonym-roster-exporter.ts
  presentation/
    pseudonyms.controller.ts
    pseudonyms.dto.ts
    pseudonyms.response.ts
```

트랜잭션은 use case가 시작하고 repository에 동일 connection/context를 전달한다. 감사 로그도 같은 context에서 기록한다.

## 8.3 프런트엔드 운영 기능 예시

```text
features/operation/
  api/
    operation.queries.ts
    operation.mutations.ts
  model/
    operation-machine.ts
    operation-selectors.ts
    operation.types.ts
  hooks/
    use-operation-controller.ts
    use-candidate-photo.ts
  components/
    OperationHeader.tsx
    CandidateLookupPanel.tsx
    CandidateProfile.tsx
    PseudonymDrawPopover.tsx
    OperationRoster.tsx
    OperationActions.tsx
    CloseOperationDialog.tsx
    PrintTemplateDialog.tsx
  pages/
    OperationPage.tsx
```

페이지는 query/mutation과 하위 컴포넌트를 조립하되, 상태 전이 자체는 reducer와 use case 함수로 검증한다.

## 8.4 목표 데이터 모델 초안

업무 결정 전의 초안이며 6장 결정에 따라 unique key가 달라진다.

```text
system_profile
exam_cycle
  └─ admission
      └─ operation_slot                 # 전형+날짜+시간+교시, 선택·마감 단위
          └─ schedule_segment           # 모집단위+전공+건물+고사실, 범위 단위
              └─ candidate_registration

candidate
  └─ candidate_photo 또는 media_object

app_user
  ├─ admission_scope_mode(ALL | ASSIGNED)
  └─ user_admission_assignment(admission_id)

pseudonym_policy(admission_id)
  └─ pseudonym_range(schedule_segment_id 또는 승인된 scope ID)

pseudonym_operation(operation_slot_id)
pseudonym_assignment(candidate_registration_id, pseudonym_operation_id)

form_template
  └─ form_template_version

print_job
  └─ print_job_payload / reprint_relation

audit_log
```

핵심 규칙은 다음과 같다.

- 이름 문자열을 관계 키로 사용하지 않는다.
- 수험생 개인과 특정 일정의 등록을 분리한다.
- 학년도, 전형, 교시, 건물·고사실 관계는 ID로 참조한다.
- 가번호 unique scope는 업무 문서와 DB unique index가 동일하게 표현한다.
- 설정, 할당, 마감, 출력이 같은 registration/operation을 참조한다.
- 역사 보존이 필요한 출력·감사에는 표시값 snapshot을 별도로 둔다.
- 가번호의 canonical numeric value와 `001` 같은 display format을 분리한다.

초기 unique/lifecycle 초안은 다음 항목을 ADR에서 승인받아야 한다.

- `candidate`: `(exam_cycle_id, examinee_no)` unique 여부
- `operation_slot`: `(admission_id, exam_date, start_time, period_name)` unique
- `schedule_segment`: slot 내부 모집단위/전공/건물/고사실 조합 unique
- `candidate_registration`: `(candidate_id, schedule_segment_id)` unique
- `pseudonym_operation`: slot당 현재 operation 한 개와 close/reopen event history를 분리할지 여부
- `pseudonym_assignment`: registration당 현재 assignment 한 개, 재부여 history 보존 여부
- 가번호 unique index: Phase 0에서 승인된 operation/admission/segment scope와 정확히 동일
- candidate/admission/schedule의 soft-delete/status 정책
- assignment, audit, print history에 cascade delete를 허용하지 않는 원칙

현재 “전형 미배정 사용자=모든 전형 접근”은 assignment 행이 없는 상태에 암묵적으로 의존한다. 신규 모델에서는 `admission_scope_mode = ALL | ASSIGNED`를 명시하고, 기존 데이터가 0건·전체 일치·부분 배정 중 어느 의미인지 계정별 dry-run 보고서와 승인된 mapping으로 전환한다.

현재 빈 `admission_name` 설정을 전형별 fallback으로 사용하는 과거 정책도 별도 진단한다. 이를 `default_pseudonym_policy`로 유지할지, 각 전형에 복제할지 결정하기 전에는 임의로 첫 전형에 연결하지 않는다.

---

## 9. 단계별 실행 로드맵

각 단계는 독립적인 완료 기준을 가지지만 전체 일정은 선형이 아니라 의존성 DAG다. 각 작업은 자신의 선행 Go 조건만 통과하면 병행할 수 있고, 관련된 No-Go 조건이 발생하면 cutover를 멈춘다.

### 9.1 실행 역할과 Go/No-Go

| 역할                  | 책임                                                           |
| --------------------- | -------------------------------------------------------------- |
| 제품/현장 업무 책임자 | 가번호 scope, 마감, 업로드, 양식 정책 승인                     |
| Tech Lead             | 경계·계약·단계 순서, WIP, 최종 기술 Go/No-Go                   |
| DBA                   | backup/restore, migration, backfill, query plan, contract 승인 |
| Backend               | API/domain/repository/concurrency/audit 구현                   |
| Frontend              | router/query/UI/grid/editor adapter/visual QA 구현             |
| QA                    | 특성화, E2E, visual, 접근성, regression evidence               |
| 보안/개인정보 담당    | secret, auth, upload, template, legacy 자산, retention 승인    |
| 운영 담당             | CI/CD, staging, metric/alert, 배포/rollback, hardware 환경     |

각 Phase 시작 전에 필요한 인력과 환경을 확인한다. 최소 환경은 운영 제품과 같은 격리 DB, 익명화 fixture, Playwright runner이며 printer production-readiness에는 별도 Windows PC와 GT800이 필요하다. Docker/Testcontainers를 사용할 수 없으면 고정된 전용 CI DB를 대안으로 사용하되 test run마다 schema와 데이터를 격리한다.

Go/No-Go 기록에는 다음을 포함한다.

- 승인자와 승인 시각
- 기준 commit/schema version
- 통과한 테스트와 남은 예외
- 데이터 mismatch와 성능 수치
- rollback 또는 forward repair 경로
- residual risk와 관찰 종료 조건
- 외부 의존성 미확보 시 대안

WIP 제한은 팀당 동시에 하나의 DB 수직 전환, 하나의 UI 수직 전환을 기본으로 한다. 데이터 모델·API·UI를 동일 기능에서 동시에 대규모 재작성하지 않는다.

### 9.2 상대 작업량 해석

아래 범위는 일정 약속이 아니라 계획 분해가 적절한지 판단하기 위한 초기 추정이다. 업무 결정 지연, 실제 데이터 정리, CI/장비 확보 시간은 포함하지 않으며 Phase 1 기준선 후 다시 산정한다.

| 표기 | 초기 해석                                  | 권장 최소 참여                      |
| ---- | ------------------------------------------ | ----------------------------------- |
| S    | 1~3 엔지니어링 일                          | 해당 영역 1명 + reviewer            |
| M    | 약 1~2주                                   | 해당 영역 1~2명 + QA 일부           |
| L    | 약 2~4주                                   | 영역 2명 + QA, 필요 시 DBA          |
| XL   | 4~8주 이상, 반드시 하위 수직 단위로 재분해 | Backend/Frontend/QA + DBA/업무 승인 |

XL Phase를 하나의 branch나 PR로 구현하지 않는다. 각 하위 기능이 독립 배포·rollback·완료 기준을 갖도록 다시 쪼갠다.

## Phase 0. 업무 동결 범위와 결정 기록

**목적**  
리팩토링 중 바뀌어서는 안 되는 동작과 아직 결정되지 않은 업무 규칙을 분리한다.

**주요 작업**

1. 6장의 업무 결정 워크숍 진행
2. 관리자·사용자·개발자 권한 행렬 작성
3. 네 가지 가번호 부여 방식의 입력·출력·오류·동시성 표 작성
4. 업로드 정책, 마감·재개 정책, 라벨 출력 조건 확정
5. 기존 URL과 브라우저 저장 키 목록 작성
6. 리팩토링 기간의 기능 추가/change freeze 원칙 합의
7. ADR 번호와 승인자 지정
8. 업무 용어 ↔ 설정 code ↔ 실행 API code 매핑 승인
9. exam cycle/operation slot/schedule segment 계층 승인
10. 인증 저장 방식과 sessionStorage 종료 조건 승인
11. 지원 브라우저·Windows 화면 배율·Browser Print 버전 확정
12. CI, staging DB, Windows hardware runner, 배포 플랫폼 확정

**산출물**

- `docs/adr/0001-pseudonym-unique-scope.md`
- `docs/adr/0002-candidate-schedule-identity.md`
- `docs/adr/0003-account-permission-policy.md`
- 업무 시나리오와 오류 코드 목록
- 현재 테이블 → 목표 테이블 field mapping 초안
- natural key, surrogate key, unique index SQL 초안
- CI/배포/secret 관리 환경 결정서

**완료 기준**

- 가번호와 사전 가번호의 unique scope가 예제 데이터와 함께 승인됨
- 동일 수험번호의 복수 일정 처리 규칙 승인
- 재업로드·마감·재개 정책 승인
- 결정되지 않은 항목을 임의 구현하지 않도록 issue로 분리

**상대 작업량**: M  
**선행조건**: 없음

## Phase 1. 저장소·데이터 기준선과 복구 가능성 확보

**목적**  
모든 후속 작업을 되돌릴 수 있게 한다.

**주요 작업**

1. Git 추적 대상/제외 대상 검토
2. `setup/` 민감정보 및 개인정보 감사
3. 레거시 자산과 바이너리 보관 정책 확정
4. DB schema/data 백업 생성
5. 빈 서버 또는 격리 DB에 복원 시험
6. 주요 테이블 건수, 중복, 고아 FK, 가번호 충돌, 일정 매핑 보고서 생성
7. 실제 사용 XLSX, 오류 XLSX, 사진 ZIP, 양식 layout, ZPL fixture 보관
8. FHD/QHD 전체 주요 화면 baseline 캡처
9. 현재 API 응답 snapshot과 네트워크 요청 수 기록
10. 최초 기준 커밋 및 `refactor-baseline-2026-08-28` 태그 생성
11. 운영 DB 제품·버전·sql_mode·timezone·charset/collation·용량 inventory
12. 기존 001~026 파일 hash를 known checksum manifest로 검증하고 승인
13. 저장된 모든 양식의 data tag key와 layout/editor version inventory
14. 미사용 후보 코드·props·selector inventory 작성
15. 개인정보 데이터 등급과 익명화 fixture 정책 수립

초기 미사용 후보 inventory에는 `PrintConsolePage`, SetupPage의 미사용 printer props, 남아 있는 server status UI, 구형 sidebar/workflow/operator selector, 정의 범위를 벗어난 CSS 변수 사용을 포함한다. 문자열 검색만으로 삭제하지 않고 runtime CSS coverage와 화면 캡처로 확인한다.

**주의사항**

- 레거시 DB나 setup 파일을 자동 삭제하지 않는다.
- 민감값은 문서에 원문으로 기록하지 않는다.
- 백업은 생성 여부가 아니라 실제 복원 성공으로 검증한다.

**완료 기준**

- 깨끗한 Git 기준점과 태그 존재
- DB 백업 복원 성공 기록
- 레거시 자산 정책과 체크섬 목록 존재
- 현 데이터 정합성 dry-run 보고서 존재
- UI·API·빌드 기준 수치 보관
- 운영 DB 엔진과 문자열/시간 비교 정책 기록
- 실제 개인정보가 없는 익명화 테스트 fixture 확보

**상대 작업량**: M  
**선행조건**: Phase 0과 병행 가능

## Phase 2. 테스트·정적 분석·CI 안전망

**목적**  
구조를 바꾸기 전에 현재 동작의 회귀를 자동으로 감지한다.

Phase 2 전체가 끝날 때까지 P0 hotfix를 미루지 않는다. 다음 두 단계로 나눈다.

### Phase 2A. P0 최소 테스트 harness

1. 운영과 같은 제품·major version의 격리 DB 환경 확보
2. migration과 repository를 실행할 최소 integration harness
3. Nest API e2e 기본 harness
4. `db:setup` 반복 실행, 일반 계정 API의 DEVELOPER 대상 보호, 기본 secret/config의 실패 재현 테스트
5. close vs assign 경쟁과 설정 cursor 초기화의 결정적 재현 테스트
6. 테스트가 실제 운영 데이터를 사용하지 않도록 익명화 seed 구축

Phase 3A/3B hotfix는 이 최소 harness가 준비되는 즉시 진행할 수 있다.

### Phase 2B. 전체 개발 안전망

**주요 작업**

1. ESLint와 React Hooks 규칙 도입
2. Prettier 및 import 정렬 정책 도입
3. `noUnusedLocals`, `noUnusedParameters` 단계적 활성화
4. Vitest coverage 설정과 기준선 기록
5. React Testing Library + jsdom 도입
6. Supertest 기반 Nest API e2e 도입
7. 운영 DB 제품의 Testcontainers 또는 격리 CI DB 구축
8. Playwright 브라우저 E2E와 screenshot 비교 도입
9. axe 접근성 검사 도입
10. `npm run check`로 lint → typecheck → unit/integration → build 통합
11. CI에서 `npm ci` 사용, Node/package manager 버전 고정
12. 번들 크기 보고와 migration 검증 job 추가

**현재 정상 동작을 고정할 특성화 테스트**

- 역할별 로그인과 경로 복원
- 관리자 새로고침 후 메뉴 유지
- 개발자 메뉴 및 API 권한
- 수험생 업로드 정상/잘못된 헤더/잘못된 파일
- 계정 CRUD, 전형 배정, 미배정 사용자의 전체 접근
- 시스템 설정 dirty/save/leave 3버튼 확인
- 가번호 범위 일괄 설정
- 추첨/순차/매칭/사전부여
- 자동 추첨 지연과 취소
- 현재 교시/다른 교시/미존재 수험번호
- 결시자 자동부여·재개 삭제 정책
- 마감 전 인쇄 비활성, 마감 후 양식 출력
- 양식 편집 dirty/save/version/metadata

아직 구현되지 않았거나 결함을 재현해야 하는 항목은 “현재 동작 특성화”와 구분한다. 다음 target regression은 해당 수정과 같은 작업 단위에서 실패 테스트를 먼저 추가하고 수정 후 통과시킨다.

- Phase 3B: assign vs close, settings cursor 보존, 범위 밖 기존 할당 차단
- Phase 4: 비밀번호 변경·권한 변경 후 기존 token 무효화
- Phase 5/6: 동일 수험번호 복수 일정과 old/new model 일치
- Phase 9C: Print Job idempotency, expiry, compare-and-set

**완료 기준**

- 모든 PR에 lint/typecheck/test/build가 필수
- 실제 운영 DB transaction 테스트가 CI에서 실행됨
- 역할별 핵심 Playwright 흐름 통과
- FHD/QHD baseline 비교 가능
- 현재 28개 테스트의 시나리오와 assertion 의도를 보존하고 회귀 없음. 테스트 수는 참고 지표일 뿐이다.
- coverage는 최초 기준선보다 하락하지 않음

**상대 작업량**: L  
**선행조건**: Phase 1 기준 커밋. Phase 3은 Phase 2A 이후 시작 가능하며 Phase 2B와 병행한다.

## Phase 3. 긴급 보안·데이터 안전 수정

**목적**  
대규모 구조 변경 없이 즉시 위험한 P0 동작을 제거한다.

**주요 작업**

### Phase 3A. 계정·설정·신뢰 경계 hotfix

1. `db:setup` 기존 계정 덮어쓰기 제거
2. migration과 bootstrap 계정 생성 분리
3. 일반 계정관리 API를 통한 `DEVELOPER` 계정 수정·삭제 차단. DEVELOPER의 최상위 업무 권한은 유지한다.
4. 개발자 비밀번호를 현재 사용자 ID 기준으로 변경
5. production 기본 JWT secret과 기본 비밀번호 차단
6. config schema와 시작 시 검증
7. 로그인 rate limit과 성공/실패 감사 추가
8. 보안 헤더, 요청 크기, CORS allowlist 설정
9. HTML sanitizer report-only 진단, 영향 양식 목록, 원본 보존과 격리 정책 수립
10. 공통 오류 envelope의 최소 버전 추가

### Phase 3B. 현 운영 모델의 정합성 hotfix

1. assign/close 모두 열린 operation 행을 멱등적으로 `INSERT IGNORE` 또는 동등한 방식으로 먼저 보장한 뒤 `FOR UPDATE`로 잠그고 마감 상태 확인
2. 현 모델에서는 candidate를 비잠금으로 먼저 식별해 scope key를 계산한 뒤 operation → setting/range를 잠그고, candidate를 다시 `FOR UPDATE`하여 같은 scope인지 재검증한 후 assignment를 변경. 또는 안정적인 registration/range ID를 먼저 해석하는 대안을 구현
3. 설정 저장 시 기존 range의 `next_sequence` 보존
4. 기존 assignment가 새 범위 밖으로 나가는 설정 변경 차단
5. 진행 중·마감 상태에서 허용되지 않은 설정 변경 차단
6. assign/close와 설정 저장의 병렬 운영 DB regression test
7. 양식/시스템 설정 dirty 상태의 임시 navigation guard
8. 사진 stale response 차단과 자동추첨 대상 재검증
9. countdown/animation leaf 격리로 대형 roster 재렌더 감소

**호환 전략**

- UI 메시지는 기존 한국어 문구를 유지하되 `code`를 추가한다.
- 토큰 방식 변경은 별도 단계로 분리하고 우선 기존 토큰의 안전한 설정부터 적용한다.
- sanitizer는 기존 양식 report-only → 영향 검토 → 신규 저장 강제 → 기존 양식 quarantine/호환 renderer 순서로 적용한다.

**완료 기준**

- 반복 setup으로 기존 계정이 변하지 않음
- production 기본 비밀값으로 기동 불가
- ADMIN이 일반 계정 API로 developer 계정을 변경하면 403, DEVELOPER는 기존 최상위 업무 API 접근을 유지
- sanitizer report와 XSS fixture 확보. 강제 차단은 영향 승인 후 적용
- close 이후 신규 assignment 0, 설정 정책 변경 시 cursor 유지
- 연속 수험번호 조회에서 이전 사진 응답이 새 결과를 덮지 않음
- 인증·설정·계정 회귀 테스트 통과

**상대 작업량**: M~L  
**선행조건**: Phase 2A의 해당 실패 재현 테스트. Phase 2B 전체 완료를 기다리지 않는다.

## Phase 4. 공통 백엔드 기반과 계약 정리

**목적**  
각 기능을 이관할 공통 기반을 먼저 제공한다.

**주요 작업**

1. typed AppConfig 단일 모듈
2. DB pool lifecycle과 graceful shutdown
3. request ID와 구조화 로그
4. DomainError → HTTP exception filter
5. 운영 DB 오류 code mapping
6. `AuditWriter`와 공통 transaction context
7. `AuthorizationService`와 permission matrix
8. trim/date/time/param/query validator
9. OpenAPI 문서와 Web client/type/runtime validation 생성 방식 결정
10. migration checksum, lock, 실행 상태 도입
11. `/health/live`, `/health/ready` 분리
12. API contract test 추가
13. canonical role/permission과 `USER ↔ OPERATOR` 변환 제거 계획
14. exam cycle/admission/slot/segment ID를 사용하는 API identity 계약
15. `DEFAULT_EXAM_NAME`과 이름 기반 scope 제거 adapter
16. pagination/filter/sort/export query specification과 page envelope 계약
17. mutation별 transaction+audit 상태 inventory와 이관 순서

### Phase 4A. Authentication hardening

- 검증된 JWT 라이브러리와 issuer/audience/iat/exp 검증
- ADR에서 정한 cookie 또는 Bearer storage 정책
- account `session_version` 또는 동등한 폐기 version
- 비밀번호 변경, 계정 비활성, 권한 변경 시 version 증가
- Guard의 token version 비교
- 이전 token 401 e2e
- 비동기 password hash와 로그인 rate-limit 부하 검증
- logout/revocation과 break-glass 복구 절차

**이관 방식**

- 공통 기반을 추가한 뒤 기존 module을 한 번에 바꾸지 않는다.
- 먼저 read-only 기능 하나에서 사용해보고, mutation module로 확대한다.
- 기존 예외 문자열은 compatibility mapper를 거쳐 유지한다.

**완료 기준**

- 모든 신규 endpoint는 공통 오류와 DTO 정책 사용
- request → log → audit 연결 가능
- 잘못된 환경변수로 서버가 fail-fast
- pool이 종료 시 정상 close
- migration 파일 변경과 동시 실행이 차단됨
- 부분 적용된 DDL을 자동 rollback한다고 가정하지 않고 dirty 상태를 탐지하며 migration별 forward repair 또는 restore runbook이 있음
- role/exam/schedule canonical ID와 pagination 응답 shape가 contract test로 고정됨
- 성공 mutation audit와 실패·거부 보안 이벤트의 저장 정책이 event matrix로 정의됨

**상대 작업량**: L  
**선행조건**: Phase 2, Phase 3

## Phase 5. 데이터 모델 expand와 검증

**목적**  
수험생 개인, 일정 등록, 가번호 정책·할당·마감을 동일한 식별 체계로 연결한다.

전체 schema를 먼저 바꾸고 나중에 전체 service를 다시 쓰지 않는다. Phase 4에서 최소 repository/transaction seam을 만든 뒤 다음 수직 단위마다 **schema expand + 해당 repository/use case 이관 + 검증**을 함께 완료한다.

여기서 “use case 이관”은 Controller가 신규 application 경로를 호출하도록 바꾸는 것을 의미한다. 신규 use case 내부에서는 Phase 11 전까지 old/new repository dual-write와 shadow read를 유지할 수 있다. 신규 데이터 모델의 canonical read/write 전환과 legacy write 중단은 Phase 11에서만 수행한다.

### Phase 5A. 공통 identity

- `exam_cycle`, `admission`, `operation_slot`, `schedule_segment`
- `candidate`, `candidate_registration`
- 현재 테이블 → 목표 필드 mapping과 자연키/대체키
- `DEFAULT_EXAM_NAME`, 기존 `exam_name`, system profile의 exam cycle mapping dry-run
- 미매핑·복수매핑·한글 Unicode normalization 충돌 보고서

### Phase 5B. roster read model

- 신규 registration/segment 조회 repository
- 기존 roster와 신규 roster의 동일 snapshot 비교
- 대시보드/교시선택/사용자 roster read 전환
- 신규 모델을 기존 template data tag로 투영하는 `TemplateDataProjection`

### Phase 5C. 계정 admission scope

- admission ID FK
- `admission_scope_mode = ALL | ASSIGNED`
- assignment 0건/전체 일치/부분 배정 계정별 승인 mapping
- 기존 전형명 변경과 신규 전형 추가 시 접근 회귀 테스트

### Phase 5D. 설정과 범위

- admission policy, slot/segment range ID 전환
- 빈 `admission_name` fallback 설정의 별도 migration 정책
- 가번호 canonical numeric value와 display width
- setting version과 range cursor migration

### Phase 5E. assignment와 operation

- assignment의 candidate registration FK
- operation slot 단위 close/reopen
- 승인된 unique scope의 DB index
- old/new assignment와 마감 상태 비교
- 출력/감사용 표시값 snapshot

### Phase 5F. print/template projection

- Print Job과 template tag가 신규 identity를 참조하도록 projection 전환
- 과거 출력 이력은 immutable snapshot을 유지
- 신규 모델에서 제공할 수 없는 tag의 alias/fallback 승인

### 무중단 전환 순서

서비스가 계속 write 가능한 경우 각 하위 단계는 다음 순서를 사용한다.

1. schema expand
2. 구버전 코드와 호환되는 dual-write 배포
3. 동일 DB transaction에서 old/new write
4. high-water mark 또는 일관된 snapshot 기록
5. 과거 데이터를 chunk 단위로 backfill
6. backfill 이후 증분 reconciliation
7. 같은 snapshot 기준 shadow read 비교
8. read cutover feature flag와 Go/No-Go evidence 준비
9. Phase 11에서 수행할 canonical 전환 후보 release 생성

dual-write가 불가능하면 명시적인 maintenance window와 write 중단을 선택한다. backfill은 SQL migration 파일 안에 넣지 않고, checkpoint·마지막 처리 ID·성공/실패 건수·오류 행을 기록하는 재실행 가능한 command/job으로 만든다. old/new write 중 한쪽이 실패하면 동일 transaction을 rollback하며, reconciliation job과 mismatch alert를 둔다.

각 cutover에는 다음 중단 조건을 둔다.

- mismatch가 승인 임계치를 초과
- audit 또는 dual-write 일부 실패 발생
- API 오류율/latency가 승인 기준 초과
- backfill checkpoint와 live write watermark 불일치
- old Web/new API 또는 new Web/old API 계약 실패

**금지사항**

- 이 단계에서 기존 테이블/컬럼을 drop하지 않는다.
- 001~026 마이그레이션을 수정하지 않는다.
- 매핑 실패 데이터를 자동 추정해 덮어쓰지 않는다.
- 대용량 backfill을 일반 DDL migration과 같은 파일에서 실행하지 않는다.
- 신규 모델 read/write 안정화 전에 이름 기반 relation이나 legacy assignment를 제거하지 않는다.

**완료 기준**

- 모든 기존 candidate record가 승인된 schedule/registration에 매핑
- 동일 수험번호 복수 교시 통합 테스트 통과
- old/new 결과 mismatch 0 또는 승인된 예외 목록
- unique scope와 DB index 일치
- 익명화 운영 복제 DB에서 migration과 backup restore rehearsal 성공
- 각 신규 query의 `EXPLAIN ANALYZE`, 예상 row scan, 필요한 composite index 검토 완료
- dual-write reconciliation과 cutover feature flag/중단 절차 검증. 실제 read/canonical write 전환은 Phase 11에서 수행
- 최소 관찰 기간 또는 최소 처리 건수는 실제 운영량 측정 후 Go/No-Go 문서에 확정

**상대 작업량**: XL  
**선행조건**: Phase 0 결정, Phase 1 백업, Phase 4 migration 기반

## Phase 6. 백엔드 compatibility facade 축소와 잔여 경계 정리

**목적**  
Phase 5A~5F의 각 수직 전환에서 이미 만든 repository/use case를 다시 구현하지 않고, 전환 중 유지한 legacy facade와 중복 경계를 안전하게 제거한다.

Phase 5의 각 수직 단위에는 다음이 포함된다.

- repository port와 운영 DB 구현
- row mapper와 runtime validation
- application use case와 필요한 pure domain policy
- transaction과 audit
- controller compatibility facade
- unit + repository integration + API e2e
- `EXPLAIN ANALYZE`, row scan, index 검토
- 필요한 page/export query specification 구현

Phase 6은 해당 수직 기능의 **application 경로 이관**이 끝나는 즉시 점진적으로 수행할 수 있으며, 모든 5A~5F가 끝날 때까지 기다릴 필요가 없다. 단, Phase 11 전에는 old model dual-write와 shadow 비교에 필요한 compatibility repository adapter를 제거하지 않는다.

**주요 작업**

1. compatibility facade 사용량과 호출 경로 확인
2. 기존 대형 service의 이관 완료 method·SQL 제거
3. 중복 권한 검사와 transaction helper를 Phase 4 공통 정책으로 통합
4. Controller가 신규 use case에 직접 위임하도록 축소
5. client row 기반 export를 canonical server query로 전환
6. legacy response adapter의 deprecation issue와 제거 조건 관리
7. migration/health/bootstrap SQL 예외 경계 문서화
8. 죽은 DTO, row interface, mapper, test fixture 제거

**가번호 잔여 경계 완료 기준**

- 공통 lock order와 setting optimistic version 사용
- assign/close/reopen idempotency와 범위 변경 검증 사용
- absent policy 상태 전이가 신규 use case 한 곳에 존재
- 승인한 실제 동시성 profile에서 중복 0, 마감 후 할당 0

**완료 기준**

- Controller는 DTO와 응답 변환만 담당
- Domain이 Nest/운영 DB/Excel에 의존하지 않음
- use case가 transaction 경계를 소유
- 업무 모듈의 조회·변경 SQL이 repository/infrastructure adapter에 집중됨. migration, health probe, bootstrap SQL은 문서화된 예외다.
- legacy facade 사용량 0이고 제거 대상 inventory에 열린 항목이 없음
- 대형 `PseudonymsService`와 `CandidatesService`의 이관 완료 책임이 제거됨

**상대 작업량**: L, 단 각 Phase 5 수직 단위와 함께 작은 작업으로 분산  
**선행조건**: Phase 4와 해당 Phase 5A~5F 수직 cutover

## Phase 7. 프런트 앱 셸·API 계층·공통 UI

**목적**  
화면별로 반복되는 세션, 경로, 요청, 버튼, 모달, 토스트의 공통 행동을 통합한다.

**주요 작업**

### Phase 7A. App shell과 데이터 경계

1. 명시적 router와 기존 URL route registry
2. `SessionProvider`와 역할별 route guard
3. 교시 미선택 guard와 개발자 guard
4. 공통 401 세션 종료 처리
5. JSON/blob/download/timeout/AbortSignal을 지원하는 HTTP client
6. API schema/type 검증
7. TanStack Query query key와 invalidation 정책
8. route-level lazy loading
9. Page Error Boundary와 retry UI
10. 공통 NavigationBlocker

세션 logout, 401, 다른 사용자 로그인 때 보호 query를 제거하거나 QueryClient를 초기화한다. query key에는 사용자/권한/scope를 반영한다. 가번호 할당, 마감·재개, upload commit, 인쇄처럼 비멱등 mutation은 자동 retry를 기본 비활성화한다. 저장된 교시는 이름이 아닌 schedule/slot ID로 유지하고, `/operation` 진입 때 서버에서 존재·권한·상태를 재검증한다.

lazy loading은 로그인 shell → 관리자/사용자 역할 route → 양식 편집기 → 프린터 설정 → PDF 생성기 순으로 적용한다. route별 JS와 CSS를 따로 측정하고, editor CSS가 로그인/사용자 route에서 내려오지 않는지 확인한다.

### Phase 7B. 최소 디자인 기반

11. color, typography, spacing, control height, radius, shadow, z-index 최소 token
12. reset/global/focus/reduced-motion 기준

### Phase 7C. 공통 UI

13. Button, IconButton, Dialog, ConfirmDialog, Popover, Toast, InlineAlert, ValidationMessage, FormField, Switch, Card, Brand
14. focus/ESC/aria/reduced-motion 공통 동작
15. overlay stack과 최상위 overlay만 ESC 처리
16. focus trap/inert/scroll lock의 stack reference count

일시적 성공과 전역 오류는 Toast, 입력·업로드·미리보기 검증 오류는 InlineAlert/ValidationMessage로 구분한다. 사용자 수험번호 오류와 업로드 미리보기 오류처럼 위치 자체가 UX 요구인 경우 공통 Toast로 강제하지 않는다. 외부 editor가 직접 생성한 overlay는 Adapter 호환 대상으로 별도 관리한다.

**서버 상태 분류**

- 서버 상태: TanStack Query
- 복합 업무 흐름: reducer/state machine
- 단순 입력: 지역 form state
- 세션·프로필: provider
- 메뉴/필터 공유 상태: URL 또는 명시적 session state
- modal/toast: UI provider

**완료 기준**

- 직접 `window.history` 조작 제거
- raw fetch는 HTTP client와 기술 adapter 외에 없음
- 모든 modal이 ESC/focus 기준 통과
- 전역 알림은 공통 Toast, 입력/업로드 검증은 공통 InlineAlert/ValidationMessage 계약 사용
- dirty 화면의 메뉴/뒤로가기/새로고침/로그아웃 보호가 동일
- 기존 URL 새로고침과 session 복원 유지
- logout/401/사용자 변경 후 이전 계정의 보호 query cache가 남지 않음
- 비멱등 mutation의 자동 retry가 비활성화됨
- 저장된 schedule ID가 서버 검증에 실패하면 선택값을 지우고 교시 선택으로 이동
- 중첩 overlay에서 최상위 항목만 ESC로 닫힘

**상대 작업량**: L~XL  
**선행조건**: Phase 2, Phase 4 계약과 병행 가능

## Phase 8. 디자인 토큰·DataGrid·주요 화면 분해

**목적**  
현재 UI를 보존하면서 중복 UI 로직과 CSS 누적을 제거한다.

**주요 작업**

1. Phase 7의 최소 token을 FHD/QHD·카드·그리드 token으로 확장
2. 프로젝트 소유 CSS를 `tokens.css`, `reset.css`, `globals.css`, 공통 UI, feature CSS로 분리
3. 공통 UI CSS를 feature CSS보다 먼저 이관
4. 외부 package API/DOM/CSS/data-tag/lifecycle을 감싸는 `TemplateEditorAdapter`를 FormTemplateManager 분해 전에 도입
5. 우선 controlled client-state 기반 headless `useDataGridState`와 typed column definition
6. Phase 4 계약과 Phase 5B/6에서 구현한 paged endpoint가 준비된 화면부터 server data adapter 추가
7. 수험생 그리드 → 계정 그리드 → 운영 roster 순서로 전환
8. sorting/filter/전체선택/empty/loading/hover/selection/pagination 테스트
9. `PseudonymAssignmentPage`를 상태 머신과 하위 컴포넌트로 분해
10. `SystemSettingsPage`의 form reducer와 range editor 분리
11. Adapter 경계 안에서 `FormTemplateManager`의 library/editor/metadata 분리
12. 외부 편집기 CSS를 integration override로 격리
13. 사용되지 않는 selector는 runtime coverage+visual test 후 삭제

**반응형 계약**

- 1920×1080: 현장 기준 최소 크기, 불필요한 전체 페이지 세로 스크롤 없음
- 2560×1440: 컨테이너와 폰트를 제한적으로 확대
- 1600×900, 1366×768: 필요한 grid/panel만 스크롤
- 시스템 설정 카드: FHD 최소 너비를 유지한 3열
- 양식 관리 카드: FHD 최소 너비를 유지한 4열
- 사용자 패널: 폭과 높이 중 더 제한적인 축을 기준으로 scale
- `100dvh` 우선, `100vh` fallback
- 페이지 전체 horizontal scroll 금지
- Windows 화면 배율 100%, 125%, 150%는 Phase 0에서 승인된 지원 범위대로 검수

**완료 기준**

- 세 화면의 그리드 기능이 같은 구현을 사용
- 운영 roster는 pagination만 옵션으로 제외
- 전체 선택 시 필터 활성 UI가 제거됨
- selected/hover 색상이 모든 셀에 동일
- FHD/QHD screenshot diff 승인
- 프로젝트가 직접 소유한 전역 CSS에는 token/reset/global만 남기는 방향으로 감소. 외부 editor CSS는 adapter와 `integration-overrides.css`에 격리한다.
- 신규 `!important` 없음

**상대 작업량**: XL  
**선행조건**: Phase 7 공통 UI

## Phase 9. 업로드·양식·출력 파이프라인 강화

세 파이프라인은 서로 독립적인 대형 작업이므로 한 번에 완료하지 않는다. 9A, 9B, 9C는 각자 별도 배포·rollback·완료 승인을 갖는다.

### Phase 9A. 수험생 업로드

- 현재 안전 경계: actor·파일 checksum·DB 상태·수험번호 유일 정책·TTL을 서명한 stateless preview ticket
- 반영 시 같은 파일과 잠근 DB 상태를 검증하고 선택한 처리 정책으로 재계획
- 대용량 운영 전환: durable import batch와 staging table
- XLSX streaming 또는 메모리 상한이 명확한 parser
- 장기 실행·재개가 필요한 배치에서는 preview와 commit을 동일 batch ID로 연결
- bulk insert/upsert
- 실패 행 상세 리포트
- ZIP 항목 수, 압축률, 해제 용량, magic byte, 픽셀 제한
- 사진 정확 매칭과 중복 media 저장 방지
- import audit와 checksum
- Phase 6의 server query specification을 사용하는 canonical export

### Phase 9B. 양식 관리

- `TemplateEditorAdapter`
- ExamList UI golden screenshot
- 현재 버전 동작 특성화와 승인된 ADR 범위의 immutable/publish lifecycle
- 제목·설명 metadata aggregate 또는 revision 정책
- layout schema version과 migration
- 데이터 태그 validation
- sanitize + CSP/sandbox
- PDF 진행률, 취소, 사진 동시성 제한, 메모리 해제
- 대량 출력의 Web Worker/서버 PDF 타당성 측정
- sanitizer report-only 영향 목록 → 신규 저장 강제 → 기존 양식 quarantine/호환 renderer → 승인 후 전면 적용

### Phase 9C. 프린터/Print Job

- workstation 하드코딩 제거
- PrintJob state machine
- idempotency key와 unique index
- expiry worker와 retention
- compare-and-set 완료 처리
- 재출력 사유와 원본 참조
- 서버에서 라벨 출력 사용 설정 강제
- SDK/드라이버 checksum manifest
- mock test와 실제 장비 matrix 분리

**완료 기준**

- 합의된 최대 XLSX/ZIP에서 메모리 상한 유지
- preview의 정책 독립 `신규/수정/동일` 분류가 동일 파일·동일 DB snapshot을 나타내고, commit 결과는
  사용자가 선택한 정책으로 잠금 안에서 재계획한 집계와 일치
- 기존 편집기 양식 렌더 결과 유지, XSS 차단
- 중복 인쇄 요청이 하나의 job만 생성
- 만료 job 완료 불가
- 라벨 비활성 전형의 직접 API 호출 차단
- printer production-readiness 승인 시 실제 GT800 연속 출력과 재연결 시나리오 기록. 장수는 실제 운영 기준을 조사한 후 확정한다.

**상대 작업량**: XL  
**선행조건**: Phase 4~8의 해당 경계

## Phase 10. 성능·관측성·staging 운영 전환

**목적**  
Phase 4에서 구현한 log/health/config 기능을 실제 운영 플랫폼과 연결하고 신규 구조의 용량·배포 안정성을 검증한다.

**주요 작업**

1. 각 수직 이관에서 수집한 query plan을 실제 대표 데이터로 최종 부하 검증
2. 대시보드 aggregate API와 설정 overview batch API 튜닝
3. route/editor/PDF/printer lazy chunk 최적화
4. 폰트 자체 호스팅과 필요한 weight만 제공
5. API latency, DB pool, 로그인 실패, 가번호 충돌, upload, print metrics를 선택한 관측 플랫폼에 연결
6. liveness/readiness probe, graceful shutdown, alert rule 검증
7. staging 배포와 SPA history fallback
8. HTTPS와 환경별 config/secret 주입
9. migration 배포·백업·복원·rollback runbook
10. 데이터 보존·파기와 용량 증가 예측
11. old Web/new API, new Web/old API, old API/expanded DB, new API/pre-contract DB 호환 matrix 자동 검증
12. 오류율, latency, migration mismatch, audit 실패에 대한 배포 중단/rollback threshold 승인

**완료 기준**

- staging 배포 자동화와 rollback 검증
- 관측 플랫폼에서 alert test를 실행하고 담당자가 실제 수신
- runbook만으로 주요 장애 대응 가능
- 승인한 compatibility matrix 조합의 contract test 통과
- 기준 workload의 API/DB/import/PDF peak memory와 latency 보고
- 현재 문서, 환경변수, 실제 URL과 명령이 일치

**상대 작업량**: L  
**선행조건**: Phase 5~9의 운영 후보 기능

## Phase 11. 신규 모델 canonical 전환과 관찰

**목적**  
legacy 구조를 남겨둔 상태에서 신규 모델을 단일 read/write 기준으로 전환하고 충분한 관찰 기간을 확보한다.

**주요 작업**

1. feature flag로 신규 read 100% 전환
2. old/new dual-write를 유지한 채 승인 기간/처리량 동안 shadow 결과와 업무 집계 mismatch 관찰
3. 신규 모델 canonical write 승인
4. legacy write 중단
5. legacy write 중단 전까지는 raw old/new mismatch를 비교하고, 중단 후에는 신규 모델 invariant와 compatibility API 결과를 검증
6. reconciliation job은 legacy 종료 전 mismatch 확인에 사용하고, 종료 후에는 신규 모델 무결성 검사로 전환
7. 이전 Web/API binary가 더 이상 배포되지 않도록 artifact/deployment 정책 확인
8. post-cutover 오류율·latency·audit·업무 집계 관찰 후 Phase 12 Go/No-Go 승인

**완료 기준**

- legacy dual-write 관찰 기간/처리량 동안 old/new mismatch 0
- 신규 모델 단일 write/read로 모든 핵심 E2E 통과
- legacy write를 다시 켜지 않고 정상 운영
- legacy write 중단 이후 신규 모델 invariant와 compatibility API 결과 오류 0
- 파괴적 contract 단계의 rollback이 DB restore/forward repair라는 사실을 운영 책임자가 승인

**상대 작업량**: M  
**선행조건**: Phase 10 staging·관측성

## Phase 12. 별도 승인된 contract migration과 legacy 제거

**목적**  
롤백 위험이 큰 삭제 작업을 일반 성능/정리 작업과 분리해 마지막에 수행한다.

**주요 작업**

1. legacy `examinee`, 이름 기반 relation, 중복 컬럼 참조 inventory 재확인
2. 코드·SQL·문서에서 legacy 참조 0 검증
3. 최종 backup/restore rehearsal
4. 별도 contract migration 승인
5. 작은 migration 단위로 제약·컬럼·테이블 제거
6. 죽은 코드·미사용 CSS·구버전 tarball·demo seed 정리
7. deprecation issue와 compatibility adapter 제거
8. README, architecture, data model, runbook 최종 갱신

**진입 조건**

- dual-write 종료 승인
- 신규 모델 단일 write/read 관찰 완료
- old/new mismatch 0
- 이전 binary가 더 이상 배포되지 않음
- legacy 참조 0
- backup restore rehearsal 성공

**완료 기준**

- contract migration 후 전체 DB/API/E2E 검증 통과
- 제거 대상 inventory와 열린 deprecation issue 0
- 필요한 forward repair와 restore 절차 최신화
- legacy 자산은 삭제 여부와 보관 위치를 사용자 승인 기록과 함께 처리

**상대 작업량**: M~L  
**선행조건**: Phase 11 승인

---

## 10. 단계 간 의존 관계

```text
Phase 0 업무 결정 ───────────────────────────────┐
                                                  ├→ Phase 5A~5F 수직 데이터 전환 ↔ Phase 6 slice별 facade 정리 ─┐
Phase 1 기준선 → Phase 2A 최소 harness → Phase 3 hotfix → Phase 4 공통 기반 ───────┤
                    └──────────────→ Phase 2B 전체 CI ─→ Phase 7 App/UI 기반 → Phase 8 화면 이관 ────────┤
                                                                                                         ├→ Phase 9A/B/C
                                                                                                         └→ Phase 10 staging/운영
                                                                                                              → Phase 11 canonical 관찰
                                                                                                              → Phase 12 contract 제거
```

이 구조는 WIP를 무제한 병렬화한다는 의미가 아니다. 한 팀은 동시에 최대 한 개의 데이터 수직 전환과 한 개의 UI 수직 전환만 진행하고, P0 hotfix와 기준선 구축을 우선한다. Phase 5와 Phase 7은 일부 병행 가능하지만 다음은 병행하지 않는다.

- DB unique scope가 미확정인 상태에서 가번호 use case 재작성
- 공통 Dialog 없이 모든 modal을 개별 리팩토링
- API pagination 계약 확정 전에 세 그리드를 동시에 변경
- sanitizer fixture 없이 양식 HTML 처리 변경
- 실제 백업 없이 legacy table drop

---

## 11. 테스트 전략 상세

## 11.1 단위 테스트

대상:

- PseudonymNumber parse/normalize/render
- range capacity와 overlap
- random/sequential/manual/preassigned 선택 규칙
- operation state transition
- absentee policy
- permission/admission access policy
- upload header/date/time normalization
- template layout/tag validation
- grid sort/filter reducer
- operation state machine
- navigation blocker 상태

목표:

- 핵심 도메인 분기 90% 이상, 가장 중요한 가번호/마감 규칙은 100%에 가깝게 유지
- 시간·무작위·ID 생성은 주입 가능하게 설계
- 오류 메시지가 아니라 error code를 검증

## 11.2 운영 DB 통합 테스트

- 운영과 같은 제품·major version, sql_mode, timezone, collation으로 고정
- 빈 DB 001→latest migration
- 직전 배포 N-1→latest upgrade
- 익명화 운영 snapshot→latest
- migration checksum과 lock
- 부분 적용/dirty 상태 감지와 migration별 forward repair/restore runbook
- repository row mapping
- DML transaction rollback
- audit 원자성
- unique/FK/check constraint
- assign 동시성
- assign vs close/reopen/settings update
- 같은 수험번호 복수 일정
- 번호 정규화 충돌
- import batch 원자성

SQLite는 잠금, isolation, DDL, collation 동작이 다르므로 대체 DB로 사용하지 않는다.

## 11.3 API E2E

- 로그인 성공/실패/rate limit/토큰 만료
- 비밀번호 변경 후 토큰 무효화
- ADMIN/OPERATOR/DEVELOPER 권한 행렬
- ADMIN은 일반 계정 API로 DEVELOPER 계정 변경 불가, DEVELOPER는 최상위 업무 권한 유지
- 전형 배정/미배정 범위
- 현재 교시/다른 교시/미존재 수험생 조회
- settings version 충돌
- assign/close/reopen/idempotency
- 업로드 오류 envelope
- template sanitize/publish
- print policy/idempotency/expiry

## 11.4 프런트 컴포넌트 테스트

- Button/IconButton 상태와 접근 가능한 이름
- Dialog ESC/focus trap/return focus
- ConfirmDialog 3버튼 흐름
- Toast placement/자동 종료/중복 정책
- DataGrid sort/filter/전체선택/pagination/selection
- NavigationBlocker
- 메뉴 이동/뒤로가기/새로고침/로그아웃의 dirty 보호
- logout/401/사용자 변경의 Query cache 격리
- 저장 schedule 서버 재검증
- 최상위 overlay만 ESC 종료
- SystemSettings reducer와 range editor
- Operation reducer와 자동 추첨 fake timer
- 사진 stale response 차단
- 자동 추첨 callback의 candidate/schedule 재검증
- TemplateEditorAdapter lifecycle

## 11.5 Playwright E2E 및 시각 회귀

해상도:

- 모든 UI 변경: 1920×1080, 2560×1440
- responsive/layout 변경: 1600×900, 1366×768 추가
- release smoke: Phase 0에서 승인된 Edge/Chrome 최소 버전과 Windows 화면 배율

시각 비교의 flaky 결과를 줄이기 위해 OS image, 자체 호스팅 font, 브라우저 버전, 100% 기본 배율, frozen clock, seed data, animation 감소 설정을 고정한다. 125%/150% 배율은 지원 정책에 따라 별도 수동 또는 전용 runner 검수로 관리한다.

화면/상태:

- 로그인
- 관리자 대시보드
- 수험생 데이터 빈/데이터/업로드 오류 modal
- 양식 관리 4열/편집기/메타데이터
- 시스템 설정 3열/전형 설정 modal/dirty confirm
- 계정 관리 CRUD
- 개발자 설정
- 교시 선택 날짜별 카드
- 사용자 운영 빈 상태/조회/다른 교시/추첨/자동 추첨/마감/인쇄
- 프린터 설정 설치/미설치/mock

검증:

- 불필요한 FHD 전체 세로 스크롤 없음
- QHD 카드·폰트의 제한적 확대
- modal ESC 종료
- 키보드 focus 순서
- grid header/filter/hover/selected 색상
- 한글 줄바꿈과 panel/background 겹침 없음

## 11.6 하드웨어 테스트

자동화 가능한 부분은 MockPrinterAdapter로 검증하고, 다음은 실제 Windows PC와 GT800에서 수동 matrix로 관리한다.

- Windows driver 설치/미설치
- Browser Print 실행/종료
- USB 연결/분리/재연결
- 기본 프린터 변경
- 데이터 전송 중 브라우저 종료
- 1장/연속 100장
- 한글, 바코드, 라벨 여백
- PC 재부팅 후 재연결
- 전송 성공과 물리 출력 실패 구분

일반 리팩토링 PR은 MockPrinterAdapter와 계약 테스트를 게이트로 사용한다. 실제 Windows/GT800 matrix는 printer release candidate와 production-readiness 승인 조건이며, 장비가 없는 환경에서 unrelated core refactor를 영구 차단하지 않는다.

---

## 12. 성능 기준과 측정 계획

다음 수치는 합성 초기 profile을 위한 잠정 목표다. 실제 최대 수험생 수·동시 운영자 수·양식 페이지 수, 서버/DB 사양, LAN, cold/warm cache를 측정하기 전에는 비차단 정보성 지표로만 사용한다. Phase 1 기준선과 현장 승인 후에만 CI 차단 예산으로 전환한다.

| 항목                       |                          초기 목표 |
| -------------------------- | ---------------------------------: |
| 스케줄/roster API p95      |                         500ms 이내 |
| 단일 가번호 할당 API p95   |                         300ms 이내 |
| 일반 화면 주요 콘텐츠 표시 |                           2초 이내 |
| Print Job 생성 p95         |                         500ms 이내 |
| ZPL 생성                   |                         100ms 이내 |
| 10,000명 목록              | 전체 payload 금지, 서버 pagination |
| 동시 할당                  |                           중복 0건 |
| 마감 후 할당               |                                0건 |
| 초기 로그인 JS gzip        |                    잠정 100kB 이하 |
| 사용자 운영 초기 JS gzip   |                    잠정 180kB 이하 |

측정 항목:

- API endpoint p50/p95/p99
- DB 쿼리 실행 시간과 row scan
- DB pool 사용량과 wait
- import 행 수/초, peak memory
- ZIP 압축률과 해제 메모리
- PDF 페이지 수별 시간과 peak memory
- React 주요 화면 commit 수
- route별 JS/CSS chunk
- 브라우저 font loading과 layout shift

JS와 CSS 예산은 route별로 분리한다. 특히 로그인·사용자 route에서 양식 편집기 CSS/JS가 내려오지 않는지를 별도 검사한다. import, ZIP, PDF, 마감에는 시간뿐 아니라 peak memory 예산을 포함한다.

성능 개선은 추측으로 인덱스나 memo를 추가하지 않고 측정 전후를 기록한다.

---

## 13. 접근성 기준

목표 표준은 **WCAG 2.2 AA**다. axe 자동 검사는 보조 수단이며 키보드, focus 이동, 화면 확대, 스크린리더의 수동 검수를 함께 수행한다. 외부 양식 편집기에서 즉시 고칠 수 없는 항목은 예외 근거와 대체 동작, 공급 패키지 개선 issue를 기록한다.

- 모든 modal에 `role=dialog`, `aria-modal`, 제목 연결
- focus trap, 최초 포커스, trigger 복귀
- 배경 inert와 스크롤 잠금
- 모든 기능 버튼에 접근 가능한 이름
- 테이블/grid에 caption 또는 aria label
- 정렬 column에 `aria-sort`
- 필터 결과 건수와 토스트를 적절한 live region으로 알림
- 클릭 가능한 행의 키보드 동등 동작
- 전역 `:focus-visible`
- 색상 외에 텍스트/아이콘으로 상태 구분
- `prefers-reduced-motion`에서 추첨 애니메이션 대체
- 본문 14px, 보조 텍스트 최소 12px를 기본 기준으로 검토
- axe critical/serious 위반 0건

---

## 14. API·DB 호환과 배포 전략

### 14.1 API

- 기존 endpoint와 응답 shape는 compatibility facade로 유지한다.
- 신규 error `code`를 먼저 추가하고 UI가 이를 사용한 뒤 문자열 의존을 제거한다.
- pagination은 기존 배열 endpoint와 응답 shape를 섞지 않는다. `/api/v2/...` page envelope 또는 별도 paged endpoint를 도입하고 Web 전환, 구 endpoint 사용량 관찰, deprecation 기간, 제거 조건을 명시한다.
- 계약 파괴가 불가피하면 `/api/v2` 또는 명시적 migration window를 사용한다.

### 14.2 DB

- 019 이후 forward-only migration
- 배포 전 자동 백업
- migration checksum/lock
- expand와 contract를 서로 다른 배포로 분리
- backfill은 재실행 가능하고 진행 상태를 기록
- 큰 테이블 변경은 lock 시간과 실행 계획을 사전 검증
- contract migration 전 old/new shadow 결과 승인

### 14.3 프런트엔드

- 기존 route와 sessionStorage key는 이관 기간에 유지하되 ADR에서 정한 최종 인증/선택 상태 모델로 전환한 뒤 제거 조건과 migration을 실행
- 새 provider/router 내부로 한 화면씩 이관
- 공통 UI는 compatibility class를 제공한 뒤 기존 CSS를 제거
- route lazy loading은 사용자 화면부터 크기 회귀를 측정

### 14.4 롤백

- 코드 rollback과 DB rollback을 동일 개념으로 보지 않는다.
- expand 단계는 구버전 코드가 새 컬럼을 무시할 수 있어야 한다.
- write 전환 후에는 reverse backfill 또는 restore 전략을 준비한다.
- 파괴적 contract migration은 즉시 코드 rollback이 불가능하므로 별도 승인한다.

---

## 15. 위험 등록부

아래 표는 문서 수준 요약이다. 실제 risk register에는 각 항목의 owner, trigger, 예방 조치, contingency, residual risk, 검토일을 추가한다.

| 위험                                             |      수준 | 예방/대응                                                            |
| ------------------------------------------------ | --------: | -------------------------------------------------------------------- |
| 가번호 unique scope를 잘못 확정                  | 매우 높음 | Phase 0에서 예제 데이터와 서면 승인, DB 변경 전 ADR                  |
| legacy 데이터 backfill 충돌                      | 매우 높음 | dry-run, 원본 백업, 자동 수정 금지, 승인 예외 목록                   |
| 마감 중 동시성 회귀                              |      높음 | 공통 lock order, 운영 DB 병렬 테스트, 409 정책                       |
| `db:setup`에 의한 계정 초기화                    | 매우 높음 | Phase 3 선행 수정과 반복 실행 테스트                                 |
| API 변경으로 UI 전체 장애                        |      높음 | compatibility facade, contract test, 수직 이관                       |
| CSS 분해 중 시각 회귀                            |      높음 | 화면 단위 이관, FHD/QHD golden screenshot                            |
| editor sanitizer가 정상 양식 제거                |      높음 | 실제 양식 fixture 기반 allowlist, 점진 적용                          |
| editor 패키지 업데이트로 DOM override 파손       |      높음 | Adapter와 integration override, 버전 호환 테스트                     |
| XLSX/ZIP 메모리 급증                             |      높음 | staging/streaming/상한/압축률 테스트                                 |
| migration 중 장시간 lock                         |      높음 | expand-contract, 복제 DB rehearsal, off-hours                        |
| 인증 강화 후 관리자 잠김                         |      중간 | break-glass 절차, bootstrap CLI, 복구 runbook                        |
| React Query stale data로 현장 오작동             |      높음 | 짧은 stale time, mutation invalidation, 출력 자동 재시도 금지        |
| Print `SENT`를 물리 성공으로 오해                |      중간 | UI/문서 용어 명시, actual device test 분리                           |
| 레거시 자산의 민감정보 유출                      | 매우 높음 | 권한 감사, 저장소 격리, 자격증명 회전                                |
| 리팩토링 중 신규 요구사항 누적                   |      높음 | change freeze, 별도 feature branch/issue, 작은 수직 단위             |
| 한글 charset/collation/Unicode 정규화 충돌       |      높음 | 실제 DB 설정 inventory, NFC 정규화 정책, dry-run 충돌 보고           |
| 서버·브라우저·DB timezone 차이                   |      높음 | 저장/표시 timezone ADR, 날짜·교시·등록일시 회귀 테스트               |
| multi-tab·다중 운영자의 stale 상태               |      높음 | setting version, operation 재조회, 충돌 UI, 필요 시 push/poll 정책   |
| dual-write 일부 성공·재처리 중복                 | 매우 높음 | 동일 transaction, idempotency, reconciliation, mismatch alert        |
| old Web/new API 등 순차 배포 호환 실패           |      높음 | compatibility matrix와 contract test, cutover 중단 기준              |
| 사진·Excel·backup 개인정보 유출                  | 매우 높음 | 데이터 등급, 암호화, 접근통제, retention, 익명화 fixture             |
| audit/BLOB 증가로 DB·backup 용량 급증            | 중간~높음 | 성장률 metric, archive/partition, 보존 정책, capacity alert          |
| CSP가 Browser Print/editor/blob 렌더를 차단      |      높음 | report-only CSP, localhost/blob/data use case fixture, 단계 적용     |
| 외부 editor·driver·legacy binary 공급망/라이선스 |      높음 | checksum, 서명, SBOM, 라이선스·재배포 승인, vendor inventory         |
| OS/font/time 차이로 visual test flaky            |      중간 | 고정 runner/font/clock/seed/animation, 허용 diff 정책                |
| 관측 플랫폼 미확보                               |      중간 | Phase 0 플랫폼 결정, 최소 구조화 로그 대안, 운영 승인 전 미완료 표시 |

### 15.1 개인정보·백업 필수 정책

- 수험생 기본정보, 사진, 출력 PDF/Excel, 감사 로그, DB backup의 데이터 등급을 정의한다.
- 전송 구간 TLS와 저장 데이터/backup 암호화 정책을 확정한다.
- backup 위치, 접근 역할, 반출, 키 관리, 복구 시 감사 절차를 정한다.
- 보관·삭제 schedule과 법적/계약상 보존 근거를 기록한다.
- 테스트 fixture, 화면 baseline, 로그에는 실제 개인정보를 사용하지 않는다.
- RPO/RTO와 실제 restore 소요 시간을 측정한다.
- export 파일의 임시 저장, 브라우저 다운로드, 폐기 책임을 runbook에 포함한다.

### 15.2 감사 이벤트 원자성 정책

- 성공한 업무 mutation의 감사 이벤트는 가능하면 업무 transaction과 원자적으로 기록한다.
- 로그인 실패, 권한 거부처럼 업무 transaction이 없는 보안 이벤트는 별도 내구성 경로로 기록한다.
- 감사 저장 실패 시 업무 전체를 실패시킬 event와 비동기 보완할 event를 matrix로 구분한다.
- before/after 허용 field, masking, actor 삭제/비활성화 시 FK 정책을 정한다.
- audit retention, archive/partition, 조회 권한을 정한다.

---

## 16. 품질 게이트

공통 정적 검사는 모든 코드 변경에 적용하고, 비싼 테스트는 변경 위험에 따라 적용한다.

### 16.1 코드

- lint, typecheck, build 성공
- 신규 `any`, `@ts-ignore`, 비검증 type assertion 금지 또는 사유 기록
- 신규 `!important` 금지 또는 외부 패키지 override 사유 기록
- 신규 중복 Dialog/Toast/Grid 구현 금지
- 업무 규칙이 Controller, React page, SQL 문자열에 새로 들어가지 않음

### 16.2 테스트

| 변경 유형                 | 필수 게이트                                                   |
| ------------------------- | ------------------------------------------------------------- |
| 모든 코드 변경            | lint, typecheck, 관련 unit, build                             |
| DB/API 변경               | 운영 DB integration, API contract, migration matrix 해당 항목 |
| 핵심 가번호/마감 변경     | named invariant test, 병렬성 test, 역할별 E2E                 |
| UI 동작 변경              | component test, 1920×1080·2560×1440 시각 검수, axe            |
| responsive/layout 변경    | 위 기준 + 1600×900·1366×768                                   |
| printer 변경 PR           | MockPrinterAdapter와 Print Job 계약 test                      |
| printer release candidate | 실제 Windows/GT800 수동 matrix                                |
| 문서만 변경               | 링크·명령·문서 구조 검증, 코드 E2E는 생략 가능                |

- 기존 28개 테스트의 시나리오/의도를 보존한다. 개수 자체는 게이트가 아니다.
- 최초 coverage baseline을 저장하고 전체/changed-lines 하락 기준을 승인한다.
- 가번호·범위·마감 domain branch coverage 목표는 기준선 측정 후 숫자로 고정한다.
- coverage 예외에는 owner, 사유, 만료일이 필요하다.
- UI 접근성은 axe critical/serious 0과 키보드 수동 검수를 함께 사용한다.

### 16.3 데이터

- backup/restore 검증
- migration checksum
- backfill 건수와 오류 보고
- 가번호 중복 0
- old/new 집계 비교
- 파괴적 변경은 별도 승인

### 16.4 보안

- 운영 기본 secret/비밀번호 없음
- 권한 matrix 테스트
- 업로드 magic byte/size/ratio 검증
- template sanitizer
- 민감정보 로그 미포함
- registry/scanner가 확보된 후 dependency high/critical 0 또는 owner·사유·만료일이 있는 승인 예외
- lockfile scanner, SBOM, editor/driver/binary 라이선스·서명 검증

### 16.5 운영

- request ID와 구조화 로그
- liveness/readiness
- 배포·rollback·migration 문서 갱신
- 장애 시 사용자 메시지와 운영 로그 모두 확인 가능
- 일반 PR은 mock, printer release candidate는 실제 장비 checklist 수행

---

## 17. 문서 재구성 계획

현재 `project_plan.md`는 초기 설계, 목표 구조, 프린터 연구, 운영 계획이 한 문서에 섞여 있다. 리팩토링과 함께 다음처럼 역할을 분리한다.

```text
README.md                         # 설치와 개발 시작
REFACTORING_PLAN.md               # 본 실행 계획
docs/architecture/current.md      # 현재 구조
docs/architecture/target.md       # 목표 구조와 의존 규칙
docs/adr/*.md                     # 중요 업무/기술 결정
docs/data-model.md                # ERD, unique scope, migration 전략
docs/api.md                       # 계약과 오류 코드
docs/security.md                  # 인증, 권한, 업로드, 양식 보안
docs/runbooks/deploy.md
docs/runbooks/backup-restore.md
docs/runbooks/migration.md
docs/runbooks/printer.md
docs/testing/browser-matrix.md
docs/testing/hardware-matrix.md
docs/legacy-inventory.md
```

문서 불일치도 테스트 가능한 항목으로 관리한다.

- README의 실제 route
- `.env.example`과 실제 사용 환경변수
- 초기 계정 생성 동작
- MySQL/PostgreSQL 표현
- 드라이버/프린터 진입 경로
- 데이터 태그와 실제 업로드 컬럼

---

## 18. 첫 실행 배치 권장 목록

리팩토링 승인 후 첫 작업 배치는 다음 순서가 적절하다.

### Batch A — 기준선과 복구 가능성

1. `[RF-001]` Git 추적/제외 목록 감사
2. `[RF-002]` setup 레거시 자산·민감정보 보고서 및 격리 정책
3. `[RF-003]` DB backup/restore rehearsal
4. `[RF-004]` 현재 FHD/QHD 화면과 API fixture 수집
5. `[RF-005]` 최초 기준 커밋과 태그

### Batch B — P0 최소 harness와 hotfix

1. `[RF-010]` 운영과 같은 DB 제품/major version의 통합 테스트 환경
2. `[RF-011]` Nest API e2e 최소 harness
3. `[RF-012]` db:setup 계정 덮어쓰기 실패 재현과 안전 seed 수정
4. `[RF-013]` ADMIN의 일반 계정 API를 통한 DEVELOPER 변경 차단 테스트와 수정
5. `[RF-014]` 기본 secret/config fail-fast 테스트와 수정
6. `[RF-015]` close vs assign 결정적 병렬 재현과 잠금 hotfix
7. `[RF-016]` settings cursor 보존·범위 검증 테스트와 hotfix

### Batch C — 전체 자동 검증 기반

1. `[RF-020]` ESLint/Prettier/no-unused 단계적 도입
2. `[RF-021]` React Testing Library 기본 harness
3. `[RF-022]` Playwright 역할별 smoke test
4. `[RF-023]` FHD/QHD visual baseline
5. `[RF-024]` CI pipeline과 `npm run check`
6. `[RF-025]` migration matrix와 checksum manifest

### Batch D — 업무 결정과 데이터 진단

1. `[RF-030]` 동일 수험번호 복수 교시 데이터 진단 SQL
2. `[RF-031]` 가번호/사전가번호 normalization 충돌 보고서
3. `[RF-032]` orphan·중복·범위 밖 assignment 보고서
4. `[RF-033]` 가번호 unique scope ADR 승인
5. `[RF-034]` candidate/slot/segment 목표 ERD 승인
6. `[RF-035]` exam cycle과 빈 admission fallback mapping 보고서
7. `[RF-036]` 027 이상 목표 모델 expand migration 설계 리뷰

첫 배치에서는 대형 서비스 파일 분할, CSS 전면 정리, Router 전환을 시작하지 않는다. 기준선과 테스트가 없는 상태에서의 구조 이동은 회귀 비용만 높인다.

---

## 19. 진행 현황 관리 방식

각 리팩토링 issue/PR에는 다음 정보를 필수로 둔다.

- 목적과 해결하려는 위험 ID
- 동작 변경 여부
- 영향받는 API/DB/UI
- migration과 rollback 필요 여부
- 추가/변경 테스트
- FHD/QHD 브라우저 검수 결과
- 성능 전후 수치
- 보안·개인정보 영향
- 문서 변경
- 후속 legacy 제거 issue

권장 상태:

```text
Proposed → Approved → Characterized → Implementing → Verifying → Observing → Completed
```

DB dual-write/shadow-read가 포함된 작업은 `Verifying` 직후 완료하지 않고 일정 기간 `Observing` 상태를 거친다.

---

## 20. 전체 완료 정의

리팩토링은 단순히 파일이 작아졌을 때 완료되는 것이 아니다. 다음 조건을 모두 충족해야 한다.

### 데이터와 업무

- `candidate_record`와 legacy `examinee`의 이중 원본이 제거되거나 명확한 단일 원본으로 전환됨
- 가번호 할당이 정확한 일정 등록 행을 참조함
- unique scope가 업무 문서와 DB 제약에서 일치함
- 같은 수험번호의 복수 일정 시나리오가 승인된 정책대로 동작함
- 마감 후 신규 할당 0, 동시 요청 중복 0
- 설정 저장이 순차 상태를 불필요하게 초기화하지 않음
- 모든 중요 mutation이 transaction+audit로 원자적 처리됨

### 백엔드

- Controller, application, domain, repository 경계가 명확함
- SQL과 row mapping이 infrastructure에 집중됨
- 권한과 전형 scope가 중앙 정책을 사용함
- 모든 endpoint가 명시적 DTO와 공통 오류 형식을 사용함
- 빈 DB와 기존 DB migration CI가 통과함
- config, log, health, graceful shutdown이 운영 기준을 충족함

### 프런트엔드

- 명시적 router, session provider, route guard 사용
- 서버 상태는 일관된 query/mutation 정책으로 관리됨
- 공통 DataGrid/Dialog/Toast/Button이 사용됨
- 대형 페이지는 조립 역할 위주로 축소됨
- 자동 추첨과 사진 요청의 비동기 경쟁이 제거됨
- FHD/QHD 및 FHD 미만 화면 검수 통과
- modal ESC/focus, grid keyboard, reduced motion 기준 충족
- 초기 번들과 대형 기능 chunk가 예산 안에서 관리됨

### 양식과 출력 경계 — Core refactor DoD

- editor adapter와 버전 호환 fixture가 존재함
- template version/publish 규칙이 일관됨
- 악성 HTML/layout이 차단됨
- Print Job이 idempotency, expiry, state transition, audit를 지원함
- `SENT`와 실제 물리 출력 성공의 차이가 UI와 문서에 유지됨

### Printer production-readiness DoD — 프린터 기능 배포 승인 시에만 적용

- 프린터 기능을 운영 배포하는 release candidate에서 실제 Windows/GT800 검수 matrix가 완료됨
- 지원 driver/Browser Print/브라우저/화면 환경이 문서화됨
- USB 분리·재연결·연속 출력·PC 재부팅 시나리오가 승인됨

Printer production-readiness 미완료는 unrelated core refactor의 완료를 차단하지 않는다. 다만 실제 Zebra 기능을 운영 배포하는 release의 승인 조건이다.

### 운영

- 되돌릴 수 있는 Git 기준과 작은 변경 이력이 존재함
- 백업·복원·migration·배포·rollback runbook이 검증됨
- 민감 레거시 자산이 일반 소스와 격리됨
- CI가 lint/typecheck/test/build/migration/E2E를 차단 게이트로 사용함
- 관측 지표와 장애 알림이 운영됨
- README, 환경변수, 실제 URL, 명령이 일치함
- legacy 코드·테이블·CSS·패키지 제거 전에 관찰 기간과 승인을 거침

---

## 21. 최종 권고

이 프로젝트의 리팩토링 성공 여부는 코드 파일을 얼마나 많이 나누느냐보다 다음 세 가지에 달려 있다.

1. **가번호의 업무 단위를 데이터 모델과 DB 제약으로 정확하게 정의하는 것**
2. **현재 현장 동작을 실제 운영 DB·브라우저·프린터 수준에서 테스트로 고정하는 것**
3. **기존 구조를 유지한 채 수직 기능 하나씩 새 경계로 옮기는 것**

가장 먼저 착수할 일은 `기준선 커밋 + 레거시 자산 격리 + DB 백업/복원 + P0 특성화 테스트 + db:setup 안전 수정`이다. 그 이후에 데이터 모델, 백엔드 use case, 프런트 공통 UI 순으로 진행해야 한다. 이 순서를 지키면 기능 개발을 완전히 중단하지 않으면서도, 현재의 빠른 변경 비용과 회귀 위험을 단계적으로 낮출 수 있다.

---

## 22. 문서 유지 규칙과 변경 이력

본 문서는 방향·단계·Go/No-Go 기준을 유지한다. 실행 중 생성되는 endpoint inventory, field mapping, 테스트 case, risk register, migration runbook은 별도 문서로 분리하고 RF issue ID로 연결한다. 계획서에 실행 로그를 계속 누적해 또 다른 거대 현황 문서로 만들지 않는다.

각 검토 때 머리말의 기준 commit/tag, schema version, last reviewed date를 갱신한다. Phase 상태와 owner는 1.1 표 또는 별도 status 문서에서 관리한다.

| 버전 | 일자       | 변경 내용                                                                                                                             |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1  | 2026-08-27 | 프로젝트 전역 코드·DB·UI·테스트·운영 기준선 분석과 최초 상세 계획 작성                                                                |
| 0.2  | 2026-08-27 | 독립 Frontend/Backend/Quality 리뷰 반영: Phase 2A/2B, P0 hotfix, slot/segment 모델, dual-write 순서, UI 신뢰 경계, 운영/contract 분리 |
