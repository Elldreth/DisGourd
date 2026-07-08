@echo off
REM Updates DisGourd to the latest version: pulls new code, installs any new
REM dependencies, and rebuilds the web app. Run this whenever you want to update,
REM then start DisGourd again with run.bat.
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Git is not installed, so this script can't pull updates.
  echo   Install Git from https://git-scm.com, or replace the files manually and run setup.bat.
  echo.
  pause
  exit /b 1
)

if not exist ".git" (
  echo.
  echo   This folder isn't a git checkout, so there's nothing to pull.
  echo   If you downloaded a ZIP, replace the files with the new version and run setup.bat.
  echo.
  pause
  exit /b 1
)

echo.
echo   Pulling the latest code...
echo.
git pull
if errorlevel 1 (
  echo.
  echo   Could not pull updates. If you have local changes, commit or stash them first,
  echo   then run update.bat again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Installing dependencies and rebuilding the app...
echo.
call npm run setup
if errorlevel 1 (
  echo.
  echo   Update failed while building. Please check the messages above.
  echo.
  pause
  exit /b 1
)

echo.
echo   Update complete.
echo   Start DisGourd with run.bat. If the server is still running, stop it
echo   (Ctrl+C in its window) and start it again so the update takes effect.
echo.
pause
