@echo off
setlocal enabledelayedexpansion
title Planilla de Horas - Remote Testing
color 0A

:: ============================================================
:: PRERREQUISITOS EN LA PC QUE VA A CORRER ESTO:
::
::   Este script CHEQUEA e INSTALA solo (via winget) lo que
::   falte: Node.js, PostgreSQL 16, cloudflared. En una PC
::   nueva puede pedir aprobar 1-2 ventanas de UAC durante la
::   primera corrida (instalacion de Node.js/Postgres) — es
::   normal, aceptalas. Si instala algo, puede pedirte volver
::   a ejecutar el script una segunda vez (para que Windows
::   refresque el PATH de la sesion).
::
::   Lo unico que SI tenes que copiar a mano desde la PC
::   original (son secretos, no viajan con git):
::     apps\api\.env
::     apps\web\.env.local
::
::   Y este repo completo (clonado o copiado), con este .bat
::   y setup-postgres.ps1 en la raiz.
:: ============================================================

echo.
echo ========================================================
echo    Planilla de Horas - Remote Testing Setup
echo    Powered by Cloudflare Tunnel (free)
echo ========================================================
echo.

:: Set paths
set "ROOT=%~dp0"
set "API_DIR=%ROOT%apps\api"
set "WEB_DIR=%ROOT%apps\web"
set "TEMP_DIR=%TEMP%\planilla-remote"
set "LINK_FILE=%USERPROFILE%\Desktop\planilla-link.txt"

:: ------------------------------------------------
:: DIRECCION FIJA - opcional
:: Si existe deploy\tunnel.env se usa una direccion que nunca cambia:
::   - Cloudflare Named Tunnel (TUNNEL_TOKEN + TUNNEL_HOSTNAME), o
::   - DuckDNS (DUCKDNS_SUBDOMAIN + DUCKDNS_TOKEN)
:: Si no existe, se cae al tunel rapido de siempre (URL aleatoria).
:: Ver deploy\tunnel.env.example para armarlo.
:: ------------------------------------------------
set "TUNNEL_TOKEN="
set "TUNNEL_HOSTNAME="
set "DUCKDNS_SUBDOMAIN="
set "DUCKDNS_TOKEN="
set "DUCKDNS_PUERTO="
set "ACCESO_HOST="
if exist "%ROOT%deploy\tunnel.env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ROOT%deploy\tunnel.env") do (
        if /I "%%a"=="TUNNEL_TOKEN"       set "TUNNEL_TOKEN=%%b"
        if /I "%%a"=="TUNNEL_HOSTNAME"    set "TUNNEL_HOSTNAME=%%b"
        if /I "%%a"=="DUCKDNS_SUBDOMAIN"  set "DUCKDNS_SUBDOMAIN=%%b"
        if /I "%%a"=="DUCKDNS_TOKEN"      set "DUCKDNS_TOKEN=%%b"
        if /I "%%a"=="DUCKDNS_PUERTO"     set "DUCKDNS_PUERTO=%%b"
    )
)

:: El tunel de Cloudflare tiene prioridad: da HTTPS y no necesita abrir puertos
if defined TUNNEL_HOSTNAME (
    if defined TUNNEL_TOKEN (
        set "ACCESO_HOST=https://!TUNNEL_HOSTNAME!"
        echo   Modo direccion fija: !ACCESO_HOST!
    )
)
if not defined ACCESO_HOST (
    set "TUNNEL_TOKEN="
    if defined DUCKDNS_SUBDOMAIN (
        if defined DUCKDNS_TOKEN (
            if defined DUCKDNS_PUERTO (
                set "ACCESO_HOST=http://!DUCKDNS_SUBDOMAIN!.duckdns.org:!DUCKDNS_PUERTO!"
            ) else (
                set "ACCESO_HOST=http://!DUCKDNS_SUBDOMAIN!.duckdns.org"
            )
            echo   Modo direccion fija: !ACCESO_HOST!
            echo   Avisando la IP actual a DuckDNS...
            powershell -NoProfile -Command "try { $r = Invoke-RestMethod ('https://www.duckdns.org/update?domains=' + '!DUCKDNS_SUBDOMAIN!' + '&token=' + '!DUCKDNS_TOKEN!' + '&ip=') -TimeoutSec 15; if ($r -match 'OK') { '   DuckDNS actualizado OK' } else { '   [AVISO] DuckDNS respondio: ' + $r } } catch { '   [AVISO] No se pudo contactar a DuckDNS' }"
        )
    )
)
:: TUNNEL_HOSTNAME se usa mas abajo para el CORS y el mensaje final
if not defined TUNNEL_HOSTNAME (
    if defined DUCKDNS_SUBDOMAIN set "TUNNEL_HOSTNAME=!DUCKDNS_SUBDOMAIN!.duckdns.org"
)

