"""In-app updater for the Windows build.

The app downloads ``Orbit-Setup.exe`` and then has to (1) get out of the way,
(2) run the setup silently, (3) start Orbit again.  Windows does not allow a
process to replace its own executable, and a frozen, window-less app cannot
reliably drive a ``cmd.exe`` batch file (no console, inherited handles), so all
of that is handed to a detached PowerShell helper that logs every step to
``%LOCALAPPDATA%\\Orbit\\updater.log``.

If the helper cannot be started at all, the setup is opened interactively
instead, so the update can always be finished by hand.
"""
import os
import subprocess
import sys
import time
from pathlib import Path

# NB: DETACHED_PROCESS makes powershell.exe (and cmd.exe) start and exit without
# running anything at all, so a hidden window is used instead. The helper has no
# console and outlives Orbit on its own.
CREATE_NO_WINDOW = 0x08000000

# The helper: waits for Orbit to exit, installs, restarts Orbit, cleans up.
HELPER_SCRIPT = r"""param(
  [int]$ParentPid = 0,
  [string]$Installer = "",
  [string]$Relaunch = "",
  [string]$Log = ""
)

$ErrorActionPreference = "Continue"

function Write-Log([string]$Message) {
  if (-not $Log) { return }
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  try { Add-Content -LiteralPath $Log -Value $line -Encoding UTF8 -ErrorAction Stop } catch { }
}

function Test-Process([int]$Id) {
  if ($Id -le 0) { return $false }
  return [bool](Get-Process -Id $Id -ErrorAction SilentlyContinue)
}

Write-Log "helper started (parent $ParentPid)"
Write-Log "installer: $Installer"
Write-Log "relaunch: $Relaunch"

if (-not (Test-Path -LiteralPath $Installer)) {
  Write-Log "the downloaded installer is missing, stopping"
  exit 2
}

# 1. wait for Orbit to close: it exits as soon as it hands over
$deadline = (Get-Date).AddSeconds(60)
while ((Test-Process $ParentPid) -and ((Get-Date) -lt $deadline)) {
  Start-Sleep -Milliseconds 250
}
if (Test-Process $ParentPid) {
  Write-Log "Orbit is still running, closing it"
  try { Stop-Process -Id $ParentPid -Force -ErrorAction Stop } catch { Write-Log ("could not close Orbit: " + $_.Exception.Message) }
}
Start-Sleep -Milliseconds 700
Write-Log "Orbit closed"

# 2. drop the mark-of-the-web so Windows does not block the silent install
try { Unblock-File -LiteralPath $Installer -ErrorAction Stop; Write-Log "installer unblocked" }
catch { Write-Log ("unblock skipped: " + $_.Exception.Message) }

# 3. NSIS setup or portable build?
$isSetup = $false
try {
  $stream = [System.IO.File]::OpenRead($Installer)
  $buffer = New-Object byte[] 131072
  $read = $stream.Read($buffer, 0, $buffer.Length)
  $stream.Dispose()
  $head = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
  $isSetup = $head.Contains("Nullsoft")
} catch { Write-Log ("could not inspect the download: " + $_.Exception.Message) }

$installed = $false

if ($isSetup) {
  $before = ""
  if (Test-Path -LiteralPath $Relaunch) {
    try { $before = (Get-Item -LiteralPath $Relaunch).VersionInfo.FileVersion } catch { }
  }
  Write-Log "installed version before: $before"

  Write-Log "running the setup silently"
  $code = -1
  try {
    $proc = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait -ErrorAction Stop
    $code = $proc.ExitCode
  } catch { Write-Log ("silent install failed: " + $_.Exception.Message) }
  Write-Log "setup exit code: $code"

  $after = ""
  if (Test-Path -LiteralPath $Relaunch) {
    try { $after = (Get-Item -LiteralPath $Relaunch).VersionInfo.FileVersion } catch { }
  }
  Write-Log "installed version after: $after"
  if (($code -eq 0) -or ($after -and ($after -ne $before))) { $installed = $true }

  if (-not $installed) {
    Write-Log "the silent install changed nothing, showing the setup window"
    try {
      Start-Process -FilePath $Installer -Wait -ErrorAction Stop
      $installed = $true
      Write-Log "setup window finished"
    } catch { Write-Log ("setup window failed: " + $_.Exception.Message) }
  }
} else {
  Write-Log "portable build, copying it over the installed app"
  for ($attempt = 1; $attempt -le 12; $attempt++) {
    try {
      Copy-Item -LiteralPath $Installer -Destination $Relaunch -Force -ErrorAction Stop
      $installed = $true
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  Write-Log "copy result: $installed"
}

# 4. bring Orbit back
if ($Relaunch -and (Test-Path -LiteralPath $Relaunch)) {
  if ($installed) { try { Unblock-File -LiteralPath $Relaunch -ErrorAction SilentlyContinue } catch { } }
  try { Start-Process -FilePath $Relaunch -ErrorAction Stop; Write-Log "Orbit started again" }
  catch { Write-Log ("could not start Orbit: " + $_.Exception.Message) }
} else {
  Write-Log "no executable to start again"
}

# 5. tidy up
if ($installed -and $isSetup) {
  try { Remove-Item -LiteralPath $Installer -Force -ErrorAction Stop; Write-Log "downloaded setup removed" } catch { }
}
try { Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue } catch { }

Write-Log "helper finished (installed=$installed)"
exit 0
"""


