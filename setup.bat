@echo off
setlocal EnableDelayedExpansion
title Sridhar Property Intelligence - Setup
cd /d "%~dp0"

echo ============================================================
echo    SRIDHAR PROPERTY INTELLIGENCE - ONE-CLICK SETUP
echo    Installs prerequisites, database, AI models and seed data
echo ============================================================
echo.

REM ========== [1/7] Python ==========
where python >nul 2>&1
if errorlevel 1 (
  echo [1/7] Python not found. Installing with winget...
  winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
  echo.
  echo Python installed. Close this window and run setup.bat again so the new PATH is picked up.
  pause
  exit /b 1
)
echo [1/7] Python: OK

REM ========== [2/7] Node.js ==========
where npm >nul 2>&1
if errorlevel 1 (
  echo [2/7] Node.js not found. Installing with winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo Node.js installed. Close this window and run setup.bat again so the new PATH is picked up.
  pause
  exit /b 1
)
echo [2/7] Node.js: OK

REM ========== [3/7] PostgreSQL ==========
set "PSQL="
where psql >nul 2>&1 && set "PSQL=psql"
if not defined PSQL (
  for /d %%V in ("C:\Program Files\PostgreSQL\*") do if exist "%%V\bin\psql.exe" set "PSQL=%%V\bin\psql.exe"
)
if not defined PSQL (
  echo [3/7] PostgreSQL not found. Installing with winget...
  winget install -e --id PostgreSQL.PostgreSQL.16 --accept-source-agreements --accept-package-agreements
  for /d %%V in ("C:\Program Files\PostgreSQL\*") do if exist "%%V\bin\psql.exe" set "PSQL=%%V\bin\psql.exe"
)
if not defined PSQL (
  echo Could not find psql even after installing. Install PostgreSQL manually from postgresql.org and re-run setup.bat.
  pause
  exit /b 1
)
echo [3/7] PostgreSQL: OK

REM -- If the app database is already reachable, skip creation entirely.
set "PGPASSWORD=holora"
"%PSQL%" -U truelinks -h localhost -d truelinks_db -c "SELECT 1" >nul 2>&1
if not errorlevel 1 (
  echo        Database truelinks_db already reachable - skipping creation.
  goto :db_done
)

echo.
echo The app database needs to be created once. This requires the
echo PostgreSQL superuser password - the password for user 'postgres'
echo that was chosen when PostgreSQL was installed on THIS computer.
set /p PGPASS=Enter the 'postgres' password:
set "PGPASSWORD=%PGPASS%"
"%PSQL%" -U postgres -h localhost -c "SELECT 1" >nul 2>&1
if errorlevel 1 (
  echo Could not connect as 'postgres'. Check that the PostgreSQL service is running and the password is correct, then re-run setup.bat.
  pause
  exit /b 1
)
"%PSQL%" -U postgres -h localhost -tAc "SELECT 1 FROM pg_roles WHERE rolname='truelinks'" 2>nul | findstr /c:"1" >nul
if errorlevel 1 "%PSQL%" -U postgres -h localhost -c "CREATE ROLE truelinks LOGIN PASSWORD 'holora'"
"%PSQL%" -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='truelinks_db'" 2>nul | findstr /c:"1" >nul
if errorlevel 1 "%PSQL%" -U postgres -h localhost -c "CREATE DATABASE truelinks_db OWNER truelinks"
echo        Database truelinks_db ready.
:db_done

REM ========== [4/7] Ollama - local AI ==========
set "OLLAMA_URL="
set "TEXT_MODEL=NONE"
set "VIS_MODEL=NONE"
set "AIPROV=mock"

where ollama >nul 2>&1
if errorlevel 1 (
  echo [4/7] Ollama not found. Installing with winget...
  winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements
)

REM -- Detect where Ollama is listening (respects a custom OLLAMA_HOST/port),
REM -- and which usable models this computer already has.
call :detect_ollama
if not defined OLLAMA_URL (
  where ollama >nul 2>&1 && start "" /min cmd /c "ollama serve"
  ping -n 6 127.0.0.1 >nul
  call :detect_ollama
)

