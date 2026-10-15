@echo off
REM Starts DisGourd. On first run it sets itself up automatically.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Please install the LTS version from https://nodejs.org, then run setup.bat.
  echo.
  pause
  exit /b 1
)

REM Server dependencies live in server\node_modules (the repo root has none), so
REM run setup if they're missing too, not only when the web build is.
set NEEDS_SETUP=
if not exist "web\dist\index.html" set NEEDS_SETUP=1
if not exist "server\node_modules\ws" set NEEDS_SETUP=1
if defined NEEDS_SETUP (
  echo.
  echo   First run — installing dependencies and building the app...
  echo.
  call npm run setup
  if errorlevel 1 (
    echo.
    echo   Setup failed. Please check the messages above.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo   Starting DisGourd — open http://localhost:3000 in your browser.
echo   (Keep this window open. Press Ctrl+C to stop the server.)
echo.
call npm start
pause
