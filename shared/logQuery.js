/**
 * LOG 查詢（純邏輯，前後端共用）：Super 依人、日期、資產、動作篩選，可匯出 CSV。
 * LOG 每年一檔（LOG_<年>），查詢一次只看一年。
 */

var LOG_QUERY_LIMIT = 500;
var LOG_EXPORT_LIMIT = 20000;

/** 篩選條件整理：from／to 為 yyyy-mm-dd，其他去空白。 */
function cleanLogFilter(f) {
  const s = function (v) { return String(v == null ? '' : v).trim(); };
  const d = function (v) { const m = s(v).match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/); return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : ''; };
  const src = f || {};
  return { from: d(src.from), to: d(src.to), who: s(src.who).toLowerCase(), key: s(src.key).toLowerCase(), action: s(src.action), objectType: s(src.objectType), q: s(src.q).toLowerCase() };
}

/** 一筆 LOG 是否符合。who：Email 或姓名的一部分；key：對象鍵的一部分；q：任何欄位（含改前、改後、原因）。 */
function matchLog(row, filter) {
  const f = filter || {};
  const time = String(row['時間'] || '');
  if (f.from && time.slice(0, 10) < f.from) return false;
  if (f.to && time.slice(0, 10) > f.to) return false;
  if (f.action && row['動作'] !== f.action) return false;
  if (f.objectType && row['對象類型'] !== f.objectType) return false;
  if (f.who && (String(row['操作者Email'] || '') + ' ' + String(row['操作者姓名'] || '')).toLowerCase().indexOf(f.who) === -1) return false;
  if (f.key && String(row['對象鍵'] || '').toLowerCase().indexOf(f.key) === -1) return false;
  if (f.q) {
    const all = Object.keys(row).filter(function (k) { return k !== '_row'; }).map(function (k) { return row[k]; }).join(' ').toLowerCase();
    if (all.indexOf(f.q) === -1) return false;
  }
  return true;
}

/** 下拉選單用：動作、對象類型、操作者（依筆數多到少）。 */
function logFacets(rows) {
  const count = function (field) {
    const c = {};
    (rows || []).forEach(function (r) { const v = r[field]; if (v) c[v] = (c[v] || 0) + 1; });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a] || (a < b ? -1 : 1); });
  };
  const names = {};
  (rows || []).forEach(function (r) { if (r['操作者Email'] && r['操作者姓名']) names[r['操作者Email']] = r['操作者姓名']; });
  return {
    actions: count('動作'), objectTypes: count('對象類型'),
    actors: count('操作者Email').map(function (e) { return { email: e, name: names[e] || '' }; }),
  };
}

/** 篩選並排新到舊；回傳 { total, rows（最多 limit 筆） }。 */
function queryLogs(rows, filter, limit) {
  const f = cleanLogFilter(filter);
  const hit = (rows || []).filter(function (r) { return matchLog(r, f); });
  hit.reverse(); // LOG 依時間附加，倒過來就是新到舊
  return { total: hit.length, rows: hit.slice(0, limit || LOG_QUERY_LIMIT) };
}

/** CSV（含 BOM，Excel 開啟中文不亂碼）。 */
function logCsv(columns, rows) {
  const cell = function (v) {
    const t = String(v == null ? '' : v);
    // 開頭是 = + - @ 的加單引號，避免 Excel 當成公式
    const safe = /^[=+\-@]/.test(t) ? "'" + t : t;
    return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  };
  return '﻿' + [columns.map(cell).join(',')].concat((rows || []).map(function (r) {
    return columns.map(function (c) { return cell(r[c]); }).join(',');
  })).join('\r\n') + '\r\n';
}

if (typeof module !== 'undefined') {
  module.exports = { LOG_QUERY_LIMIT, LOG_EXPORT_LIMIT, cleanLogFilter, matchLog, logFacets, queryLogs, logCsv };
}
