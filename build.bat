@echo off
rem Builds the Orbit Windows app (--onedir) and packages it into a Windows Installer: dist\Orbit-Setup.exe
rem Uses a clean virtual environment so unrelated packages (torch, tensorflow...) are not bundled.
cd /d "%~dp0"

taskkill /F /IM Orbit.exe >nul 2>&1

if not exist .venv-build (
    python -m venv .venv-build || goto :fail
)
call .venv-build\Scripts\activate.bat
python -m pip install -q -U pip
python -m pip install -q -U -r requirements.txt || goto :fail

rem ffmpeg + ffprobe are bundled so the app works on PCs without ffmpeg installed.
rem Set FFMPEG_DIR to the folder that holds them, or have ffmpeg on PATH.
if not defined FFMPEG_DIR (
    for /f "delims=" %%i in ('where ffmpeg') do set "FFMPEG_DIR=%%~dpi"
)
if not exist "%FFMPEG_DIR%ffmpeg.exe" (
    echo Could not find ffmpeg.exe. Install ffmpeg or set FFMPEG_DIR.
    goto :fail
)

if exist "%~dp0dist\Orbit" rmdir /s /q "%~dp0dist\Orbit"
if exist "%~dp0dist\Orbit-Setup.exe" del /q "%~dp0dist\Orbit-Setup.exe"
if not exist "%~dp0dist" mkdir "%~dp0dist"
python -m PyInstaller --noconfirm --clean --onedir --contents-directory _internal --windowed ^
  --name Orbit --icon "%~dp0orbit.ico" --version-file "%~dp0version_info.txt" ^
  --distpath "%~dp0dist" --workpath "%~dp0build" --specpath "%~dp0build" ^
  --paths . ^
  --add-data "%~dp0static;static" ^
  --add-binary "%FFMPEG_DIR%ffmpeg.exe;bin" --add-binary "%FFMPEG_DIR%ffprobe.exe;bin" ^
  --collect-submodules yt_dlp --collect-all webview ^
  desktop.py || goto :fail

powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -Path '%~dp0dist\Orbit\Orbit.exe'" >nul 2>&1

rem Locate NSIS (makensis.exe) to build the Windows Setup Installer
set "MAKENSIS="
for /f "delims=" %%i in ('where makensis 2^>nul') do set "MAKENSIS=%%i"
if not defined MAKENSIS if exist "C:\Program Files (x86)\NSIS\makensis.exe" set "MAKENSIS=C:\Program Files (x86)\NSIS\makensis.exe"
if not defined MAKENSIS if exist "C:\Program Files\NSIS\makensis.exe" set "MAKENSIS=C:\Program Files\NSIS\makensis.exe"
if not defined MAKENSIS (
    for /f "delims=" %%i in ('powershell -NoProfile -Command "$m = Get-ChildItem \"$env:LOCALAPPDATA\electron-builder\Cache\" -Recurse -Filter makensis.exe -ErrorAction SilentlyContinue | Select-Object -First 1; if ($m) { $m.FullName }"') do set "MAKENSIS=%%i"
)

if not defined MAKENSIS (
    echo Could not find makensis.exe to build installer.
    goto :fail
)

echo Building Windows Setup Installer with NSIS...
"%MAKENSIS%" /V2 "%~dp0installer.nsi" || goto :fail

powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -Path '%~dp0dist\Orbit-Setup.exe'" >nul 2>&1

echo.
echo Done: %~dp0dist\Orbit-Setup.exe
exit /b 0

:fail
echo Build failed.
exit /b 1
