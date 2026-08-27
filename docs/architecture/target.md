# 목표 아키텍처와 전환 규칙

> 상태: 승인 전 목표 구조  
> 관련 문서: `REFACTORING_PLAN.md`, `docs/adr/0002-target-identity-model-proposal.md`,
> `docs/data-model-cutover-gates.md`

## 목표

React + NestJS + MariaDB의 모듈형 모놀리스를 유지하면서 업무 규칙, 데이터 접근, 외부 편집기와
프린터를 교체 가능한 경계로 분리한다. 마이크로서비스나 전면 ORM 교체는 목표가 아니다.

```text
Presentation
  React route/page ── Controller + DTO
          │                    │
Application
  UI controller/query ── Use case + transaction + audit
          │                    │
Domain
  view model/policy ─── identity·range·assignment·close rules
          │                    │
Infrastructure
  API client/adapters ── Repository + MariaDB + file/printer/editor adapters
```

허용 의존 방향은 Presentation → Application → Domain이며 Infrastructure는 application/domain이
정의한 port를 구현한다. Domain은 React, NestJS, mysql2, 파일 시스템과 Browser Print를 import하지
않는다.

## 백엔드 완료 형태

- Controller에는 SQL, transaction, 비밀번호 해시, 파일 형식 판정과 업무 분기를 두지 않는다.
- use case 하나가 하나의 mutation 목적과 transaction/audit 순서를 소유한다.
- Repository는 caller-owned connection을 받아 SQL과 row mapping만 수행한다.
- 역할 permission과 전형 scope는 중앙 정책만 사용한다.
- 모든 endpoint는 DTO와 공통 오류 envelope를 사용한다.
- 가번호 부여, 설정 저장, 마감·재개, 업로드, 양식 저장, 인쇄 작업은 명명된 불변조건 테스트를
  가진다.

## 프런트엔드 완료 형태

- 앱 셸은 세션·프로필·route guard를 제공하고 기능 페이지를 지연 로딩한다.
- Page는 조립과 navigation만 담당하며 네트워크 경쟁·취소·mutation 상태는 전용 controller/hook이
  담당한다.
- 서버 상태 갱신·오류·취소·stale 방지 규칙을 공통 API/query 계약으로 통일한다.
- DataGrid, Dialog, Toast, Button과 dirty navigation guard는 공통 구현을 사용한다.
- 양식 편집기와 Browser Print는 adapter 뒤에 두고 일반 route bundle에서 분리한다.
- FHD/QHD와 작은 해상도, keyboard/focus/reduced-motion/axe 기준을 자동 검증한다.

## 목표 데이터 모델

목표 모델은 시험 주기, 일정, 수험생 identity, 일정별 등록, 가번호 범위·할당을 독립 식별자로
표현한다. 정확한 테이블과 key는 ADR 및 D01~D22 결정이 승인된 뒤 확정한다.

```text
exam_cycle
  └─ schedule
       ├─ admission/room/range segment
       └─ candidate_registration
            ├─ candidate_identity
            └─ pseudonym_assignment
```

전환은 반드시 expand → 합성/복원본 dry-run → backfill → shadow 비교 → dual-write → read 전환 →
관찰 → contract 순서로 수행한다. 기존 `001`~`025`와 현 모델 보강인 026은 수정하지 않으며 승인된
목표 identity migration만 `027` 이상으로 추가한다.

## 단계별 중단 조건

다음 항목은 로컬 코드 리팩토링이 아니라 새로운 권한·외부 결정이 필요하므로 자동 진행하지 않는다.

- 개인정보 backup 위치, 암호화·접근·보존·파기 정책과 restore rehearsal
- D01~D22 업무 결정 및 목표 ERD 승인
- 운영 또는 승인된 복원본을 대상으로 한 충돌 진단
- `027+` expand, backfill, dual-write/read cutover와 legacy contract 삭제
- 최초 commit/tag와 원격 CI 실행 기록
- Browser Print/드라이버 재배포 권한과 PC별 workstation 배포
- Windows 배율·브라우저·드라이버 조합의 실물 Zebra GT800 검수
- golden screenshot과 pixel-diff 허용 기준

각 단계는 `docs/data-model-cutover-gates.md`의 Go/No-Go 증거가 없으면 다음 단계로 넘어가지 않는다.

## 구조 변경 완료 기준

- SQL이 repository 또는 명시적 인프라 probe/writer에만 존재한다.
- 업무 mutation이 use case와 동일 transaction의 audit를 가진다.
- 현재 API URL과 응답을 compatibility facade가 보존한다.
- 단위·HTTP·MariaDB·브라우저 검증이 각각 다른 실패 경계를 증명한다.
- 운영 데이터나 외부 장비를 검증하지 않은 항목을 완료로 표기하지 않는다.
- 파괴적 삭제는 관찰 기간과 복원 증거, 사용자 승인이 모두 있을 때만 수행한다.
