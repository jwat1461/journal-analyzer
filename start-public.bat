@echo off
cd /d "%~dp0"
title AI Recovery Tracker - Public Web Access

echo ==============================================
echo  AI Recovery Tracker - Public Web Access
echo ==============================================
echo.

:: Confirm cloudflared is available
if not exist "%~dp0cloudflared.exe" (
  echo ERROR: cloudflared.exe not found in the app folder.
  echo Download it from: https://github.com/cloudflare/cloudflared/releases
  pause
  exit /b 1
)

:: Start Node.js server in a background window
echo [1/2] Starting server on port 3001...
start "Recovery Tracker Server" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul

:: Start Cloudflare tunnel — prints the public URL to this window
echo [2/2] Opening Cloudflare tunnel...
echo.
echo  Your public HTTPS URL will appear below:
echo  (looks like https://xxxx-xxxx-xxxx.trycloudflare.com)
echo.
echo  Share this URL to access the app from anywhere.
echo  The URL changes each time you restart — for a permanent URL
echo  see HOSTING.md for instructions on setting up a named tunnel.
echo.
echo  Press Ctrl+C to stop the tunnel and shut down public access.
echo ==============================================
echo.

"%~dp0cloudflared.exe" tunnel --url http://localhost:3001 --no-autoupdate
