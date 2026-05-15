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

/**
 * ค้นหา Sheet แบบ robust — ลอง candidate patterns ทั้งหมด
 * แล้ว fallback fuzzy (ชื่อมี prefix + mm + yyyy)
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

  const tried = sheetNameCandidates_(prefix, mm, yyyy).join(', ');
  throw new Error(`ไม่พบ Sheet "${prefix}*${mm}*${yyyy}" — ลองแล้ว: ${tried}`);
}

/**
 * ดึง Sheet ตารางรับชำระตามชื่อ (เช่น "Receipt03.2026")
 * รองรับทุก format โดย findSheetRobust
 * @param {string} sheetName  ชื่อเต็ม หรือ prefix+MM.YYYY ก็ได้
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getPaymentSheet(sheetName) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  // ลองตรงก่อน (fast path)
  const direct = ss.getSheetByName(sheetName);
  if (direct) return direct;
  // ถ้าไม่เจอ → parse prefix + month แล้วใช้ robust search
  const m = sheetName.match(/^([A-Za-z]+)[.\-]?(\d{1,2}[.\-\/]\d{4}|\d{4}[.\-\/]\d{1,2})$/);
  if (m) return findSheetRobust(ss, m[1], m[2].replace(/[.\-\/](\d{4})$/, '.$1').replace(/^(\d{4})[.\-\/](\d{1,2})$/, '$2.$1'));
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
 * ดึง Sheet Bank Statement เดือนปัจจุบัน แบบ robust
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getCurrentStatementSheetName() {
  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  const prefix = CONFIG.STATEMENT_SHEET_PREFIX || CONFIG.STATEMENT_SHEET_NAME || 'SCB';
  return findSheetRobust(ss, prefix, getCurrentMonthSheetName()).getName();
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
