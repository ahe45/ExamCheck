# ExamList / ExamCheck 양식 편집기 비교

확인일: 2026-10-02. 아래 내용은 변경 적용 전 .22 패키지를 기준으로 수행한 비교 기록이다. 이후의 전체 반영은 [적용 기록](template-editor-sync-2026-10-02.md)에 정리했다.

## 1. 비교 기준과 확인 범위

- ExamList: `C:/Users/ahe45/WebstormProjects/ExamList`, HEAD `e338f24e1e17fad5339d99f7ad2b4f246f99b53e` (2026-10-01). 작업 트리에 변경 없음.
- ExamCheck: `C:/Users/ahe45/WebstormProjects/examcheck`, HEAD `d1a5178`. 양식 편집기 의존성은 `vendor/examlist-template-editor-1.1.13-examcheck.22.tgz`.
- ExamCheck 웹에서 해석되는 편집기 스타일 경로는 루트 `node_modules/examlist-template-editor/src/styles/template-editor.css`. 설치 패키지 버전은 `1.1.13-examcheck.22`.
- 배포용 tgz 안의 **137개 파일을 설치 패키지와 바이트 단위로 비교했고 차이가 없었다**. 설치된 패키지를 기준으로 조사해도 현재 프로젝트가 지정한 배포 파일과 일치한다.
- 런타임 foundation/objects/bootstrap 번들의 `Source:` 구분을 이용해 원본 모듈별로 비교했다. 패키징 때문에 제거된 import, CommonJS 비활성화 래퍼, 공백 차이는 정규화했다. 확장 모듈, 스타일, ExamCheck 자체 연동 코드 및 두 앱의 PDF 구현도 별도로 읽었다.

| 비교 대상                          | 같음 | 다름 | 설명                                   |
| ---------------------------------- | ---: | ---: | -------------------------------------- |
| 기존 런타임 모듈 91개              |   52 |   39 | 공통 모듈의 정규화된 코드 비교         |
| 기존 확장 모듈 59개                |   36 |   23 | 모두 ExamList에 대응 파일이 있음       |
| 최신 ExamList 런타임에 추가된 모듈 |    — |    1 | `text-editing.js`가 현재 패키지에 없음 |

**39개/23개는 미반영 버그 수가 아니다.** ExamCheck의 독자적인 패치와 호스트 연동을 위한 차이도 포함한다. 문자열/주석 등도 정규화 비교에 포함되므로 숫자는 조사 범위를 나타낸다. 반대로 CSS, 앱 호스트, 서버 PDF 코드는 이 숫자에 포함하지 않았다.

이번 검증은 코드·배포 파일·Git 이력 비교다. 두 앱을 실행해 같은 문서를 편집하고 PDF 픽셀을 비교하는 재현 시험은 수행하지 않았다. 아래에서 ‘미반영’은 해당 수정 코드가 없다는 뜻이며 모든 사용자 환경에서 같은 오류가 재현된다는 뜻은 아니다.

## 2. 공통 편집기에서 미반영이 확인된 수정

### A. 셀 크기 입력과 병합 셀 계산 — 우선 반영 대상

ExamList `e338f24` (10/01):

- 실제 선택한 셀 목록을 바탕으로 너비·높이를 적용한다.
- 너비만 입력하면 너비만, 높이만 입력하면 높이만 적용할 수 있다.
- 크기 입력 중 포커스를 유지하며, 입력 중인 필드는 툴바 갱신으로 덮어쓰지 않는다.
- 선택 셀들의 값이 다르면 입력란에 `혼합`을 표시한다.
- 병합 셀의 너비/높이를 논리 열·행으로 나누고, 그룹 너비를 제한하면서 적용한다.
- 표시 크기를 계산할 때 확대 배율을 제거한다.

ExamCheck 패키지는 이전 `table-sizing.js`, `table-tools-cell-state.js`, `toolbar-state.js` 구현을 사용한다. 기존 크기 적용 범위 드롭다운을 중심으로 계산하며 위 변경이 없다. `template-editor-events.js`의 크기 입력 이벤트 보완도 최신과 다르다.

