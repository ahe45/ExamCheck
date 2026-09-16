@echo off
setlocal
cd /d "%~dp0"

set "__START_LOG=%~dp0log\start-server.log"
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

if not exist "%~dp0.env" (
  if not exist "%~dp0.env.example" goto FAILED
  copy /y "%~dp0.env.example" "%~dp0.env" >nul
  echo Configure the database connection in .env, then run this file again.
  echo The database server must already be installed and running.
  goto FAILED
)

if exist "%~dp0node_modules\.bin\concurrently.cmd" if exist "%~dp0node_modules\.bin\tsx.cmd" if exist "%~dp0node_modules\.bin\vite.cmd" goto PREPARE_DATABASE
echo Installing dependencies...
call npm ci --include=dev >> "%__START_LOG%" 2>&1
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
echo ExamCheck startup stopped. Check the message above and the log file:
echo   %__START_LOG%
pause
exit /b 1
