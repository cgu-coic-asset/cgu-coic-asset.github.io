/**
 * 登入驗證：驗證前端 Google 登入取得的 ID token，再對照管理者名單決定角色。
 */

const ADMIN_CACHE_KEY = 'admins';

/** 驗證 ID token，回傳 { email, name }。結果快取到 token 到期（最多 6 小時）。 */
function verifyIdToken_(idToken) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'tok_' + md5Hex_(idToken);
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) throw new AppError('UNAUTHENTICATED', '登入已失效，請重新登入');
  const info = JSON.parse(res.getContentText());
  const nowSec = Math.floor(Date.now() / 1000);
  if (info.aud !== OAUTH_CLIENT_ID) throw new AppError('UNAUTHENTICATED', '登入憑證不是發給本系統的');
  if (['accounts.google.com', 'https://accounts.google.com'].indexOf(info.iss) === -1) {
    throw new AppError('UNAUTHENTICATED', '登入憑證來源不正確');
  }
  if (String(info.email_verified) !== 'true') throw new AppError('UNAUTHENTICATED', 'Email 尚未驗證');
  if (Number(info.exp) <= nowSec) throw new AppError('UNAUTHENTICATED', '登入已過期，請重新登入');

  const who = { email: normalizeEmail(info.email), name: info.name || '' };
  const ttl = Math.min(Number(info.exp) - nowSec, 21600);
  if (ttl > 0) cache.put(cacheKey, JSON.stringify(who), ttl);
  return who;
}

/** 管理者名單（快取 60 秒；修改管理者後呼叫 clearAdminCache_）。 */
function loadAdmins_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(ADMIN_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  const rows = readRows_(sheet_('SYSTEM', '管理者')).map(function (r) {
    return { Email: r['Email'], 姓名: r['姓名'], 等級: r['等級'], 狀態: r['狀態'], 保管人代號: r['保管人代號'] || '' };
  });
  cache.put(ADMIN_CACHE_KEY, JSON.stringify(rows), 60);
  return rows;
}

function clearAdminCache_() {
  CacheService.getScriptCache().remove(ADMIN_CACHE_KEY);
}

/** 取得這次請求的操作者：{ email, name, role, loggedIn, codes（綁定的保管人代號） }。沒帶 token 就是 Guest。 */
function getActor_(req) {
  if (!req.idToken) return { email: '', name: '', role: ROLE_GUEST, loggedIn: false, codes: [] };
  const who = verifyIdToken_(req.idToken);
  const admins = loadAdmins_();
  const role = resolveRole(who.email, admins);
  const row = admins.find(function (r) { return normalizeEmail(r['Email']) === who.email; });
  const codes = role === ROLE_GUEST || !row ? [] : parseCustodianCodes(row['保管人代號']);
  return { email: who.email, name: (row && row['姓名']) || who.name, role: role, loggedIn: true, codes: codes };
}

function md5Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
