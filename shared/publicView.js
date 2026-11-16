/**
 * 公開資訊（純邏輯，前後端共用）：訪客掃 QR、可借設備清單看得到的欄位。
 * 只給：類型、編號、名稱、規格、可否借用、代表照片。
 * 不給：保管人、經管人、位置、價值、序號、請購案號、備註、借用人。
 */

if (typeof module !== 'undefined' && typeof ASSET_TYPES === 'undefined') {
  var ASSET_TYPES = require('./types.js').ASSET_TYPES;
  var typeFromQr = require('./types.js').typeFromQr;
  var assetStatus = require('./assetList.js').assetStatus;
  var isLendable = require('./assetList.js').isLendable;
  var assetName = require('./assetList.js').assetName;
  var assetKey = require('./assetList.js').assetKey;
  var qrKey = require('./assetList.js').qrKey;
  var compareItemCodes = require('./item.js').compareItemCodes;
}

/** 公開顯示的借用狀態：可借用／借出中／暫停借用（停借、報廢）／不開放借用。 */
function publicLoanStatus(row) {
  if (isLendable(row)) return '可借用';
  if ((row['開放借用'] || '否') !== '是') return '不開放借用';
  return assetStatus(row) === '借出' ? '借出中' : '暫停借用';
}

/** 公開顯示的編號：固定資產＝資產編號、保管品＝材料編號、系所物品＝系所編號（未編號為空字串）。 */
function publicCode(type, row) {
  if (type === 'CUSTODY') return String(row['材料編號'] || '');
  if (type === 'ITEM') return String(row['系所編號'] || '');
  return String(row['資產編號'] || '');
}

function publicSpec(type, row) {
  if (type === 'FIXED') return String(row['廠牌規格'] || '');
  if (type === 'ITEM') return String(row['規格'] || '');
  return '';
}

/** 把資料列轉成公開資訊物件；除了這些鍵不會帶出任何欄位。 */
function publicAsset(type, row) {
  return {
    type: type,
    label: ASSET_TYPES[type].label,
    key: assetKey(type, row),
    qr: ASSET_TYPES[type].qr + qrKey(type, row),
    code: publicCode(type, row),
    name: String(assetName(type, row) || ''),
    spec: publicSpec(type, row),
    loan: publicLoanStatus(row),
    lendable: isLendable(row),
  };
}

/** 代表照片：最新的有效建檔照片紀錄；沒有回傳 null。 */
function representativePhoto(photoRows) {
  const list = (photoRows || []).filter(function (p) {
    return p['用途'] === '建檔' && (!p['狀態'] || p['狀態'] === '有效');
  });
  list.sort(function (a, b) { return String(b['上傳時間'] || '').localeCompare(String(a['上傳時間'] || '')); });
  return list[0] || null;
}

/**
 * 掃到或輸入的文字轉成 { type, key }：
 * - 貼紙網址 https://…/?F0343360037、?C000123、?II000012（任何主機都接受，只看 ? 後面）
 * - 直接輸入：6 位數字＝保管品 QR碼；I＋6 位數字＝物品ID；前綴-數字（CB-001）＝系所編號；10 位數字＝資產編號
 * 看不懂回傳 null。
 */
function parseQrText(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const url = t.match(/\?([FCI])([^?#&\s]+)/i);
  if (url) {
    let key = url[2];
    try { key = decodeURIComponent(key); } catch (e) { /* 原樣使用 */ }
    const type = typeFromQr(url[1].toUpperCase());
    return type ? { type: type, key: key } : null;
  }
  if (/^\d{6}$/.test(t)) return { type: 'CUSTODY', key: t };
  if (/^I\d{6}$/i.test(t)) return { type: 'ITEM', key: t.toUpperCase() };
  if (/^[A-Z0-9]{1,10}-\d{1,6}$/i.test(t)) return { type: 'ITEM', key: t.toUpperCase() };
  if (/^\d{10}$/.test(t)) return { type: 'FIXED', key: t };
  return null;
}

/**
 * 可借設備清單：同名稱＋規格的物品合成一組（例：Chromebook 40 台），統計可借、借出、共幾件。
 * list：publicAsset() 物件（可附 photoId）。回傳依名稱排序的組，組內依系所編號排序。
 */
function groupPublicItems(list) {
  const groups = {};
  (list || []).forEach(function (a) {
    const k = a.name + '\n' + a.spec;
    const g = groups[k] || (groups[k] = { name: a.name, spec: a.spec, total: 0, lendable: 0, out: 0, photoId: '', items: [] });
    g.total++;
    if (a.lendable) g.lendable++;
    if (a.loan === '借出中') g.out++;
    if (!g.photoId && a.photoId) g.photoId = a.photoId;
    g.items.push({ code: a.code, loan: a.loan, key: a.key, qr: a.qr });
  });
  return Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, 'zh-Hant'); }).map(function (k) {
    groups[k].items.sort(function (a, b) { return compareItemCodes(a.code, b.code); });
    return groups[k];
  });
}

if (typeof module !== 'undefined') {
  module.exports = { publicLoanStatus, publicCode, publicSpec, publicAsset, representativePhoto, parseQrText, groupPublicItems };
}
