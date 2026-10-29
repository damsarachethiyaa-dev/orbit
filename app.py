"""Orbit - paste a video link, get the file. Flask backend around yt-dlp.

Runs two ways:
  python app.py        website mode: files are streamed to the visitor's browser
  desktop.py           Windows app mode (ORBIT_DESKTOP=1): files are saved to a folder on this PC,
                       with a download queue, library and settings
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

import yt_dlp
from flask import Flask, abort, jsonify, request, send_file, send_from_directory

DESKTOP = os.environ.get("ORBIT_DESKTOP") == "1"
FROZEN = getattr(sys, "frozen", False)
ROOT = Path(sys._MEIPASS) if FROZEN else Path(__file__).parent          # bundled read-only files
DATA = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Orbit" if DESKTOP else ROOT   # writable files
DOWNLOADS = DATA / "downloads"
DOWNLOADS.mkdir(parents=True, exist_ok=True)
JOB_TTL = 60 * 60  # website mode: delete finished files after an hour

# ffmpeg: use the copy bundled with the app, otherwise whatever is on PATH
_bundled = ROOT / "bin" / "ffmpeg.exe"
FFMPEG = str(_bundled.parent) if _bundled.exists() else None

app = Flask(__name__, static_folder=str(ROOT / "static"), static_url_path="")
jobs: dict[str, dict] = {}
lock = threading.Lock()

QUALITY = {
    "best": "bestvideo*+bestaudio/best",
    "2160": "bestvideo*[height<=2160]+bestaudio/best[height<=2160]",
    "1440": "bestvideo*[height<=1440]+bestaudio/best[height<=1440]",
    "1080": "bestvideo*[height<=1080]+bestaudio/best[height<=1080]",
    "720": "bestvideo*[height<=720]+bestaudio/best[height<=720]",
    "480": "bestvideo*[height<=480]+bestaudio/best[height<=480]",
    "audio": "bestaudio/best",
}

# ---------------------------------------------------------------- settings + library (desktop)
SETTINGS_FILE, HISTORY_FILE = DATA / "settings.json", DATA / "history.json"
DEFAULTS = {"save_dir": str(Path.home() / "Downloads" / "Orbit Videos"), "default_quality": "best"}


def _read(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def _write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def settings() -> dict:
    return {**DEFAULTS, **_read(SETTINGS_FILE, {})}


def save_dir() -> Path:
    return Path(settings()["save_dir"])


def history() -> list:
    return _read(HISTORY_FILE, [])


def add_history(entry: dict):
    with lock:
        _write(HISTORY_FILE, ([entry] + history())[:500])


def read_clipboard() -> str:
    """Plain text from the Windows clipboard (empty string elsewhere or on failure)."""
    if sys.platform != "win32":
        return ""
    import ctypes
    from ctypes import wintypes
    u32, k32 = ctypes.windll.user32, ctypes.windll.kernel32
    u32.OpenClipboard.argtypes = [wintypes.HWND]; u32.OpenClipboard.restype = wintypes.BOOL
    u32.GetClipboardData.argtypes = [wintypes.UINT]; u32.GetClipboardData.restype = wintypes.HANDLE
    k32.GlobalLock.argtypes = [wintypes.HGLOBAL]; k32.GlobalLock.restype = wintypes.LPVOID
    k32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    if not u32.OpenClipboard(None):
        return ""
    try:
        h = u32.GetClipboardData(13)  # CF_UNICODETEXT
        p = k32.GlobalLock(h) if h else None
        if not p:
            return ""
        try:
            return ctypes.wstring_at(p)
        finally:
            k32.GlobalUnlock(h)
    finally:
        u32.CloseClipboard()


def explorer_select(path: Path):
    if sys.platform == "win32":
        subprocess.Popen(["explorer", "/select,", str(path)])


# ---------------------------------------------------------------- helpers
def valid_url(u: str) -> bool:
    p = urlparse(u or "")
    return p.scheme in ("http", "https") and bool(p.netloc)


def cleanup():
    now = time.time()
    with lock:
        for jid, j in list(jobs.items()):
            if j["state"] in ("done", "error") and now - j["created"] > JOB_TTL:
                if not DESKTOP:
                    shutil.rmtree(DOWNLOADS / jid, ignore_errors=True)
                jobs.pop(jid, None)


@app.before_request
def guard():
    """Desktop mode: only the app's own window may talk to the local server."""
    if not DESKTOP:
        return
    if (request.host or "").split(":")[0] not in ("127.0.0.1", "localhost"):
        abort(403)   # blocks DNS-rebinding pages that point a hostname at 127.0.0.1
    if request.method in ("POST", "DELETE") and request.headers.get("X-Orbit") != "1":
        abort(403)   # a custom header forces a CORS preflight, so other websites can't send commands


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "desktop/index.html" if DESKTOP else "index.html")