if defined OLLAMA_URL (
  set "AIPROV=ollama"
  echo [4/7] Ollama running at !OLLAMA_URL!
  if "!TEXT_MODEL!"=="NONE" (
    echo        No llama3.2 model found - downloading llama3.2:3b, about 2 GB...
    ollama pull llama3.2:3b
    set "TEXT_MODEL=llama3.2:3b"
  ) else (
    echo        Text model found: !TEXT_MODEL!
  )
  if "!VIS_MODEL!"=="NONE" (
    echo        No llava vision model found - downloading llava:7b, about 4.7 GB...
    ollama pull llava:7b
    set "VIS_MODEL=llava:7b"
  ) else (
    echo        Vision model found: !VIS_MODEL!
  )
) else (
  echo [4/7] Ollama is not reachable - the app will use the built-in mock AI instead.
  echo        Everything still works; install Ollama later and re-run setup.bat for real AI.
  set "OLLAMA_URL=http://localhost:11434"
  set "TEXT_MODEL=llama3.2:3b"
  set "VIS_MODEL=llava:7b"
)

REM ========== [5/7] Backend ==========
echo [5/7] Setting up backend - this can take a few minutes the first time...
pushd backend
if not exist .venv python -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip --quiet
.venv\Scripts\python.exe -m pip install -r requirements.txt --quiet
if errorlevel 1 (
  echo Backend dependency install failed. Check your internet connection and re-run setup.bat.
  popd
  pause
  exit /b 1
)

if not exist .env (
  (
    echo DATABASE_URL=postgresql://truelinks:holora@localhost:5432/truelinks_db
    echo AI_PROVIDER=!AIPROV!
    echo OLLAMA_BASE_URL=!OLLAMA_URL!
    echo OLLAMA_MODEL=!TEXT_MODEL!
    echo OLLAMA_VISION_MODEL=!VIS_MODEL!
  ) > .env
  echo        Created backend\.env
) else (
  powershell -NoProfile -Command "$keep = Get-Content .env | Where-Object { $_ -notmatch '^(AI_PROVIDER|OLLAMA_BASE_URL|OLLAMA_MODEL|OLLAMA_VISION_MODEL)=' }; $keep + @('AI_PROVIDER=!AIPROV!','OLLAMA_BASE_URL=!OLLAMA_URL!','OLLAMA_MODEL=!TEXT_MODEL!','OLLAMA_VISION_MODEL=!VIS_MODEL!') | Set-Content .env -Encoding ascii"
  echo        Updated AI settings in backend\.env
)

.venv\Scripts\python.exe manage.py migrate
if errorlevel 1 (
  echo Database migration failed. See the error above.
  popd
  pause
  exit /b 1
)
.venv\Scripts\python.exe manage.py seed_sample_data
.venv\Scripts\python.exe manage.py ensure_demo_users
popd
echo [5/7] Backend: OK

REM ========== [6/7] Frontend ==========
echo [6/7] Installing frontend packages...
pushd frontend
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo npm install failed. Check your internet connection and re-run setup.bat.
  popd
  pause
  exit /b 1
)
popd
echo [6/7] Frontend: OK

REM ========== [7/7] Done ==========
echo.
echo ============================================================
echo    SETUP COMPLETE
echo.
echo    AI provider: !AIPROV!   (!OLLAMA_URL!)
echo    Text model:  !TEXT_MODEL!    Vision model: !VIS_MODEL!
echo.
echo    To run the app any time: double-click start.bat
echo.
echo    Demo logins:
echo      Owner    owner@truelinks.com    / Owner@12345
echo      Manager  manager@truelinks.com  / Manager@12345
echo      Tech     tech@truelinks.com     / Tech@12345
echo      Tenant   tenant@truelinks.com   / Tenant@12345
echo ============================================================
echo.
choice /c YN /t 15 /d N /m "Start the app now"
if errorlevel 2 goto :eof
call start.bat
goto :eof

REM ---- Probe Ollama: finds its URL (custom OLLAMA_HOST or default port
REM ---- 11434) and picks already-installed llama3.2* / llava* models.
:detect_ollama
for /f "usebackq tokens=1-3 delims=|" %%A in (`powershell -NoProfile -Command "$cands=@(); if($env:OLLAMA_HOST){ $h=$env:OLLAMA_HOST; if($h -notmatch '^http'){ $h='http://'+$h }; $cands+=$h }; $cands+='http://localhost:11434'; foreach($c in $cands){ try { $r=Invoke-RestMethod -Uri ($c.TrimEnd('/')+'/api/tags') -TimeoutSec 3; $names=@($r.models.name); $t=($names | Where-Object { $_ -like 'llama3.2*' } | Select-Object -First 1); $v=($names | Where-Object { $_ -like 'llava*' } | Select-Object -First 1); if(-not $t){$t='NONE'}; if(-not $v){$v='NONE'}; Write-Output ($c.TrimEnd('/')+'|'+$t+'|'+$v); break } catch {} }"`) do (
  set "OLLAMA_URL=%%A"
  set "TEXT_MODEL=%%B"
  set "VIS_MODEL=%%C"
)
goto :eof
