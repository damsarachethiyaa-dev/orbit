"""Orbit - paste a video link, get the file. Flask backend around yt-dlp.

Runs two ways:
  python app.py        website mode: files are streamed to the visitor's browser
  desktop.py           Windows app mode (ORBIT_DESKTOP=1): files are saved to a folder on this PC,
                       with a download queue, library and settings
"""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import urlparse

import yt_dlp
from flask import Flask, abort, jsonify, request, send_file, send_from_directory

APP_VERSION = "1.0.6"
GITHUB_REPO = "damsarachethiyaa-dev/orbit"

DESKTOP = os.environ.get("ORBIT_DESKTOP") == "1"
FROZEN = getattr(sys, "frozen", False)
ROOT = Path(sys._MEIPASS) if FROZEN else Path(__file__).parent          # bundled read-only files
DATA = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Orbit" if DESKTOP else ROOT   # writable files
DOWNLOADS = DATA / "downloads"
DOWNLOADS.mkdir(parents=True, exist_ok=True)
UPDATE_DIR = DATA / "updates"
UPDATE_DIR.mkdir(parents=True, exist_ok=True)
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
    "image": "image",
    "photo": "photo",
}

# ---------------------------------------------------------------- settings + library (desktop)
SETTINGS_FILE, HISTORY_FILE = DATA / "settings.json", DATA / "history.json"
DEFAULTS = {"save_dir": str(Path.home() / "Downloads" / "Orbit Videos"), "default_quality": "best", "auto_download": False}


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
            if j["state"] in ("done", "error", "cancelled") and now - j["created"] > JOB_TTL:
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


def resolve_direct_image(url: str):
    lower = url.lower()
    clean = url.split("?")[0].lower()
    is_img = any(clean.endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".heic"]) or \
             any(k in lower for k in ["format=jpg", "format=png", "format=webp", ".jpg?", ".png?", ".webp?"])
    if is_img:
        import urllib.parse
        path = urllib.parse.urlparse(url).path
        name = os.path.basename(path).rsplit(".", 1)[0] or "Image"
        domain = urllib.parse.urlparse(url).netloc.replace("www.", "").split(".")[0].capitalize()
        return {
            "title": name,
            "uploader": domain or "Web",
            "thumbnail": url,
            "duration": 0,
            "directUrl": url,
            "imageUrls": [url],
            "site": domain or "Image",
            "type": "image",
            "count": 1,
            "heights": []
        }
    return None


def resolve_pinterest(url: str):
    if not ("pinterest.com" in url.lower() or "pin.it" in url.lower()):
        return None
    try:
        import urllib.request, re
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", "ignore")
        m_img = re.search(r'property=["\']og:image["\']\s+content=["\']([^"\']+)["\']', html) or \
                re.search(r'content=["\']([^"\']+)["\']\s+property=["\']og:image["\']', html)
        m_title = re.search(r'property=["\']og:title["\']\s+content=["\']([^"\']+)["\']', html)
        title = m_title.group(1) if m_title else "Pinterest Pin"
        if m_img:
            thumb = m_img.group(1)
            high_res = re.sub(r'/\d+x/', '/originals/', thumb)
            return {
                "title": title,
                "uploader": "Pinterest",
                "thumbnail": thumb,
                "duration": 0,
                "directUrl": high_res,
                "site": "Pinterest",
                "type": "image",
                "count": 1,
                "heights": []
            }
    except Exception:
        pass
    return None


