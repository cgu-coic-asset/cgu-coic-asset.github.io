/**
 * 帳號名單（分頁仍叫「管理者」）：新增、修改、停用（不刪除，紀錄保留姓名）。
 * Super 管理所有帳號；Admin 只能新增、修改 User 帳號。
 * User 帳號綁定保管人代號（可多個），登入後只看得到自己名下的帳。
 */

const ADMIN_EDITABLE = ['姓名', '等級', '狀態', '備註', '保管人代號'];
const ADMIN_STATUSES = ['啟用', '停用'];
const CUSTODIAN_CODE_PATTERN = /^[A-Z][0-9]{9}$/;

function accountSheet_() {
  return schemaSheet_('SYSTEM', '管理者');
}

/** 檢查並整理保管人代號欄；User 至少要一個。 */
function cleanCodes_(text, level) {
  const codes = parseCustodianCodes(text);
  const bad = codes.filter(function (c) { return !CUSTODIAN_CODE_PATTERN.test(c); });
  if (bad.length) throw new AppError('BAD_REQUEST', '保管人代號格式不正確（應為 1 個英文字母＋9 位數字）：' + bad.join('、'));
  if (level === ROLE_USER && !codes.length) throw new AppError('BAD_REQUEST', 'User 帳號必須綁定保管人代號');
  return codes.join(',');
}

function adminList_(payload, actor) {
  return readRows_(accountSheet_()).map(function (r) {
    const o = publicRow_(r);
    o['等級'] = normalizeLevel(r['等級']) || r['等級'];
    return o;
  }).filter(function (r) { return actor.role === ROLE_SUPER || r['等級'] === ROLE_USER; });
}

function adminAdd_(payload, actor) {
  const email = normalizeEmail(payload.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError('BAD_REQUEST', 'Email 格式不正確');
  const level = normalizeLevel(payload.level || ROLE_USER);
  if (!level) throw new AppError('BAD_REQUEST', '等級只能是 Super、Admin 或 User');
  if (actor.role !== ROLE_SUPER && level !== ROLE_USER) throw new AppError('FORBIDDEN', 'Admin 只能新增 User 帳號');
  const codes = cleanCodes_(payload.custodianCodes, level);

  const sh = accountSheet_();
  if (findRow_(sh, 'Email', email, normalizeEmail)) {
    throw new AppError('DUPLICATE', '這個 Email 已在名單中；要重新啟用請改狀態');
  }
  const row = stampNew({
    'Email': email, '姓名': payload.name || '', '等級': level, '狀態': '啟用', '備註': payload.note || '', '保管人代號': codes,
  }, actor.email, now_());
  appendRow_(sh, row);
  clearAdminCache_();
  writeLog_(actor, '新增帳號', '帳號', email, '', { 姓名: row['姓名'], 等級: level, 保管人代號: codes }, payload.reason);
  return row;
}

function adminUpdate_(payload, actor) {
  const sh = accountSheet_();
  const current = findRow_(sh, 'Email', payload.email, normalizeEmail);
  if (!current) throw new AppError('NOT_FOUND', '名單中沒有這個 Email');
  const currentLevel = normalizeLevel(current['等級']);
  if (actor.role !== ROLE_SUPER && currentLevel !== ROLE_USER) throw new AppError('FORBIDDEN', 'Admin 只能修改 User 帳號');

  const conflict = checkVersion(current, payload.version);
  if (conflict) throw new AppError('VERSION_CONFLICT', undefined, conflict);

  const changes = Object.assign({}, payload.changes || {});
  if (changes['等級'] !== undefined) {
    changes['等級'] = normalizeLevel(changes['等級']);
    if (!changes['等級']) throw new AppError('BAD_REQUEST', '等級只能是 Super、Admin 或 User');
    if (actor.role !== ROLE_SUPER && changes['等級'] !== ROLE_USER) throw new AppError('FORBIDDEN', 'Admin 不能把帳號改成 Admin 或 Super');
  }
  if (changes['狀態'] !== undefined && ADMIN_STATUSES.indexOf(changes['狀態']) === -1) {
    throw new AppError('BAD_REQUEST', '狀態只能是啟用或停用');
  }
  const newLevel = changes['等級'] || currentLevel;
  const codesText = changes['保管人代號'] !== undefined ? changes['保管人代號'] : current['保管人代號'];
  const codes = cleanCodes_(codesText, newLevel);
  if (changes['保管人代號'] !== undefined) changes['保管人代號'] = codes;

  const result = applyChanges(current, changes, ADMIN_EDITABLE, actor.email, now_());
  if (!result.changed) return publicRow_(current);

  const wasActiveTop = currentLevel === ROLE_SUPER && current['狀態'] === '啟用';
  const stillActiveTop = normalizeLevel(result.row['等級']) === ROLE_SUPER && result.row['狀態'] === '啟用';
  if (wasActiveTop && !stillActiveTop) {
    const others = readRows_(sh).filter(function (r) {
      return r._row !== current._row && normalizeLevel(r['等級']) === ROLE_SUPER && r['狀態'] === '啟用';
    });
    if (!others.length) throw new AppError('FORBIDDEN', '至少要保留一位啟用中的 Super');
  }
  if (result.after['狀態'] === '停用') {
    result.row['停用時間'] = now_();
    result.row['停用者'] = actor.email;
  } else if (result.after['狀態'] === '啟用') {
    result.row['停用時間'] = '';
    result.row['停用者'] = '';
  }

  writeRow_(sh, current._row, result.row);
  clearAdminCache_();
  writeLog_(actor, '修改帳號', '帳號', current['Email'], result.before, result.after, payload.reason);
  return publicRow_(result.row);
}
