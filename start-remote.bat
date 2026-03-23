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
:: Step 1: Start API server
:: ------------------------------------------------
echo [1/4] Iniciando API server (puerto 4000)...
set "CORS_ORIGINS=http://localhost:3000,https://*.trycloudflare.com"
start "API-Server" /D "%API_DIR%" cmd /c "set CORS_ORIGINS=http://localhost:3000,https://*.trycloudflare.com&& npm run dev"
timeout /t 5 /nobreak >nul

:: ------------------------------------------------
:: Step 2: Start API tunnel
:: ------------------------------------------------
echo [2/4] Creando tunel Cloudflare para API...
start "API-Tunnel" /D "%ROOT%" cmd /c "cloudflared tunnel --url http://localhost:4000 >%TEMP_DIR%\api_tunnel.txt 2>&1"
echo       Esperando URL del tunel API...

:: Wait for tunnel URL to appear in the log
set "API_URL="
set ATTEMPTS=0
:wait_api_url
timeout /t 2 /nobreak >nul
set /a ATTEMPTS+=1
if %ATTEMPTS% gtr 15 (
    echo [ERROR] Timeout esperando tunel API
    goto cleanup
)
findstr /I /R "https.*trycloudflare" "%TEMP_DIR%\api_tunnel.txt" >nul 2>&1
if %ERRORLEVEL% neq 0 goto wait_api_url

:: Extract URL using type (can read locked files) piped to PowerShell
for /f "usebackq delims=" %%u in (`type "%TEMP_DIR%\api_tunnel.txt" ^| powershell -NoProfile -Command "foreach($l in $input){if($l -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'){$Matches[0];break}}"`) do (
    set "API_URL=%%u"
)

if "!API_URL!"=="" (
    echo [ERROR] No se pudo extraer URL del tunel API
    echo [DEBUG] Contenido del log:
    type "%TEMP_DIR%\api_tunnel.txt" 2>nul
    goto cleanup
)

echo       API Tunnel: !API_URL!
echo.

:: ------------------------------------------------
:: Step 3: Start frontend with API tunnel URL
:: ------------------------------------------------
echo [3/4] Iniciando Frontend (puerto 3000)...
start "Frontend-Server" /D "%WEB_DIR%" cmd /c "set VITE_API_URL=!API_URL!&& npm run dev"
timeout /t 5 /nobreak >nul

:: ------------------------------------------------
:: Step 4: Start frontend tunnel
:: ------------------------------------------------
echo [4/4] Creando tunel Cloudflare para Frontend...
start "Frontend-Tunnel" /D "%ROOT%" cmd /c "cloudflared tunnel --url http://localhost:3000 >%TEMP_DIR%\web_tunnel.txt 2>&1"
echo       Esperando URL del tunel Frontend...

:: Wait for tunnel URL
set "WEB_URL="
set ATTEMPTS=0
:wait_web_url
timeout /t 2 /nobreak >nul
set /a ATTEMPTS+=1
if %ATTEMPTS% gtr 15 (
    echo [ERROR] Timeout esperando tunel Frontend
    goto cleanup
)
findstr /I /R "https.*trycloudflare" "%TEMP_DIR%\web_tunnel.txt" >nul 2>&1
if %ERRORLEVEL% neq 0 goto wait_web_url

:: Extract URL using type (can read locked files) piped to PowerShell
for /f "usebackq delims=" %%u in (`type "%TEMP_DIR%\web_tunnel.txt" ^| powershell -NoProfile -Command "foreach($l in $input){if($l -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'){$Matches[0];break}}"`) do (
    set "WEB_URL=%%u"
)

if "!WEB_URL!"=="" (
    echo [ERROR] No se pudo extraer URL del tunel Frontend
    echo [DEBUG] Contenido del log:
    type "%TEMP_DIR%\web_tunnel.txt" 2>nul
    goto cleanup
)

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
echo    FRONTEND (compartir esta URL para testing):
echo.
echo      !WEB_URL!
echo.
echo    API:
echo.
echo      !API_URL!
echo.
echo --------------------------------------------------------
echo.
echo    Servidores locales:
echo      API:      http://localhost:4000
echo      Frontend: http://localhost:3000
echo.
echo ========================================================
echo.
echo    Presiona cualquier tecla para DETENER todo.
echo.
pause >nul

:cleanup
echo.
echo Deteniendo servicios...
pause
taskkill /FI "WINDOWTITLE eq API-Server*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Frontend-Server*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq API-Tunnel*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Frontend-Tunnel*" /F >nul 2>&1
taskkill /IM cloudflared.exe /F >nul 2>&1

echo Limpiando...
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"

echo.
echo Todos los servicios detenidos.
timeout /t 3 >nul
