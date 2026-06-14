/**
 * Admin tool ชั่วคราว — แก้ dueDate ของใบแจ้งหนี้ carry-over ที่สร้างผิดไป
 *
 * ปัญหา: ก่อน PR #53 carry-over invoices ถูกสร้างด้วย firstDue = เดือนถัดไป
 *        แต่ logic ที่ถูกต้องคือ firstDue = issuedDate (วันที่ออก)
 *
 * วิธีใช้:
 *   1. probeGetInvoice_('1777548850-CONT-INV')         // เทส GET endpoint
 *   2. probeEditInvoice_('1777548850-CONT-INV')         // เทส POST /invoices/edit กับ 1 ใบ
 *   3. ดู Logger ว่าได้ผลลัพธ์อะไร — ปรับ payload จนกว่าจะสำเร็จ
 *   4. fixCarryOverDueDates_('11/06/2026')              // loop แก้ทั้งหมด
 */

// ─── (1) Probe GET ─────────────────────────────────────────────────────────────

function probeGetInvoice_(invoiceCode) {
  Logger.log(`\n▼ GET /invoices?code=${invoiceCode}`);
  try {
    const res = callPeakAPI('get', '/invoices', null, { code: invoiceCode });
    Logger.log(`Top-level keys: ${Object.keys(res || {}).join(', ')}`);

    const items = (res.PeakInvoices && res.PeakInvoices.invoices)
               || (res.data && Array.isArray(res.data) ? res.data : null)
               || (Array.isArray(res) ? res : null);

    if (Array.isArray(items)) {
      Logger.log(`Items count: ${items.length}`);
      const match = items.find(d => d.code === invoiceCode);
      if (match) {
        Logger.log(`✓ exact match: ${JSON.stringify(match).slice(0, 800)}`);
        return match;
      }
      Logger.log(`❌ ไม่มี exact code match — sample[0]: ${JSON.stringify(items[0] || {}).slice(0, 400)}`);
    } else {
      Logger.log(`Single object: ${JSON.stringify(res).slice(0, 800)}`);
    }
  } catch (e) {
    Logger.log(`GET error: ${e.message}`);
  }
  return null;
}

// ─── (2) Probe POST /invoices/edit ─────────────────────────────────────────────

/**
 * ลอง POST /invoices/edit ด้วย payload แบบต่างๆ — ดูว่าแบบไหนเวิร์ค
 * Default ใหม่: newDueDate = วันออกของใบนั้นๆ (ทำให้ "ครบกำหนดทันที")
 */
function probeEditInvoice_(invoiceCode, newDueDateOverride) {
  const doc = probeGetInvoice_(invoiceCode);
  if (!doc) { Logger.log('— ไม่มี doc → หยุด'); return; }

  const newDueDate = newDueDateOverride || doc.issuedDate;
  Logger.log(`\n▼ จะแก้ dueDate ของ ${invoiceCode}`);
  Logger.log(`   id=${doc.id}  issuedDate=${doc.issuedDate}  เดิม dueDate=${doc.dueDate}  → ใหม่=${newDueDate}`);

  // product dueDate (แก้ทุก product ในใบด้วย)
  const products = (doc.products || []).map(p => Object.assign({}, p, { dueDate: newDueDate }));

  const attempts = [
    // --- single object (ไม่ใช่ array) ---
    {
      label: 'D: single obj, transactionCode+transactionId',
      path:  '/invoices/edit',
      body:  { PeakInvoices: { invoices: { transactionId: doc.id, transactionCode: invoiceCode, dueDate: newDueDate } } },
    },
    {
      label: 'E: single obj, id only (UUID)',
      path:  '/invoices/edit',
      body:  { PeakInvoices: { invoices: { id: doc.id, dueDate: newDueDate } } },
    },
    {
      label: 'F: single obj, full doc + updated dueDate + products',
      path:  '/invoices/edit',
      body:  { PeakInvoices: { invoices: Object.assign({}, doc, { dueDate: newDueDate, products }) } },
    },
    {
      label: 'G: single obj, id+code+dueDate+products',
      path:  '/invoices/edit',
      body:  { PeakInvoices: { invoices: { id: doc.id, code: invoiceCode, dueDate: newDueDate, products } } },
    },
    {
      label: 'H: POST /invoices (upsert), single obj full doc',
      path:  '/invoices',
      body:  { PeakInvoices: { invoices: [Object.assign({}, doc, { dueDate: newDueDate, products })] } },
    },
  ];

  for (const a of attempts) {
    Logger.log(`\n— ลอง ${a.label}`);
    try {
      const res = callPeakAPI('post', a.path, a.body);
      Logger.log(`✓ Response: ${JSON.stringify(res).slice(0, 600)}`);
      // ตรวจว่าได้ result จริงไหม
      const after = probeGetInvoice_(invoiceCode);
      if (after && after.dueDate === newDueDate) {
        Logger.log(`✅ SUCCESS — dueDate เปลี่ยนเป็น ${after.dueDate}`);
        return a.label;
      } else {
        Logger.log(`⚠️ Response สำเร็จแต่ dueDate ยังไม่เปลี่ยน (=${after && after.dueDate})`);
      }
    } catch (e) {
      Logger.log(`❌ ${a.label}: ${e.message}`);
    }
  }
  Logger.log(`\n— ครบทุก attempt ไม่มีตัวไหนเวิร์ค`);
}