근거: ExamList `client/template-editor-runtime/client/features/template-editor/{table-sizing,table-tools-cell-state,toolbar-state}.js`; ExamCheck `node_modules/examlist-template-editor/src/runtime/{template-editor-runtime-objects,template-editor-runtime-bootstrap}.bundle.js`의 대응 Source 구간.

ExamList 호스트의 `client/features/template-editor/document-table-actions.js`도 툴바 조작 후 선택 기준을 네이티브 range보다 런타임 anchorCell에서 먼저 찾도록 바뀌었다. 이 호스트 파일은 ExamCheck가 사용하는 파일이 아니므로 이 부분은 자체 명령 디스패처에 맞춰 판단해야 한다.

### B. 행 높이 드래그·균등 분배·최소 높이 — 우선 반영 대상

ExamList `a3bf48a` (09/28), `bb43306` / `e338f24` (10/01):

- 표의 실제 rect/offset 크기로 배율을 계산해 본문 확대와 블록 편집 확대를 함께 처리한다.
- 표 내부 행 경계를 드래그할 때 인접 두 행을 함께 조절한다.
- 텍스트와 여백을 포함한 최소 행 높이를 복제 표에서 측정하고, 인접 행의 여유 범위 안에서 제한한다.
- 균등 분배 전에 행 높이를 먼저 수집하고, 기존 저장 높이와 rowspan을 반영한다.
- 불필요한 min-height를 정리하는 등 표 전체 높이가 계속 늘어나는 현상을 줄인다.

ExamCheck의 `table-resize-session.js`, `table-sizing-values.js`, `table-tools-logical-sizing.js` 등은 이 변경 전 코드다. 블록 모달 배율을 다룬 로컬 패치는 있으나 최신 본문 배율 및 인접 행 최소 높이 계산과 같지 않다.

### C. 한 셀 안에서 글자를 드래그 선택

ExamList `4a2df3a` (09/19)의 `table-selection.js`는 포인터가 시작 셀 안에 있는 동안 네이티브 글자 선택을 허용하고, 다른 셀로 넘어갈 때 직사각형 셀 선택으로 전환한다. ExamCheck의 대응 모듈에는 이 조건이 없다. 셀 선택과 글자 선택의 충돌을 줄이는 수정이다.

### D. 이미지·표 이동/크기 조절과 확대 좌표

ExamList 09/18 이후 `image-positioning.js`, `image-move-session.js`, `image-resize-session.js`, `table-object-geometry.js`, `table-object-overlay.js` 등에 추가된 변경이 현재 패키지에 없다.

- 본문 확대 배율까지 반영한 이미지 위치/크기 계산.
- 셀 테두리 위치를 `clientLeft/clientTop`으로 보정.
- 이미지를 떠 있는 객체로 전환할 때 border-box 높이를 CSS height에 다시 넣어 여백이 중복되는 것을 방지.
- 이동 객체의 DOM 위치와 빈 호스트 정리 개선.

해당 패키지 모듈들은 `394c873` 당시 코드와 정규화 비교에서 일치한다. ExamCheck의 객체/블록 레이아웃 보완을 함께 유지하면서 반영해야 한다.

### E. 셀 여백의 단위와 정밀도도 다름

ExamList `e338f24` (10/01)는 셀 여백을 **0~96px, 소수 둘째 자리**로 처리한다. ExamCheck 패키지는 **0~72pt, 소수 첫째 자리**이며 실제 셀 스타일도 pt로 기록한다.

근거: `table-border-actions.js`, `toolbar-border-markup.js`, `toolbar-border-select-ui.js`, `toolbar-state.js`.

이 변경은 라벨 변경만이 아니다. 1pt는 96dpi 기준 약 1.333px이므로 동일한 숫자를 입력했을 때 실제 여백이 달라진다. 기존 문서의 pt 스타일을 보존하고 입력 표시값을 변환하는 정책이 필요하다.

### F. 선택 해제 API·편집 제한·확대 시 선택 표시

