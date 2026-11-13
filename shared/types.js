/**
 * 三套資料的共同設定（純資料，前後端共用）。
 * qr：QR 網址 ?<字母><鍵>；keyField：唯一鍵欄位；nameField：名稱欄位；photoFolder：照片/ 下的資料夾。
 */
var ASSET_TYPES = {
  FIXED: { label: '固定資產', qr: 'F', keyField: '資產編號', nameField: '資產名稱', photoFolder: '固定資產' },
  CUSTODY: { label: '保管品', qr: 'C', keyField: '保管品鍵', nameField: '品名規格', photoFolder: '保管品' },
  ITEM: { label: '系所物品', qr: 'I', keyField: '物品ID', nameField: '名稱', photoFolder: '系所物品' },
};

/** QR 字母轉類型（F→FIXED）；不認得回傳空字串。 */
function typeFromQr(letter) {
  const found = Object.keys(ASSET_TYPES).find(function (t) { return ASSET_TYPES[t].qr === letter; });
  return found || '';
}

if (typeof module !== 'undefined') {
  module.exports = { ASSET_TYPES, typeFromQr };
}
