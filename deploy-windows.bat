@echo off
setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo  WTC FUTURES - NETLIFY DEPLOY
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed or is not on PATH.
  echo Install the current LTS version of Node.js, then run this file again.
  pause
  exit /b 1
)

echo [1/3] Installing project dependencies...
call npm install
if errorlevel 1 goto :fail

echo.
echo [2/3] Linking to the existing Netlify project...
call npx -y netlify-cli@latest link --id 8e525588-b977-4c0b-8f61-f4374eaa8e71
if errorlevel 1 goto :fail

echo.
echo [3/3] Deploying production site...
call npx -y netlify-cli@latest deploy --prod
if errorlevel 1 goto :fail

echo.
echo ========================================
echo  DEPLOY COMPLETE
echo  https://wtc-futes.netlify.app/
echo ========================================
echo.
echo Open the site, enable push, and press SERVER TEST.
pause
exit /b 0

:fail
echo.
echo Deployment stopped because a command failed.
echo Copy the error shown above back into ChatGPT and we can fix it.
pause
exit /b 1
