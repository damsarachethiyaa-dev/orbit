<#
  Builds the signed Orbit.apk (release).

  The keystore path and passwords are asked for here and only exist in this
  PowerShell process while Gradle runs. Nothing is written to disk or to git.

  Usage (from the repo root):   powershell -ExecutionPolicy Bypass -File android\build-release.ps1
#>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$defaultKeystore = Join-Path $here 'app\orbit-release.jks'
$ks = Read-Host "Keystore path [$defaultKeystore]"
if ([string]::IsNullOrWhiteSpace($ks)) { $ks = $defaultKeystore }
if (-not (Test-Path $ks)) { throw "Keystore not found: $ks" }

function Read-Plain($prompt) {
    $s = Read-Host $prompt -AsSecureString
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$alias = Read-Host 'Key alias'
$storePw = Read-Plain 'Keystore password'
$keyPw = Read-Plain 'Key password (press Enter if the same as the keystore password)'
if ([string]::IsNullOrEmpty($keyPw)) { $keyPw = $storePw }

$env:ORBIT_KEYSTORE = (Resolve-Path $ks).Path
$env:ORBIT_KEY_ALIAS = $alias
$env:ORBIT_KEYSTORE_PASSWORD = $storePw
$env:ORBIT_KEY_PASSWORD = $keyPw

try {
    Push-Location $here
    & .\gradlew.bat --console=plain assembleRelease
    if ($LASTEXITCODE -ne 0) { throw 'Gradle build failed.' }
} finally {
    Pop-Location
    Remove-Item Env:ORBIT_KEYSTORE, Env:ORBIT_KEY_ALIAS, Env:ORBIT_KEYSTORE_PASSWORD, Env:ORBIT_KEY_PASSWORD -ErrorAction SilentlyContinue
}

$apk = Join-Path $here 'app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $apk)) { throw 'Build finished but app-release.apk was not produced (the key was not applied).' }

$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk\build-tools'
$signer = Get-ChildItem $sdk -Recurse -Filter apksigner.bat | Sort-Object FullName | Select-Object -Last 1
if ($signer) { & $signer.FullName verify --print-certs $apk }

$out = Join-Path (Split-Path -Parent $here) 'dist\Orbit.apk'
New-Item -ItemType Directory -Force (Split-Path -Parent $out) | Out-Null
Copy-Item $apk $out -Force
Write-Host ''
Write-Host "Signed APK ready: $out" -ForegroundColor Green
Write-Host ("SHA-256: " + (Get-FileHash $out -Algorithm SHA256).Hash)
