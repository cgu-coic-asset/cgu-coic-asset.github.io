/**
 * 公開資訊（免登入）：訪客掃 QR 貼紙看到的頁面。
 * 回傳欄位由 shared/publicView.js 決定；這裡不可直接回傳資料列。
 */

/** payload：{ type, key }。回傳 { asset（公開欄位）, photoId（代表照片，可能為空）, unit（單位名稱） }。 */
function publicGet_(payload) {
  const rows = findAssetRows_(payload.type, payload.key);
  const main = rows[0];
  const key = photoAssetKey(payload.type, main);
  const photos = readRows_(photoSheet_()).filter(function (r) { return r['類型'] === payload.type && r['資產鍵'] === key; });
  const photo = representativePhoto(photos);
  return {
    asset: publicAsset(payload.type, main),
    photoId: photo ? photo['照片編號'] : '',
    unit: setting_('單位名稱'),
  };
}

/** payload：{ id }。只提供有效的建檔照片。 */
function publicPhoto_(payload) {
  const rec = readRows_(photoSheet_()).find(function (r) { return r['照片編號'] === payload.id; });
  if (!rec || rec['用途'] !== '建檔' || rec['狀態'] !== PHOTO_ACTIVE) throw new AppError('NOT_FOUND', '找不到這張照片');
  return photoGet_({ id: payload.id });
}