ExamList의 최신 `template-editor-runtime-api.js`에는 이미지/표 hover, 활성 셀, 네이티브 selection, 툴바를 함께 정리하는 선택 해제와 `setInteractionDisabled`가 추가되어 있다. 현재 패키지의 API에는 없다.

`object-multi-selection-overlays.js`의 본문 확대 변경 이벤트(`template-editor-canvas-zoom-change`) 대응도 다르다. 최신 선택 표시 갱신을 현재 패키지에서 그대로 얻을 수 없다.

다만 ExamList의 표지 비활성화 정책은 앱 기능이다. ExamCheck에 동일한 표지 기능이 있다고 가정해서 ‘표지 버그’로 분류하지 않았다.

### G. 툴바 배치와 색상 선택 포커스

- 10/01 글꼴/크기 그룹, 글자색/배경색 그룹, 줄간격의 배치, 가로·세로 라벨 및 테두리 선택 UI 관련 마크업/스타일 변경이 현재 패키지에 없다.
- 09/28 색상 선택기를 열기 전에 `focus({ preventScroll: true })` 하는 런타임 수정이 현재 `toolbar-interactions.js`에 없다.
- ExamList 호스트의 중복 색상 이벤트 방지 수정(`8206279`)은 별개다. ExamCheck는 해당 ExamList 호스트 이벤트 파일을 사용하지 않으므로 같은 버그가 있다고 단정할 수 없다.

### H. 새 텍스트 편집 모듈 — 기능 누락이 아닌 구성 차이

최신 ExamList 런타임 manifest에는 `client/features/template-editor/text-editing.js`가 추가되어 있다. 현재 패키지의 91개 런타임 Source 구간에는 이 모듈이 없다. 다만 이 모듈은 ExamCheck 구현에서 가져온 것이다.

원본 첫 줄에 `Adapted from examcheck's text-selection, token-caret and line-alignment helpers`라고 명시되어 있다. 실제로 ExamCheck의 `template-text-selection.ts`, `template-token-caret.ts`, `template-line-alignment.ts`가 같은 역할을 앱 레벨에서 수행한다. 따라서 파일이 없다는 사실을 기능 미반영으로 세면 안 된다. 런타임 구성을 통일할 때 앱 보완과 이 모듈의 중복 실행을 피해야 한다.

## 3. 화면과 PDF 관련 차이

| 항목                        | 최신 ExamList                                                                      | 현재 ExamCheck                                                                                         | 판단                                                 |
| --------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 데이터 태그 화면 배치       | 09/29 일반 inline 텍스트의 줄높이/간격을 따르고, 장식이 본문 폭에 주는 영향을 줄임 | 패키지의 이전 배지 스타일. 앱 CSS는 줄바꿈을 허용하지만 inline-flex/여백을 최신 방식으로 바꾸지는 않음 | 편집 화면 변경 미반영                                |
| 태그 출력 여백              | 최신 화면/서버 출력 규칙                                                           | `templatePrintTokenFlowCss`로 출력 시 가로 padding/border/margin을 제거하고 줄바꿈 허용                | 일부 목적을 이미 별도로 보완                         |
| 긴 응시자 데이터 자동 맞춤  | 09/22 `data-fit-script.js`: 실제 줄수/크기 측정, 최소 5pt까지 축소, 이후 줄바꿈    | 현재 PDF 생성 경로에서 같은 측정·축소 로직을 찾지 못함                                                 | 출력 기능 차이. 브라우저 경로에 별도 이식 필요       |
| 떠 있는 객체 아래 본문 간격 | 09/28 서버 `object-flow-script.js` 및 썸네일 경로 보완                             | 자체 직렬화/출력 코드, 편집용 spacer 정리 및 기존 흐름 패치                                            | 구조가 달라 실제 겹침 여부는 재현 시험 필요          |
| PDF 글자색 보존             | 10/01 서버 출력 CSS의 print-color-adjust 등 개선                                   | 자체 `html2canvas`/`jsPDF` 경로 및 브라우저 인쇄                                                       | 동일 수정 없음. 색상이 사라진다고 단정할 근거는 없음 |
| 바코드/QR 기본 색           | 10/01 `#000000`                                                                    | 패키지 생성 객체 기본 및 실제 QR 생성의 `#111827`                                                      | 기본 색 차이 확인                                    |