def resolve_xiaohongshu(url: str):
    if not ("xhslink.com" in url.lower() or "xiaohongshu.com" in url.lower()):
        return None
    try:
        import urllib.request, json, re
        current = url
        headers = {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
        }
        for _ in range(6):
            req = urllib.request.Request(current, headers=headers)
            with urllib.request.urlopen(req, timeout=12) as resp:
                final_url = resp.geturl()
                html = resp.read().decode("utf-8", "ignore")
            m = re.search(r"window\.__INITIAL_STATE__\s*=\s*(.*?)</script>", html, re.DOTALL)
            if not m:
                continue
            data = json.loads(m.group(1).strip().rstrip(";").replace("undefined", "null"))
            note = data.get("noteData", {}).get("data", {}).get("noteData")
            if not note:
                continue
            title = note.get("title") or (note.get("desc") or "")[:60] or "Xiaohongshu Post"
            uploader = note.get("user", {}).get("nickname", "Xiaohongshu")
            img_list = note.get("imageList") or []
            image_urls = []
            for item in img_list:
                if not item:
                    continue
                u = item.get("urlOriginal") or item.get("urlDefault") or item.get("url") or ""
                info_list = item.get("infoList") or []
                if info_list:
                    best = info_list[-1].get("url")
                    if best:
                        u = best
                if u:
                    image_urls.append(u)
            thumb = image_urls[0] if image_urls else (img_list[0].get("url", "") if img_list else "")
            v = note.get("video") or {}
            duration = v.get("duration", 0)
            h264 = v.get("media", {}).get("stream", {}).get("h264") or []
            vurl = ""
            if h264:
                vurl = h264[0].get("masterUrl", "")
            if not vurl:
                h265 = v.get("media", {}).get("stream", {}).get("h265") or []
                if h265:
                    vurl = h265[0].get("masterUrl", "")
            if vurl:
                return {
                    "title": title,
                    "uploader": uploader,
                    "thumbnail": thumb,
                    "duration": duration,
                    "directUrl": vurl,
                    "imageUrls": image_urls,
                    "site": "Xiaohongshu",
                    "type": "video",
                    "heights": [1080, 720, 480]
                }
            elif image_urls:
                return {
                    "title": title,
                    "uploader": uploader,
                    "thumbnail": thumb,
                    "duration": 0,
                    "directUrl": image_urls[0],
                    "imageUrls": image_urls,
                    "site": "Xiaohongshu",
                    "type": "image",
                    "count": len(image_urls),
                    "heights": []
                }
            break
    except Exception:
        pass
    return None


@app.post("/api/info")

