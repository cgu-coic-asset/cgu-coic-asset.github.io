/**
 * 「我名下的財產」：依帳號綁定的保管人代號，列出固定資產與保管品（跨部門）。
 * 只回傳自己名下的資料，並拿掉內部欄位（建立者、修改者的 Email）。
 */

const MY_HIDDEN_FIELDS = ['建立者', '修改者', '最後匯入批次', '版本'];

function myAssets_(payload, actor) {
  const codes = actor.codes || [];
  const managers = {};
  activeManagers_().forEach(function (m) { managers[m.email] = m.name || m.email; });
  const pick = function (t) {
    if (!codes.length) return [];
    return readRows_(sheet_(t.book, t.sheet))
      .filter(function (r) { return codes.indexOf(String(r['保管人代號'] || '').toUpperCase()) !== -1; })
      .map(function (r) {
        const o = publicRow_(r);
        MY_HIDDEN_FIELDS.forEach(function (k) { delete o[k]; });
        o['經管人'] = managers[normalizeEmail(r['經管人'])] || '';
        return o;
      });
  };
  return { codes: codes, FIXED: pick(IMPORT_TARGETS.FIXED), CUSTODY: pick(IMPORT_TARGETS.CUSTODY) };
}
