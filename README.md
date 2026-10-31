<div align="center">

  <a href="https://damsarachethiyaa-dev.github.io/orbit/">
    <img src="docs/app-icon.svg" width="112" alt="Orbit App Icon" />
  </a>

  # Orbit

  ### Desktop App — Windows 10 & 11

  **Paste any link. Download anything.**  
  *Untouched 4K / 8K & lossless MP3 • 100% offline localhost • Zero subscriptions • Zero cloud leaks.*

  <br />

  <p>
    <a href="https://github.com/damsarachethiyaa-dev/orbit/releases/latest/download/Orbit-Setup.exe">
      <img src="https://img.shields.io/badge/DOWNLOAD_INSTALLER-.EXE_(V1.0.2)-00e676?style=for-the-badge&logo=windows&logoColor=white&labelColor=23272e" alt="Download Installer" />
    </a>
    &nbsp;
    <a href="https://damsarachethiyaa-dev.github.io/orbit/">
      <img src="https://img.shields.io/badge/LIVE_SHOWCASE-INTERACTIVE_DEMO-7c4dff?style=for-the-badge&logo=googlechrome&logoColor=white&labelColor=23272e" alt="Live Showcase" />
    </a>
  </p>

  <p>
    <a href="https://github.com/damsarachethiyaa-dev/orbit/releases/latest">
      <img src="https://img.shields.io/badge/WINDOWS-10_%7C_11-0091ea?style=for-the-badge&logo=windows&logoColor=white&labelColor=23272e" alt="Windows 10 & 11" />
    </a>
    &nbsp;
    <a href="https://github.com/yt-dlp/yt-dlp">
      <img src="https://img.shields.io/badge/ENGINE-YT--DLP_&_FFMPEG-00e676?style=for-the-badge&logo=gnu&logoColor=white&labelColor=23272e" alt="Engine yt-dlp & FFmpeg" />
    </a>
    &nbsp;
    <a href="https://damsarachethiyaa-dev.github.io/orbit/">
      <img src="https://img.shields.io/badge/STORAGE-100%25_LOCAL-7c4dff?style=for-the-badge&labelColor=23272e" alt="100% Local Storage" />
    </a>
    &nbsp;
    <a href="LICENSE">
      <img src="https://img.shields.io/badge/EDITION-MIT_OPEN_SOURCE-ff6d00?style=for-the-badge&labelColor=23272e" alt="MIT Open Source" />
    </a>
  </p>

  <p>
    <a href="https://github.com/damsarachethiyaa-dev/orbit">
      <img src="https://img.shields.io/badge/VERIFIED_DOWNLOADS-FREE_&_PRIVATE-00e676?style=for-the-badge&logo=github&logoColor=white&labelColor=23272e" alt="Free & Private" />
    </a>
    &nbsp;
    <a href="https://github.com/damsarachethiyaa-dev/orbit/releases/latest">
      <img src="https://img.shields.io/badge/RELEASE-V1.0.2-00b0ff?style=for-the-badge&logo=github&logoColor=white&labelColor=23272e" alt="Release v1.0.2" />
    </a>
  </p>

  <br />

  <a href="https://damsarachethiyaa-dev.github.io/orbit/">
    <img src="docs/screenshots/app-preview.png" width="92%" alt="Orbit Windows Desktop App Showcase" style="border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.5);" />
  </a>

</div>

<br />

---

## 🌐 Official Website & Live Showcase

Experience the full interactive editorial website, live 4K walkthrough player, platform support directory, and architecture breakdown:

👉 **[https://damsarachethiyaa-dev.github.io/orbit/](https://damsarachethiyaa-dev.github.io/orbit/)**

---

## ✨ Features

- **⚡ Instant Clipboard Sensing:** Orbit automatically detects copied video links from your clipboard. Paste, press Fetch, and choose your resolution.
- **🎬 Untouched 4K / 8K, 60fps & HDR:** Downloads raw video streams directly from the source CDNs with zero transcoding loss.
- **🎵 Lossless Audio Extraction:** One-click conversion to pristine 320kbps MP3 with automatic ID3 metadata and album art.
- **📦 Zero Dependencies, Pre-Bundled:** Includes embedded FFmpeg, FFprobe, and the yt-dlp core. No terminal, no Python, no codec installs needed.
- **📥 Parallel Multi-Download Queue:** Run concurrent background downloads with live throughput speeds (MB/s), elapsed time, and ETA countdowns.
- **📁 Local-First Media Library:** Automatically catalogs your finished downloads with thumbnails. One click to play or reveal directly in Windows Explorer.
- **🔒 100% Private & Offline:** Zero sign-ups, zero accounts, zero cloud telemetry, and zero ads. Nothing ever leaves your PC.

---

## 🖥️ Screen Previews

| Multi-Download Queue | Local Offline Library | Configurable Settings |
|:---:|:---:|:---:|
| <a href="https://damsarachethiyaa-dev.github.io/orbit/"><img src="docs/screenshots/app-download.png" width="100%" alt="Download Queue" /></a> | <a href="https://damsarachethiyaa-dev.github.io/orbit/"><img src="docs/screenshots/app-library.png" width="100%" alt="Media Library" /></a> | <a href="https://damsarachethiyaa-dev.github.io/orbit/"><img src="docs/screenshots/app-settings.png" width="100%" alt="Settings" /></a> |

---

## 🚀 Quick Start (Windows)

1. Download the Windows Setup Installer from **[Releases (v1.0.2)](https://github.com/damsarachethiyaa-dev/orbit/releases/latest/download/Orbit-Setup.exe)** (`Orbit-Setup.exe`).
2. Double-click `Orbit-Setup.exe` to install Orbit and launch it.
3. Paste any video or audio link (YouTube, TikTok, Instagram, X, Vimeo, Reddit, Twitch, etc.) and hit **Fetch**.
4. Choose **Video** (4K, 1440p, 1080p, 720p) or **Audio** (MP3) and click **Download**.

> [!NOTE]  
> Because Orbit is a standalone open-source release that is not code-signed with an enterprise certificate, Windows SmartScreen may show a prompt on first run: click **More info → Run anyway**.

---

## 🛠️ Building from Source

### Requirements
- Python 3.11+
- Windows 10 or 11 (64-bit) with Edge WebView2 Runtime

### Setup & Run
```powershell
git clone https://github.com/damsarachethiyaa-dev/orbit.git
cd orbit

# Create virtual environment & install dependencies
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt

# Run Desktop Application
python desktop.py
```

### Build Single Executable (.exe)
```cmd
build.bat
```
The output standalone binary will be generated at `dist\Orbit.exe`.

---

## 📂 Project Structure

```text
orbit/
├── docs/                 # GitHub Pages website (https://damsarachethiyaa-dev.github.io/orbit/)
│   ├── css/              # Editorial typography & dark monochrome design system
│   ├── js/               # Lenis inertial scroll, glowing thread & motion physics
│   ├── icons/            # 28+ official platform SVG brand marks
│   ├── screenshots/      # High-resolution application screenshots
│   └── index.html        # Main landing page
├── static/               # Local website & embedded desktop assets
├── app.py                # Flask backend with yt-dlp & FFmpeg pipeline
├── desktop.py            # pywebview Windows desktop wrapper
├── build.bat             # PyInstaller standalone .exe compilation script
└── requirements.txt      # Python dependencies
```

---

## 📜 Responsible Use & License

Orbit is distributed under the **[MIT License](LICENSE)**.

Orbit is designed to save media you own or have the explicit right to download for personal offline archiving. Videos protected by DRM (e.g. Netflix, Disney+, Prime Video, Spotify) or private accounts cannot be downloaded.
