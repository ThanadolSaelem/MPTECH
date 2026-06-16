/**
 * FinFin Automation — Part 4: ออกใบลดหนี้ (คืนเครื่อง)
 *
 * Business Rules:
 *   - วัตถุประสงค์: เคลียร์ใบแจ้งหนี้ที่ค้างอยู่ใน PEAK เมื่อลูกค้าคืนเครื่อง
 *   - ไม่ใช่การคืนเงินให้ลูกค้า
 *   - วันที่ใบลดหนี้ = วันที่รับคืน (Sum sheet คอลัมน์ X = RETURN_DATE)
 *   - ยอดใบลดหนี้ = คอลัมน์ T (CLOSEOUT = คืนเครื่อง) ยืนยันจากพี่นก 2026-06-10
 *
 * Business Rules เพิ่มเติม (ยืนยันจากพี่นก 2026-06-10):
 *   - ส่วนลดปิดยอด: ไม่ออกใบลดหนี้ — เป็นส่วนลดเงินสด บันทึกเป็นค่าใช้จ่าย
 *   - คืนเครื่องแล้วผ่อนต่อ finfin: ถือว่ารับคืนเบ็ดเสร็จทั้งสัญญาเดิม
 *     → ออก CN เต็มยอดคงเหลือเหมือนเคสขายส่ง แล้วเปิดสัญญาใหม่แยก
 *   - ใบกำกับภาษีที่เปิดแล้วแต่ลูกค้ายังไม่จ่าย (เปิดตาม tax point ของเช่าซื้อ):
 *     เมื่อคืนเครื่องต้องออก CN หักใบกำกับภาษีเหล่านี้ออกด้วย
 *     → wire แล้ว: creditUnpaidTaxInvoices_ หาเลข IVF จากชีต Receipt/RE
 *       (แถวที่มีวันเปิดใบกำกับแต่ไม่มีวันรับชำระ) แล้วเช็ค remainAmount ใน PEAK
 *       ก่อนออก CN รายใบ — probe 2026-06-10 ยืนยัน: PEAK ignore filter param
 *       ทุกตัวใน GET /invoices จึงต้อง lookup ด้วย code ตรงๆ เท่านั้น
 *
 * Input: Sum sheet (getCurrentSumSheetName())
 *   - RETURN_DATE (X/23) ไม่ว่าง + CLOSEOUT (T/19) > 0
 *   - ชื่อสินค้า (H/7) รูปแบบ "iPhone 15 #20959" → parseProductString_
 *
 * Output:
 *   - เขียนเลขที่ใบลดหนี้ → คอลัมน์ที่เพิ่มอัตโนมัติหลัง AA (ensureCNDocHeader_)
 */

// ─── Main Entry Point ─────────────────────────────────────────────────────────

