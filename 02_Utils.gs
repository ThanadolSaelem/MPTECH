/**
 * FinFin Automation — Utility Functions
 */

// ─── Date Helpers ─────────────────────────────────────────────────────────────

/**
 * แปลง Date object หรือ string → "YYYY-MM-DD" สำหรับ PEAK API
 * รองรับหลาย format: Date object, "DD/MM/YYYY", "MM/DD/YYYY", serial number
 * @param {Date|string|number} val
 * @returns {string} "YYYY-MM-DD" หรือ "" ถ้า invalid
 */
function formatDateForAPI(val) {
  if (!val) return '';
  let d;

  if (val instanceof Date) {
    d = val;
  } else if (typeof val === 'number') {
    // Google Sheets date serial
    d = new Date((val - 25569) * 86400 * 1000);
  } else {
    const s = String(val).trim();
    if (!s) return '';

    // DD/MM/YYYY (Bank Statement format)
    const dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmyMatch) {
      const [, dd, mm, yyyy] = dmyMatch;
      // ตรวจว่าเป็น DD/MM หรือ MM/DD ด้วยการเช็ค dd > 12
      if (Number(dd) > 12) {
        // ต้องเป็น DD/MM/YYYY
        d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
      } else {
        // อาจเป็นทั้งสอง — ใช้ context: ไฟล์รับคืนใช้ MM/DD, Statement ใช้ DD/MM
        // ค่า default: DD/MM/YYYY (Bank Statement)
        d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
      }
    } else {
      d = new Date(s);
    }
  }

  if (isNaN(d.getTime())) return '';

  // PEAK API ใช้ yyyyMMdd (ไม่มีขีด) เช่น "20260415"
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/**
 * แปลง Date จากไฟล์รับคืน (MM/DD/YYYY format)
 * @param {string|Date} val
 * @returns {string} "YYYY-MM-DD"
 */
function formatReturnFileDate(val) {
  if (!val) return '';
  if (val instanceof Date) return formatDateForAPI(val);

  const s = String(val).trim();
  // MM/DD/YYYY
  const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, mm, dd, yyyy] = mdyMatch;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!isNaN(d.getTime())) return formatDateForAPI(d);
  }
  return formatDateForAPI(val);
}

/**
 * แปลง "YYYY-MM-DD" หรือ Date → Date object (noon Bangkok time)
 * @param {string|Date} val
 * @returns {Date|null}
 */
function toDate(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val)) return val;

  const s = String(val).trim();
  if (!s) return null;

  // YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), 12, 0, 0);
  }

  // DD/MM/YYYY
  const dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    const [, dd, mm, yyyy] = dmyMatch;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0);
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * เปรียบเทียบวันที่แบบ date-only (ไม่สน time)
 * @returns {number} -1, 0, 1
 */
function compareDates(a, b) {
  const da = toDate(a), db = toDate(b);
  if (!da || !db) return 0;
  const na = new Date(da.getFullYear(), da.getMonth(), da.getDate());
  const nb = new Date(db.getFullYear(), db.getMonth(), db.getDate());
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
}

// ─── Number Helpers ───────────────────────────────────────────────────────────

/**
 * แปลง string ยอดเงิน เช่น "1,450" หรือ "1450.00" → number
 * @param {string|number} val
 * @returns {number}
 */
function parseAmount(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const s = String(val).replace(/,/g, '').trim();
  return parseFloat(s) || 0;
}

/**
 * แปลงสตริง "งวดที่4" หรือ "4" หรือ "ง.4" → 4
 * @param {string|number} val
 * @returns {number} 0 ถ้า parse ไม่ได้
 */
function parseInstallmentNumber(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  const m = s.match(/\d+/);
  return m ? parseInt(m[0]) : 0;
}

// ─── Sheet Helpers ────────────────────────────────────────────────────────────

/**
 * ดึง Spreadsheet ID ที่ใช้งานจริง
 * ถ้า CONFIG ยังเป็น placeholder → auto-detect จาก active spreadsheet และ cache ไว้
 * รองรับทั้ง UI context และ trigger context
 * @returns {string}
 */
function getSpreadsheetId() {
  if (CONFIG.SPREADSHEET_ID && CONFIG.SPREADSHEET_ID !== 'YOUR_SPREADSHEET_ID') {
    return CONFIG.SPREADSHEET_ID;
  }
  // Fallback: ดึงจาก ScriptProperties (cache จากการรันครั้งแรก)
  const props = PropertiesService.getScriptProperties();
  let cachedId = props.getProperty('FINFIN_SPREADSHEET_ID');
  if (cachedId) return cachedId;

  // ครั้งแรก: ดึงจาก active spreadsheet (ต้องรันจาก UI)
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) {
      cachedId = active.getId();
      props.setProperty('FINFIN_SPREADSHEET_ID', cachedId);
      return cachedId;
    }
  } catch (e) { /* trigger context — ไม่มี active spreadsheet */ }

  throw new Error('ไม่พบ Spreadsheet ID — กรุณาระบุ SPREADSHEET_ID ใน 00_Config.gs หรือเปิด Sheet แล้วรันครั้งแรกจาก UI');
}

/**
 * สร้าง candidate sheet names ทุก pattern จาก prefix + MM + YYYY
 * รองรับ: Receipt03.2026, Receipt.03.2026, Receipt.2026.03,
 *          03Receipt.2026, 03.Receipt.2026, Receipt2026.03 ฯลฯ
 */
