@echo off
setlocal
cd /d "%~dp0"

set "__UPDATE_LOG=%~dp0log\update-server.log"
set "__BRANCH="
set "__HAS_LOCAL_CHANGES=0"
if not exist "%~dp0log" mkdir "%~dp0log"
if not exist "%~dp0log" goto FAILED
echo ExamCheck update: %DATE% %TIME%> "%__UPDATE_LOG%"

echo Updating ExamCheck from the current branch's upstream.
echo Stop the running server with Ctrl+C before applying this update.
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo Git was not found. Install Git for Windows first.
  goto FAILED
)
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
  echo Configure .env with start-server.bat before applying updates.
  goto FAILED
)
if not exist "%~dp0.git" (
  echo This folder is not a Git clone. Install it with git clone first.
  goto FAILED
)

git status --porcelain -uno >nul 2>> "%__UPDATE_LOG%"
if errorlevel 1 goto FAILED
for /f "delims=" %%S in ('git status --porcelain -uno 2^>nul') do set "__HAS_LOCAL_CHANGES=1"
if "%__HAS_LOCAL_CHANGES%"=="1" (
  echo Tracked project files have local changes. Update stopped to preserve your files.
  git status --short --untracked-files=no
  echo Commit or stash your changes before running this file again.
  goto FAILED
)
for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "__BRANCH=%%B"
if not defined __BRANCH (
  echo No branch is checked out. Check out a branch before updating.
  goto FAILED
)
git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" >> "%__UPDATE_LOG%" 2>&1
if errorlevel 1 (
  echo The current branch needs a remote tracking branch before updating.
  goto FAILED
)

echo Pulling latest changes...
rem Git preserves untracked files and stops if an incoming file would overwrite one.
git pull --ff-only >> "%__UPDATE_LOG%" 2>&1
if errorlevel 1 goto FAILED

echo Installing dependencies...
call npm ci --include=dev >> "%__UPDATE_LOG%" 2>&1
if errorlevel 1 goto FAILED

echo Building API and web...
call npm run build >> "%__UPDATE_LOG%" 2>&1
if errorlevel 1 goto FAILED

echo Updating database schema...
call npm run db:migrate >> "%__UPDATE_LOG%" 2>&1
if errorlevel 1 goto FAILED

echo.
echo ExamCheck update completed. Run start-server.bat to start the server.
echo Log: %__UPDATE_LOG%
pause
exit /b 0

:FAILED
echo.
if exist "%__UPDATE_LOG%" (
  echo Update log:
  type "%__UPDATE_LOG%"
  echo.
)
echo ExamCheck update stopped. Check the message above and the log file:
echo   %__UPDATE_LOG%
pause
exit /b 1
