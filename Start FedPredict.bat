@echo off
cd /d "%~dp0"
echo Starting FedPredict. Keep this window open while using the app.
node server.js
echo.
echo The app server stopped. Press any key to close this window.
pause >nul

