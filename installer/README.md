# Windows 배포 패키지

웹/API를 미리 빌드하고 전용 Node.js와 MariaDB를 포함합니다. 사용자 PC에서는 인터넷 연결,
Node.js/npm/Git 설치, DB 계정 입력, 소스 빌드 없이 사용할 수 있습니다.
Windows 10/11 **x64**를 대상으로 합니다. ARM64는 별도 검증 대상입니다.

## 배포 파일 만들기

개발 PC에서 기존 프로젝트 의존성을 준비한 뒤 프로젝트 루트에서 실행합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer/build.ps1
```

첫 빌드에는 인터넷이 필요합니다. 공식 배포 ZIP을 `cache`에 내려받고
`runtime-lock.json`에 기록한 SHA-256을 확인합니다. 빌드마다 검증된 ZIP을 다시 풉니다.
웹/API를 빌드하고 원본 npm lock으로 production 의존성만 설치합니다.
개발용 `.env`, 실제 DB, 로그, Git 정보는 패키지에 복사하지 않습니다.
웹 API 주소는 `/api/v1`, 프린터 모드는 `browser-print`로 고정하여 빌드합니다.

- `output/ExamCheck-0.1.0-win-x64.zip`: 전체를 압축 해제해 `stage/ExamCheck.cmd` 실행
- `output/ExamCheck-0.1.0-Setup.exe`: Inno Setup 컴파일러가 있으면 함께 생성
- `stage/`: 압축 전 배포 폴더, 그대로 다른 PC로 복사 가능

Inno Setup은 **설치 파일을 만드는 개발 PC에만** 필요합니다.
이번 패키지는 공식 Inno Setup 6.4.3으로 컴파일합니다. 프로젝트 내부
`cache/compiler/ISCC.exe`도 자동 검색하며, 컴파일러 자체는 사용자 배포 패키지에 포함하지 않습니다.
기본 위치에서 발견되지 않으면 컴파일러 경로를 지정합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer/build.ps1 -CompilerPath 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
```

설치 파일 없이 ZIP만 만들려면 `-SkipInstaller`를 지정합니다.
빌드는 `stage`를 새로 생성합니다. 사용자 데이터 저장 위치로 `stage`나 `cache`를 지정하지 마세요.

## 파일 구성

| 파일                     | 용도                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `build.ps1`              | 빌드, 운영 의존성 설치, 런타임 다운로드·검증, ZIP/EXE 생성    |
| `runtime-lock.json`      | 전용 런타임 버전·공식 URL·SHA-256 고정                        |
| `ExamCheck.iss`          | 사용자별 설치, 바로가기, 실행 중 업데이트·제거 차단           |
| `portable/ExamCheck.cmd` | 폴더형 실행 진입점                                            |
| `runtime/launcher.ps1`   | 처음 설정, 서버 관리 창, 백업·복원·로그                       |
| `runtime/server.mjs`     | DB 초기화·실행·마이그레이션, 웹 서버, 백업·복원, 종료         |
| `runtime/api.mjs`        | 기존 API 구성을 재사용하는 loopback 전용 실행 진입점          |
| `runtime/firewall.ps1`   | 선택한 경우에만 같은 서브넷에서 웹 접속 허용                  |
| `USER-GUIDE.txt`         | 사용자에게 함께 제공할 안내                                   |
| `smoke-test.ps1`         | 배포 폴더를 실제 실행해 새 DB·로그인·백업·복원·종료 검증      |
| `install-test.ps1`       | EXE 설치, 설치된 프로그램 실행 검증, 제거 후 데이터 보존 확인 |

## 데이터와 실행 정책

프로그램은 `%LOCALAPPDATA%\Programs\ExamCheck`, 데이터는 `%LOCALAPPDATA%\ExamCheck\data`에
보관합니다. 폴더형도 같은 데이터 위치를 사용합니다. 기존 개발 DB와 별도로 새 DB를 구성합니다.
기존 개발 DB의 자동 이전은 제공하지 않습니다.

