@echo off
setlocal enabledelayedexpansion
title Planilla de Horas - Instalador del servidor
color 0B

:: ============================================================
::  INSTALADOR DEL SERVIDOR - Planilla de Horas
::
::  Unico archivo a ejecutar para dejar el servidor funcionando.
::  Verifica todos los prerrequisitos, instala lo que falte,
::  configura la direccion publica y levanta la aplicacion.
::
::  Uso: doble clic, o desde una consola:  instalar-servidor.bat
:: ============================================================

set "ROOT=%~dp0"
set "COMPOSE_FILE=%ROOT%docker-compose.prod.yml"
set "ENV_FILE=%ROOT%.env"
set "ERRORES=0"
set "AVISOS=0"

cls
echo.
echo  ============================================================
echo    PLANILLA DE HORAS - Instalacion del servidor
echo  ============================================================
echo.
echo    Este asistente deja el servidor funcionando de punta a punta:
echo      - Verifica que la maquina cumpla los requisitos
echo      - Instala Docker si falta
echo      - Configura la direccion publica (DuckDNS)
echo      - Levanta la aplicacion y carga los datos iniciales
echo.
echo  ------------------------------------------------------------
echo.
echo    Donde se va a instalar el servidor?
echo.
echo      [1] En ESTA maquina Windows
echo      [2] En un servidor Linux (te doy el comando exacto)
echo      [3] Solo verificar requisitos (no instala nada)
echo      [4] Salir
echo.
set "DESTINO="
set /p "DESTINO=   Opcion [1-4]: "

if "%DESTINO%"=="1" goto verificar
if "%DESTINO%"=="2" goto linux
if "%DESTINO%"=="3" goto verificar
if "%DESTINO%"=="4" exit /b 0
echo.
echo    Opcion invalida.
pause
exit /b 1

:: ============================================================
::  VERIFICACION DE REQUISITOS
:: ============================================================
:verificar
cls
echo.
echo  ============================================================
echo    VERIFICANDO REQUISITOS
echo  ============================================================
echo.

:: --- Archivos del proyecto ---
echo   [ ] Archivos del proyecto...
if not exist "%COMPOSE_FILE%" (
    call :error "No se encuentra docker-compose.prod.yml. Ejecuta este archivo desde la carpeta del proyecto."
) else if not exist "%ROOT%apps\api\Dockerfile" (
    call :error "Falta apps\api\Dockerfile. La copia del proyecto esta incompleta."
) else (
    call :ok "Archivos del proyecto completos"
)

:: --- Version de Windows ---
echo   [ ] Sistema operativo...
for /f "tokens=2 delims=[]" %%v in ('ver') do set "VERSTR=%%v"
call :ok "!VERSTR!"

:: --- Arquitectura ---
echo   [ ] Arquitectura...
if /I "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    call :ok "x64"
) else if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
    call :aviso "ARM64: Docker Desktop funciona, pero algunas imagenes tardan mas"
) else (
    call :error "Arquitectura %PROCESSOR_ARCHITECTURE% no soportada"
)

:: --- Memoria RAM ---
echo   [ ] Memoria RAM...
for /f "usebackq delims=" %%m in (`powershell -NoProfile -Command "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1)"`) do set "RAM=%%m"
for /f "usebackq delims=" %%m in (`powershell -NoProfile -Command "if ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB -ge 3.5) { 'si' } else { 'no' }"`) do set "RAM_OK=%%m"
if "!RAM_OK!"=="si" (
    call :ok "!RAM! GB"
) else (
    call :aviso "!RAM! GB - se recomiendan 4 GB o mas"
)

:: --- Espacio en disco ---
echo   [ ] Espacio en disco...
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "[math]::Round((Get-PSDrive C).Free/1GB)"`) do set "DISCO=%%d"
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "if ((Get-PSDrive C).Free/1GB -ge 20) { 'si' } else { 'no' }"`) do set "DISCO_OK=%%d"
if "!DISCO_OK!"=="si" (
    call :ok "!DISCO! GB libres en C:"
) else (
    call :error "Solo !DISCO! GB libres en C: - se necesitan al menos 20 GB"
)

