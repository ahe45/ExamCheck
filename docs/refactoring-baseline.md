# 리팩토링 기준선

> 수집일: 2026-08-27  
> 기준: 아직 최초 commit이 없는 현재 작업 디렉터리 snapshot  
> 운영 DB 제품·버전: MariaDB 11.4.10 (현재 로컬 연결 기준)

이 문서는 리팩토링 전 비교값을 보존하는 기준선이다. 아래에서 “초기”로 표시한 빌드·테스트
수치는 과거 측정값이며, 현재 구현 상태는 [리팩토링 진행 현황](./refactoring-status.md)을 함께
본다. 테스트 파일·개수와 bundle byte는 리팩토링 중 계속 변하므로 최종 병합 검증 시 명령 원문과
자동 측정 JSON을 별도 증거로 보존한다.

## 실행 환경

- OS: Microsoft Windows NT 10.0.26200.0
- Node.js: 24.14.0
- npm: 11.9.0
- workspace: npm workspaces (`apps/*`)

이 환경은 현재 측정값일 뿐 최종 운영 표준이 아니다. 운영 Node LTS, CI 플랫폼, DB 제품·major version은 별도 ADR로 확정한다.

현재 소스·테스트·CSS·migration 줄 수와 production build asset 크기는 `npm run metrics:baseline`으로
재현할 수 있다. 이 명령은 파일 내용이나 환경변수·DB를 읽지 않고 저장소 내 비민감 파일의 개수,
줄 수와 byte 크기만 JSON으로 출력한다. `setup/`, `node_modules`, coverage와 build cache는 소스
집계에서 제외하며 build 산출물이 없으면 해당 크기를 0으로 반환한다.

최종 병합 기준선은 다음 순서로 수집한다.

1. `npm run check`와 `npm run check:integration`을 끝낸다.
2. `npm run test:coverage`와 `npm run test:e2e` 결과를 보존한다.
3. 방금 생성한 production build를 대상으로 `npm run metrics:baseline`을 실행한다.
4. 출력 JSON의 `source`, `tests`, `styles`, `migrations`, `buildAssets`를 실행 시각·commit과 함께
   보존한다. 최초 commit 전에는 작업 디렉터리 snapshot이라고 명시한다.

## 현재 데이터베이스 기준선

| 항목                    | 측정값                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| 제품·버전               | MariaDB 11.4.10                                                                                              |
| 적용 migration          | 현재 로컬 재확인 26개 (`001`~`026`)                                                                          |
| DB charset/collation    | `utf8mb4` / `utf8mb4_unicode_ci`                                                                             |
| 서버 charset/collation  | `utf8mb4` / `utf8mb4_general_ci`                                                                             |
| SQL mode                | `IGNORE_SPACE, STRICT_TRANS_TABLES, ERROR_FOR_DIVISION_BY_ZERO, NO_AUTO_CREATE_USER, NO_ENGINE_SUBSTITUTION` |
| DB timezone             | `SYSTEM`                                                                                                     |
| 테이블                  | 17개, 모두 InnoDB                                                                                            |
| 데이터+인덱스 추정 크기 | 약 1.02MiB                                                                                                   |

값은 읽기 전용 질의로 수집했다. `SYSTEM` timezone의 실제 UTC offset, 운영 서버와 로컬 DB의 동일성, backup 보관 위치는 아직 확인이 필요하다. 향후 DB 동시성 테스트는 MySQL 대체 DB가 아니라 MariaDB 11.4 계열에서 수행한다.

## 자동 검증

| 명령                | 결과                                        |
| ------------------- | ------------------------------------------- |
| `npm run typecheck` | 성공                                        |
| `npm test`          | 초기 기준 성공: API 13개, Web 15개, 총 28개 |
| `npm run build`     | 성공, Web main chunk 크기 경고 존재         |

