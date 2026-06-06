"""MTECH — desktop client."""
from __future__ import annotations

import re
import threading
import tkinter as tk
import tkinter.font as tkfont
from datetime import datetime

import customtkinter as ctk

import config
from api import FinFinClient, NoInternetError, FinFinError

APP_TITLE = "MTECH ระบบบัญชี"
APP_SIZE  = "1100x720"

ctk.set_appearance_mode("Light")
ctk.set_default_color_theme("blue")


def _detect_font() -> str:
    try:
        root = tk.Tk()
        root.withdraw()
        families = set(tkfont.families(root))
        root.destroy()
        for f in ("Leelawadee UI", "Leelawadee", "Tahoma", "Arial"):
            if f in families:
                return f
    except Exception:
        pass
    return "Tahoma"

FONT = _detect_font()

# ── Palette (Tesla-inspired light) ───────────────────────────────────────────
BG        = "#f8fafc"   # main canvas — off-white
SIDEBAR   = "#0a0c10"   # sidebar stays deep-black (contrast anchor)
SURFACE   = "#ffffff"   # card / panel — pure white
SURFACE2  = "#f1f5f9"   # slightly raised
BORDER    = "#e2e8f0"   # hairline divider
TXT       = "#0f172a"   # primary text — near-black
TXT2      = "#475569"   # secondary / label
TXT3      = "#94a3b8"   # very muted
WHITE     = "#ffffff"
SUCCESS   = "#15803d"   # deep green (readable on white)
WARNING   = "#b45309"   # amber
DANGER    = "#b91c1c"   # red
BLUE      = "#2563eb"   # primary blue
INDIGO    = "#6366f1"   # indigo
TEAL      = "#0d9488"   # teal
BLUE_HOVER = "#1d4ed8"  # darker blue for hover

# ── Sidebar gradient ──────────────────────────────────────────────────────────
_SB_TOP = (59, 130, 246)   # #3b82f6  bright sky-blue
_SB_BOT = (30,  58, 138)   # #1e3a8a  deep navy


def _lerp_hex(y: int, h: int, lighter: bool = False) -> str:
    t = min(max(y / max(h, 1), 0), 1)
    r = int(_SB_TOP[0] + (_SB_BOT[0] - _SB_TOP[0]) * t)
    g = int(_SB_TOP[1] + (_SB_BOT[1] - _SB_TOP[1]) * t)
    b = int(_SB_TOP[2] + (_SB_BOT[2] - _SB_TOP[2]) * t)
    if lighter:
        r, g, b = min(r + 22, 255), min(g + 18, 255), min(b + 22, 255)
    return f"#{r:02x}{g:02x}{b:02x}"


class Tooltip:
    def __init__(self, widget: tk.BaseWidget, text: str) -> None:
        self._widget = widget
        self._text   = text
        self._win: tk.Toplevel | None = None
        widget.bind("<Enter>",       self._show, add="+")
        widget.bind("<Leave>",       self._hide, add="+")
        widget.bind("<ButtonPress>", self._hide, add="+")

    def _show(self, _=None) -> None:
        if self._win:
            return
        w = self._widget
        self._win = tw = tk.Toplevel(w)
        tw.wm_overrideredirect(True)
        tw.wm_attributes("-topmost", True)
        tw.wm_geometry(f"+{w.winfo_rootx()}+{w.winfo_rooty() + w.winfo_height() + 6}")
        tk.Label(tw, text=self._text, font=(FONT, 11),
                 bg="#1c1f27", fg="#d0d4dc",
                 padx=10, pady=6, justify="left", wraplength=360,
                 relief="flat", bd=0).pack()

    def _hide(self, _=None) -> None:
        if self._win:
            self._win.destroy()
            self._win = None


TASKS = [
    ("ออกใบแจ้งหนี้",           "part2/run",        "sheetName"),
    ("ออกใบกำกับภาษี",          "part1/run",        "sheetName"),
    ("ค่าบริการเพิ่มเติม",       "part1/servicefee", "sheetName"),
    ("ออกใบเสร็จค่าปรับ",       "part3/run",        "sheetName"),
    ("ออกใบลดหนี้ (คืนเครื่อง)", "part4/run",        None),
    ("Match Statement",         "part5/run",        "sheetName"),
    ("Poll Queue ทันที",         "poll/now",         None),
    ("ทดสอบ PEAK Connection",    "test/peak",        None),
]

# accent color per card (used as top border stripe)
PART_CARDS = [
    ("part1_tax", "ใบกำกับภาษี",        BLUE,    "receipt"),
    ("part3_fee", "ค่าปรับ",             WARNING, "statement"),
    ("part1_svc", "ค่าบริการเพิ่มเติม",  TEAL,    "sum"),
    ("part2_inv", "ใบแจ้งหนี้",          INDIGO,  "sum"),
]


def _F(size: int, bold: bool = False) -> ctk.CTkFont:
    return ctk.CTkFont(family=FONT, size=size, weight="bold" if bold else "normal")


def _parse_needs_rerun(result: str) -> tuple[bool, str]:
    """ตรวจสอบ GAS summary string ว่ามีรายการค้างต้องรันต่อ"""
    # "Error: N" หรือ "✗ N" → มีรายการที่ fail (contact ยังไม่ sync / payload error)
    m = re.search(r'Error[:\s]+(\d+)', result, re.IGNORECASE)
    if m and int(m.group(1)) > 0:
        n = int(m.group(1))
        return True, (
            f"⚠  ยังมี {n} รายการค้าง — ระบบ checkpoint บันทึกแล้ว\n"
            f"    กด \"Run อีกครั้ง\" เพื่อดำเนินการต่อจากจุดที่ค้างไว้"
        )
    # contact sync partial: "เหลือ N รายการ"
    m2 = re.search(r'เหลือ\s+(\d+)\s+รายการ', result)
    if m2 and int(m2.group(1)) > 0:
        n = int(m2.group(1))
        return True, (
            f"⚠  Sync contacts ยังไม่ครบ — เหลืออีก {n} รายการ\n"
            f"    กด \"Run อีกครั้ง\" เพื่อ sync ต่อ"
        )
    return False, ""