:: --- Virtualizacion (necesaria para Docker Desktop) ---
echo   [ ] Virtualizacion...
for /f "usebackq delims=" %%h in (`powershell -NoProfile -Command "if ((Get-CimInstance Win32_ComputerSystem).HypervisorPresent -or (Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled) { 'si' } else { 'no' }"`) do set "VIRT=%%h"
if "!VIRT!"=="si" (
    call :ok "Habilitada"
) else (
    call :error "Deshabilitada. Hay que activar la virtualizacion VT-x/AMD-V en la BIOS del equipo."
)

:: --- Conexion a internet ---
echo   [ ] Conexion a internet...
powershell -NoProfile -Command "try { (Invoke-WebRequest 'https://registry-1.docker.io/v2/' -UseBasicParsing -TimeoutSec 10) | Out-Null; exit 0 } catch { if ($_.Exception.Response.StatusCode.value__ -eq 401) { exit 0 } else { exit 1 } }" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    call :ok "Alcanza el repositorio de imagenes"
) else (
    call :error "No se puede llegar a Docker Hub. Revisar conexion, DNS o proxy de salida."
)

:: --- Puertos 80 y 443 ---
echo   [ ] Puertos 80 y 443...
set "PUERTOS_LIBRES=si"
for %%p in (80 443) do (
    powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %%p -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        set "PUERTOS_LIBRES=no"
        call :aviso "El puerto %%p ya esta ocupado por otro programa - IIS, Skype u otro servidor"
    )
)
if "!PUERTOS_LIBRES!"=="si" call :ok "80 y 443 libres"

:: --- Docker ---
echo   [ ] Docker...
set "DOCKER_OK=no"
where docker >nul 2>&1
if !ERRORLEVEL! neq 0 (
    call :aviso "Docker Desktop no esta instalado"
) else (
    docker info >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        call :aviso "Docker esta instalado pero no esta corriendo"
    ) else (
        docker compose version >nul 2>&1
        if !ERRORLEVEL! neq 0 (
            call :error "Falta el plugin 'docker compose' v2"
        ) else (
            set "DOCKER_OK=si"
            for /f "usebackq tokens=3" %%d in (`docker --version`) do call :ok "Docker %%d"
        )
    )
)

echo.
echo  ------------------------------------------------------------
if !ERRORES! gtr 0 (
    echo    RESULTADO: !ERRORES! problema^(s^) que impiden continuar.
    echo    Hay que resolver lo marcado como [ERROR] antes de instalar.
) else if !AVISOS! gtr 0 (
    echo    RESULTADO: la maquina sirve. Hay !AVISOS! punto^(s^) a revisar
    echo    marcados como [AVISO] - el instalador los resuelve o los saltea.
) else (
    echo    RESULTADO: todo en orden.
)
echo  ------------------------------------------------------------
echo.

if "%DESTINO%"=="3" (
    echo    Verificacion terminada. No se instalo nada.
    echo.
    pause
    exit /b 0
)

if !ERRORES! gtr 0 (
    echo    Hay que resolver los problemas marcados antes de instalar.
    echo.
    pause
    exit /b 1
)

:: ============================================================
::  INSTALAR DOCKER SI FALTA
:: ============================================================
if "!DOCKER_OK!"=="si" goto configurar

echo.
echo  ============================================================
echo    DOCKER DESKTOP
echo  ============================================================
echo.
where docker >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo    Docker esta instalado pero no responde.
    echo    Abri Docker Desktop, espera a que diga "Engine running"
    echo    y volve a ejecutar este instalador.
    echo.
    pause
    exit /b 1
)

echo    Docker Desktop es necesario y no esta instalado.
echo    Se puede instalar automaticamente con winget.
echo.
where winget >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo    winget no esta disponible en este equipo.
    echo    Descargalo a mano desde:
    echo      https://docs.docker.com/desktop/install/windows-install/
    echo.
    pause
    exit /b 1
)

