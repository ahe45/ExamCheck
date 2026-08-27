# API 공통 계약

> 기준일: 2026-08-28  
> 기본 경로: `/api/v1`

## 요청 식별자

클라이언트는 선택적으로 `x-request-id` 헤더를 보낼 수 있다. 값은 1~128자의 영문, 숫자,
마침표, 밑줄, 콜론, 하이픈만 허용한다. 유효하지 않거나 누락된 값은 서버가 UUID로
대체한다. 최종 식별자는 모든 응답의 `x-request-id` 헤더에 포함된다.

운영 로그에는 요청 본문, query string, 인증 토큰, 수험번호 등 개인정보를 기록하지 않는다.
완료 로그는 `method`, 프레임워크 route template, `statusCode`, `durationMs`, `requestId`만
포함한다.

HTTP middleware는 확정된 request ID를 비동기 request context에 저장한다. 같은 요청 안에서
`MutationAuditRepository`가 기록하는 상태 변경 감사와 로그인 성공·실패·차단 감사에는 별도
인자를 반복 전달하지 않아도 같은 `audit_log.request_id`가 저장된다. 호출자가 명시적 request ID를
감사 저장에 전달하면 그 값이 우선한다.

상태 변경 감사는 업무 write와 같은 transaction executor를 사용하며 감사 저장이 실패하면 해당
업무 transaction도 실패해야 한다. 인증 실패 감사는 인증 요청 자체를 방해하지 않는 best-effort
보안 이벤트이므로 저장 실패를 별도 경고로 남긴다. HTTP request context 밖의 배치·worker는 아직
자동 correlation 대상이 아니며, 명시적 correlation ID 계약을 추가하기 전까지 요청과 연결됐다고
간주하지 않는다.

## 오류 응답

모든 오류는 기존 `statusCode`와 `message`를 유지하면서 다음 필드를 함께 반환한다.

```json
{
  "statusCode": 409,
  "message": "다른 사용자가 이 전형의 설정을 먼저 변경했습니다.",
  "code": "CONFLICT",
  "path": "/api/v1/pseudonyms/setting",
  "requestId": "b890e767-08d7-47ef-b655-8b4a2ad69525",
  "timestamp": "2026-08-28T01:00:00.000Z"
}
```

DTO 검증 오류의 `message`는 문자열 배열일 수 있다. Web API 클라이언트는 배열을 사용자용
한 문장으로 합치고 `status`, `code`, `requestId`를 `ApiError`에 보존한다.

Web 클라이언트는 로그인·세션·시스템 프로필뿐 아니라 대시보드 집계, 수험생 XLSX·사진 ZIP
미리보기와 반영 결과, 전형 설정 overview, 가번호 설정·부여·운영 상태 같은 고위험 성공 응답도
Zod schema로 런타임 검증한다. HTTP 성공 응답이라도 계약과 다른 자료형, 필수 필드 누락 또는
허용되지 않은 enum 값이면 그 데이터를 화면 상태에 반영하지 않는다. 이 경우 클라이언트가
`status: 502`, `code: INVALID_RESPONSE`인 `ApiError`로 변환하고
`서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.`만 표시한다. Zod issue, 내부 경로,
기대 자료형 등 검증 구현 상세는 사용자에게 노출하지 않는다.

|   HTTP 상태 | `code`                    |
| ----------: | ------------------------- |
|         400 | `VALIDATION_ERROR`        |
|         401 | `AUTHENTICATION_REQUIRED` |
|         403 | `FORBIDDEN`               |
|         404 | `NOT_FOUND`               |
|         409 | `CONFLICT`                |
|         429 | `RATE_LIMITED`            |
| 그 밖의 4xx | `HTTP_ERROR`              |
|         5xx | `INTERNAL_ERROR`          |

예상하지 못한 서버 오류는 내부 메시지, stack, cause를 응답에 노출하지 않는다.

## 상태 확인

- `GET /api/v1/health`: 기존 호환용 readiness 응답
- `GET /api/v1/health/live`: API 프로세스가 요청에 응답할 수 있는지 확인
- `GET /api/v1/health/ready`: DB 연결을 포함해 트래픽을 받을 준비가 되었는지 확인

