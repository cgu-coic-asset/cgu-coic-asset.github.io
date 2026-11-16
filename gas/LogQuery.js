/**
 * LOG 查詢（M3-03，Super）：一次查一年（LOG_<年>），篩選規則見 shared/logQuery.js。
 */

/** 有 LOG 的年份（新到舊）。 */
function logYears_() {
  const keys = PropertiesService.getScriptProperties().getKeys();
  return keys.map(function (k) { const m = k.match(/^SHEET_LOG_(\d{4})$/); return m ? m[1] : ''; })
    .filter(Boolean).sort().reverse();
}

/**
 * payload：{ year（預設今年）, filter, export（true 時回傳最多 LOG_EXPORT_LIMIT 筆供匯出） }。
 * 回傳 { years, year, columns, facets, total, rows }。
 */
function logQuery_(payload) {
  const years = logYears_();
  const year = String(payload.year || Utilities.formatDate(new Date(), TZ, 'yyyy'));
  if (years.indexOf(year) === -1) return { years: years, year: year, columns: LOG_COLUMNS, facets: logFacets([]), total: 0, rows: [] };
  const all = readRows_(sheet_('LOG_' + year, 'LOG')).map(function (r) { delete r._row; return r; });
  const result = queryLogs(all, payload.filter, payload.export ? LOG_EXPORT_LIMIT : LOG_QUERY_LIMIT);
  // 匯入等大量變更的改前、改後很長，回傳時截斷避免超過回應大小上限（試算表內仍是完整的）
  const max = payload.export ? 5000 : 800;
  result.rows.forEach(function (r) {
    ['改前', '改後'].forEach(function (k) { if (String(r[k]).length > max) r[k] = String(r[k]).slice(0, max) + '…（截斷）'; });
  });
  return { years: years, year: year, columns: LOG_COLUMNS, facets: logFacets(all), total: result.total, rows: result.rows };
}