function sheetNameCandidates_(prefix, mm, yyyy) {
  return [
    `${prefix}${mm}.${yyyy}`,       // Receipt03.2026  ← ยืนยันแล้ว
    `${prefix}.${mm}.${yyyy}`,      // Receipt.03.2026
    `${prefix}${yyyy}.${mm}`,       // Receipt2026.03
    `${prefix}.${yyyy}.${mm}`,      // Receipt.2026.03
    `${mm}${prefix}.${yyyy}`,       // 03Receipt.2026
    `${mm}.${prefix}.${yyyy}`,      // 03.Receipt.2026
    `${mm}.${yyyy}.${prefix}`,      // 03.2026.Receipt
    `${prefix}${mm}${yyyy}`,        // Receipt032026
    `${prefix}.${mm}${yyyy}`,       // Receipt.032026
  ];
}

// ─── Sheet Type Signatures (content-based detection) ────────────────────────
// ใช้เมื่อ user เปลี่ยนชื่อ sheet ออกจาก prefix เดิม
// เช่น "Receipt03.2026" → "RE03.2026" → ดูจาก header row ว่ามีคอลัมน์ครบหรือไม่
const SHEET_SIGNATURES = {
  Receipt: {
    headerRows: [2],
    requiredTokens: ['เลขที่สัญญา', 'ประเภทการชำระ', 'ใบเสร็จรับเงิน'],
  },
  Sum: {
    headerRows: [2],
    requiredTokens: ['ยอดทำสัญญา', 'จำนวนงวด', 'ผ่อนงวดละ'],
  },
  SCB: {
    headerRows: [1, 6],
    requiredTokensAny: [
      ['Description', 'Deposit'],
      ['รายการ', 'ยอดเงินเข้า'],
      ['รายการ', 'จำนวนเงิน'],
    ],
  },
};

function _sheetHeaderMatchesSig_(sheet, sig) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return false;
  const lastRow = sheet.getLastRow();
  for (const hr of sig.headerRows) {
    if (lastRow < hr) continue;
    try {
      const headerStr = sheet.getRange(hr, 1, 1, lastCol)
                              .getValues()[0]
                              .map(v => String(v))
                              .join(' ');
      if (sig.requiredTokens && sig.requiredTokens.every(t => headerStr.includes(t))) {
        return true;
      }
      if (sig.requiredTokensAny &&
          sig.requiredTokensAny.some(group => group.every(t => headerStr.includes(t)))) {
        return true;
      }
    } catch (_) { /* skip protected/empty sheets */ }
  }
  return false;
}

/**
 * ค้นหา sheet โดยตรวจจากเนื้อหา header — ใช้เมื่อชื่อ sheet ไม่ตรง prefix
 * เช่น customer เปลี่ยน "Receipt03.2026" → "RE03.2026"
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} type  "Receipt" | "Sum" | "SCB"
 * @param {string=} monthStr  "03.2026" (optional — ถ้าระบุจะกรองชื่อให้มีเลขเดือน/ปี ตรงด้วย)
 * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function findSheetByContent_(ss, type, monthStr) {
  const sig = SHEET_SIGNATURES[type];
  if (!sig) return null;

  let mm, yyyy;
  if (monthStr) {
    const parts = String(monthStr).match(/(\d{1,2})[.\-\/](\d{4})/);
    if (parts) { mm = parts[1].padStart(2, '0'); yyyy = parts[2]; }
  }

  let best = null, bestDate = null;
  for (const sheet of ss.getSheets()) {
    if (!_sheetHeaderMatchesSig_(sheet, sig)) continue;

    const nameDigits = sheet.getName().replace(/[^0-9]/g, ' ');

    if (mm && yyyy) {
      // เดือนต้องตรง
      if (!nameDigits.includes(mm) || !nameDigits.includes(yyyy)) continue;
      return sheet;
    }

    // ไม่ระบุเดือน → เลือก sheet ที่มีเลขเดือน/ปีใหม่สุด
    const nums = nameDigits.trim().split(/\s+/).filter(Boolean);
    let sheetYY, sheetMM;
    for (const n of nums) {
      if (n.length === 4 && Number(n) > 2000) sheetYY = Number(n);
      if (n.length <= 2 && Number(n) >= 1 && Number(n) <= 12) sheetMM = Number(n);
    }
    if (sheetYY && sheetMM) {
      const d = new Date(sheetYY, sheetMM - 1, 1);
      if (!bestDate || d > bestDate) { bestDate = d; best = sheet; }
    } else if (!best) {
      best = sheet;
    }
  }
  return best;
}

/**
 * ค้นหา Sheet แบบ robust — ลอง candidate patterns ทั้งหมด
 * แล้ว fallback fuzzy (ชื่อมี prefix + mm + yyyy)
 * แล้ว fallback content-based (header ของ sheet ตรง signature)
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} prefix  เช่น "Receipt", "Sum", "SCB"
 * @param {string} monthStr  เช่น "03.2026"
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function findSheetRobust(ss, prefix, monthStr) {
  const parts = String(monthStr).match(/(\d{1,2})[.\-\/](\d{4})/);
  if (!parts) throw new Error(`รูปแบบเดือนไม่ถูกต้อง: "${monthStr}" (ต้องเป็น MM.YYYY)`);
  const mm   = parts[1].padStart(2, '0');
  const yyyy = parts[2];

  // 1) ลอง candidates ตามลำดับ
  for (const name of sheetNameCandidates_(prefix, mm, yyyy)) {
    const s = ss.getSheetByName(name);
    if (s) return s;
  }

  // 2) Fuzzy: หา sheet ที่ชื่อมี prefix + mm + yyyy (ตัวเลขเหมือนกัน)
  const clean = str => str.toLowerCase().replace(/[^a-z0-9]/g, '');
  const prefixClean = clean(prefix);
  for (const sheet of ss.getSheets()) {
    const n = clean(sheet.getName());
    if (n.includes(prefixClean) && n.includes(mm) && n.includes(yyyy)) {
      return sheet;
    }
  }

  // 3) Content-based: ตรวจจาก header row (รองรับ user เปลี่ยนชื่อ sheet)
  const byContent = findSheetByContent_(ss, prefix, `${mm}.${yyyy}`);
  if (byContent) return byContent;

  const tried = sheetNameCandidates_(prefix, mm, yyyy).join(', ');
  throw new Error(`ไม่พบ Sheet "${prefix}*${mm}*${yyyy}" — ลองแล้ว: ${tried}`);
}

/**
 * ดึง Sheet ตามชื่อ — รองรับ user เปลี่ยนชื่อ sheet
 *   1) ลองตรงก่อน (fast path)
 *   2) Parse prefix+month → findSheetRobust (มี content-based fallback ในตัว)
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} sheetName  ชื่อเต็ม เช่น "Sum02.2026", "Receipt03.2026"
 * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function getSheetByNameSmart_(ss, sheetName) {
  if (!sheetName) return null;
  const direct = ss.getSheetByName(sheetName);
  if (direct) return direct;
  const m = String(sheetName).match(/^([A-Za-z]+)[.\-]?(\d{1,2}[.\-\/]\d{4}|\d{4}[.\-\/]\d{1,2})$/);
  if (!m) return null;
  const monthStr = m[2]
    .replace(/[.\-\/](\d{4})$/, '.$1')
    .replace(/^(\d{4})[.\-\/](\d{1,2})$/, '$2.$1');

  // ถ้า prefix อยู่ใน RECEIPT_SHEET_PREFIXES → ลองทุก prefix ในกลุ่มเดียวกัน
  const receiptPrefixes = CONFIG.RECEIPT_SHEET_PREFIXES || [CONFIG.RECEIPT_SHEET_PREFIX];
  const inReceiptFamily = receiptPrefixes.some(p => p.toLowerCase() === m[1].toLowerCase());
  const prefixesToTry = inReceiptFamily ? receiptPrefixes : [m[1]];

  for (const prefix of prefixesToTry) {
    const candidate = ss.getSheetByName(`${prefix}${monthStr}`);
    if (candidate) return candidate;
    try {
      const robust = findSheetRobust(ss, prefix, monthStr);
      if (robust) return robust;
    } catch (_) { /* ลองตัวถัดไป */ }
  }
  return null;
}