ExamList는 `server/modules/pdf-preview/`에서 PDF를 렌더링한다. ExamCheck는 `apps/web/src/features/templates/template-renderer.ts`에서 브라우저 DOM을 렌더링하고 `html2canvas`/`jsPDF`를 사용한다. 서버 PDF 수정 파일을 편집기 tgz에 넣는 것만으로 ExamCheck 출력에 적용되지 않는다.

주요 근거:

- ExamList: `styles/features/template-editor/data-tags.css`, `server/modules/pdf-preview/{data-fit-script,object-flow-script,styles-print,styles-layout}.js`, `client/features/template-editor/{code128-svg,generated-objects-svg}.js`.
- ExamCheck: `node_modules/examlist-template-editor/src/styles/template-editor.css`, `apps/web/src/styles/{legacy-admin,system-settings}.css`, `apps/web/src/features/templates/{template-print-presentation,template-renderer,generated-object-assets}.ts`.

ExamList의 09/21 인식마크 위치를 기본값(14.17pt)으로 고정하고 편집 UI를 줄이는 변경도 앱 정책 차이다. ExamCheck의 페이지 속성 확장과 기능 노출 범위를 확인해 선택적으로 적용해야 하며 공통 셀 편집 버그와 묶어 일괄 적용할 사항은 아니다.

## 4. 업데이트 시 보존할 ExamCheck 보완

현재 패키지를 최신 ExamList 파일로 통째로 덮어쓰는 방식은 부적절하다. `vendor/patches/README.md`에 .1~.22 패치 목적이 기록되어 있고 앱 코드에도 별도 연동이 있다.

대표적으로 다음을 보존하거나 최신 구현과 중복되는지 검증해야 한다.

- 태그 서식 보존, 명령당 한 번의 undo, 선택/캐럿 복구 및 한글 입력 동기화.
- 페이지 넘침의 오탐 방지, 객체 흐름 spacer 누적 방지, 블록 모달 확대와 원래 크기 유지.
- 병합 셀과 서식을 보존하는 표 복사/붙여넣기, 선택 셀 내용 삭제 우선 처리.
- 빈 블록 기본 숨김 및 블록 기본 격자 설정.
- 태그별 날짜/시간 표시 형식과 생성 객체별 데이터 소스 선택(.21/.22).
- `generated-object-assets.ts`의 `uqr` 기반 실제 QR 생성.
- `template-editor-transaction-coordinator.ts`의 블록 편집 중 본문 커밋 차단, 자체 명령 디스패처와 선택 동기화.
- ExamCheck 자체 데이터 태그, 서명 제어 및 줄 정렬 연동.

위 항목은 ‘모두 ExamList에 없는 독점 기능’이라는 뜻이 아니다. 두 프로젝트에서 다른 방식으로 같은 문제를 해결한 부분이 있어 병합 시 동작을 검증해야 한다.

## 5. 동기화 유지보수의 차이

- 루트 README에는 .21 안내가 남아 있으나 실제 의존성은 .22다.
- `docs/template-editor-modernization.md`에는 오래된 `1.1.0` 및 현재 존재하지 않는 `../ExamList/portable-template-editor` 경로가 남아 있다.
- .1~.22의 실제 패치 파일은 모두 있다. 다만 .1~.4는 `examlist-template-editor-1.1.13-examcheck.N.patch`, .5~.22는 `examcheck.N.patch`라는 다른 이름을 사용한다. README의 .1~.4 표기는 실제 파일명과 일치하지 않으므로 재적용 절차를 정리할 필요가 있다.
- 현재 로컬 tgz를 사용하므로 ExamList를 수정해도 ExamCheck가 자동으로 따라가지 않는다.
- 이번에는 설치 EXE를 수정하거나 내부 포함 패키지를 다시 검증하지 않았다. 향후 편집기를 업데이트한 뒤 설치 배포물도 다시 빌드·검증해야 한다.

