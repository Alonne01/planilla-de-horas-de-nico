@echo off
setlocal enabledelayedexpansion
title Planilla de Horas - Remote Testing
color 0A

echo.
echo ========================================================
echo    Planilla de Horas - Remote Testing Setup
echo    Powered by Cloudflare Tunnel (free)
echo ========================================================
echo.

:: Check cloudflared is installed
where cloudflared >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] cloudflared no esta instalado.
    echo Ejecuta: winget install cloudflare.cloudflared
    pause
    exit /b 1
)

:: Set paths
set "ROOT=%~dp0"
set "API_DIR=%ROOT%apps\api"
set "WEB_DIR=%ROOT%apps\web"
set "TEMP_DIR=%TEMP%\planilla-remote"

:: Clean temp
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"

:: ------------------------------------------------
:: Step 0: Free ports 3000/4000 (stale dev servers)
:: ------------------------------------------------
echo [0/6] Liberando puertos 3000 y 4000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING" /C:":4000 .*LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)

:: ------------------------------------------------
:: Step 1: Check PostgreSQL
:: ------------------------------------------------
echo [1/6] Verificando PostgreSQL...
sc query "postgresql-x64-16" >nul 2>&1
if errorlevel 1 (
    echo   PostgreSQL no esta corriendo. Iniciando...
    net start postgresql-x64-16
    timeout /t 3 /nobreak >nul
) else (
    echo   PostgreSQL corriendo OK
)

:: ------------------------------------------------
:: Step 2: Run Prisma migrations
:: ------------------------------------------------
echo [2/6] Ejecutando migraciones Prisma...
cd /d "%API_DIR%"
call npx prisma migrate deploy 2>nul || (
    echo   Migraciones ya aplicadas
)

:: ------------------------------------------------
:: Step 3: Run seed (idempotent)
:: ------------------------------------------------
echo [3/6] Verificando datos de seed...
call npx tsx prisma/seed.ts 2>nul || (
    echo   Seeds ya ejecutados o error
)
cd /d "%ROOT%"

:: ------------------------------------------------
:: Step 4: Start API server
:: ------------------------------------------------
echo [4/6] Iniciando API server (puerto 4000)...
start "API-Server" /D "%API_DIR%" cmd /c "set DEBUG_APPROVALS=1 && npm run dev"
set API_ATTEMPTS=0
:wait_api
timeout /t 2 /nobreak >nul
set /a API_ATTEMPTS+=1
if %API_ATTEMPTS% gtr 20 (
    echo [ERROR] La API no responde en el puerto 4000. Revisa la ventana API-Server.
    goto cleanup
)
powershell -NoProfile -Command "try { Invoke-RestMethod http://localhost:4000/api/v1/health -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% neq 0 goto wait_api
echo       API respondiendo OK

:: ------------------------------------------------
:: Step 5: Start frontend (HMR disabled for tunnel)
:: ------------------------------------------------
echo [5/6] Iniciando Frontend (puerto 3000, proxy API, HMR off)...
start "Frontend-Server" /D "%WEB_DIR%" cmd /c "set VITE_DISABLE_HMR=1 && npm run dev"
set WEB_ATTEMPTS=0
:wait_web
timeout /t 2 /nobreak >nul
set /a WEB_ATTEMPTS+=1
if %WEB_ATTEMPTS% gtr 20 (
    echo [ERROR] El frontend no responde en el puerto 3000. Revisa la ventana Frontend-Server.
    goto cleanup
)
powershell -NoProfile -Command "try { Invoke-WebRequest http://localhost:3000 -TimeoutSec 2 -UseBasicParsing | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% neq 0 goto wait_web
echo       Frontend respondiendo OK

:: ------------------------------------------------
:: Step 6: Single tunnel for everything (Vite proxy handles API)
:: ------------------------------------------------
echo [6/6] Creando tunel Cloudflare...
start "Cloudflare-Tunnel" /D "%ROOT%" cmd /c "cloudflared tunnel --url http://localhost:3000 >%TEMP_DIR%\tunnel.txt 2>&1"
echo       Esperando URL del tunel...

:: Wait for tunnel URL to appear in the log
set "WEB_URL="
set ATTEMPTS=0
:wait_url
timeout /t 2 /nobreak >nul
set /a ATTEMPTS+=1
if %ATTEMPTS% gtr 15 (
    echo [ERROR] Timeout esperando tunel
    goto cleanup
)
findstr /I /R "https.*trycloudflare" "%TEMP_DIR%\tunnel.txt" >nul 2>&1
if %ERRORLEVEL% neq 0 goto wait_url

:: Extract URL
for /f "usebackq delims=" %%u in (`powershell -NoProfile -Command "(Select-String -Path '%TEMP_DIR%\tunnel.txt' -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' | Select-Object -First 1).Matches[0].Value"`) do (
    set "WEB_URL=%%u"
)

if "!WEB_URL!"=="" (
    echo [ERROR] No se pudo extraer URL del tunel
    echo [DEBUG] Contenido del log:
    type "%TEMP_DIR%\tunnel.txt" 2>nul
    goto cleanup
)

:: Copy URL to clipboard
powershell -NoProfile -Command "Set-Clipboard -Value '!WEB_URL!'" >nul 2>&1

:: ------------------------------------------------
:: Show results
:: ------------------------------------------------
cls
color 0B
echo.
echo ========================================================
echo.
echo    PLANILLA DE HORAS - REMOTE TESTING ACTIVO
echo.
echo ========================================================
echo.
echo    URL para compartir (ya copiada al portapapeles):
echo.
echo      !WEB_URL!
echo.
echo --------------------------------------------------------
echo.
echo    Servidores locales:
echo      API:      http://localhost:4000
echo      Frontend: http://localhost:3000 (proxy /api)
echo.
echo    Un solo tunel — Vite proxy enruta /api al backend.
echo    HMR desactivado para evitar errores WebSocket.
echo.
echo ========================================================
echo.
echo    Presiona cualquier tecla para DETENER todo.
echo.
pause >nul

:cleanup
echo.
echo Deteniendo servicios...
taskkill /FI "WINDOWTITLE eq API-Server*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Frontend-Server*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Cloudflare-Tunnel*" /F >nul 2>&1
taskkill /IM cloudflared.exe /F >nul 2>&1

echo Limpiando...
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"

echo.
echo Todos los servicios detenidos.
timeout /t 3 >nul
