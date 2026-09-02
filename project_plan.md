# 가번호 관리 시스템 개발 계획서

> 문서 목적: 수험번호 인식 후 추첨·순차·직접 입력·사전 등록 방식으로 가번호를 부여하고 이력을 관리하는 웹 프로젝트의 설계·개발·배포·운영 계획을 정의한다. Zebra GT800 라벨 출력은 선택적 부가 기능으로 취급한다.

---

## 1. 문서 개요

### 1.1 프로젝트 목표

본 프로젝트의 목표는 다음 운영 구조를 안정적으로 구현하는 것이다.

- 수험번호를 인식하고 수험생 정보를 확인한다.
- 지정 범위에서 가번호를 무작위 추첨하거나 순차적으로 부여한다.
- 담당자가 지정 범위 안의 가번호를 직접 입력하여 부여할 수 있다.
- 수험생에게 미리 등록된 가번호를 불러와 사용할 수 있다.
- 같은 시험에서 가번호가 중복 부여되지 않도록 트랜잭션과 이력을 관리한다.
- 부여된 가번호의 라벨 출력은 필요한 현장에서만 선택적으로 사용한다.

- 웹 애플리케이션은 중앙 서버에서 구동한다.
- 사용자는 클라이언트 PC의 웹 브라우저를 이용해 중앙 서버에 접속한다.
- Zebra GT800 라벨 프린터는 각 클라이언트 PC와 USB로 직접 연결한다.
- PC 1대당 프린터 1대를 기본 운영 단위로 한다.
- 웹 화면에서 사용자가 출력 버튼을 누르면 해당 PC에 연결된 GT800에서 즉시 라벨이 출력된다.
- 서버는 업무 데이터, 사용자 인증, 라벨 템플릿, 출력 이력 및 감사 로그를 관리한다.
- 실제 USB 프린터 접근은 클라이언트 PC에서 수행한다.
- 브라우저 자체의 일반적인 웹 API만으로는 USB 프린터에 자유롭게 Raw ZPL을 전송하기 어렵기 때문에 Zebra Browser Print를 기본 출력 브리지로 사용한다.
- Zebra Browser Print와 GT800 실기기 호환성이 운영 환경에서 충분하지 않을 경우 자체 Local Print Agent 방식으로 교체할 수 있도록 출력 계층을 추상화한다.

### 1.2 핵심 운영 전제

본 계획서는 다음 환경을 기준으로 한다.

| 항목             | 기준                                                        |
| ---------------- | ----------------------------------------------------------- |
| 웹 서버          | 중앙 서버 1대 이상                                          |
| 접속 방식        | 사내 LAN 또는 VPN을 통한 HTTPS                              |
| 클라이언트       | Windows PC 우선                                             |
| 브라우저         | Chrome 또는 Edge 우선                                       |
| 프린터           | Zebra GT800                                                 |
| 연결 방식        | USB                                                         |
| 운영 단위        | PC 1대 : 프린터 1대                                         |
| 출력 언어        | ZPL II                                                      |
| 기본 출력 브리지 | Zebra Browser Print                                         |
| 대체 출력 브리지 | 자체 Local Print Agent                                      |
| 출력 데이터      | 서버에서 생성하거나 서버 템플릿 + 클라이언트 데이터 조합    |
| 인증             | 서버 기반 로그인/세션 또는 JWT                              |
| 출력 이력        | 서버 DB 저장                                                |
| 라벨 미리보기    | 선택 기능, 실제 출력 결과와 완전히 동일하다고 가정하지 않음 |

### 1.3 기존 시스템 현대화 및 양식 편집 원칙

- 기존 설치 프로그램에서 확인한 수험생 등록, 시험·전형·고사실 분류, 조 편성, 결시 처리, 가번호 부여, 출력·마감·통계 기능은 신규 웹 시스템의 업무 범위에 포함한다.
- 오래된 화면과 파일 기반 처리 방식은 그대로 복제하지 않고 권한, 감사 이력, 동시 작업, 데이터 검증, Excel 가져오기 검증을 포함한 서버 기반 구조로 재설계한다.
- Crystal Reports는 사용하지 않는다.
- 일반 문서와 명단 양식은 ExamList의 `examlist-template-editor`를 동일한 편집 경험으로 재사용하며, 현재 고정 적용 버전은 `1.1.0`이다.
- 관리자는 양식 코드, 분류, 제공 범위(수험생별·고사실별·시험 전체), 활성 여부를 정하고 데이터 태그를 배치한다.
- 저장할 때 양식 코드별 단일 데이터를 직접 수정하며, 활성 양식만 사용자 화면에 제공한다.
- 사용자 화면에서는 현재 수험생·고사실·시험 데이터를 태그에 적용한 뒤 브라우저 인쇄 화면으로 제공한다.
- 수험생 기본 정보뿐 아니라 모집 구분, 시험 구분, 전형, 캠퍼스, 단과대, 계열, 모집단위, 전공, 교시, 조, 고사장, 고사실, 좌석, 결시, 사진, 옵션 필드와 집계 데이터를 태그로 지원한다.
- Zebra ZPL 라벨 편집·출력은 일반 문서 양식과 분리된 선택적 부가 기능으로 유지한다.

현재 1차 구현 범위는 양식 저장 API, 관리자 양식 편집기, 54개 데이터 태그, 기본 양식 2종, 가번호 부여 완료 후 사용자 양식 선택·출력이다. 고사실별·시험 전체 명단을 실제 데이터로 생성하는 화면과 집계 API는 후속 업무 모듈에서 연결한다.

---

# 2. 가장 중요한 기술적 결론

## 2.1 브라우저가 USB GT800에 직접 접근하는 구조로 설계하지 않는다

일반적인 웹 브라우저는 보안 샌드박스 때문에 웹 페이지가 임의의 USB 장치에 직접 Raw 데이터를 전송하는 것을 제한한다.

WebUSB와 같은 기술이 존재하지만 다음 이유로 본 업무 시스템의 기본 방식으로 사용하지 않는다.

- 운영 브라우저 정책의 영향을 크게 받는다.
- 장치 호환성 검증이 필요하다.
- 기업 보안 정책에 따라 기능이 차단될 수 있다.
- 프린터용 드라이버/USB 인터페이스와의 충돌 가능성이 있다.
- 장기 유지보수성이 떨어질 수 있다.
- Zebra가 웹 기반 Zebra 프린터 출력용으로 Browser Print를 제공하고 있으므로 우선적으로 공식 경로를 사용한다.

따라서 기본 구조는 다음과 같다.

```text
┌──────────────────────────────────────────────────────┐
│                     중앙 서버                        │
│                                                      │
│  Web Frontend + Backend API + DB + ZPL Template      │
└──────────────────────────┬───────────────────────────┘
                           │
                           │ HTTPS
                           ▼
┌──────────────────────────────────────────────────────┐
│                   클라이언트 PC                       │
│                                                      │
│  Chrome / Edge                                       │
│       │                                              │
│       │ Browser Print JavaScript API                 │
│       ▼                                              │
│  Zebra Browser Print                                 │
│       │                                              │
│       │ USB                                          │
│       ▼                                              │
│  Zebra GT800                                         │
└──────────────────────────────────────────────────────┘
```

## 2.2 중앙 서버가 GT800 USB 포트에 직접 접근할 수는 없다

GT800은 클라이언트 PC에 USB로 연결되어 있으므로 중앙 서버에서 해당 USB 장치를 직접 열 수 없다.

따라서 출력 처리의 책임을 명확히 나눈다.

### 서버 책임

- 사용자 인증
- 권한 확인
- 업무 데이터 조회
- 라벨 출력 요청 생성
- 라벨 템플릿 관리
- ZPL 생성
- 출력 Job ID 생성
- 출력 이력 저장
- 중복 출력 방지
- 감사 로그
- 사용자별/PC별 프린터 설정
- 출력 정책 관리

### 클라이언트 책임

- Zebra Browser Print 실행 여부 확인
- USB GT800 탐색
- 기본 프린터 선택
- 서버에서 받은 ZPL을 프린터에 전송
- 전송 성공/실패 감지
- 서버에 출력 결과 보고
- 사용자가 보는 로컬 오류 메시지 제공

---

# 3. Zebra Browser Print 적용 전략

## 3.1 기본 선택 이유

Zebra Browser Print는 웹 기반 애플리케이션에서 로컬 PC에 연결된 Zebra 프린터에 출력하기 위한 Zebra 공식 도구다.

본 프로젝트에서는 다음 이유로 1차 출력 방식으로 선택한다.

- 클라이언트 PC의 USB 프린터 접근 가능
- 웹 페이지 JavaScript에서 호출 가능
- ZPL II Raw 데이터 전송 가능
- 서버에 프린터 드라이버를 설치할 필요가 없음
- PC와 프린터가 1:1 관계일 때 운영 구조가 단순함
- 클라이언트에 한 번 설치 후 웹 시스템에서 반복 사용 가능
- 중앙 서버 구조와 충돌하지 않음

