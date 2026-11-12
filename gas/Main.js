/**
 * 資產管理系統後端入口。
 * 以一等管理者（存放帳號）身分執行，開放所有人呼叫；權限在每個動作內檢查。
 */

const APP_VERSION = '0.1.0';

function doGet() {
  return json_({ ok: true, app: '資產管理系統', version: APP_VERSION, time: new Date().toISOString() });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: { code: 'BAD_REQUEST', message: '無法解析請求內容' } });
  }
  switch (req.action) {
    case 'version':
      return json_({ ok: true, version: APP_VERSION });
    default:
      return json_({ ok: false, error: { code: 'UNKNOWN_ACTION', message: '未知的動作：' + req.action } });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