실행 관리 창이 데이터 폴더 권한을 현재 사용자와 SYSTEM으로 제한합니다.
`settings.json`에는 전용 DB 비밀번호와 JWT 키가 있으므로 외부에 공유하지 마세요.
초기 계정 비밀번호는 계정 생성에 성공한 뒤 설정에서 제거합니다.
MariaDB는 서비스로 등록하지 않고 실행 관리 창과 함께 실행·종료합니다.
웹 기본 바인딩은 `127.0.0.1:5173`, API는 `127.0.0.1:3100`, DB는 `127.0.0.1:13316`입니다.
여러 PC 접속을 선택하면 웹만 `0.0.0.0`에 바인딩합니다.

초기 계정 `admin`/`가번호`/`dev`는 사용자가 정한 초기 비밀번호를 사용합니다.
동일 배포 재실행은 마이그레이션만 확인하며, 새로운 releaseId의 첫 실행은 DB 백업 후
마이그레이션합니다. DB 엔진 버전이 다른 패키지는 실행을 차단합니다.
MariaDB 엔진 업그레이드는 이 설치 도구의 자동 업데이트 범위에 포함하지 않습니다.
프로그램 제거는 사용자 DB와 백업을 삭제하지 않습니다.

백업은 InnoDB 일관된 SQL 덤프와 SHA-256 메타데이터를 ZIP으로 묶은 `.ecbackup` 파일입니다.
복원은 해당 파일을 검증하고 현재 DB를 자동 백업한 다음 DB 전체를 교체합니다.
브라우저에 저장된 PC별 프린터 선택은 백업 대상이 아닙니다.
복원 실패 시 서버 시작을 중단하고 로그와 복원 전 백업으로 복구합니다.

Node.js LICENSE와 MariaDB의 라이선스/배포 파일을 패키지에 포함합니다.
`drivers`의 Zebra 설치 파일도 포함되므로 외부 배포 시 해당 파일의 배포 조건을 확인하세요.
배포용 EXE 코드 서명은 별도 인증서가 필요한 후속 작업입니다.

## 검증

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer/smoke-test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer/install-test.ps1
```

테스트는 `installer/test-data` 아래 고유 폴더와 빈 로컬 포트를 사용합니다.
개발 `.env`와 기존 DB는 읽거나 변경하지 않습니다. 확인을 위해 테스트 자료는 남깁니다.
설치 테스트는 기존 ExamCheck 설치가 없는 계정에서만 실행합니다. 테스트 위치에 조용히 설치한 뒤
실행 검증과 제거까지 수행합니다. 수동 GUI 검수와 다른 노트북에서의 검증은 별도로 필요합니다.

2026-10-01 로컬 Windows 검증에서 production 빌드, 패키지 실행, 관리자 로그인,
백업 내용 복원, 재실행 시 데이터 유지, 새 releaseId 실행 전 자동 백업이 통과했습니다.
최종 EXE를 실제 설치한 폴더에서도 같은 검사가 통과했고, 제거 후 테스트 DB 보존을 확인했습니다.
PowerShell 구문 검사와 실행 관리 창에 사용하는 Windows 객체 생성도 확인했습니다.
처음 설정 화면·네트워크 접속·프린터의 수동 실기기 검수는 아직 수행하지 않았습니다.

2026-10-02 ExamList 최신 양식 편집기를 `1.1.13-examcheck.23`으로 반영해 ZIP과 EXE를 다시 생성했습니다.
새 패키지와 EXE 설치본 모두 서버 실행, 관리자 로그인, 백업·복원, 재실행 데이터 유지,
업데이트 전 자동 백업 검사를 통과했으며 제거 후 데이터 보존도 확인했습니다.
변경 및 검증 기록은 [양식 편집기 반영 기록](../docs/template-editor-sync-2026-10-02.md)에 있습니다.

공식 참고: [Node.js 배포](https://nodejs.org/dist/),
[MariaDB Windows ZIP](https://mariadb.com/docs/server/server-management/install-and-upgrade-mariadb/installing-mariadb/binary-packages/installing-mariadb-windows-zip-packages),
[Inno Setup](https://jrsoftware.org/isinfo.php).