/**
 * ดึง Sheet ตารางรับชำระตามชื่อ (เช่น "Receipt03.2026")
 * รองรับทุก format โดย findSheetRobust
 * @param {string} sheetName  ชื่อเต็ม หรือ prefix+MM.YYYY ก็ได้
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getPaymentSheet(sheetName) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  const sheet = getSheetByNameSmart_(ss, sheetName);
  if (sheet) return sheet;
  throw new Error(`ไม่พบ Sheet: "${sheetName}"`);
}

/**
 * ดึงชื่อ Sheet ปัจจุบัน (เดือนนี้) เช่น "05.2026"
 * @returns {string}
 */
function getCurrentMonthSheetName() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${mm}.${now.getFullYear()}`;
}

/**
 * หา Sheet ล่าสุดที่มีอยู่จริงตาม prefix — ไม่ยึดเดือนปัจจุบัน
 * สแกนชื่อ sheet ทั้งหมด, parse เดือน/ปี, คืน sheet ที่ใหม่ที่สุด
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} prefix  เช่น "Receipt", "Sum", "SCB"
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function findLatestSheetByPrefix(ss, prefix) {
  const clean  = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const pClean = clean(prefix);

  let best = null, bestDate = null;

  for (const sheet of ss.getSheets()) {
    const name = sheet.getName();
    if (!clean(name).startsWith(pClean)) continue;

    // ดึงตัวเลขจากชื่อ → หา yyyy และ mm
    const nums = name.replace(/[^0-9]/g, ' ').trim().split(/\s+/).filter(Boolean);
    let yyyy, mm;
    for (const n of nums) {
      if (n.length === 4 && Number(n) > 2000) yyyy = Number(n);
      if (n.length <= 2 && Number(n) >= 1 && Number(n) <= 12) mm = Number(n);
    }
    if (!yyyy || !mm) continue;

    const d = new Date(yyyy, mm - 1, 1);
    if (!bestDate || d > bestDate) { bestDate = d; best = sheet; }
  }

  if (best) return best;

  // Fallback: content-based (sheet ถูกเปลี่ยนชื่อจาก prefix เดิม)
  const byContent = findSheetByContent_(ss, prefix, null);
  if (byContent) return byContent;

  throw new Error(`ไม่พบ Sheet ที่มี prefix "${prefix}" ใน Spreadsheet`);
}

/**
 * ดึง Sheet Bank Statement เดือนล่าสุดที่มีอยู่จริง
 * @returns {string}
 */
function getCurrentStatementSheetName() {
  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  const prefix = CONFIG.STATEMENT_SHEET_PREFIX || CONFIG.STATEMENT_SHEET_NAME || 'SCB';
  try {
    // ลองเดือนปัจจุบันก่อน (fast path)
    return findSheetRobust(ss, prefix, getCurrentMonthSheetName()).getName();
  } catch (_) {
    return findLatestSheetByPrefix(ss, prefix).getName();
  }
}

/**
 * ดึงข้อมูลทุก row จาก Sheet (ข้ามแถวหัว row 1)
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Array<Array>} 2D array (0-indexed)
 */
function getSheetData(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
}

// ─── Sum Sheet Column Auto-Detect ────────────────────────────────────────────
// (detectReceiptColumns_ อยู่ด้านล่าง — ตามที่ HEAD เพิ่มไว้)

/**
 * Auto-detect คอลัมน์ใน Sum sheet (สัญญา) จาก header row
 * รองรับ layout เก่า + ใหม่ (Sum04+ เพิ่ม ที่อยู่/เลขบัตร/ชื่อสินค้า/Adj ค่างวด/คืนเครื่อง)
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Object} map ของ COL + SVC_DOC + INV_DOC (output cols)
 */
function detectSumColumns_(sheet) {
  const fallback = CONFIG.COL;
  let header;
  try {
    header = sheet.getRange(CONFIG.SUM_HEADER_ROW, 1, 1, sheet.getLastColumn())
      .getValues()[0].map(h => String(h || '').replace(/\s+/g, ''));
  } catch (_) {
    return Object.assign({}, fallback, {
      SVC_DOC: fallback.DUE_DATE + 1,
      INV_DOC: fallback.DUE_DATE + 2,
    });
  }

  const find = test => header.findIndex(test);
  const col = {
    SEQ:             find(h => h === 'ลำดับ'),
    CONTRACT_DATE:   find(h => h.includes('วันที่ทำสัญญา')),
    INV:             find(h => h.includes('เลขที่สัญญา')),
    TITLE:           find(h => h.includes('คำนำหน้า')),
    NAME:            find(h => h.includes('ชื่อลูกค้า')),
    ADDRESS:         find(h => h === 'ที่อยู่' || h.includes('ที่อยู่')),
    ID_CARD:         find(h => h.includes('เลขที่บัตร') || h.includes('บัตรปชช') || h.includes('บัตรประชาชน')),
    PRODUCT:         find(h => h.includes('ชื่อสินค้า') || h === 'สินค้า'),
    CONTRACT_AMT:    find(h => h.includes('ยอดทำสัญญา')),
    INSTALLMENT_N:   find(h => h.includes('จำนวนงวด')),
    INSTALLMENT_AMT: find(h => h.includes('ผ่อนงวดละ')),
    PAY_DAY:         find(h => h.includes('จ่ายทุกวันที่')),
    BRANCH:          find(h => h === 'สาขา'),
    AR_BEGIN:        find(h => h.includes('คงเหลือต้นงวด') || h.includes('ลูกหนี้ต้น')),
    DOWN_OR_MONTHLY: find(h => h.includes('เงินดาวน์')),
    ADJ:             find(h => h.includes('Adj')),
    LATE_FEE:        find(h => h.includes('ค่าปรับ')),
    SERVICE_FEE:     find(h => h.includes('ค่าบริการ')),
    RETURN:          find(h => h === 'คืนเครื่อง'),
    CLOSEOUT_DISC:   find(h => h.includes('ส่วนลดปิดยอด')),
    AR_END:          find(h => h.includes('คงเหลือปลายงวด') || h.includes('ลูกหนี้ปลาย')),
    DUE_DATE:        find(h => h.includes('วันที่ครบกำหนด')),
    RETURN_DATE:     find(h => h.includes('วันที่รับคืน')),
    DEBT_STATUS:     find(h => h.includes('สถานะลูกหนี้')),
  };

  // ต้องเจอ INV และ CONTRACT_DATE เป็นอย่างน้อย — ไม่งั้นใช้ fallback
  if (col.INV < 0 || col.CONTRACT_DATE < 0) {
    Logger.log(`detectSumColumns_ [${sheet.getName()}]: ใช้ fallback (ไม่พบ INV/CONTRACT_DATE)`);
    return Object.assign({}, fallback, {
      SVC_DOC: fallback.SVC_DOC_COL != null ? fallback.SVC_DOC_COL : fallback.DUE_DATE + 1,
      INV_DOC: fallback.INV_DOC_COL != null ? fallback.INV_DOC_COL : fallback.DUE_DATE + 2,
    });
  }

  // Fill missing from fallback
  for (const k of Object.keys(fallback)) {
    if (col[k] === undefined || col[k] < 0) col[k] = fallback[k];
  }

  // Output columns: ถ้าเจอ DUE_DATE จริง → ต่อหลัง DUE_DATE
  //                 ถ้าไม่เจอ → ใช้ CONFIG.COL.SVC_DOC_COL/INV_DOC_COL ที่ตั้งไว้
  const dueDateFound = col.DUE_DATE !== fallback.DUE_DATE;
  if (dueDateFound) {
    col.SVC_DOC = col.DUE_DATE + 1;
    col.INV_DOC = col.DUE_DATE + 2;
  } else {
    col.SVC_DOC = fallback.SVC_DOC_COL != null ? fallback.SVC_DOC_COL : col.DUE_DATE + 1;
    col.INV_DOC = fallback.INV_DOC_COL != null ? fallback.INV_DOC_COL : col.DUE_DATE + 2;
  }

  Logger.log(`detectSumColumns_ [${sheet.getName()}]: INV=${col.INV} CONTRACT_DATE=${col.CONTRACT_DATE} CONTRACT_AMT=${col.CONTRACT_AMT} INSTALLMENT_N=${col.INSTALLMENT_N} INSTALLMENT_AMT=${col.INSTALLMENT_AMT} PAY_DAY=${col.PAY_DAY} AR_BEGIN=${col.AR_BEGIN} DUE_DATE=${col.DUE_DATE} INV_DOC=${col.INV_DOC}`);
  return col;
}

/**
 * เขียนค่ากลับลง Sheet (1-indexed row, col)
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} rowIndex  0-indexed row จาก getSheetData
 * @param {number} col       0-indexed column จาก CONFIG.COL
 * @param {*} value
 */
function writeCell(sheet, rowIndex, col, value) {
  // +2 เพราะ: +1 หัว, +1 0-to-1 index
  sheet.getRange(rowIndex + 2, col + 1).setValue(value);
}

// ─── Log Sheet ────────────────────────────────────────────────────────────────

/**
 * ดึง/สร้าง Log Sheet
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getLogSheet() {
  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  let log = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);
  if (!log) {
    log = ss.insertSheet(CONFIG.LOG_SHEET_NAME);
    log.appendRow(['Timestamp', 'Part', 'Sheet', 'Row', 'INV', 'Status', 'DocNo', 'Message']);
    log.setFrozenRows(1);
  }
  return log;
}

/**
 * บันทึก log เข้า Log Sheet
 * @param {string} part      'Part1' | 'Part2' | 'Part3' | 'Part4'
 * @param {string} sheetName
 * @param {number} rowIndex  0-indexed
 * @param {string} invCode   เลขที่สัญญา
 * @param {string} status    'SUCCESS' | 'ERROR' | 'SKIP'
 * @param {string} [docNo]
 * @param {string} [msg]
 */
function logEntry(part, sheetName, rowIndex, invCode, status, docNo, msg) {
  try {
    const log = getLogSheet();
    log.appendRow([
      new Date(),
      part,
      sheetName,
      rowIndex + 2,  // actual row number in sheet
      invCode,
      status,
      docNo || '',
      msg || '',
    ]);
  } catch (e) {
    Logger.log(`Log error: ${e.message}`);
  }
}

// ─── Queue Result Storage (ScriptProperties) ─────────────────────────────────

/**
 * บันทึก queue ID ที่รอ poll
 * @param {string} queueType  'receipt' | 'invoice'
 * @param {string} queueId
 * @param {string} sheetName
 * @param {Object} meta  { rowIndex, invCode, docType }
 */
function saveQueueEntry(queueType, queueId, sheetName, meta) {
  const props = PropertiesService.getScriptProperties();
  const key = `QUEUE_${queueType.toUpperCase()}_${queueId}`;
  props.setProperty(key, JSON.stringify({ queueId, sheetName, meta, savedAt: Date.now() }));
}

/**
 * ดึง queue entries ทั้งหมดของ type นั้น
 * @param {string} queueType
 * @returns {Array<Object>}
 */
function getQueueEntries(queueType) {
  const props = PropertiesService.getScriptProperties();
  const prefix = `QUEUE_${queueType.toUpperCase()}_`;
  return Object.entries(props.getProperties())
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => {
      try { return { key: k, ...JSON.parse(v) }; }
      catch (e) { return null; }
    })
    .filter(Boolean);
}

/**
 * ลบ queue entry หลัง poll สำเร็จ
 */
function deleteQueueEntry(key) {
  PropertiesService.getScriptProperties().deleteProperty(key);
}

// ─── ScriptProperties Diagnostics & Cleanup ──────────────────────────────────

/**
 * แสดงขนาดของ ScriptProperties แต่ละ key (KB)
 * รันใน Apps Script editor เพื่อดูว่าอะไรกินที่
 */
function inspectScriptProperties() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const entries = Object.entries(props).map(([k, v]) => ({
    key: k,
    sizeKB: (v.length / 1024).toFixed(2),
  }));
  entries.sort((a, b) => Number(b.sizeKB) - Number(a.sizeKB));
  const total = entries.reduce((s, e) => s + Number(e.sizeKB), 0);
  Logger.log(`Total: ${total.toFixed(2)} KB / 500 KB (${(total / 5).toFixed(1)}%)`);
  entries.slice(0, 30).forEach(e => Logger.log(`${e.sizeKB.padStart(8)} KB  ${e.key}`));
  if (entries.length > 30) Logger.log(`... and ${entries.length - 30} more`);
}

/**
 * ลบ queue entries เก่ากว่า N ชั่วโมง (default 24h)
 */
function cleanupStaleQueueEntries(maxAgeHours) {
  maxAgeHours = maxAgeHours || 24;
  const cutoff = Date.now() - maxAgeHours * 3600000;
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let removed = 0;
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith('QUEUE_')) continue;
    try {
      const obj = JSON.parse(v);
      if (Number(obj.savedAt || 0) < cutoff) {
        props.deleteProperty(k);
        removed++;
      }
    } catch (e) {
      props.deleteProperty(k);
      removed++;
    }
  }
  Logger.log(`Cleaned ${removed} stale queue entries (>${maxAgeHours}h old)`);
  return removed;
}

/**
 * Pre-flight checks — เรียกตอนเริ่มทุก Part runner
 *   1. ลบ queue เก่ากว่า 24 ชม. อัตโนมัติ
 *   2. เตือนถ้า ScriptProperties usage > 80%
 *   3. Throw ถ้า > 95% (รันต่อไม่ได้แน่ — บอกให้ user ล้างก่อน)
 */
function preFlightChecks_() {
  checkLicense_();

  const cleaned = cleanupStaleQueueEntries(24);
  if (cleaned > 0) Logger.log(`Pre-flight: cleaned ${cleaned} stale queue entries`);

  const props = PropertiesService.getScriptProperties().getProperties();
  const totalBytes = Object.values(props).reduce((s, v) => s + v.length, 0);
  const usagePct = (totalBytes / (500 * 1024)) * 100;

  if (usagePct > 95) {
    throw new Error(`ScriptProperties เต็ม (${usagePct.toFixed(1)}%) — รัน clearAllQueueEntries() แล้วลองใหม่`);
  }
  if (usagePct > 80) {
    const msg = `⚠️ ScriptProperties ${usagePct.toFixed(1)}% — รัน inspectScriptProperties() เพื่อตรวจ`;
    Logger.log(msg);
    toast(msg, 'FinFin', 10);
  }
}

/**
 * ลบ queue entries ทั้งหมด (nuclear option ถ้า quota เต็ม)
 */
function clearAllQueueEntries() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let removed = 0;
  for (const k of Object.keys(all)) {
    if (k.startsWith('QUEUE_')) {
      props.deleteProperty(k);
      removed++;
    }
  }
  Logger.log(`Cleared ${removed} queue entries`);
  return removed;
}

// ─── Duplicate Recovery Helpers ──────────────────────────────────────────────

/**
 * ตรวจว่า error เป็น "Transaction number is duplicated" (PEAK error 315)
 */
function isDuplicateCodeError_(e) {
  const msg = ((e && e.message) ? e.message : String(e)).toLowerCase();
  // จับเฉพาะ error 315 จริง — ไม่ใช่เลข "315" ที่บังเอิญอยู่ในยอดเงิน/รหัสสัญญา
  return msg.includes('duplicat')
      || msg.includes('เลขที่เอกสารซ้ำ')
      || /peak api 315\b/.test(msg);
}

/**
 * Auto-detect ตำแหน่งคอลัมน์ Receipt sheet จาก header จริง
 *
 * Layout เปลี่ยนมาแล้วหลายรอบ — RE04.2026+ ตัดคอลัมน์ "ประเภทการชำระ" ออก
 * เลื่อน "วันที่รับชำระ" มา index 2 และแทรก "สูตรวันที่เปิดTAX" ที่ index 3
 * ถ้าใช้ CONFIG.RECEIPT_COL ตายตัว PAY_DATE จะไปอ่านคอลัมน์สูตร (มีวันที่เสมอ)
 * → แถวค้างชำระถูกมองว่าจ่ายแล้ว = สร้างใบเสร็จผิดใน PEAK
 *
 * คืน object หน้าตาเดียวกับ CONFIG.RECEIPT_COL
 *   - หา header ไม่เจอทั้ง sheet (ไม่ใช่ Receipt sheet) → คืน CONFIG.RECEIPT_COL เดิม
 *   - INST_TYPE ไม่มีใน layout ใหม่ → -1 (ผู้เรียกต้องเช็ค >= 0 ก่อนอ่าน)
 *   - PEAK_DOC ยังไม่มี header → ถัดจาก AMT
 */
function detectReceiptColumns_(sheet) {
  const fallback = CONFIG.RECEIPT_COL;
  let header;
  try {
    header = sheet.getRange(CONFIG.RECEIPT_HEADER_ROW, 1, 1, sheet.getLastColumn())
      .getValues()[0].map(h => String(h || '').replace(/\s+/g, ''));
  } catch (e) {
    return fallback;
  }
  const find = test => header.findIndex(test);
  const col = {
    INV:         find(h => h.includes('เลขที่สัญญา')),
    DUE_DATE:    find(h => h.includes('ครบกำหนด')),
    INST_TYPE:   find(h => h.includes('ประเภทการชำระ')),
    PAY_DATE:    find(h => h.includes('วันที่รับชำระ')),
    TAX_DATE:    find(h => h.includes('เปิดใบกำกับภาษี') && !h.includes('สูตร')),
    SMEMOVE_DOC: find(h => h.includes('ใบเสร็จรับเงิน')),
    NAME:        find(h => h.includes('ชื่อลูกค้า')),
    AMT:         find(h => h.includes('ยอดเงินรวม')),
    PEAK_DOC:    find(h => h.includes('เลขที่PEAK')),
  };
  if (col.INV < 0 || col.AMT < 0) {
    Logger.log('detectReceiptColumns_: header ไม่ตรง signature ของ Receipt sheet — ใช้ CONFIG.RECEIPT_COL เดิม');
    return fallback;
  }
  // PEAK_DOC อาจยังไม่มี header (ensureReceiptHeader_ จะเติมให้) → ถัดจาก AMT
  if (col.PEAK_DOC < 0) col.PEAK_DOC = Math.max(fallback.PEAK_DOC, col.AMT + 1);
  // คอลัมน์อื่นที่หาไม่เจอ → fallback ค่า config เดิม (ยกเว้น INST_TYPE — RE04+ ไม่มีจริง)
  for (const k of ['DUE_DATE', 'PAY_DATE', 'TAX_DATE', 'SMEMOVE_DOC', 'NAME']) {
    if (col[k] < 0) col[k] = fallback[k];
  }
  Logger.log(`detectReceiptColumns_ [${sheet.getName()}]: ${JSON.stringify(col)}`);
  return col;
}

/**
 * พยายามดึงเลขที่เอกสารจาก PEAK ด้วย GET /{endpoint}?code={code}
 * ใช้เมื่อได้รับ error 315 เพื่อ recover เลขที่เอกสารที่สร้างไปแล้ว
 * @param {string} endpoint  เช่น '/receipts', '/invoices'
 * @param {string} code  document code (buildReference result)
 * @returns {string|null}  doc number หรือ null ถ้าหาไม่เจอ
 */
function tryRecoverPeakDoc_(endpoint, code) {
  try {
    const res = callPeakAPI('get', endpoint, null, { code });
    // ลอง extract จากหลาย response shape
    const items = (res.PeakReceipts && res.PeakReceipts.receipts)
               || (res.PeakInvoices && res.PeakInvoices.invoices)
               || (res.data && Array.isArray(res.data) ? res.data : null)
               || (Array.isArray(res) ? res : null);
    if (Array.isArray(items) && items.length > 0) {
      // ต้อง validate ว่า doc ที่ได้กลับมา code ตรงกับที่ขอ
      // ถ้า PEAK API ไม่ filter ให้ถูก items[0] จะเป็น doc ของ contract อื่น
      const match = items.find(doc => doc.code === code);
      if (!match) return null;
      return match.receiptCode || match.taxInvoiceCode || match.invoiceCode || match.creditNoteCode || null;
    }
    // Single-object response — validate code ก่อนคืน
    if (res && res.code === code) {
      return res.receiptCode || res.taxInvoiceCode || res.invoiceCode || res.creditNoteCode || null;
    }
  } catch (e) {
    Logger.log(`tryRecoverPeakDoc_ ${endpoint}?code=${code}: ${e.message}`);
  }
  return null;
}

// ─── Quota Handling & Resumable Execution ────────────────────────────────────
// PEAK rate limits (ชั่วคราว ไม่ใช่ตลอดชีพ):
//   - POST concurrent: max 5 ต่อ User Token (HTTP 429 type=concurrency) → retry 8s อัตโนมัติ
//   - Rate limit: 10 req/min สำหรับ /clienttoken เท่านั้น (token แคช 23 ชม. แล้ว)
//   - "Transaction Limit exceeded" (HTTP 400) = rate limit ชั่วคราวเช่นกัน ไม่ใช่ quota ถาวร
// กลยุทธ์: runner หยุดเองก่อนหมดเวลา/เจอ quota → ตั้ง trigger ทำต่ออัตโนมัติ
// runner ทุกตัว idempotent (ข้ามแถวที่มีเลขเอกสารแล้ว) จึง resume ได้ปลอดภัย

/**
 * ตรวจว่า error เกิดจากโควตา/ลิมิตหมด — ต้องหยุดทั้ง run แล้วทำต่อภายหลัง
 * (PEAK transaction limit / rate limit 429 / GAS service quota)
 */
function isQuotaError_(e) {
  const msg = ((e && e.message) ? e.message : String(e)).toLowerCase();
  return msg.includes('transaction limit')
      || msg.includes('limit exceeded')
      || msg.includes('quota')
      || msg.includes('rate limit')
      || msg.includes('429')
      || msg.includes('too many requests')
      || msg.includes('invoked too many times');
}

/**
 * จัดประเภท error → กำหนดวิธีรับมือ
 *   'duplicate' — เอกสารมีใน PEAK แล้ว (error 315) → recover/mark
 *   'quota'     — โควตา/ลิมิตหมด → หยุดทั้ง run, ตั้ง trigger ทำต่อ
 *   'transient' — network/5xx ชั่วคราว → ปล่อยเซลล์ว่าง, รันรอบหน้า retry เอง
 *   'permanent' — ข้อมูลผิด (400 ฯลฯ) → log ERROR
 * @returns {'duplicate'|'quota'|'transient'|'permanent'}
 */
function classifyError_(e) {
  // quota ก่อน duplicate — ข้อความ quota อาจมีเลข/คำที่ duplicate-check จับผิดได้
  if (isQuotaError_(e))         return 'quota';
  if (isDuplicateCodeError_(e)) return 'duplicate';
  const msg = ((e && e.message) ? e.message : String(e)).toLowerCase();
  if (msg.includes('http 500') || msg.includes('http 502') || msg.includes('http 503')
   || msg.includes('http 504') || msg.includes('timeout') || msg.includes('timed out')
   || msg.includes('unavailable') || msg.includes('network') || msg.includes('dns error')) {
    return 'transient';
  }
  return 'permanent';
}

/**
 * สร้าง time guard กัน GAS hard limit 6 นาที
 * @param {number} [maxMinutes]  default 5 (เผื่อ 1 นาทีไว้ cleanup)
 * @returns {{ expired: function(): boolean, elapsedSec: function(): number }}
 */
function makeTimeGuard_(maxMinutes) {
  const startMs = Date.now();
  const maxMs   = (maxMinutes || 5) * 60 * 1000;
  return {
    expired:    () => (Date.now() - startMs) > maxMs,
    elapsedSec: () => Math.round((Date.now() - startMs) / 1000),
  };
}

// จำนวนครั้งสูงสุดที่ทำต่ออัตโนมัติได้แบบไม่คืบหน้า (กัน loop ติดโควตาถาวร)
const MAX_CONTINUATION_ATTEMPTS_ = 6;

/**
 * Whitelist + dispatch — เรียก runner ตามชื่อ (กัน trigger เรียก function อื่น)
 */
function dispatchRunner_(functionName, sheetName) {
  switch (functionName) {
    case 'runPart1_TaxInvoice': return runPart1_TaxInvoice(sheetName);
    case 'runPart1_ServiceFee': return runPart1_ServiceFee(sheetName);
    case 'runPart2_Invoice':    return runPart2_Invoice(sheetName);
    case 'runPart3_LateFee':    return runPart3_LateFee(sheetName);
    case 'runPart4_CreditNote': return runPart4_CreditNote();
    default: throw new Error('runner ไม่รู้จัก: ' + functionName);
  }
}

/**
 * ตั้ง one-time trigger ให้ทำงานต่อจากที่ค้างไว้
 * @param {string}  functionName
 * @param {string}  sheetName
 * @param {boolean} madeProgress  true = run นี้สร้างเอกสารได้บ้าง → รีเซ็ตตัวนับ
 *                                false = ไม่คืบหน้า (ติดโควตา) → เพิ่มตัวนับเข้าหา cap
 * @param {number}  [delayMinutes]  default 15
 */
function scheduleContinuation_(functionName, sheetName, madeProgress, delayMinutes) {
  delayMinutes = delayMinutes || 15;
  const props = PropertiesService.getScriptProperties();
  const key   = 'CONTINUATION_' + functionName;

  let attempt = 0;
  if (!madeProgress) {
    const prev = props.getProperty(key);
    if (prev) { try { attempt = Number(JSON.parse(prev).attempt) || 0; } catch (e) {} }
  }
  attempt++;  // madeProgress → เริ่มนับใหม่จาก 1

  if (attempt > MAX_CONTINUATION_ATTEMPTS_) {
    props.deleteProperty(key);
    const msg = `❌ ${functionName} หยุดทำต่ออัตโนมัติ (ลอง ${MAX_CONTINUATION_ATTEMPTS_} ครั้งไม่คืบหน้า) — น่าจะติดโควตา ตรวจ PEAK แล้วรันเองอีกครั้ง`;
    Logger.log(msg);
    toast(msg, 'FinFin', 15);
    return;
  }

  props.setProperty(key, JSON.stringify({
    functionName, sheetName: sheetName || '', attempt, scheduledAt: Date.now(),
  }));
  ensureResumeTrigger_(delayMinutes);
  Logger.log(`continuation #${attempt}: ${functionName}("${sheetName}") อีก ${delayMinutes} นาที`);
}

