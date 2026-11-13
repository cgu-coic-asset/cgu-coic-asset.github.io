/**
 * Excel 匯入範本：欄位定義、標題對應、整理與檢查（純邏輯，前後端共用）。
 * 範本說明見 docs/匯入範本.md。輸入是「標題 → 值」的物件陣列（第 1 列為標題，資料從第 2 列起）。
 */

/**
 * 每個範本的欄位。name 對應試算表欄名；aliases 為可接受的其他標題寫法；
 * kind：text 文字、code 代號（去空白轉大寫）、date 日期（YYYYMMDD）、int 整數、number 數字。
 */
var IMPORT_TEMPLATES = {
  FIXED: {
    label: '固定資產',
    keyField: '資產編號',
    columns: [
      { name: '資產編號', kind: 'code', required: true, example: '0399999901', note: '10 碼，開頭的 0 不可省略' },
      { name: '增值次數', kind: 'int', example: '0', note: '空白視為 0；增值紀錄另列一行，資產編號相同', aliases: ['增值'] },
      { name: '資產名稱', kind: 'text', required: true, example: '筆記型電腦' },
      { name: '廠牌規格', kind: 'text', example: 'ACME / X14 14吋', aliases: ['廠牌', '規格'] },
      { name: '產品序號', kind: 'text', example: 'SN0001A', aliases: ['序號'] },
      { name: '部門代號', kind: 'code', example: 'D000', note: '每頁頁首的使用部門；空白時用系統設定的部門代號', aliases: ['使用部門'] },
      { name: '存放位置', kind: 'text', example: '管理大樓14樓 1202G', aliases: ['位置'] },
      { name: '保管人代號', kind: 'code', required: true, example: 'D000000001', note: '也可只給「保管人」一欄，寫成「代號 姓名」' },
      { name: '保管人姓名', kind: 'text', example: '王小明' },
      { name: '驗收取得日', kind: 'date', example: '20240115', note: 'YYYYMMDD', aliases: ['取得日期', '驗收日期'] },
      { name: '取得價值', kind: 'number', example: '35000', aliases: ['價值', '金額'] },
      { name: '耐用年數', kind: 'int', example: '3', aliases: ['耐用年限'] },
      { name: '保固期限', kind: 'date', example: '20270114', note: 'YYYYMMDD', aliases: ['保固到期日'] },
      { name: '研究計劃編號', kind: 'text', example: '', aliases: ['研究計畫編號'] },
      { name: '請購案號', kind: 'code', example: 'Q40AA00001', note: '與產品序號是不同欄位；沒有產品序號的資產，畫面上以請購案號代替' },
    ],
  },
  CUSTODY: {
    label: '保管品',
    keyField: '保管品鍵',
    columns: [
      { name: '部門代號', kind: 'code', required: true, example: 'D000', note: 'PDF 頁首的「保管部門」', aliases: ['保管部門'] },
      { name: '保管人代號', kind: 'code', required: true, example: 'D000000001', note: '也可只給「保管人」一欄，寫成「代號 姓名」', aliases: ['保管人員代號'] },
      { name: '保管人姓名', kind: 'text', example: '王小明', aliases: ['保管人員姓名'] },
      { name: '材料編號', kind: 'code', required: true, example: 'TACSC999' },
      { name: '品名規格', kind: 'text', example: '塑膠製旋轉椅 無扶手 五支腳', aliases: ['品名', '品名及規格'] },
      { name: '單位', kind: 'code', example: 'PC' },
      { name: '帳面數量', kind: 'number', required: true, example: '12', aliases: ['保管量', '數量'] },
      { name: '來源最後異動日', kind: 'date', example: '20250319', note: 'YYYYMMDD', aliases: ['最後異動日'] },
    ],
  },
};

/** 合併欄位：「保管人」一欄寫成「D000000001 王小明」。 */
var IMPORT_COMBINED_CUSTODIAN = ['保管人', '保管人員'];

var CUSTODIAN_CODE_RE = /^[A-Z][0-9]{9}$/;
var FIXED_CODE_RE = /^[0-9A-Z*]{10}$/;

function importHeaderKey_(text) {
  return String(text === null || text === undefined ? '' : text).replace(/[\s　]/g, '');
}