@app.post("/api/info")
def info():
    url = (request.get_json(silent=True) or {}).get("url", "").strip()
    if not valid_url(url):
        return jsonify(error="That doesn't look like a valid link."), 400
    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True,
                               "skip_download": True}) as ydl:
            d = ydl.extract_info(url, download=False)
    except Exception as e:
        msg = str(e).replace("ERROR: ", "")
        return jsonify(error=msg[:300] or "Couldn't read that link."), 422
    heights = sorted({f["height"] for f in d.get("formats", []) if f.get("height")}, reverse=True)
    return jsonify(
        title=d.get("title"),
        thumbnail=d.get("thumbnail"),
        duration=d.get("duration"),
        uploader=d.get("uploader") or d.get("channel"),
        site=d.get("extractor_key"),
        heights=heights,
    )


def run_job(jid: str, url: str, quality: str):
    job = jobs[jid]
    out = DOWNLOADS / jid
    if DESKTOP:
        out = save_dir()
    out.mkdir(parents=True, exist_ok=True)
    touched = set()   # every file this job writes, so cancel only cleans up its own files

    def hook(d):
        for k in ("filename", "tmpfilename"):
            if d.get(k):
                touched.add(d[k])
        if job.get("cancel"):
            raise yt_dlp.utils.DownloadCancelled("Cancelled")
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            job["percent"] = round(d["downloaded_bytes"] / total * 100, 1) if total else job["percent"]
            job["speed"] = (d.get("_speed_str") or "").strip()
            job["eta"] = (d.get("_eta_str") or "").strip()
        elif d["status"] == "finished":
            job["state"] = "processing"

    opts = {
        "format": QUALITY[quality],
        "outtmpl": str(out / "%(title).120B.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "windowsfilenames": True,
        "merge_output_format": "mp4",
        "progress_hooks": [hook],
    }
    if FFMPEG:
        opts["ffmpeg_location"] = FFMPEG
    if quality == "audio":
        opts.pop("merge_output_format")
        opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3",
                                   "preferredquality": "192"}]
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            meta = ydl.extract_info(url, download=True)
        # ask yt-dlp where the finished file is (several downloads can share one folder)
        rd = (meta.get("requested_downloads") or [{}])[-1]
        best = Path(rd.get("filepath") or meta.get("filepath") or "")
        if not best.is_file():
            raise RuntimeError("No file was produced.")
        job.update(file=best.name, path=str(best) if DESKTOP else None, size=best.stat().st_size, percent=100)
        job["state"] = "done"
        if DESKTOP:
            add_history({"id": jid, "title": job["title"] or best.stem, "site": job["site"], "path": str(best),
                         "size": job["size"], "quality": quality, "thumb": job["thumb"], "t": int(time.time())})
    except yt_dlp.utils.DownloadCancelled:
        for name in touched:   # remove only the partial files this download created
            p = Path(name)
            for f in [p, Path(name + ".part"), Path(name + ".ytdl"), *p.parent.glob(p.name + ".part-Frag*")]:
                f.unlink(missing_ok=True)
        job["state"] = "cancelled"
    except Exception as e:
        job["state"] = "error"
        job["error"] = str(e).replace("ERROR: ", "")[:300]


@app.post("/api/download")
def download():
    body = request.get_json(silent=True) or {}
    url, quality = (body.get("url") or "").strip(), body.get("quality", "best")
    if not valid_url(url) or quality not in QUALITY:
        return jsonify(error="Invalid request."), 400
    cleanup()
    jid = uuid.uuid4().hex[:12]
    jobs[jid] = {"state": "downloading", "percent": 0, "speed": "", "eta": "", "file": None, "path": None,
                 "error": None, "created": time.time(), "cancel": False, "size": None, "quality": quality,
                 "title": str(body.get("title") or "")[:200], "site": str(body.get("site") or "")[:40],
                 "thumb": str(body.get("thumb") or "")[:500], "url": url}
    threading.Thread(target=run_job, args=(jid, url, quality), daemon=True).start()
    return jsonify(id=jid)


