/**
 * FinFin Automation — Part 2: ออกใบแจ้งหนี้ bulk (สัญญาใหม่)
 *
 * Source: Sum.MM.YYYY (contract list — new schema Apr 2026)
 *   COL.INV, CONTRACT_DATE, TITLE, NAME, CONTRACT_AMT,
 *   INSTALLMENT_N, INSTALLMENT_AMT, PAY_DAY, DOWN_OR_MONTHLY
 *
 * Filter:
 *   - INV ไม่ว่าง, CONTRACT_DATE ไม่ว่าง
 *   - CONTRACT_AMT + INSTALLMENT_N + INSTALLMENT_AMT ครบ
 *   - OUTPUT col (auto-added ถัดจาก DUE_DATE) ว่าง (idempotency)
 *
 * PEAK Endpoint: POST /Invoices/allinone (สร้าง + แตกงวด, ไม่มี queue)
 *
 * หมายเหตุ: Sum sheet มี DOWN_OR_MONTHLY = "ดาวน์" หรือยอดค่างวด
 *           เราเดาเงินดาวน์จากส่วนต่าง: DOWN = CONTRACT_AMT − (INSTALLMENT_AMT × INSTALLMENT_N)
 */

function runPart2_Invoice(sheetName) {
  preFlightChecks_();
  sheetName = sheetName || getCurrentSumSheetName();
  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  const sheet = getSheetByNameSmart_(ss, sheetName);
  if (!sheet) throw new Error(`ไม่พบ Sheet "${sheetName}"`);

  toast(`⏳ Part 2 ใบแจ้งหนี้ — ${sheetName}`, 'FinFin');

  // Auto-detect คอลัมน์จาก header — รองรับ layout ที่เปลี่ยนไป (Sum04+ เพิ่ม cols)
  const SC = detectSumColumns_(sheet);
  const invDocCol = ensureInvoiceDocHeader_(sheet, SC);
  const data = getSumData_(sheet);

  // ── ตรวจสัญญาที่ Part 1 ออก Tax Invoice ไปแล้ว ───────────────────────────────
  const part1Covered = buildPart1CoveredSet_(ss, sheetName);
  if (part1Covered.size > 0) {
    Logger.log(`⚠️ Part 2: พบ ${part1Covered.size} สัญญาที่ Part 1 ออกเอกสารไปแล้ว — จะข้ามอัตโนมัติ`);
    toast(`⚠️ Part 1 ออกไปแล้ว ${part1Covered.size} สัญญา — Part 2 จะข้ามสัญญาเหล่านั้น`, 'FinFin', 5);
  }

  let countOk = 0, countSkip = 0, countError = 0;

  const guard = makeTimeGuard_(5);
  let stoppedEarly = false, quotaHit = false;

  for (let i = 0; i < data.length; i++) {
    if (guard.expired()) { stoppedEarly = true; break; }
    const row = data[i];

    const invCode = String(row[SC.INV] || '').trim();
    if (!invCode) continue;

    const contractDate = toDate(row[SC.CONTRACT_DATE]);
    if (!contractDate) continue;

    // ── Skip: Part 1 ออก Tax Invoice สำหรับสัญญานี้แล้ว ─────────────────────────
    if (part1Covered.has(invCode)) {
      const curDoc = String(row[invDocCol] || '').trim();
      if (!curDoc) writeSumCell_(sheet, i, invDocCol, '[PART1-DONE]');
      logEntry('Part2', sheetName, i, invCode, 'SKIP', '[PART1-DONE]',
        'ข้ามเพราะ Part 1 ออก Tax Invoice ไปแล้ว — ลบ "[PART1-DONE]" เพื่อบังคับออกใบแจ้งหนี้');
      countSkip++;
      continue;
    }

    const existingDoc = String(row[invDocCol] || '').trim();
    if (existingDoc && existingDoc !== CONFIG.PROCESSING_MARKER) {
      countSkip++;
      continue;
    }

    const contractAmt     = parseAmount(row[SC.CONTRACT_AMT]);
    const numInstallments = parseInt(row[SC.INSTALLMENT_N]) || 0;
    const installmentAmt  = parseAmount(row[SC.INSTALLMENT_AMT]);
    const paymentDay      = parseInt(row[SC.PAY_DAY]) || 1;

    if (!contractAmt || !numInstallments || !installmentAmt) {
      logEntry('Part2', sheetName, i, invCode, 'SKIP', '', 'ข้อมูลยอด/จำนวนงวด/ค่างวดไม่ครบ');
      countSkip++;
      continue;
    }

    const title = String(row[SC.TITLE] || '').trim();
    const rawName = String(row[SC.NAME] || '').trim();
    const customerName = rawName.startsWith(title) ? rawName : (title + rawName).trim();
    const idCard  = String(row[SC.ID_CARD]  || '').trim();
    const address = String(row[SC.ADDRESS]   || '').trim();

    // ── AR Opening Balance — ยกยอดสัญญาที่ชำระมาแล้วบางส่วน ─────────────────────
    // ถ้า AR_BEGIN มีค่า และ < contractAmt → ออก Invoice เฉพาะยอดค้างที่เหลือ
    // ถ้า AR_BEGIN = 0 หรือว่าง → สัญญาใหม่ ออกปกติเต็มสัญญา
    const arBegin    = parseAmount(row[SC.AR_BEGIN]);
    const isCarryOver = arBegin > 0 && arBegin < contractAmt * 0.99;

    let effDown, effInstN, effAmt, effDates, effIssueDate;
    if (isCarryOver) {
      effDown      = 0;  // down payment ชำระไปแล้วในอดีต
      effInstN     = installmentAmt > 0 ? Math.max(1, Math.round(arBegin / installmentAmt)) : 1;
      effAmt       = Math.min(arBegin, contractAmt);
      effIssueDate = new Date();  // วันที่ออก Invoice = วันนี้ (ไม่ใช้ contractDate ในอดีต)
      // carry-over = ยอดค้างที่ถึงกำหนดมาแล้ว → ครบกำหนดทันที (dueDate = วันออกใบ)
      let firstDue = toDate(row[SC.DUE_DATE]) || nextDueDate_(paymentDay);
      if (firstDue && compareDates(firstDue, effIssueDate) < 0) {
        firstDue = new Date(effIssueDate.getTime());
      }
      effDates     = buildRemainingDueDates_(firstDue, effInstN);
      logEntry('Part2', sheetName, i, invCode, 'INFO', '',
        `ยกยอด AR_BEGIN=${arBegin} → Invoice ${effInstN} งวด × ${installmentAmt}`);
    } else {
      effDown      = Math.max(0, contractAmt - (installmentAmt * numInstallments));
      effInstN     = numInstallments;
      effAmt       = contractAmt;
      effIssueDate = contractDate;
      effDates     = calculateDueDates(contractDate, paymentDay, numInstallments);
    }

    const docRef = isCarryOver
      ? buildReference(invCode, 'CONT', 'INV')  // CONT = continuation (ยกยอด)
      : buildReference(invCode, 'ALL',  'INV');  // ALL  = full contract (ใหม่)

    writeSumCell_(sheet, i, invDocCol, CONFIG.PROCESSING_MARKER);

    try {
      ensureContactsBatch_({ [invCode]: { name: customerName, idCard, address } });
      const contactUuid = getContactId_(invCode);
      if (!contactUuid) {
        writeSumCell_(sheet, i, invDocCol, '');
        logEntry('Part2', sheetName, i, invCode, 'SKIP', '',
          'ไม่พบ contactId ใน PEAK — รัน Sync Contacts แล้วรัน Part 2 ใหม่');
        countSkip++;
        continue;
      }

      const payload = buildInvoiceAllInOnePayload(
        invCode, contactUuid, effIssueDate, effDown, installmentAmt,
        effInstN, effAmt, effDates, customerName, isCarryOver, docRef
      );
      const res = callPeakAPI('post', '/invoices/allinone', { PeakInvoices: { invoices: [payload] } });
      const inv = (res.PeakInvoices && res.PeakInvoices.invoices && res.PeakInvoices.invoices[0]) || res;
      const docNo = inv.invoiceCode || inv.code || JSON.stringify(res).substring(0, 80);
      writeSumCell_(sheet, i, invDocCol, docNo);
      logEntry('Part2', sheetName, i, invCode, 'SUCCESS', docNo,
        isCarryOver ? `ยกยอด ${effInstN} งวด` : '');
      countOk++;
    } catch (e) {
      const kind = classifyError_(e);
      if (kind === 'duplicate') {
        // ใบแจ้งหนี้นี้มีใน PEAK แล้วจากรอบก่อน — กู้เลขเอกสารคืน
        const recovered = tryRecoverPeakDoc_('/invoices', docRef);
        if (recovered) {
          writeSumCell_(sheet, i, invDocCol, recovered);
          logEntry('Part2', sheetName, i, invCode, 'SUCCESS', recovered, 'กู้เลขเอกสารซ้ำ');
          countOk++;
        } else {
          writeSumCell_(sheet, i, invDocCol, CONFIG.DUPLICATE_MARKER);
          logEntry('Part2', sheetName, i, invCode, 'WARN', CONFIG.DUPLICATE_MARKER,
            'ใบแจ้งหนี้มีใน PEAK แล้ว — ค้นหาเลขที่ใน PEAK แล้วอัปเดตเซลล์ด้วยตนเอง');
        }
      } else if (kind === 'quota') {
        writeSumCell_(sheet, i, invDocCol, '');
        logEntry('Part2', sheetName, i, invCode, 'WARN', '', `หยุดชั่วคราว (quota): ${e.message}`);
        quotaHit = true;
        stoppedEarly = true;
        break;
      } else {
        writeSumCell_(sheet, i, invDocCol, '');
        logEntry('Part2', sheetName, i, invCode, 'ERROR', '', e.message);
        countError++;
      }
    }
  }

  let tail = '';
  if (stoppedEarly) {
    scheduleContinuation_('runPart2_Invoice', sheetName, countOk > 0);
    tail = quotaHit
      ? ' ⏸️ หยุดชั่วคราว (โควตา) — ทำต่ออัตโนมัติใน 15 นาที'
      : ' ⏸️ หยุดกันหมดเวลา — ทำต่ออัตโนมัติใน 15 นาที';
  } else {
    clearContinuation_('runPart2_Invoice');
  }
  const summary = `Part 2 เสร็จ — สร้าง: ${countOk}, ข้าม: ${countSkip}, Error: ${countError}${tail}`;
  toast(summary, 'FinFin', 10);
  Logger.log(summary);
  return summary;
}