/** 把檔案的標題對到範本欄名；回傳 { map: 檔案標題→欄名, unknown: [無法對應的標題] }。 */
function mapImportHeaders(type, headers) {
  const template = IMPORT_TEMPLATES[type];
  const lookup = {};
  template.columns.forEach(function (col) {
    [col.name].concat(col.aliases || []).forEach(function (alias) {
      lookup[importHeaderKey_(alias)] = col.name;
    });
  });
  IMPORT_COMBINED_CUSTODIAN.forEach(function (alias) { lookup[alias] = '保管人'; });
  const map = {};
  const unknown = [];
  headers.forEach(function (h) {
    const key = importHeaderKey_(h);
    if (!key) return;
    if (lookup[key]) map[h] = lookup[key];
    else unknown.push(String(h));
  });
  return { map: map, unknown: unknown };
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** 日期轉 YYYYMMDD；接受 20240115、20240115.0、2024/1/15、2024-01-15、Date。無法辨識回傳 null。 */
function normalizeImportDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return null;
    return value.getFullYear() + pad2_(value.getMonth() + 1) + pad2_(value.getDate());
  }
  const text = String(value).trim().replace(/\.0+$/, '');
  let m = text.match(/^(\d{4})(\d{2})(\d{2})$/) || text.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const check = new Date(y, mo - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== mo - 1 || check.getDate() !== d) return null;
  return y + pad2_(mo) + pad2_(d);
}

/** 數字轉成字串（去千分位、去掉多餘的 .0）；無法辨識回傳 null。 */
function normalizeImportNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value).trim().replace(/,/g, '');
  if (text === '') return '';
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return String(Number(text));
}