/**
 * เคลียร์ continuation context — เรียกเมื่อ runner ทำงานครบสมบูรณ์
 */
function clearContinuation_(functionName) {
  PropertiesService.getScriptProperties().deleteProperty('CONTINUATION_' + functionName);
}

/**
 * เคลียร์ continuation context ทั้งหมด (เรียกตอนลบ trigger ทั้งหมด)
 */
function clearAllContinuations_() {
  const props = PropertiesService.getScriptProperties();
  let removed = 0;
  for (const k of Object.keys(props.getProperties())) {
    if (k.startsWith('CONTINUATION_')) { props.deleteProperty(k); removed++; }
  }
  return removed;
}

/**
 * สร้าง resume trigger ตัวเดียว (ลบของเดิมก่อนเสมอ กัน trigger ซ้อน)
 */
function ensureResumeTrigger_(delayMinutes) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'resumePendingWork_')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('resumePendingWork_')
    .timeBased()
    .after((delayMinutes || 15) * 60 * 1000)
    .create();
}

/**
 * เรียกจาก time-based trigger — ทำงานที่ค้างไว้ทั้งหมดต่อ
 * runner แต่ละตัวจะตั้ง continuation รอบถัดไปเอง (ถ้ายังไม่เสร็จ)
 */
function resumePendingWork_() {
  const props = PropertiesService.getScriptProperties();

  // ลบ trigger ที่เพิ่งยิง (self-cleanup)
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'resumePendingWork_')
    .forEach(t => ScriptApp.deleteTrigger(t));

  const all = props.getProperties();
  const contexts = Object.keys(all)
    .filter(k => k.startsWith('CONTINUATION_'))
    .map(k => { try { return JSON.parse(all[k]); } catch (e) { props.deleteProperty(k); return null; } })
    .filter(Boolean);

  for (const ctx of contexts) {
    try {
      Logger.log(`resume: ${ctx.functionName}("${ctx.sheetName}")`);
      dispatchRunner_(ctx.functionName, ctx.sheetName || undefined);
    } catch (e) {
      Logger.log(`resume error ${ctx.functionName}: ${e.message}`);
      scheduleContinuation_(ctx.functionName, ctx.sheetName, false);
    }
  }

  // ยังมีงานค้าง → ตั้ง trigger รอบถัดไป
  const stillPending = Object.keys(props.getProperties()).some(k => k.startsWith('CONTINUATION_'));
  if (stillPending) ensureResumeTrigger_(15);
}