## 3.2 반드시 먼저 수행할 POC

Browser Print 공식 문서에서는 G-Series가 지원 목록에 포함되어 있으나, GT800은 구형 제품이므로 실제 운영 PC/OS/드라이버/Browser Print 버전 조합에서 반드시 실기기 POC를 선행한다.

### POC 성공 조건

다음 항목을 모두 만족해야 한다.

- Windows 운영 PC에서 GT800 USB 인식
- Zebra 드라이버 정상 설치
- Zebra Setup Utilities 테스트 출력 성공
- Browser Print 설치 및 정상 실행
- Chrome에서 Browser Print API 접근 성공
- Edge에서 Browser Print API 접근 성공
- `getDefaultDevice()` 또는 장치 검색에서 GT800 확인
- 최소 ZPL 출력 성공
- 한글 출력 방식 검증
- 바코드 출력 검증
- QR 코드 출력 검증이 필요한 경우 QR 검증
- 연속 100장 테스트
- 브라우저 새로고침 후 재출력
- PC 재부팅 후 자동 사용 가능 여부
- USB 재연결 후 복구
- 프린터 전원 OFF/ON 후 복구
- Browser Print 프로세스 종료 상태에서 오류 처리
- 서버가 HTTPS인 상태에서 동작 확인
- 실제 사내 보안 프로그램이 설치된 PC에서 확인

POC에 실패하면 본 문서의 "Local Print Agent 대체안"으로 전환한다.

---

# 4. 전체 시스템 아키텍처

## 4.1 권장 논리 구조

```text
┌─────────────────────────────────────────────────────────────────┐
│                          CENTRAL SERVER                         │
│                                                                 │
│  ┌─────────────────┐      ┌──────────────────────────────────┐ │
│  │ Web Frontend    │      │ Backend API                      │ │
│  │ React/Vue/etc.  │◀────▶│ Spring Boot / Node.js / etc.    │ │
│  └─────────────────┘      └──────────────┬───────────────────┘ │
│                                         │                     │
│                     ┌───────────────────┼────────────────┐    │
│                     ▼                   ▼                ▼    │
│               Business DB       Label Template      Print Log │
│                                                                 │
└────────────────────────────────────┬────────────────────────────┘
                                     │ HTTPS
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                          CLIENT PC                              │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ Chrome / Edge                                           │   │
│   │                                                         │   │
│   │ Business UI                                             │   │
│   │    │                                                    │   │
│   │    ├─ PrinterService                                    │   │
│   │    ├─ BrowserPrintAdapter                               │   │
│   │    └─ PrintJobController                                │   │
│   └──────────────────────┬──────────────────────────────────┘   │
│                          │ Local communication                  │
│                          ▼                                      │
│                 ┌────────────────────┐                          │
│                 │ Zebra Browser Print│                          │
│                 └─────────┬──────────┘                          │
│                           │ USB                                 │
│                           ▼                                     │
│                    ┌──────────────┐                             │
│                    │ Zebra GT800  │                             │
│                    └──────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

---

# 5. 권장 기술 스택

특정 프레임워크가 이미 조직 표준으로 정해져 있다면 기존 표준을 우선한다.

## 5.1 프론트엔드

권장안:

- React + TypeScript
- Vite
- React Query 또는 TanStack Query
- Zustand 또는 Redux Toolkit은 복잡한 전역 상태가 필요한 경우만 사용
- Axios 또는 Fetch API
- Zod 등으로 API Response 검증
- ESLint
- Prettier
- Vitest
- Playwright

Vue 기반 조직이라면 다음도 충분히 가능하다.

- Vue 3
- TypeScript
- Vite
- Pinia
- Vue Query
- Vitest
- Playwright

### 필수 설계 원칙

프린터 관련 코드를 UI 컴포넌트에 직접 작성하지 않는다.

```text
UI
 ↓
PrintApplicationService
 ↓
PrinterAdapter interface
 ↓
BrowserPrintAdapter
```

향후 Browser Print를 Local Agent로 변경할 때 UI를 수정하지 않도록 한다.

## 5.2 백엔드

Java 조직이면 다음을 권장한다.

- Java 21 LTS
- Spring Boot
- Spring Security
- Spring Data JPA 또는 MyBatis
- PostgreSQL / MariaDB
- Flyway
- OpenAPI/Swagger
- Logback + JSON logging

Node.js 조직이면:

- Node.js LTS
- NestJS
- TypeScript
- Prisma
- PostgreSQL

본 계획의 핵심은 프레임워크가 아니라 출력 책임 분리이므로 어느 쪽도 가능하다.

## 5.3 데이터베이스

권장:

- PostgreSQL

대안:

- MariaDB
- 기존 사내 DBMS

DB는 다음 데이터를 최소한 저장한다.

- 사용자
- 권한
- 라벨 템플릿
- 템플릿 버전
- 프린터 논리 설정
- PC/워크스테이션
- 출력 Job
- 출력 Job 상세
- 출력 결과
- 재출력 사유
- 감사 로그

---

# 6. 프론트엔드 프로젝트 구조

React 기준 예시:

```text
frontend/
├─ src/
│  ├─ app/
│  │  ├─ router/
│  │  ├─ providers/
│  │  └─ config/
│  │
│  ├─ features/
│  │  ├─ auth/
│  │  ├─ labels/
│  │  ├─ print/
│  │  │  ├─ api/
│  │  │  ├─ components/
│  │  │  ├─ hooks/
│  │  │  ├─ model/
│  │  │  └─ services/
│  │  └─ printer/
│  │     ├─ adapters/
│  │     │  ├─ BrowserPrintAdapter.ts
│  │     │  └─ MockPrinterAdapter.ts
│  │     ├─ PrinterAdapter.ts
│  │     ├─ PrinterService.ts
│  │     ├─ printer.types.ts
│  │     └─ printer.errors.ts
│  │
│  ├─ shared/
│  │  ├─ api/
│  │  ├─ components/
│  │  ├─ utils/
│  │  └─ types/
│  │
│  └─ main.tsx
│
├─ public/
│  └─ vendor/
│     └─ BrowserPrint.js
│
├─ tests/
└─ package.json
```

---

# 7. 백엔드 프로젝트 구조

Spring Boot 예시:

```text
backend/
└─ src/main/java/com/company/label/
   ├─ auth/
   ├─ user/
   ├─ workstation/
   ├─ printer/
   ├─ label/
   │  ├─ application/
   │  ├─ domain/
   │  ├─ infrastructure/
   │  └─ presentation/
   ├─ printjob/
   │  ├─ application/
   │  ├─ domain/
   │  ├─ infrastructure/
   │  └─ presentation/
   ├─ audit/
   ├─ common/
   └─ config/
```

ZPL 생성 코드는 별도 컴포넌트로 분리한다.

```text
label/
├─ template/
│  ├─ LabelTemplateService
│  ├─ TemplateRenderer
│  ├─ ZplSanitizer
│  └─ TemplateValidator
```

---

# 8. Printer Adapter 추상화

## 8.1 목적

Browser Print에 프론트엔드 전체가 종속되지 않게 한다.

TypeScript 개념 예시:

```ts
export interface PrinterAdapter {
  initialize(): Promise<void>;

  getDefaultPrinter(): Promise<PrinterDevice | null>;

  listPrinters(): Promise<PrinterDevice[]>;

  send(printer: PrinterDevice, rawData: string): Promise<void>;

  isAvailable(): Promise<boolean>;
}
```

Browser Print 구현:

```ts
export class BrowserPrintAdapter implements PrinterAdapter {
  async initialize(): Promise<void> {
    // BrowserPrint availability check
  }

  async getDefaultPrinter(): Promise<PrinterDevice | null> {
    // BrowserPrint.getDefaultDevice(...)
    return null;
  }

  async listPrinters(): Promise<PrinterDevice[]> {
    // BrowserPrint.getLocalDevices(...)
    return [];
  }

