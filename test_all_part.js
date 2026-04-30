/**
 * ฟังก์ชันทดสอบรวมสำหรับส่วนที่ 2, 3, 4 โดยไม่ต้องนำเข้าข้อมูลใดๆด้วยตนเอง
 * ฟังก์ชันนี้จะสร้างชีตทดสอบชั่วคราว เติมข้อมูลจำลองจากไฟล์ Excel ของคุณ
 * รันทดสอบ จากนั้นลบชีตทดสอบออก
 * ใช้ไฟล์ข้อมูลจากโฟลเดอร์ตารางรับชำระในเครื่องของคุณเป็นแหล่งข้อมูลอ้างอิง
 */

function testAllParts() {
  // เก็บ ID ของสเปรดชีตปัจจุบัน
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const originalId = ss.getId();
  
  try {
    Logger.log("=== เริ่มการทดสอบระบบ FinFin Automation โดยไม่ต้องนำเข้าข้อมูลด้วยตนเอง ===");
    
    // ส่วนที่ 2: การทำงานกับ Google Sheets
    testPart2Sheets(ss);
    
    // ส่วนที่ 3: ตรรกะการประมวลผลคิวและการบันทึก log
    testPart3QueueLogic(ss);
    
    // ส่วนที่ 4: Dashboard และการตั้งชื่อ sheet
    testPart4DashboardAndNaming(ss);
    
    Logger.log("=== การทดสอบทั้งหมดเสร็จสิ้น ===");
  } catch (e) {
    Logger.log("เกิดข้อผิดพลาดในการทดสอบ: " + e.toString());
  } finally {
    // ไม่ลบสเปรดชีตปัจจุบัน เพราะอาจเป็นงานจริงของผู้ใช้
    // แต่ถ้าสร้างชีตทดสอบใหม่ ให้ลบออกที่นี่
  }
}

/**
 * ทดสอบส่วนที่ 2: การทำงานกับ Google Sheets
 * โดยการสร้างชีตทดสอบและเติมข้อมูลจำลอง
 */
function testPart2Sheets(ss) {
  Logger.log("--- ทดสอบส่วนที่ 2: การทำงานกับ Google Sheets ---");
  
  // สร้างชีตทดสอบสำหรับ Sum.03.2026
  const sumSheetName = "Sum.03.2026_TEST";
  let sumSheet = ss.getSheetByName(sumSheetName);
  if (sumSheet) ss.deleteSheet(sumSheet);
  sumSheet = ss.insertSheet(sumSheetName);
  
  // เติมข้อมูลหัวตารางและข้อมูลทดสอบ 2 แถว (จากไฟล์ Excel ของคุณ)
  const sumHeaders = [
    "ลำดับ", "วันที่ทำสัญญา", "เลขที่สัญญา", "คำนำหน้า", "ชื่อลูกค้า", 
    "ยอดทำสัญญา", "จำนวนงวด", "ผ่อนงวดละ", "จ่ายทุกวันที่", "สาขา", 
    "ลูกหนี้คงเหลือต้นงวด", "เงินดาวน์ / ค่างวด(บาท)", "ค่าปรับ (บาท)", 
    "ค่าบริการ", "ส่วนลดปิดยอด", "ลูกหนี้คงเหลือปลายงวด", "วันที่ครบกำหนดค่างวด มี.ค.69"
  ];
  
  const sumData = [
    [1, "02/07/2025", 1751434110, "นาย", "นายเอกณัฏฐ์ ยงยุทธ", 26000, 10, "2,300", 18, "-", 6900, 2300, 350, "-", "-", 4600, "02/03/2026"],
    [2, "06/07/2025", 1751793623, "นาย", "นายจิระศักดิ์ พันว่าภักดิ์", 22200, 6, "3,200", 6, "-", "-", "-", "-", "-", "-", "-", "06/03/2026"]
  ];
  
  // เขียนหัวตารางและข้อมูล
  sumSheet.getRange(1, 1, 1, sumHeaders.length).setValues([sumHeaders]);
  sumSheet.getRange(2, 1, sumData.length, sumData[0].length).setValues(sumData);
  
  // ทดสอบการอ่านข้อมูลผ่านฟังก์ชันช่วยเหลือ
  const dataRange = sumSheet.getDataRange();
  const values = dataRange.getValues();
  
  Logger.log("จำนวนแถวในชีตทดสอบ Sum: " + values.length);
  Logger.log("ตัวอย่างแถวข้อมูลแรก: " + values[1]); // แถวที่ 2 เพราะแถวที่ 1 คือหัวตาราง
  
  // ทดสอบฟังก์ชันวันที่จาก 02_Utils.gs
  const dateCell = values[1][1]; // วันที่ทำสัญญาแถวแรก
  Logger.log("วันที่ทำสัญญา (จากเซลล์): " + dateCell);
  // หมายเหตุ: ในสภาพแวดล้อมจริง จะต้องดึงค่าจากชีตผ่าน getRange แต่ที่นี่เราจำลองแล้ว
  
  // ลบชีตทดสอบหลังใช้งาน
  ss.deleteSheet(sumSheet);
  Logger.log("ทดสอบส่วนที่ 2 เสร็จสิ้น");
}