set "INSTALAR_DOCKER="
set /p "INSTALAR_DOCKER=   Instalar Docker Desktop ahora? [S/N]: "
if /I not "!INSTALAR_DOCKER!"=="S" (
    echo.
    echo    Instalacion cancelada.
    pause
    exit /b 1
)

echo.
echo    Instalando Docker Desktop (varios minutos, puede pedir permisos)...
winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements
echo.
echo  ------------------------------------------------------------
echo    Docker Desktop quedo instalado.
echo.
echo    AHORA:
echo      1) Reinicia el equipo si el instalador lo pide
echo      2) Abri Docker Desktop y espera a que diga "Engine running"
echo      3) Volve a ejecutar este instalador
echo  ------------------------------------------------------------
echo.
pause
exit /b 0

:: ============================================================
::  CONFIGURACION
:: ============================================================
:configurar
echo.
echo  ============================================================
echo    CONFIGURACION
echo  ============================================================
echo.

if exist "%ENV_FILE%" (
    echo    Ya existe un archivo .env de una instalacion anterior.
    echo    Se conserva tal cual (contiene las claves de la base de datos).
    echo.
    set "REUSAR="
    set /p "REUSAR=   Continuar con esa configuracion? [S/N]: "
    if /I not "!REUSAR!"=="S" (
        echo.
        echo    Cancelado. Para empezar de cero, renombra el archivo .env y volve a ejecutar.
        pause
        exit /b 1
    )
    goto reusar_env
)

echo    Direccion publica con la que va a entrar la gente.
echo.
echo      [1] DuckDNS (gratis)   ej: planillawenlen.duckdns.org
echo      [2] Solo red interna   ej: http://192.168.0.50
echo.
set "MODO="
set /p "MODO=   Opcion [1-2]: "
echo.

set "DUCK_SUB="
set "DUCK_TOKEN="
set "PUBLIC_URL="
set "NGINX_CONF=./nginx.http.conf"
set "PERFILES="

if "!MODO!"=="1" (
    echo    Alta previa en duckdns.org: ingresar con Google/GitHub, crear el
    echo    subdominio y copiar el token que muestra la pagina.
    echo.
    set /p "DUCK_SUB=   Subdominio DuckDNS (sin .duckdns.org): "
    set /p "DUCK_TOKEN=   Token de DuckDNS: "
    if "!DUCK_SUB!"=="" (
        echo.
        echo    [ERROR] El subdominio es obligatorio.
        pause
        exit /b 1
    )
    set "PUBLIC_URL=https://!DUCK_SUB!.duckdns.org"
    set "PERFILES=--profile duckdns"
    echo.
    echo    La direccion va a ser: !PUBLIC_URL!
    echo    Arranca en HTTP y, antes de terminar, el instalador emite el
    echo    certificado y deja el servidor en HTTPS. Para eso hacen falta
    echo    los puertos 80 y 443 reenviados en el router.
) else (
    for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress"`) do set "IPLOCAL=%%i"
    echo    IP local detectada: !IPLOCAL!
    set /p "PUBLIC_URL=   Direccion [http://!IPLOCAL!]: "
    if "!PUBLIC_URL!"=="" set "PUBLIC_URL=http://!IPLOCAL!"
)

echo.
echo    Generando archivo .env con claves aleatorias...