// ─── Payload Builder ──────────────────────────────────────────────────────────

function buildInvoiceAllInOnePayload(
  invCode, contactUuid, issueDate, downPayment, installmentAmt,
  numInstallments, contractAmt, dueDates, customerName, isCarryOver, docRef
) {
  const products = [];
  const fallbackDate = issueDate || new Date();

  if (downPayment > 0) {
    products.push({
      accountCode: CONFIG.ACCOUNT_CODE_SALES,
      description: `เงินดาวน์ สัญญา ${invCode}`,
      quantity:    1,
      price:       downPayment,
      vatType:     CONFIG.VAT_TYPE_7,
      dueDate:     formatDateForAPI(fallbackDate),
    });
  }

  if (numInstallments > 0) {
    const lastDueDate = dueDates[dueDates.length - 1] || fallbackDate;
    const desc = isCarryOver
      ? `ค่างวดคงเหลือ ${numInstallments} งวด งวดละ ${installmentAmt.toLocaleString()} บาท สัญญา ${invCode}`
      : `ค่างวด ${numInstallments} งวด งวดละ ${installmentAmt.toLocaleString()} บาท สัญญา ${invCode}`;
    products.push({
      accountCode: CONFIG.ACCOUNT_CODE_SALES,
      description: desc,
      quantity:    numInstallments,
      price:       installmentAmt,
      vatType:     CONFIG.VAT_TYPE_7,
      dueDate:     formatDateForAPI(lastDueDate),
    });
  }

  const remark = isCarryOver
    ? `ใบแจ้งหนี้ยอดค้าง (ยกยอด) สัญญา ${invCode}${customerName ? ` — ${customerName}` : ''}`
    : `ใบแจ้งหนี้ สัญญา ${invCode}${customerName ? ` — ${customerName}` : ''}`;

  return {
    code:         docRef || buildReference(invCode, 'ALL', 'INV'),
    issuedDate:   formatDateForAPI(fallbackDate),
    dueDate:      formatDateForAPI(dueDates[dueDates.length - 1] || fallbackDate),
    contact:      { id: contactUuid, code: String(invCode), name: customerName },
    istaxInvoice: 1,
    taxStatus:    1,
    remark,
    products,
  };
}