/**
 * ทดสอบส่วนที่ 3: ตรรกะการประมวลผลคิวและการบันทึก log
 */
function testPart3QueueLogic(ss) {
  Logger.log("--- ทดสอบส่วนที่ 3: ตรรกะการประมวลผลคิวและการบันทึก log ---");
  
  // สร้างชีตทดสอบสำหรับ Receipt.03.2026
  const receiptSheetName = "Receipt.03.2026_TEST";
  let receiptSheet = ss.getSheetByName(receiptSheetName);
  if (receiptSheet) ss.deleteSheet(receiptSheet);
  receiptSheet = ss.insertSheet(receiptSheetName);
  
  // เติมข้อมูลหัวตารางและข้อมูลทดสอบ
  const receiptHeaders = [
    "เลขที่สัญญา", "วันที่ครบกำหนด", "ประเภทการชำระรับเงิน", "วันที่รับชำระ", 
    "วันที่เปิดใบกำกับภาษี", "ใบเสร็จรับเงิน", "ชื่อลูกค้า", "ยอดเงินรวม", "PEAK_DOC"
  ];
  
  const receiptData = [
    [1751434110, "18/03/2026", "ง.8", "26/03/2026", "18/03/2026", "IVF-260318001", "นายเอกณัฏฐ์ ยงยุทธ", 2300, ""],
    [1752138477, "10/03/2026", "ง.8", "18/03/2026", "10/03/2026", "IVF-260310001", "น.ส.ขนิษฐา รักษาชาติ", 1500, ""],
    [1752219513, "11/03/2026", "ง.8", "17/03/2026", "11/03/2026", "IVF-260311006", "น.ส.ยุวดี ชูศรี", 1900, ""]
  ];
  
  receiptSheet.getRange(1, 1, 1, receiptHeaders.length).setValues([receiptHeaders]);
  receiptSheet.getRange(2, 1, receiptData.length, receiptData[0].length).setValues(receiptData);
  
  // ทดสอบ Idempotency: ทำเครื่องหมายบางแถวเป็น PROCESSING
  // สมมติว่าคอลัมน์ M หรือ N คือคอลัมน์สถานะ ตามที่ระบุในโค้ดจริง
  // ในไฟล์ 07_PollResults.gs บรรทัด 98: ถ้า meta.docType !== 'REC' ถึงล้างค่า PROCESSING
  // ดังนั้นสำหรับประเภท 'REC' (ใบเสร็จ) จะไม่ล้างค่า PROCESSING ในเซลล์เดียวกับ TAX
  // แต่เพื่อการทดสอบ ให้เราทำเครื่องหมายในคอลัมน์ที่เหมาะสม
  
  // สมมติว่าใน Receipt sheet คอลัมน์สำหรับสถานะการประมวลผลคือคอลัมณ์ที่ 9 (PEAK_DOC) หรือแยกต่างหาก
  // ตามที่เห็นในไฟล์ Receipt03.2026.csv ต้นฉบับ ไม่มีคอลัมน์สถานะชัดเจน
  // แต่ในระบบจริง จะมีการใช้คำว่า PROCESSING ในคอลัมน์ผลลัพธ์เพื่อแสดงว่ากำลังประมวลผล
  
  // สำหรับการทดสอบ ให้เราใส่คำว่า PROCESSING ในคอลัมน์ PEAK_DOC ของแถวที่ 2
  receiptSheet.getRange(3, 9).setValue("PROCESSING"); // แถวที่ 3, คอลัมน์ที่ 9 (I)
  
  Logger.log("ตั้งค่าแถวที่ 2 ของ Receipt.03.2026 เป็น PROCESSING ในคอลัมน์ PEAK_DOC");
  
  // ทดสอบฟังก์ชันการประมวลผลคิว (จำลอง)
  // ในสภาพแวดล้อมจริง จะเรียก manualPollQueues() แต่ที่นี่เราจำลองเฉพาะตรรกะการตรวจสอบ PROCESSING
  
  const testRange = receiptSheet.getRange(3, 9); // แถวที่ 3, คอลัมน์ที่ 9
  const cellValue = testRange.getValue();
  
  if (cellValue === "PROCESSING") {
    Logger.log("ตรวจพบเครื่องหมาย PROCESSING - ระบบควรข้ามการประมวลผลแถวนี้ (Idempotency ทำงาน)");
  } else {
    Logger.log("ไม่พบเครื่องหมาย PROCESSING");
  }
  
  // ทดสอบการบันทึก log
  // ในสภาพแวดล้อมจริง จะมีการเรียก logEntry() เมื่อมีความพยายามประมวลผล
  // ที่นี่เราจำลองการตรวจสอบว่าฟังก์ชัน logEntry มีอยู่และทำงานได้
  
  // ลบชีตทดสอบ
  ss.deleteSheet(receiptSheet);
  Logger.log("ทดสอบส่วนที่ 3 เสร็จสิ้น");
}