powershell -NoProfile -Command ^
  "$gen = { -join ((1..30) | ForEach-Object { ([char[]]'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789')[(Get-Random -Maximum 57)] }) };" ^
  "$c = Get-Content '%ROOT%.env.docker.example';" ^
  "$c = $c -replace '^DB_PASSWORD=.*', ('DB_PASSWORD=' + (& $gen));" ^
  "$c = $c -replace '^JWT_SECRET=.*', ('JWT_SECRET=' + (& $gen));" ^
  "$c = $c -replace '^JWT_REFRESH_SECRET=.*', ('JWT_REFRESH_SECRET=' + (& $gen));" ^
  "$c = $c -replace '^PUBLIC_URL=.*', 'PUBLIC_URL=%PUBLIC_URL%';" ^
  "$c = $c -replace '^NGINX_CONF=.*', 'NGINX_CONF=%NGINX_CONF%';" ^
  "$c = $c -replace '^DUCKDNS_SUBDOMAIN=.*', 'DUCKDNS_SUBDOMAIN=%DUCK_SUB%';" ^
  "$c = $c -replace '^DUCKDNS_TOKEN=.*', 'DUCKDNS_TOKEN=%DUCK_TOKEN%';" ^
  "Set-Content -Path '%ENV_FILE%' -Value $c -Encoding utf8"

if not exist "%ENV_FILE%" (
    echo    [ERROR] No se pudo generar el archivo .env
    pause
    exit /b 1
)
echo    Archivo .env creado. GUARDA UNA COPIA: contiene las claves.

:: Los perfiles de compose no se guardan en el .env: se deducen de lo que quedo
:: configurado, para que una reinstalacion no deje DuckDNS sin actualizar la IP.
:reusar_env
findstr /R /C:"^DUCKDNS_SUBDOMAIN=." "%ENV_FILE%" >nul 2>&1
if !ERRORLEVEL! equ 0 set "PERFILES=--profile duckdns"

:: ============================================================
::  LEVANTAR EL STACK
:: ============================================================
:levantar
echo.
echo  ============================================================
echo    INSTALANDO LA APLICACION
echo  ============================================================
echo.
echo    Construyendo las imagenes.
echo    La primera vez tarda entre 5 y 15 minutos. No cierres esta ventana.
echo.

docker compose -f "%COMPOSE_FILE%" %PERFILES% build
if !ERRORLEVEL! neq 0 (
    echo.
    echo    [ERROR] Fallo la construccion de las imagenes.
    echo    Revisa el detalle mas arriba y volve a ejecutar.
    pause
    exit /b 1
)

echo.
echo    Levantando los servicios...
docker compose -f "%COMPOSE_FILE%" %PERFILES% up -d
if !ERRORLEVEL! neq 0 (
    echo.
    echo    [ERROR] Fallo el arranque.
    pause
    exit /b 1
)

echo.
echo    Esperando a que la aplicacion responda...
set INTENTOS=0
:esperar_api
timeout /t 3 /nobreak >nul
set /a INTENTOS+=1
if !INTENTOS! gtr 40 (
    echo.
    echo    [ERROR] El API no respondio a tiempo.
    echo    Ver el detalle con:  docker compose -f docker-compose.prod.yml logs api
    pause
    exit /b 1
)
docker compose -f "%COMPOSE_FILE%" exec -T api node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >nul 2>&1
if !ERRORLEVEL! neq 0 goto esperar_api
echo    Aplicacion respondiendo OK

:: --- Datos iniciales ---
echo.
echo    Verificando datos iniciales...
set "USUARIOS=0"
for /f "usebackq delims=" %%u in (`docker compose -f "%COMPOSE_FILE%" exec -T db psql -U planilla_user -d planilla_horas -tAc "SELECT COUNT(*) FROM usuarios" 2^>nul`) do set "USUARIOS=%%u"
set "USUARIOS=!USUARIOS: =!"

if "!USUARIOS!"=="0" (
    echo    La base esta vacia.
    set "CARGAR="
    set /p "CARGAR=   Cargar los datos iniciales ^(empresa, sectores, nomina^)? [S/N]: "
    if /I "!CARGAR!"=="S" (
        echo    Cargando...
        docker compose -f "%COMPOSE_FILE%" exec -T api tsx prisma/seed.ts
        echo    Datos iniciales cargados.
    )
) else (
    echo    La base ya tiene !USUARIOS! usuarios - no se toca.
)