function runPart4_CreditNote(sheetName) {
  preFlightChecks_();
  sheetName = sheetName || getCurrentSumSheetName();

  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  const sheet = getSheetByNameSmart_(ss, sheetName);
  if (!sheet) throw new Error(`ไม่พบ Sum sheet "${sheetName}"`);

  toast(`⏳ Part 4 ใบลดหนี้ — ${sheetName}`, 'FinFin');

  const SC = CONFIG.COL;
  const cnDocCol = ensureCNDocHeader_(sheet);
  const data = getSumData_(sheet);

  let countOk = 0, countSkip = 0, countError = 0, countTaxCn = 0;
  const guard = makeTimeGuard_(5);
  let stoppedEarly = false, quotaHit = false;

  for (let i = 0; i < data.length; i++) {
    if (guard.expired()) { stoppedEarly = true; break; }
    const row = data[i];

    // ─── Guard: ต้องมี INV และ RETURN_DATE ────────────────────────────────
    const invCode = String(row[SC.INV] || '').trim();
    if (!invCode) continue;

    const returnDateRaw = row[SC.RETURN_DATE];
    if (!returnDateRaw) continue;

    // ─── ยอดใบลดหนี้ (คอลัมน์ T = CLOSEOUT) ────────────────────────────
    const creditAmt = parseAmount(row[SC.CLOSEOUT]);
    if (creditAmt <= 0) {
      logEntry('Part4', sheetName, i, invCode, 'SKIP', '', `CLOSEOUT = ${creditAmt} ≤ 0 — ข้าม`);
      countSkip++;
      continue;
    }

    // ─── Idempotency ──────────────────────────────────────────────────
    const existingCN = String(row[cnDocCol] || '').trim();
    if (existingCN && existingCN !== CONFIG.PROCESSING_MARKER) {
      countSkip++;
      continue;
    }

    // ─── Parse วันที่รับคืน ──────────────────────────────────────────
    const returnDate = returnDateRaw instanceof Date
      ? returnDateRaw
      : parseMDYDate_(String(returnDateRaw || '').trim());

    if (!returnDate) {
      logEntry('Part4', sheetName, i, invCode, 'ERROR', '', `parse วันที่รับคืนไม่ได้: "${returnDateRaw}"`);
      countError++;
      continue;
    }

    // ─── Build metadata ───────────────────────────────────────────────
    const { model: productModel, serial: imei } = parseProductString_(row[SC.PRODUCT]);
    const prefix = String(row[SC.TITLE] || '').trim();
    const nameOnly = String(row[SC.NAME] || '').trim();
    const customerName = (prefix && !nameOnly.startsWith(prefix))
      ? `${prefix}${nameOnly}`.trim()
      : nameOnly;
    const branch = String(row[SC.BRANCH] || '').trim();

    // ─── Mark PROCESSING ───────────────────────────────────────────────
    writeSumCell_(sheet, i, cnDocCol, CONFIG.PROCESSING_MARKER);

    try {
      ensureContactsBatch_({ [invCode]: customerName });

      const invoiceUUID = getInvoiceUUID_(invCode);
      if (!invoiceUUID) throw new Error(`ไม่พบ Invoice UUID สำหรับสัญญา ${invCode} — ตรวจว่า Part 2 ออกใบแจ้งหนี้แล้ว`);

      const payload = buildCreditNotePayload(
        invCode, invoiceUUID, returnDate, creditAmt, productModel, imei, customerName, branch
      );
      Logger.log(`Part4 payload [${invCode}]: ${JSON.stringify({ PeakCreditNotes: { creditNotes: [payload] } }, null, 2)}`);
      const res = callPeakAPI('post', '/creditnotes', { PeakCreditNotes: { creditNotes: [payload] } });
      const cn = (res.PeakCreditNotes && res.PeakCreditNotes.creditNotes && res.PeakCreditNotes.creditNotes[0]) || res;
      const docNo = cn.creditNoteCode || cn.code || JSON.stringify(res).substring(0, 80);

      // หักใบกำกับภาษีค้างชำระของสัญญานี้ด้วย (พี่นก 2026-06-10)
      // ทำก่อนเขียน docNo — ถ้า quota กลางคัน เซลล์ยังเป็น PROCESSING
      // รอบหน้าจะ recover CN หลักจาก duplicate แล้วออก CN ที่เหลือต่อ
      const taxCn = creditUnpaidTaxInvoices_(invCode, returnDate, sheetName);
      countTaxCn += taxCn.ok;
      if (taxCn.quota) {
        writeSumCell_(sheet, i, cnDocCol, '');
        quotaHit = true;
        stoppedEarly = true;
        break;
      }

      writeSumCell_(sheet, i, cnDocCol, docNo);
      logEntry('Part4', sheetName, i, invCode, 'SUCCESS', docNo,
        taxCn.ok > 0 ? `+CN ใบกำกับค้างชำระ ${taxCn.ok} ใบ` : '');
      countOk++;

    } catch (e) {
      const kind = classifyError_(e);
      if (kind === 'quota') {
        writeSumCell_(sheet, i, cnDocCol, '');
        logEntry('Part4', sheetName, i, invCode, 'WARN', '', `หยุดชั่วคราว (quota): ${e.message}`);
        quotaHit = true;
        stoppedEarly = true;
        break;
      }
      if (kind === 'duplicate') {
        const cnRef = buildReference(invCode, formatDateForAPI(returnDate), 'CN');
        const recovered = tryRecoverPeakDoc_('/creditnotes', cnRef);

        // CN หลักมีอยู่แล้ว — ยังต้องหักใบกำกับภาษีค้างชำระให้ครบ (idempotent)
        const taxCnDup = creditUnpaidTaxInvoices_(invCode, returnDate, sheetName);
        countTaxCn += taxCnDup.ok;
        if (taxCnDup.quota) {
          writeSumCell_(sheet, i, cnDocCol, '');
          quotaHit = true;
          stoppedEarly = true;
          break;
        }

        if (recovered) {
          writeSumCell_(sheet, i, cnDocCol, recovered);
          logEntry('Part4', sheetName, i, invCode, 'SUCCESS', recovered, 'กู้เลขเอกสารซ้ำ');
          countOk++;
        } else {
          writeSumCell_(sheet, i, cnDocCol, CONFIG.DUPLICATE_MARKER);
          logEntry('Part4', sheetName, i, invCode, 'WARN', CONFIG.DUPLICATE_MARKER,
            'ใบลดหนี้มีใน PEAK แล้ว — ค้นหาเลขที่ใน PEAK แล้วอัปเดตเซลล์ด้วยตนเอง');
        }
        continue;
      }
      writeSumCell_(sheet, i, cnDocCol, '');
      Logger.log(`Part4 ERROR [${invCode}]: ${e.message}\nStack: ${e.stack || '(no stack)'}`);
      logEntry('Part4', sheetName, i, invCode, 'ERROR', '', e.message);
      countError++;
    }
  }

  let tail = '';
  if (stoppedEarly) {
    scheduleContinuation_('runPart4_CreditNote', sheetName, countOk > 0);
    tail = quotaHit
      ? ' ⏸️ หยุดชั่วคราว (โควตา) — ทำต่ออัตโนมัติใน 15 นาที'
      : ' ⏸️ หยุดกันหมดเวลา — ทำต่ออัตโนมัติใน 15 นาที';
  } else {
    clearContinuation_('runPart4_CreditNote');
  }
  const summary = `Part 4 เสร็จ — สร้างแล้ว: ${countOk}, CN ใบกำกับค้างชำระ: ${countTaxCn}, ข้าม: ${countSkip}, Error: ${countError}${tail}`;
  toast(summary, 'FinFin', 10);
  Logger.log(summary);
  return summary;
}