  async send(printer: PrinterDevice, rawData: string): Promise<void> {
    // device.send(...)
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
```

테스트용 Mock:

```ts
export class MockPrinterAdapter implements PrinterAdapter {
  async initialize() {}

  async getDefaultPrinter() {
    return {
      id: "MOCK-001",
      name: "Mock GT800",
    };
  }

  async listPrinters() {
    return [];
  }

  async send(printer: PrinterDevice, rawData: string) {
    console.log("[MOCK PRINT]", rawData);
  }

  async isAvailable() {
    return true;
  }
}
```

---

# 9. 클라이언트 초기화 흐름

웹 페이지에 로그인하면 바로 출력하지 않고 프린터 환경을 먼저 진단한다.

```text
로그인
  │
  ▼
웹 애플리케이션 초기화
  │
  ▼
Browser Print API 존재 여부
  │
  ├─ 없음
  │    └─ "Browser Print 설치 필요"
  │
  ▼
Browser Print 서비스 연결 확인
  │
  ├─ 실패
  │    └─ "Browser Print 실행 필요"
  │
  ▼
USB 프린터 조회
  │
  ├─ 0대
  │    └─ "GT800 연결 확인"
  │
  ├─ 2대 이상
  │    └─ 기본 프린터 선택 화면
  │
  ▼
기본 프린터 확인
  │
  ▼
출력 준비 완료
```

PC 1대당 프린터 1대라는 전제가 있으므로 정상 운영 상태에서는 프린터 선택 UI를 반복적으로 보여주지 않는다.

---

# 10. 프린터 상태 UI

화면 상단 또는 출력 화면에 항상 프린터 상태를 표시하는 것이 좋다.

예:

```text
프린터 상태
─────────────────────────
● 연결됨
Zebra GT800
USB
출력 준비 완료
```

오류 상태:

```text
프린터 상태
─────────────────────────
● 연결 안 됨

GT800 또는 Browser Print를
확인해 주세요.

[다시 검색]
```

권장 상태 enum:

```ts
type PrinterStatus =
  | "INITIALIZING"
  | "READY"
  | "BROWSER_PRINT_NOT_INSTALLED"
  | "BROWSER_PRINT_NOT_RUNNING"
  | "PRINTER_NOT_FOUND"
  | "MULTIPLE_PRINTERS"
  | "PRINTER_OFFLINE"
  | "PRINTING"
  | "ERROR";
```

---

# 11. 전체 출력 처리 플로우

가장 중요한 흐름이다.

```text
사용자
  │
  │ [출력]
  ▼
Frontend
  │
  │ POST /api/print-jobs
  ▼
Backend
  │
  ├─ 권한 검사
  ├─ 업무 데이터 검사
  ├─ 중복 출력 검사
  ├─ 템플릿 조회
  ├─ ZPL 생성
  ├─ PrintJob 생성
  │
  ▼
Frontend
  │
  │ {jobId, zpl}
  ▼
PrinterService
  │
  ├─ Browser Print 상태 검사
  ├─ GT800 상태 검사
  │
  ▼
Browser Print
  │
  │ ZPL SEND
  ▼
GT800
  │
  ▼
라벨 출력
  │
  ▼
Frontend
  │
  │ POST /api/print-jobs/{id}/result
  ▼
Backend
  │
  └─ 출력 결과 기록
```

---

# 12. 출력 요청 API 설계

## 12.1 Print Job 생성

```http
POST /api/v1/print-jobs
Content-Type: application/json
Authorization: Bearer ...
```

예:

```json
{
  "labelType": "PRODUCT_LABEL",
  "businessId": "PRD-20260826-0001",
  "workstationId": "WS-001",
  "copies": 1
}
```

응답:

```json
{
  "jobId": "PJ-20260826-000001",
  "status": "READY",
  "templateVersion": 7,
  "copies": 1,
  "payload": {
    "format": "ZPL",
    "data": "^XA..."
  },
  "expiresAt": "2026-08-26T10:15:00+09:00"
}
```

## 12.2 출력 결과 보고

```http
POST /api/v1/print-jobs/PJ-20260826-000001/result
```

성공:

```json
{
  "result": "SENT",
  "workstationId": "WS-001",
  "printer": {
    "name": "ZDesigner GT800 (EPL)",
    "connection": "USB"
  },
  "clientTimestamp": "2026-08-26T10:10:14+09:00"
}
```

실패:

```json
{
  "result": "FAILED",
  "errorCode": "PRINTER_NOT_FOUND",
  "errorMessage": "USB printer was not found.",
  "workstationId": "WS-001",
  "clientTimestamp": "2026-08-26T10:10:14+09:00"
}
```

---

# 13. Print Job 상태 모델

단순 성공/실패 두 가지로 관리하지 않는다.

권장 상태:

```text
CREATED
READY
DISPATCHING
SENT
FAILED
CANCELLED
EXPIRED
```

### 의미

#### CREATED

서버에 출력 Job이 생성된 상태.

#### READY

ZPL이 생성되어 클라이언트가 출력할 수 있는 상태.

#### DISPATCHING

클라이언트가 출력 수행 중인 상태.

#### SENT

클라이언트가 Browser Print의 `send` 성공 Callback을 받은 상태.

주의:

`SENT`가 물리적으로 라벨이 정상 인쇄되어 사용자가 손에 받았다는 것을 100% 보장하지는 않는다.

#### FAILED

클라이언트에서 전송 오류를 확인한 상태.

#### CANCELLED

사용자가 출력 전에 취소.

#### EXPIRED

출력 Job의 허용 시간이 경과.

---

# 14. 물리적 출력 성공과 데이터 전송 성공의 차이

매우 중요한 운영 이슈다.

Browser Print의 send 성공은 대체로 데이터를 프린터에 전달했다는 의미로 처리해야 한다.

다음 상황은 별도로 고려해야 한다.

- 용지 없음
- 리본 없음
- 헤드 열림
- 프린터 일시 정지
- 인쇄 도중 전원 OFF
- 라벨 걸림
- USB 끊김

따라서 시스템 UI에서 다음과 같은 문구를 구분한다.

좋지 않은 표현:

```text
라벨 출력 완료
```

권장 표현:

```text
프린터로 출력 데이터를 전송했습니다.
실제 라벨 출력을 확인해 주세요.
```

프린터 상태 조회 기능을 충분히 검증한 경우에만 보다 정확한 성공 판정을 추가한다.

---

# 15. 중복 출력 방지

라벨 시스템에서는 네트워크 재시도 때문에 같은 라벨이 두 장 출력되는 문제가 매우 중요하다.

## 15.1 절대 자동 재출력하지 않는다

다음 상황을 가정한다.

```text
브라우저
  │
  ├─ printer.send()
  │
  └─ 실제 출력 성공
       │
       └─ 직후 브라우저 오류 발생
```

서버는 출력 결과를 받지 못할 수 있다.

이때 자동으로 print를 다시 호출하면 2장이 출력된다.

따라서 네트워크 API 재시도와 물리 프린트 재시도를 분리한다.

### 허용

- 결과 보고 API 재시도

### 금지

- `printer.send(zpl)` 자동 재시도

재출력은 사용자가 명시적으로 선택하도록 한다.

---

# 16. 재출력 정책

재출력 버튼을 제공한다.

```text
[재출력]
```

클릭 시:

```text
재출력 사유를 선택해 주세요.

○ 라벨 훼손
○ 인쇄 불량
○ 라벨 분실
○ 프린터 오류
○ 기타
```

서버에는 별도 Print Job을 생성한다.

```text
original_print_job_id
reprint_reason
reprinted_by
reprinted_at
```

감사 추적 가능성을 확보한다.

---

# 17. ZPL 생성 전략

두 가지 방식이 가능하다.

## 방식 A: 서버에서 완성된 ZPL 생성

권장 방식.

```text
Frontend
  │
  │ business data
  ▼
Backend
  │
  ├─ template
  ├─ data
  └─ render
       │
       ▼
     ZPL
       │
       ▼
Frontend
```

장점:

- 라벨 포맷 중앙 관리
- 클라이언트 버전과 무관
- 보안 관리 용이
- 템플릿 변경 즉시 반영
- 모든 PC 동일 출력
- 감사 로그 가능

따라서 본 프로젝트에서는 서버 렌더링 방식을 기본안으로 한다.

---

# 18. ZPL 템플릿 예시

```zpl
^XA

^PW800
^LL400

^FO40,30
^A0N,35,35
^FD{{PRODUCT_NAME}}^FS

^FO40,90
^A0N,25,25
^FDLOT: {{LOT_NO}}^FS

^FO40,130
^A0N,25,25
^FDQTY: {{QTY}}^FS

^FO40,180
^BCN,100,Y,N,N
^FD{{BARCODE}}^FS

^XZ
```

렌더링 데이터:

```json
{
  "PRODUCT_NAME": "TEST PRODUCT",
  "LOT_NO": "20260826",
  "QTY": "100",
  "BARCODE": "8801234567890"
}
```

---

# 19. 템플릿 엔진 설계

처음부터 복잡한 템플릿 언어를 만들 필요는 없다.

권장 변수 포맷:

```text
{{VARIABLE_NAME}}
```

지원 데이터 타입:

- 문자열
- 숫자
- 날짜
- 바코드
- QR 데이터
- 조건부 값

초기 버전에서는 템플릿 안에서 임의 코드 실행을 금지한다.

예:

금지:

```text
{{ eval("...") }}
```

허용:

```text
{{PRODUCT_NAME}}
```

이렇게 해야 템플릿 기반 코드 주입 위험을 낮출 수 있다.

---

# 20. 템플릿 버전 관리

라벨 템플릿은 수정 덮어쓰기를 하지 않는 것이 좋다.

예:

```text
PRODUCT_LABEL v1
PRODUCT_LABEL v2
PRODUCT_LABEL v3
```

DB:

```text
label_template
--------------
id
code
version
name
zpl
active
created_at
created_by
```

Print Job에는 반드시 사용된 템플릿 버전을 저장한다.

```text
print_job.template_id
print_job.template_version
```

그래야 과거에 어떤 디자인으로 출력했는지 추적할 수 있다.

---

# 21. ZPL 안전성 검증

ZPL 자체가 프린터 설정을 변경할 수 있으므로 서버에서 사용자가 임의 ZPL을 입력하도록 허용해서는 안 된다.

특히 일반 업무 사용자는 다음 기능에 접근할 수 없어야 한다.

- 프린터 초기화
- 저장 파일 삭제
- 네트워크 설정 변경
- 영구 설정 변경
- 펌웨어 관련 명령

운영자가 등록한 템플릿만 사용하도록 한다.

---

# 22. 한글 출력 전략

GT800/ZPL에서 한글은 가장 먼저 실기기 검증해야 하는 항목 중 하나다.

가능한 전략은 다음과 같다.

## 전략 A: 프린터에 한글 폰트 설치

장점:

- 문자 기반 ZPL 가능
- 출력 데이터 크기 감소

단점:

- 프린터별 폰트 배포 필요
- 라이선스 확인 필요
- 프린터 메모리 관리 필요

## 전략 B: 서버에서 텍스트를 이미지화

장점:

- 폰트 호환성 제어 가능
- 화면과 출력 결과 일치도 향상

단점:

- 데이터 크기 증가
- 출력 속도 저하 가능
- 이미지 변환 로직 필요

## 권장

초기 POC 단계에서 한글 요구 여부를 확정한다.

한글이 필수라면:

1. 현재 GT800의 폰트 지원 상태 확인
2. 기존 Zebra Driver 환경에서 한글 출력 확인
3. ZPL Raw 출력에서 한글 확인
4. 지원이 불안정하면 이미지 렌더링을 채택

---

# 23. 바코드 검증

라벨이 인쇄되었다고 해서 프로젝트가 성공한 것이 아니다.

바코드는 반드시 실제 스캐너로 검증한다.

검증 항목:

- Code 128
- Code 39
- EAN-13
- QR Code
- DataMatrix

실제 사용하는 심볼로 테스트한다.

검증 기준:

- 100회 연속 스캔 성공률
- 인쇄 농도 변경
- 속도 변경
- 리본 종류
- 라벨 재질
- 프린트 헤드 상태
- 최소 바코드 크기

---

# 24. 브라우저 측 출력 서비스 예시

```ts
export class PrintService {
  constructor(
    private readonly adapter: PrinterAdapter,
    private readonly api: PrintApi,
  ) {}

  async print(request: CreatePrintRequest): Promise<void> {
    const available = await this.adapter.isAvailable();

    if (!available) {
      throw new PrinterError("BROWSER_PRINT_UNAVAILABLE");
    }

    const printer = await this.adapter.getDefaultPrinter();

    if (!printer) {
      throw new PrinterError("PRINTER_NOT_FOUND");
    }

    const job = await this.api.createJob(request);

    try {
      await this.adapter.send(printer, job.payload.data);

      await this.api.reportResult(job.jobId, {
        result: "SENT",
        printer: printer,
      });
    } catch (error) {
      await this.api.reportResult(job.jobId, {
        result: "FAILED",
        errorCode: normalizePrinterError(error),
      });

      throw error;
    }
  }
}
```

---

# 25. Zebra Browser Print 호출 개념 예시

실제 프로젝트에서는 Zebra가 제공하는 JS 라이브러리 버전에 맞춰 구현한다.

개념:

```js
BrowserPrint.getDefaultDevice(
  "printer",
  function (device) {
    device.send(
      "^XA^FO50,50^A0N,40,40^FDTEST^FS^XZ",
      function () {
        console.log("Data sent");
      },
      function (error) {
        console.error(error);
      },
    );
  },
  function (error) {
    console.error(error);
  },
);
```

Promise wrapper를 만들어 나머지 코드에서 Callback API를 직접 사용하지 않는 것을 권장한다.

```ts
function sendZpl(device: BrowserPrintDevice, zpl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    device.send(
      zpl,
      () => resolve(),
      (error: unknown) => reject(error),
    );
  });
}
```

---

# 26. Workstation 개념

PC 1대 = 프린터 1대이므로 시스템 내부에 Workstation 개념을 두는 것을 권장한다.

예:

```text
WS-PACKING-01
WS-PACKING-02
WS-WAREHOUSE-01
```

DB:

```text
workstation
-----------
id
code
name
enabled
location
description
```

사용자는 첫 로그인 시 PC를 등록한다.

---

# 27. Workstation ID 저장

방법 후보:

- LocalStorage
- IndexedDB
- Local Agent 설정
- Windows Registry(Local Agent 사용 시)

Browser Print 방식에서는 우선 LocalStorage를 사용한다.

예:

```text
label-workstation-id = WS-PACKING-01
```

단, LocalStorage 삭제 가능성을 고려해야 한다.

등록되지 않은 PC에서는 출력 기능을 차단하는 정책도 가능하다.

---

# 28. 클라이언트 PC 등록 화면

예:

```text
이 PC를 출력 단말로 등록합니다.

