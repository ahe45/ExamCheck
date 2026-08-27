# 브라우저 회귀 검수 기준

> 자동화 기준일: 2026-08-28

## 자동 시나리오

`npm run test:e2e`는 Playwright가 관리하는 번들 Chromium에서 역할별 읽기 전용 smoke 12개,
FHD 변경 workflow 5개, 공식 visual 18개를 합친 총 35개 시나리오를 순차 검증한다.

### 역할별 읽기 전용 smoke — 12개

| 해상도             | 관리자   | 개발자                | 사용자                 |
| ------------------ | -------- | --------------------- | ---------------------- |
| 1366×768 (HD)      | 대시보드 | 개발자 번호 유일 정책 | 교시 선택 후 운영 화면 |
| 1600×900 (HD Plus) | 대시보드 | 개발자 번호 유일 정책 | 교시 선택 후 운영 화면 |
| 1920×1080 (FHD)    | 대시보드 | 개발자 번호 유일 정책 | 교시 선택 후 운영 화면 |
| 2560×1440 (QHD)    | 대시보드 | 개발자 번호 유일 정책 | 교시 선택 후 운영 화면 |

각 역할 smoke는 다음을 공통으로 확인한다.

- 계정별 로그인과 허용 route 진입
- 핵심 제목·메뉴·버튼 표시
- viewport보다 넓은 가로 overflow 없음
- 모든 화면의 가로 overflow 없음
- 사용자 운영 화면은 FHD 이상에서 페이지·좌측 패널의 불필요한 세로 overflow 없음. 더 작은 두
  해상도는 필요한 영역의 세로 스크롤을 허용
- QHD에서 좌측 제어 패널과 수험번호 입력 글꼴이 FHD 기준보다 확대되는 최소값 유지
- 웹 폰트 로딩 완료 후 화면 캡처 첨부
- axe WCAG 2.0/2.1/2.2 A·AA 위반 0건

역할 smoke는 설정 저장, 가번호 부여, 마감, 출력 같은 상태 변경을 수행하지 않는다.

### FHD 변경 workflow — 5개

1920×1080 전용 `workflow-fhd` 프로젝트는 격리 fixture를 대상으로 다음 흐름을 검증한다.

1. 잘못된 XLSX 양식 오류를 업로드 미리보기 영역에 표시
2. 계정 생성·수정·비활성화
3. 전형 설정 변경의 취소·저장 안 함·저장
4. 개발자 번호 유일 정책 저장과 재조회
5. 교시 확인·순차 가번호 부여·등록 완료(마감) 후 추가 부여 차단·인쇄 활성화

각 mutation 시나리오는 전용 reset command로 fixture를 복구한다. 이 흐름은 운영 DB나 `.env`의
`DB_NAME`을 사용하지 않는다.

### FHD/QHD 공식 visual — 18개

공식 visual은 아래 9개 화면을 FHD와 QHD에서 각각 한 번씩 비교한다.

| 구분   | 화면                               |
| ------ | ---------------------------------- |
| 공통   | 로그인                             |
| 관리자 | 대시보드, 수험생 데이터, 양식 관리 |
| 관리자 | 시스템 설정, 계정 관리             |
| 개발자 | 개발자 설정                        |
| 사용자 | 교시 선택, 운영 콘솔               |

FHD 1920×1080과 QHD 2560×1440은 모니터 전체나 브라우저 창 외곽 크기가 아니라 Playwright가
브라우저 탭·주소창·창 테두리를 제외하고 페이지에 제공하는 **CSS viewport** 크기다. 따라서 실제
브라우저 UI를 포함한 데스크톱 캡처와 픽셀 크기를 직접 비교하지 않는다.

시각 비교는 다음 조건을 고정한다.

- Playwright 버전에 대응하는 번들 Chromium과 `deviceScaleFactor: 1`
- 로컬 패키지로 고정한 Fontsource의 DM Sans/Noto Sans KR 가변 글꼴
- `ko-KR`, `Asia/Seoul`, light color scheme과 reduced motion
- 화면별 명시적 준비 조건, 글꼴 준비, 최상단 scroll, focus·caret·animation 정규화
- visual FHD/QHD 프로젝트의 재시도 0회
- Windows(`win32`)와 Linux 기준 이미지 디렉터리 분리