// ─── Payload Builder ──────────────────────────────────────────────────────────

/**
 * สร้าง payload ใบลดหนี้ตาม PEAK API doc หัวข้อ 14
 *
 * transactionType: 102 = Invoice, 103 = Receipt
 * reasonType:      1 = สินค้าส่งคืน (ดูตาราง reasonType ใน doc)
 * goodsReturn:     "1" = คืนสินค้าเข้าคลัง, "0" = ไม่คืน
 * issuedDate:      int yyyyMMdd (ไม่ใช่ ISO string)
 */
function buildCreditNotePayload(invCode, invoiceUUID, returnDate, creditAmt, product, imei, customerName, branch) {
  const desc = `คืนเครื่อง ${product}${imei ? ` IMEI ${imei}` : ''} สาขา ${branch} — ${customerName}`;
  const dateStr = formatDateForAPI(returnDate);              // "YYYY-MM-DD"
  const dateInt = parseInt(dateStr.replace(/-/g, ''), 10);  // yyyyMMdd (int)

  return {
    transactionType:    102,         // 102 = ใบแจ้งหนี้ (Invoice)
    transactionId:      invoiceUUID, // UUID ของใบแจ้งหนี้ที่ต้องการลดหนี้
    reasonType:         1,           // 1 = สินค้าส่งคืน
    reasonDescription:  desc,
    goodsReturn:        '1',         // คืนสินค้าเข้าคลัง
    transactions: {
      code:       buildReference(invCode, dateStr, 'CN'),
      issuedDate: dateInt,
      remark:     desc,
      // ไม่ระบุ products — PEAK ดึงจาก invoice ต้นฉบับเองโดยอัตโนมัติ (verified v7)
    },
    // ไม่ส่ง creditNotePayment — เคลียร์ยอดค้างในบัญชีเท่านั้น ไม่คืนเงินสด
  };
}

