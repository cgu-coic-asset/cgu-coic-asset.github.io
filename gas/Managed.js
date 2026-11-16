/**
 * 「我經管的」總覽（Admin、Super）：經管人是自己的系所物品、保管品、固定資產。
 * 系所物品：連結的保管品經管人是自己的也算。附借用狀況（借用人、借出日、預計歸還、逾期、上次歸還）。
 */
function managedOverview_(payload, actor) {
  const me = actor.email;
  const mine = function (r) { return normalizeEmail(r['經管人']) === me; };
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const custodyRows = readRows_(sheet_('CUSTODY', '保管品'));
  const myCustody = {};
  custodyRows.forEach(function (c) { if (mine(c)) myCustody[c['保管品鍵']] = true; });

  const loans = {};
  readRows_(loanSheet_()).forEach(function (l) { loans[l['借用單號']] = l; });
  const current = {};
  const lastReturn = {};
  readRows_(loanDetailSheet_()).forEach(function (d) {
    const l = loans[d['借用單號']];
    if (!l) return;
    if (d['狀態'] === DETAIL_OUT && l['狀態'] === LOAN_OUT) {
      current[d['資產鍵']] = { id: l['借用單號'], name: l['借用人姓名'], phone: l['手機'], out: String(d['借出時間']).slice(0, 10),
        due: l['預計歸還日'], overdue: isLoanOverdue(l, today) };
    }
    if (d['狀態'] === DETAIL_RETURNED && String(d['歸還時間']) > String(lastReturn[d['資產鍵']] || '')) lastReturn[d['資產鍵']] = d['歸還時間'];
  });

  const items = joinItemsWithCustody_(readRows_(itemSheet_()).filter(function (r) {
    return assetStatus(r) !== '報廢' && (mine(r) || (r['保管品鍵'] && myCustody[r['保管品鍵']]));
  }).map(publicRow_)).map(function (r) {
    return Object.assign(r, { loan: current[r['物品ID']] || null, lastReturn: String(lastReturn[r['物品ID']] || '').slice(0, 10) });
  });

  const stats = itemStatsByCustody_();
  const custody = custodyRows.filter(mine).map(function (c) {
    const o = publicRow_(c);
    o.summary = custodySummary(c, stats[c['保管品鍵']]);
    return o;
  });

  const openRecords = {};
  readRows_(recordSheet_()).forEach(function (r) { if (r['狀態'] === FR_OPEN) openRecords[r['資產編號']] = r; });
  const fixed = readRows_(sheet_('FIXED', '資產')).filter(function (f) { return mine(f) && String(f['增值次數'] || '0') === '0'; }).map(function (f) {
    const o = publicRow_(f);
    const rec = openRecords[f['資產編號']];
    o.record = rec ? { id: rec['紀錄編號'], event: rec['事件'], who: rec['借用人'], from: rec['預計開始'], to: rec['預計結束'],
      overdue: !!rec['預計結束'] && rec['預計結束'] < today } : null;
    return o;
  });
  return { items: items, custody: custody, fixed: fixed, today: today };
}