def resolve_social_and_web_image(url: str):
    if not (url.startswith("http://") or url.startswith("https://")):
        return None
    try:
        import urllib.request, json, re, html as html_lib, urllib.parse
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=12) as resp:
            content_type = resp.headers.get_content_type().lower()
            final_url = resp.geturl()
            if content_type.startswith("image/"):
                name = os.path.basename(urllib.parse.urlparse(final_url).path).rsplit(".", 1)[0] or "Photo"
                domain = urllib.parse.urlparse(final_url).netloc.replace("www.", "").split(".")[0].capitalize()
                return {
                    "title": name,
                    "uploader": domain,
                    "thumbnail": final_url,
                    "duration": 0,
                    "directUrl": final_url,
                    "imageUrls": [final_url],
                    "site": domain or "Image",
                    "type": "image",
                    "count": 1,
                    "heights": []
                }
            html_text = resp.read().decode("utf-8", errors="ignore")

        domain = urllib.parse.urlparse(final_url).netloc.replace("www.", "").split(".")[0].capitalize() or "Web"

        # 1. TikTok photo mode
        if "tiktok.com" in final_url:
            m = re.search(r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>', html_text, re.DOTALL)
            if m:
                try:
                    data = json.loads(m.group(1))
                    scope = data.get("__DEFAULT_SCOPE__", {})
                    detail = None
                    for k, v in scope.items():
                        if isinstance(v, dict) and "itemInfo" in v:
                            detail = v["itemInfo"].get("itemStruct", {})
                            break
                    images = (detail or {}).get("imagePost", {}).get("images", [])
                    if images:
                        img_urls = []
                        for img in images:
                            u_list = img.get("imageURL", {}).get("urlList", [])
                            if u_list:
                                img_urls.append(u_list[-1])
                        if img_urls:
                            return {
                                "title": (detail.get("desc") or "TikTok Photos")[:80],
                                "uploader": (detail.get("author") or {}).get("nickname") or "TikTok",
                                "thumbnail": img_urls[0],
                                "duration": 0,
                                "directUrl": img_urls[0],
                                "imageUrls": img_urls,
                                "site": "TikTok",
                                "type": "image",
                                "count": len(img_urls),
                                "heights": []
                            }
                except Exception:
                    pass

        # 2. Reddit gallery / post
        if "reddit.com" in final_url or "redd.it" in final_url:
            redd_imgs = re.findall(r'https://(?:i|preview)\.redd\.it/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)', html_text)
            seen = set()
            uniq_imgs = []
            for u in redd_imgs:
                clean_u = u.replace("preview.redd.it", "i.redd.it").split("?")[0]
                if clean_u not in seen:
                    seen.add(clean_u)
                    uniq_imgs.append(clean_u)
            if uniq_imgs:
                title_m = re.search(r'<title>(.*?)</title>', html_text, re.I)
                raw_title = (title_m.group(1).split(" : r/")[0] if title_m else "Reddit Photos").strip()[:80]
                return {
                    "title": raw_title,
                    "uploader": "Reddit",
                    "thumbnail": uniq_imgs[0],
                    "duration": 0,
                    "directUrl": uniq_imgs[0],
                    "imageUrls": uniq_imgs,
                    "site": "Reddit",
                    "type": "image",
                    "count": len(uniq_imgs),
                    "heights": []
                }

        # 3. Twitter / X Images
        if "twitter.com" in final_url or "x.com" in final_url:
            tw_imgs = re.findall(r'https://pbs\.twimg\.com/media/[a-zA-Z0-9_-]+', html_text)
            seen = set()
            uniq_tw = []
            for u in tw_imgs:
                if u not in seen:
                    seen.add(u)
                    uniq_tw.append(f"{u}?format=jpg&name=orig")
            if uniq_tw:
                title_m = re.search(r'<title>(.*?)</title>', html_text, re.I)
                raw_title = (title_m.group(1).split(" / X")[0] if title_m else "X Photos").strip()[:80]
                return {
                    "title": raw_title,
                    "uploader": "X",
                    "thumbnail": uniq_tw[0],
                    "duration": 0,
                    "directUrl": uniq_tw[0],
                    "imageUrls": uniq_tw,
                    "site": "X",
                    "type": "image",
                    "count": len(uniq_tw),
                    "heights": []
                }

        # 4. Universal OpenGraph & Twitter Image Fallback
        og_images = re.findall(r'<meta[^>]+(?:property|name)=["\'](?:og:image:secure_url|og:image|twitter:image)["\'][^>]+content=["\']([^"\']+)["\']', html_text, re.I)
        if not og_images:
            og_images = re.findall(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:image:secure_url|og:image|twitter:image)["\']', html_text, re.I)

        cleaned_og = []
        seen = set()
        for img in og_images:
            decoded = html_lib.unescape(img).strip()
            if decoded.startswith("//"):
                decoded = "https:" + decoded
            if decoded.startswith("http") and decoded not in seen:
                seen.add(decoded)
                cleaned_og.append(decoded)

        if cleaned_og:
            title_m = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)["\']', html_text, re.I) or re.search(r'<title[^>]*>(.*?)</title>', html_text, re.I)
            raw_title = html_lib.unescape(title_m.group(1)).strip()[:80] if title_m else f"{domain} Image"
            return {
                "title": raw_title,
                "uploader": domain,
                "thumbnail": cleaned_og[0],
                "duration": 0,
                "directUrl": cleaned_og[0],
                "imageUrls": cleaned_og,
                "site": domain,
                "type": "image",
                "count": len(cleaned_og),
                "heights": []
            }
    except Exception:
        pass
    return None


def info():
    url = str((request.get_json(silent=True) or {}).get("url") or "").strip()
    if not valid_url(url):
        return jsonify(error="That doesn't look like a valid link."), 400

    direct_img = resolve_direct_image(url)
    if direct_img:
        return jsonify(direct_img)

    pin = resolve_pinterest(url)
    if pin:
        return jsonify(pin)

    xhs = resolve_xiaohongshu(url)
    if xhs:
        return jsonify(xhs)

    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True,
                               "skip_download": True, "ignore_no_formats_error": True}) as ydl:
            d = ydl.extract_info(url, download=False)
    except Exception as e:
        social_img = resolve_social_and_web_image(url)
        if social_img and social_img.get("imageUrls"):
            return jsonify(social_img)
        msg = str(e).replace("ERROR: ", "")
        return jsonify(error=msg[:300] or "Couldn't read that link."), 422

    heights = sorted({f["height"] for f in d.get("formats", []) if f.get("height")}, reverse=True)
    is_image = not heights and bool(d.get("thumbnail") or d.get("thumbnails"))

    img_urls = []
    if d.get("entries"):
        for e in d.get("entries"):
            u = e.get("url") or e.get("thumbnail")
            if u and u not in img_urls:
                img_urls.append(u)
    elif d.get("thumbnail"):
        img_urls.append(d.get("thumbnail"))

    return jsonify(
        title=d.get("title") or ("Photo post" if is_image else "Untitled video"),
        thumbnail=d.get("thumbnail"),
        duration=0 if is_image else d.get("duration"),
        uploader=d.get("uploader") or d.get("channel"),
        site=d.get("extractor_key") or "Media",
        type="image" if is_image else "video",
        directUrl=d.get("thumbnail") if is_image else "",
        imageUrls=img_urls,
        count=len(img_urls) if img_urls else 1,
        heights=heights,
    )


