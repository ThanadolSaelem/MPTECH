"""
Capture screenshots of each page in the MTECH app using Xvfb.
Run with: python3.12 capture_screenshots.py
"""
import os
import sys
import time
import subprocess

DISPLAY = ":99"
OUT_DIR = "/home/user/MTECH/manual_screenshots"
APP_DIR = "/home/user/MTECH/finfin_client"

os.makedirs(OUT_DIR, exist_ok=True)

# Start Xvfb
print("Starting Xvfb...")
xvfb = subprocess.Popen(
    ["Xvfb", DISPLAY, "-screen", "0", "1280x800x24"],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
os.environ["DISPLAY"] = DISPLAY
time.sleep(1.5)

# Patch sys.path
sys.path.insert(0, APP_DIR)

# Patch config so app shows Dashboard (not Settings) on startup
import config as _cfg
_cfg.load = lambda: {"gas_url": "http://localhost", "api_key": "testkey"}

# Patch FinFinClient so network calls are no-ops
from api import FinFinClient, FinFinError
_real_init = FinFinClient.__init__

def _stub_init(self, gas_url, api_key):
    self.gas_url = gas_url
    self.api_key = api_key

def _stub_call(self, action, params=None, timeout=300):
    # Return minimal mock data so Dashboard renders with zeros
    if action == "dashboard/refresh":
        return {
            "part1_tax":  {"done": 0, "queue": 0, "pending": 0, "sheetName": "Receipt05.2026"},
            "part3_fee":  {"done": 0, "queue": 0, "pending": 0, "statement": "SCB05.2026"},
            "part1_svc":  {"done": 0, "queue": 0, "pending": 0, "sum": "Sum05.2026"},
            "part2_inv":  {"done": 0, "queue": 0, "pending": 0, "sum": "Sum05.2026"},
            "queue":      {"invoices": 0, "receipts": 0, "lateFees": 0},
            "errors":     [],
            "month":      "05.2026",
            "updatedAt":  "2026-05-06T10:00:00",
        }
    if action == "logs/tail":
        return []
    if action == "ping":
        return {"pong": True}
    return {}

def _stub_ping(self):
    return {"pong": True}

FinFinClient.__init__ = _stub_init
FinFinClient.call     = _stub_call
FinFinClient.ping     = _stub_ping

# Also patch _check_conn to show Connected immediately (avoid threading noise)
import main as _main_mod
_real_check = None

def _stub_check_conn(self, verbose=False):
    self.status_dot.configure(text="● Connected", fg="#4ade80")

# Patch before class is instantiated
_main_mod.MTechApp._check_conn = _stub_check_conn

from main import MTechApp

PAGES = ["dashboard", "tasks", "settings", "logs"]
page_idx = [0]
app = [None]


def capture_page(page_name):
    path = f"{OUT_DIR}/ss_{page_name}.png"
    ret = os.system(f'scrot -d 0 "{path}"')
    if ret == 0 and os.path.exists(path):
        print(f"  ✓ {page_name} → {path}")
    else:
        print(f"  ✗ scrot failed for {page_name}")


def next_step():
    i = page_idx[0]
    if i >= len(PAGES):
        print("All screenshots done. Quitting.")
        app[0].quit()
        return

    page = PAGES[i]
    print(f"Navigating to: {page}")
    app[0]._show_page(page)
    app[0].update_idletasks()
    app[0].update()
    page_idx[0] += 1
    app[0].after(1800, lambda p=page: (capture_page(p), app[0].after(300, next_step)))


print("Launching MTechApp...")
app[0] = MTechApp()

# Start screenshot loop after 2.5s startup
app[0].after(2500, next_step)
app[0].mainloop()

xvfb.terminate()
print("Done.")