// ─── Invoice Payload Helpers ──────────────────────────────────────────────────

/**
 * สร้าง unique reference string สำหรับ idempotency
 * @param {string} invCode  เลขที่สัญญา
 * @param {string|number} installment  งวดที่
 * @param {string} type  'TAX' | 'REC' | 'FEE' | 'CN'
 * @returns {string}
 */
function buildReference(invCode, installment, type) {
  return `${invCode}-${installment}-${type}`;
}

/**
 * แปลง Col K (ชำระงวดที่ / เงินดาวน์ / ปิดยอด) → description string
 * @param {string} kVal
 * @param {string} invCode
 * @returns {string}
 */
function buildDescription(kVal, invCode) {
  if (!kVal) return `ค่างวด สัญญา ${invCode}`;
  const s = String(kVal).trim();
  if (s.includes('ดาวน์')) return `เงินดาวน์ สัญญา ${invCode}`;
  if (s.includes('ปิดยอด') || s.includes('ปิด')) return `ปิดยอด สัญญา ${invCode}`;
  const num = parseInstallmentNumber(s);
  if (num) return `ค่างวดที่ ${num} สัญญา ${invCode}`;
  return `${s} สัญญา ${invCode}`;
}

/**
 * แปลง Col S (ประเภทการชำระ) → PEAK payment method type
 * @param {string} sVal
 * @returns {number} CONFIG.PMT_TRANSFER | CONFIG.PMT_CASH
 */
function resolvePaymentType(sVal) {
  if (!sVal) return CONFIG.PMT_TRANSFER;
  const s = String(sVal).toLowerCase();
  if (s.includes('สด') || s.includes('cash')) return CONFIG.PMT_CASH;
  return CONFIG.PMT_TRANSFER;
}

// ─── Alert / UI ────────────────────────────────────────────────────────────────

/**
 * แสดง toast notification ใน Sheets
 */
function toast(msg, title, timeout) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(msg, title || 'FinFin', timeout || 5);
  } catch (e) { /* ignore if not in UI context */ }
}
