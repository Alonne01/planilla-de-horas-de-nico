@echo off
echo ==========================================
echo  Planilla de Horas - Inicio de Desarrollo
echo ==========================================
echo.

REM Verificar PostgreSQL
echo [1/4] Verificando PostgreSQL...
sc query "postgresql-x64-16" >nul 2>&1
if errorlevel 1 (
    echo   ❌ PostgreSQL no está corriendo. Iniciando...
    net start postgresql-x64-16
) else (
    echo   ✅ PostgreSQL corriendo
)

REM Ejecutar migraciones
echo.
echo [2/4] Ejecutando migraciones Prisma...
cd /d "%~dp0apps\api"
call npx prisma migrate deploy 2>nul || (
    echo   ⚠  Migraciones ya aplicadas
)

REM Verificar seed
echo.
echo [3/4] Verificando datos de seed...
call npx tsx prisma/seed.ts 2>nul || (
    echo   ⚠  Seeds ya ejecutados o error
)

REM Iniciar servicios
echo.
echo [4/4] Iniciando servicios...
echo.
echo   API:      http://localhost:4000
echo   Frontend: http://localhost:3000
echo.
echo   Usuarios de prueba:
echo     admin@demo.com       / Admin1234!
echo     rrhh@demo.com        / Admin1234!
echo     operador@demo.com    / Admin1234!
echo.

start "API" cmd /c "cd /d "%~dp0apps\api" && npm run dev"
start "Web" cmd /c "cd /d "%~dp0apps\web" && npm run dev"

echo ==========================================
echo  Servidores iniciados en ventanas aparte
echo ==========================================
pause
