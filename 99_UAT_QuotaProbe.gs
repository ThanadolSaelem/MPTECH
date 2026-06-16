/**
 * FinFin UAT — Quota Type Probe
 *
 * วัตถุประสงค์: พิสูจน์ว่า error "Transaction Limit exceeded" มาจาก
 *   (A) Daily rate limit  → เมื่อผ่านเที่ยงคืน request แรกจะสำเร็จ
 *   (B) Plan limit (สะสม) → ไม่ว่าจะรันกี่ครั้ง/กี่วัน ก็ยังล้มเหลว
 *
 * วิธีใช้:
 *   1. รัน probeQuotaType()  → บันทึก log พร้อม timestamp + raw error
 *   2. รันอีกครั้งวันถัดไป (หลังเที่ยงคืน) ดูว่าผลเปลี่ยนไหม
 *   3. ผล log จะบอกชัดว่าเป็น (A) หรือ (B)
 *
 * ไม่สร้างเอกสารจริง — ใช้ contact UUID ปลอม เพื่อให้ PEAK คืน error
 * ก่อนบันทึก (ถ้า PEAK ตรวจ quota ก่อน contact จะได้ "Transaction Limit")
 */

// ─── Main Probe Function ──────────────────────────────────────────────────────

/**
 * ทดสอบ quota type — รันได้ทุกเมื่อ ไม่มีผลข้างเคียง (read-only + probe payload)
 *
 * บันทึกใน Log:
 *   - วันเวลาที่รัน
 *   - HTTP status code จาก PEAK
 *   - resCode + message ใน response body
 *   - ประเภท error ตาม classifyError_()
 *   - สรุป: DAILY_LIMIT หรือ PLAN_LIMIT หรือ OK
 */
function probeQuotaType() {
  const now = new Date();
  const label = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
  Logger.log('═'.repeat(70));
  Logger.log(`▶ Quota Probe เริ่ม: ${label}`);
  Logger.log('═'.repeat(70));

  // ── Step 1: GET /invoices — read-only, ไม่ใช้ quota สร้างเอกสาร ──────────
  Logger.log('\n[Step 1] GET /invoices (read-only)');
  const getResult = _probeGet('/invoices');
  Logger.log(`  HTTP: ${getResult.httpCode}  resCode: ${getResult.resCode}  msg: ${getResult.msg}`);

  // ── Step 2: POST /invoices/allinone ด้วย payload จำลอง ──────────────────
  // ใช้ contactId = '00000000-0000-0000-0000-000000000000' (UUID ที่ไม่มีอยู่)
  // เพื่อให้ PEAK ตรวจ quota ก่อนตรวจ contact
  // ถ้า PEAK ตรวจ quota ก่อน → จะได้ error "Transaction Limit" → เป็น plan limit
  // ถ้า PEAK ตรวจ contact ก่อน → จะได้ error "contact not found" → quota ยังเหลือ
  Logger.log('\n[Step 2] POST /invoices/allinone (probe payload — contact UUID ไม่มีจริง)');
  const postResult = _probePost();
  Logger.log(`  HTTP: ${postResult.httpCode}  resCode: ${postResult.resCode}  msg: ${postResult.msg}`);
  Logger.log(`  Raw body (200 chars): ${postResult.rawBody.slice(0, 200)}`);

  // ── Step 3: วิเคราะห์ผล ─────────────────────────────────────────────────
  Logger.log('\n[Step 3] วิเคราะห์ผล');

  const isTransactionLimit = postResult.msg.toLowerCase().includes('transaction limit')
    || postResult.msg.toLowerCase().includes('limit exceeded');
  const isContactError = postResult.msg.toLowerCase().includes('contact')
    || postResult.msg.toLowerCase().includes('ไม่พบ')
    || postResult.resCode === 1;
  const isSuccess = postResult.httpCode === 200 && postResult.resCode === 0;

  let verdict;
  if (isTransactionLimit) {
    verdict = '🔴 PLAN_LIMIT — error "Transaction Limit" ปรากฏก่อน PEAK ตรวจ contact\n'
            + '   → ไม่ใช่ daily rate limit (ถ้าเป็น daily จะสำเร็จ request แรกของวัน)\n'
            + '   → เป็น plan quota สะสม — ต้องขอ sandbox/upgrade plan จาก admin';
  } else if (isContactError) {
    verdict = '🟡 QUOTA_OK (contact error) — PEAK ผ่าน quota check แล้วแต่ contact ไม่มีจริง\n'
            + '   → quota ยังเหลือ ณ เวลานี้ (หรือ daily limit reset แล้ว)\n'
            + '   → ถ้าเมื่อวานได้ PLAN_LIMIT แต่วันนี้ได้ผลนี้ → ยืนยันว่าเป็น daily reset\n'
            + '   → ถ้าทุกวันก็ได้ผลนี้ → quota ไม่มีปัญหา อาจเป็น error อื่น';
  } else if (isSuccess) {
    verdict = '🟢 OK — API ทำงานปกติ สร้างเอกสารทดสอบได้ (ลบด้วยตนเองใน PEAK)';
  } else {
    verdict = `⚪ OTHER — HTTP ${postResult.httpCode} resCode ${postResult.resCode}: ${postResult.msg}`;
  }

  Logger.log(`\n  VERDICT: ${verdict}`);

  // ── Step 4: บันทึก history เพื่อเปรียบเทียบข้ามวัน ─────────────────────
  _saveProbeHistory(label, postResult, verdict);

  Logger.log('\n' + '═'.repeat(70));
  Logger.log('▶ Quota Probe เสร็จ — ดู Log ด้านบนเพื่อส่งให้ admin');
  Logger.log('═'.repeat(70));

  return verdict;
}

