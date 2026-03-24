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
echo [1/3] Iniciando API server (puerto 4000)...
start "API-Server" /D "%API_DIR%" cmd /c "npm run dev"
timeout /t 5 /nobreak >nul

:: ------------------------------------------------
:: Step 2: Start frontend (Vite proxy routes /api to localhost:4000)
:: ------------------------------------------------
echo [2/3] Iniciando Frontend (puerto 3000, proxy API)...
start "Frontend-Server" /D "%WEB_DIR%" cmd /c "npm run dev"
timeout /t 5 /nobreak >nul

:: ------------------------------------------------
:: Step 3: Single tunnel for everything (Vite proxy handles API)
:: ------------------------------------------------
echo [3/3] Creando tunel Cloudflare...
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
for /f "usebackq delims=" %%u in (`type "%TEMP_DIR%\tunnel.txt" ^| powershell -NoProfile -Command "foreach($l in $input){if($l -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'){$Matches[0];break}}"`) do (
    set "WEB_URL=%%u"
)

if "!WEB_URL!"=="" (
    echo [ERROR] No se pudo extraer URL del tunel
    echo [DEBUG] Contenido del log:
    type "%TEMP_DIR%\tunnel.txt" 2>nul
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
echo    URL para compartir:
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
echo    Cookies same-origin, sin problemas de SameSite.
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
taskkill /FI "WINDOWTITLE eq Cloudflare-Tunnel*" /F >nul 2>&1
taskkill /IM cloudflared.exe /F >nul 2>&1

echo Limpiando...
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"

echo.
echo Todos los servicios detenidos.
timeout /t 3 >nul