PC 이름
[ 포장실 1번 PC ]

워크스테이션
[ WS-PACKING-01 ▼ ]

프린터
[ Zebra GT800 ]

[테스트 출력]

[등록]
```

등록 시 서버에:

- 사용자
- Workstation
- 프린터 표시 이름
- Browser 정보
- OS 정보
- 최초 등록 시간

등을 기록할 수 있다.

---

# 29. 테스트 출력 기능

운영자가 확인할 수 있도록 별도 테스트 페이지를 제공한다.

```text
시스템 설정 > 프린터 진단
```

표시:

```text
Browser Print
  설치 상태: 정상
  연결 상태: 정상

Printer
  이름: Zebra GT800
  연결: USB

[프린터 다시 검색]

[테스트 라벨 출력]
```

테스트 ZPL:

```zpl
^XA
^PW600
^LL300

^FO40,30
^A0N,35,35
^FDPRINTER TEST^FS

^FO40,90
^A0N,25,25
^FDZEBRA GT800^FS

^FO40,140
^BCN,80,Y,N,N
^FD1234567890^FS

^XZ
```

---

# 30. 오류 코드 체계

프론트/백엔드 공통 오류 코드 체계를 정의한다.

```text
BP_NOT_INSTALLED
BP_NOT_RUNNING
BP_CONNECTION_FAILED

PRINTER_NOT_FOUND
PRINTER_MULTIPLE_FOUND
PRINTER_OFFLINE
PRINTER_SEND_FAILED
PRINTER_TIMEOUT

PRINT_JOB_NOT_FOUND
PRINT_JOB_EXPIRED
PRINT_JOB_ALREADY_SENT
PRINT_PERMISSION_DENIED

TEMPLATE_NOT_FOUND
TEMPLATE_RENDER_FAILED
INVALID_PRINT_DATA
```

UI에는 기술 오류를 그대로 표시하지 않는다.

예:

```text
PRINTER_NOT_FOUND
```

대신:

```text
프린터를 찾을 수 없습니다.

1. GT800 전원이 켜져 있는지 확인하세요.
2. USB 케이블을 확인하세요.
3. Windows에서 프린터가 정상 인식되는지 확인하세요.

[다시 검색]
```

---

# 31. Browser Print 미설치 처리

```text
라벨 출력 프로그램이 설치되어 있지 않습니다.

라벨 출력을 사용하려면
Zebra Browser Print 설치가 필요합니다.

[설치 안내]
```

기업 환경에서는 사용자가 Zebra 다운로드 사이트를 직접 방문하게 하는 대신 사내 배포 패키지를 제공하는 편이 좋다.

예:

```text
https://intranet/software/zebra-browser-print
```

---

# 32. Browser Print Host 허용 정책

Browser Print는 웹 애플리케이션 호스트에 대한 접근 허용 절차가 발생할 수 있으므로 배포 전에 다음을 확인한다.

- 운영 도메인 고정
- 개발 도메인
- 테스트 도메인
- 운영 HTTPS 인증서
- Browser Print의 허용 Host 처리
- 사용자에게 불필요한 보안 경고가 반복되지 않는지 확인

권장 운영 URL:

```text
https://label.company.local
```

IP 기반 URL보다 고정 도메인을 권장한다.

---

# 33. HTTPS 적용

운영 서버는 반드시 HTTPS를 적용하는 것을 권장한다.

이유:

- 로그인 정보 보호
- 업무 정보 보호
- 쿠키 보호
- 브라우저 보안 정책 대응
- 향후 기능 확장
- 사내 인증 연계

개발:

```text
https://label-dev.company.local
```

운영:

```text
https://label.company.local
```

---

# 34. 인증 및 권한

역할 예:

```text
ADMIN
OPERATOR
VIEWER
```

### ADMIN

- 라벨 템플릿 관리
- 사용자 관리
- Workstation 관리
- Print Job 조회
- 재출력
- 설정 변경

### OPERATOR

- 업무 라벨 출력
- 허용된 재출력
- 본인 출력 이력 조회

### VIEWER

- 조회만 가능

---

# 35. CSRF / XSS / 보안

라벨 출력 시스템이라도 일반 웹 보안을 동일하게 적용한다.

필수:

- HTTPS
- XSS 방지
- CSP
- CSRF 보호
- SQL Injection 방지
- 서버 입력 검증
- 권한 검증
- 세션 Timeout
- 감사 로그
- Rate Limit
- 보안 Header

특히 ZPL 데이터에 업무 사용자 입력이 삽입될 때 ZPL 특수문자 처리 정책을 정의한다.

---

# 36. 출력 API 보안

브라우저에서 ZPL을 서버로 직접 전달하여 출력 승인을 요청하는 방식은 권장하지 않는다.

나쁜 방식:

```json
{
  "zpl": "^XA ... ^XZ"
}
```

일반 사용자 API에서는 서버가 업무 ID를 받아 ZPL을 생성해야 한다.

권장:

```json
{
  "labelType": "PRODUCT",
  "businessId": "P12345"
}
```

서버:

```text
업무 데이터 조회
  ↓
