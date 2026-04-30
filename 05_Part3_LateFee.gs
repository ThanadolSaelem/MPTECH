/**
 * FinFin Automation — Part 3: ออกใบเสร็จค่าปรับ bulk
 *
 * Source (new schema Apr 2026):
 *   SCB Enhanced sheet → column LATE_FEE (10) + PAY_DATE (11) + INV (5)
 *   (format เก่าที่เป็น RAW CSV ไม่มีคอลัมน์ค่าปรับแยก ใช้ Part 3 ไม่ได้)
 *
 * Business Rules:
 *   - ไม่มี VAT (ค่าปรับได้รับยกเว้น)
 *   - เปิดเป็น Receipt อย่างเดียว (ไม่ใช่ TaxInvoice)
 *   - เรียงตาม PAY_DATE
 *
 * Filter:
 *   - LATE_FEE > 0
 *   - INV ไม่ว่าง
 *   - FEE_DOC (output, auto-added col หลัง PAY_DATE) ว่าง
 *
 * Output:
 *   - เขียนเลขที่ใบเสร็จค่าปรับ → column ใหม่ถัดจาก PAY_DATE ใน SCB sheet
 */

function runPart3_LateFee(statementSheetName) {
  statementSheetName = statementSheetName || getCurrentStatementSheetName();

  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  const sheet = ss.getSheetByName(statementSheetName);
  if (!sheet) throw new Error(`ไม่พบ Sheet "${statementSheetName}"`);

  const fmt = detectStatementFormat_(sheet);
  if (!fmt.col.LATE_FEE && fmt.col.LATE_FEE !== 0) {
    throw new Error(
      `SCB sheet "${statementSheetName}" ไม่มีคอลัมน์ค่าปรับ — Part 3 ต้องใช้ ENHANCED format`
    );
  }

  const col       = fmt.col;
  const headerRow = fmt.headerRow;

  const feeDocCol = ensureFeeDocHeader_(sheet, col, headerRow);
  const data      = sheet.getDataRange().getValues().slice(headerRow);

  toast(`⏳ Part 3 ค่าปรับ — ${statementSheetName}`, 'FinFin');

  let countSkip = 0, countError = 0;
  const eligible = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];

    const lateFee = parseAmount(row[col.LATE_FEE]);
    if (lateFee <= 0) continue;

    const invCode = String(row[col.INV] || '').trim();
    if (!invCode) continue;

    const existingDoc = String(row[feeDocCol] || '').trim();
    if (existingDoc && existingDoc !== CONFIG.PROCESSING_MARKER) {
      countSkip++;
      continue;
    }

    const feeDate = toDate(row[col.PAY_DATE]) || toDate(row[col.DATE]);
    if (!feeDate) {
      logEntry('Part3', statementSheetName, i, invCode, 'SKIP', '', 'ไม่มีวันที่ PAY_DATE/DATE');
      countSkip++;
      continue;
    }

    eligible.push({
      rowIndex: i,
      invCode,
      lateFee,
      feeDate,
      instType: String(row[col.INST_TYPE] || '').trim(),
    });
  }

  eligible.sort((a, b) => a.feeDate.getTime() - b.feeDate.getTime());

  const batch = [];
  let countOk = 0;

  for (const item of eligible) {
    writeStatementCell_(sheet, item.rowIndex, feeDocCol, headerRow, CONFIG.PROCESSING_MARKER);
    batch.push(item);

    if (batch.length >= CONFIG.BATCH_SIZE) {
      const { ok, err } = submitLateFeesBatch_(sheet, batch, statementSheetName, feeDocCol, headerRow);
      countOk += ok; countError += err;
      batch.length = 0;
    }
  }
  if (batch.length > 0) {
    const { ok, err } = submitLateFeesBatch_(sheet, batch, statementSheetName, feeDocCol, headerRow);
    countOk += ok; countError += err;
  }

  const summary = `Part 3 เสร็จ — Queue: ${countOk}, Skip: ${countSkip}, Error: ${countError}`;
  toast(summary, 'FinFin', 10);
  Logger.log(summary);
  return summary;
}

// ─── Submit Batch ─────────────────────────────────────────────────────────────

function submitLateFeesBatch_(sheet, batch, sheetName, feeDocCol, headerRow) {
  try {
    const payloads = batch.map(buildLateFeePayload);
    const res = callPeakAPI('post', '/Receipts/queue', { peakReceipts: payloads });
    const queueId = res.queueId || res.id || 'unknown';

    const meta = batch.map(item => ({
      rowIndex:     item.rowIndex,
      invCode:      item.invCode,
      docType:      'FEE',
      targetSheet:  sheetName,
      targetCol:    feeDocCol,
      headerOffset: headerRow,
    }));
    saveQueueEntry('receipt_fee', queueId, sheetName, meta);
    logEntry('Part3', sheetName, -1, 'BATCH', 'QUEUED', queueId, `ค่าปรับ ${batch.length} รายการ`);
    return { ok: batch.length, err: 0 };
  } catch (e) {
    batch.forEach(item =>
      writeStatementCell_(sheet, item.rowIndex, feeDocCol, headerRow, '')
    );
    logEntry('Part3', sheetName, -1, 'BATCH', 'ERROR', '', e.message);
    return { ok: 0, err: batch.length };
  }
}

// ─── Payload Builder ──────────────────────────────────────────────────────────

function buildLateFeePayload(item) {
  const { invCode, lateFee, feeDate, instType } = item;
  const installNum = parseInstallmentNumber(instType);
  const desc = installNum
    ? `ค่าปรับงวดที่ ${installNum} สัญญา ${invCode}`
    : `ค่าปรับ สัญญา ${invCode}`;

  return {
    reference:    buildReference(invCode, instType || 'FEE', 'FEE'),
    issuedDate:   formatDateForAPI(feeDate),
    contactCode:  invCode,
    isTaxInvoice: false,
    note:         desc,
    products: [{
      accountCode: CONFIG.ACCOUNT_CODE_LATE_FEE,
      description: desc,
      quantity:    1,
      price:       lateFee,
      vatType:     CONFIG.VAT_TYPE_NONE,
    }],
    paymentMethods: [{
      type:   CONFIG.PMT_TRANSFER,
      amount: lateFee,
    }],
  };
}

// ─── Sheet helpers (Statement-specific) ───────────────────────────────────────

function ensureFeeDocHeader_(sheet, col, headerRow) {
  const targetCol = (col.PAY_DATE !== undefined ? col.PAY_DATE : col.DATE) + 1;
  const currentHeader = sheet.getRange(headerRow, targetCol + 1).getValue();
  if (!currentHeader) {
    sheet.getRange(headerRow, targetCol + 1).setValue('เลขที่ใบเสร็จค่าปรับ');
  }
  return targetCol;
}

function writeStatementCell_(sheet, rowIndex, col, headerRow, value) {
  sheet.getRange(rowIndex + headerRow + 1, col + 1).setValue(value);
}
