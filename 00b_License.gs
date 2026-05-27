/**
 * FinFin Automation — License System
 * ════════════════════════════════════
 * Logic: fail-open (ถ้าติดต่อ server ไม่ได้ → ให้ผ่าน)
 *
 * ══ Developer Setup (ครั้งแรก) ════════════════════════════════
 * รัน finfin_setLicenseConfig() จาก Apps Script Editor เพื่อตั้งค่า
 * จากนั้น checkLicense_() จะถูกเรียกอัตโนมัติใน preFlightChecks_()
 *
 * ══ License States ════════════════════════════════════════════
 * permanent → cached local → ไม่ fetch อีก (เร็ว)
 * trial     → fetch ทุกครั้ง → แสดง daysLeft ใน toast
 * expired   → throw error → ทุก Part หยุด
 * no config → dev mode → ผ่านทั้งหมด
 * unreachable → fail-open → ผ่าน
 */

// ─── Script Property Keys ─────────────────────────────────────────────────────
var FINFIN_LIC_PROP_ = {
  PERMANENT:  'FINFIN_LIC_PERMANENT',   // 'true' เมื่อ server ยืนยัน permanent
  SERVER_URL: 'FINFIN_LIC_SERVER_URL',  // URL ของ License Server Web App
  CLIENT_KEY: 'FINFIN_LIC_CLIENT_KEY',  // Client key ของ deployment นี้
};

// ─── Defaults (ใส่ค่าจริงก่อนส่งให้ลูกค้า) ──────────────────────────────────
var _FINFIN_LIC_SERVER_URL_DEFAULT_ = 'https://script.google.com/macros/s/AKfycbwbgespJfgkIfXa4pXgJSC1NsEgwAH0sXpVOVgiPFBNGsITklk5dPN0MnP3SMMgzgRUyQ/exec';
var _FINFIN_LIC_CLIENT_KEY_DEFAULT_ = 'MTECH_FINFIN_001';

// ─── Core: ตรวจ License (เรียกจาก preFlightChecks_) ────────────────────────────
/**
 * checkLicense_() — ตรวจ license ก่อนรันทุก Part
 *   1. local permanent cache → pass (ไม่ fetch)
 *   2. ไม่มี config → dev mode → pass
 *   3. fetch server:
 *        permanent → cache → pass
 *        trial     → toast แจ้งวันเหลือ → pass
 *        expired   → throw error (หยุดทุก Part)
 *        unreachable → fail-open → pass
 */
function checkLicense_() {
  try {
    var props = PropertiesService.getScriptProperties();

    // 1. permanent local cache — ไม่ต้อง fetch
    if (props.getProperty(FINFIN_LIC_PROP_.PERMANENT) === 'true') return;

    // 2. ไม่มี config → dev mode
    var serverUrl = props.getProperty(FINFIN_LIC_PROP_.SERVER_URL);
    var clientKey = props.getProperty(FINFIN_LIC_PROP_.CLIENT_KEY);
    if (!serverUrl || !clientKey) {
      Logger.log('License: no config — dev mode (pass-through)');
      return;
    }

    // 3. fetch server
    var res = _fetchLicenseServer_(serverUrl, clientKey);
    if (!res) {
      Logger.log('License: server unreachable — fail-open');
      return;
    }
    if (!res.ok) {
      throw new Error('🔒 License หมดอายุ — กรุณาต่ออายุการใช้งาน (' + (res.reason || 'expired') + ')');
    }
    if (res.permanent) {
      props.setProperty(FINFIN_LIC_PROP_.PERMANENT, 'true');
      Logger.log('License: PERMANENT confirmed — cached locally');
      return;
    }
    // trial — แจ้งวันเหลือ
    if (res.daysLeft !== undefined) {
      var msg = '⏳ License เหลืออีก ' + res.daysLeft + ' วัน';
      Logger.log('License: ' + msg);
      toast(msg, 'FinFin', 8);
    }

  } catch (e) {
    // ถ้า error มาจากเราเอง (expired) → re-throw
    if (e.message && e.message.indexOf('🔒') === 0) throw e;
    // server error อื่นๆ → fail-open
    Logger.log('checkLicense_ error (fail-open): ' + e.message);
  }
}

// ─── Helper: fetch license server ─────────────────────────────────────────────
function _fetchLicenseServer_(serverUrl, clientKey) {
  try {
    var res = UrlFetchApp.fetch(
      serverUrl + '?key=' + encodeURIComponent(clientKey) + '&t=' + Date.now(),
      { muteHttpExceptions: true, followRedirects: true }
    );
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText());
  } catch (e) {
    Logger.log('_fetchLicenseServer_ error: ' + e.message);
    return null;
  }
}

// ─── Developer Functions ───────────────────────────────────────────────────────

/**
 * finfin_setLicenseConfig — ตั้งค่า License ครั้งแรก (Developer only)
 * รันจาก Apps Script Editor
 * ถ้าไม่ใส่ arguments → ใช้ default values ที่กำหนดไว้ด้านบน
 */
function finfin_setLicenseConfig(serverUrl, clientKey) {
  serverUrl = serverUrl || _FINFIN_LIC_SERVER_URL_DEFAULT_;
  clientKey = clientKey || _FINFIN_LIC_CLIENT_KEY_DEFAULT_;
  var props = PropertiesService.getScriptProperties();
  props.setProperty(FINFIN_LIC_PROP_.SERVER_URL, serverUrl);
  props.setProperty(FINFIN_LIC_PROP_.CLIENT_KEY, clientKey);
  props.deleteProperty(FINFIN_LIC_PROP_.PERMANENT); // bust cache
  Logger.log('finfin_setLicenseConfig ✅  KEY=' + clientKey);
  // ทดสอบทันที
  finfin_getLicenseStatus();
}

/**
 * finfin_getLicenseStatus — ดูสถานะ License ปัจจุบัน (Developer only)
 */
function finfin_getLicenseStatus() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(FINFIN_LIC_PROP_.PERMANENT) === 'true') {
    Logger.log('✅ License: PERMANENT (local cache)');
    return;
  }
  var serverUrl = props.getProperty(FINFIN_LIC_PROP_.SERVER_URL);
  var clientKey = props.getProperty(FINFIN_LIC_PROP_.CLIENT_KEY);
  if (!serverUrl || !clientKey) {
    Logger.log('⚠️  License: ไม่มี config — dev mode (pass-through)');
    return;
  }
  var res = _fetchLicenseServer_(serverUrl, clientKey);
  if (!res) { Logger.log('⚠️  License: server unreachable'); return; }
  if (res.ok && res.permanent) { Logger.log('✅ License: PERMANENT (server)'); return; }
  if (res.ok)  { Logger.log('⏳ License: TRIAL — เหลือ ' + (res.daysLeft || '?') + ' วัน'); return; }
  Logger.log('🚫 License: ' + (res.reason || 'expired'));
}

/**
 * finfin_resetLicenseCache — bust permanent cache (force re-fetch)
 */
function finfin_resetLicenseCache() {
  PropertiesService.getScriptProperties().deleteProperty(FINFIN_LIC_PROP_.PERMANENT);
  Logger.log('finfin_resetLicenseCache: done — จะ fetch server ครั้งถัดไป');
}