if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"

:: Check .env files were copied over (not in git)
if not exist "%API_DIR%\.env" (
    echo [ERROR] Falta apps\api\.env
    echo Copialo desde la PC original antes de correr este script.
    pause
    exit /b 1
)


:: ------------------------------------------------
:: Step 1: Node.js - check / auto-install
:: ------------------------------------------------
echo [1/9] Verificando Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo   No encontrado. Instalando via winget...
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    set "PATH=%PATH%;C:\Program Files\nodejs"
    where node >nul 2>&1
    if errorlevel 1 (
        echo.
        echo   Node.js se instalo pero esta sesion no lo ve todavia.
        echo   Volve a ejecutar este mismo script ^(doble click^) y
        echo   va a seguir solo desde donde quedo.
        pause
        exit /b 0
    )
    echo   Node.js instalado OK
) else (
    echo   Node.js OK
)

:: ------------------------------------------------
:: Step 2: cloudflared - check / auto-install
:: ------------------------------------------------
echo [2/9] Verificando cloudflared...
where cloudflared >nul 2>&1
if errorlevel 1 (
    echo   No encontrado. Instalando via winget...
    winget install --id Cloudflare.cloudflared -e --silent --accept-package-agreements --accept-source-agreements
    set "PATH=%PATH%;%LOCALAPPDATA%\Microsoft\WinGet\Links"
    where cloudflared >nul 2>&1
    if errorlevel 1 (
        echo.
        echo   cloudflared se instalo pero esta sesion no lo ve todavia.
        echo   Volve a ejecutar este mismo script ^(doble click^) y
        echo   va a seguir solo desde donde quedo.
        pause
        exit /b 0
    )
    echo   cloudflared instalado OK
) else (
    echo   cloudflared OK
)

:: ------------------------------------------------
:: Step 3: PostgreSQL - check / auto-install / auto-provision
:: ------------------------------------------------
echo [3/9] Verificando PostgreSQL...
sc query "postgresql-x64-16" >nul 2>&1
set "PG_SC_RESULT=%ERRORLEVEL%"

if not "%PG_SC_RESULT%"=="1060" goto pg_check_running

echo   PostgreSQL no esta instalado. Instalando via winget...
echo   ^(esto puede tardar varios minutos y pedir un UAC^)

for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 24 | %% {[char]$_})"`) do set "PG_SUPER_PW=%%p"

winget install --id PostgreSQL.PostgreSQL.16 -e --silent --accept-package-agreements --accept-source-agreements --override "--mode unattended --superpassword !PG_SUPER_PW!"

echo !PG_SUPER_PW! > "%TEMP_DIR%\postgres-superuser-password.txt"
echo   Password del superusuario 'postgres' guardado en:
echo     %TEMP_DIR%\postgres-superuser-password.txt

echo   Esperando a que el servicio arranque...
set PG_WAIT=0