CI의 공식 비교 환경은 Ubuntu 24.04다. 운영체제별 글꼴 rasterization과 native control 차이를
허용값으로 뭉개지 않도록 Linux CI는 Linux 기준 이미지만, Windows 로컬 검수는 Windows 기준
이미지만 사용한다.

### 실행 격리와 현재 확인 상태

- runner는 매 실행마다 `examcheck_e2e_<32자리 nonce>` DB를 생성하고 migration·seed를 적용한다.
- API와 Web은 고정 포트나 이미 실행 중인 개발 서버를 재사용하지 않고, loopback의 사용 가능한
  동적 포트를 각각 선택한다.
- runner가 직접 시작한 API/Web child process만 추적하며 정상 종료 후에도 남아 있으면 정확한 PID의
  process tree만 종료한다. 임의 포트 점유 프로세스나 다른 개발 서버를 종료 대상으로 삼지 않는다.
- 성공·실패 모두에서 소유 DB 이름·현재 연결 DB·migration 기준을 재검증한 뒤 해당 nonce DB만
  삭제하고 잔존 여부를 확인한다.

전체 `test:e2e`는 12개 viewport smoke, 5개 mutation workflow, 18개 visual을 합친 35개로
구성된다. QHD 사용자 화면의 좌측 패널 overflow와 반응형 확대 하한은 구조 assertion으로도 계속
검사하며, 공식 visual은 승인된 운영체제별 기준 이미지와 pixel diff로 별도 확인한다.

## 실행

```text
npm run test:e2e:list
npm run test:e2e
npm run test:e2e:smoke
npm run test:visual
npm run test:visual:update
```

`npm run test:e2e:smoke`는 visual을 제외한 기존 17개 smoke/workflow를, `npm run test:visual`은
9개 화면×FHD/QHD의 공식 기준 이미지 18개만 비교한다. 실패 화면, diff, trace, 접근성 상세는
`test-results/`에 생성되며 Git에는 포함하지 않는다.

`npm run test:visual:update`는 UI 변경을 실제 FHD/QHD 결과로 육안 검수하고 새 기준 이미지가
의도한 디자인임을 명시적으로 승인한 뒤에만 로컬에서 실행한다. 생성된 Windows/Linux 기준
이미지는 서로 대체하지 않으며, 변경된 PNG를 코드 변경과 함께 검토한다. CI는 항상
`npm run test:visual`만 실행하고 `--update-snapshots` 또는 `test:visual:update`를 호출하지 않는다.
즉 CI 실패를 통과시키기 위해 기준 이미지를 자동 갱신하는 경로는 없다.

`.github/workflows/ci.yml`은 Ubuntu 24.04에서 격리 DB migration·seed를 사용하는 browser smoke와
visual regression을 별도 작업으로 실행한다. 두 작업 모두 번들 Chromium을 설치하며, visual
regression 작업은 저장소의 Linux 기준 이미지를 읽기 전용으로 비교한다.

Zebra Browser Print adapter는 fake SDK 단위 테스트로 스크립트 로드, 기본 프린터 조회, 프린터
목록 조회, 데이터 전송의 성공·timeout·늦은 callback·중복 callback 처리를 검증한다. 이 검증은
타이머 정리와 늦은 응답 무시를 확인하지만 Windows 드라이버 설치, Browser Print service,
USB GT800의 물리 출력 성공을 대신하지 않는다.

## 수동 검수

자동 검수 통과 후 사용자에게 전달하기 전 최소한 다음을 실제 브라우저에서 확인한다.

- 한글 문구의 부자연스러운 줄바꿈, 카드·패널 배경 겹침 없음
- FHD에서 불필요한 페이지 세로 스크롤 없음
- QHD에서 운영 제어 패널과 글꼴이 화면 크기에 맞게 확장됨
- 모달 ESC 종료, 최초 포커스와 닫힌 뒤 포커스 복귀
- 키보드로 메뉴, 그리드 필터, 클릭 가능한 행 사용 가능
- `prefers-reduced-motion`에서 추첨 대체 동작

1600×900 및 1366×768은 FHD보다 작은 환경이므로 위 자동 smoke에서 가로 overflow와 핵심 기능
접근성을 검증하되, 필요한 grid/panel의 세로 스크롤은 허용한다. 실제 Zebra GT800 출력 성공,
드라이버·Browser Print 재배포 승인, PC별 워크스테이션 코드 배포는 브라우저 자동화가 아니라
별도 운영·하드웨어 release gate다.