후속 안전성 배치별 대상 테스트와 typecheck는 통과했다. typed `AppConfig`, permission matrix,
공통 mutation audit와 request correlation, 공통 grid, 편집기 bundle 경계, 합성 identity 전환 도구,
N-1 migration upgrade harness가 합쳐진 2026-08-28 최종 로컬 snapshot에서는 `npm run check`가
통과했다. API 67 files/463 tests, Web 59 files/193 tests가 통과했고 production build도 성공했다.
source map을 반영한 `npm run test:coverage` 결과는 API statements/lines 86.88%, branches 82.02%,
functions 87.65%, Web statements/lines 63.96%, branches 77.25%, functions 63.79%다. 이 값은 최초
commit 전 snapshot 기준이며 이후 변경 시 다시 측정한다.

별도 `npm run check:integration`은 코드가 생성한 임시 MariaDB에서 `001`~`026` 전체
migration 적용·재실행·체크섬 검증, 서버 advisory lock, 실제 두 connection의 운영 경합,
설정 cursor·범위 rollback, 번호 정책·세션·업로드·인쇄 멱등성 시나리오를 검증한다. 최종 로컬
snapshot에서 10 files/37 tests가 통과했다. 실제 MariaDB DDL의 첫 문장은 적용되고 후속 문장은
실패하는 합성 migration으로 부분 컬럼과 `FAILED` metadata가 남으며 다음 실행이 차단되는지도
확인한다. harness는
특정 migration까지만 구성할 수 있고 N-1(`025`)의 기존 인쇄 작업을 유지한 채 latest(`026`)로
올린 뒤 재실행하는 시나리오도 포함한다. 테스트가 만든 `examcheck_it_` 데이터베이스만 정리하며
종료 후 잔존 여부를 다시 검사한다.

현재 API는 candidates, accounts, pseudonyms의 application/use-case와 repository 경계를 분리했다.
업무 service의 직접 SQL과 repository의 transaction 소유가 다시 생기지 않도록 source 기반
architecture 회귀 테스트를 실행한다. HTTP 검사는 운영과 동일한 prefix·CORS·ValidationPipe와
실제 DTO metadata를 사용하며, 수험생 업로드·가번호 설정/부여·양식·출력의 역할별 업무 경계까지
포함한다. Web 라벨 출력은 첫 `createPrintJob`이 대기 중일 때 동기 ref guard로 중복 생성을 막는
테스트가 있다. 다만 전체 운영 DB 원본, 운영 proxy·다중 인스턴스, 승인된 golden 이미지 비교,
GT800 실기기는 아직 보증하지 않는다. 따라서 운영 안정성 전체의 증거로 과장하지 않는다.

## 실제 브라우저 재검수

3차 배치 서버 재시작 후 관리자와 사용자 화면을 FHD/QHD에서 수동 확인한 과거 증거는 다음과 같다.

| 화면        | FHD 1920×1080                                    | QHD 2560×1440                                    |
| ----------- | ------------------------------------------------ | ------------------------------------------------ |
| 사용자 운영 | 문서 1920×1080, 가로 overflow 0, 제어 패널 516px | 문서 2560×1440, 가로 overflow 0, 제어 패널 815px |
| 관리자      | 문서 1920×1080, 가로 overflow 0                  | 문서 2560×1440, 가로 overflow 0                  |

QHD 사용자 화면에서 핵심 글자 크기도 FHD 대비 확대됐다. 헤더 데이터는 14.16px→17.5px,
수험번호 입력은 27.24px→34px, 그리드·통계는 12px→15px이었다. 관리자 로그인·대시보드·시스템
설정 카드·전형 설정 모달과 사용자 교시 선택·운영 화면을 확인했으며 당시 브라우저 warning/error는
0건이었다.

이후 자동 브라우저 matrix는 HD(1366×768), HD+(1600×900), FHD(1920×1080), QHD(2560×1440)의
네 프로젝트로 확장했다. 작은 두 해상도는 핵심 요소 가시성과 가로 overflow를, FHD/QHD는 세로
overflow와 반응형 확대 하한까지 검사한다. 역할별 12개 smoke에 FHD 변경 workflow 5개를 더한
17개 시나리오가 구성되어 있고, 매 실행마다 nonce DB·동적 API/Web 포트·runner 소유 PID 정리를
사용한다. 2026-08-28 최종 로컬 실행에서 17/17이 통과했고 테스트 서버 정상 종료와 nonce DB 잔존
0건을 확인했다. 이 구성은 승인된 golden 이미지 비교를 대신하지 않는다.

