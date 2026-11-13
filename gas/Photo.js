/**
 * 照片：上傳（先存檔、再寫紀錄）、列出、讀取、作廢。
 * 規則見 shared/photo.js；照片沒存好就不會有紀錄，流程（盤點、借還）以紀錄為準。
 */

const PHOTO_FOLDER_KEYS = { FIXED: 'FOLDER_PHOTOS_FIXED', CUSTODY: 'FOLDER_PHOTOS_CUSTODY', ITEM: 'FOLDER_PHOTOS_ITEM' };

function photoSheet_() {
  return schemaSheet_('OPS', '照片');
}

/** 確認資產存在，回傳主紀錄。 */
function findAssetForPhoto_(type, key) {
  const t = importTarget_(type);
  const row = readRows_(schemaSheet_(t.book, t.sheet)).find(function (r) { return photoAssetKey(type, r) === key; });
  if (!row) throw new AppError('NOT_FOUND', '找不到 ' + key);
  return row;
}

/** 資產的照片資料夾（照片/<類型>/<鍵>/）；create 為 false 時找不到回傳 null。 */
function assetPhotoFolder_(type, key, create) {
  const props = PropertiesService.getScriptProperties();
  let parentId = props.getProperty(PHOTO_FOLDER_KEYS[type]);
  if (!parentId) {
    // 之後新增的類型（系所物品）第一次上傳時自動建資料夾
    const photosId = props.getProperty('FOLDER_PHOTOS');
    if (!photosId) throw new AppError('NOT_CONFIGURED', '尚未執行 setup()：找不到照片資料夾');
    parentId = ensureChildFolder_(DriveApp.getFolderById(photosId), ASSET_TYPES[type].photoFolder, []).getId();
    props.setProperty(PHOTO_FOLDER_KEYS[type], parentId);
  }
  const parent = DriveApp.getFolderById(parentId);
  const it = parent.getFoldersByName(key);
  if (it.hasNext()) return it.next();
  return create ? parent.createFolder(key) : null;
}

/**
 * 存一張照片並寫紀錄（盤點、借還流程也呼叫這裡）。
 * p：{ type, key, purpose, base64, takenAt, originalName, relatedId }。
 */
function savePhoto_(p, actor) {
  importTarget_(p.type);
  if (PHOTO_PURPOSES.indexOf(p.purpose) === -1) throw new AppError('BAD_REQUEST', '照片用途不正確');
  findAssetForPhoto_(p.type, p.key);

  const bytes = Utilities.base64Decode(String(p.base64 || ''));
  if (!bytes.length) throw new AppError('BAD_REQUEST', '沒有收到照片');
  if (bytes.length > PHOTO_MAX_BYTES) throw new AppError('BAD_REQUEST', '照片超過 2 MB，請重新選擇（可能沒有壓縮成功）');
  if ((bytes[0] & 0xff) !== 0xff || (bytes[1] & 0xff) !== 0xd8) throw new AppError('BAD_REQUEST', '只接受 JPEG 照片');

  const fingerprint = md5Hex_(bytes);
  const sh = photoSheet_();
  const mine = readRows_(sh).filter(function (r) { return r['類型'] === p.type && r['資產鍵'] === p.key; });
  const dup = mine.find(function (r) { return r['指紋'] === fingerprint && r['狀態'] === PHOTO_ACTIVE; });
  if (dup) throw new AppError('DUPLICATE', '這張照片已經上傳過（' + dup['檔名'] + '）');

  const now = new Date();
  const date = Utilities.formatDate(now, TZ, 'yyyyMMdd');
  const name = photoFileName(p.purpose, date, nextPhotoSeq(mine.map(function (r) { return r['檔名']; }), p.purpose, date));
  const file = assetPhotoFolder_(p.type, p.key, true).createFile(Utilities.newBlob(bytes, 'image/jpeg', name));

  const record = stampNew({
    '照片編號': 'P' + Utilities.formatDate(now, TZ, 'yyyyMMddHHmmss') + '-' + fingerprint.slice(0, 4),
    '類型': p.type, '資產鍵': p.key, '用途': p.purpose, '關聯編號': p.relatedId || '',
    '雲端路徑': ['照片'].concat(photoFolderPath(p.type, p.key)).join('/'), '檔名': name,
    '拍攝時間': normalizeExifDate(p.takenAt), '原始檔名': String(p.originalName || '').slice(0, 200),
    '檔案大小': bytes.length, '指紋': fingerprint, '上傳者': actor.email, '上傳時間': now_(),
    '保留到': '', '狀態': PHOTO_ACTIVE, '檔案ID': file.getId(),
  }, actor.email, now_());
  appendRow_(sh, record);
  writeLog_(actor, '上傳照片', importTarget_(p.type).label, p.key, '', {
    照片編號: record['照片編號'], 用途: p.purpose, 檔名: name, 拍攝時間: record['拍攝時間'],
  });
  return publicRow_(record);
}

