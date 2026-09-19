# Quality Gate 유지보수

## 검사 범위

- `static-and-unit`: 코드 형식, 린트, 타입, 단위 테스트와 빌드.
- `integration`: 격리된 MariaDB 통합 테스트와 API/Web 커버리지.
- `browser-smoke`: 실제 브라우저의 주요 사용자 흐름.
- `visual-regression`: Linux Chromium에서 FHD/QHD 화면 기준 비교.

## 편집기 동기화 회귀 검사

`canvas-object-runtime.integration.test.ts`는 같은 표를 20회 동기화할 때
흐름 위치 예약 요소가 유지되고, 제거·재생성되지 않으며, 저장 HTML에 섞이지 않는지 검사한다.
중간에 새 요소를 만들었다가 없애는 경우도 MutationObserver로 검출한다.
jsdom 실행 시간은 CI 부하와 커버리지 계측에 영향을 받으므로 이 기능 검사에
고정된 2.5초 성능 기준을 적용하지 않는다.

## API 커버리지 범위

전역 통과 기준은 lines/statements 84.9%, branches 81.9%, functions 86%를 유지한다.
설정 및 번호 유일 정책의 별도 기준도 유지한다.

041번 마이그레이션은 예전 target identity 전환용 테이블을 삭제했다.
`resolveIdentityTransitionConfig`는 환경변수와 무관하게 전환을 비활성화하며,
현재 지원하는 DB에는 이 전환용 투영·backfill·검증·승인 도구를 실행할 수 없다.
따라서 `apps/api/vitest.config.ts`에 해당 도구 파일만 명시적으로 제외한다.
파일의 단위 테스트 자체는 계속 실행한다. 실제 운영에서 쓰는 읽기/쓰기 라우터,
비활성화 보호, 정규화 및 가번호 표시 함수는 계속 측정한다.
전환 기능을 다시 도입한다면 DB와 테스트를 복원하면서 이 제외 목록도 제거해야 한다.

## 화면 기준 갱신

화면 변경을 승인한 경우에만 기준 이미지를 갱신한다. 차이 허용치를 높이거나
일반 CI 실행에서 자동으로 기준을 덮어쓰지 않는다.

1. 로컬 Windows 기준은 `npm run test:visual:update`로 생성하고 화면을 검토한다.
2. GitHub Actions의 **Quality Gate → Run workflow**에서 해당 브랜치를 선택하고
   `refresh_visual_baselines`를 켠다.
3. 작업은 Linux 기준 이미지를 생성한 다음, 새 DB와 브라우저로 다시 비교해
   시각 검사의 재현성을 확인한다. 다른 품질 검사는 일반 push 실행에서 수행한다.
4. 성공한 작업의 `linux-visual-baselines-for-review` 산출물을 내려받아 검토한 후
   `e2e/visual-baselines/linux/`에 반영하고 커밋한다. 작업이 자동으로 커밋하지는 않는다.
5. 일반 Quality Gate 실행에서 네 가지 검사가 모두 통과하는지 확인한다.

변동되는 갱신 시각만 `e2e/visual-snapshot.css`에서 숨긴다. 레이아웃, 주요 문구,
양식 이름 및 응시·결시 버튼은 비교 대상에 유지한다. 마우스 위치와 포커스를
정리해 의도하지 않은 hover 팝오버가 기준 이미지에 포함되지 않게 한다.