:wait_pg_install
timeout /t 3 /nobreak >nul
set /a PG_WAIT+=1
sc query "postgresql-x64-16" 2>nul | findstr /I "RUNNING" >nul 2>&1
if not errorlevel 1 goto pg_installed
if %PG_WAIT% gtr 40 (
    echo [ERROR] PostgreSQL no termino de instalarse/arrancar a tiempo.
    echo Revisa manualmente ^(Servicios de Windows -^> postgresql-x64-16^).
    goto cleanup
)
goto wait_pg_install

:pg_installed
echo   PostgreSQL instalado y corriendo OK

echo   Creando base y usuario de la app segun apps\api\.env...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%setup-postgres.ps1" -EnvFile "%API_DIR%\.env" -SuperuserPassword "!PG_SUPER_PW!"
if errorlevel 1 (
    echo [ERROR] No se pudo crear la base/usuario automaticamente.
    echo Revisa %TEMP_DIR%\postgres-superuser-password.txt y creala a mano.
    goto cleanup
)
goto pg_done

:pg_check_running
sc query "postgresql-x64-16" 2>nul | findstr /I "RUNNING" >nul 2>&1
if errorlevel 1 (
    echo   PostgreSQL instalado pero detenido. Iniciando...
    net start postgresql-x64-16
    timeout /t 3 /nobreak >nul
) else (
    echo   PostgreSQL corriendo OK
)

:pg_done

:: ------------------------------------------------
:: Step 4: Free ports 3000/4000 (stale dev servers)
:: ------------------------------------------------
echo [4/9] Liberando puertos 3000 y 4000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING" /C:":4000 .*LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)

echo       Desactivando suspension automatica de la PC...
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change monitor-timeout-ac 0 >nul 2>&1

:: ------------------------------------------------
:: Step 5: Install npm dependencies if missing (PC nueva)
:: ------------------------------------------------
echo [5/9] Verificando dependencias npm...
if not exist "%API_DIR%\node_modules" (
    echo   Instalando dependencias del API...
    pushd "%API_DIR%"
    call npm install
    popd
)
if not exist "%WEB_DIR%\node_modules" (
    echo   Instalando dependencias del Frontend...
    pushd "%WEB_DIR%"
    call npm install
    popd
)

:: ------------------------------------------------
:: Step 6: Run Prisma migrations + seed
:: ------------------------------------------------
echo [6/9] Ejecutando migraciones Prisma...
cd /d "%API_DIR%"
call npx prisma migrate deploy 2>nul || (
    echo   Migraciones ya aplicadas
)
echo       Verificando datos de seed...
call npx tsx prisma/seed.ts 2>nul || (
    echo   Seeds ya ejecutados o error
)
cd /d "%ROOT%"

:: ------------------------------------------------
:: Step 7: Start API server
:: ------------------------------------------------
echo [7/9] Iniciando API server (puerto 4000)...
:: Con dominio propio hay que autorizarlo explicitamente: el modo desarrollo
:: solo permite solo IPs privadas y los tuneles trycloudflare/ngrok.
set "API_EXTRA_ENV="
if defined ACCESO_HOST set "API_EXTRA_ENV=set CORS_ORIGINS=!ACCESO_HOST! && "
start "API-Server" /D "%API_DIR%" cmd /c "set DEBUG_APPROVALS=1 && !API_EXTRA_ENV!npm run dev"
set API_ATTEMPTS=0
:wait_api
timeout /t 2 /nobreak >nul
set /a API_ATTEMPTS+=1
if %API_ATTEMPTS% gtr 20 (
    echo [ERROR] La API no responde en el puerto 4000. Revisa la ventana API-Server.
    goto cleanup
)
powershell -NoProfile -Command "try { Invoke-RestMethod http://127.0.0.1:4000/api/v1/health -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% neq 0 goto wait_api
echo       API respondiendo OK

