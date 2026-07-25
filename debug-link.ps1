<#
.SYNOPSIS
    Arma el link de acceso en modo debug para el testing remoto.

.DESCRIPTION
    El modo debug del API deja entrar a cualquier cuenta sin la contraseña real,
    pero el selector de usuarios sólo aparece en el dispositivo que trajo la
    clave una vez en la dirección (?debug=CLAVE). Sin ese link hay que tipear
    las contraseñas a mano.

    Esto vive en PowerShell y no en el .bat a propósito: la clave puede contener
    caracteres que el batch destruye. Con `setlocal enabledelayedexpansion` un
    `!` final se pierde en silencio, y escaparlo como %21 tampoco sirve porque
    dentro de un .bat `%2` se interpreta como parámetro. La solución es que el
    batch nunca toque la cadena: acá se escribe a un archivo y allá se vuelca
    con `type`, que no expande nada.

    Las tres condiciones espejan apps/api/src/utils/debug-auth.utils.ts. Si
    alguna no se cumple el modo queda apagado del lado del servidor, así que
    el link no serviría de nada y conviene decir por qué.
#>
param(
    [Parameter(Mandatory = $true)][string]$EnvFile,
    [Parameter(Mandatory = $true)][string]$WebUrl,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [string]$LinkFile
)

$ErrorActionPreference = 'Stop'

$urlPath = Join-Path $OutDir 'debug-url.txt'
$motivoPath = Join-Path $OutDir 'debug-motivo.txt'
Remove-Item -LiteralPath $urlPath, $motivoPath -ErrorAction SilentlyContinue

# ASCII y no UTF8: powershell.exe 5.1 le mete BOM a los archivos UTF8, y ese
# BOM aparece pegado al principio de la URL cuando el .bat la vuelca con `type`.
# Copiarla desde ahí daría un link roto. Todo lo que se escribe acá es ASCII.
function Escribir-Motivo([string]$texto) {
    Set-Content -LiteralPath $motivoPath -Value $texto -Encoding ASCII
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
    Escribir-Motivo "no se encontro $EnvFile"
    exit 0
}

# Parseo simple de .env: KEY=VALUE, ignorando comentarios y líneas vacías.
# El valor puede contener '=' (por ejemplo una URL de conexión), así que se
# corta en el PRIMER separador nada más.
$vars = @{}
foreach ($linea in Get-Content -LiteralPath $EnvFile) {
    $t = $linea.Trim()
    if ($t.Length -eq 0 -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $clave = $t.Substring(0, $i).Trim()
    $valor = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
    $vars[$clave] = $valor
}

$debugAuth = $vars['DEBUG_AUTH']
$clave = $vars['DEBUG_AUTH_PASSWORD']
$nodeEnv = $vars['NODE_ENV']

if ($debugAuth -ne 'true') {
    Escribir-Motivo 'DEBUG_AUTH no esta en true'
    exit 0
}
if ([string]::IsNullOrWhiteSpace($clave)) {
    Escribir-Motivo 'falta DEBUG_AUTH_PASSWORD'
    exit 0
}
if ($nodeEnv -eq 'production') {
    Escribir-Motivo 'NODE_ENV=production apaga el modo debug'
    exit 0
}

# Se escapa la clave para que sirva cualquier carácter en el query string.
# EscapeDataString deja pasar !*'() por ser sub-delims válidos, pero el '!' es
# justamente el que el batch destruye al mostrarlo con enabledelayedexpansion,
# así que se fuerza a %21. El navegador lo decodifica igual.
$claveEscapada = [uri]::EscapeDataString($clave).Replace('!', '%21')
$url = "$($WebUrl.TrimEnd('/'))/?debug=$claveEscapada"
Set-Content -LiteralPath $urlPath -Value $url -Encoding ASCII

if ($LinkFile) {
    $bloque = @(
        ''
        '----------------------------------------------------'
        'NO COMPARTIR - link con modo debug (solo para vos):'
        $url
        ''
        'Abrilo UNA vez por dispositivo. Despues de eso el'
        'selector de usuarios queda disponible en ese equipo'
        'y podes seguir usando el link normal de arriba.'
        '----------------------------------------------------'
    )
    Add-Content -LiteralPath $LinkFile -Value $bloque -Encoding ASCII
}