/**
 * ดึง UUID ของใบแจ้งหนี้จาก PEAK โดยใช้ invCode
 * → ใช้ code ที่ Part 2 สร้างไว้: buildReference(invCode, 'ALL', 'INV')
 */
function getInvoiceUUID_(invCode) {
  const invoiceCode = buildReference(invCode, 'ALL', 'INV');
  try {
    const res = callPeakAPI('get', '/invoices', null, { code: invoiceCode });
    Logger.log(`getInvoiceUUID_ [${invCode}] code=${invoiceCode}: ${JSON.stringify(res).slice(0, 200)}`);
    const invoices = res && res.PeakInvoices && res.PeakInvoices.invoices;
    // probe 2026-06-10: PEAK ignore query param ที่ไม่รู้จักแล้วคืน list ทั้งหมด
    // → ต้อง validate ว่า code ตรงจริง ไม่งั้นอาจได้ใบแจ้งหนี้ของสัญญาอื่น
    const list = Array.isArray(invoices) ? invoices : (invoices ? [invoices] : []);
    const inv = list.find(d => d && d.code === invoiceCode);
    return (inv && (inv.id || inv.invoiceId)) || null;
  } catch (e) {
    Logger.log(`getInvoiceUUID_ error [${invCode}]: ${e.message}`);
    return null;
  }
}

// ─── ใบลดหนี้ใบกำกับภาษีค้างชำระ (พี่นก 2026-06-10) ──────────────────────────────

/**
 * หาใบกำกับภาษีค้างชำระของสัญญาจากชีต Receipt/RE ทุกเดือน
 * = แถวที่มีวันที่เปิดใบกำกับภาษี + เลข IVF แต่ไม่มีวันที่รับชำระ (ค้างชำระ)
 * @returns {Array<{code:string, amt:number, sheet:string}>}
 */
function findUnpaidTaxInvoiceCodes_(invCode) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  const out = [];
  for (const sheet of ss.getSheets()) {
    // เฉพาะชีตรับชำระรายเดือน: Receipt03.2026 / RE04.2026
    if (!/^(Receipt|RE)\d{2}\.\d{4}$/.test(sheet.getName())) continue;
    const rc = detectReceiptColumns_(sheet);
    const lastRow = sheet.getLastRow();
    if (lastRow <= CONFIG.RECEIPT_HEADER_ROW) continue;
    const data = sheet.getRange(
      CONFIG.RECEIPT_HEADER_ROW + 1, 1,
      lastRow - CONFIG.RECEIPT_HEADER_ROW, sheet.getLastColumn()
    ).getValues();
    for (const row of data) {
      if (String(row[rc.INV] || '').trim() !== String(invCode)) continue;
      if (toDate(row[rc.PAY_DATE])) continue;                    // จ่ายแล้ว — ข้าม
      if (!toDate(row[rc.TAX_DATE])) continue;                   // ยังไม่เปิดใบกำกับ
      const ivf = String(row[rc.SMEMOVE_DOC] || '').trim();
      if (!ivf.startsWith('IVF-')) continue;
      out.push({ code: ivf, amt: parseAmount(row[rc.AMT]), sheet: sheet.getName() });
    }
  }
  return out;
}

/**
 * ออก CN หักใบกำกับภาษีค้างชำระทั้งหมดของสัญญา (เรียกตอนคืนเครื่อง)
 *
 * - lookup ใบกำกับใน PEAK ด้วย code (IVF-xxx) + validate code ตรงจริง
 * - ออก CN เฉพาะใบที่ remainAmount > 0 (ยังค้างจริงใน PEAK)
 * - idempotent: CN code = `${IVF}-CN` — ซ้ำ → กู้เลขเดิม นับเป็นสำเร็จ
 * - เจอ quota → หยุดและคืน quota:true ให้ runner หลักหยุดทั้ง run (ไม่ throw)
 * @returns {{ok:number, skip:number, fail:number, quota:boolean}}
 */
