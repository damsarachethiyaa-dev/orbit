<p align="center">
  <img src="static/logo-mark.svg" width="88" alt="Orbit logo">
</p>

<h1 align="center">Orbit</h1>

<p align="center"><b>Paste a link. Download the video.</b><br>
A Windows app for saving videos and audio from YouTube, TikTok, Instagram, X, Vimeo, Reddit and 1000+ other sites.</p>

<p align="center"><a href="../../releases/latest"><b>⬇ Download Orbit.exe</b></a></p>

![Orbit download screen](docs/screenshots/app-preview.png)

## Features

- **One box for any link.** Paste, drop a link onto the window, or let Orbit spot a link you just copied.
- **Video or audio.** MP4 in the best quality, 4K, 1440p, 1080p, 720p or 480p, or audio only as MP3.
- **Download queue.** Run several downloads at once with live progress, speed and time left. Cancel any of them.
- **Library.** Everything you downloaded, with thumbnails and one-click Open or Show in folder.
- **Settings.** Pick the save folder (default `Downloads\Orbit Videos`) and a default quality.
- **One file, no install.** `Orbit.exe` includes everything it needs, including ffmpeg and fonts. Downloads run on your own PC.

| Queue | Library | Settings |
|---|---|---|
| ![Queue](docs/screenshots/app-download.png) | ![Library](docs/screenshots/app-library.png) | ![Settings](docs/screenshots/app-settings.png) |

## Using it

1. Download `Orbit.exe` from the [latest release](../../releases/latest) and double-click it.
2. Paste a video link and press **Fetch**.
3. Choose **Video** or **Audio** and a quality, then press **Download**.

Requirements: Windows 10 or 11 with the Microsoft Edge WebView2 Runtime (already installed on almost every Windows 11 PC; [get it here](https://developer.microsoft.com/microsoft-edge/webview2/) if Orbit says it is missing).

The first launch takes a few seconds while Windows unpacks the app. Because the exe is not code-signed, Windows SmartScreen may warn you: choose **More info → Run anyway**.

Settings, library and logs are stored in `%LOCALAPPDATA%\Orbit`. If something goes wrong, `orbit.log` there has the details.

## Building from source

Needs Python 3.12+ and ffmpeg on your PATH (or set `FFMPEG_DIR`).

```bat
build.bat
```

This creates a clean virtual environment, installs the packages in `requirements.txt` and writes `dist\Orbit.exe`.

To run without building:

```bat
pip install -r requirements.txt
python desktop.py
```

### Website version

The same backend also serves Orbit as a website (`static/index.html`): run `start.bat` or `python app.py` and open http://127.0.0.1:5000.

## Project layout

| Path | What it is |
|---|---|
| `app.py` | Flask backend around yt-dlp (website mode and desktop mode) |
| `desktop.py` | Windows app: starts the backend on a private local port and opens it in a native window |
| `static/desktop/` | The desktop app's interface |
| `static/` | The website, brand icons, fonts and globe data |
| `build.bat` | Builds `dist\Orbit.exe` with PyInstaller |

## Responsible use

Only download content you own, that is licensed for it, or that you have permission to save. Videos protected by DRM (Netflix, Disney+, Prime Video, Spotify) and private videos cannot be downloaded.

## Credits

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) does the downloading (Unlicense).
- [FFmpeg](https://ffmpeg.org) merges streams and converts audio. The release exe bundles an FFmpeg build licensed under the GPL v3; its source is available from [ffmpeg.org](https://ffmpeg.org/download.html) and [gyan.dev](https://www.gyan.dev/ffmpeg/builds/).
- [pywebview](https://pywebview.flowrl.com), [Flask](https://flask.palletsprojects.com) and [PyInstaller](https://pyinstaller.org).
- Brand icons from [Simple Icons](https://simpleicons.org) (CC0). Brand names and logos belong to their owners.
- Fonts: Archivo, Doto and JetBrains Mono (SIL Open Font License, see `static/fonts`).
- Globe map data from [Natural Earth](https://www.naturalearthdata.com) via world-atlas (public domain).