def run_job(jid: str, url: str, quality: str):
    job = jobs[jid]
    out = DOWNLOADS / jid
    if DESKTOP:
        out = save_dir()
    out.mkdir(parents=True, exist_ok=True)
    touched = set()   # every file this job writes, so cancel only cleans up its own files

    if quality in ("image", "photo") or job.get("type") == "image":
        try:
            import urllib.request, re
            save_path = out
            title = re.sub(r'[\\/:*?"<>|]', "_", job.get("title") or "orbit_photo").strip().rstrip(". ")[:80] or f"orbit_{jid}"
            image_urls = job.get("imageUrls") or [url]
            saved_files = []
            total = len(image_urls)
            for idx, img_url in enumerate(image_urls):
                if job.get("cancel"):
                    for sf in saved_files:
                        try: sf.unlink(missing_ok=True)
                        except: pass
                    job["state"] = "cancelled"
                    return
                req = urllib.request.Request(img_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
                with urllib.request.urlopen(req, timeout=20) as resp:
                    ct = resp.headers.get_content_type()
                    ext = "png" if "png" in ct else ("webp" if "webp" in ct else ("gif" if "gif" in ct else "jpg"))
                    suffix = f" ({idx + 1} of {total})" if total > 1 else ""
                    target = save_path / f"{title}{suffix} [{jid}].{ext}"
                    with open(target, "wb") as f:
                        f.write(resp.read())
                    saved_files.append(target)
                job["percent"] = min(99.0, round(((idx + 1) / total) * 100.0, 1))

            first_file = saved_files[0] if saved_files else None
            sz = sum(f.stat().st_size for f in saved_files)
            job.update({"state": "done", "percent": 100, "file": first_file.name if first_file else "", "path": str(first_file) if (DESKTOP and first_file) else None, "size": sz, "error": None})
            if DESKTOP and first_file:
                add_history({"id": jid, "title": f"{job['title']} ({total} Photos)" if total > 1 else (job["title"] or first_file.stem),
                             "site": job["site"], "path": str(first_file), "size": sz, "quality": "photo", "thumb": job["thumb"], "t": int(time.time())})
            return
        except Exception as e:
            if job.get("cancel"):
                job["state"] = "cancelled"
                return
            job["state"] = "error"
            job["error"] = str(e).replace("ERROR: ", "")[:300]
            return

    # Check if direct stream (mp4 / xhscdn / etc.)
    clean_stream_url = url.split("?")[0].lower()
    if clean_stream_url.endswith(".mp4") or clean_stream_url.endswith(".webm") or "sns-video" in url or "xhscdn.com" in url:
        try:
            import urllib.request, re
            title = re.sub(r'[\\/:*?"<>|]', "_", job.get("title") or "orbit_video").strip().rstrip(". ")[:80] or f"orbit_{jid}"
            target = out / f"{title} [{jid}].mp4"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
            with urllib.request.urlopen(req, timeout=25) as resp:
                total_len = int(resp.headers.get("content-length") or 0)
                downloaded = 0
                with open(target, "wb") as f:
                    while True:
                        if job.get("cancel"):
                            try: target.unlink(missing_ok=True)
                            except: pass
                            job["state"] = "cancelled"
                            return
                        chunk = resp.read(32768)
                        if not chunk: break
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total_len > 0:
                            job["percent"] = min(99.0, round((downloaded / total_len) * 100.0, 1))
            sz = target.stat().st_size
            job.update({"state": "done", "percent": 100, "file": target.name, "path": str(target) if DESKTOP else None, "size": sz, "error": None})
            if DESKTOP:
                add_history({"id": jid, "title": job["title"] or target.stem, "site": job["site"], "path": str(target),
                             "size": sz, "quality": quality, "thumb": job["thumb"], "t": int(time.time())})
            return
        except Exception as e:
            if job.get("cancel"):
                job["state"] = "cancelled"
                return
            job["state"] = "error"
            job["error"] = str(e).replace("ERROR: ", "")[:300]
            return

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
        "format": QUALITY.get(quality, QUALITY["best"]),
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
    url, quality = str(body.get("url") or "").strip(), body.get("quality", "best")
    direct_url = str(body.get("directUrl") or "").strip()
    if not direct_url:
        xhs = resolve_xiaohongshu(url)
        direct_url = xhs["directUrl"] if xhs else url
    if not valid_url(direct_url) and not valid_url(url):
        return jsonify(error="Invalid request."), 400
    if not isinstance(quality, str) or quality not in QUALITY:
        return jsonify(error="Invalid request."), 400
    cleanup()
    jid = uuid.uuid4().hex[:12]
    jobs[jid] = {"state": "downloading", "percent": 0, "speed": "", "eta": "", "file": None, "path": None,
                 "error": None, "created": time.time(), "cancel": False, "size": None, "quality": quality,
                 "title": str(body.get("title") or "")[:200], "site": str(body.get("site") or "")[:40],
                 "thumb": str(body.get("thumb") or "")[:500], "url": url,
                 "imageUrls": body.get("imageUrls") or [],
                 "type": str(body.get("type") or ("image" if quality in ("image", "photo") else "video"))}
    threading.Thread(target=run_job, args=(jid, direct_url, quality), daemon=True).start()
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
    j = jobs.get(hid)
    p = Path(j["path"]) if j and j.get("path") else entry_path(hid)
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
        e = next((x for x in history() if x["id"] == hid), None)
        if e and e.get("path"):
            try:
                Path(e["path"]).unlink(missing_ok=True)
            except Exception:
                pass
        _write(HISTORY_FILE, [item for item in history() if item["id"] != hid])
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
    return jsonify({
        **settings(),
        "version": APP_VERSION,
        "has_update": update_state["has_update"],
        "latest_version": update_state["latest_version"],
        "yt_dlp": yt_dlp.version.__version__,
        "ffmpeg": bool(FFMPEG or shutil.which("ffmpeg")),
    })


@app.post("/api/settings")
def set_settings():
    desktop_only()
    body = request.get_json(silent=True) or {}
    s = settings()
    if "default_quality" in body and body["default_quality"] in QUALITY:
        s["default_quality"] = body["default_quality"]
    if "auto_download" in body:
        s["auto_download"] = bool(body["auto_download"])
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


# ---------------------------------------------------------------- in-app auto-updater
update_state = {
    "checking": False,
    "has_update": False,
    "current_version": APP_VERSION,
    "latest_version": APP_VERSION,
    "release_name": "",
    "release_notes": "",
    "download_url": "",
    "html_url": f"https://github.com/{GITHUB_REPO}/releases/latest",
    "downloading": False,
    "download_percent": 0,
    "download_speed": "",
    "download_total": 0,
    "download_done": 0,
    "ready_to_install": False,
    "update_file": None,
    "error": None,
}


def parse_version(v: str) -> tuple:
    parts = re.findall(r"\d+", str(v or ""))
    return tuple(map(int, parts)) if parts else (0,)


def trusted_update_url(u: str) -> bool:
    p = urlparse(u or "")
    return p.scheme == "https" and p.hostname in ("github.com", "objects.githubusercontent.com")


def check_for_updates(force_test: bool = False) -> dict:
    update_state["checking"] = True
    update_state["error"] = None
    try:
        url = f"https://api.github.com/repos/{GITHUB_REPO}/releases?per_page=15"
        req = urllib.request.Request(url, headers={"User-Agent": f"Orbit-App/{APP_VERSION}", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=10) as res:
            releases = json.loads(res.read().decode("utf-8"))

        if isinstance(releases, dict):
            releases = [releases]

        target_rel = None
        target_exe_url = None
        for rel in releases:
            exe_assets = [
                a.get("browser_download_url")
                for a in rel.get("assets", [])
                if a.get("name", "").lower().endswith(".exe") and trusted_update_url(a.get("browser_download_url"))
            ]
            if exe_assets:
                setup_exe = next((u for u in exe_assets if "setup" in u.lower() or "install" in u.lower()), exe_assets[0])
                target_rel = rel
                target_exe_url = setup_exe
                break

        if target_rel and target_exe_url:
            latest_tag = target_rel.get("tag_name", "").lstrip("v")
            latest_ver = parse_version(latest_tag)
            curr_ver = parse_version(APP_VERSION)
            has_update = (latest_ver > curr_ver and bool(target_exe_url)) or (force_test and bool(target_exe_url))
            update_state.update(
                has_update=has_update,
                latest_version=target_rel.get("tag_name", ""),
                release_name=target_rel.get("name") or target_rel.get("tag_name", ""),
                release_notes=target_rel.get("body") or "",
                download_url=target_exe_url,
                html_url=target_rel.get("html_url") or f"https://github.com/{GITHUB_REPO}/releases",
            )
        else:
            update_state.update(
                has_update=False,
                latest_version=f"v{APP_VERSION}",
                download_url="",
            )
    except Exception as e:
        update_state["error"] = str(e)
    finally:
        update_state["checking"] = False
    return update_state


def download_update_thread():
    if update_state["downloading"] or not update_state.get("download_url"):
        return
    update_state["downloading"] = True
    update_state["download_percent"] = 0
    update_state["ready_to_install"] = False
    update_state["error"] = None

    url = update_state["download_url"]
    filename = "Orbit-update.exe"
    target_path = UPDATE_DIR / filename
    temp_path = UPDATE_DIR / (filename + ".tmp")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": f"Orbit-App/{APP_VERSION}"})
        with urllib.request.urlopen(req, timeout=60) as res:
            total = int(res.headers.get("Content-Length", 0))
            update_state["download_total"] = total
            downloaded = 0
            start_time = time.time()
            last_time = start_time
            last_bytes = 0

            with open(temp_path, "wb") as f:
                while True:
                    chunk = res.read(64 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    update_state["download_done"] = downloaded
                    if total > 0:
                        update_state["download_percent"] = round((downloaded / total) * 100, 1)

                    now = time.time()
                    if now - last_time >= 0.5:
                        speed = (downloaded - last_bytes) / (now - last_time) if (now - last_time) > 0 else 0
                        if speed > 1e6:
                            update_state["download_speed"] = f"{speed / 1e6:.1f} MB/s"
                        else:
                            update_state["download_speed"] = f"{max(1, int(speed / 1e3))} KB/s"
                        last_time = now
                        last_bytes = downloaded

        with open(temp_path, "rb") as f:
            if downloaded < 1_000_000 or f.read(2) != b"MZ" or (total and downloaded != total):
                raise RuntimeError("the downloaded file is incomplete or not a valid program")
        if target_path.exists():
            target_path.unlink()
        temp_path.rename(target_path)

        if sys.platform == "win32":
            try:
                subprocess.run(
                    ["powershell", "-NoProfile", "-Command", f"Unblock-File -Path '{target_path}'"],
                    creationflags=0x08000000,
                    timeout=5,
                )
            except Exception:
                pass

        update_state["ready_to_install"] = True
        update_state["update_file"] = str(target_path)
        update_state["download_percent"] = 100
        update_state["download_speed"] = ""
    except Exception as e:
        update_state["error"] = f"Download failed: {e}"
        temp_path.unlink(missing_ok=True)
    finally:
        update_state["downloading"] = False


def is_nsis_installer(path: Path) -> bool:
    try:
        with open(path, "rb") as f:
            return b"Nullsoft" in f.read(131072)
    except Exception:
        return "setup" in path.name.lower()


def apply_update_process():
    if not update_state.get("ready_to_install") or not update_state.get("update_file"):
        return False, "No update file is ready to install."

    new_exe = Path(update_state["update_file"])
    if not new_exe.exists():
        return False, "Downloaded update executable was not found."

    pid = os.getpid()
    installed_default = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Programs" / "Orbit" / "Orbit.exe"
    current_exe = Path(sys.executable) if FROZEN else installed_default
    installer_mode = is_nsis_installer(new_exe)

    updater_bat = DATA / "updater.bat"
    if installer_mode:
        bat_content = f"""@echo off
setlocal
echo Updating Orbit to latest version...
timeout /t 1 /nobreak >nul
:wait_loop
tasklist /fi "pid eq {pid}" | find "{pid}" >nul
if not errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_loop
)

powershell -NoProfile -Command "Unblock-File -Path '{new_exe}'" >nul 2>&1
start /wait "" "{new_exe}" /S
if exist "{installed_default}" (
    start "" "{installed_default}"
) else if exist "{current_exe}" (
    start "" "{current_exe}"
)
del "%~f0" & exit
"""
    elif FROZEN:
        bat_content = f"""@echo off
setlocal
echo Updating Orbit to latest version...
timeout /t 1 /nobreak >nul
:wait_loop
tasklist /fi "pid eq {pid}" | find "{pid}" >nul
if not errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_loop
)

copy /y "{new_exe}" "{current_exe}" >nul
if errorlevel 1 (
    timeout /t 2 /nobreak >nul
    copy /y "{new_exe}" "{current_exe}" >nul
)

powershell -NoProfile -Command "Unblock-File -Path '{current_exe}'" >nul 2>&1
start "" "{current_exe}"
del "%~f0" & exit
"""
    else:
        if sys.platform == "win32":
            try:
                subprocess.run(
                    ["powershell", "-NoProfile", "-Command", f"Unblock-File -Path '{new_exe}'"],
                    creationflags=0x08000000,
                    timeout=5,
                )
            except Exception:
                pass
        subprocess.Popen([str(new_exe)], creationflags=0x08000000 | 0x00000008)
        threading.Thread(target=lambda: (time.sleep(0.6), os._exit(0)), daemon=True).start()
        return True, "Launching updated Orbit binary..."

    updater_bat.write_text(bat_content, encoding="utf-8")
    subprocess.Popen(["cmd.exe", "/c", str(updater_bat)], creationflags=0x08000000 | 0x00000008)
    threading.Thread(target=lambda: (time.sleep(0.6), os._exit(0)), daemon=True).start()
    return True, "Restarting Orbit to apply update..."


@app.get("/api/update/check")
def update_check():
    desktop_only()
    force = request.args.get("force") == "1"
    return jsonify(check_for_updates(force_test=force))


@app.get("/api/update/status")
def update_status():
    desktop_only()
    return jsonify(update_state)


@app.post("/api/update/download")
def update_download():
    desktop_only()
    if update_state["downloading"]:
        return jsonify(ok=True)
    if not update_state.get("download_url"):
        check_for_updates()
    if not update_state.get("download_url"):
        return jsonify(error="No download URL available for update."), 400
    threading.Thread(target=download_update_thread, daemon=True).start()
    return jsonify(ok=True)


@app.post("/api/update/apply")
def update_apply():
    desktop_only()
    ok, msg = apply_update_process()
    if not ok:
        return jsonify(error=msg), 400
    return jsonify(ok=True, message=msg)


@app.get("/api/version")
def get_version():
    return jsonify(version=APP_VERSION)


if __name__ == "__main__":
    print("Orbit running at http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, threaded=True)
