# 양식 편집기 구조 개선 기준

## 목표

양식 편집기의 저장 원본, 활성 편집 대상, 임시 UI를 분리한다. 기존 양식 JSON과 PDF 출력 결과는 유지하면서 DOM 직접 변경과 재동기화 루프를 단계적으로 제거한다.

## 완료 불변조건

1. 편집 명령은 문서 또는 명시적인 하위 편집 세션 하나만 대상으로 한다.
2. 선택 핸들, 오버레이, 삽입 패널, 모달은 저장 HTML에 포함되지 않는다.
3. 데이터블록 편집 중 상위 문서는 다시 마운트되거나 교체되지 않는다.
4. 데이터블록 변경은 모달 종료 시 하나의 문서 커밋으로 합쳐진다.
5. 표·이미지·바코드·QR·데이터블록은 동일한 이동·크기 조절 좌표 규칙을 사용한다.
6. 저장 여부와 실행 취소 이력은 명령 트랜잭션을 기준으로 계산한다.
7. ExamList 원본, examcheck vendor, 배포 패키지 사이에 편집 로직의 중복 구현을 남기지 않는다.
8. 기존 저장 양식은 별도의 사용자 조작 없이 계속 열리고 출력된다.

## 최종 경계

- React 작업공간: `TemplateEditorWorkspace.tsx`
- 패키지 연결: `editor/examlist-template-editor-adapter.ts`
- 배포 편집기: `vendor/examlist-template-editor-1.1.0.tgz`
- 데이터블록 연결: `enhance-template-data-block.ts`
- 트랜잭션 경계: `editor/template-editor-transaction-coordinator.ts`
- 명령 경계: `editor/template-editor-command-dispatcher.ts`
- 저장 직렬화 경계: `editor/template-editor-serialization.ts`
- 편집기 원본: `../ExamList/client`
- 패키지 생성: `../ExamList/portable-template-editor/scripts/build-examlist-extensions.js`
- 저장 원본: 페이지 설정의 `documentHtml`과 `candidateBlockGrid`

`apps/web/src/vendor/examlist-data-block`의 중복 소스는 제거했으며, 앱은 패키지 서브경로만 사용한다.

## 단계별 게이트

각 단계는 구현, 관련 테스트, 전체 웹 테스트, 타입 검사, 빌드 검사를 통과한 뒤 완료한다. 동작 변경이 있는 단계는 실제 브라우저에서 편집·저장·새로고침까지 확인한다.

내부 문서 스키마 버전은 사용자에게 표시하는 양식 버전과 별개로 관리한다. 이는 과거 양식을 안전하게 읽기 위한 기술 메타데이터이며 사용자용 버전 관리 기능을 다시 도입하지 않는다.

## 완료 검증

- ExamList 패키지 테스트 99개, 타입 검사, 원본 동기화 검사 통과
- examcheck 웹 테스트 269개, 타입 검사, 린트, 포맷 검사, 프로덕션 빌드 통과
- 1920×1080 실제 브라우저에서 데이터블록 모달 취소·적용, 표 삽입, 8개 크기 조절 핸들, 이동 핸들, 저장 활성화 흐름 반복 통과
