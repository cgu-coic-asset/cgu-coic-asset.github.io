/**
 * 系所物品（可借用物品）的編號規則（純邏輯，前後端共用）。
 * - 物品ID：系統給的內部編號（I000001），QR 網址用，永遠不變。
 * - 系所編號：貼紙與借用單上看到的號碼，格式「前綴-三位數」（COIC-001、NX2-008），不可重複。
 */

var ITEM_CODE_DIGITS = 3;
var ITEM_PREFIX_RE = /^[A-Z0-9]{1,10}$/;

function pad_(n, width) {
  const s = String(n);
  return s.length >= width ? s : ('0000000000' + s).slice(-width);
}

/** 前綴轉大寫、去空白；不合格（只能英數字、1～10 字）回傳 null。 */
function normalizeItemPrefix(text) {
  const p = String(text || '').trim().toUpperCase();
  return ITEM_PREFIX_RE.test(p) ? p : null;
}

/**
 * 系所編號整理成「前綴-三位數」：接受 NX2-8、NX2 #8、nx2-008、COIC 12。
 * 空白回傳 ''；看不懂回傳 null。
 */
function normalizeItemCode(text) {
  const t = String(text || '').trim().toUpperCase();
  if (!t) return '';
  const m = t.match(/^([A-Z0-9]{1,10})\s*(?:-|#|\s)\s*#?\s*(\d{1,6})$/);
  if (!m) return null;
  return m[1] + '-' + pad_(parseInt(m[2], 10), ITEM_CODE_DIGITS);
}

/** 拆成 { prefix, num }；格式不對回傳 null。 */
function itemCodeParts(code) {
  const m = String(code || '').match(/^([A-Z0-9]{1,10})-(\d+)$/);
  return m ? { prefix: m[1], num: parseInt(m[2], 10) } : null;
}

/** 某前綴接下來的 count 個編號：從已用過的最大號＋1 開始。 */
function nextItemCodes(existingCodes, prefix, count) {
  let max = 0;
  (existingCodes || []).forEach(function (c) {
    const p = itemCodeParts(c);
    if (p && p.prefix === prefix && p.num > max) max = p.num;
  });
  const out = [];
  for (let i = 1; i <= count; i++) out.push(prefix + '-' + pad_(max + i, ITEM_CODE_DIGITS));
  return out;
}

/** 下一個物品ID（I＋6 位數），接續最大值。 */
function nextItemId(existingIds) {
  let max = 0;
  (existingIds || []).forEach(function (id) {
    const m = String(id || '').match(/^I(\d+)$/);
    if (m && parseInt(m[1], 10) > max) max = parseInt(m[1], 10);
  });
  return 'I' + pad_(max + 1, 6);
}

/** 依系所編號排序用：前綴字母順序，再依號碼大小；沒有編號的排最後。 */
function compareItemCodes(a, b) {
  const pa = itemCodeParts(a);
  const pb = itemCodeParts(b);
  if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
  return pa.prefix < pb.prefix ? -1 : pa.prefix > pb.prefix ? 1 : pa.num - pb.num;
}

if (typeof module !== 'undefined') {
  module.exports = {
    ITEM_CODE_DIGITS, normalizeItemPrefix, normalizeItemCode, itemCodeParts, nextItemCodes, nextItemId, compareItemCodes,
  };
}