readiness에서 DB 연결이 실패하면 HTTP 503을 반환하며 DB 주소나 드라이버 오류 원문은
노출하지 않는다.

## CORS와 보안 헤더

`FRONTEND_ORIGINS`에 쉼표로 구분한 정확한 origin 목록을 설정한다. 기존 단일
`FRONTEND_ORIGIN`도 호환되며, 두 값이 모두 없을 때만 `http://localhost:5173`을 사용한다.
credentialed CORS에서 와일드카드(`*`)는 허용하지 않는다.

현재 Content Security Policy는 Browser Print, blob/data 기반 미리보기와 기존 양식의
호환성을 관찰하기 위해 `Content-Security-Policy-Report-Only`로 적용한다. 실제 차단 정책으로
전환하려면 [보안 기준](./security.md)의 양식 allowlist 및 현장 출력 검증 게이트를 먼저 통과해야 한다.

## 권한 계약

Controller는 역할 문자열을 직접 나열하는 대신 중앙 permission을 선언한다. 현재 permission은
계정 관리, 수험생 업로드·조회, 개발자 설정, 드라이버 다운로드, 운영 마감·내보내기·재개,
인쇄 생성, 가번호 부여, 전형 설정, 양식 관리, 워크스테이션 관리로 구분한다.

- `DEVELOPER`: 모든 permission
- `ADMIN`: 개발자 설정을 제외한 관리·운영 permission
- `OPERATOR`: 수험생 조회, 드라이버 다운로드, 마감·내보내기, 인쇄, 가번호 부여
- `VIEWER`: 수험생 조회

permission 통과는 데이터 범위 전체 허용을 뜻하지 않는다. 사용자 전형 배정과 교시/전형 scope는
각 application service에서 별도로 검증하며, 배정되지 않은 사용자의 implicit-all 정책은 현재
업무 계약을 유지한다. 목표 `ALL/ASSIGNED` 모델로의 전환은 외부 결정 전에는 수행하지 않는다.

## 런타임 설정 경계

서버는 시작 시 환경값을 typed `AppConfig`로 한 번 해석하고 이후 서비스에 불변 객체로 주입한다.
HTTP 포트·CORS, DB 연결, JWT/session, 로그인 제한, 기본 시험명, 인쇄 작업 만료값은 이 경계를
통해 제공된다. 잘못된 명시적 숫자, 허용되지 않은 CORS origin, 운영 기본 JWT secret 같은 설정은
요청 처리 중 fallback하지 않고 시작 단계에서 실패한다. DB password는 의미 있는 공백을 임의로
trim하지 않는다.

## 관리자 집계 조회

### `GET /candidates/dashboard-summary`

관리자 대시보드가 사용하는 서버 집계 경계다. 선택 query인 `admissionName`은 1~200자이며,
로그인 계정에 배정된 전형 범위를 벗어나면 거부한다. query를 생략하면 해당 계정이 조회할 수 있는
전체 전형을 집계한다.

```json
{
  "totalCandidates": 30,
  "assignedCandidates": 2,
  "unassignedCandidates": 28,
  "assignmentRate": 6.7,
  "admissions": [
    {
      "name": "학생부교과 면접",
      "total": 30,
      "assigned": 2,
      "unassigned": 28,
      "assignmentRate": 6.7,
      "status": "progress"
    }
  ],
  "admissionCounts": { "waiting": 0, "progress": 1, "complete": 0 }
}
```

`status`는 `waiting`, `progress`, `complete` 중 하나다. Web은 대시보드 메뉴가 활성화된 경우에만
이 query를 실행하며, 인증 토큰을 query key에 넣지 않는다. 계정 변경·로그아웃·401 처리 시 전체
query cache를 비우는 기존 세션 격리 계약을 유지한다.

### `GET /pseudonyms/settings-overview`

전형별 시스템 설정 카드가 사용하는 일괄 조회 경계다. 공백이 아닌 `examName` query가 필수이며,
권한과 전형 배정 범위 안의 전형만 반환한다. 카드마다 수험생·날짜·교시 집계와 고사건물 목록을
제공하고, 적용 가능한 설정이 있으면 전체 `PseudonymSetting`과 범위 목록을 `setting`에 포함한다.

