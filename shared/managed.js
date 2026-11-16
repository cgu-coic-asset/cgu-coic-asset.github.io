/**
 * 「我經管的」總覽（純邏輯，前後端共用）：保管品帳面數量對實際（已編號、借出、最近點數）的差異。
 */

/**
 * 保管品摘要。stats：itemStatsByCustody 的一筆 { 件數, 借出, 在庫 }（可為空）。
 * 回傳 { book, numbered, out, inStock, counted（最近點數，沒點過為 null）, diff（點數－帳面）, issues（文字陣列） }。
 */
function custodySummary(row, stats) {
  const book = parseInt(row['帳面數量'], 10) || 0;
  const s = stats || {};
  const counted = /^\d+$/.test(String(row['最近盤點數量'] || '')) ? parseInt(row['最近盤點數量'], 10) : null;
  const out = { book: book, numbered: s['件數'] || 0, out: s['借出'] || 0, inStock: s['在庫'] || 0, counted: counted, diff: counted === null ? null : counted - book, issues: [] };
  if (counted !== null && counted !== book) out.issues.push('點數 ' + counted + '／帳面 ' + book);
  if (out.numbered > book) out.issues.push('已編號 ' + out.numbered + ' 件超過帳面 ' + book);
  return out;
}

if (typeof module !== 'undefined') module.exports = { custodySummary };