:: ------------------------------------------------
:: Step 8: Start frontend (HMR disabled for tunnel)
:: ------------------------------------------------
echo [8/9] Iniciando Frontend (puerto 3000, proxy API, HMR off)...
start "Frontend-Server" /D "%WEB_DIR%" cmd /c "set VITE_DISABLE_HMR=1 && npm run dev"
set WEB_ATTEMPTS=0
:wait_web
timeout /t 2 /nobreak >nul
set /a WEB_ATTEMPTS+=1
if %WEB_ATTEMPTS% gtr 20 (
    echo [ERROR] El frontend no responde en el puerto 3000. Revisa la ventana Frontend-Server.
    goto cleanup
)
powershell -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:3000 -TimeoutSec 2 -UseBasicParsing | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% neq 0 goto wait_web
echo       Frontend respondiendo OK

:: ------------------------------------------------
:: Step 9: Single tunnel for everything (Vite proxy handles API)
:: ------------------------------------------------
if defined TUNNEL_TOKEN goto named_tunnel
if defined ACCESO_HOST goto sin_tunel

echo [9/9] Creando tunel Cloudflare (URL temporal)...
start "Cloudflare-Tunnel" /D "%ROOT%" cmd /c "cloudflared tunnel --url http://localhost:3000 >%TEMP_DIR%\tunnel.txt 2>&1"
echo       Esperando URL del tunel...

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

for /f "usebackq delims=" %%u in (`powershell -NoProfile -Command "(Select-String -Path '%TEMP_DIR%\tunnel.txt' -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' | Select-Object -First 1).Matches[0].Value"`) do (
    set "WEB_URL=%%u"
)

if "!WEB_URL!"=="" (
    echo [ERROR] No se pudo extraer URL del tunel
    echo [DEBUG] Contenido del log:
    type "%TEMP_DIR%\tunnel.txt" 2>nul
    goto cleanup
)
goto tunnel_ready

:: ------------------------------------------------
:: Tunel con nombre: la URL ya se conoce de antemano
:: ------------------------------------------------
:named_tunnel
echo [9/9] Conectando tunel Cloudflare con nombre (URL fija)...
start "Cloudflare-Tunnel" /D "%ROOT%" cmd /c "cloudflared tunnel --no-autoupdate run --token !TUNNEL_TOKEN! >%TEMP_DIR%\tunnel.txt 2>&1"
set "WEB_URL=https://!TUNNEL_HOSTNAME!"
echo       Esperando conexion con Cloudflare...

set NAMED_ATTEMPTS=0
:wait_named
timeout /t 2 /nobreak >nul
set /a NAMED_ATTEMPTS+=1
if %NAMED_ATTEMPTS% gtr 20 (
    echo [ERROR] El tunel no se registro. Revisa el token en deploy\tunnel.env
    echo [DEBUG] Contenido del log:
    type "%TEMP_DIR%\tunnel.txt" 2>nul
    goto cleanup
)
findstr /I /C:"Registered tunnel connection" "%TEMP_DIR%\tunnel.txt" >nul 2>&1
if %ERRORLEVEL% neq 0 goto wait_named
echo       Tunel conectado OK

goto tunnel_ready

:: ------------------------------------------------
:: DuckDNS: no hay tunel, se entra directo por la IP publica
:: ------------------------------------------------
:sin_tunel
echo [9/9] Direccion fija por DuckDNS (sin tunel)...
set "WEB_URL=!ACCESO_HOST!"
echo       Direccion: !WEB_URL!
echo.
echo       RECORDATORIO: esto solo funciona si el router reenvia el
echo       puerto externo al 3000 de esta PC. Si no entra desde afuera,
echo       revisa la redireccion de puertos del router.

:tunnel_ready

:: Copy URL to clipboard AND save to a file on the Desktop.
:: Al portapapeles va el link LIMPIO: es el que se le pasa a quien va a testear.
powershell -NoProfile -Command "Set-Clipboard -Value '!WEB_URL!'" >nul 2>&1
> "%LINK_FILE%" (
    echo Planilla de Horas - link de testing remoto
    echo Generado: %DATE% %TIME%
    echo.
    echo Para compartir:
    echo !WEB_URL!
)