## 6. 권장 반영 순서

1. **표 편집 안정성:** 셀 크기 입력/병합/선택, 행 높이와 최소 크기, 확대 좌표, 셀 안 글자 선택.
2. **화면 동기화:** 셀 여백 단위 변환, 태그 배치, 툴바, 선택 해제/확대 표시. 저장된 기존 문서로 확인.
3. **출력 별도 적용:** 긴 데이터 5pt 맞춤, 떠 있는 객체와 본문 간격, 출력 색상. 같은 문서를 두 앱에서 렌더링해 비교.
4. **배포 정리:** 로컬 .1~.22 패치 보존/중복 제거와 경로 정리, 새 패키지 작성, 실제 소비자 연동 시험, 설치 파일 재빌드.

한 가지 날짜나 버전을 기준으로 ‘그 이후 수정 전체가 빠졌다’고 표현할 수 없다. 현재 패키지는 이전 ExamList 코드와 ExamCheck의 여러 보완이 섞여 있다. **미반영 공통 수정, 다른 앱 구조로 인한 차이, 기존 로컬 보완을 분리해서 동기화해야 한다.**

## 7. 전체 차이 모듈 목록

아래 목록은 코드 차이가 난 파일의 전수 목록이며, 각각이 독립된 버그라는 의미는 아니다. 런타임 파일은 ExamList의 `client/template-editor-runtime/` 아래 경로, 확장 파일은 ExamList 루트 아래 경로다. 패키지 대응은 런타임 Source 구간 또는 `src/extensions/examlist/`에서 찾을 수 있다.

### 런타임: 39개

