"""Orbit for Windows: runs the Flask backend locally and shows it in a native window.

    python desktop.py              open the app window
    python desktop.py --no-window  just serve (used for testing)
"""
import os
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

_mutex_handle = None

def ensure_single_instance():
    """Ensure only one Orbit window runs at a time. If already open, brings it to front."""
    global _mutex_handle
    if sys.platform == "win32" and "--no-window" not in sys.argv:
        import ctypes
        _mutex_handle = ctypes.windll.kernel32.CreateMutexW(None, False, "OrbitAppMutex")
        if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
            hwnd = ctypes.windll.user32.FindWindowW(None, "Orbit")
            if hwnd:
                ctypes.windll.user32.ShowWindow(hwnd, 9)  # SW_RESTORE
                ctypes.windll.user32.SetForegroundWindow(hwnd)
            sys.exit(0)

def clean_stale_locks(folder: Path):
    """Remove leftover lock files from previous unclean shutdowns so WebView2 doesn't freeze with 0x800700AA."""
    if not folder.exists():
        return
    for item in folder.rglob("*LOCK*"):
        if item.is_file():
            try:
                item.unlink(missing_ok=True)
            except OSError:
                pass

# a windowed exe has no console: send output to a log file so crashes can be diagnosed
if getattr(sys, "frozen", False) or sys.stdout is None:
    _log = open(LOG, "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = _log
    print(f"\n--- Orbit started {time.strftime('%Y-%m-%d %H:%M:%S')} ---")

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


def main():
    ensure_single_instance()
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

    if "--no-window" in sys.argv:
        print("Orbit serving at", url, flush=True)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    else:
        import webview
        data = DATA / "webview"
        clean_stale_locks(data)
        data.mkdir(parents=True, exist_ok=True)
        api = Api()
        api._window = webview.create_window("Orbit", url, js_api=api, width=1080, height=720,
                                           min_size=(760, 560), background_color="#0b0b0b")
        try:
            webview.start(gui="edgechromium", storage_path=str(data), private_mode=False)
        except Exception:
            traceback.print_exc()
            message_box("Orbit needs the Microsoft Edge WebView2 Runtime, which is missing or broken on this PC.\n\n"
                        "Install it from https://developer.microsoft.com/microsoft-edge/webview2/ and open Orbit again.\n\n"
                        f"Details were saved to {LOG}")

    server.shutdown()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        message_box(f"Orbit hit an unexpected error and has to close.\n\nDetails were saved to {LOG}")
        raise
