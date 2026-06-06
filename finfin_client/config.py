"""Local config persistence (%APPDATA%\\FinFin\\config.json)"""
from __future__ import annotations

import json
import os
from pathlib import Path

APPDATA_DIR = Path(os.environ.get("APPDATA", Path.home())) / "FinFin"
CONFIG_FILE = APPDATA_DIR / "config.json"

DEFAULT: dict = {
    "gas_url":        "https://script.google.com/macros/s/AKfycbwnBO4IdcSyIH3RBxCSgLjsVuKdsS_Co3lCgZaZ2yCi8_XFo-PrYsZDC90tWW5dZNtm/exec",
    "api_key":        "finfin-secret-2026",
    "connect_id":     "mptechcorporation_peakapi",
    "user_token":     "83286c2d-c59b-4071-81a2-b3f6c16b0a95",
    "spreadsheet_id": "123EwnVGDbuaBg0HTsZhpdX8EgKvfa7nja9ngfenN5Zo",
}


def load() -> dict:
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            return {**DEFAULT, **data}
        except Exception:
            pass
    return DEFAULT.copy()


def save(cfg: dict) -> None:
    APPDATA_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
