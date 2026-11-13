/**
 * 資產清單：顯示、搜尋、篩選（純邏輯，前後端共用）。
 */

if (typeof module !== 'undefined' && typeof ASSET_TYPES === 'undefined') {
  var ASSET_TYPES = require('./types.js').ASSET_TYPES;
}

/**
 * 管理者可以在系統上直接改的欄位；其他欄位來自學校清冊（匯入）或由流程（借用、盤點、異常）更新。
 * 存放位置以學校清冊為準，只由匯入更新；實際位置不同時填目前位置。
 */
var ASSET_EDITABLE = ['名稱修正', '目前位置', '開放借用', '經管人', '備註'];
/** 系所物品是系所自建的，名稱、規格、系所編號也能改。 */
var ITEM_EDITABLE = ['系所編號', '名稱', '規格', '目前位置', '開放借用', '經管人', '備註'];

function editableFields(type) {
  return type === 'ITEM' ? ITEM_EDITABLE : ASSET_EDITABLE;
}
var ASSET_OPEN_VALUES = ['是', '否'];
/** 可以在清單勾選多筆一次修改的欄位（Admin、Super）。目前位置空白＝回到清冊位置。 */
var ASSET_BATCH_FIELDS = ['目前位置', '經管人', '開放借用'];

/**
 * 狀態：在庫、借出、停借、報廢（由借還、異常流程改變）。
 * 舊資料匯入時寫的是「可借」，視為在庫。「能不能借」另看開放借用。
 */
function assetStatus(row) {
  const v = String(row['狀態'] || '').trim();
  return !v || v === '可借' ? '在庫' : v;
}

/** 現在可以外借：開放借用為「是」且在庫。 */
function isLendable(row) {
  return row['開放借用'] === '是' && assetStatus(row) === '在庫';
}

/** 實際位置和清冊不同（有填目前位置且不一樣）。 */
function isMoved(row) {
  const now = String(row['目前位置'] || '').trim();
  return !!now && now !== String(row['存放位置'] || '').trim();
}

/** 產品序號空白或 N/A 時，以請購案號代替。回傳 { text, isPurchaseNo }。 */
function displaySerial(row) {
  const serial = String(row['產品序號'] || '').trim();
  if (serial && !/^(N\/?A|無|-)$/i.test(serial)) return { text: serial, isPurchaseNo: false };
  const purchase = String(row['請購案號'] || '').trim();
  return purchase ? { text: purchase, isPurchaseNo: true } : { text: '', isPurchaseNo: false };
}

/** 清單、QR 網址用的鍵：固定資產為資產編號（增值紀錄併在同一編號），保管品為保管品鍵，系所物品為物品ID。 */
function assetKey(type, row) {
  return String(row[ASSET_TYPES[type].keyField] || '');
}

/** 實際位置：有填目前位置就用它，否則用清冊的存放位置。 */
function currentLocation(row) {
  return String(row['目前位置'] || '').trim() || String(row['存放位置'] || '');
}

/** 顯示用名稱：有名稱修正就用它（學校清冊缺字時自己修），否則用原名稱。 */
function assetName(type, row) {
  return (type !== 'ITEM' && String(row['名稱修正'] || '').trim()) || row[ASSET_TYPES[type].nameField];
}

/** 學校清冊上的原名稱。 */
function sourceName(type, row) {
  return row[ASSET_TYPES[type].nameField];
}

/**
 * 名稱取代：從目前顯示的名稱把 find 換成 replace，回傳新的名稱修正值；
 * 結果和清冊原名稱相同時回傳空白（不需要修正）；找不到 find 回傳 null（不改）。
 */
function replaceNameFix(type, row, find, replace) {
  const current = assetName(type, row) || '';
  if (!find || current.indexOf(find) === -1) return null;
  const next = current.split(find).join(replace || '');
  return next === sourceName(type, row) ? '' : next;
}

