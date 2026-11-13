/**
 * 資產管理系統後端入口。
 * 以存放帳號身分執行，開放所有人呼叫；權限在每個動作內檢查（Api.js）。
 * 前端一律用 POST，內容為 JSON：{ action, idToken?, payload? }。
 */

const APP_VERSION = '0.6.0';

function doGet() {
  return json_({ ok: true, app: '資產管理系統', version: APP_VERSION, time: new Date().toISOString() });
}

function doPost(e) {
  try {
    let req;
    try {
      req = JSON.parse(e.postData.contents);
    } catch (err) {
      throw new AppError('BAD_REQUEST', '無法解析請求內容');
    }
    return json_(handleRequest_(req));
  } catch (err) {
    if (!(err instanceof AppError)) console.error(err && err.stack || err);
    return json_(toErrorResponse(err));
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
