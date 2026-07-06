@echo off
REM DisGourd one-time setup: installs dependencies and builds the web client.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Please install the LTS version from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Setting up DisGourd — installing dependencies and building the app.
echo   This can take a few minutes the first time...
echo.
call npm run setup
if errorlevel 1 (
  echo.
  echo   Setup failed. Please check the messages above.
  echo.
  pause
  exit /b 1
)

echo.
echo   Setup complete! Double-click run.bat to start DisGourd.
echo.
pause
