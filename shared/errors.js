/**
 * 統一錯誤代碼與中文訊息。前後端共用：後端丟出，前端依代碼顯示。
 */

var ERROR_MESSAGES = {
  BAD_REQUEST: '請求內容有誤',
  UNKNOWN_ACTION: '未知的動作',
  UNAUTHENTICATED: '請先登入',
  FORBIDDEN: '您沒有權限執行這個動作',
  NOT_FOUND: '找不到這筆資料',
  DUPLICATE: '資料已存在',
  VERSION_CONFLICT: '這筆資料剛被其他人修改過，請重新整理後再改',
  LOCK_TIMEOUT: '系統忙碌中，請稍後再試',
  NOT_CONFIGURED: '系統尚未完成設定',
  INTERNAL: '系統發生錯誤',
};

function AppError(code, message, detail) {
  this.name = 'AppError';
  this.code = code;
  this.message = message || ERROR_MESSAGES[code] || code;
  this.detail = detail;
}
AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;

/** 轉成回傳給前端的錯誤物件；非 AppError 一律視為 INTERNAL，不外洩內部訊息。 */
function toErrorResponse(err) {
  if (err instanceof AppError) {
    const e = { code: err.code, message: err.message };
    if (err.detail !== undefined) e.detail = err.detail;
    return { ok: false, error: e };
  }
  return { ok: false, error: { code: 'INTERNAL', message: ERROR_MESSAGES.INTERNAL } };
}

if (typeof module !== 'undefined') module.exports = { ERROR_MESSAGES, AppError, toErrorResponse };