var ASSET_SEARCH_FIELDS = [
  '資產編號', '資產名稱', '廠牌規格', '產品序號', '請購案號', '存放位置', '目前位置', '保管人代號', '保管人姓名',
  '保管品鍵', '材料編號', '品名規格', '備註', '物品ID', '系所編號', '名稱', '規格', '名稱修正',
];

/**
 * 篩選。f：{ q, 狀態, 部門代號, 保管人代號, 位置（實際位置）, 已移位, 開放借用, 經管人, 待確認, 建檔照片（有／缺） }；
 * counts：photoCounts() 的結果（篩建檔照片時需要）。
 * 經管人：'' 不限、'me' 我經管的、'none' 未指定，其他值為 Email。
 * 固定資產的增值紀錄（增值次數不是 0）不另列，併在主紀錄。
 */
function filterAssets(type, rows, f, myEmail, counts) {
  const filters = f || {};
  const words = String(filters.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const me = String(myEmail || '').toLowerCase();
  const mainCodes = {};
  if (type === 'FIXED') rows.forEach(function (r) { if (String(r['增值次數'] || '0') === '0') mainCodes[r['資產編號']] = true; });

  return rows.filter(function (r) {
    if (type === 'FIXED' && String(r['增值次數'] || '0') !== '0' && mainCodes[r['資產編號']]) return false;
    if (filters['狀態'] && assetStatus(r) !== filters['狀態']) return false;
    if (filters['開放借用'] === '可借' && !isLendable(r)) return false;
    if (filters['開放借用'] && filters['開放借用'] !== '可借' && (r['開放借用'] || '否') !== filters['開放借用']) return false;
    if (filters['部門代號'] && r['部門代號'] !== filters['部門代號']) return false;
    if (filters['保管人代號'] && r['保管人代號'] !== filters['保管人代號']) return false;
    if (filters['位置'] && currentLocation(r) !== filters['位置']) return false;
    if (filters['已移位'] && !isMoved(r)) return false;
    if (filters['待確認'] && r['來源狀態'] !== '待確認') return false;
    if (filters['建檔照片']) {
      const c = (counts || {})[type + ':' + assetKey(type, r)];
      const has = !!(c && c['建檔']);
      if ((filters['建檔照片'] === '有') !== has) return false;
    }
    const mgr = String(r['經管人'] || '').toLowerCase();
    if (filters['經管人'] === 'me' && (!me || mgr !== me)) return false;
    if (filters['經管人'] === 'none' && mgr) return false;
    if (filters['經管人'] && ['me', 'none'].indexOf(filters['經管人']) === -1 && mgr !== String(filters['經管人']).toLowerCase()) return false;
    if (words.length) {
      const text = ASSET_SEARCH_FIELDS.map(function (k) { return r[k] || ''; }).join(' ').toLowerCase();
      if (!words.every(function (w) { return text.indexOf(w) !== -1; })) return false;
    }
    return true;
  });
}

/**
 * 篩選選單用：某欄位出現過的值（排序、去空白）；保管人回傳 [{ value: 代號, label: 代號 姓名 }]。
 * field 為「位置」時取實際位置，「狀態」時取整理後的狀態。
 */
function distinctValues(rows, field) {
  const seen = {};
  rows.forEach(function (r) {
    const v = field === '位置' ? currentLocation(r) : field === '狀態' ? assetStatus(r) : r[field];
    if (v && !seen[v]) seen[v] = field === '保管人代號' ? (r['保管人姓名'] ? v + ' ' + r['保管人姓名'] : v) : v;
  });
  return Object.keys(seen).sort().map(function (v) { return { value: v, label: seen[v] }; });
}

if (typeof module !== 'undefined') {
  module.exports = {
    ASSET_EDITABLE, ITEM_EDITABLE, editableFields, ASSET_OPEN_VALUES, ASSET_BATCH_FIELDS, assetStatus, isLendable, isMoved, displaySerial, assetKey,
    assetName, sourceName, replaceNameFix, currentLocation, filterAssets, distinctValues,
  };
}
