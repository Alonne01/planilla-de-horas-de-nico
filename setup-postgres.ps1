param(
    [Parameter(Mandatory = $true)][string]$EnvFile,
    [Parameter(Mandatory = $true)][string]$SuperuserPassword,
    [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin"
)

$ErrorActionPreference = 'Stop'

$line = Get-Content $EnvFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $line) {
    Write-Error "No se encontro DATABASE_URL en $EnvFile"
    exit 1
}

$rawUrl = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
$uri = [uri]$rawUrl
$userInfo = $uri.UserInfo -split ':', 2
$dbUser = [uri]::UnescapeDataString($userInfo[0])
$dbPass = [uri]::UnescapeDataString($userInfo[1])
$dbName = $uri.AbsolutePath.TrimStart('/')

$psql = Join-Path $PgBin "psql.exe"
if (-not (Test-Path $psql)) {
    Write-Error "No se encontro psql.exe en $PgBin"
    exit 1
}

$env:PGPASSWORD = $SuperuserPassword

$userExists = & $psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_roles WHERE rolname='$dbUser'" 2>$null
if ($userExists -ne "1") {
    $escapedPass = $dbPass -replace "'", "''"
    & $psql -U postgres -h localhost -c "CREATE USER `"$dbUser`" WITH PASSWORD '$escapedPass';" | Out-Null
    Write-Host "Usuario Postgres '$dbUser' creado."
} else {
    Write-Host "Usuario Postgres '$dbUser' ya existia."
}

$dbExists = & $psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'" 2>$null
if ($dbExists -ne "1") {
    & $psql -U postgres -h localhost -c "CREATE DATABASE `"$dbName`" OWNER `"$dbUser`";" | Out-Null
    Write-Host "Base '$dbName' creada."
} else {
    Write-Host "Base '$dbName' ya existia."
}

Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