:: --- Arranque automatico ---
echo.
echo    Configurando el arranque automatico de Docker Desktop...
powershell -NoProfile -Command "$p='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; $d=(Get-Command docker -ErrorAction SilentlyContinue).Source; if ($d) { $dd=Join-Path (Split-Path (Split-Path $d)) 'Docker Desktop.exe'; if (Test-Path $dd) { Set-ItemProperty -Path $p -Name 'Docker Desktop' -Value ('\"' + $dd + '\"') -ErrorAction SilentlyContinue; 'ok' } }" >nul 2>&1
echo    Listo (los contenedores ya arrancan solos con Docker).

:: ============================================================
::  HTTPS (solo modo DuckDNS)
::
::  El certificado se emite aca, dentro de la instalacion: publicar
::  a internet en HTTP puro deja las contrasenas y los tokens de
::  sesion viajando en claro para cualquiera en el camino de red.
:: ============================================================
for /f "usebackq tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
    if /I "%%a"=="PUBLIC_URL" set "URL_FINAL=%%b"
    if /I "%%a"=="DUCKDNS_SUBDOMAIN" set "SUB_FINAL=%%b"
    if /I "%%a"=="NGINX_CONF" set "CONF_FINAL=%%b"
)

set "HTTPS_OK="
set "SIN_HTTPS="
set "PUBLICACION_DETENIDA="
if "!SUB_FINAL!"=="" goto resumen
if not "!CONF_FINAL!"=="./nginx.http.conf" goto resumen

set "DOMINIO=!SUB_FINAL!.duckdns.org"
echo.
echo  ============================================================
echo    ACTIVANDO EL HTTPS - !DOMINIO!
echo  ============================================================
echo.
echo    Falta el certificado. Para emitirlo, Let's Encrypt tiene que
echo    poder llegar a esta maquina desde internet por el puerto 80.
echo.
echo    En el router: reenviar los puertos 80 y 443 a esta maquina.
echo.
set "PUERTOS_OK="
set /p "PUERTOS_OK=   Ya estan reenviados los puertos 80 y 443? [S/N]: "
if /I not "!PUERTOS_OK!"=="S" goto sin_https

set "CERT_EMAIL="
set /p "CERT_EMAIL=   Email para los avisos de vencimiento del certificado: "
set "CERT_MAIL=--register-unsafely-without-email"
if not "!CERT_EMAIL!"=="" set "CERT_MAIL=-m !CERT_EMAIL!"

echo.
echo    Emitiendo el certificado...
docker compose -f "%COMPOSE_FILE%" --profile certbot run --rm certbot certonly --webroot -w /var/www/certbot -d !DOMINIO! --agree-tos --no-eff-email -n !CERT_MAIL!
if !ERRORLEVEL! neq 0 (
    echo.
    echo    [ERROR] No se pudo emitir el certificado.
    echo    Causa habitual: los puertos 80 y 443 todavia no llegan hasta aca.
    goto sin_https
)

:: nginx.conf trae el dominio como marcador, igual que deploy/bootstrap.sh.
:: Se escribe UTF-8 sin BOM a proposito: nginx toma el BOM como una directiva
:: desconocida y no arranca.
powershell -NoProfile -Command "$p='%ROOT%nginx.conf'; $c=Get-Content -Raw -Encoding UTF8 $p; if ($c -match 'PLANILLA_DOMINIO') { [IO.File]::WriteAllText($p, ($c -replace 'PLANILLA_DOMINIO','!DOMINIO!'), (New-Object Text.UTF8Encoding $false)) }"
powershell -NoProfile -Command "$p='%ENV_FILE%'; $l=(Get-Content $p -Encoding UTF8) -replace '^NGINX_CONF=.*','NGINX_CONF=./nginx.conf' -replace '^PUBLIC_URL=.*','PUBLIC_URL=https://!DOMINIO!'; [IO.File]::WriteAllLines($p, [string[]]$l, (New-Object Text.UTF8Encoding $false))"

echo    Pasando nginx a HTTPS...
docker compose -f "%COMPOSE_FILE%" up -d nginx api
if !ERRORLEVEL! neq 0 goto https_revertir
docker compose -f "%COMPOSE_FILE%" exec -T nginx nginx -t >nul 2>&1
if !ERRORLEVEL! neq 0 goto https_revertir