## Web production build 초기 기준

| 파일              |      Raw |     Gzip |
| ----------------- | -------: | -------: |
| main JS           | 938.46kB | 246.47kB |
| CSS               | 308.19kB |  44.89kB |
| jsPDF chunk       | 390.27kB | 128.73kB |
| html2canvas chunk | 202.36kB |  48.04kB |

위 표는 초기 snapshot 값이다. 이후 route lazy load, 사용자 운영 화면 component/controller 분리,
기능별 CSS 진입점 분리, 양식 편집기 UI/CSS lazy 진입점, PDF 포맷팅의
`examlist-template-editor/core` import 분리를 적용했다. main/운영 route가 편집기 본체를 정적 import하지
않는 경계 테스트가 있다. 현재 exact asset 크기는 production build 직후 `npm run metrics:baseline`이
출력한 asset 값을 사용한다. 2026-08-28 snapshot의 main JS는 282,610B, 운영 JS는 57,086B,
편집기 lazy JS는 569,761B다. 편집기 lazy chunk의 500kB 경고는 남아 있으나 일반 route의 초기
bundle에는 포함되지 않는 경계 테스트가 통과했다.

## 최종 로컬 메트릭 snapshot

2026-08-28 `npm run metrics:baseline` 결과는 다음과 같다.

| 구분       | 파일 |  줄 수 |    byte |
| ---------- | ---: | -----: | ------: |
| API 소스   |  115 | 10,705 | 383,709 |
| Web 소스   |   89 |  9,959 | 342,953 |
| API 테스트 |   77 | 11,791 | 449,262 |
| Web 테스트 |   49 |  4,659 | 169,523 |
| CSS        |   11 |  9,301 | 199,147 |
| migration  |   26 |    608 |  30,025 |

전체 API build는 565,271B, Web build는 2,145,107B다. 이 수치는 성능 우열 자체가 아니라 이후
회귀를 비교하기 위한 재현 가능한 기준선이다.

## 주요 복잡도 집중 지점

- 번호 유일 정책은 개발자 메뉴·저장 전 충돌 검사·DB 제약이 연결됐지만 목표
  `candidate/registration/schedule` identity와 027+ migration은 외부 결정 이후 별도 전환이 필요
- 수험생 업로드는 application/repository/domain 경계를 분리했지만 대용량 XLSX·사진 ZIP의
  streaming·메모리 상한은 운영 용량 기준 검증이 필요
- 사용자 운영 화면은 page/controller/modal/component로 분리했고 자동추첨 timer/countdown과
  사진 request/object URL 생명주기도 별도 hook으로 이동했다. 남은 lookup/assignment orchestration은
  계속 관찰 대상
- 양식 편집기 본체와 core 포맷팅의 bundle 경계는 분리했지만 목록·metadata·편집기 lifecycle과
  PDF projection의 장기 호환 정책은 계속 관리 대상
- 전역 CSS 진입점은 기능별 파일로 분리했지만 큰 feature stylesheet의 cascade 회귀 검증은 계속 필요

## 저장소 상태

- 정상적인 최초 기준 commit이 없음
- 대부분 파일이 미추적 상태
- `setup/`은 분석용 로컬 레거시 자산이며 `.gitignore`로 제외
- DB backup/restore rehearsal은 아직 필요
- 기준 commit과 `baseline-before-refactor` tag는 민감 자산 확인 후 생성
- backup/restore와 migration 절차서는 `docs/runbooks/`에 있지만 승인된 backup 위치에서 실행한
  결과나 운영 cutover 증거는 아님

## 최초 배치 Go 조건

1. `setup/`과 실제 `.env`가 source commit 대상에서 제외됨
2. P0 수정마다 실패 재현 또는 최소 regression test가 존재함
3. 실제 운영 DB를 직접 테스트 대상으로 사용하지 않음
4. typecheck, 기존 테스트, build가 계속 성공함
5. UI 변경은 실제 브라우저에서 FHD/QHD 또는 영향 화면을 검수함