권한 확인
  ↓
템플릿 조회
  ↓
ZPL 생성
```

---

# 37. DB 설계 예시

## 37.1 label_template

```sql
CREATE TABLE label_template (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(100) NOT NULL,
    version         INTEGER NOT NULL,
    name            VARCHAR(200) NOT NULL,
    zpl_template    TEXT NOT NULL,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      BIGINT NOT NULL,
    created_at      TIMESTAMP NOT NULL,
    UNIQUE(code, version)
);
```

## 37.2 workstation

```sql
CREATE TABLE workstation (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(100) UNIQUE NOT NULL,
    name            VARCHAR(200) NOT NULL,
    location        VARCHAR(200),
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP NOT NULL
);
```

## 37.3 print_job

```sql
CREATE TABLE print_job (
    id                  UUID PRIMARY KEY,
    job_no              VARCHAR(100) UNIQUE NOT NULL,
    label_type          VARCHAR(100) NOT NULL,

    business_ref        VARCHAR(200),

    template_id         BIGINT NOT NULL,
    template_version    INTEGER NOT NULL,

    workstation_id      BIGINT,
    requested_by        BIGINT NOT NULL,

    copies              INTEGER NOT NULL DEFAULT 1,

    status              VARCHAR(30) NOT NULL,

    created_at          TIMESTAMP NOT NULL,
    dispatched_at       TIMESTAMP,
    sent_at             TIMESTAMP,
    failed_at           TIMESTAMP,

    error_code          VARCHAR(100),
    error_message       TEXT,

    original_job_id     UUID,
    reprint_reason      VARCHAR(500)
);
```

---

# 38. 출력 데이터 보관 정책

완성 ZPL을 DB에 저장할지는 업무 민감도에 따라 결정한다.

## 저장하는 경우

장점:

- 정확한 출력 재현 가능
- 감사 가능

단점:

- 개인정보가 포함될 수 있음
- DB 크기 증가

권장:

```text
print_job
print_job_payload
```

분리 테이블 사용.

보존 기간 정책을 별도로 정의한다.

---

# 39. 로그 설계

서버 로그:

```text
timestamp
requestId
userId
workstationId
printJobId
labelType
status
duration
errorCode
```

예:

```json
{
  "event": "PRINT_JOB_CREATED",
  "printJobId": "PJ-001",
  "userId": "U100",
  "workstationId": "WS-PACKING-01"
}
```

클라이언트 Debug 로그에는 ZPL 전체를 무조건 남기지 않는다.

개인정보가 포함될 가능성이 있기 때문이다.

---

# 40. 감사 로그

다음 이벤트는 감사 대상이다.

- 로그인
- 라벨 출력
- 재출력
- 템플릿 생성
- 템플릿 수정
- 템플릿 활성화/비활성화
- Workstation 등록
- 권한 변경

---

# 41. 프린터 출력 UI 설계

## 41.1 출력 전

```text
상품 라벨

품목코드     A10001
상품명       SAMPLE PRODUCT
LOT          20260826
수량         100

프린터
● Zebra GT800 / 연결됨

출력 수량
[ 1 ]

[라벨 출력]
```

## 41.2 출력 중

```text
출력 데이터를 전송하고 있습니다...

[취소 불가]
```

프린터로 이미 데이터 전송이 시작된 이후 취소가 물리적으로 의미가 없을 수 있으므로 임의 취소 버튼은 제공하지 않는 편이 좋다.

## 41.3 전송 성공

```text
출력 데이터를 프린터로 전송했습니다.

실제 라벨을 확인해 주세요.

[확인]
```

## 41.4 실패

```text
출력하지 못했습니다.

프린터 연결 상태를 확인해 주세요.

오류: PRINTER_SEND_FAILED

[프린터 확인]
[다시 출력]
```

"다시 출력"은 자동 Retry가 아니라 사용자 명시 동작이다.

---

# 42. Double Click 방지

출력 버튼을 빠르게 두 번 클릭하면 두 장 출력될 수 있다.

따라서:

```text
button disabled immediately
```

처리한다.

그리고 서버에 idempotency key를 사용할 수 있다.

예:

```http
Idempotency-Key:
91ea......
```

다만 이것은 "Print Job 생성" 중복을 방지하는 것이며 물리 출력 자체를 재시도 가능하게 만들어 주는 것은 아니다.

---

# 43. Copies 처리

라벨 10장을 출력할 때 선택지가 있다.

### 방식 A

동일 ZPL을 10번 send

비권장.

### 방식 B

ZPL의 프린트 수량 명령 사용

가능하다면 권장.

이렇게 하면 Browser → Printer 전송 횟수를 줄일 수 있다.

단, 템플릿과 라벨별 요구사항에 따라 검증해야 한다.

---

# 44. 성능 목표

PC 1대 + 프린터 1대이므로 대규모 동시 USB 출력은 고려하지 않는다.

권장 목표:

| 항목                  | 목표            |
| --------------------- | --------------- |
| 화면 로딩             | 2초 이내        |
| Print Job 생성        | 500ms 이내      |
| ZPL 생성              | 100ms 이내      |
| 출력 버튼 → 전송 시작 | 1초 이내        |
| 브라우저 오류 표시    | 3초 이내        |
| 서버 API 가용성       | 사내 SLA에 맞춤 |

---

# 45. 프린트 Queue

클라이언트 PC에서 동시에 여러 출력 요청이 발생하는 것을 막는다.

```text
PrintQueue
```

개념:

```text
JOB 001
  ↓
sending
  ↓
complete

JOB 002
  ↓
sending
```

한 PC에서는 한 번에 한 출력 Job만 처리하는 것을 기본으로 한다.

---

# 46. 새로고침 처리

사용자가 출력 직후 F5를 누를 수 있다.

브라우저 상태만 가지고 출력 성공 여부를 관리하면 안 된다.

Print Job은 서버에 존재해야 한다.

화면 재접속 시:

```http
GET /api/v1/print-jobs/recent
```

를 통해 최근 상태를 확인한다.

단, 미확정 Job을 자동 출력하지 않는다.

---

# 47. 브라우저 종료 처리

Browser Print 송신 직후 브라우저가 종료될 경우 서버 상태가 `READY` 또는 `DISPATCHING`에 남을 수 있다.

이 경우 서버 Batch가 일정 시간이 지나면:

```text
DISPATCHING → UNKNOWN
```

과 같은 상태를 사용할 수도 있다.

운영 단순화를 원한다면:

```text
DISPATCHING → EXPIRED
```

로 처리하고 운영자가 확인하도록 한다.

---

# 48. 프린터 교체

GT800 고장으로 다른 GT800을 연결할 수 있다.

프린터 Serial Number를 강하게 Workstation에 고정하면 교체 과정이 복잡해질 수 있다.

초기 운영에서는:

```text
Workstation 1
  ↓
현재 연결된 유효 Zebra USB Printer
```

정도로 처리할 수 있다.

보안이 중요한 환경에서는 장치 등록 정책을 강화한다.

---

# 49. PC 교체

PC 교체 절차를 문서화한다.

1. 새 PC 준비
2. Windows 업데이트
3. Zebra Driver 설치
4. GT800 USB 연결
5. Zebra Setup Utilities 테스트
6. Browser Print 설치
7. 사내 웹사이트 접속
8. Host 허용
9. Workstation 등록
10. 시스템 테스트 출력
11. 실제 업무 라벨 테스트
12. 기존 PC 등록 해제

---

# 50. 클라이언트 설치 패키지

운영 편의성을 위해 다음 파일을 한 패키지로 관리한다.

```text
GT800_Client_Setup/
├─ ZebraDriver/
├─ BrowserPrint/
├─ README.pdf
└─ verify-checklist.txt
```

가능하면 사내 소프트웨어 배포 도구를 사용한다.

예:

- Intune
- SCCM
- AD Software Deployment
- 사내 Endpoint Manager

---

# 51. Local Print Agent 대체 설계

Browser Print가 GT800 + 최신 Windows 환경에서 불안정하거나 회사 보안 정책과 충돌하는 경우 다음 구조로 전환한다.

```text
Browser
  │
  │ HTTPS
  ▼