function creditUnpaidTaxInvoices_(invCode, returnDate, sheetName) {
  const result = { ok: 0, skip: 0, fail: 0, quota: false };
  const unpaid = findUnpaidTaxInvoiceCodes_(invCode);
  for (const u of unpaid) {
    try {
      const res = callPeakAPI('get', '/invoices', null, { code: u.code });
      const raw = (res.PeakInvoices && res.PeakInvoices.invoices) || [];
      const list = Array.isArray(raw) ? raw : [raw];
      const doc = list.find(d => d && d.code === u.code);
      if (!doc) {
        logEntry('Part4-TAXCN', sheetName, -1, invCode, 'SKIP', '',
          `ไม่พบใบกำกับภาษี ${u.code} ใน PEAK (อ้างอิง ${u.sheet}) — อาจยังไม่ได้สร้าง`);
        result.skip++;
        continue;
      }
      const remain = Number(doc.remainAmount || 0);
      if (remain <= 0) {
        logEntry('Part4-TAXCN', sheetName, -1, invCode, 'SKIP', '',
          `${u.code} ไม่มียอดค้างใน PEAK (remainAmount=0) — มีใบเสร็จตัดไปแล้ว ตรวจว่าใบเสร็จนั้นถูกต้องไหม`);
        result.skip++;
        continue;
      }
      const desc = `ลดหนี้ใบกำกับภาษีค้างชำระ ${u.code} (คืนเครื่อง) สัญญา ${invCode}`;
      const dateStr = formatDateForAPI(returnDate);
      const payload = {
        transactionType:    102,       // ใบกำกับถูกสร้างผ่าน /invoices (Part 1 Case B)
        transactionId:      doc.id,
        reasonType:         1,
        reasonDescription:  desc,
        goodsReturn:        '0',       // ลดหนี้ทางบัญชี — ตัวเครื่องจัดการใน CN หลักแล้ว
        transactions: {
          code:       `${u.code}-CN`,
          issuedDate: parseInt(dateStr.replace(/-/g, ''), 10),
          remark:     desc,
          // ไม่ระบุ products — PEAK ดึงจากใบกำกับต้นฉบับเอง (verified v7)
        },
      };
      const cnRes = callPeakAPI('post', '/creditnotes', { PeakCreditNotes: { creditNotes: [payload] } });
      const cn = (cnRes.PeakCreditNotes && cnRes.PeakCreditNotes.creditNotes && cnRes.PeakCreditNotes.creditNotes[0]) || cnRes;
      const docNo = cn.creditNoteCode || cn.code || '';
      logEntry('Part4-TAXCN', sheetName, -1, invCode, 'SUCCESS', docNo,
        `หัก ${u.code} ยอดค้าง ${remain}`);
      result.ok++;
    } catch (e) {
      const kind = classifyError_(e);
      if (kind === 'quota') {
        logEntry('Part4-TAXCN', sheetName, -1, invCode, 'WARN', '', `หยุดชั่วคราว (quota): ${e.message}`);
        result.quota = true;
        break;
      }
      if (kind === 'duplicate') {
        const recovered = tryRecoverPeakDoc_('/creditnotes', `${u.code}-CN`);
        logEntry('Part4-TAXCN', sheetName, -1, invCode,
          'SUCCESS', recovered || '[IN-PEAK]', `CN ของ ${u.code} มีอยู่แล้ว`);
        result.ok++;
        continue;
      }
      logEntry('Part4-TAXCN', sheetName, -1, invCode, 'ERROR', '', `${u.code}: ${e.message}`);
      result.fail++;
    }
  }
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureCNDocHeader_(sheet) {
  const CN_DOC_LABEL = 'เลขที่ใบลดหนี้';
  const headerRow = CONFIG.SUM_HEADER_ROW;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  const existing = headers.findIndex(h => String(h).trim() === CN_DOC_LABEL);
  if (existing >= 0) return existing;
  let lastUsed = lastCol - 1;
  for (let i = headers.length - 1; i >= 0; i--) {
    if (String(headers[i] || '').trim()) { lastUsed = i; break; }
  }
  const newCol = lastUsed + 1;
  sheet.getRange(headerRow, newCol + 1).setValue(CN_DOC_LABEL);
  return newCol;
}

function parseProductString_(productStr) {
  const m = String(productStr || '').match(/^(.*?)\s*#(\S+)\s*$/);
  if (m) return { model: m[1].trim(), serial: m[2].trim() };
  return { model: String(productStr || '').trim(), serial: '' };
}

/**
 * แปลง "DD/MM/YYYY" (Thai format) → Date object
 * ถ้าตัวเลขแรก > 12 → ชัดเจนว่าเป็น DD; ถ้าไม่ชัดเจนก็ถือ DD/MM/YYYY เป็น default
 */
function parseMDYDate_(s) {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const [, dd, mm, yyyy] = m;  // DD/MM/YYYY (Thai date format)
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Probe product variants → หาแบบที่ PEAK ยอมรับสำหรับ credit note
 * รันครั้งเดียว ดู log ว่า variant ไหน HTTP 200 แล้วแก้ buildCreditNotePayload
 */
function debugCreditNoteProbe() {
  const invCode     = '1752483851';
  const invoiceUUID = 'b13c13bb-fa2e-40e2-a92c-9904d8e16a56';
  const dateInt     = 20251221;
  const dateStr     = '2025-12-21';
  const cnCode      = `${invCode}-${dateStr}-CN-PROBE`;
  const desc        = 'probe CN product test';
  const amt         = 11600;

  const baseHeader = {
    transactionType:   102,
    transactionId:     invoiceUUID,
    reasonType:        1,
    reasonDescription: desc,
    goodsReturn:       '1',
  };

  const variants = [
    // v1: ต้นฉบับ (accountCode + vatType)
    { label: 'v1: accountCode+vatType3', products: [{ accountCode: '410101', description: desc, quantity: 1, price: amt, vatType: 3 }] },
    // v2: ไม่มี accountCode
    { label: 'v2: no accountCode',       products: [{ description: desc, quantity: 1, price: amt, vatType: 3 }] },
    // v3: vatType:1 (ไม่มี VAT)
    { label: 'v3: vatType 1',            products: [{ accountCode: '410101', description: desc, quantity: 1, price: amt, vatType: 1 }] },
    // v4: ไม่มี accountCode + vatType:1
    { label: 'v4: no acct, vatType 1',   products: [{ description: desc, quantity: 1, price: amt, vatType: 1 }] },
    // v5: เพิ่ม whtType:1
    { label: 'v5: +whtType 1',           products: [{ accountCode: '410101', description: desc, quantity: 1, price: amt, vatType: 3, whtType: 1 }] },
    // v6: price เป็น string
    { label: 'v6: price as string',      products: [{ accountCode: '410101', description: desc, quantity: 1, price: String(amt), vatType: 3 }] },
    // v7: ไม่มี products ใน transactions
    { label: 'v7: no products',          products: undefined },
  ];

  for (const v of variants) {
    const txn = { code: cnCode, issuedDate: dateInt, remark: desc };
    if (v.products !== undefined) txn.products = v.products;

    const body = { PeakCreditNotes: { creditNotes: [Object.assign({}, baseHeader, { transactions: txn })] } };
    const url  = CONFIG.BASE_URL + '/creditnotes';
    try {
      const res = UrlFetchApp.fetch(url, {
        method: 'post', headers: buildHeaders(), contentType: 'application/json',
        payload: JSON.stringify(body), muteHttpExceptions: true,
      });
      const code = res.getResponseCode();
      const text = res.getContentText().slice(0, 300);
      Logger.log(`[${v.label}] HTTP ${code}: ${text}`);
    } catch (e) {
      Logger.log(`[${v.label}] ERROR: ${e.message}`);
    }
    Utilities.sleep(300);
  }
  Logger.log('--- Probe เสร็จ --- ดูว่า variant ไหน HTTP 200 หรือ error message ต่างกัน');
}

/**
 * Probe: หาวิธี query ใบกำกับภาษีค้างชำระของ contact จาก PEAK
 *
 * เคสคืนเครื่อง (พี่นก 2026-06-10): ใบกำกับภาษีที่เปิดไปแล้วตาม tax point
 * แต่ลูกค้ายังไม่จ่าย ต้องออก CN หักออกด้วย — ก่อน wire อัตโนมัติต้องรู้:
 *   1. GET /invoices ใช้ param ไหน filter ตาม contact ได้ (PEAK doc ไม่ระบุชัด)
 *   2. field ไหนใน response บอกสถานะค้างชำระ/ชำระแล้ว
 *
 * วิธีใช้: แก้ invCode เป็นเลขสัญญาที่รู้ว่ามีใบกำกับภาษีค้างใน PEAK
 * แล้วรันครั้งเดียว ส่ง log ทั้งหมดกลับมา
 */
function debugProbeContactInvoices() {
  const invCode = '1761985715';  // ← แก้เป็นเลขสัญญาที่มีใบกำกับภาษีค้างชำระใน PEAK

  const contactUuid = getContactId_(invCode);
  Logger.log(`contactUuid [${invCode}]: ${contactUuid}`);

  const trials = [
    { label: 'plain list page 1', params: { page: 1 } },
    { label: 'contactCode',       params: { contactCode: invCode } },
    { label: 'contactId (uuid)',  params: contactUuid ? { contactId: contactUuid } : null },
    { label: 'customerCode',      params: { customerCode: invCode } },
    { label: 'keyword',           params: { keyword: invCode } },
    { label: 'searchText',        params: { searchText: invCode } },
  ];

  for (const t of trials) {
    if (!t.params) { Logger.log(`[${t.label}] SKIP — ไม่มี contactUuid`); continue; }
    try {
      const res = callPeakAPI('get', '/invoices', null, t.params);
      const list = res && res.PeakInvoices && res.PeakInvoices.invoices;
      const n = Array.isArray(list) ? list.length : -1;
      Logger.log(`[${t.label}] count=${n}`);
      if (n > 0) {
        // item แรกแบบเต็ม — เพื่อดูชื่อ field สถานะชำระ/ค้างชำระ
        Logger.log(`[${t.label}] first item: ${JSON.stringify(list[0]).slice(0, 800)}`);
        // เช็คว่า filter ทำงานจริงไหม (ถ้า PEAK ignore param จะได้ list รวมทุก contact)
        const codes = list.slice(0, 10).map(x => (x.contact && x.contact.code) || x.contactCode || '?');
        Logger.log(`[${t.label}] contact codes 10 แรก: ${codes.join(', ')}`);
      } else {
        Logger.log(`[${t.label}] raw: ${JSON.stringify(res).slice(0, 300)}`);
      }
    } catch (e) {
      Logger.log(`[${t.label}] ERROR: ${e.message}`);
    }
    Utilities.sleep(300);
  }
  Logger.log('--- Probe เสร็จ — ส่ง log กลับมาเพื่อ wire การออก CN หักใบกำกับภาษีค้างชำระใน Part 4 ---');
}

/**
 * เพิ่ม header "เลขที่ใบลดหนี้" ใน Col Q ถ้ายังไม่มี
 */
function ensureReturnFileHeader_(sheet) {
  const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const lastColIdx = headerRow.length; // 0-based last index

  // ตรวจว่า Col Q (index 16) มีค่าหรือยัง
  if (lastColIdx <= 16 || !headerRow[16]) {
    sheet.getRange(1, 17).setValue('เลขที่ใบลดหนี้');  // Col Q = column 17 (1-indexed)
  }
}