class MTechApp(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()
        self.option_add("*Font", f"{{{FONT}}} 13")
        self.title(APP_TITLE)
        self.geometry(APP_SIZE)
        self.minsize(960, 600)
        self.configure(fg_color=BG)

        self.cfg    = config.load()
        self.client = FinFinClient(self.cfg["gas_url"], self.cfg["api_key"])

        self.pages:          dict[str, ctk.CTkFrame] = {}
        self.nav_btns:       dict[str, tk.Button]    = {}
        self.nav_indicators: dict[str, int]           = {}
        self._cur_page:      str                      = ""
        self._sb_canvas:     tk.Canvas | None         = None
        self._sb_status_id:  int                      = 0
        self._task_running:  bool                     = False

        self._build_ui()
        self._show_page("dashboard" if self.cfg["gas_url"] else "settings")
        self.after(400, self._check_conn)
        self.after(1500, self._notif_auto)

    # ── Scaffold ──────────────────────────────────────────────────────────────

    def _build_ui(self) -> None:
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # ── Sidebar (gradient canvas) ─────────────────────────────────────────
        SB_W    = 220
        NAV_Y0  = 118   # y of first nav row
        NAV_DY  = 46    # row pitch

        sb = tk.Canvas(self, width=SB_W, highlightthickness=0, bd=0,
                       bg=_lerp_hex(360, 720))
        sb.grid(row=0, column=0, sticky="nsew")
        self._sb_canvas = sb

        def _redraw_sb(event=None) -> None:
            w = sb.winfo_width()  or SB_W
            h = sb.winfo_height() or 720
            sb.delete("bg")
            for y in range(0, h + 2, 2):
                sb.create_line(0, y, w, y + 1,
                               fill=_lerp_hex(y, h), width=2, tags="bg")
            sb.tag_lower("bg")
            if self._sb_status_id:
                sb.coords(self._sb_status_id, 22, h - 26)

        sb.bind("<Configure>", _redraw_sb)
        self.after(80, _redraw_sb)

        # ── Logo ──────────────────────────────────────────────────────────────
        lbg = _lerp_hex(44, 720)
        logo_f = tk.Frame(sb, bg=lbg)
        tk.Label(logo_f, text="MTECH",    font=(FONT, 26, "bold"),
                 bg=lbg, fg=WHITE).pack(anchor="w")
        tk.Label(logo_f, text="ระบบบัญชี", font=(FONT, 11),
                 bg=lbg, fg="#bfdbfe").pack(anchor="w", pady=(2, 0))
        sb.create_window(22, 44, window=logo_f, anchor="w")

        # ── Divider ───────────────────────────────────────────────────────────
        sb.create_line(18, 106, SB_W - 18, 106, fill="#93c5fd", width=1)

        # ── Nav items ─────────────────────────────────────────────────────────
        nav_items = [
            ("dashboard",     "Dashboard"),
            ("tasks",         "Tasks"),
            ("notifications", "Notifications"),
            ("settings",      "Settings"),
            ("logs",          "Logs"),
        ]
        for i, (key, label) in enumerate(nav_items):
            y   = NAV_Y0 + i * NAV_DY
            bg  = _lerp_hex(y + NAV_DY // 2, 720)
            hbg = _lerp_hex(y + NAV_DY // 2, 720, lighter=True)

            ind_id = sb.create_rectangle(10, y + 3, 13, y + 39,
                                         fill="", outline="")
            self.nav_indicators[key] = ind_id

            btn = tk.Button(
                sb, text=f"   {label}",
                font=(FONT, 14), bg=bg, fg="#93c5fd",
                activebackground=hbg, activeforeground=WHITE,
                anchor="w", relief="flat", bd=0, cursor="hand2",
                command=lambda k=key: self._show_page(k),
            )
            btn.bind("<Enter>",
                lambda e, b=btn, h=hbg: b.configure(bg=h, fg=WHITE))
            btn.bind("<Leave>",
                lambda e, b=btn, c=bg, k=key:
                    b.configure(bg=c,
                                fg=WHITE if self._cur_page == k else "#93c5fd"))
            sb.create_window(10, y + 3, window=btn, anchor="nw",
                             width=200, height=36)
            self.nav_btns[key] = btn

        # ── Notification badge (on the "แจ้งเตือน" nav row) ───────────────────
        notif_idx = next(i for i, (k, _) in enumerate(nav_items)
                         if k == "notifications")
        badge_y = NAV_Y0 + notif_idx * NAV_DY + 21
        self._notif_badge = tk.Label(sb, text="", font=(FONT, 9, "bold"),
                                     bg=DANGER, fg=WHITE, padx=6, pady=1, bd=0)
        # created after the nav buttons → renders above the button window
        self._notif_badge_win = sb.create_window(
            198, badge_y, window=self._notif_badge, anchor="e", state="hidden")

        # ── Status dot ────────────────────────────────────────────────────────
        sbg = _lerp_hex(690, 720)
        self.status_dot = tk.Label(sb, text="● ตรวจสอบ…",
                                   font=(FONT, 11), bg=sbg, fg="#93c5fd")
        self._sb_status_id = sb.create_window(22, 690, window=self.status_dot,
                                              anchor="w")

        # ── Content ───────────────────────────────────────────────────────────
        self.content = ctk.CTkFrame(self, fg_color=BG, corner_radius=0)
        self.content.grid(row=0, column=1, sticky="nsew")

        self.pages = {
            "dashboard":     self._build_dashboard(),
            "tasks":         self._build_tasks(),
            "notifications": self._build_notifications(),
            "settings":      self._build_settings(),
            "logs":          self._build_logs(),
        }

    def _show_page(self, key: str) -> None:
        self._cur_page = key
        for k, page in self.pages.items():
            if k == key:
                page.pack(fill="both", expand=True, padx=36, pady=32)
            else:
                page.pack_forget()
        for k, btn in self.nav_btns.items():
            active = k == key
            btn.configure(fg=WHITE if active else "#93c5fd")
            if self._sb_canvas and k in self.nav_indicators:
                self._sb_canvas.itemconfigure(
                    self.nav_indicators[k],
                    fill=WHITE if active else "")
        if key == "dashboard":
            self._refresh_dash()
        elif key == "notifications":
            self._load_notifications()

    # ── Dashboard ─────────────────────────────────────────────────────────────

    def _build_dashboard(self) -> ctk.CTkFrame:
        p = ctk.CTkFrame(self.content, fg_color="transparent")

        # Title row
        top = ctk.CTkFrame(p, fg_color="transparent")
        top.pack(fill="x", pady=(0, 6))
        ctk.CTkLabel(top, text="Dashboard", font=_F(32, True),
                     text_color=TXT).pack(side="left")

        right = ctk.CTkFrame(top, fg_color="transparent")
        right.pack(side="right")
        self.dash_month = ctk.CTkEntry(
            right, placeholder_text="เดือน  เช่น  03.2026", width=210,
            fg_color=SURFACE, border_color=BORDER, text_color=TXT,
            placeholder_text_color=TXT3, font=_F(13),
        )
        self.dash_month.pack(side="left", padx=(0, 10))
        ctk.CTkButton(right, text="Refresh", width=100,
            fg_color=BLUE, hover_color=BLUE_HOVER,
            text_color=WHITE, font=_F(13, True),
            corner_radius=6, command=self._refresh_dash,
        ).pack(side="left")

        self.dash_meta = ctk.CTkLabel(p, text="", anchor="w",
                                      text_color=TXT3, font=_F(11))
        self.dash_meta.pack(fill="x", pady=(0, 20))

        # Cards
        scroll = ctk.CTkScrollableFrame(p, fg_color="transparent",
                                        scrollbar_button_color=SURFACE2,
                                        scrollbar_button_hover_color=BORDER)
        scroll.pack(fill="both", expand=True)

        grid = ctk.CTkFrame(scroll, fg_color="transparent")
        grid.pack(fill="x", pady=(0, 20))
        grid.grid_columnconfigure((0, 1), weight=1, uniform="c")

        self.dash_cards: dict[str, dict] = {}
        for idx, (key, title, accent, sheet_key) in enumerate(PART_CARDS):
            card = self._metric_card(grid, title, accent)
            card["frame"].grid(row=idx // 2, column=idx % 2,
                               sticky="nsew", padx=6, pady=6)
            card["sheet_key"] = sheet_key
            self.dash_cards[key] = card

        # Queue row
        q = self._surface_panel(scroll)
        q.pack(fill="x", pady=(0, 8))
        ctk.CTkLabel(q, text="Queue Status", font=_F(13, True),
                     text_color=TXT2).pack(anchor="w", padx=20, pady=(16, 4))
        self.dash_queue = ctk.CTkLabel(q, text="—", anchor="w",
                                       text_color=TXT2, font=_F(13))
        self.dash_queue.pack(anchor="w", padx=20, pady=(0, 16))

        # Error row
        e = self._surface_panel(scroll)
        e.pack(fill="x")
        ctk.CTkLabel(e, text="Error ล่าสุด", font=_F(13, True),
                     text_color=TXT2).pack(anchor="w", padx=20, pady=(16, 4))
        self.dash_errors = ctk.CTkLabel(e, text="—", anchor="w",
                                        justify="left", text_color=TXT2,
                                        font=_F(12))
        self.dash_errors.pack(anchor="w", padx=20, pady=(0, 16), fill="x")

        return p

    def _surface_panel(self, parent) -> ctk.CTkFrame:
        return ctk.CTkFrame(parent, fg_color=SURFACE,
                            border_color=BORDER, border_width=1,
                            corner_radius=12)

    def _metric_card(self, parent, title: str, accent: str) -> dict:
        frame = ctk.CTkFrame(parent, fg_color=SURFACE,
                             border_color=BORDER, border_width=1,
                             corner_radius=12)
        frame.grid_columnconfigure(0, weight=1)

        # Accent top bar (3 px)
        ctk.CTkFrame(frame, height=3, fg_color=accent,
                     corner_radius=0).grid(row=0, column=0, sticky="ew")

        # Title + sheet name
        top = ctk.CTkFrame(frame, fg_color="transparent")
        top.grid(row=1, column=0, sticky="ew", padx=18, pady=(14, 0))
        top.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(top, text=title, anchor="w",
                     font=_F(12), text_color=TXT2).grid(row=0, column=0, sticky="w")
        self_sheet = ctk.CTkLabel(top, text="", anchor="e",
                                  font=_F(11), text_color=TXT3)
        self_sheet.grid(row=0, column=1, sticky="e")

        # Numbers
        nums = ctk.CTkFrame(frame, fg_color="transparent")
        nums.grid(row=2, column=0, sticky="ew", padx=18, pady=(10, 18))
        nums.grid_columnconfigure((0, 1, 2), weight=1)

        def _num(col, val_color, lbl_txt):
            v = ctk.CTkLabel(nums, text="0",
                             font=_F(30, True), text_color=val_color)
            v.grid(row=0, column=col, pady=(0, 2))
            ctk.CTkLabel(nums, text=lbl_txt,
                         font=_F(10), text_color=TXT3).grid(row=1, column=col)
            return v

        done_v   = _num(0, SUCCESS, "ทำแล้ว")
        queue_v  = _num(1, WARNING, "Queue")
        miss_v   = _num(2, DANGER,  "ยังไม่ออก")

        return {
            "frame": frame, "sheet_lbl": self_sheet,
            "done": done_v, "queued": queue_v, "missing": miss_v,
        }

    def _refresh_dash(self) -> None:
        self.dash_meta.configure(text="กำลังโหลด…")
        month = self.dash_month.get().strip()
        params = {"month": month} if month else {}

        def _t():
            try:
                data = self.client.call("dashboard/refresh", params, timeout=60)
                self.after(0, lambda: self._render_dash(data))
            except NoInternetError:
                self.after(0, self._show_offline)
                self.after(0, lambda: self.dash_meta.configure(text="Offline"))
            except Exception as e:
                msg = str(e)
                self.after(0, lambda: self.dash_meta.configure(text=msg))

        threading.Thread(target=_t, daemon=True).start()

    def _render_dash(self, data: dict) -> None:
        self.dash_meta.configure(
            text=f"Updated  {data.get('updatedAt','—')}    Month  {data.get('month','—')}")

        sheets = data.get("sheets", {})
        parts  = data.get("parts",  {})
        for key, card in self.dash_cards.items():
            p    = parts.get(key, {})
            si   = sheets.get(card["sheet_key"], {})
            name = si.get("name", "?")
            if not si.get("found"):
                card["sheet_lbl"].configure(text=f"not found", text_color=DANGER)
            elif p.get("error"):
                card["sheet_lbl"].configure(text=p["error"], text_color=WARNING)
            else:
                card["sheet_lbl"].configure(text=name, text_color=TXT3)
            card["done"].configure(   text=str(p.get("done",    0)))
            card["queued"].configure( text=str(p.get("queued",  0)))
            card["missing"].configure(text=str(p.get("missing", 0)))

        q = data.get("queues", {})
        total = sum(q.values()) if q else 0
        q_text = (f"Invoice  {q.get('invoice',0)}     "
                  f"Receipt  {q.get('receipt',0)}     "
                  f"Late Fee  {q.get('receipt_fee',0)}")
        if total:
            q_text += "    ·  Poll Queue ใน Tasks"
        self.dash_queue.configure(text=q_text,
                                  text_color=WARNING if total else TXT2)

        errs = data.get("errors", [])
        if not errs:
            self.dash_errors.configure(text="No recent errors", text_color=SUCCESS)
        else:
            txt = "\n".join(
                f"{e.get('ts','?')}  [{e.get('part','?')}]  {e.get('inv','?')}  {e.get('msg','')[:90]}"
                for e in errs)
            self.dash_errors.configure(text=txt, text_color=DANGER)

    # ── Tasks ─────────────────────────────────────────────────────────────────

    def _build_tasks(self) -> ctk.CTkFrame:
        p = ctk.CTkFrame(self.content, fg_color="transparent")

        ctk.CTkLabel(p, text="Tasks", font=_F(32, True),
                     text_color=TXT).pack(anchor="w", pady=(0, 4))
        ctk.CTkLabel(p, text="เลือก task แล้วกด Run — คำสั่งส่งตรงไปยัง GAS",
                     font=_F(13), text_color=TXT3).pack(anchor="w", pady=(0, 20))

        # Month bar
        mbar = ctk.CTkFrame(p, fg_color=SURFACE, corner_radius=8,
                            border_color=BORDER, border_width=1)
        mbar.pack(fill="x", pady=(0, 16))
        ctk.CTkLabel(mbar, text="เดือน", font=_F(13), text_color=TXT2,
                     ).pack(side="left", padx=(18, 10), pady=12)
        self.month_entry = ctk.CTkEntry(
            mbar, placeholder_text="03.2026  (ว่าง = เดือนปัจจุบัน)", width=300,
            fg_color=SURFACE2, border_color=BORDER, text_color=TXT,
            placeholder_text_color=TXT3, font=_F(13),
        )
        self.month_entry.pack(side="left", pady=12)
        ctk.CTkLabel(mbar, text="· prefix เติมให้อัตโนมัติ",
                     font=_F(11), text_color=TXT3).pack(side="left", padx=(10, 18))

        # Task list
        scroll = ctk.CTkScrollableFrame(p, fg_color="transparent",
                                        scrollbar_button_color=SURFACE2)
        scroll.pack(fill="both", expand=True)

        for label, action, param in TASKS:
            btn = ctk.CTkButton(
                scroll, text=label, anchor="w", height=48,
                fg_color=SURFACE, hover_color=SURFACE2,
                text_color=TXT, border_color=BORDER, border_width=1,
                font=_F(14), corner_radius=8,
                command=lambda a=action, pk=param, l=label: self._run(a, pk, l),
            )
            btn.pack(fill="x", pady=3)

        # Output
        ctk.CTkLabel(p, text="Output", font=_F(12, True),
                     text_color=TXT2).pack(anchor="w", pady=(16, 6))
        self.task_out = ctk.CTkTextbox(
            p, height=130,
            fg_color=SURFACE, border_color=BORDER, border_width=1,
            text_color=TXT, font=_F(12), corner_radius=8,
        )
        self.task_out.pack(fill="x")

        # ── Re-run banner (hidden until timeout / partial completion) ─────────
        self.rerun_banner = ctk.CTkFrame(
            p, fg_color="#fef3c7", border_color="#f59e0b",
            border_width=1, corner_radius=8,
        )
        # Not packed yet — shown dynamically by _show_rerun_banner()
        inner = ctk.CTkFrame(self.rerun_banner, fg_color="transparent")
        inner.pack(fill="x", padx=16, pady=10)
        self._rerun_msg = ctk.CTkLabel(
            inner, text="", anchor="w", justify="left",
            font=_F(13), text_color="#92400e", wraplength=680,
        )
        self._rerun_msg.pack(side="left", fill="x", expand=True)
        self._rerun_btn = ctk.CTkButton(
            inner, text="▶  Run อีกครั้ง", width=164,
            fg_color="#d97706", hover_color="#b45309",
            text_color=WHITE, font=_F(13, True),
            corner_radius=6, command=self._rerun_last,
        )
        self._rerun_btn.pack(side="right", padx=(14, 0))

        return p

    # ── Settings ──────────────────────────────────────────────────────────────

    def _build_settings(self) -> ctk.CTkFrame:
        p = ctk.CTkFrame(self.content, fg_color="transparent")

        ctk.CTkLabel(p, text="Settings", font=_F(32, True),
                     text_color=TXT).pack(anchor="w", pady=(0, 20))

        form = ctk.CTkScrollableFrame(p, fg_color="transparent",
                                      scrollbar_button_color=SURFACE2)
        form.pack(fill="both", expand=True)

        self._field(form, "GAS Web App URL", "gas_url",
                    ph="https://script.google.com/macros/s/AKfycb…/exec")
        self._field(form, "API Key", "api_key", ph="shared secret", show="•")

        ctk.CTkFrame(form, height=1, fg_color=BORDER).pack(fill="x", pady=(24, 16))
        row = ctk.CTkFrame(form, fg_color="transparent")
        row.pack(fill="x", pady=(0, 4))
        ctk.CTkLabel(row, text="PEAK Credentials", font=_F(15, True),
                     text_color=TXT).pack(side="left")
        ctk.CTkLabel(row, text="  ·  จะส่งไปเก็บที่ GAS ScriptProperties",
                     font=_F(12), text_color=TXT3).pack(side="left")

        self.e_connect = self._plain_field(form, "CONNECT_ID",
                                           initial=self.cfg.get("connect_id", ""))
        self.e_token   = self._plain_field(form, "USER_TOKEN", show="•",
                                           initial=self.cfg.get("user_token", ""))
        self.e_ss      = self._plain_field(form, "SPREADSHEET_ID",
                                           extract_sheet_id=True,
                                           initial=self.cfg.get("spreadsheet_id", ""))
        self.e_ret     = self._plain_field(form,
            "RETURN_SPREADSHEET_ID  (ว่างได้ ถ้าอยู่ใน Spreadsheet เดียวกัน)",
            extract_sheet_id=True)

        btns = ctk.CTkFrame(p, fg_color="transparent")
        btns.pack(fill="x", pady=(18, 0))

        def _white_btn(parent, text, w, cmd):
            return ctk.CTkButton(parent, text=text, width=w,
                fg_color=BLUE, hover_color=BLUE_HOVER,
                text_color=WHITE, font=_F(13, True),
                corner_radius=6, command=cmd)

        b1 = _white_btn(btns, "Save Local", 140, self._save)
        b1.pack(side="left", padx=(0, 10))
        Tooltip(b1, "บันทึก GAS URL และ API Key ลงเครื่องนี้")

        b2 = _white_btn(btns, "Push to GAS", 140, self._push)
        b2.pack(side="left", padx=(0, 10))
        Tooltip(b2, "ส่ง PEAK Credentials ไปเก็บที่ GAS ScriptProperties\n"
                    "(CONNECT_ID / USER_TOKEN / SPREADSHEET_ID)")

        b3 = ctk.CTkButton(btns, text="Test Connection", width=160,
            fg_color=WHITE, hover_color=SURFACE2,
            text_color=TXT, border_color=BORDER, border_width=1,
            font=_F(13), corner_radius=6, command=self._test_conn)
        b3.pack(side="left")
        Tooltip(b3, "ทดสอบว่าเชื่อมต่อ GAS Web App ได้\nต้องกด Save Local ก่อน")

        self.cfg_status = ctk.CTkLabel(p, text="", anchor="w",
                                       font=_F(13))
        self.cfg_status.pack(fill="x", pady=(14, 0))
        return p

    # ── Logs ──────────────────────────────────────────────────────────────────

    def _build_logs(self) -> ctk.CTkFrame:
        p = ctk.CTkFrame(self.content, fg_color="transparent")

        hdr = ctk.CTkFrame(p, fg_color="transparent")
        hdr.pack(fill="x", pady=(0, 16))
        ctk.CTkLabel(hdr, text="Logs", font=_F(32, True),
                     text_color=TXT).pack(side="left")
        ctk.CTkButton(hdr, text="Refresh", width=100,
            fg_color=BLUE, hover_color=BLUE_HOVER,
            text_color=WHITE, font=_F(13, True),
            corner_radius=6, command=self._load_logs,
        ).pack(side="right")

        self.logs_box = ctk.CTkTextbox(
            p, fg_color=SURFACE, border_color=BORDER, border_width=1,
            text_color=TXT2, font=_F(12), corner_radius=8,
        )
        self.logs_box.pack(fill="both", expand=True)
        return p

    # ── Notifications ─────────────────────────────────────────────────────────

    def _build_notifications(self) -> ctk.CTkFrame:
        p = ctk.CTkFrame(self.content, fg_color="transparent")

        hdr = ctk.CTkFrame(p, fg_color="transparent")
        hdr.pack(fill="x", pady=(0, 4))
        ctk.CTkLabel(hdr, text="Notifications", font=_F(32, True),
                     text_color=TXT).pack(side="left")
        ctk.CTkButton(hdr, text="Refresh", width=100,
            fg_color=BLUE, hover_color=BLUE_HOVER,
            text_color=WHITE, font=_F(13, True),
            corner_radius=6, command=self._load_notifications,
        ).pack(side="right")

        self.notif_meta = ctk.CTkLabel(p, text="", anchor="w",
                                       text_color=TXT3, font=_F(11))
        self.notif_meta.pack(fill="x", pady=(0, 8))

        body = ctk.CTkFrame(p, fg_color="transparent")
        body.pack(fill="both", expand=True)
        body.grid_columnconfigure(0, minsize=220)
        body.grid_columnconfigure(1, weight=1)
        body.grid_rowconfigure(0, weight=1)

        self.notif_cat_pane = ctk.CTkScrollableFrame(
            body, fg_color=SURFACE, width=210,
            border_color=BORDER, border_width=1, corner_radius=10,
            scrollbar_button_color=SURFACE2,
            scrollbar_button_hover_color=BORDER,
        )
        self.notif_cat_pane.grid(row=0, column=0, sticky="nsew", padx=(0, 10))

        self.notif_item_pane = ctk.CTkScrollableFrame(
            body, fg_color="transparent",
            scrollbar_button_color=SURFACE2,
            scrollbar_button_hover_color=BORDER,
        )
        self.notif_item_pane.grid(row=0, column=1, sticky="nsew")

        self._notif_placeholder = ctk.CTkLabel(
            self.notif_item_pane, text="เลือกประเภททางซ้าย",
            font=_F(13), text_color=TXT3,
        )
        self._notif_placeholder.pack(pady=40)

        self._notif_sections: dict = {}
        self._notif_active_key: str = ""
        return p

    def _load_notifications(self, silent: bool = False) -> None:
        if not silent:
            self.notif_meta.configure(text="กำลังโหลด…")

        def _t():
            try:
                data = self.client.call("notifications/list", {}, timeout=60)
                self.after(0, lambda: self._render_notifications(data))
            except NoInternetError:
                if not silent:
                    self.after(0, self._show_offline)
                    self.after(0, lambda: self.notif_meta.configure(text="Offline"))
            except Exception as e:
                msg = str(e)
                if not silent:
                    self.after(0, lambda: self.notif_meta.configure(text=msg))

        threading.Thread(target=_t, daemon=True).start()

    def _notif_auto(self) -> None:
        self._load_notifications(silent=True)
        self.after(90_000, self._notif_auto)

    def _render_notifications(self, data: dict) -> None:
        for w in self.notif_cat_pane.winfo_children():
            w.destroy()
        for w in self.notif_item_pane.winfo_children():
            w.destroy()
        self._notif_sections = {}
        self._notif_active_key = ""

        self.notif_meta.configure(
            text=f"อัปเดต  {data.get('generatedAt', '—')[:19].replace('T', '  ')}")

        sections = [
            ("errors",  "Error ที่ต้องแก้",       DANGER,  data.get("errors",  []),
             lambda e: (
                 f"[{e.get('part','?')}]  {e.get('sheet','')}  "
                 f"แถว {e.get('row','')}  ·  {e.get('inv','')}",
                 e.get("msg", ""))),
            ("actions", "งานที่ต้องลงมือ",         WARNING, data.get("actions", []),
             lambda a: (a.get("label", ""), a.get("detail", ""))),
            ("pending", "งานค้าง (อัตโนมัติ)",     BLUE,    data.get("pending", []),
             lambda p: (p.get("label", ""), p.get("detail", ""))),
            ("lastrun", "สรุปกิจกรรมล่าสุด",       TXT2,    data.get("lastRun", []), None),
        ]

        first_key = ""
        for kind, title, color, items, fmt in sections:
            count = len(items)
            self._notif_build_cat_btn(kind, title, color, count)
            self._notif_sections.setdefault(kind, {}).update(
                {"title": title, "color": color, "items": items, "fmt": fmt}
            )
            if not first_key:
                first_key = kind

        if first_key:
            self._notif_show_section(first_key)
        self._set_notif_badge(data.get("badge", 0))

    def _notif_build_cat_btn(self, kind: str, title: str, color, count: int) -> None:
        btn_frame = ctk.CTkFrame(self.notif_cat_pane, fg_color="transparent",
                                  corner_radius=8)
        btn_frame.pack(fill="x", padx=6, pady=3)

        accent = ctk.CTkFrame(btn_frame, width=4, fg_color=color, corner_radius=2)
        accent.pack(side="left", fill="y", pady=(4, 0), padx=4)

        inner = ctk.CTkFrame(btn_frame, fg_color="transparent")
        inner.pack(side="left", fill="both", expand=True, padx=8, pady=(8, 4))

        ctk.CTkLabel(inner, text=title, font=_F(12, True), text_color=TXT,
                     anchor="w").pack(anchor="w")

        badge_color = (DANGER  if color == DANGER  and count else
                       WARNING if color == WARNING and count else TXT3)
        count_lbl = ctk.CTkLabel(inner, text=f"{count} รายการ",
                                  font=_F(11), text_color=badge_color, anchor="w")
        count_lbl.pack(anchor="w")

        if kind != "lastrun":
            clear_btn = ctk.CTkButton(
                inner, text="Clear", width=64, height=22,
                fg_color=SURFACE, hover_color=SURFACE2,
                text_color=TXT2, border_color=BORDER, border_width=1,
                font=_F(11), corner_radius=4,
                command=lambda k=kind: self._clear_notif_section(k),
                state="normal" if count else "disabled",
            )
            clear_btn.pack(anchor="w", pady=(4, 4))
            self._notif_sections.setdefault(kind, {})["clear_btn"] = clear_btn

        self._notif_sections.setdefault(kind, {})["count_lbl"] = count_lbl
        self._notif_sections.setdefault(kind, {})["cat_frame"] = btn_frame

        def _on_click(_event=None, k=kind):
            self._notif_show_section(k)

        for w in (btn_frame, accent, inner):
            w.bind("<Button-1>", _on_click)
            w.configure(cursor="hand2")

    def _notif_highlight_cat(self, active_frame) -> None:
        for sec in self._notif_sections.values():
            f = sec.get("cat_frame")
            if f:
                f.configure(fg_color="transparent")
        active_frame.configure(fg_color=SURFACE2)

    def _notif_show_section(self, kind: str) -> None:
        self._notif_active_key = kind
        sec = self._notif_sections.get(kind, {})
        if sec.get("cat_frame"):
            self._notif_highlight_cat(sec["cat_frame"])

        for w in self.notif_item_pane.winfo_children():
            w.destroy()

        title = sec.get("title", "")
        color = sec.get("color", TXT2)
        items = sec.get("items", [])
        fmt   = sec.get("fmt")

        head = ctk.CTkFrame(self.notif_item_pane, fg_color="transparent")
        head.pack(fill="x", pady=(0, 12))
        ctk.CTkLabel(head, text=title, font=_F(14, True),
                     text_color=color).pack(side="left")
        ctk.CTkLabel(head, text=f"  {len(items)}", font=_F(13, True),
                     text_color=TXT3).pack(side="left")

        if kind == "lastrun":
            self._notif_render_lastrun(items)
            return

        if not items:
            ctk.CTkLabel(self.notif_item_pane, text="ไม่มีรายการ  ✓",
                         font=_F(13), text_color=SUCCESS).pack(anchor="w", pady=(0, 14))
            return

        for it in items:
            line1, line2 = fmt(it)
            row = ctk.CTkFrame(self.notif_item_pane, fg_color=SURFACE,
                               border_color=BORDER, border_width=1, corner_radius=8)
            row.pack(fill="x", pady=4)
            ctk.CTkLabel(row, text=line1, font=_F(12, True), text_color=TXT,
                         anchor="w", justify="left", wraplength=680,
                         ).pack(anchor="w", padx=12, pady=(8, 0))
            if line2:
                ctk.CTkLabel(row, text=line2, font=_F(11), text_color=TXT2,
                             anchor="w", justify="left", wraplength=680,
                             ).pack(anchor="w", padx=12, pady=(2, 8))
            else:
                ctk.CTkLabel(row, text="", height=6).pack()

    def _clear_notif_section(self, kind: str) -> None:
        sec       = self._notif_sections.get(kind, {})
        count_lbl = sec.get("count_lbl")
        clear_btn = sec.get("clear_btn")
        if count_lbl:
            count_lbl.configure(text="0 รายการ", text_color=TXT3)
        if clear_btn:
            clear_btn.configure(state="disabled")
        sec["items"] = []
        if self._notif_active_key == kind:
            self._notif_show_section(kind)

        def _t():
            try:
                self.client.call("notifications/clear", {"kind": kind}, timeout=30)
            except Exception:
                pass
        threading.Thread(target=_t, daemon=True).start()

    def _notif_render_lastrun(self, rows) -> None:
        if not rows:
            ctk.CTkLabel(self.notif_item_pane, text="ไม่มีข้อมูล",
                         font=_F(13), text_color=TXT3).pack(anchor="w", pady=(0, 14))
            return

        for r in rows:
            card = ctk.CTkFrame(self.notif_item_pane, fg_color=SURFACE,
                                border_color=BORDER, border_width=1, corner_radius=8)
            card.pack(fill="x", pady=4)

            top = ctk.CTkFrame(card, fg_color="transparent")
            top.pack(fill="x", padx=14, pady=(8, 4))
            ctk.CTkLabel(top, text=r.get("part", "?"), font=_F(13, True),
                         text_color=TXT, anchor="w").pack(side="left")
            ctk.CTkLabel(top, text=r.get("lastTs", "")[:19].replace("T", " "),
                         font=_F(11), text_color=TXT3, anchor="e").pack(side="right")

            stats = ctk.CTkFrame(card, fg_color="transparent")
            stats.pack(fill="x", padx=14, pady=(0, 8))
            for label, val, chip_color in [
                ("สำเร็จ", r.get("success", 0), SUCCESS),
                ("Queue",  r.get("queued",  0), WARNING),
                ("ข้าม",   r.get("skip",    0), TXT3),
                ("Error",  r.get("error",   0), DANGER),
            ]:
                chip = ctk.CTkFrame(stats, fg_color=SURFACE2, corner_radius=4)
                chip.pack(side="left", padx=(0, 4))
                ctk.CTkLabel(chip, text=f"{label} {val}", font=_F(11),
                             text_color=chip_color).pack(padx=8, pady=3)

    def _set_notif_badge(self, n: int) -> None:
        sb = self._sb_canvas
        if not sb:
            return
        if n and n > 0:
            self._notif_badge.configure(text=("9+" if n > 9 else str(n)))
            sb.itemconfigure(self._notif_badge_win, state="normal")
            sb.tag_raise(self._notif_badge_win)
        else:
            sb.itemconfigure(self._notif_badge_win, state="hidden")

    # ── Form helpers ──────────────────────────────────────────────────────────

    def _field(self, parent, label, cfg_key, ph="", show=None):
        ctk.CTkLabel(parent, text=label, font=_F(12), text_color=TXT2,
                     ).pack(anchor="w", pady=(12, 4))
        e = ctk.CTkEntry(parent, placeholder_text=ph, show=show, width=640,
                         fg_color=SURFACE, border_color=BORDER, text_color=TXT,
                         placeholder_text_color=TXT3, font=_F(13))
        e.insert(0, self.cfg.get(cfg_key, ""))
        e.pack(fill="x")
        setattr(self, f"_e_{cfg_key}", e)

    def _plain_field(self, parent, label, show=None, extract_sheet_id=False, initial=""):
        ctk.CTkLabel(parent, text=label, font=_F(12), text_color=TXT2,
                     ).pack(anchor="w", pady=(12, 4))
        e = ctk.CTkEntry(parent, show=show, width=640,
                         fg_color=SURFACE, border_color=BORDER, text_color=TXT,
                         placeholder_text_color=TXT3, font=_F(13))
        if initial:
            e.insert(0, initial)
        e.pack(fill="x")
        if extract_sheet_id:
            def _on_focus_out(_event, entry=e):
                raw = entry.get().strip()
                m = re.search(r'/spreadsheets/d/([a-zA-Z0-9_-]+)', raw)
                if m:
                    entry.delete(0, "end")
                    entry.insert(0, m.group(1))
            e.bind("<FocusOut>", _on_focus_out)
            e.bind("<Return>",   _on_focus_out)
        return e

    # ── Actions ───────────────────────────────────────────────────────────────

    def _save(self) -> None:
        self.cfg["gas_url"] = self._e_gas_url.get().strip()
        self.cfg["api_key"] = self._e_api_key.get().strip()
        config.save(self.cfg)
        self.client = FinFinClient(self.cfg["gas_url"], self.cfg["api_key"])
        self._status("✅  บันทึกเรียบร้อย", ok=True)
        self._check_conn()

    def _push(self) -> None:
        self._save()
        params = {k: v for k, v in {
            "CONNECT_ID":            self.e_connect.get().strip(),
            "USER_TOKEN":            self.e_token.get().strip(),
            "SPREADSHEET_ID":        self.e_ss.get().strip(),
            "RETURN_SPREADSHEET_ID": self.e_ret.get().strip(),
        }.items() if v}
        if not params:
            self._status("⚠  ไม่มีค่าให้ส่ง", warn=True)
            return
        def _t():
            try:
                r = self.client.call("config/set", params, timeout=30)
                self._status(f"✅  Push สำเร็จ  ·  {', '.join(r['updated'])}", ok=True)
            except NoInternetError as e:
                self.after(0, self._show_offline)
                self._status(str(e), err=True)
            except Exception as e:
                self._status(str(e), err=True)
        threading.Thread(target=_t, daemon=True).start()

    def _test_conn(self) -> None:
        self._save()
        self._check_conn(verbose=True)

    def _check_conn(self, verbose=False) -> None:
        def _t():
            try:
                self.client.ping()
                self.after(0, lambda: self.status_dot.configure(
                    text="● Connected", fg=SUCCESS))
                if verbose:
                    self._status("✅  เชื่อมต่อสำเร็จ", ok=True)
            except NoInternetError:
                self.after(0, lambda: self.status_dot.configure(
                    text="● Offline", fg=DANGER))
                if verbose:
                    self.after(0, self._show_offline)
            except Exception as e:
                self.after(0, lambda: self.status_dot.configure(
                    text="● Error", fg=WARNING))
                if verbose:
                    self._status(str(e), err=True)
        threading.Thread(target=_t, daemon=True).start()

    def _status(self, msg: str, ok=False, warn=False, err=False) -> None:
        color = SUCCESS if ok else WARNING if warn else DANGER if err else TXT2
        self.after(0, lambda: self.cfg_status.configure(text=msg, text_color=color))

    def _run(self, action: str, param_key: str | None, label: str) -> None:
        params = {}
        if param_key:
            v = self.month_entry.get().strip()
            if v:
                params[param_key] = v
        self._run_with_params(action, params, label)

    def _run_with_params(self, action: str, params: dict, label: str) -> None:
        if self._task_running:
            self._out("        ⚠  มี task กำลังทำงานอยู่ — รอให้เสร็จก่อนครับ\n")
            return
        self._task_running = True
        self._hide_rerun_banner()
        ts = datetime.now().strftime("%H:%M:%S")
        self.task_out.insert("end", f"[{ts}]  {label}\n")
        self.task_out.see("end")

        def _t():
            try:
                r = self.client.call(action, params)
                result = self._str(r)
                self._out(f"        ✓  {result}\n")
                # ตรวจว่ายังมีรายการค้าง (Error: N > 0 หรือ contact sync ไม่ครบ)
                needs, msg = _parse_needs_rerun(result)
                if needs:
                    self.after(0, lambda: self._show_rerun_banner(msg, action, params, label))
            except NoInternetError as e:
                self._out(f"        ✗  {e}\n")
                self.after(0, self._show_offline)
            except FinFinError as e:
                err_str = str(e)
                self._out(f"        ✗  {err_str}\n")
                if "หมดเวลา" in err_str:
                    msg = f"⏱  {err_str}  ·  ระบบบันทึก checkpoint แล้ว"
                    self.after(0, lambda: self._show_rerun_banner(msg, action, params, label))
            except Exception as e:
                self._out(f"        ✗  {e}\n")
            finally:
                self._task_running = False
                # งานที่รันไปอาจเปลี่ยนการแจ้งเตือน — รีเฟรช badge เงียบๆ
                self.after(1200, lambda: self._load_notifications(silent=True))

        threading.Thread(target=_t, daemon=True).start()

    # ── Re-run banner helpers ─────────────────────────────────────────────────

    def _show_rerun_banner(self, msg: str, action: str, params: dict, label: str) -> None:
        self._rerun_msg.configure(text=msg)
        self._pending_rerun = (action, params, label)
        self.rerun_banner.pack(fill="x", pady=(10, 0))

    def _hide_rerun_banner(self) -> None:
        self.rerun_banner.pack_forget()

    def _rerun_last(self) -> None:
        if hasattr(self, "_pending_rerun"):
            action, params, label = self._pending_rerun
            self._run_with_params(action, params, label)

    def _out(self, t: str) -> None:
        def _do():
            self.task_out.insert("end", t)
            self.task_out.see("end")
        self.after(0, _do)

    @staticmethod
    def _str(obj) -> str:
        if obj is None:
            return "(no data)"
        if isinstance(obj, (str, int, float, bool)):
            return str(obj)
        if isinstance(obj, dict):
            return "  ·  ".join(f"{k}: {v}" for k, v in obj.items())
        return str(obj)

    def _load_logs(self) -> None:
        def _t():
            try:
                rows = self.client.call("logs/tail", {"limit": 80}, timeout=60)
                lines = []
                for r in (rows or []):
                    lines.append(
                        f"{str(r.get('ts', ''))[:19]}  [{r.get('part', '')}]  "
                        f"{r.get('sheet', '')}  row {r.get('row', '')}  "
                        f"{r.get('inv', '')}  {r.get('status', '')}  "
                        f"{r.get('doc', '')}  {r.get('msg', '')}\n")
                text = "".join(lines) or "(ไม่มี log)\n"
                def _do():
                    self.logs_box.delete("1.0", "end")
                    self.logs_box.insert("end", text)
                self.after(0, _do)
            except NoInternetError:
                self.after(0, lambda: self.logs_box.insert("end", "Offline\n"))
                self.after(0, self._show_offline)
            except Exception as e:
                msg = str(e)
                self.after(0, lambda: self.logs_box.insert("end", f"{msg}\n"))
        threading.Thread(target=_t, daemon=True).start()

    # ── Offline dialog ────────────────────────────────────────────────────────

    def _show_offline(self) -> None:
        d = ctk.CTkToplevel(self)
        d.title("No connection")
        d.geometry("400x220")
        d.resizable(False, False)
        d.grab_set()
        d.transient(self)
        d.configure(fg_color=WHITE)
        self.update_idletasks()
        d.geometry(f"+{self.winfo_rootx()+(self.winfo_width()-400)//2}"
                   f"+{self.winfo_rooty()+(self.winfo_height()-220)//2}")
        ctk.CTkLabel(d, text="No Internet", font=_F(22, True),
                     text_color=TXT).pack(pady=(28, 6))
        ctk.CTkLabel(d, text="กรุณาตรวจสอบ WiFi / สายแลน แล้วลองอีกครั้ง",
                     font=_F(13), text_color=TXT2).pack(pady=(0, 20))
        ctk.CTkButton(d, text="OK", width=120,
            fg_color=BLUE, hover_color=BLUE_HOVER,
            text_color=WHITE, font=_F(13, True),
            corner_radius=6, command=d.destroy).pack()


def main() -> None:
    MTechApp().mainloop()


if __name__ == "__main__":
    main()