/** 建檔照片上傳（盤點、借還照片由各自的流程上傳）。 */
function photoUpload_(payload, actor) {
  if (payload.purpose && payload.purpose !== '建檔') throw new AppError('BAD_REQUEST', '這裡只能上傳建檔照片');
  return savePhoto_(Object.assign({}, payload, { purpose: '建檔' }), actor);
}

/** 某資產的有效照片紀錄（新到舊）。 */
function photoList_(payload) {
  importTarget_(payload.type);
  return readRows_(photoSheet_())
    .filter(function (r) { return r['類型'] === payload.type && r['資產鍵'] === payload.key && r['狀態'] === PHOTO_ACTIVE; })
    .reverse().map(publicRow_);
}

/** 讀照片內容（base64）。先用檔案ID，找不到再依路徑與檔名找。 */
function photoGet_(payload) {
  const rec = readRows_(photoSheet_()).find(function (r) { return r['照片編號'] === payload.id; });
  if (!rec) throw new AppError('NOT_FOUND', '找不到這張照片');
  let file = null;
  try { file = rec['檔案ID'] ? DriveApp.getFileById(rec['檔案ID']) : null; } catch (e) { file = null; }
  if (!file) {
    const folder = assetPhotoFolder_(rec['類型'], rec['資產鍵'], false);
    const it = folder ? folder.getFilesByName(rec['檔名']) : null;
    file = it && it.hasNext() ? it.next() : null;
  }
  if (!file) throw new AppError('NOT_FOUND', '雲端找不到照片檔（' + rec['雲端路徑'] + '/' + rec['檔名'] + '）');
  return { id: rec['照片編號'], base64: Utilities.base64Encode(file.getBlob().getBytes()) };
}

/** 作廢照片：紀錄改為作廢（不刪檔，NAS 仍保留），寫 LOG。 */
function photoVoid_(payload, actor) {
  if (!String(payload.reason || '').trim()) throw new AppError('BAD_REQUEST', '請填寫作廢原因');
  const sh = photoSheet_();
  const rec = readRows_(sh).find(function (r) { return r['照片編號'] === payload.id; });
  if (!rec) throw new AppError('NOT_FOUND', '找不到這張照片');
  if (rec['狀態'] !== PHOTO_ACTIVE) return publicRow_(rec);
  const result = applyChanges(rec, { '狀態': PHOTO_VOID, '作廢原因': payload.reason }, ['狀態', '作廢原因'], actor.email, now_());
  writeRow_(sh, rec._row, result.row);
  writeLog_(actor, '作廢照片', importTarget_(rec['類型']).label, rec['資產鍵'],
    { 照片編號: rec['照片編號'], 狀態: PHOTO_ACTIVE }, { 狀態: PHOTO_VOID }, payload.reason);
  return publicRow_(result.row);
}

/** 清單篩選用：各資產的照片數。 */
function photoCountsAll_() {
  return photoCounts(readRows_(photoSheet_()));
}
