/**
 * 資產清單：顯示、搜尋、篩選（純邏輯，前後端共用）。
 */

/**
 * 管理者可以在系統上直接改的欄位；其他欄位來自學校清冊（匯入）或由流程（借用、盤點、異常）更新。
 * 存放位置以學校清冊為準，只由匯入更新；實際位置不同時填目前位置。
 */
var ASSET_EDITABLE = ['目前位置', '開放借用', '經管人', '備註'];
var ASSET_OPEN_VALUES = ['是', '否'];

/** 產品序號空白或 N/A 時，以請購案號代替。回傳 { text, isPurchaseNo }。 */
function displaySerial(row) {
  const serial = String(row['產品序號'] || '').trim();
  if (serial && !/^(N\/?A|無|-)$/i.test(serial)) return { text: serial, isPurchaseNo: false };
  const purchase = String(row['請購案號'] || '').trim();
  return purchase ? { text: purchase, isPurchaseNo: true } : { text: '', isPurchaseNo: false };
}

/** 清單、QR 網址用的鍵：固定資產為資產編號（增值紀錄併在同一編號），保管品為保管品鍵。 */
function assetKey(type, row) {
  return type === 'FIXED' ? String(row['資產編號'] || '') : String(row['保管品鍵'] || '');
}

/** 實際位置：有填目前位置就用它，否則用清冊的存放位置。 */
function currentLocation(row) {
  return String(row['目前位置'] || '').trim() || String(row['存放位置'] || '');
}

function assetName(type, row) {
  return type === 'FIXED' ? row['資產名稱'] : row['品名規格'];
}

var ASSET_SEARCH_FIELDS = [
  '資產編號', '資產名稱', '廠牌規格', '產品序號', '請購案號', '存放位置', '目前位置', '保管人代號', '保管人姓名',
  '保管品鍵', '材料編號', '品名規格', '備註',
];

/**
 * 篩選。f：{ q, 狀態, 部門代號, 保管人代號, 存放位置, 經管人, 待確認 }；
 * 經管人：'' 不限、'me' 我經管的、'none' 未指定，其他值為 Email。
 * 固定資產的增值紀錄（增值次數不是 0）不另列，併在主紀錄。
 */
function filterAssets(type, rows, f, myEmail) {
  const filters = f || {};
  const words = String(filters.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const me = String(myEmail || '').toLowerCase();
  const mainCodes = {};
  if (type === 'FIXED') rows.forEach(function (r) { if (String(r['增值次數'] || '0') === '0') mainCodes[r['資產編號']] = true; });

  return rows.filter(function (r) {
    if (type === 'FIXED' && String(r['增值次數'] || '0') !== '0' && mainCodes[r['資產編號']]) return false;
    if (filters['狀態'] && r['狀態'] !== filters['狀態']) return false;
    if (filters['部門代號'] && r['部門代號'] !== filters['部門代號']) return false;
    if (filters['保管人代號'] && r['保管人代號'] !== filters['保管人代號']) return false;
    if (filters['存放位置'] && r['存放位置'] !== filters['存放位置']) return false;
    if (filters['待確認'] && r['來源狀態'] !== '待確認') return false;
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

/** 篩選選單用：某欄位出現過的值（排序、去空白）；保管人回傳 [{ value: 代號, label: 代號 姓名 }]。 */
function distinctValues(rows, field) {
  const seen = {};
  rows.forEach(function (r) {
    const v = r[field];
    if (v && !seen[v]) seen[v] = field === '保管人代號' ? (r['保管人姓名'] ? v + ' ' + r['保管人姓名'] : v) : v;
  });
  return Object.keys(seen).sort().map(function (v) { return { value: v, label: seen[v] }; });
}

if (typeof module !== 'undefined') {
  module.exports = {
    ASSET_EDITABLE, ASSET_OPEN_VALUES, displaySerial, assetKey, assetName, currentLocation, filterAssets, distinctValues,
  };
}
