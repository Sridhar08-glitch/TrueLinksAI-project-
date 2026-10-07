@echo off
title Sridhar Property Intelligence - Start
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  echo Backend is not set up yet. Run setup.bat first.
  pause
  exit /b 1
)

echo Applying any pending database migrations...
pushd backend
.venv\Scripts\python.exe manage.py migrate --noinput
if errorlevel 1 (
  echo.
  echo Migration failed - is PostgreSQL running? Start it and run start.bat again.
  popd
  pause
  exit /b 1
)
popd

echo Starting backend  -  http://localhost:8000
start "Sridhar Backend" /d "%~dp0backend" cmd /k ".venv\Scripts\python.exe manage.py runserver 0.0.0.0:8000 --noreload"

echo Starting frontend -  http://localhost:5173
start "Sridhar Frontend" /d "%~dp0frontend" cmd /k "npm run dev"

echo Waiting for the backend to come up...
set /a tries=0
:wait_backend
curl -s -o nul --max-time 2 http://localhost:8000/api/docs/ && goto backend_up
set /a tries+=1
if %tries% geq 30 goto backend_up
ping -n 3 127.0.0.1 >nul
goto wait_backend
:backend_up

echo Opening the app in your browser...
start "" http://localhost:5173