// ─── (3) Bulk fix ─────────────────────────────────────────────────────────────

/**
 * Loop แก้ dueDate ของทุก carry-over invoice ที่ออกวันที่ระบุ
 * issuedDateStr รูปแบบ: 'DD/MM/YYYY' (เช่น '11/06/2026') หรือ Date object
 *
 * Strategy:
 *   - GET /invoices ด้วย date filter (ถ้า PEAK รองรับ) หรือ scan ทั้งหมด
 *   - กรองเฉพาะ code ที่ลงท้าย '-CONT-INV'
 *   - POST /invoices/edit ทีละใบ
 */
function fixCarryOverDueDates_(issuedDateStr) {
  const targetDate = (issuedDateStr instanceof Date)
    ? Utilities.formatDate(issuedDateStr, 'Asia/Bangkok', 'yyyy-MM-dd')
    : _normalizeDate_(issuedDateStr);

  Logger.log(`▼ fixCarryOverDueDates — issuedDate=${targetDate}`);

  // ลอง GET /invoices ด้วย date filter
  let candidates = [];
  try {
    const res = callPeakAPI('get', '/invoices', null, {
      startDate: targetDate,
      endDate:   targetDate,
    });
    const items = (res.PeakInvoices && res.PeakInvoices.invoices) || res.data || [];
    candidates = Array.isArray(items) ? items : [];
    Logger.log(`GET /invoices คืนมา ${candidates.length} ใบ (อาจรวมใบอื่นๆ)`);
  } catch (e) {
    Logger.log(`GET error: ${e.message}`);
    return;
  }

  // กรอง CONT-INV และ issuedDate ตรง
  const targets = candidates.filter(d =>
    d.code && /-CONT-INV$/.test(d.code) && (d.issuedDate || '').startsWith(targetDate)
  );
  Logger.log(`เป้าหมายแก้ dueDate: ${targets.length} ใบ`);

  if (targets.length === 0) {
    Logger.log('— ไม่มีอะไรต้องแก้');
    return;
  }

  let ok = 0, fail = 0;
  for (const doc of targets) {
    if (doc.dueDate === doc.issuedDate) { Logger.log(`[${doc.code}] dueDate ตรงแล้ว ข้าม`); continue; }
    try {
      const payload = { id: doc.id, code: doc.code, dueDate: doc.issuedDate };
      callPeakAPI('post', '/invoices/edit', { PeakInvoices: { invoices: [payload] } });
      Logger.log(`✓ [${doc.code}] ${doc.dueDate} → ${doc.issuedDate}`);
      ok++;
    } catch (e) {
      Logger.log(`✗ [${doc.code}] ${e.message}`);
      fail++;
    }
    Utilities.sleep(200);
  }
  Logger.log(`\nสรุป: success=${ok} fail=${fail} จาก ${targets.length}`);
}

function _normalizeDate_(s) {
  // 'DD/MM/YYYY' → 'YYYY-MM-DD'
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s;
}
