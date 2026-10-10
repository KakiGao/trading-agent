"""macOS per-user launch agent; localhost server persists when its browser closes."""
import os
import plistlib
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LABEL = "local.tradingagents.dashboard"
URL = "http://127.0.0.1:8765"


def start():
    folder = Path.home() / "Library/LaunchAgents"
    folder.mkdir(parents=True, exist_ok=True)
    logs = Path.home() / ".tradingagents/dashboard"
    logs.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = f"gui/{os.getuid()}"
    plist = folder / f"{LABEL}.plist"
    definition = {
        "Label": LABEL,
        "ProgramArguments": [str(ROOT / ".venv/bin/python"), "-m", "dashboard.server"],
        "WorkingDirectory": str(ROOT),
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},
        "ThrottleInterval": 15,
        "StandardOutPath": str(logs / "service.log"),
        "StandardErrorPath": str(logs / "service-error.log"),
        "EnvironmentVariables": {"PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", "PYTHONUNBUFFERED": "1", "TZ": "Asia/Shanghai"},
    }
    loaded = subprocess.run(["launchctl", "print", f"{target}/{LABEL}"], capture_output=True).returncode == 0
    if not loaded:
        with plist.open("wb") as f:
            plistlib.dump(definition, f)
        plist.chmod(0o600)
        subprocess.run(["launchctl", "bootstrap", target, str(plist)], check=True)
    else:
        subprocess.run(["launchctl", "kickstart", f"{target}/{LABEL}"], check=True)
    for _ in range(30):
        try:
            with urllib.request.urlopen(URL + "/api/state", timeout=2) as response:
                if response.status == 200:
                    print(URL)
                    return
        except OSError:
            time.sleep(1)
    raise RuntimeError(f"服务未就绪，请查看 {logs / 'service-error.log'}")


def stop():
    target = f"gui/{os.getuid()}/{LABEL}"
    subprocess.run(["launchctl", "bootout", target], check=False)
    # bootout is asynchronous: wait until the registration disappears before
    # a subsequent start decides whether it must bootstrap the agent again.
    for _ in range(50):
        if subprocess.run(["launchctl", "print", target], capture_output=True).returncode != 0:
            return
        time.sleep(0.2)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "stop":
        stop()
    elif len(sys.argv) > 1 and sys.argv[1] == "uninstall":
        stop()
        (Path.home() / "Library/LaunchAgents" / f"{LABEL}.plist").unlink(missing_ok=True)
    else:
        start()