// ─── Sheet helpers (Sum-specific) ─────────────────────────────────────────────

function ensureInvoiceDocHeader_(sheet, sc) {
  const headerRow = CONFIG.SUM_HEADER_ROW;
  // ใช้ INV_DOC ที่ detect แล้ว — fallback เป็น CONFIG.COL.INV_DOC_COL
  const targetCol = (sc && sc.INV_DOC != null && sc.INV_DOC >= 0)
    ? sc.INV_DOC
    : CONFIG.COL.INV_DOC_COL;
  const currentHeader = sheet.getRange(headerRow, targetCol + 1).getValue();
  if (!currentHeader) {
    sheet.getRange(headerRow, targetCol + 1).setValue('เลขที่ใบแจ้งหนี้ PEAK');
  }
  return targetCol;
}

// getSumData_ / writeSumCell_ / calculateDueDates อยู่ใน Part 1 / Utils อยู่แล้ว

function calculateDueDates(startDate, paymentDay, numMonths) {
  if (!startDate || isNaN(startDate.getTime())) return [];

  const dates = [];
  let firstDueMonth = startDate.getMonth();
  let firstDueYear  = startDate.getFullYear();

  if (startDate.getDate() >= paymentDay) {
    firstDueMonth += 1;
    if (firstDueMonth > 11) { firstDueMonth = 0; firstDueYear += 1; }
  }

  for (let n = 0; n < numMonths; n++) {
    let m = firstDueMonth + n;
    let y = firstDueYear;
    while (m > 11) { m -= 12; y += 1; }
    const lastDay = new Date(y, m + 1, 0).getDate();
    dates.push(new Date(y, m, Math.min(paymentDay, lastDay), 12, 0, 0));
  }
  return dates;
}

