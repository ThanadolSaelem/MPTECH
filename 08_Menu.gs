/**
 * FinFin Automation — UI Menu & Triggers
 *
 * เมนูจะปรากฏใน Google Sheets → "FinFin ระบบบัญชี"
 */

// ─── onOpen Trigger ───────────────────────────────────────────────────────────

/**
 * สร้าง menu เมื่อเปิด Spreadsheet
 * (ต้อง deploy / authorize ก่อนครั้งแรก)
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🏦 FinFin ระบบบัญชี')
    .addSubMenu(
      ui.createMenu('📄 Part 1 — ใบกำกับภาษี')
        .addItem('▶ ออกใบกำกับภาษี (เดือนนี้)', 'menuPart1_CurrentMonth')
        .addItem('▶ ออกใบกำกับภาษี (ระบุเดือน)...', 'menuPart1_PickMonth')
        .addSeparator()
        .addItem('▶ ออกใบกำกับ ค่าบริการเพิ่มเติม (เดือนนี้)', 'menuPart1_ServiceFee_Current')
        .addItem('▶ ออกใบกำกับ ค่าบริการเพิ่มเติม (ระบุเดือน)...', 'menuPart1_ServiceFee_Pick')
    )
    .addSubMenu(
      ui.createMenu('📋 Part 2 — ใบแจ้งหนี้')
        .addItem('▶ ออกใบแจ้งหนี้ bulk', 'menuPart2_Invoice')
    )
    .addSubMenu(
      ui.createMenu('💰 Part 3 — ค่าปรับ')
        .addItem('▶ ออกใบเสร็จค่าปรับ (เดือนนี้)', 'menuPart3_CurrentMonth')
        .addItem('▶ ออกใบเสร็จค่าปรับ (ระบุเดือน)...', 'menuPart3_PickMonth')
    )
    .addSubMenu(
      ui.createMenu('↩ Part 4 — คืนเครื่อง')
        .addItem('▶ ออกใบลดหนี้ (ไฟล์รับคืน)', 'menuPart4_CreditNote')
    )
    .addSubMenu(
      ui.createMenu('📑 Part 5 — ตรวจ Statement')
        .addItem('▶ Match Statement (เดือนนี้)', 'menuPart5_Current')
        .addItem('▶ Match Statement (ระบุเดือน + ชื่อ Sheet)...', 'menuPart5_Pick')
    )
    .addSeparator()
    .addSubMenu(
      ui.createMenu('🔄 Queue & Poll')
        .addItem('Poll Queue ทันที', 'manualPollQueues')
        .addItem('ดูสถานะ Queue', 'showQueueStatus')
    )
    .addSubMenu(
      ui.createMenu('⚙ ตั้งค่า')
        .addItem('ตั้ง Time-based Trigger (Poll ทุก 5 นาที)', 'setupPollTrigger')
        .addItem('ลบ Trigger ทั้งหมด', 'removeAllTriggers')
        .addItem('Reset Client Token Cache', 'resetClientTokenCache')
        .addItem('ดู Log Sheet', 'openLogSheet')
        .addItem('ทดสอบ PEAK Connection', 'testConnection')
    )
    .addToUi();
}

// ─── Menu Handlers — Part 1 ───────────────────────────────────────────────────

function menuPart1_CurrentMonth() {
  const sheetName = getCurrentReceiptSheetName();
  if (!confirmRun_(`ออกใบกำกับภาษีจาก Sheet "${sheetName}" ใช่ไหม?`)) return;
  try {
    const result = runPart1_TaxInvoice(sheetName);
    showResult_(result);
  } catch (e) {
    showError_(e);
  }
}

function menuPart1_PickMonth() {
  const sheetName = promptSheetName_('ระบุชื่อ Receipt sheet เต็ม เช่น Receipt04.2026');
  if (!sheetName) return;
  try {
    const result = runPart1_TaxInvoice(sheetName);
    showResult_(result);
  } catch (e) {
    showError_(e);
  }
}

// ─── Menu Handlers — Part 1 ค่าบริการเพิ่มเติม ───────────────────────────────

function menuPart1_ServiceFee_Current() {
  const sheetName = getCurrentSumSheetName();
  if (!confirmRun_(`ออกใบกำกับค่าบริการเพิ่มเติมจาก Sheet "${sheetName}" ใช่ไหม?`)) return;
  try {
    const result = runPart1_ServiceFee(sheetName);
    showResult_(result);
  } catch (e) {
    showError_(e);
  }
}

function menuPart1_ServiceFee_Pick() {
  const sheetName = promptSheetName_('ระบุชื่อ Sum sheet เต็ม เช่น Sum04.2026');
  if (!sheetName) return;
  try {
    const result = runPart1_ServiceFee(sheetName);
    showResult_(result);
  } catch (e) {
    showError_(e);
  }
}

// ─── Menu Handlers — Part 2 ───────────────────────────────────────────────────

function menuPart2_Invoice() {
  if (!confirmRun_('ออกใบแจ้งหนี้ bulk จาก Sheet สัญญาใหม่ ใช่ไหม?')) return;
  try {
    const result = runPart2_Invoice();
    showResult_(result);
  } catch (e) {
    showError_(e);
  }
}

// ─── Menu Handlers — Part 3 ───────────────────────────────────────────────────

function menuPart3_CurrentMonth() {
  const sheetName = getCurrentStatementSheetName();
  if (!confirmRun_(`ออกใบเสร็จค่าปรับจาก SCB Sheet "${sheetName}" ใช่ไหม?`)) return;
  try {
    const result = runPart3_LateFee(sheetName);
    showResult_(result);
  } catch (e) {
    showError_(e);
  }
}

function menuPart3_PickMonth() {
  const sheetName = promptSheetName_('ระบุชื่อ SCB sheet เต็ม เช่น SCB04.2026');
  if (!sheetName) return;
  try {
    const result = runPart3_LateFee(sheetName);
    showResult_(result);
  } catch (e) {
    showError_(e);
  }
}

// ─── Menu Handlers — Part 4 ───────────────────────────────────────────────────

function menuPart4_CreditNote() {
  if (!confirmRun_('ออกใบลดหนี้จากไฟล์รับคืน ใช่ไหม?')) return;
  try {
    const result = runPart4_CreditNote();
    showResult_(result);
  } catch (e) {
    showError_(e);
  }
}

// ─── Menu Handlers — Part 5 ───────────────────────────────────────────────────

function menuPart5_Current() {
  try {
    const result = runPart5_StatementMatch(getCurrentStatementSheetName(), getCurrentReceiptSheetName());
    showResult_(result);
  } catch (e) {
    showError_(e);
  }
}

function menuPart5_Pick() {
  const stmtName = promptSheetName_('ชื่อ SCB sheet เต็ม เช่น SCB04.2026');
  if (!stmtName) return;
  const recName = promptSheetName_('ชื่อ Receipt sheet เต็ม เช่น Receipt04.2026');
  if (!recName) return;
  try {
    const result = runPart5_StatementMatch(stmtName, recName);
    showResult_(result);
  } catch (e) {
    showError_(e);
  }
}

// ─── Triggers ─────────────────────────────────────────────────────────────────

/**
 * ตั้ง time-based trigger: pollAllQueues ทุก 5 นาที
 */