Central Server

Browser
  │
  │ localhost HTTPS / WebSocket
  ▼
Local Print Agent
  │
  │ Zebra SDK / Windows Spooler / USB
  ▼
GT800
```

Agent 기술 후보:

- .NET 8 Windows Service
- .NET Desktop Background Agent
- Java Background Agent
- Node.js packaged service

Windows 환경에서는 .NET을 가장 권장한다.

---

# 52. Local Agent API 예시

```text
GET https://127.0.0.1:18443/health

GET https://127.0.0.1:18443/printers

POST https://127.0.0.1:18443/print
```

요청:

```json
{
  "jobId": "PJ-001",
  "dataType": "ZPL",
  "data": "^XA..."
}
```

Agent는 허용된 웹 Origin만 요청 가능하도록 한다.

---

# 53. Browser Print vs Local Agent

| 항목               | Browser Print | Local Agent |
| ------------------ | ------------- | ----------- |
| 개발 난이도        | 낮음          | 높음        |
| 초기 구축          | 빠름          | 느림        |
| Zebra 공식 웹 출력 | 예            | 자체 구현   |
| GT800 POC 필요     | 필수          | 필수        |
| 커스텀 기능        | 제한          | 매우 높음   |
| 로깅 제어          | 제한          | 높음        |
| 자동 업데이트      | 별도 고려     | 직접 구현   |
| 보안 제어          | 제품 범위     | 직접 설계   |
| 장애 진단          | 중간          | 높음        |
| 유지보수 비용      | 낮음          | 높음        |

권장 의사결정:

```text
Browser Print POC 성공
        │
        ├─ YES → Browser Print 채택
        │
        └─ NO  → Local Agent 개발
```

---

# 54. 개발 환경 구성

## Frontend

```text
Node.js LTS
npm / pnpm
Chrome
Edge
```

## Backend

Java 선택 시:

```text
Java 21
Spring Boot
Gradle
PostgreSQL
```

## 프린터 개발 장비

반드시 실제 장비를 개발팀에서 사용할 수 있어야 한다.

```text
Windows PC
+
실제 Zebra GT800
+
실제 라벨
+
실제 리본
+
USB Cable
+
바코드 Scanner
```

프린터 개발을 Mock만으로 완료해서는 안 된다.

---

# 55. 개발 환경 프로파일

```text
local
dev
staging
production
```

local에서는 MockPrinter 사용 가능.

```text
VITE_PRINTER_MODE=mock
```

프린터 연결 PC:

```text
VITE_PRINTER_MODE=browser-print
```

---

# 56. Mock Printer 모드

개발자가 모두 GT800을 가지고 있을 필요는 없다.

Mock Printer 모드에서:

- 출력 요청 가능
- ZPL 확인
- Job 상태 확인
- 오류 Simulation 가능

예:

```text
MockPrinter
 ├─ SUCCESS
 ├─ NOT_FOUND
 ├─ TIMEOUT
 └─ SEND_FAILED
```

프론트엔드 테스트를 빠르게 할 수 있다.

---

# 57. 테스트 전략

테스트를 다음 레벨로 구분한다.

## Level 1 - Unit Test

- TemplateRenderer
- ZPL escape
- Print Job 상태 전이
- 권한
- PrinterService
- Error mapping

## Level 2 - Backend Integration Test

- DB
- Print Job 생성
- Template version
- Audit Log

## Level 3 - Frontend Integration Test

Mock BrowserPrint 사용.

## Level 4 - Browser Test

실제 Chrome / Edge.

## Level 5 - Hardware Integration Test

실제 GT800.

---

# 58. Hardware Integration Test Matrix

| Test               | Chrome | Edge |
| ------------------ | -----: | ---: |
| Browser Print 탐색 |   필수 | 필수 |
| GT800 검색         |   필수 | 필수 |
| 1장 출력           |   필수 | 필수 |
| 10장 출력          |   필수 | 필수 |
| 100장 연속         |   필수 | 필수 |
| USB 분리           |   필수 | 필수 |
| 프린터 OFF         |   필수 | 필수 |
| 재연결             |   필수 | 필수 |
| PC 재부팅          |   필수 | 필수 |
| Browser Print 종료 |   필수 | 필수 |

---

# 59. 라벨 품질 테스트

다음 프린터 설정을 조합해 테스트한다.

- darkness
- speed
- media type
- ribbon type
- label width
- label height
- print orientation

체크:

```text
□ 글자가 잘리지 않는가
□ 바코드가 스캔되는가
□ QR이 스캔되는가
□ 인쇄 위치가 밀리지 않는가
□ 100장 후 위치가 누적 이동하지 않는가
□ 리본 주름이 없는가
□ 라벨 gap 인식이 정상인가
```

---

# 60. 장애 시나리오 테스트

반드시 아래 상황을 의도적으로 만들어 테스트한다.

1. 프린터 전원 OFF
2. USB 케이블 제거
3. Browser Print 종료
4. Browser Print 미설치
5. 프린터 2대 연결
6. 라벨 없음
7. 리본 없음
8. 프린터 Head Open
9. 서버 API Timeout
10. 로그인 Session Timeout
11. 출력 중 인터넷/LAN 끊김
12. 출력 후 결과 API 실패
13. 사용자 Double Click
14. F5
15. 브라우저 종료
16. PC Sleep 후 복귀

---

# 61. 서버 장애

서버가 장애 상태이면 새로운 업무 데이터를 얻을 수 없으므로 기본적으로 출력도 차단한다.

오프라인 출력 기능은 초기 범위에서 제외하는 것이 좋다.

이유:

- 중복 출력 위험
- 오래된 데이터 출력
- 감사 로그 누락
- 재동기화 복잡도

---

# 62. 네트워크 끊김

서버에서 ZPL을 받은 뒤 네트워크가 끊기는 경우를 별도로 고려한다.

프린터 출력 자체는 로컬에서 가능할 수 있다.

그러나 출력 결과를 서버에 보고하지 못한다.

정책 후보:

A. 네트워크가 정상일 때만 출력

B. ZPL을 받은 뒤에는 출력 허용하고 결과를 IndexedDB에 저장 후 재보고

초기 프로젝트에서는 A가 단순하고 안전하다.

업무 요구로 B가 필요하면 별도 설계한다.

---

# 63. 프린터 설정 변경 금지

운영 사용자가 Windows 프린터 설정을 임의 변경하는 것을 최소화한다.

표준 설정 문서를 작성한다.

예:

```text
Media Type
Print Method
Darkness
Speed
Width
Height
```

프린터 설정은 라벨 품질에 직접 영향을 준다.

---

# 64. 배포 구조

```text
Internet/Intranet User
       │
       ▼
Reverse Proxy
       │
       ├─ /            → Frontend
       └─ /api         → Backend
                          │
                          ▼
                      PostgreSQL
```

Reverse Proxy:

- Nginx
- Apache
- 조직 표준 Load Balancer

---

# 65. 서버 운영

권장:

- Docker 컨테이너
- 또는 조직 표준 VM 배포

예:

```text
docker-compose
├─ nginx
├─ backend
└─ postgres
```

단, DB 운영 정책은 회사 인프라 기준을 우선한다.

---

# 66. CI/CD

예:

```text
git push
   │
   ▼
CI
 ├─ lint
 ├─ unit test
 ├─ build
 ├─ dependency scan
 └─ image build
   │
   ▼
DEV
   │
   ▼
STAGING
   │
   ▼
PRODUCTION
```

운영 배포 전에 실제 GT800 연결 Staging PC 테스트를 수행한다.

---

# 67. 환경 변수

Backend:

```text
DB_URL
DB_USERNAME
DB_PASSWORD

JWT_SECRET

PRINT_JOB_EXPIRY_SECONDS
PRINT_MAX_COPIES
```

Frontend:

```text
VITE_API_BASE_URL
VITE_PRINTER_MODE
```

Browser Print 라이브러리 버전을 프로젝트에서 관리한다.

---

# 68. 버전 관리

애플리케이션 버전:

```text
v1.0.0
```

화면 하단에 표시하면 장애 대응이 쉬워진다.

```text
System v1.2.4
Browser Print detected
```

---

# 69. 모니터링

서버:

- CPU
- Memory
- Disk
- DB connection
- API error rate
- Login failure
- Print Job failure rate

업무 Metric:

```text
prints_total
prints_failed_total
reprints_total
printer_not_found_total
browser_print_unavailable_total
```

---

# 70. 운영 Dashboard

관리자 화면:

```text
오늘 출력
  1,245건

성공 전송
  1,230건

실패
  15건

재출력
  8건

주요 오류
  PRINTER_NOT_FOUND   9
  BP_NOT_RUNNING      4
  SEND_FAILED         2