/**
 * หา due date ถัดไปจาก paymentDay ของเดือน
 * ถ้าวัน paymentDay ของเดือนนี้ผ่านไปแล้ว → ใช้เดือนหน้า
 */
function nextDueDate_(paymentDay) {
  const today = new Date();
  const clampDay = (y, m) => Math.min(paymentDay, new Date(y, m + 1, 0).getDate());
  const thisDay = clampDay(today.getFullYear(), today.getMonth());
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), thisDay, 12, 0, 0);
  if (thisMonth >= today) return thisMonth;
  let m = today.getMonth() + 1, y = today.getFullYear();
  if (m > 11) { m = 0; y++; }
  return new Date(y, m, clampDay(y, m), 12, 0, 0);
}

/**
 * สร้าง array of due dates จาก firstDue เป็นต้นไป count เดือน
 */
function buildRemainingDueDates_(firstDue, count) {
  if (!firstDue || count <= 0) return [];
  const dates = [firstDue];
  for (let n = 1; n < count; n++) {
    const prev = dates[dates.length - 1];
    let m = prev.getMonth() + 1, y = prev.getFullYear();
    if (m > 11) { m = 0; y++; }
    const d = Math.min(prev.getDate(), new Date(y, m + 1, 0).getDate());
    dates.push(new Date(y, m, d, 12, 0, 0));
  }
  return dates;
}

/**
 * คืน Set ของ invCode ที่ Part 1 ออก Tax Invoice ไปแล้ว
 * (มีค่าใน RECEIPT_COL.PEAK_DOC ที่ไม่ว่างและไม่ใช่ PROCESSING_MARKER)
 *
 * ป้องกัน Part 2 ออกใบแจ้งหนี้ซ้ำกับ Invoice ที่ Part 1 สร้างไปแล้ว
 * ซึ่งจะทำให้ลูกหนี้ใน PEAK ค้างโดยไม่มีการชำระ
 */
function buildPart1CoveredSet_(ss, sumSheetName) {
  const suffix = sumSheetName.replace(new RegExp('^' + CONFIG.SUM_SHEET_PREFIX), '');
  const covered = new Set();
  // รวมข้อมูลจากชีตทุก prefix ที่รู้จัก (เผื่อข้อมูลกระจาย Receipt05 + RE05)
  const prefixes = CONFIG.RECEIPT_SHEET_PREFIXES || [CONFIG.RECEIPT_SHEET_PREFIX];
  for (const prefix of prefixes) {
    const receiptName = prefix + suffix;
    try {
      const rSheet = ss.getSheetByName(receiptName);
      if (!rSheet) continue;
      const rc = detectReceiptColumns_(rSheet);
      const startRow = CONFIG.RECEIPT_HEADER_ROW + 1;
      const lastRow = rSheet.getLastRow();
      if (lastRow < startRow) continue;
      const numCols = Math.max(rc.PEAK_DOC, rc.INV) + 1;
      const data = rSheet.getRange(startRow, 1, lastRow - startRow + 1, numCols).getValues();
      for (const row of data) {
        const invCode = String(row[rc.INV]  || '').trim();
        const peakDoc = String(row[rc.PEAK_DOC] || '').trim();
        if (invCode && peakDoc && peakDoc !== CONFIG.PROCESSING_MARKER) {
          covered.add(invCode);
        }
      }
    } catch (e) {
      Logger.log(`buildPart1CoveredSet_: ไม่สามารถโหลด ${receiptName} — ${e.message}`);
    }
  }
  return covered;
}
