@echo off
rem Builds the Orbit Windows app into one file: dist\Orbit.exe
rem Uses a clean virtual environment so unrelated packages (torch, tensorflow...) are not bundled.
cd /d "%~dp0"

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

if exist "%~dp0dist" rmdir /s /q "%~dp0dist"
python -m PyInstaller --noconfirm --clean --onefile --windowed --name Orbit --icon "%~dp0orbit.ico" ^
  --distpath "%~dp0dist" --workpath "%~dp0build" --specpath "%~dp0build" ^
  --add-data "%~dp0static;static" ^
  --add-binary "%FFMPEG_DIR%ffmpeg.exe;bin" --add-binary "%FFMPEG_DIR%ffprobe.exe;bin" ^
  --collect-submodules yt_dlp --collect-all webview ^
  desktop.py || goto :fail

echo.
echo Done: %~dp0dist\Orbit.exe
exit /b 0

:fail
echo Build failed.
exit /b 1