function cleanText_(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 保管品鍵＝保管人代號-材料編號（QR 網址 ?C 後面接這個）。 */
function custodyKey(custodianCode, materialCode) {
  return custodianCode + '-' + materialCode;
}

/**
 * 整理並檢查匯入資料。
 * rows：每列為「檔案標題 → 值」；options.defaultDept：固定資產沒填部門代號時使用。
 * 回傳 { records, fields, issues, unknownColumns }；issues 每筆 { row（Excel 列號）, field, level: error|warning, message }。
 * fields：檔案裡實際有的範本欄位；匯入時只比對、更新這些欄位（檔案沒有的欄位不會清空系統資料）。
 * 有 error 的列不放進 records。
 */
function parseImportRows(type, rows, options) {
  const template = IMPORT_TEMPLATES[type];
  if (!template) throw new Error('未知的匯入類型：' + type);
  const opts = options || {};
  const headers = [];
  rows.forEach(function (r) {
    Object.keys(r).forEach(function (h) { if (headers.indexOf(h) === -1) headers.push(h); });
  });
  const mapping = mapImportHeaders(type, headers);
  const issues = [];
  const records = [];
  const seenKeys = {};
  const custodianNames = {};

  const mappedNames = Object.keys(mapping.map).map(function (h) { return mapping.map[h]; });
  template.columns.forEach(function (col) {
    if (!col.required || mappedNames.indexOf(col.name) !== -1) return;
    if (col.name === '保管人代號' && mappedNames.indexOf('保管人') !== -1) return;
    issues.push({ row: 1, field: col.name, level: 'error', message: '缺少必要欄位「' + col.name + '」' });
  });
  if (issues.length) return { records: [], fields: [], issues: issues, unknownColumns: mapping.unknown };

  const fields = template.columns.map(function (c) { return c.name; }).filter(function (name) {
    if (mappedNames.indexOf(name) !== -1) return true;
    return mappedNames.indexOf('保管人') !== -1 && (name === '保管人代號' || name === '保管人姓名');
  });
  if (type === 'CUSTODY') fields.push('保管品鍵');

  rows.forEach(function (raw, index) {
    const rowNo = index + 2;
    const values = {};
    Object.keys(raw).forEach(function (h) {
      const name = mapping.map[h];
      if (name && (values[name] === undefined || values[name] === '')) values[name] = raw[h];
    });
    const blank = Object.keys(values).every(function (k) { return cleanText_(values[k]) === ''; });
    if (blank) return;

    const rowIssues = [];
    const add = function (field, level, message) {
      rowIssues.push({ row: rowNo, field: field, level: level, message: message });
    };

    if (values['保管人'] !== undefined && cleanText_(values['保管人代號']) === '') {
      const combined = cleanText_(values['保管人']);
      const m = combined.match(/^(\S+)\s*(.*)$/);
      values['保管人代號'] = m ? m[1] : '';
      if (cleanText_(values['保管人姓名']) === '') values['保管人姓名'] = m ? m[2] : '';
    }

    const rec = {};
    template.columns.forEach(function (col) {
      const v = values[col.name];
      let out;
      if (col.kind === 'code') {
        out = cleanText_(v).replace(/\s/g, '').toUpperCase();
      } else if (col.kind === 'date') {
        out = normalizeImportDate(typeof v === 'string' ? v.trim() : v);
        if (out === null) {
          add(col.name, 'warning', '日期看不懂，已保留原文：' + cleanText_(v));
          out = cleanText_(v);
        }
      } else if (col.kind === 'int' || col.kind === 'number') {
        out = normalizeImportNumber(v);
        if (out === null || (col.kind === 'int' && out !== '' && !/^\d+$/.test(out))) {
          add(col.name, 'error', (col.kind === 'int' ? '需為整數' : '需為數字') + '：' + cleanText_(v));
          out = cleanText_(v);
        }
      } else {
        out = cleanText_(v);
      }
      if (col.required && out === '') add(col.name, 'error', '「' + col.name + '」不可空白');
      rec[col.name] = out;
    });

    if (rec['保管人代號'] && !CUSTODIAN_CODE_RE.test(rec['保管人代號'])) {
      add('保管人代號', 'warning', '保管人代號格式少見（通常為 1 個英文字母＋9 位數字）：' + rec['保管人代號']);
    }
    if (rec['保管人代號'] && !rec['保管人姓名']) add('保管人姓名', 'warning', '沒有保管人姓名');

    if (type === 'FIXED') {
      const code = rec['資產編號'];
      if (/^\d{1,9}$/.test(code)) {
        rec['資產編號'] = ('0000000000' + code).slice(-10);
        add('資產編號', 'warning', '資產編號不足 10 碼，可能是開頭的 0 被 Excel 去掉，已補成 ' + rec['資產編號']);
      } else if (code && !FIXED_CODE_RE.test(code)) {
        add('資產編號', 'warning', '資產編號格式少見（通常為 10 碼英數字，可含 *）：' + code);
      }
      if (rec['增值次數'] === '') rec['增值次數'] = '0';
      if (rec['部門代號'] === '') rec['部門代號'] = opts.defaultDept ? String(opts.defaultDept).toUpperCase() : '';
    } else {
      if (rec['帳面數量'] !== '' && !(Number(rec['帳面數量']) > 0)) add('帳面數量', 'error', '帳面數量需大於 0');
      if (!rec['品名規格']) add('品名規格', 'warning', '沒有品名規格');
      rec['保管品鍵'] = rec['保管人代號'] && rec['材料編號'] ? custodyKey(rec['保管人代號'], rec['材料編號']) : '';
    }

    const key = type === 'FIXED' ? rec['資產編號'] + '#' + rec['增值次數'] : rec['保管品鍵'];
    if (key && !/^#|#$/.test(key)) {
      if (seenKeys[key]) {
        add(template.keyField, 'error', (type === 'FIXED' ? '資產編號＋增值次數' : '保管人＋材料編號') + '與第 ' + seenKeys[key] + ' 列重複');
      } else {
        seenKeys[key] = rowNo;
      }
    }

    if (rec['保管人代號'] && rec['保管人姓名']) {
      const known = custodianNames[rec['保管人代號']];
      if (known && known.name !== rec['保管人姓名']) {
        add('保管人姓名', 'warning', '同一保管人代號在第 ' + known.row + ' 列的姓名是「' + known.name + '」，這列是「' + rec['保管人姓名'] + '」');
      } else if (!known) {
        custodianNames[rec['保管人代號']] = { name: rec['保管人姓名'], row: rowNo };
      }
    }

    rec._row = rowNo;
    Array.prototype.push.apply(issues, rowIssues);
    if (!rowIssues.some(function (i) { return i.level === 'error'; })) records.push(rec);
  });

  return { records: records, fields: fields, issues: issues, unknownColumns: mapping.unknown };
}

if (typeof module !== 'undefined') {
  module.exports = {
    IMPORT_TEMPLATES, mapImportHeaders, normalizeImportDate, normalizeImportNumber, custodyKey, parseImportRows,
  };
}
