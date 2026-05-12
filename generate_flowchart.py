#!/usr/bin/env python3
"""
Generate MTECH/FinFin API Flow Chart for PEAK API Submission
Run: python3.12 generate_flowchart.py
Output: /home/user/MTECH/MTECH_API_Flow.png
"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon
from matplotlib.lines import Line2D
import numpy as np

plt.rcParams['font.family'] = ['Loma', 'DejaVu Sans', 'sans-serif']
plt.rcParams['axes.unicode_minus'] = False

# ─── Colors ──────────────────────────────────────────────────────────────────
C_BLUE   = '#4472C4'   # Source / GAS
C_ORANGE = '#FF9900'   # Process
C_PINK   = '#FF7B7B'   # API call
C_YELLOW = '#FFE566'   # Data module
C_RED    = '#C00000'   # Decision
C_GREEN  = '#70AD47'   # PEAK output doc
C_GRAY   = '#555555'

# ─── Drawing Helpers ──────────────────────────────────────────────────────────

def rbox(ax, cx, cy, w, h, text, color, fontsize=8.5, tc='white', lw=0.9):
    x, y = cx - w/2, cy - h/2
    p = FancyBboxPatch((x, y), w, h,
        boxstyle='round,pad=0.015,rounding_size=0.09',
        facecolor=color, edgecolor=C_GRAY, linewidth=lw, zorder=3)
    ax.add_patch(p)
    ax.text(cx, cy, text, ha='center', va='center', fontsize=fontsize,
            color=tc, fontweight='bold', zorder=4, multialignment='center',
            linespacing=1.3)

def dia(ax, cx, cy, w, h, text, fontsize=7.5):
    pts = np.array([[cx, cy+h/2], [cx+w/2, cy], [cx, cy-h/2], [cx-w/2, cy]])
    d = Polygon(pts, closed=True, facecolor=C_RED, edgecolor=C_GRAY,
                linewidth=0.9, zorder=3)
    ax.add_patch(d)
    ax.text(cx, cy, text, ha='center', va='center', fontsize=fontsize,
            color='white', fontweight='bold', zorder=4, multialignment='center',
            linespacing=1.25)

def arr(ax, x1, y1, x2, y2, label='', lside='r', fs=7.5):
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle='->', color='#333333', lw=1.1), zorder=2)
    if label:
        mx, my = (x1+x2)/2, (y1+y2)/2
        offset = 0.07 if lside == 'r' else -0.07
        ha = 'left' if lside == 'r' else 'right'
        ax.text(mx+offset, my, label, fontsize=fs, color='#444444',
                va='center', ha=ha, zorder=5)

def harr(ax, x1, y1, x2, y2, label='', lside='top'):
    # L-shaped arrow: go horizontal then vertical
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(
                    arrowstyle='->', color='#333333', lw=1.1,
                    connectionstyle='angle,angleA=0,angleB=90'
                ), zorder=2)
    if label:
        if lside == 'top':
            ax.text(x1, y1+0.12, label, fontsize=7.5, color='#444444',
                    va='bottom', ha='center', zorder=5)
        else:
            ax.text((x1+x2)/2, (y1+y2)/2-0.12, label, fontsize=7.5,
                    color='#444444', va='top', ha='center', zorder=5)

def stick(ax, cx, cy, w, h, lines, fontsize=7.5):
    x, y = cx - w/2, cy - h/2
    p = FancyBboxPatch((x, y), w, h,
        boxstyle='square,pad=0.01',
        facecolor='#FFFDE7', edgecolor='#CCAA00', linewidth=0.8, zorder=3)
    ax.add_patch(p)
    text = '\n'.join(lines)
    ax.text(x+0.08, y+h-0.08, text, ha='left', va='top', fontsize=fontsize,
            color='#333333', zorder=4, multialignment='left', linespacing=1.35)

def section_title(ax, x, y, text, fs=10.5):
    ax.text(x, y, text, ha='left', va='center', fontsize=fs,
            fontweight='bold', color='#1F1F1F')

def legend_panel(ax):
    ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis('off')
    ax.set_facecolor('#F5F5F5')
    p = FancyBboxPatch((0.1, 0.1), 9.8, 9.8,
        boxstyle='round,pad=0.05,rounding_size=0.2',
        facecolor='#F5F5F5', edgecolor='#CCCCCC', linewidth=0.8, zorder=1)
    ax.add_patch(p)

    # ── ส่วนที่ 1: สัญลักษณ์ ──────────────────────────────────────────────────
    ax.text(5, 9.55, 'สัญลักษณ์', ha='center', va='center',
            fontsize=10, fontweight='bold', color='#1F1F1F')

    items = [
        (C_RED,     'diamond', 'ทางแยกที่ต้องใช้การตัดสินใจ'),
        (C_ORANGE,  'rect',    'กระบวนการทำงาน'),
        (C_PINK,    'rect',    'เส้น API (HTTP POST → PEAK)'),
        (C_BLUE,    'rect',    'ระบบต้นทาง / ข้อมูล Input'),
        (C_GREEN,   'rect',    'เอกสารที่สร้างใน PEAK'),
        ('#FFFDE7', 'rect_y',  'Field ที่ส่งไปใน API Request'),
    ]
    for i, (color, shape, label) in enumerate(items):
        yp = 9.0 - i * 0.82
        if shape == 'diamond':
            pts = np.array([[1.35, yp+0.25], [1.85, yp], [1.35, yp-0.25], [0.85, yp]])
            ax.add_patch(Polygon(pts, closed=True, facecolor=color,
                                 edgecolor=C_GRAY, linewidth=0.7, zorder=3))
        else:
            r = FancyBboxPatch((0.75, yp-0.20), 1.4, 0.40,
                boxstyle='round,pad=0.01,rounding_size=0.06',
                facecolor=color, edgecolor=C_GRAY, linewidth=0.7, zorder=3)
            ax.add_patch(r)
        ax.text(2.4, yp, label, va='center', fontsize=8.5, color='#222222')

    # ── เส้นแบ่ง ──────────────────────────────────────────────────────────────
    sep_y = 9.0 - 5 * 0.82 - 0.45   # ≈ 3.65
    ax.axhline(sep_y, xmin=0.04, xmax=0.96, color='#BBBBBB', lw=1.0)

    # ── ส่วนที่ 2: ตารางปริมาณเอกสาร ──────────────────────────────────────────
    vol_title_y = sep_y - 0.40
    ax.text(5, vol_title_y, 'ปริมาณเอกสารโดยประมาณ (ต่อเดือน)',
            ha='center', va='center', fontsize=9.5, fontweight='bold', color='#1F1F1F')

    # หัวตาราง
    hdr_y = vol_title_y - 0.52
    ax.add_patch(FancyBboxPatch((0.25, hdr_y-0.22), 9.5, 0.42,
        boxstyle='square,pad=0.01',
        facecolor='#1F4E79', edgecolor='#1F4E79', linewidth=0, zorder=2))
    ax.text(0.5,  hdr_y, 'งาน / เอกสาร',       va='center', fontsize=8.5,
            color='white', fontweight='bold')
    ax.text(9.6,  hdr_y, 'รายการ/เดือน',        va='center', fontsize=8.5,
            color='white', fontweight='bold', ha='right')

    vol = [
        ('Part 1   ใบกำกับภาษี + ใบเสร็จ',   '800 – 1,200'),
        ('Part 1   ค่าบริการ',                 '~100'),
        ('Part 2   ใบแจ้งหนี้ (สัญญาใหม่)',    '100 – 200'),
        ('Part 3   ใบเสร็จค่าปรับ',             '~100'),
        ('Part 4   ใบลดหนี้ (คืนเครื่อง)',     '~50'),
        ('Poll Queue  (GET — ไม่นับโควตา)',     '500 – 800'),
    ]
    row_h = 0.44
    for i, (lbl, val) in enumerate(vol):
        yp = hdr_y - 0.22 - (i + 0.5) * row_h
        bg = '#EEF4FB' if i % 2 == 0 else '#FFFFFF'
        ax.add_patch(FancyBboxPatch((0.25, yp-row_h/2), 9.5, row_h,
            boxstyle='square,pad=0.005',
            facecolor=bg, edgecolor='#DDDDDD', linewidth=0.5, zorder=2))
        ax.text(0.5,  yp, lbl, va='center', fontsize=8.0, color='#333333')
        ax.text(9.6,  yp, val, va='center', fontsize=8.0, color='#1F4E79',
                fontweight='bold', ha='right')

    # แถวรวม
    total_y = hdr_y - 0.22 - (len(vol) + 0.5) * row_h
    ax.add_patch(FancyBboxPatch((0.25, total_y-row_h/2), 9.5, row_h,
        boxstyle='square,pad=0.005',
        facecolor='#FCE4D6', edgecolor='#C00000', linewidth=0.8, zorder=2))
    ax.text(0.5,  total_y, 'รวมทั้งหมด', va='center', fontsize=8.5,
            color='#C00000', fontweight='bold')
    ax.text(9.6,  total_y, '1,650 – 2,450', va='center', fontsize=8.5,
            color='#C00000', fontweight='bold', ha='right')


# ─── Panel Drawing Functions ──────────────────────────────────────────────────

def panel_part1(ax):
    """Part 1: ใบกำกับภาษี + ใบเสร็จ (มีสองกรณี A และ B)"""
    ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis('off')

    section_title(ax, 0.2, 9.7, 'Part 1  ใบกำกับภาษี + ใบเสร็จรับเงิน')

    # ── Legend mini ──
    for i, (c, lbl) in enumerate([
        (C_RED,    'ทางแยกตัดสินใจ'),
        (C_ORANGE, 'กระบวนการ'),
        (C_PINK,   'HTTP POST API'),
    ]):
        if c == C_RED:
            pts = np.array([[0.45+i*1.9, 9.1+0.18],[0.7+i*1.9,9.1],[0.45+i*1.9,9.1-0.18],[0.2+i*1.9,9.1]])
            ax.add_patch(Polygon(pts, closed=True, facecolor=c,
                                 edgecolor=C_GRAY, linewidth=0.6))
        else:
            ax.add_patch(FancyBboxPatch((0.2+i*1.9, 8.95), 0.5, 0.30,
                boxstyle='round,pad=0.01,rounding_size=0.05',
                facecolor=c, edgecolor=C_GRAY, linewidth=0.6))
        ax.text(0.85+i*1.9, 9.1, lbl, va='center', fontsize=7, color='#333333')

    # ── Source ──
    rbox(ax, 5.0, 8.4, 4.0, 0.55, 'Google Apps Script', C_BLUE, fontsize=8.5)
    arr(ax, 5.0, 8.12, 5.0, 7.75)

    rbox(ax, 5.0, 7.5, 4.0, 0.50, 'อ่านข้อมูล  Receipt.MM.YYYY', C_ORANGE, fontsize=8.5)
    arr(ax, 5.0, 7.25, 5.0, 6.92)

    # ── Decision 1 ──
    dia(ax, 5.0, 6.6, 3.2, 0.60, 'มี PAY_DATE ?', fontsize=8)
    # No → right (skip)
    ax.annotate('', xy=(9.3, 6.6), xytext=(6.6, 6.6),
                arrowprops=dict(arrowstyle='->', color='#333333', lw=1.0), zorder=2)
    ax.text(7.9, 6.72, 'ไม่มี → ข้าม', fontsize=7.5, color='#444444', ha='center', va='bottom')
    rbox(ax, 9.6, 6.6, 0.8, 0.40, 'Skip', '#AAAAAA', fontsize=7.5, tc='white')

    # Yes ↓
    arr(ax, 5.0, 6.30, 5.0, 5.92, 'มี')

    # ── Decision 2 ──
    dia(ax, 5.0, 5.60, 4.0, 0.60,
        'payDate  <  dueDate ?\n(จ่ายก่อนกำหนด)', fontsize=7.5)

    # ── Case A (left branch) ──
    ax.annotate('', xy=(2.0, 5.20), xytext=(3.0, 5.60),
                arrowprops=dict(arrowstyle='->', color='#333333', lw=1.0,
                connectionstyle='arc3,rad=0.0'), zorder=2)
    ax.text(2.0, 5.45, 'ใช่\n(Case A)', fontsize=7.5, color='#444444',
            ha='right', va='center', multialignment='center')

    rbox(ax, 2.0, 4.88, 3.2, 0.58,
         'HTTP POST\n/Receipts/allinone', C_PINK, fontsize=8)
    arr(ax, 2.0, 4.59, 2.0, 4.15)

    rbox(ax, 2.0, 3.90, 3.2, 0.50,
         'ใบกำกับภาษี + ใบเสร็จรับเงิน\n(รวมใบเดียว)', C_GREEN, fontsize=8)

    stick(ax, 2.0, 2.55, 3.4, 1.20, [
        'RE/RT Module',
        '- contactCode (เลขสัญญา)',
        '- issuedDate (payDate)',
        '- isTaxInvoice: true',
        '- products: ค่างวด/เงินดาวน์/ปิดยอด',
        '- vatType: 7%',
        '- paymentMethods: โอน',
    ], fontsize=7.0)

    # ── Case B (right branch) ──
    ax.annotate('', xy=(7.8, 5.15), xytext=(7.0, 5.60),
                arrowprops=dict(arrowstyle='->', color='#333333', lw=1.0), zorder=2)
    ax.text(8.0, 5.40, 'ไม่ใช่\n(Case B)', fontsize=7.5, color='#444444',
            ha='left', va='center', multialignment='center')

    rbox(ax, 7.8, 4.88, 3.2, 0.58,
         'HTTP POST\n/Invoices/queue  (Tax IV)', C_PINK, fontsize=7.8)
    arr(ax, 7.8, 4.59, 7.8, 4.15)

    rbox(ax, 7.8, 3.90, 3.2, 0.58,
         'HTTP POST\n/Receipts/queue  (Receipt)', C_PINK, fontsize=7.8)
    arr(ax, 7.8, 3.61, 7.8, 3.17)

    rbox(ax, 7.8, 2.92, 2.4, 0.50,
         'Poll Queue\n(07_PollResults.gs)', C_ORANGE, fontsize=7.8)
    arr(ax, 7.8, 2.67, 7.8, 2.22)

    rbox(ax, 7.8, 1.97, 3.2, 0.50,
         'ใบกำกับภาษี / ใบเสร็จรับเงิน\n(แยกใบ)', C_GREEN, fontsize=8)

    stick(ax, 7.8, 0.55, 3.4, 1.20, [
        'IV/RT Module',
        '- contactCode (เลขสัญญา)',
        '- issuedDate (dueDate/payDate)',
        '- isTaxInvoice: true/false',
        '- products, vatType: 7%',
        '- paymentMethods: โอน (Receipt)',
        '- queueId (ติดตามผ่าน Poll)',
    ], fontsize=7.0)


def panel_svc(ax):
    """Part 1 ค่าบริการ"""
    ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis('off')
    section_title(ax, 0.3, 9.6, 'Part 1  ค่าบริการเพิ่มเติม')

    rbox(ax, 5.0, 8.6, 5.5, 0.55, 'Google Apps Script', C_BLUE, fontsize=8.5)
    arr(ax, 5.0, 8.32, 5.0, 7.90)

    rbox(ax, 5.0, 7.65, 5.5, 0.50, 'อ่านข้อมูล  Sum.MM.YYYY', C_ORANGE, fontsize=8.5)
    arr(ax, 5.0, 7.40, 5.0, 6.98)

    dia(ax, 5.0, 6.65, 4.2, 0.62,
        'มี SERVICE_FEE > 0\nและยังไม่มี PEAK doc?', fontsize=8)

    # No → right
    ax.annotate('', xy=(9.3, 6.65), xytext=(7.1, 6.65),
                arrowprops=dict(arrowstyle='->', color='#333333', lw=1.0), zorder=2)
    ax.text(8.2, 6.78, 'ไม่ → ข้าม', fontsize=7.5, color='#444444', ha='center')
    rbox(ax, 9.6, 6.65, 0.8, 0.40, 'Skip', '#AAAAAA', fontsize=7.5, tc='white')

    # Yes ↓
    arr(ax, 5.0, 6.34, 5.0, 5.88, 'ใช่')

    rbox(ax, 5.0, 5.60, 5.5, 0.55,
         'HTTP POST\n/Receipts/allinone', C_PINK, fontsize=8.5)
    arr(ax, 5.0, 5.32, 5.0, 4.87)

    rbox(ax, 5.0, 4.60, 5.5, 0.55,
         'ใบกำกับภาษี + ใบเสร็จ\nค่าบริการเพิ่มเติม', C_GREEN, fontsize=8.5)

    stick(ax, 5.0, 3.05, 5.8, 1.35, [
        'RE/RT Module',
        '- contactCode (เลขสัญญา)',
        '- issuedDate (วันทำสัญญา/DUE_DATE)',
        '- isTaxInvoice: true',
        '- products: ค่าบริการเพิ่มเติม',
        '- accountCode: 410000',
        '- vatType: 7%',
        '- paymentMethods: โอน',
    ], fontsize=7.5)


def panel_inv(ax):
    """Part 2: ใบแจ้งหนี้สัญญาใหม่"""
    ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis('off')
    section_title(ax, 0.3, 9.6, 'Part 2  ใบแจ้งหนี้ (สัญญาใหม่)')

    rbox(ax, 5.0, 8.6, 5.5, 0.55, 'Google Apps Script', C_BLUE, fontsize=8.5)
    arr(ax, 5.0, 8.32, 5.0, 7.90)

    rbox(ax, 5.0, 7.65, 5.5, 0.50, 'อ่านข้อมูล  Sum.MM.YYYY', C_ORANGE, fontsize=8.5)
    arr(ax, 5.0, 7.40, 5.0, 6.98)

    dia(ax, 5.0, 6.65, 4.8, 0.62,
        'สัญญาใหม่ และ\nยังไม่มี PEAK doc?', fontsize=8)

    ax.annotate('', xy=(9.3, 6.65), xytext=(7.4, 6.65),
                arrowprops=dict(arrowstyle='->', color='#333333', lw=1.0), zorder=2)
    ax.text(8.35, 6.78, 'ไม่ → ข้าม', fontsize=7.5, color='#444444', ha='center')
    rbox(ax, 9.6, 6.65, 0.8, 0.40, 'Skip', '#AAAAAA', fontsize=7.5, tc='white')

    arr(ax, 5.0, 6.34, 5.0, 5.88, 'ใช่')

    rbox(ax, 5.0, 5.60, 5.5, 0.55,
         'HTTP POST\n/Invoices/allinone', C_PINK, fontsize=8.5)
    arr(ax, 5.0, 5.32, 5.0, 4.87)

    rbox(ax, 5.0, 4.60, 5.5, 0.55,
         'ใบแจ้งหนี้ (ยอดรวม ไม่แตกรายงวด)', C_GREEN, fontsize=8.5)

    stick(ax, 5.0, 2.80, 5.8, 1.60, [
        'IV Module',
        '- contactCode (เลขสัญญา)',
        '- issuedDate (วันทำสัญญา)',
        '- products: เงินดาวน์ (ถ้ามี) + ค่างวด N งวด รวม',
        '  (quantity=N, price=งวดละ, vatType: 7%)',
        '- dueDate: วันครบกำหนดงวดสุดท้าย',
        '- note: ชื่อลูกค้า + เลขสัญญา',
        '- ยอดรวม: CONTRACT_AMT (฿)',
    ], fontsize=7.5)


def panel_fee(ax):
    """Part 3: ใบเสร็จค่าปรับ"""
    ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis('off')
    section_title(ax, 0.3, 9.6, 'Part 3  ใบเสร็จค่าปรับ')

    rbox(ax, 5.0, 8.6, 5.5, 0.55, 'Google Apps Script', C_BLUE, fontsize=8.5)
    arr(ax, 5.0, 8.32, 5.0, 7.90)

    rbox(ax, 5.0, 7.65, 5.5, 0.50,
         'อ่านข้อมูล  SCB.MM.YYYY\n(Enhanced Format)', C_ORANGE, fontsize=8.5)
    arr(ax, 5.0, 7.40, 5.0, 6.98)

    dia(ax, 5.0, 6.65, 4.4, 0.62,
        'LATE_FEE > 0 และ\nยังไม่มี PEAK doc?', fontsize=8)

    ax.annotate('', xy=(9.3, 6.65), xytext=(7.2, 6.65),
                arrowprops=dict(arrowstyle='->', color='#333333', lw=1.0), zorder=2)
    ax.text(8.25, 6.78, 'ไม่ → ข้าม', fontsize=7.5, color='#444444', ha='center')
    rbox(ax, 9.6, 6.65, 0.8, 0.40, 'Skip', '#AAAAAA', fontsize=7.5, tc='white')

    arr(ax, 5.0, 6.34, 5.0, 5.88, 'ใช่')

    rbox(ax, 5.0, 5.60, 5.5, 0.55,
         'HTTP POST\n/Receipts/queue', C_PINK, fontsize=8.5)
    arr(ax, 5.0, 5.32, 5.0, 4.87)

    rbox(ax, 5.0, 4.60, 4.0, 0.50,
         'Poll Queue', C_ORANGE, fontsize=8.5)
    arr(ax, 5.0, 4.35, 5.0, 3.90)

    rbox(ax, 5.0, 3.65, 5.5, 0.50,
         'ใบเสร็จรับเงินค่าปรับ\n(ไม่มี VAT)', C_GREEN, fontsize=8.5)

    stick(ax, 5.0, 2.10, 5.8, 1.35, [
        'RT Module (ค่าปรับ)',
        '- contactCode (INV, เลขสัญญา)',
        '- issuedDate (PAY_DATE)',
        '- isTaxInvoice: false',
        '- products: ค่าปรับงวดที่ N',
        '- accountCode: 420000',
        '- vatType: ไม่มี VAT',
        '- paymentMethods: โอน',
    ], fontsize=7.5)


def panel_cn(ax):
    """Part 4: ใบลดหนี้"""
    ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis('off')
    section_title(ax, 0.3, 9.6, 'Part 4  ใบลดหนี้ (คืนเครื่อง)')

    rbox(ax, 5.0, 8.6, 5.5, 0.55, 'Google Apps Script', C_BLUE, fontsize=8.5)
    arr(ax, 5.0, 8.32, 5.0, 7.90)

    rbox(ax, 5.0, 7.65, 5.5, 0.50,
         'อ่านข้อมูล  ไฟล์รับคืน\n(RETURN_SHEET)', C_ORANGE, fontsize=8.5)
    arr(ax, 5.0, 7.40, 5.0, 6.98)

    dia(ax, 5.0, 6.65, 4.8, 0.62,
        'contractAmt − paidAmt > 0\nและยังไม่มี PEAK doc?', fontsize=8)

    ax.annotate('', xy=(9.3, 6.65), xytext=(7.4, 6.65),
                arrowprops=dict(arrowstyle='->', color='#333333', lw=1.0), zorder=2)
    ax.text(8.35, 6.78, 'ไม่ → ข้าม', fontsize=7.5, color='#444444', ha='center')
    rbox(ax, 9.6, 6.65, 0.8, 0.40, 'Skip', '#AAAAAA', fontsize=7.5, tc='white')

    arr(ax, 5.0, 6.34, 5.0, 5.88, 'ใช่')

    rbox(ax, 5.0, 5.60, 5.5, 0.55,
         'HTTP POST\n/CreditNotes', C_PINK, fontsize=8.5)
    arr(ax, 5.0, 5.32, 5.0, 4.87)

    rbox(ax, 5.0, 4.60, 5.5, 0.55,
         'ใบลดหนี้\n(อ้างอิงสัญญาเดิม)', C_GREEN, fontsize=8.5)

    stick(ax, 5.0, 2.95, 5.8, 1.45, [
        'CN Module',
        '- contactCode (INV, เลขสัญญา)',
        '- issuedDate (วันที่รับคืน)',
        '- products: คืนเครื่อง + Model + IMEI',
        '- accountCode: 410000',
        '- vatType: 7%',
        '- creditAmt = contractAmt − paidAmt',
        '- note: ชื่อลูกค้า + สาขา',
    ], fontsize=7.5)


# ─── Main ─────────────────────────────────────────────────────────────────────

fig = plt.figure(figsize=(44, 28), facecolor='white')
fig.patch.set_facecolor('white')

# Layout: 2 rows × 3 cols + legend col
# Row 0: Part1 (col 0-1) | Part1-SVC (col 2) | Part2 (col 3) | legend (col 4)
# Row 1: Part3 (col 0-1) | Part4 (col 2-3)   | (empty col 4)

from matplotlib.gridspec import GridSpec
gs = GridSpec(2, 5, figure=fig,
              left=0.01, right=0.99, top=0.95, bottom=0.02,
              hspace=0.08, wspace=0.06,
              width_ratios=[1.4, 0.7, 1, 1, 0.9])

ax_p1  = fig.add_subplot(gs[0, 0:2])   # Part 1 (wide)
ax_svc = fig.add_subplot(gs[0, 2])     # Part 1 ค่าบริการ
ax_inv = fig.add_subplot(gs[0, 3])     # Part 2
ax_leg = fig.add_subplot(gs[0, 4])     # Legend

ax_fee = fig.add_subplot(gs[1, 0:2])   # Part 3
ax_cn  = fig.add_subplot(gs[1, 2:4])   # Part 4
ax_emp = fig.add_subplot(gs[1, 4])     # Empty

# Main title
fig.text(0.5, 0.98,
         'MPTECH Accounting Automation — API Flow Chart for PEAK Integration',
         ha='center', va='top', fontsize=15, fontweight='bold', color='#1F1F1F')
fig.text(0.5, 0.965,
         'บจ. เอ็มพี เทค คอร์ปอเรชั่น (สำนักงานใหญ่)  |  Google Apps Script → PEAK Account API',
         ha='center', va='top', fontsize=10, color='#555555')

# Draw panels
panel_part1(ax_p1)
panel_svc(ax_svc)
panel_inv(ax_inv)
legend_panel(ax_leg)
panel_fee(ax_fee)
panel_cn(ax_cn)

ax_emp.axis('off')
ax_emp.set_facecolor('white')

# Dividers between rows
for ax in [ax_p1, ax_svc, ax_inv, ax_leg]:
    ax.set_facecolor('#FAFAFA')
    for spine in ['top', 'bottom', 'left', 'right']:
        ax.spines[spine].set_visible(False)
for ax in [ax_fee, ax_cn, ax_emp]:
    ax.set_facecolor('#FAFAFA')
    for spine in ['top', 'bottom', 'left', 'right']:
        ax.spines[spine].set_visible(False)

out = '/home/user/MTECH/MTECH_API_Flow.png'
fig.savefig(out, dpi=200, bbox_inches='tight', facecolor='white')
print(f'Saved: {out}')
plt.close(fig)