| 번들       | 원본 경로                                                           | 이전 ExamList 이력과 동일한 코드 |
| ---------- | ------------------------------------------------------------------- | -------------------------------- |
| foundation | `client/features/editor/toolbar-border-markup.js`                   | bb43306, 574ff1b, 8206279        |
| foundation | `client/features/editor/toolbar-markup-helpers.js`                  | 로컬 패치/별도 차이 포함         |
| foundation | `client/features/editor/toolbar-markup.js`                          | 로컬 패치/별도 차이 포함         |
| foundation | `client/features/editor/toolbar-border-select-ui.js`                | bb43306, 574ff1b, 8206279        |
| foundation | `client/features/template-editor/generated-objects.js`              | 로컬 패치/별도 차이 포함         |
| foundation | `client/features/template-editor/page-settings.js`                  | 로컬 패치/별도 차이 포함         |
| foundation | `client/features/template-editor/preview-printing.js`               | bb43306, 574ff1b, 8206279        |
| foundation | `client/features/template-editor/image-selection.js`                | d476027, 5a08e37, df8b027        |
| foundation | `client/features/template-editor/image-positioning.js`              | 394c873, 8915a8e, 0f5b1d8        |
| foundation | `client/features/template-editor/image-move-session.js`             | 394c873, 8915a8e, 0f5b1d8        |
| foundation | `client/features/template-editor/image-resize-session.js`           | 394c873, 8915a8e, 0f5b1d8        |
| foundation | `client/features/template-editor/commands.js`                       | 로컬 패치/별도 차이 포함         |
| foundation | `client/features/template-editor/token-content.js`                  | 로컬 패치/별도 차이 포함         |
| foundation | `client/features/template-editor/selection-tokens.js`               | d476027, 5a08e37, df8b027        |
| foundation | `client/features/template-editor/selection-history.js`              | 로컬 패치/별도 차이 포함         |
| foundation | `client/features/template-editor/editing-token-style.js`            | 로컬 패치/별도 차이 포함         |
| foundation | `client/features/template-editor/editing-runtime.js`                | 로컬 패치/별도 차이 포함         |
| objects    | `client/features/template-editor/table-selection.js`                | d476027, 5a08e37, df8b027        |
| objects    | `client/features/template-editor/table-resize-values.js`            | 6f82979, 9934511, 75128fc        |
| objects    | `client/features/template-editor/table-resize-session.js`           | 6f82979, 9934511, 75128fc        |
| objects    | `client/features/template-editor/table-sizing-values.js`            | 6f82979, 9934511, 75128fc        |
| objects    | `client/features/template-editor/table-sizing.js`                   | 6f82979, 9934511, 75128fc        |
| objects    | `client/features/template-editor/table-border-actions.js`           | bb43306, 574ff1b, 8206279        |
| objects    | `client/features/template-editor/table-actions.js`                  | 로컬 패치/별도 차이 포함         |
| objects    | `client/features/template-editor/table-tools-cell-state.js`         | bb43306, 574ff1b, 8206279        |
| objects    | `client/features/template-editor/table-tools-logical-sizing.js`     | 6f82979, 9934511, 75128fc        |
| objects    | `client/features/template-editor/table-tools.js`                    | 6f82979, 9934511, 75128fc        |
| objects    | `client/features/template-editor/object-flow-reflow.js`             | 로컬 패치/별도 차이 포함         |
| objects    | `client/features/template-editor/table-object-geometry.js`          | 394c873, 8915a8e, 0f5b1d8        |
| objects    | `client/features/template-editor/table-object-overlay.js`           | 394c873, 8915a8e, 0f5b1d8        |
| objects    | `client/features/template-editor/table-object-sessions.js`          | 로컬 패치/별도 차이 포함         |
| objects    | `client/features/template-editor/table-object.js`                   | 로컬 패치/별도 차이 포함         |
| objects    | `client/features/template-editor/keyboard.js`                       | 로컬 패치/별도 차이 포함         |
| objects    | `client/features/template-editor/toolbar-rendering.js`              | bb43306, 574ff1b, 8206279        |
| objects    | `client/features/template-editor/toolbar-interactions.js`           | 6f82979, 9934511, 75128fc        |
| objects    | `client/features/template-editor/toolbar-state.js`                  | bb43306, 574ff1b, 8206279        |
| bootstrap  | `client/template-editor-runtime/template-editor-events.js`          | 로컬 패치/별도 차이 포함         |
| bootstrap  | `client/template-editor-runtime/template-editor-runtime-api.js`     | 394c873, 8915a8e, 0f5b1d8        |
| bootstrap  | `client/template-editor-runtime/template-editor-runtime-factory.js` | 로컬 패치/별도 차이 포함         |

### 확장: 23개

- `client/features/template-editor/candidate-block-grid-adapter.js`
- `client/features/template-editor/candidate-block-grid-boundary.js`
- `client/features/template-editor/candidate-block-grid-config.js`
- `client/features/template-editor/candidate-block-grid-dom.js`
- `client/features/template-editor/candidate-block-grid-focus-editor.js`
- `client/features/template-editor/candidate-block-grid-keyboard-target.js`
- `client/features/template-editor/candidate-block-grid-renderer.js`
- `client/features/template-editor/candidate-block-grid-sessions.js`
- `client/features/template-editor/data-tags-config.js`
- `client/features/template-editor/document-editor-root.js`
- `client/features/template-editor/document-editor-sanitizer.js`
- `client/features/template-editor/document-editor.js`
- `client/features/template-editor/editor-line-height-control.js`
- `client/features/template-editor/editor-text-toolbar-layout.js`
- `client/features/template-editor/generated-objects-config.js`
- `client/features/template-editor/object-alignment-command-runtime.js`
- `client/features/template-editor/object-alignment-controls.js`
- `client/features/template-editor/object-alignment-metrics.js`
- `client/features/template-editor/object-alignment-positioning.js`
- `client/features/template-editor/object-flow-reflow.js`
- `client/features/template-editor/object-multi-selection-overlays.js`
- `client/features/template-editor/object-pointer-controls.js`
- `client/features/template-editor/object-toolbar-ui.js`

### 신규 런타임: 1개

- `client/features/template-editor/text-editing.js`
