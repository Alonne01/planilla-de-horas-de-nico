@echo off
title Planilla de Horas - Tunnel Setup
echo ============================================
echo   Planilla de Horas - Remote Testing Setup
echo ============================================
echo.

where cloudflared >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] cloudflared no encontrado. Instalando...
    npm install -g cloudflared
    echo.
)

taskkill /f /im cloudflared.exe >nul 2>nul

echo [1] Cerrando procesos anteriores...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":4000 " ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>nul
)
echo.

echo [2] Iniciando API...
start "API" cmd /k "cd /d %~dp0apps\api && npm run dev"
echo     Esperando a que la API inicie...
timeout /t 5 /nobreak >nul
echo.

echo [3] Abriendo tunel de la API (puerto 4000)...
echo     Espera a que aparezca la URL en la ventana que se abre.
echo.
start "TUNEL-API" cmd /k cloudflared tunnel --url http://localhost:4000
echo     Cuando veas la URL https://...trycloudflare.com
echo     en la ventana "TUNEL-API", copiala y pegala aca:
echo.
set /p API_URL="     URL de la API: "
echo.

echo [4] Configurando .env.local...
> "%~dp0apps\web\.env.local" echo VITE_API_URL=%API_URL%
echo     Listo: VITE_API_URL=%API_URL%
echo.

echo [5] Iniciando Vite...
start "Web (Tunnel)" cmd /k "cd /d %~dp0apps\web && npx vite --host"
timeout /t 5 /nobreak >nul
echo.

echo [6] Abriendo tunel del frontend (puerto 3000)...
start "TUNEL-WEB" cmd /k cloudflared tunnel --url http://localhost:3000
echo     Cuando veas la URL en "TUNEL-WEB", copiala:
echo.
set /p WEB_URL="     URL del frontend: "

echo.
echo ============================================
echo   TUNELES ACTIVOS
echo ============================================
echo.
echo   API:      %API_URL%
echo   Frontend: %WEB_URL%
echo.
echo   Compartile al tester: %WEB_URL%
echo.
echo ============================================
echo   Presiona cualquier tecla para cerrar todo
echo ============================================
pause >nul

echo.
echo Cerrando...
taskkill /f /im cloudflared.exe >nul 2>nul
> "%~dp0apps\web\.env.local" echo # Tunnel desactivado
echo Listo. Cerra las ventanas "API" y "Web (Tunnel)".