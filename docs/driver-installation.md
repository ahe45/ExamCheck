# Zebra GT800 Windows 드라이버 설치

## 공식 배포 정보

- 제품: Zebra GT800
- 드라이버: ZDesigner Windows Printer Driver v5
- 버전: 5.1.17.7415
- 프로젝트 파일명: `zd51177415-certified.exe`
- 공식 표시 크기: 14 MB
- 다운로드: 사용자 운영 화면의 **설정 → 프린터 설정 → Windows 드라이버 다운로드** 버튼
- 공식 제품 지원: <https://www.zebra.com/us/en/support-downloads/printers/desktop/gt800.html>
- 공식 드라이버 안내: <https://www.zebra.com/us/en/support-downloads/software/printer-software/zebra-designer-3-downloads.html>

Browser Print 설치 파일도 같은 **프린터 설정** 화면의 **Browser Print 다운로드** 버튼으로 받을 수
있습니다. 프로젝트 파일명은 `zebra-browser-print-windows-v132489.exe`이며 1.3.2 계열입니다. Zebra
공식 지원 페이지는 Windows·macOS의 USB/네트워크 연결을 지원한다고 안내하지만 다운로드는 요청
양식을 통한 접근 방식입니다. 따라서 파일의 Zebra 서명이 유효하더라도 시스템에서 설치 파일을
재배포할 권한은 별도로 확인해야 합니다.

- Browser Print 공식 지원·요청 다운로드:
  <https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html>
- Browser Print 1.3.2 공식 사용자 안내서:
  <https://www.zebra.com/content/dam/support-dam/en/documentation/unrestricted/guide/software/zebra-browser-print-user-guide-v1-3-2-en-us.pdf>

두 프로젝트 설치 파일은 2026-08-28 Windows Authenticode 검사에서 모두 `Valid`, 서명자
`Zebra Technologies Corporation`으로 확인됐다. 체크섬과 상세 상태는
[`legacy-inventory.md`](./legacy-inventory.md)에 기록한다. GT800은 공식 제품 지원 페이지 기준 판매
종료 2020-01-31, 서비스·지원 종료 2023-03-31 상태이므로 실제 Windows 환경과 장비 조합은 현장
검증이 필요하다.

## 설치 순서

1. GT800 USB 케이블을 PC에서 분리합니다.
2. 라벨 출력을 사용하는 교시의 운영 화면에서 **설정 → 프린터 설정**을 열고 **Windows 드라이버 다운로드** 버튼을 누릅니다.
3. 내려받은 `zd51177415-certified.exe`를 관리자 권한으로 실행합니다.
4. 설치 마법사의 안내 시 GT800 전원을 켜고 USB를 연결합니다.
5. Windows 프린터 설정 또는 Zebra Setup Utilities에서 테스트 페이지를 출력합니다.
6. **Browser Print 다운로드** 버튼으로 설치 파일을 받고 관리자 권한으로 설치합니다.
7. Zebra Browser Print를 실행하고 **프린터 설정** 화면에서 설치 상태를 다시 확인합니다.