set "HTTPS_OK=si"
set "CONF_FINAL=./nginx.conf"
set "URL_FINAL=https://!DOMINIO!"
echo    HTTPS activo.
goto resumen

:https_revertir
echo.
echo    [ERROR] nginx no arranco con la configuracion HTTPS. Se vuelve atras.
powershell -NoProfile -Command "$p='%ENV_FILE%'; $l=(Get-Content $p -Encoding UTF8) -replace '^NGINX_CONF=.*','NGINX_CONF=./nginx.http.conf'; [IO.File]::WriteAllLines($p, [string[]]$l, (New-Object Text.UTF8Encoding $false))"
docker compose -f "%COMPOSE_FILE%" up -d nginx >nul 2>&1

:sin_https
set "SIN_HTTPS=si"
echo.
echo  ------------------------------------------------------------
echo    EL SERVIDOR NO QUEDO CON HTTPS
echo.
echo    Publicado asi a internet, cualquiera en el camino de red
echo    ^(wifi de la oficina, proveedor, nodos intermedios^) ve las
echo    contrasenas y los tokens de sesion en claro.
echo  ------------------------------------------------------------
echo.
set "IGUAL="
set /p "IGUAL=   Dejarlo publicado igual, sin cifrar? [S/N]: "
if /I "!IGUAL!"=="S" goto sin_https_seguir

:: rm -sf y no stop: nginx y duckdns tienen restart:always, asi que un `stop` los
:: revive en el proximo arranque de Docker y la app volveria a quedar publicada
:: sin cifrar sin que nadie lo pida.
docker compose -f "%COMPOSE_FILE%" --profile duckdns rm -sf nginx duckdns >nul 2>&1
set "PUBLICACION_DETENIDA=si"
echo.
echo    Publicacion detenida. La base y el API quedan intactos:
echo    no se pierde nada de lo que se instalo.
goto resumen

:sin_https_seguir
:: PUBLIC_URL quedaria en https:// mientras se entra por http://: con esa mezcla
:: el navegador descarta la cookie de sesion y CORS rechaza el origen real.
powershell -NoProfile -Command "$p='%ENV_FILE%'; $l=(Get-Content $p -Encoding UTF8) -replace '^PUBLIC_URL=https://','PUBLIC_URL=http://'; [IO.File]::WriteAllLines($p, [string[]]$l, (New-Object Text.UTF8Encoding $false))"
docker compose -f "%COMPOSE_FILE%" up -d api >nul 2>&1
set "URL_FINAL=http://!DOMINIO!"
goto resumen

:: ============================================================
::  RESUMEN
:: ============================================================
:resumen
:: Solo se limpia la pantalla si no hay nada que leer mas arriba
:: (por ejemplo el detalle de por que fallo el certificado).
if not "!SIN_HTTPS!"=="si" cls
color 0A
echo.
echo  ============================================================
echo.
if "!PUBLICACION_DETENIDA!"=="si" goto resumen_detenido
echo    INSTALACION COMPLETADA
goto resumen_datos
:resumen_detenido
echo    INSTALADO - PERO TODAVIA SIN PUBLICAR
:resumen_datos
echo.
echo  ============================================================
echo.
echo    Direccion:  !URL_FINAL!
echo.
echo    Primer ingreso:
echo      Usuario:     admin@wenlen.com
:: El signo final va como ^^!: con delayed expansion un ! suelto no se imprime
echo      Contrasena:  Admin2026^^!
echo      ^(la aplicacion pide cambiarla al entrar^)
echo.
echo  ------------------------------------------------------------

if "!PUBLICACION_DETENIDA!"=="si" goto aviso_detenido
if "!HTTPS_OK!"=="si" goto aviso_https_ok
if "!SIN_HTTPS!"=="si" goto aviso_sin_https
goto comandos