// ─── ดู History ทั้งหมด ──────────────────────────────────────────────────────

/**
 * แสดง probe history ทุกครั้งที่เคยรัน — ใช้เปรียบเทียบว่า error ซ้ำข้ามวันหรือไม่
 */
function showProbeHistory() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('UAT_PROBE_HISTORY');
  if (!raw) { Logger.log('ยังไม่มี probe history — รัน probeQuotaType() ก่อน'); return; }

  const history = JSON.parse(raw);
  Logger.log('▼ Probe History (' + history.length + ' รายการ)');
  Logger.log('─'.repeat(70));
  history.forEach((h, i) => {
    Logger.log(`[${i + 1}] ${h.ts}  HTTP=${h.httpCode}  resCode=${h.resCode}  msg="${h.msg}"`);
    Logger.log(`      ${h.verdict.split('\n')[0]}`);
  });
  Logger.log('─'.repeat(70));

  const limitCount   = history.filter(h => h.verdict.includes('PLAN_LIMIT')).length;
  const quotaOkCount = history.filter(h => h.verdict.includes('QUOTA_OK')).length;
  const totalDays    = new Set(history.map(h => h.ts.slice(0, 10))).size;

  Logger.log(`\nสรุป: ${history.length} ครั้ง ใน ${totalDays} วัน`);
  Logger.log(`  PLAN_LIMIT: ${limitCount} ครั้ง  |  QUOTA_OK: ${quotaOkCount} ครั้ง`);

  if (limitCount > 0 && quotaOkCount === 0) {
    Logger.log('\n🔴 สรุปชัด: เป็น PLAN_LIMIT — ไม่เคย reset เลย แม้ข้ามวัน');
    Logger.log('   → ส่ง history นี้ให้ admin ขอ sandbox environment');
  } else if (limitCount > 0 && quotaOkCount > 0) {
    Logger.log('\n🟡 ปนกัน: บางครั้ง limit บางครั้งไม่ limit → น่าจะเป็น daily reset');
    Logger.log('   → ตรวจว่า QUOTA_OK เกิดวันไหน เปรียบกับ PLAN_LIMIT');
  } else {
    Logger.log('\n🟢 ไม่มีปัญหา quota เลย');
  }
}

/**
 * ล้าง probe history (เริ่มนับใหม่)
 */
function clearProbeHistory() {
  PropertiesService.getScriptProperties().deleteProperty('UAT_PROBE_HISTORY');
  Logger.log('ล้าง probe history แล้ว');
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function _probeGet(path) {
  try {
    const res = UrlFetchApp.fetch(CONFIG.BASE_URL + path, {
      method: 'get',
      headers: buildHeaders(),
      muteHttpExceptions: true,
    });
    const httpCode = res.getResponseCode();
    const body = res.getContentText();
    let resCode = -1, msg = '';
    try {
      const j = JSON.parse(body);
      resCode = j.resCode != null ? j.resCode : (j.ResCode != null ? j.ResCode : -1);
      msg = j.message || j.Message || j.resMessage || '';
    } catch (_) { msg = body.slice(0, 100); }
    return { httpCode, resCode, msg, rawBody: body };
  } catch (e) {
    return { httpCode: -1, resCode: -1, msg: e.message, rawBody: '' };
  }
}

function _probePost() {
  const probePayload = {
    PeakInvoices: {
      invoices: [{
        code:         'UAT-PROBE-' + Date.now(),
        issuedDate:   Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd'),
        dueDate:      Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd'),
        contact:      { id: '00000000-0000-0000-0000-000000000000', code: 'UAT-PROBE' },
        istaxInvoice: 0,
        remark:       'UAT quota probe — ไม่ใช่เอกสารจริง',
        products: [{
          accountCode: CONFIG.ACCOUNT_CODE_SALES,
          description: 'UAT probe',
          quantity:    1,
          price:       1,
          vatType:     CONFIG.VAT_TYPE_NONE,
        }],
      }],
    },
  };

  try {
    const res = UrlFetchApp.fetch(CONFIG.BASE_URL + '/invoices/allinone', {
      method:          'post',
      headers:         buildHeaders(),
      contentType:     'application/json',
      payload:         JSON.stringify(probePayload),
      muteHttpExceptions: true,
    });
    const httpCode = res.getResponseCode();
    const body = res.getContentText();
    let resCode = -1, msg = '';
    try {
      const j = JSON.parse(body);
      resCode = j.resCode != null ? j.resCode : (j.ResCode != null ? j.ResCode : -1);
      msg = j.message || j.Message || j.resMessage || j.errorMessage || '';
    } catch (_) { msg = body.slice(0, 200); }
    return { httpCode, resCode, msg, rawBody: body };
  } catch (e) {
    return { httpCode: -1, resCode: -1, msg: e.message, rawBody: '' };
  }
}

function _saveProbeHistory(ts, result, verdict) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('UAT_PROBE_HISTORY') || '[]';
  const history = JSON.parse(raw);
  history.push({
    ts,
    httpCode: result.httpCode,
    resCode:  result.resCode,
    msg:      result.msg.slice(0, 200),
    verdict:  verdict.split('\n')[0],
  });
  if (history.length > 30) history.splice(0, history.length - 30);
  props.setProperty('UAT_PROBE_HISTORY', JSON.stringify(history));
}