function setupPollTrigger() {
  // ลบ trigger เดิมก่อน (ป้องกันซ้ำ)
  removeTriggerByName_('pollAllQueues');

  ScriptApp.newTrigger('pollAllQueues')
    .timeBased()
    .everyMinutes(5)
    .create();

  showResult_('✅ ตั้ง Trigger "Poll ทุก 5 นาที" เรียบร้อยแล้ว');
}

/**
 * ลบ trigger ทั้งหมด
 */
function removeAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  const cleared = clearAllContinuations_();
  showResult_(`ลบ Trigger ทั้งหมด ${triggers.length} ตัว และงานค้าง (continuation) ${cleared} รายการแล้ว`);
}

function removeTriggerByName_(funcName) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === funcName)
    .forEach(t => ScriptApp.deleteTrigger(t));
}

// ─── Test Connection ──────────────────────────────────────────────────────────

/**
 * ทดสอบว่า PEAK credentials ถูกต้อง
 */
function testConnection() {
  try {
    if (CONFIG.CONNECT_ID === 'YOUR_CONNECT_ID') {
      throw new Error('ยังไม่ได้กรอก CONNECT_ID ใน 00_Config.gs');
    }
    if (CONFIG.USER_TOKEN === 'YOUR_USER_TOKEN') {
      throw new Error('ยังไม่ได้กรอก USER_TOKEN ใน 00_Config.gs');
    }

    resetClientTokenCache();
    const token = getClientToken();
    showResult_(`✅ เชื่อมต่อ PEAK สำเร็จ!\nClient-Token: ${token.substring(0, 20)}...`);
  } catch (e) {
    showError_(e);
  }
}

// ─── Log Sheet ────────────────────────────────────────────────────────────────

function openLogSheet() {
  const log = getLogSheet();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(log);
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function confirmRun_(message) {
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert('ยืนยัน', message, ui.ButtonSet.YES_NO);
  return res === ui.Button.YES;
}

function promptSheetName_(hint) {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('ระบุชื่อ Sheet', hint, ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return null;
  return res.getResponseText().trim() || null;
}

function showResult_(msg) {
  SpreadsheetApp.getUi().alert('✅ เสร็จแล้ว', String(msg), SpreadsheetApp.getUi().ButtonSet.OK);
}

function showError_(e) {
  SpreadsheetApp.getUi().alert('❌ Error', e.message || String(e), SpreadsheetApp.getUi().ButtonSet.OK);
  Logger.log(`ERROR: ${e.message}\n${e.stack}`);
}
