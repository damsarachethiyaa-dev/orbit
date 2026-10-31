"""Orbit for Windows: runs the Flask backend locally and shows it in a native window.

    python desktop.py              open the app window
    python desktop.py --no-window  just serve (used for testing)
"""
import json
import os
import shutil
import socket
import sys
import threading
import time
import traceback
import urllib.request
from pathlib import Path

os.environ["ORBIT_DESKTOP"] = "1"   # must be set before app.py is imported

DATA = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Orbit"
DATA.mkdir(parents=True, exist_ok=True)
LOG = DATA / "orbit.log"
INSTANCE_FILE = DATA / "instance.json"


def select_webview_storage(base: Path) -> tuple[Path, bool]:
    """Return (storage_path, is_ephemeral).
    Reuses the persistent 'profile' folder when unlocked for instant startup,
    or falls back to a per-process folder if a zombie WebView2 process holds a lock."""
    base.mkdir(parents=True, exist_ok=True)
    for item in base.glob("p_*"):
        if item.is_dir():
            try:
                shutil.rmtree(item, ignore_errors=True)
            except Exception:
                pass

    profile = base / "profile"
    lock_file = profile / "EBWebView" / "Default" / "LOCK"
    if lock_file.exists():
        try:
            lock_file.unlink()
        except OSError:
            ephemeral = base / f"p_{os.getpid()}"
            ephemeral.mkdir(parents=True, exist_ok=True)
            return ephemeral, True

    profile.mkdir(parents=True, exist_ok=True)
    return profile, False


def focus_existing_instance() -> bool:
    """If an Orbit window is already running, bring it to the foreground and return True."""
    if not INSTANCE_FILE.exists():
        return False
    try:
        info = json.loads(INSTANCE_FILE.read_text("utf-8"))
        port = int(info.get("port", 0))
        if not port:
            return False
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/focus",
            data=b"{}",
            headers={"Content-Type": "application/json", "X-Orbit": "1"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=0.4) as res:
            return res.status == 200
    except Exception:
        return False


# a windowed exe has no console: send output to a log file so crashes can be diagnosed
if getattr(sys, "frozen", False) or sys.stdout is None:
    _log = open(LOG, "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = _log
    print(f"\n--- Orbit started {time.strftime('%Y-%m-%d %H:%M:%S')} ---")

from flask import jsonify  # noqa: E402
from werkzeug.serving import make_server  # noqa: E402

import app as orbit  # noqa: E402


def message_box(text: str, title: str = "Orbit"):
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, title, 0x10)   # MB_ICONERROR
    else:
        print(text)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Api:
    """Exposed to the page as window.pywebview.api.
    Attributes must start with "_": pywebview exposes every public attribute to the page and walks into it,
    which on a Window object recurses through the WinForms internals and freezes the app."""

    def __init__(self):
        self._window = None

    def choose_folder(self, current=None):
        import webview
        r = self._window.create_file_dialog(webview.FOLDER_DIALOG, directory=current or "")
        return r[0] if r else None

    def _focus(self):
        try:
            if self._window:
                self._window.restore()
                self._window.show()
            if sys.platform == "win32":
                import ctypes
                hwnd = ctypes.windll.user32.FindWindowW(None, "Orbit")
                if hwnd:
                    ctypes.windll.user32.ShowWindow(hwnd, 9)  # SW_RESTORE
                    ctypes.windll.user32.SetForegroundWindow(hwnd)
        except Exception:
            pass


def main():
    if "--no-window" not in sys.argv and focus_existing_instance():
        return

    api = Api()

    @orbit.app.post("/api/focus")
    def _api_focus():
        threading.Thread(target=api._focus, daemon=True).start()
        return jsonify(ok=True)

    port = int(os.environ.get("ORBIT_PORT") or free_port())
    server = make_server("127.0.0.1", port, orbit.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}/"

    for _ in range(100):   # wait until the server answers
        try:
            urllib.request.urlopen(url, timeout=.5).close()
            break
        except OSError:
            time.sleep(.1)

    try:
        INSTANCE_FILE.write_text(json.dumps({"port": port, "pid": os.getpid()}), "utf-8")
    except OSError:
        pass

    try:
        if "--no-window" in sys.argv:
            print("Orbit serving at", url, flush=True)
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                pass
        else:
            import webview
            data, is_ephemeral = select_webview_storage(DATA / "webview")
            api._window = webview.create_window("Orbit", url, js_api=api, width=1080, height=720,
                                               min_size=(760, 560), background_color="#0b0b0b")
            try:
                webview.start(gui="edgechromium", storage_path=str(data), private_mode=False)
            except Exception:
                traceback.print_exc()
                message_box("Orbit needs the Microsoft Edge WebView2 Runtime, which is missing or broken on this PC.\n\n"
                            "Install it from https://developer.microsoft.com/microsoft-edge/webview2/ and open Orbit again.\n\n"
                            f"Details were saved to {LOG}")
            finally:
                if is_ephemeral:
                    shutil.rmtree(data, ignore_errors=True)
    finally:
        try:
            INSTANCE_FILE.unlink(missing_ok=True)
        except OSError:
            pass
        server.shutdown()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        message_box(f"Orbit hit an unexpected error and has to close.\n\nDetails were saved to {LOG}")
        raise