:: Link de modo debug (entrar sin tipear contrasenas). Lo arma PowerShell y no
:: este .bat porque la clave puede tener caracteres que el batch destruye: un
:: '!' final se pierde con enabledelayedexpansion, y escaparlo como %%21 rompe
:: igual porque en un .bat %%2 se lee como parametro. Acá solo se vuelca el
:: archivo con `type`, que no expande nada.
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%debug-link.ps1" -EnvFile "%API_DIR%\.env" -WebUrl "!WEB_URL!" -OutDir "%TEMP_DIR%" -LinkFile "%LINK_FILE%" >nul 2>&1

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
echo    (ya copiada al portapapeles y guardada en el Desktop
echo     como planilla-link.txt)
echo.
echo --------------------------------------------------------
echo.
if exist "%TEMP_DIR%\debug-url.txt" (
    echo    MODO DEBUG - entrar sin tipear contrasenas:
    echo.
    for /f "usebackq delims=" %%u in ("%TEMP_DIR%\debug-url.txt") do echo      %%u
    echo.
    echo    Abrilo UNA vez en cada dispositivo. Queda guardado ahi
    echo    y el login pasa a mostrar el selector de usuarios.
    echo    Despues podes usar el link normal de arriba.
    echo.
    echo    NO lo compartas: con esa clave se entra a CUALQUIER
    echo    cuenta sin la contrasena real. Tambien quedo anotado
    echo    en planilla-link.txt, al final.
) else (
    echo    MODO DEBUG APAGADO. Va a haber que tipear las
    echo    contrasenas reales. Motivo:
    if exist "%TEMP_DIR%\debug-motivo.txt" type "%TEMP_DIR%\debug-motivo.txt"
    echo.
    echo    Se configura en apps\api\.env ^(DEBUG_AUTH=true y
    echo    DEBUG_AUTH_PASSWORD^), con NODE_ENV distinto de production.
)
echo.
echo --------------------------------------------------------
echo.
echo    Servidores locales:
echo      API:      http://localhost:4000
echo      Frontend: http://localhost:3000 (proxy /api)
echo.
echo    Un solo tunel - Vite proxy enruta /api al backend.
echo    HMR desactivado para evitar errores WebSocket.
echo    Suspension automatica desactivada mientras esto corra.
echo.
if defined ACCESO_HOST (
    echo    URL FIJA: este link no cambia nunca. Si esta ventana se
    echo    cierra o la PC se reinicia, el servicio se corta, pero al
    echo    volver a correr este script queda disponible en la MISMA
    echo    direccion.
) else (
    echo    OJO: si esta ventana se cierra, la PC se reinicia, o hay
    echo    un corte de luz/red, el tunel se corta y la URL cambia
    echo    al volver a correr este script. Para un link que NUNCA
    echo    cambie, ver deploy\tunnel.env.example ^(Cloudflare Named
    echo    Tunnel con dominio propio^).
)
echo.
echo ========================================================
echo.
echo    Presiona cualquier tecla para DETENER todo.
echo.
pause >nul

:cleanup
echo.
echo Deteniendo servicios...
:: Matar por PUERTO (deterministico: netstat da el PID real) con arbol de hijos (/T).
:: taskkill por titulo de ventana solo mata el cmd contenedor y deja huerfano el node/vite hijo.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING" /C:":4000 .*LISTENING"') do (
    taskkill /PID %%p /T /F >nul 2>&1
)
:: Matar el tunel de Cloudflare
taskkill /IM cloudflared.exe /F >nul 2>&1
:: Red de seguridad: por titulo de ventana, arbol completo (/T)
taskkill /FI "WINDOWTITLE eq API-Server*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Frontend-Server*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Cloudflare-Tunnel*" /T /F >nul 2>&1

echo Limpiando...
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"

echo.
echo Todos los servicios detenidos.
echo (la suspension automatica de la PC sigue desactivada;
echo  para reactivarla: powercfg /change standby-timeout-ac 30)
timeout /t 3 >nul