```

이 정보는 현장 장애 원인을 빠르게 찾는 데 도움이 된다.

---

# 71. 개인정보 및 민감정보

라벨에 다음 정보가 포함될 수 있다.

- 고객명
- 주소
- 전화번호
- 주문번호

따라서:

- 로그에 ZPL 전체 기록 금지
- Browser console 출력 금지
- API payload logging 주의
- Print Job 보존기간 설정
- 관리자 접근 제한

---

# 72. 프로젝트 단계별 개발 계획

## Phase 0 - 사전 조사

목표:

기술 타당성 확정.

작업:

- GT800 정확한 모델 확인
- Firmware 확인
- USB 연결 확인
- Windows Version 확인
- Zebra Driver 확인
- Browser Print 최신 제공 버전 확인
- Chrome/Edge 지원 확인
- ZPL 지원 확인
- 라벨 규격 수집
- 한글 여부 확인
- 바코드 종류 확인
- 출력량 확인

산출물:

```text
environment-check.md
hardware-inventory.md
```

---

# 73. Phase 1 - GT800 Browser Print POC

가장 중요한 단계.

구현:

```text
poc/
├─ index.html
├─ BrowserPrint.js
└─ test.js
```

기능:

```text
[Browser Print 검사]

[프린터 검색]

[TEST 출력]
```

성공 기준:

- GT800 발견
- ZPL 출력
- Chrome 성공
- Edge 성공
- 연속 출력 안정성
- 재부팅 후 성공

이 단계가 통과되기 전까지 본 프로젝트의 대규모 개발을 시작하지 않는 것을 권장한다.

---

# 74. Phase 2 - 프로젝트 Skeleton

Frontend:

- React
- TypeScript
- Router
- API client
- Error handler
- Auth shell

Backend:

- Spring Boot
- DB
- Security
- Migration
- OpenAPI
- Common error

Infra:

- dev server
- HTTPS
- CI

---

# 75. Phase 3 - Printer Module

구현:

```text
PrinterAdapter
BrowserPrintAdapter
MockPrinterAdapter
PrinterService
PrinterStatus
PrinterDiagnostics
```

화면:

```text
Printer Status
Printer Diagnostic
Test Print
```

---

# 76. Phase 4 - Label Template

구현:

- Template DB
- TemplateRenderer
- Template version
- Template validation
- ZPL test
- Sample templates

---

# 77. Phase 5 - Print Job

구현:

- Job 생성
- Job status
- Job expiration
- Job result
- Audit
- Reprint

---

# 78. Phase 6 - 업무 화면 통합

기존 업무 프로세스에:

```text
[라벨 출력]
```

추가.

Output data는 Business ID 기반으로 서버가 생성.

---

# 79. Phase 7 - 장애 및 보안

구현:

- Browser Print 없음
- Printer 없음
- USB Disconnect
- Double click
- Session expiration
- Print permission
- Audit logging
- CSP
- Rate limit

---

# 80. Phase 8 - Hardware QA

실제 장비에서:

- Chrome
- Edge
- 100장
- 500장
- 바코드 Scanner
- 한글
- 재부팅
- 장시간 운영

---

# 81. Phase 9 - Pilot

실제 현장 PC 1~2대에서 시범 운영.

관찰:

- 사용자 실수
- USB 이슈
- Browser Print 종료
- 프린터 상태
- 라벨 품질
- 네트워크
- 재출력 빈도

---

# 82. Phase 10 - Production

배포 순서:

1. Server Production 배포
2. Browser Print 설치 패키지 배포
3. Zebra Driver 설치
4. GT800 연결
5. Workstation 등록
6. Test print
7. 실제 Label test
8. User 교육
9. 운영 시작

---

# 83. 예상 일정 예시

프로젝트 규모에 따라 조정한다.

| 단계   | 작업                          |
| ------ | ----------------------------- |
| 1주차  | 환경 조사 + Browser Print POC |
| 2주차  | Front/Backend Skeleton        |
| 3주차  | Printer Adapter + 진단        |
| 4주차  | Label Template + Print Job    |
| 5주차  | 업무 화면 통합                |
| 6주차  | 오류/보안/로그                |
| 7주차  | Hardware QA                   |
| 8주차  | Pilot                         |
| 9주차  | 보완                          |
| 10주차 | Production                    |

업무 화면과 DB가 이미 존재하면 기간을 줄일 수 있다.

---

# 84. 주요 리스크

## Risk 1. GT800 + Browser Print 호환성

대응:

```text
Phase 1 POC
```

실패 시 Local Agent.

## Risk 2. 한글 출력

대응:

- POC 최우선 검증
- Font 설치
- Image rendering 대안

## Risk 3. Browser Print가 종료됨

대응:

- 화면 상태 표시
- 자동 진단
- 사용자 메시지
- Startup 등록 검토

## Risk 4. 중복 출력

대응:

- 버튼 잠금
- Job ID
- 자동 Print retry 금지
- 재출력 audit

## Risk 5. USB Disconnect

대응:

- 출력 직전 Printer 확인
- 재검색
- 명확한 오류 UI

## Risk 6. 클라이언트 업데이트

대응:

- Browser Print 지원 버전 표준화
- Windows 업데이트 후 회귀 테스트

---

# 85. 운영 표준 PC 사양 정의

예:

```text
OS
  Windows 11 Pro

Browser
  Chrome Stable
  또는
  Microsoft Edge Stable

Zebra Driver
  회사 승인 버전

Browser Print
  회사 승인 버전

Printer
  Zebra GT800

Connection
  Direct USB
```

운영 중 자유로운 버전 변경을 최소화한다.

---

# 86. 현장 설치 체크리스트

- [ ] PC 이름 확인
- [ ] Windows 업데이트 확인
- [ ] GT800 전원 확인
- [ ] USB 직접 연결
- [ ] Windows에서 GT800 인식
- [ ] Zebra Driver 설치
- [ ] Windows Test Print
- [ ] Zebra Setup Utilities Test
- [ ] Browser Print 설치
- [ ] Browser Print 실행
- [ ] Chrome 접속 테스트
- [ ] Edge 접속 테스트
- [ ] 웹사이트 Host 허용
- [ ] GT800 검색 성공
- [ ] Workstation 등록
- [ ] 시스템 Test Label 출력
- [ ] Barcode Scanner 검증
- [ ] 실제 업무 Label 출력
- [ ] 재부팅
- [ ] 재부팅 후 재출력
- [ ] 사용자 교육

---

# 87. 사용자 교육

사용자가 알아야 할 것은 최대한 단순하게 한다.

### 정상 출력

1. 웹 시스템 로그인
2. 프린터 상태 "연결됨" 확인
3. 업무 데이터 확인
4. 라벨 출력 클릭
5. 실제 라벨 확인

### 출력 안 될 때

1. GT800 전원 확인
2. USB 확인
3. 웹 화면의 "다시 검색" 클릭
4. 해결되지 않으면 Browser Print 실행 확인
5. 계속 실패하면 관리자 호출

사용자에게 Windows Device Manager까지 조작하게 하지 않는 것이 좋다.

---

# 88. 운영자 장애 대응 Runbook

## 증상: 프린터를 찾을 수 없음

1. GT800 전원 확인
2. USB 확인
3. Windows Printers 확인
4. Zebra Setup Utilities 확인
5. Browser Print 확인
6. Browser Print 재시작
7. 브라우저 재시작
8. PC 재부팅
9. USB Cable 교체
10. Driver 재설치

## 증상: 데이터 전송 성공인데 라벨이 안 나옴

1. Media 확인
2. Ribbon 확인
3. Head Open 확인
4. Pause 확인
5. Printer Feed 확인
6. GT800 Configuration 확인

---

# 89. 운영 데이터 분석

출력 이력으로 다음을 분석할 수 있다.

```text
일별 출력량
사용자별 출력량
Workstation별 출력량
재출력 비율
오류 비율
프린터 미탐지 비율
```

재출력 비율이 높다면 시스템 오류 또는 라벨 품질 문제를 의심할 수 있다.

---

# 90. API Endpoint 전체 예시

```text
/auth
  POST /login
  POST /logout

/workstations
  GET    /
  POST   /
  GET    /{id}
  PATCH  /{id}

/label-templates
  GET    /
  POST   /
  GET    /{id}
  POST   /{id}/versions
  POST   /{id}/activate

/print-jobs
  POST   /
  GET    /{id}
  GET    /recent
  POST   /{id}/dispatch
  POST   /{id}/result
  POST   /{id}/reprint

/audit-logs
  GET    /