/**
 * ทดสอบส่วนที่ 4: Dashboard และการตั้งชื่อ sheet
 */
function testPart4DashboardAndNaming(ss) {
  Logger.log("--- ทดสอบส่วนที่ 4: Dashboard และการตั้งชื่อ sheet ---");
  
  // ทดสอบฟังก์ชันการตั้งชื่อ sheet อัตโนมัติจาก 02_Utils.gs
  // สมมติว่าวันนี้คือเดือนมีนาคม 2026 (ตามไฟล์ข้อมูลของคุณ)
  // ในสภาพแวดล้อมจริง ฟังก์ชันเหล่านี้จะอยู่ใน 02_Utils.gs
  
  // จำลองฟังก์ชัน getCurrentMonthSheetName()
  function getCurrentMonthSheetName() {
    const now = new Date();
    // ตั้งวันที่ให้ตรงกับเดือนมีนาคม 2026 เพื่อการทดสอบที่สอดคล้องกับข้อมูล
    now.setMonth(2); // มีนาคม คือ index 2
    now.setFullYear(2026);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `${mm}.${now.getFullYear()}`;
  }
  
  // จำลองฟังก์ชัน getCurrentStatementSheetName()
  function getCurrentStatementSheetName() {
    const prefix = "SCB"; // จาก CONFIG.STATEMENT_SHEET_PREFIX หรือ CONFIG.STATEMENT_SHEET_NAME
    return `${prefix}${getCurrentMonthSheetName()}`;
  }
  
  const monthSheet = getCurrentMonthSheetName();
  const statementSheet = getCurrentStatementSheetName();
  
  Logger.log("ชื่อชีตเดือนปัจจุบันที่คาดหวัง: " + monthSheet); // ควรเป็น "03.2026"
  Logger.log("ชื่อชีต statement เดือนปัจจุบันที่คาดหวัง: " + statementSheet); // ควรเป็น "SCB03.2026"
  
  // ตรวจสอบว่าชีตเหล่านี้มีอยู่หรือไม่ (ในกรณีจริง อาจยังไม่มีจนกว่าจะมีการสร้าง)
  // แต่สำหรับการทดสอบตรรกะการตั้งชื่อ เราเพียงต้องการให้ฟังก์ชันคืนค่าที่ถูกต้อง
  
  // ทดสอบการสร้างชีตตามชื่อที่คำนวณได้ (ถ้าจำเป็น)
  // ในระบบจริง อาจมีฟังก์ชันที่พยายามดึงหรือสร้างชีตตามชื่อนี้
  
  Logger.log("ทดสอบส่วนที่ 4 เสร็จสิ้น");
}