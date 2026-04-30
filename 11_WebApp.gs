/**
 * FinFin — Web App Router
 *
 * Deploy: Extensions → Apps Script → Deploy → New deployment → Web app
 *   - Execute as: Me
 *   - Who has access: Anyone
 *   - Copy the /exec URL → ใส่ใน Python client
 *
 * หลัง deploy: รัน setupWebAppApiKey('<your-secret>') ครั้งเดียวเพื่อตั้ง API key
 */

const WEBAPP_API_KEY_PROP = 'FINFIN_API_KEY';
const WEBAPP_OVERRIDE_KEYS = [
  'CONNECT_ID', 'USER_TOKEN', 'SPREADSHEET_ID', 'RETURN_SPREADSHEET_ID',
];

// ─── Entry Points ─────────────────────────────────────────────────────────────

function doGet(e) {
  return jsonResponse_({ ok: true, message: 'FinFin GAS Web App alive', now: new Date().toISOString() });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData?.contents || '{}');
    const { action, apiKey, params } = body;

    if (!verifyApiKey_(apiKey)) {
      return jsonResponse_({ ok: false, error: 'Invalid API key' });
    }

    loadConfigOverrides_();
    const data = routeAction_(action, params || {});
    return jsonResponse_({ ok: true, data });
  } catch (e) {
    return jsonResponse_({ ok: false, error: e.message, stack: String(e.stack).substring(0, 500) });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function verifyApiKey_(key) {
  const stored = PropertiesService.getScriptProperties().getProperty(WEBAPP_API_KEY_PROP);
  return !!stored && stored === key;
}

function loadConfigOverrides_() {
  const props = PropertiesService.getScriptProperties();
  for (const k of WEBAPP_OVERRIDE_KEYS) {
    const v = props.getProperty(`FINFIN_${k}`);
    if (v) CONFIG[k] = v;
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

function routeAction_(action, p) {
  switch (action) {
    case 'ping':              return { pong: new Date().toISOString() };
    case 'config/get':        return getConfigMasked_();
    case 'config/set':        return setConfigProps_(p);
    case 'part1/run':         return runPart1_TaxInvoice(resolveSheet_(p.sheetName, CONFIG.RECEIPT_SHEET_PREFIX));
    case 'part1/servicefee':  return runPart1_ServiceFee(resolveSheet_(p.sheetName, CONFIG.SUM_SHEET_PREFIX));
    case 'part2/run':         return runPart2_Invoice(resolveSheet_(p.sheetName, CONFIG.SUM_SHEET_PREFIX));
    case 'part3/run':         return runPart3_LateFee(resolveSheet_(p.sheetName, CONFIG.STATEMENT_SHEET_PREFIX));
    case 'part4/run':         return runPart4_CreditNote();
    case 'part5/run': {
      const stmt = resolveSheet_(p.statementSheetName || p.sheetName, CONFIG.STATEMENT_SHEET_PREFIX);
      const rec  = resolveSheet_(p.receiptSheetName   || p.sheetName, CONFIG.RECEIPT_SHEET_PREFIX);
      return runPart5_StatementMatch(stmt, rec);
    }
    case 'poll/now':          return pollAllQueues();
    case 'poll/status':       return getQueueStatusJson_();
    case 'dashboard/refresh': return refreshDashboard(p.month);
    case 'logs/tail':         return getLogsTail_(p.limit || 50);
    case 'test/peak':         return testPeakConnection_();
    default:                  throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * ถ้า name ว่าง → return null (GAS จะ default เป็นเดือนปัจจุบัน)
 * ถ้า name เป็น "MM.YYYY" → เติม prefix อัตโนมัติ
 * ถ้า name มี prefix อยู่แล้ว → คืนตามเดิม
 */
function resolveSheet_(name, prefix) {
  if (!name || !String(name).trim()) return null;
  const s = String(name).trim();
  if (s.startsWith(prefix)) return s;
  return `${prefix}${s}`;
}

// ─── Config (masked read / write) ─────────────────────────────────────────────

function getConfigMasked_() {
  const mask = v => v && v !== 'YOUR_CONNECT_ID' && v !== 'YOUR_USER_TOKEN' && v !== 'YOUR_SPREADSHEET_ID'
    ? v.substring(0, 4) + '****' + v.substring(v.length - 4)
    : '(not set)';
  return {
    CONNECT_ID:            mask(CONFIG.CONNECT_ID),
    USER_TOKEN:            mask(CONFIG.USER_TOKEN),
    SPREADSHEET_ID:        CONFIG.SPREADSHEET_ID,
    RETURN_SPREADSHEET_ID: CONFIG.RETURN_SPREADSHEET_ID,
  };
}

function setConfigProps_(p) {
  const props = PropertiesService.getScriptProperties();
  const updated = [];
  for (const k of WEBAPP_OVERRIDE_KEYS) {
    if (p[k] && String(p[k]).trim()) {
      props.setProperty(`FINFIN_${k}`, String(p[k]).trim());
      CONFIG[k] = String(p[k]).trim();
      updated.push(k);
    }
  }
  return { updated };
}

// ─── Status & Logs ────────────────────────────────────────────────────────────

function getQueueStatusJson_() {
  const out = {};
  for (const t of ['receipt', 'invoice', 'receipt_fee']) {
    out[t] = getQueueEntries(t).length;
  }
  return out;
}

function getLogsTail_(limit) {
  const log = getLogSheet();
  const lastRow = log.getLastRow();
  if (lastRow <= 1) return [];
  const start = Math.max(2, lastRow - limit + 1);
  const n = lastRow - start + 1;
  return log.getRange(start, 1, n, 8).getValues()
    .map(([ts, part, sheet, row, inv, status, doc, msg]) => ({
      ts: ts instanceof Date ? ts.toISOString() : String(ts),
      part, sheet, row, inv, status, doc, msg,
    }));
}

function testPeakConnection_() {
  if (CONFIG.CONNECT_ID === 'YOUR_CONNECT_ID') throw new Error('CONNECT_ID not set');
  if (CONFIG.USER_TOKEN === 'YOUR_USER_TOKEN') throw new Error('USER_TOKEN not set');
  resetClientTokenCache();
  const token = getClientToken();
  return `✅ PEAK connected. Token: ${token.substring(0, 20)}...`;
}

// ─── Setup Helper (รันครั้งเดียวจาก GAS editor) ───────────────────────────────

/**
 * ตั้ง shared API key สำหรับ Web App
 * ใช้งาน: เปิด Apps Script editor → ใส่ค่า apiKey → กด Run
 */
function setupWebAppApiKey(apiKey) {
  if (!apiKey) throw new Error('กรุณาใส่ apiKey');
  PropertiesService.getScriptProperties().setProperty(WEBAPP_API_KEY_PROP, apiKey);
  Logger.log(`✅ API Key saved`);
  return '✅ API Key saved — redeploy web app if already deployed';
}

function showWebAppApiKey() {
  const k = PropertiesService.getScriptProperties().getProperty(WEBAPP_API_KEY_PROP);
  Logger.log(k ? `API Key = "${k}"` : '(not set)');
  return k || '(not set)';
}
