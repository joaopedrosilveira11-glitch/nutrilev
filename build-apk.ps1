# Script para atualizar o app Android e gerar APK/AAB do Nutrilev.
# Exemplos:
# .\build-apk.ps1 -Format apk -BuildType debug
# .\build-apk.ps1 -Format aab -BuildType release

param(
    [ValidateSet("apk", "aab")]
    [string]$Format = "apk",
    [ValidateSet("debug", "release")]
    [string]$BuildType = "release",
    [int]$VersionCode = 0,
    [string]$VersionName = ""
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$www = Join-Path $root "www"

$defaultAndroidSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT -and (Test-Path $defaultAndroidSdk)) {
    $env:ANDROID_HOME = $defaultAndroidSdk
    $env:ANDROID_SDK_ROOT = $defaultAndroidSdk
}
if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
    throw "Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT before building."
}

Write-Host "==> Copiando arquivos web atualizados para www\..." -ForegroundColor Cyan
$filesToCopy = @(
    "app.html", "theme.js", "platform.js", "platform.css", "platform-density.css",
    "lib\config.js", "utils\index.js", "utils\html.js",
    "components\index.js", "components\ui.js", "services\index.js",
    "services\supabase.js", "services\platform-data.js", "services\deep-links.js",
    "services\push-notifications.js", "auth\roles.js",
    "mobile\index.js", "nutrition\index.js", "workout\index.js", "progress\index.js",
    "academy\index.js", "notifications\index.js", "ai\index.js",
    "hooks\session.js", "types\domain.js", "layouts\platform-shell.js",
    "pages\routes.js", "dashboard\index.js", "student\index.js",
    "features\dashboard\index.js", "features\student\index.js"
)
foreach ($file in $filesToCopy) {
    $src = Join-Path $root $file
    if (Test-Path $src) {
        $destination = if ($file -eq "app.html") { "index.html" } else { $file }
        $destinationPath = Join-Path $www $destination
        $destinationDirectory = Split-Path $destinationPath -Parent
        if (-not (Test-Path $destinationDirectory)) {
            New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        }
        Copy-Item $src -Destination $destinationPath -Force
        Write-Host "  - $file copiado como $destination"
    }
}

$assetsSrc = Join-Path $root "assets"
if (Test-Path $assetsSrc) {
    Copy-Item $assetsSrc -Destination $www -Recurse -Force
    Write-Host "  - assets\ copiado"
}

Write-Host "==> Sincronizando com o projeto Android (npx cap sync android)..." -ForegroundColor Cyan
Push-Location $root
npx cap sync android
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    throw "Falha no cap sync"
}
Pop-Location

if ($BuildType -eq "release" -and -not (Test-Path (Join-Path $root "android\keystore.properties")) -and -not $env:NUTRILEV_KEYSTORE_FILE) {
    throw "Release builds require android\keystore.properties or NUTRILEV_KEYSTORE_FILE, NUTRILEV_KEYSTORE_PASSWORD, NUTRILEV_KEY_ALIAS and NUTRILEV_KEY_PASSWORD environment variables."
}

$buildTypeSuffix = $BuildType.Substring(0, 1).ToUpper() + $BuildType.Substring(1)
$gradleTask = if ($Format -eq "aab") { "bundle$buildTypeSuffix" } else { "assemble$buildTypeSuffix" }
$outputDirectory = if ($Format -eq "aab") { "bundle\$BuildType" } else { "apk\$BuildType" }
$artifactName = if ($Format -eq "aab") { "app-$BuildType.aab" } else { "app-$BuildType.apk" }
$gradleProperties = @()
if ($VersionCode -gt 0) {
    $gradleProperties += "-PNUTRILEV_VERSION_CODE=$VersionCode"
}
if ($VersionName) {
    $gradleProperties += "-PNUTRILEV_VERSION_NAME=$VersionName"
}

Write-Host "==> Gerando $Format $BuildType ($gradleTask)..." -ForegroundColor Cyan
Push-Location (Join-Path $root "android")
.\gradlew.bat $gradleTask @gradleProperties
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    throw "Falha no build do Gradle"
}
Pop-Location

$artifactSource = Join-Path $root "android\app\build\outputs\$outputDirectory\$artifactName"
if (-not (Test-Path $artifactSource)) {
    throw "Artefato não encontrado após o build: $artifactSource"
}

$artifactDestination = Join-Path $root ("Nutrilev-" + $BuildType + "." + $Format)
Copy-Item $artifactSource -Destination $artifactDestination -Force

Write-Host ""
Write-Host "==> $Format gerado com sucesso!" -ForegroundColor Green
Write-Host "    $artifactDestination" -ForegroundColor Green