```

---

# 91. 브라우저 측 주요 Module

```text
PrinterDetector
PrinterAdapter
BrowserPrintAdapter
PrinterStateStore
PrintQueue
PrintService
PrintErrorMapper
WorkstationService
```

이 중 핵심은 `PrinterAdapter`이다.

Browser Print 관련 코드는 반드시 Adapter 내부로 격리한다.

---

# 92. 향후 Zebra 프린터 교체 대응

GT800이 단종/노후화되어 다른 Zebra 프린터로 교체될 가능성이 높다.

ZPL II 기반 템플릿을 사용하면 같은 Zebra 계열 장비에서 재사용 가능성이 높다.

다만 다음은 기기별 차이가 있을 수 있으므로 검증한다.

- DPI
- Label width
- Media calibration
- Darkness
- Speed
- Font
- Memory
- 지원 ZPL 명령

템플릿에 printer model 종속 명령을 최소화한다.

---

# 93. DPI 대응

GT800의 실제 DPI에 맞게 라벨 좌표를 설계해야 한다.

라벨 디자인 데이터는 mm 단위로 관리하고 렌더링 단계에서 dot으로 변환하는 방법도 고려할 수 있다.

개념:

```text
mm
 ↓
printer DPI
 ↓
dot
```

프린터 종류가 늘어날 경우 이 구조가 유용하다.

초기 GT800 전용 버전에서는 ZPL Dot 좌표를 직접 사용하는 것도 가능하다.

---

# 94. 라벨 Preview

옵션 기능.

브라우저 화면에서 ZPL을 직접 정확하게 Rendering하는 것은 별도 문제가 있다.

가능한 방식:

- 서버에서 Preview용 HTML 생성
- 서버에서 Preview PNG 생성
- ZPL renderer 라이브러리 검토

주의:

Preview와 물리 인쇄 결과가 항상 완전히 동일하다고 보장하지 않는다.

운영 화면에는 다음과 같은 주의가 필요할 수 있다.

```text
미리보기 이미지는 실제 출력과 약간 다를 수 있습니다.
```

---

# 95. 개발 완료 Definition of Done

프로젝트 완료 판단 기준:

### 기능

- [ ] 로그인
- [ ] 업무 데이터 조회
- [ ] Label Template 관리
- [ ] ZPL 생성
- [ ] GT800 USB 검색
- [ ] Browser Print 연결
- [ ] Label 출력
- [ ] 출력 Job 이력
- [ ] 재출력
- [ ] 오류 UI
- [ ] Workstation 등록

### 품질

- [ ] Chrome 테스트
- [ ] Edge 테스트
- [ ] 100장 연속 출력
- [ ] USB Disconnect
- [ ] PC Restart
- [ ] Printer Restart
- [ ] Browser Print Restart
- [ ] Barcode Scan
- [ ] 한글 검증
- [ ] 보안 테스트

### 운영

- [ ] 설치 문서
- [ ] 사용자 매뉴얼
- [ ] 관리자 매뉴얼
- [ ] 장애 대응 문서
- [ ] 로그
- [ ] 모니터링
- [ ] 백업
- [ ] 배포 절차

---

# 96. 최종 권장 아키텍처

본 프로젝트의 최종 기본안은 다음과 같다.

```text
                    ┌──────────────────────────────┐
                    │         Central Server       │
                    │                              │
                    │  Frontend                    │
                    │  Backend API                 │
                    │  Authentication              │
                    │  Business Logic              │
                    │  ZPL Template                │
                    │  Print Job                   │
                    │  Print History               │
                    │  Audit                       │
                    └──────────────┬───────────────┘
                                   │
                                   │ HTTPS
                                   ▼
                    ┌──────────────────────────────┐
                    │          Client PC           │
                    │                              │
                    │ Chrome / Edge                │
                    │      │                       │
                    │      ▼                       │
                    │ PrinterAdapter               │
                    │      │                       │
                    │      ▼                       │
                    │ BrowserPrintAdapter          │
                    │      │                       │
                    │      ▼                       │
                    │ Zebra Browser Print          │
                    │      │                       │
                    │      │ USB                   │
                    │      ▼                       │
                    │ Zebra GT800                  │
                    └──────────────────────────────┘
```

핵심 원칙은 다음 세 가지다.

### 원칙 1

```text
서버가 ZPL을 생성한다.
```

### 원칙 2

```text
클라이언트 PC가 USB 프린터에 ZPL을 전송한다.
```

### 원칙 3

```text
Browser Print를 Adapter 뒤에 숨긴다.
```

이 세 가지를 지키면 향후:

```text
GT800
  ↓
ZD421
  ↓
ZT411
```

같은 Zebra 프린터 교체나,

```text
Browser Print
  ↓
Local Print Agent
```

같은 출력 방식 변경에 대응하기 쉬워진다.

---

# 97. 개발 착수 전 최종 의사결정 목록

개발 시작 전에 아래 항목을 확정한다.

- [ ] 운영 Windows 버전
- [ ] 운영 Chrome/Edge 정책
- [ ] 실제 GT800 Firmware
- [ ] Zebra Driver 표준 버전
- [ ] Browser Print 표준 버전
- [ ] GT800 Browser Print POC 성공
- [ ] Label Size
- [ ] DPI
- [ ] Thermal Transfer / Direct Thermal
- [ ] Ribbon 종류
- [ ] 한글 사용 여부
- [ ] Barcode 종류
- [ ] QR 사용 여부
- [ ] 하루 평균 출력량
- [ ] 최대 Copies
- [ ] 재출력 정책
- [ ] Workstation 등록 정책
- [ ] 사용자 인증 방식
- [ ] DB 종류
- [ ] 서버 배포 방식
- [ ] HTTPS 도메인
- [ ] 로그 보존기간
- [ ] Print Job 보존기간

---

# 98. 첫 번째 개발 Sprint 권장 작업

실제 개발을 시작한다면 첫 Sprint의 우선순위는 아래 순서가 가장 좋다.

## 1

GT800 실기기 준비.

## 2

Windows Driver 설치.

## 3

Zebra Setup Utilities로 Raw ZPL 출력 가능 여부 검증.

## 4

Browser Print 설치.

## 5

아주 작은 HTML 페이지 작성.

## 6

Browser Print에서 GT800 검색.

## 7

다음 ZPL 출력.

```zpl
^XA
^FO50,50
^A0N,40,40
^FDGT800 WEB PRINT TEST^FS
^XZ
```

## 8

Chrome/Edge 둘 다 검증.

## 9

USB 분리/재연결 검증.

## 10

100장 연속 출력.

이 POC를 통과한 뒤 웹 프로젝트 Skeleton을 만들면 기술 리스크를 가장 크게 줄일 수 있다.

---

# 99. 참고 공식 자료

아래 자료는 구현 전에 최신 내용을 다시 확인하는 것을 권장한다.

## Zebra Browser Print Demo / TechDocs

https://techdocs.zebra.com/link-os/latest/demos/browser-print/

주요 확인 사항:

- Browser 기반 로컬 Network/USB Zebra 프린터 출력
- Client PC에 Browser Print 설치 필요
- 지원 브라우저 관련 안내

## Zebra Browser Print Support

https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html

주요 확인 사항:

- Windows/macOS Desktop에서 USB 및 Network connectivity
- Browser Print 다운로드
- JavaScript Library
- Documentation

## Zebra Browser Print User Guide

https://www.zebra.com/content/dam/zebra_new_ia/en-us/solutions-verticals/product/Software/Printer%20Software/Link-OS/browser-print/zebra-browser-print-user-guide-v1-3-2-en-us.pdf

가이드의 지원 기능 표에는 다음이 포함된다.

- G-Series
- ZPL II
- USB
- Network

실제 GT800 운용 환경에서는 반드시 실기기 검증을 수행한다.

## GT800 User Guide

Zebra GT800 User Guide를 통해 다음을 확인한다.

- USB 연결
- ZPL/EPL 설정
- Media Calibration
- Printer Configuration
- Driver Setup
- Print quality

---

# 100. 결론

본 요구사항인

```text
중앙 서버에서 웹 서비스 운영
        +
클라이언트 PC가 브라우저로 접속
        +
각 PC에 GT800 USB 연결
        +
PC 1대 : 프린터 1대
```

환경은 웹 기반 라벨 시스템으로 충분히 구현 가능하다.

가장 적합한 기본 구조는:

```text
웹 브라우저
  ↓
서버 API에서 Print Job 및 ZPL 수신
  ↓
PrinterAdapter
  ↓
Zebra Browser Print
  ↓
USB
  ↓
GT800
```

이다.

본 프로젝트에서 기술적으로 가장 중요한 성공 조건은 웹 프레임워크 선정이 아니라 **GT800 + 운영 Windows + 운영 Browser + Browser Print 조합에 대한 실기기 POC**다.

따라서 프로젝트의 첫 번째 공식 Milestone은 다음으로 정의하는 것이 적절하다.

> "운영 환경과 동일한 Windows PC에서 Browser Print를 사용하여 USB 연결된 Zebra GT800에 ZPL 라벨을 안정적으로 출력하고, 재부팅·USB 재연결·브라우저 재실행 이후에도 재현 가능함을 확인한다."

이 Milestone을 통과한 뒤 전체 업무 시스템을 확장한다.

실기기 POC가 실패하더라도 프로젝트 전체 구조를 다시 만들 필요가 없도록 `PrinterAdapter` 계층을 두고 Browser Print를 `Local Print Agent`로 교체할 수 있게 설계하는 것이 장기적으로 가장 안전한 접근이다.
