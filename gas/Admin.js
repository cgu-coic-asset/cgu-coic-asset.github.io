/**
 * 管理者名單：一等管理者新增、修改、停用（不刪除，紀錄保留姓名）。
 */

const ADMIN_EDITABLE = ['姓名', '等級', '狀態', '備註'];
const ADMIN_LEVELS = ['一等', '二等'];
const ADMIN_STATUSES = ['啟用', '停用'];

function adminList_() {
  return readRows_(sheet_('SYSTEM', '管理者')).map(publicRow_);
}

function adminAdd_(payload, actor) {
  const email = normalizeEmail(payload.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError('BAD_REQUEST', 'Email 格式不正確');
  const level = payload.level || ROLE_LEVEL2;
  if (ADMIN_LEVELS.indexOf(level) === -1) throw new AppError('BAD_REQUEST', '等級只能是一等或二等');

  const sh = sheet_('SYSTEM', '管理者');
  if (findRow_(sh, 'Email', email, normalizeEmail)) {
    throw new AppError('DUPLICATE', '這個 Email 已在名單中；要重新啟用請改狀態');
  }
  const row = stampNew({
    'Email': email, '姓名': payload.name || '', '等級': level, '狀態': '啟用', '備註': payload.note || '',
  }, actor.email, now_());
  appendRow_(sh, row);
  clearAdminCache_();
  writeLog_(actor, '新增管理者', '管理者', email, '', { 姓名: row['姓名'], 等級: level }, payload.reason);
  return row;
}

function adminUpdate_(payload, actor) {
  const sh = sheet_('SYSTEM', '管理者');
  const current = findRow_(sh, 'Email', payload.email, normalizeEmail);
  if (!current) throw new AppError('NOT_FOUND', '名單中沒有這個 Email');

  const conflict = checkVersion(current, payload.version);
  if (conflict) throw new AppError('VERSION_CONFLICT', undefined, conflict);

  const changes = payload.changes || {};
  if (changes['等級'] !== undefined && ADMIN_LEVELS.indexOf(changes['等級']) === -1) {
    throw new AppError('BAD_REQUEST', '等級只能是一等或二等');
  }
  if (changes['狀態'] !== undefined && ADMIN_STATUSES.indexOf(changes['狀態']) === -1) {
    throw new AppError('BAD_REQUEST', '狀態只能是啟用或停用');
  }

  const result = applyChanges(current, changes, ADMIN_EDITABLE, actor.email, now_());
  if (!result.changed) return publicRow_(current);

  const wasActiveTop = current['等級'] === ROLE_LEVEL1 && current['狀態'] === '啟用';
  const stillActiveTop = result.row['等級'] === ROLE_LEVEL1 && result.row['狀態'] === '啟用';
  if (wasActiveTop && !stillActiveTop) {
    const others = readRows_(sh).filter(function (r) {
      return r._row !== current._row && r['等級'] === ROLE_LEVEL1 && r['狀態'] === '啟用';
    });
    if (!others.length) throw new AppError('FORBIDDEN', '至少要保留一位啟用中的一等管理者');
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
  writeLog_(actor, '修改管理者', '管理者', current['Email'], result.before, result.after, payload.reason);
  return publicRow_(result.row);
}
