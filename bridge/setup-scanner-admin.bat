@echo off
echo =====================================================
echo  AttendAI Fingerprint Scanner - One-Time Admin Setup
echo  Run this script ONCE as Administrator.
echo =====================================================
echo.

:: Enable and start Windows Biometric Service
sc config WbioSrvc start= auto
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Could not configure WbioSrvc. Are you running as Administrator?
    pause
    exit /b 1
)
net start WbioSrvc
if %ERRORLEVEL% NEQ 0 (
    sc query WbioSrvc | findstr /I "RUNNING"
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Could not start WbioSrvc.
        pause
        exit /b 1
    )
    echo WbioSrvc is already running.
)

echo.
echo Setup complete! Windows Biometric Service is now running and set to auto-start.
echo You can now start the AttendAI backend without admin privileges.
pause
