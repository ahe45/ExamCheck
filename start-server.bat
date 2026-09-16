@echo off
setlocal
cd /d "%~dp0"

set "__START_LOG=%~dp0log\start-server.log"
set "__SETUP_REQUIRED=0"
if /i "%~1"=="--setup" set "__SETUP_REQUIRED=1"
if not exist "%~dp0.env" set "__SETUP_REQUIRED=1"
if not exist "%~dp0log" mkdir "%~dp0log"
if not exist "%~dp0log" goto FAILED
echo ExamCheck startup: %DATE% %TIME%> "%__START_LOG%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 or 24 LTS first.
  goto FAILED
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js with npm first.
  goto FAILED
)

if exist "%~dp0node_modules\.bin\concurrently.cmd" if exist "%~dp0node_modules\.bin\tsx.cmd" if exist "%~dp0node_modules\.bin\vite.cmd" goto CHECK_SETTINGS
echo Installing dependencies...
call npm ci --include=dev >> "%__START_LOG%" 2>&1
if errorlevel 1 goto FAILED

:CHECK_SETTINGS
if "%__SETUP_REQUIRED%"=="1" goto RUN_SETUP
node tools\windows-env.mjs check >> "%__START_LOG%" 2>&1
if errorlevel 2 goto RUN_SETUP
if errorlevel 1 goto FAILED
goto PREPARE_DATABASE

:RUN_SETUP
where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo Windows PowerShell was not found. It is required for initial setup.
  goto FAILED
)
echo Configuring ExamCheck database access...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\setup-windows.ps1"
if errorlevel 1 goto FAILED

:PREPARE_DATABASE
echo Preparing database schema and missing initial accounts...
call npm run db:setup >> "%__START_LOG%" 2>&1
if errorlevel 1 goto FAILED

echo.
echo Starting ExamCheck web and API servers...
echo Web: http://localhost:5173
echo API default: http://localhost:3100/api/v1/health
echo Keep this window open. Press Ctrl+C to stop both servers.
echo.
call npm run dev -- --kill-others
set "__SERVER_EXIT=%ERRORLEVEL%"
echo Server process exited with code %__SERVER_EXIT%.>> "%__START_LOG%"
echo.
echo Server process exited.
pause
exit /b %__SERVER_EXIT%

:FAILED
echo.
if exist "%__START_LOG%" (
  echo Startup log:
  type "%__START_LOG%"
  echo.
)
echo ExamCheck startup stopped. Check the message above and the log file:
echo   %__START_LOG%
echo To enter database settings again, run start-server.bat --setup
pause
exit /b 1