:aviso_detenido
echo.
echo    nginx y duckdns quedaron detenidos: la aplicacion no esta
echo    publicada. Se hizo asi para no exponer las contrasenas en
echo    claro a internet.
echo.
echo    Cuando los puertos 80 y 443 esten reenviados en el router,
echo    volve a ejecutar este instalador: conserva el .env, emite el
echo    certificado y publica con HTTPS.
echo.
echo  ------------------------------------------------------------
goto comandos

:aviso_https_ok
echo.
echo    HTTPS activo con certificado de Let's Encrypt.
echo    Vence a los 90 dias; renovarlo cada 60 con:
echo.
echo       docker compose -f docker-compose.prod.yml --profile certbot run --rm certbot renew
echo       docker compose -f docker-compose.prod.yml restart nginx
echo.
echo  ------------------------------------------------------------
goto comandos

:aviso_sin_https
echo.
echo    ATENCION: la aplicacion quedo publicada SIN CIFRAR ^(http://^).
echo    Las contrasenas viajan en claro. Para pasar a HTTPS: reenviar
echo    los puertos 80 y 443 en el router y volver a ejecutar este
echo    instalador.
echo.
echo  ------------------------------------------------------------

:comandos
echo.
echo    Comandos utiles:
echo      Estado:    docker compose -f docker-compose.prod.yml ps
echo      Registros: docker compose -f docker-compose.prod.yml logs -f api
echo      Detener:   docker compose -f docker-compose.prod.yml down
echo.
echo    Guia completa: docs\puesta_en_marcha_docker.pdf
echo.
pause
exit /b 0

:: ============================================================
::  INSTALACION EN LINUX
:: ============================================================
:linux
cls
echo.
echo  ============================================================
echo    INSTALACION EN UN SERVIDOR LINUX
echo  ============================================================
echo.
echo    Este archivo .bat solo corre en Windows, asi que no puede
echo    instalar por si mismo dentro del servidor Linux. Lo que sigue
echo    es todo lo que hay que hacer alla, en orden.
echo.
echo    Copiar y pegar en la terminal del servidor Linux:
echo.
echo  ------------------------------------------------------------
echo.
echo    # 1. Instalar Docker
echo    curl -fsSL https://get.docker.com ^| sudo sh
echo    sudo usermod -aG docker $USER
echo    sudo systemctl enable --now docker
echo.
echo    # 2. Traer el proyecto (o copiarlo con scp desde esta PC)
echo    sudo mkdir -p /opt/planilla ^&^& sudo chown $USER /opt/planilla
echo    git clone ^<URL-DEL-REPOSITORIO^> /opt/planilla
echo.
echo    # 3. Instalar (hace todo: requisitos, .env, imagenes, datos)
echo    cd /opt/planilla ^&^& bash deploy/bootstrap.sh
echo.
echo  ------------------------------------------------------------
echo.
echo    Despues de "usermod" hay que cerrar sesion y volver a entrar
echo    para que el usuario pueda usar docker sin sudo.
echo.
echo    El detalle completo esta en el capitulo 4 de:
echo      docs\puesta_en_marcha_docker.pdf
echo.
set "COPIAR="
set /p "COPIAR=   Copiar estos comandos al portapapeles? [S/N]: "
if /I "!COPIAR!"=="S" (
    powershell -NoProfile -Command "Set-Clipboard -Value @('curl -fsSL https://get.docker.com | sudo sh', 'sudo usermod -aG docker $USER', 'sudo systemctl enable --now docker', 'sudo mkdir -p /opt/planilla && sudo chown $USER /opt/planilla', 'git clone <URL-DEL-REPOSITORIO> /opt/planilla', 'cd /opt/planilla && bash deploy/bootstrap.sh')"
    echo    Comandos copiados.
)
echo.
pause
exit /b 0

:: ============================================================
::  SUBRUTINAS
:: ============================================================
:ok
echo   [ OK ]    %~1
exit /b 0

:aviso
echo   [AVISO]   %~1
set /a AVISOS+=1
exit /b 0

:error
echo   [ERROR]   %~1
set /a ERRORES+=1
exit /b 0
