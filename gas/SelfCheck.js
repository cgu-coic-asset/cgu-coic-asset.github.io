/**
 * 資產自主盤點資料表（M3-01）：固定資產每件一頁的資料，照片由前端用 photo.get 逐張讀。
 * 規則見 shared/selfCheck.js。只讀，不改任何紀錄。
 */

/**
 * payload：{ batchId（可空：不指定批次，照片全用前次與建檔） }。
 * 有批次時只列批次範圍內的資產。回傳 { batch, batches, unit, rows: [{ 資產編號, 名稱, 保管人…, entry }] }。
 */
function selfCheckData_(payload) {
  const batches = readRows_(batchSheet_()).filter(function (b) { return b['類型'] === 'FIXED'; }).map(publicRow_).reverse();
  const batchId = String(payload.batchId || '');
  const batch = batchId ? batches.find(function (b) { return b['批次編號'] === batchId; }) : null;
  if (batchId && !batch) throw new AppError('NOT_FOUND', '找不到這個固定資產盤點批次');
  let scope = {};
  if (batch) { try { scope = JSON.parse(batch['範圍'] || '{}'); } catch (e) { scope = {}; } }

  const t = importTarget_('FIXED');
  const assets = filterAssets('FIXED', readRows_(schemaSheet_(t.book, t.sheet)), scope, '', null, null)
    .filter(function (r) { return assetStatus(r) !== '報廢'; });
  const results = {};
  readRows_(resultSheet_()).forEach(function (r) {
    if (r['類型'] !== 'FIXED') return;
    (results[r['資產鍵']] = results[r['資產鍵']] || []).push(publicRow_(r));
  });
  const photos = {};
  readRows_(photoSheet_()).forEach(function (p) {
    if (p['類型'] !== 'FIXED' || p['狀態'] !== PHOTO_ACTIVE) return;
    (photos[p['資產鍵']] = photos[p['資產鍵']] || []).push(publicRow_(p));
  });

  const rows = assets.map(function (r) {
    const key = r['資產編號'];
    return {
      '資產編號': key, '名稱': assetName('FIXED', r), '廠牌規格': r['廠牌規格'], '部門代號': r['部門代號'],
      '保管人代號': r['保管人代號'], '保管人姓名': r['保管人姓名'], '位置': currentLocation(r), '狀態': assetStatus(r),
      entry: selfCheckEntry(r, batchId, results[key], photos[key]),
    };
  });
  rows.sort(function (a, b) {
    return String(a['保管人代號']).localeCompare(String(b['保管人代號'])) || String(a['資產編號']).localeCompare(String(b['資產編號']));
  });
  return { batch: batch, batches: batches, unit: setting_('單位名稱'), rows: rows };
}