```json
[
  {
    "name": "학생부교과 면접",
    "candidates": 30,
    "dates": 1,
    "schedules": 2,
    "buildings": ["본관"],
    "setting": null,
    "error": true
  }
]
```

화면은 카드별 추가 조회를 만들지 않고 이 응답 하나를 사용한다. `setting: null`은 해당 전형에
적용할 설정이 없음을 뜻하며, Web은 overview와 중첩 설정·범위를 모두 런타임 검증한다.

## 수험생 업로드 미리보기와 반영

XLSX와 사진 ZIP 업로드는 반드시 미리보기 성공 후 받은 서명 티켓으로 반영해야 한다.

| 구분            | 미리보기                                 | 실제 반영                                   |
| --------------- | ---------------------------------------- | ------------------------------------------- |
| 수험생 XLSX     | `POST /candidates/import/preview`        | `POST /candidates/import?policy=...`        |
| 수험생 사진 ZIP | `POST /candidates/photo-archive/preview` | `POST /candidates/photo-archive?policy=...` |

모든 요청은 `multipart/form-data`의 `file` 필드를 사용한다. 반영 요청의 `policy`는
`insert-only`, `insert-update`, `all` 중 하나이며 생략 시 `insert-update`다. 미리보기 응답은
각각 다음 계약을 갖는다.

```json
{
  "fileName": "수험생 업로드 양식.xlsx",
  "previewToken": "<signed-ticket>",
  "totalRows": 30,
  "insertCount": 28,
  "updateCount": 1,
  "unchangedCount": 1
}
```

```json
{
  "fileName": "수험생 사진.zip",
  "previewToken": "<signed-ticket>",
  "totalFiles": 30,
  "matchedCount": 29,
  "skippedCount": 1,
  "duplicateCount": 0
}
```

반영할 때 `previewToken`을 query string이나 파일명에 넣지 않는다. 미리보기에서 받은 값을
`X-Candidate-Preview-Token` 요청 헤더로만 전달한다. 헤더는 앞뒤 공백이 없는 1~2,048자 문자열이어야
하며 누락·빈 값·길이 초과는 서비스 호출 전에 HTTP 400으로 거부한다. 브라우저 CORS preflight도
이 전용 헤더를 허용한다.

XLSX 반영 응답은 `totalRows`, `inserted`, `updated`, `skipped`를, 사진 반영 응답은
`totalFiles`, `uploaded`, `updated`, `skipped`, `duplicateCount`를 0 이상의 정수로 반환한다.
Web은 미리보기의 필수 `previewToken`과 모든 집계 필드를 실제 반영 전에 런타임 검증한다.

티켓은 업로드 종류, 인증 사용자 ID(actor), 파일 SHA-256, 미리보기 당시 DB 상태의 keyed
checksum, 만료 시각(TTL 30분)을 HMAC 서명으로 묶는다. 반영 API는 서명·종류·actor·파일·TTL을
검증한 뒤 transaction 안에서 관련 후보 행을 잠그고 현재 상태 checksum을 다시 비교한다. 어느
하나라도 달라지면 쓰기와 감사 저장 전에 전체 요청을 거부하며, 사용자는 파일을 다시 선택해 새
미리보기를 받아야 한다. 세부 보안 계약은 [보안 기준](./security.md)을 따른다.

## 전형 설정 동시 저장

`GET /pseudonyms/setting` 응답의 `version`을 `PUT /pseudonyms/setting` 요청의
`expectedVersion`으로 그대로 보낸다. 해당 전형에 아직 별도 설정이 없고 기본 설정을 상속한
경우 GET은 `version: 0`을 반환한다. 저장 성공 후에는 서버가 반환한 새 `version`을 사용한다.

다른 관리자가 먼저 저장해 버전이 달라지면 서버는 HTTP 409를 반환한다. 클라이언트는 사용자가
편집한 값을 조용히 덮어쓰거나 자동 재시도하지 않고, 최신 설정 새로고침을 안내한다.