def log_line(log_path: Path, message: str) -> None:
    """Append one timestamped line to the updater log (never raises)."""
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as fh:
            fh.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n")
    except OSError:
        pass


def is_nsis_setup(path: Path) -> bool:
    """True when the file is a Nullsoft (NSIS) installer, i.e. the Setup exe."""
    try:
        with open(path, "rb") as fh:
            return b"Nullsoft" in fh.read(131072)
    except OSError:
        return False


def installed_exe(current_exe: Path, frozen: bool) -> Path | None:
    """The Orbit.exe that the update should replace and start again."""
    candidates: list[Path] = []
    if frozen and current_exe:
        candidates.append(Path(current_exe))
    if sys.platform == "win32":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Orbit") as key:
                folder, _ = winreg.QueryValueEx(key, "InstallLocation")
                if folder:
                    candidates.append(Path(folder) / "Orbit.exe")
        except OSError:
            pass
    candidates.append(Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Programs" / "Orbit" / "Orbit.exe")
    return next((p for p in candidates if p.is_file()), candidates[0] if candidates else None)


def powershell_exe() -> str:
    exe = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    return str(exe) if exe.is_file() else "powershell.exe"


def _spawn(args: list[str], cwd: Path) -> subprocess.Popen:
    """Start a process that outlives Orbit: no shared console, no inherited handles."""
    kwargs: dict = {
        "cwd": str(cwd),
        "close_fds": True,
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if os.name == "nt":
        kwargs["creationflags"] = CREATE_NO_WINDOW
    return subprocess.Popen(args, **kwargs)


def exit_soon(delay: float = 1.5) -> None:
    """Give the HTTP response time to reach the page, then quit Orbit."""
    import threading
    threading.Thread(target=lambda: (time.sleep(delay), os._exit(0)), daemon=True).start()


def start_helper(update_file: Path, relaunch: Path | None, data_dir: Path, log_path: Path) -> tuple[bool, str]:
    helper = data_dir / "updater.ps1"
    try:
        helper.write_text(HELPER_SCRIPT, encoding="utf-8-sig", newline="\r\n")
    except OSError as exc:
        log_line(log_path, f"could not write the updater helper: {exc}")
        return False, f"Could not prepare the updater: {exc}"

    args = [
        powershell_exe(), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
        "-File", str(helper),
        "-ParentPid", str(os.getpid()),
        "-Installer", str(update_file),
        "-Relaunch", str(relaunch or ""),
        "-Log", str(log_path),
    ]
    try:
        proc = _spawn(args, data_dir)
    except OSError as exc:
        log_line(log_path, f"could not start the updater helper: {exc}")
        return False, f"Could not start the updater: {exc}"
    log_line(log_path, f"updater helper started (pid {proc.pid})")

    # the helper first waits for this process to exit, so an instant exit means it never ran
    time.sleep(1.0)
    code = proc.poll()
    if code is not None:
        log_line(log_path, f"updater helper exited immediately (code {code})")
        return False, "The updater could not start."

    return True, ""


def open_setup(update_file: Path, log_path: Path) -> tuple[bool, str]:
    """Open the downloaded setup so the user can finish the wizard by hand."""
    if os.name != "nt":
        return False, "Automatic updates are only available on Windows."
    if not update_file.is_file():
        return False, "The downloaded update is missing. Download it again."
    if not is_nsis_setup(update_file):
        return False, "That download is not an installer. Download the update again."
    try:
        os.startfile(str(update_file))          # noqa: S606 - launching our own verified download
    except OSError as exc:
        log_line(log_path, f"could not open the setup: {exc}")
        return False, f"Windows could not open the installer: {exc}"
    log_line(log_path, f"opened the setup window: {update_file}")
    return True, "Opened the Orbit installer. Finish the wizard to update."


def apply(update_file: Path, data_dir: Path, log_path: Path, current_exe: Path, frozen: bool) -> tuple[bool, str]:
    """Install the downloaded update. Returns (started, message)."""
    if os.name != "nt":
        return False, "Automatic updates are only available on Windows."
    update_file = Path(update_file)
    if not update_file.is_file():
        return False, "The downloaded update is missing. Download it again."
    with update_file.open("rb") as update_stream:
        header = update_stream.read(2)
    if update_file.stat().st_size < 1_000_000 or header != b"MZ":
        return False, "The downloaded update looks incomplete. Download it again."

    relaunch = installed_exe(current_exe, frozen)
    started, error = start_helper(update_file, relaunch, data_dir, log_path)
    if started:
        exit_soon()
        return True, "Restarting Orbit to apply the update..."

    log_line(log_path, f"falling back to the interactive setup ({error})")
    opened, message = open_setup(update_file, log_path)
    if opened:
        exit_soon()
        return True, message
    return False, error or message
