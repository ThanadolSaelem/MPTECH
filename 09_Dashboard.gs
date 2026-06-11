/**
 * FinFin Automation — Dashboard (JSON API only, ไม่เขียนลงชีต)
 *
 * Python client จะเรียก action "dashboard/refresh" แล้ว render UI เอง
 * (เดิมเขียนลง "DASHBOARD" sheet — ย้ายออกจาก sheet แล้ว)
 *
 * Return shape:
 *   {
 *     month, updatedAt,
 *     sheets:  { receipt, sum, statement },
 *     parts:   { part1_tax, part1_svc, part2_inv, part3_fee },
 *     queues:  { invoice, receipt, receipt_fee },
 *     errors:  [ { ts, part, inv, msg }, ... ]
 *   }
 */

function refreshDashboard(monthOverride) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  const month = (monthOverride && String(monthOverride).trim()) || getCurrentMonthSheetName();

  const sumName  = `${CONFIG.SUM_SHEET_PREFIX}${month}`;
  const stmtName = `${CONFIG.STATEMENT_SHEET_PREFIX}${month}`;

  // Receipt sheet อาจชื่อ "Receipt05.2026" หรือ "RE05.2026" (Mar 2026+)
  const receiptPrefixes = CONFIG.RECEIPT_SHEET_PREFIXES || [CONFIG.RECEIPT_SHEET_PREFIX];
  let receiptSheet = null, receiptName = '';
  for (const p of receiptPrefixes) {
    const s = ss.getSheetByName(p + month);
    if (s) { receiptSheet = s; receiptName = s.getName(); break; }
  }
  if (!receiptName) receiptName = receiptPrefixes[0] + month;

  const sumSheet  = ss.getSheetByName(sumName);
  const stmtSheet = ss.getSheetByName(stmtName);

  return {
    month,
    updatedAt: Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm'),
    sheets: {
      receipt:   { name: receiptName, found: !!receiptSheet },
      sum:       { name: sumName,     found: !!sumSheet     },
      statement: { name: stmtName,    found: !!stmtSheet    },
    },
    parts: {
      part1_tax: countPart1Tax_(receiptSheet),
      part1_svc: countPart1Svc_(sumSheet),
      part2_inv: countPart2Inv_(sumSheet),
      part3_fee: countPart3Fee_(stmtSheet),
    },
    queues: {
      invoice:     getQueueEntries('invoice').length,
      receipt:     getQueueEntries('receipt').length,
      receipt_fee: getQueueEntries('receipt_fee').length,
    },
    errors: getRecentErrors_(5),
  };
}

// ─── Part counters ────────────────────────────────────────────────────────────

function countPart1Tax_(sheet) {
  if (!sheet) return notFound_();
  const rc = detectReceiptColumns_(sheet);
  let done = 0, queued = 0, missing = 0;
  for (const row of getSheetRange_(sheet, CONFIG.RECEIPT_HEADER_ROW)) {
    if (parseAmount(row[rc.AMT]) <= 0) continue;
    const doc = String(row[rc.PEAK_DOC] || '').trim();
    if (doc === CONFIG.PROCESSING_MARKER) queued++;
    else if (doc) done++;
    else missing++;
  }
  return { done, queued, missing };
}

function countPart1Svc_(sheet) {
  if (!sheet) return notFound_();
  const sc = detectSumColumns_(sheet);
  const svcDocCol = sc.SVC_DOC;
  let done = 0, missing = 0;
  for (const row of getSheetRange_(sheet, CONFIG.SUM_HEADER_ROW)) {
    if (parseAmount(row[sc.SERVICE_FEE]) <= 0) continue;
    const doc = String(row[svcDocCol] || '').trim();
    if (doc && doc !== CONFIG.PROCESSING_MARKER) done++;
    else missing++;
  }
  return { done, queued: 0, missing };
}

function countPart2Inv_(sheet) {
  if (!sheet) return notFound_();
  const sc = detectSumColumns_(sheet);
  const invDocCol = sc.INV_DOC;
  let done = 0, missing = 0;
  for (const row of getSheetRange_(sheet, CONFIG.SUM_HEADER_ROW)) {
    const invCode = String(row[sc.INV] || '').trim();
    if (!invCode) continue;
    if (!toDate(row[sc.CONTRACT_DATE])) continue;
    const doc = String(row[invDocCol] || '').trim();
    if (doc && doc !== CONFIG.PROCESSING_MARKER) done++;
    else missing++;
  }
  return { done, queued: 0, missing };
}

function countPart3Fee_(sheet) {
  if (!sheet) return notFound_();
  const fmt = detectStatementFormat_(sheet);
  if (fmt.col.LATE_FEE === undefined) {
    return { done: 0, queued: 0, missing: 0, error: 'SCB format ไม่ใช่ ENHANCED — ไม่มีคอลัมน์ค่าปรับ' };
  }
  const feeDocCol = (fmt.col.PAY_DATE !== undefined ? fmt.col.PAY_DATE : fmt.col.DATE) + 1;
  let done = 0, queued = 0, missing = 0;
  for (const row of getSheetRange_(sheet, fmt.headerRow)) {
    if (parseAmount(row[fmt.col.LATE_FEE]) <= 0) continue;
    const doc = String(row[feeDocCol] || '').trim();
    if (doc === CONFIG.PROCESSING_MARKER) queued++;
    else if (doc) done++;
    else missing++;
  }
  return { done, queued, missing };
}

function notFound_() {
  return { done: 0, queued: 0, missing: 0, error: 'ไม่พบชีต' };
}

// ─── Recent Errors ────────────────────────────────────────────────────────────

function getRecentErrors_(limit) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  const log = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);
  if (!log) return [];
  const lastRow = log.getLastRow();
  if (lastRow <= 1) return [];

  const all = log.getRange(2, 1, lastRow - 1, 8).getValues();
  return all
    .filter(r => r[5] === 'ERROR')
    .slice(-limit)
    .reverse()
    .map(r => ({
      ts:   r[0] instanceof Date
              ? Utilities.formatDate(r[0], 'Asia/Bangkok', 'dd/MM HH:mm')
              : String(r[0]),
      part: String(r[1] || ''),
      inv:  String(r[4] || ''),
      msg:  String(r[7] || ''),
    }));
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function getSheetRange_(sheet, headerRow) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) return [];
  return sheet
    .getRange(headerRow + 1, 1, lastRow - headerRow, sheet.getLastColumn())
    .getValues();
}
