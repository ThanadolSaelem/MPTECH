"""Local config persistence (%APPDATA%\\FinFin\\config.json)

Hardcoded values (GAS URL, API Key, PEAK credentials) ฝังในโปรแกรม —
override ค่าใน config.json เสมอ ลูกค้าไม่ต้องกรอกและจะไม่หาย
เหลือเฉพาะ spreadsheet_id / return_spreadsheet_id ที่ลูกค้ากรอกได้
"""
from __future__ import annotations

import json
import os
from pathlib import Path

APPDATA_DIR = Path(os.environ.get("APPDATA", Path.home())) / "FinFin"
CONFIG_FILE = APPDATA_DIR / "config.json"

HARDCODED: dict = {
    "gas_url":    "https://script.google.com/macros/s/AKfycbwnBO4IdcSyIH3RBxCSgLjsVuKdsS_Co3lCgZaZ2yCi8_XFo-PrYsZDC90tWW5dZNtm/exec",
    "api_key":    "finfin-secret-2026",
    "connect_id": "mptechcorporation_peakapi",
    "user_token": "83286c2d-c59b-4071-81a2-b3f6c16b0a95",
}

DEFAULT: dict = {
    **HARDCODED,
    "spreadsheet_id":        "",
    "return_spreadsheet_id": "",
}


def load() -> dict:
    data: dict = {}
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    # HARDCODED ชนะเสมอ — ค่าที่ลบ/แก้ใน config.json จะถูก override กลับ
    return {**DEFAULT, **data, **HARDCODED}


def save(cfg: dict) -> None:
    """บันทึกเฉพาะค่าที่ลูกค้าปรับเอง — ไม่บันทึก HARDCODED ลงไฟล์"""
    APPDATA_DIR.mkdir(parents=True, exist_ok=True)
    persist = {k: v for k, v in cfg.items() if k not in HARDCODED}
    CONFIG_FILE.write_text(
        json.dumps(persist, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
