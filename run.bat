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

if not exist "web\dist\index.html" (
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