def public(jid, j):
    return {"id": jid, "state": j["state"], "percent": j["percent"], "speed": j["speed"], "eta": j["eta"],
            "file": j["file"], "error": j["error"], "saved_to": j.get("path"), "title": j["title"],
            "site": j["site"], "thumb": j["thumb"], "quality": j["quality"], "size": j["size"], "created": j["created"]}


@app.get("/api/status/<jid>")
def status(jid):
    j = jobs.get(jid)
    if not j:
        abort(404)
    return jsonify(public(jid, j))


@app.get("/api/jobs")
def list_jobs():
    return jsonify(sorted((public(k, v) for k, v in jobs.items()), key=lambda x: -x["created"]))


@app.post("/api/cancel/<jid>")
def cancel(jid):
    j = jobs.get(jid)
    if not j:
        abort(404)
    j["cancel"] = True
    return jsonify(ok=True)


@app.post("/api/dismiss/<jid>")
def dismiss(jid):
    j = jobs.get(jid)
    if j and j["state"] in ("done", "error", "cancelled"):
        jobs.pop(jid, None)
    return jsonify(ok=True)


@app.get("/api/file/<jid>")
def file(jid):
    j = jobs.get(jid)
    if not j or j["state"] != "done" or DESKTOP:
        abort(404)
    return send_file(DOWNLOADS / jid / j["file"], as_attachment=True, download_name=j["file"])


# ---------------------------------------------------------------- desktop-only endpoints
def desktop_only():
    if not DESKTOP:
        abort(404)


def entry_path(hid) -> Path:
    e = next((e for e in history() if e["id"] == hid), None)
    if not e:
        abort(404)
    return Path(e["path"])


@app.post("/api/reveal/<jid>")
def reveal(jid):
    """Show a finished file in Explorer (job id or library id)."""
    desktop_only()
    j = jobs.get(jid)
    p = Path(j["path"]) if j and j.get("path") else entry_path(jid)
    if not p.exists():
        abort(404)
    explorer_select(p)
    return jsonify(ok=True)


@app.post("/api/open/<hid>")
def open_file(hid):
    desktop_only()
    p = entry_path(hid)
    if not p.exists():
        abort(404)
    os.startfile(str(p))
    return jsonify(ok=True)


@app.get("/api/history")
def get_history():
    desktop_only()
    return jsonify([{**e, "exists": Path(e["path"]).exists()} for e in history()])


@app.delete("/api/history/<hid>")
def del_history(hid):
    desktop_only()
    with lock:
        _write(HISTORY_FILE, [e for e in history() if e["id"] != hid])
    return jsonify(ok=True)


@app.delete("/api/history")
def clear_history():
    desktop_only()
    with lock:
        _write(HISTORY_FILE, [])
    return jsonify(ok=True)


@app.get("/api/settings")
def get_settings():
    desktop_only()
    return jsonify({**settings(), "yt_dlp": yt_dlp.version.__version__, "ffmpeg": bool(FFMPEG or shutil.which("ffmpeg"))})


@app.post("/api/settings")
def set_settings():
    desktop_only()
    body = request.get_json(silent=True) or {}
    s = settings()
    if "default_quality" in body and body["default_quality"] in QUALITY:
        s["default_quality"] = body["default_quality"]
    if body.get("save_dir"):
        p = Path(str(body["save_dir"]))
        try:
            p.mkdir(parents=True, exist_ok=True)
        except OSError:
            return jsonify(error="Can't use that folder."), 400
        s["save_dir"] = str(p)
    _write(SETTINGS_FILE, s)
    return jsonify(s)


@app.post("/api/open-folder")
def open_folder():
    desktop_only()
    d = save_dir(); d.mkdir(parents=True, exist_ok=True)
    os.startfile(str(d))
    return jsonify(ok=True)


@app.get("/api/clipboard")
def clipboard():
    desktop_only()
    return jsonify(text=read_clipboard().strip()[:2000])


if __name__ == "__main__":
    print("Orbit running at http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, threaded=True)
