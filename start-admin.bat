@echo off
:: Self-elevate to Administrator automatically (shows UAC prompt if needed)
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

:: Fix PATH for nvm4w so node/npm are found in admin context
set "PATH=C:\nvm4w\nodejs;C:\nvm4w;%PATH%"

:: Verify node is available
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: node.exe not found. Trying alternative nvm paths...
    for /d %%d in (C:\nvm4w\v*) do set "PATH=%%d;%PATH%"
    node --version >nul 2>&1
    if %errorlevel% neq 0 (
        echo ERROR: Cannot find node.exe. Check your NVM installation path.
        pause
        exit /b 1
    )
)

echo Node: & node --version
echo.
echo Starting Attendance API as Administrator...
echo (WinBioCaptureSample requires admin - fingerprint LED will now activate)
echo.

cd /d "D:\NemaTechnologies\Attendance\attendance-api"
npm run start:dev
pause
