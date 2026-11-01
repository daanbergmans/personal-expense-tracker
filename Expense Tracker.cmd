@echo off
rem Opens the expense tracker in its own window; starts the server first if it isn't running yet.
cd /d "%~dp0"
set URL=http://localhost:3000

curl -s -o nul %URL%/api/years && goto open

rem Builds the latest version and serves it; closing this minimized window stops the app.
start "Expense Tracker server" /min cmd /c "npm start"

set /a tries=0
:wait
timeout /t 1 /nobreak >nul
curl -s -o nul %URL%/api/years && goto open
set /a tries+=1
if %tries% lss 90 goto wait
echo The server did not start. Open the "Expense Tracker server" window to see why.
pause
exit /b 1

:open
rem Edge app mode: a window without tabs or address bar, like a desktop app.
start "" msedge --app=%URL%
