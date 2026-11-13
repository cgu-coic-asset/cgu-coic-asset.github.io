/**
 * QR 貼紙 CSV（純邏輯，前後端共用）。QR 碼由 BarTender 依「QR網址」欄產生，系統只匯出資料。
 * 欄位：QR網址、黑框、編號、NAME1、（NAME2）、保管人（40×25 mm 雙排貼紙）。
 * 名稱寬度以中文 2、英數 1 計，由 web/config.json 的 labelNameWidths 設定：[32] 只印一行，[32, 32] 印兩行；超過以「…」結尾。
 * 名稱用 assetName（有名稱修正就用修正後的）。
 */

if (typeof module !== 'undefined' && typeof ASSET_TYPES === 'undefined') {
  var ASSET_TYPES = require('./types.js').ASSET_TYPES;
  var assetName = require('./assetList.js').assetName;
  var qrKey = require('./assetList.js').qrKey;
}

var LABEL_COLUMNS = ['QR網址', '黑框', '編號', 'NAME1', 'NAME2', '保管人'];

/** 依名稱行數決定欄位（只有一行時沒有 NAME2）。 */
function labelColumns(widths) {
  return widths && widths.length === 1 ? ['QR網址', '黑框', '編號', 'NAME1', '保管人'] : LABEL_COLUMNS;
}
var LABEL_WIDTH1 = 25;
var LABEL_WIDTH2 = 16;

/** 字元寬度：ASCII 與半形字 1，其他（中文、全形）2。 */
function charWidth(ch) {
  const c = ch.codePointAt(0);
  return c < 0x1100 || (c >= 0xff61 && c <= 0xffdc) ? 1 : 2;
}

function textWidth(text) {
  let w = 0;
  for (const ch of String(text || '')) w += charWidth(ch);
  return w;
}

/** 取前面不超過 width 的部分，回傳 [取到的, 剩下的]。 */
function takeWidth_(chars, width) {
  let w = 0;
  let i = 0;
  while (i < chars.length && w + charWidth(chars[i]) <= width) { w += charWidth(chars[i]); i++; }
  return i;
}

/**
 * 名稱分兩行。第一行盡量不把英文字或數字切斷（往前找空白或中英交界，最多退 8 格）。
 * 回傳 [NAME1, NAME2]。
 */
function splitLabelName(text, width1, width2) {
  const w1 = width1 || LABEL_WIDTH1;
  const w2 = width2 || LABEL_WIDTH2;
  const chars = Array.from(String(text || '').replace(/\s+/g, ' ').trim());
  let cut = takeWidth_(chars, w1);
  if (cut < chars.length) {
    const isWord = (ch) => /[A-Za-z0-9]/.test(ch || '');
    if (isWord(chars[cut - 1]) && isWord(chars[cut])) {
      let back = cut;
      let moved = 0;
      while (back > 0 && isWord(chars[back - 1]) && moved < 8) { back--; moved++; }
      if (back > 0 && moved < 8) cut = back;
    }
  }
  const line1 = chars.slice(0, cut).join('').trim();
  const rest = chars.slice(cut).join('').trim();
  const restChars = Array.from(rest);
  if (textWidth(rest) <= w2) return [line1, rest];
  const keep = takeWidth_(restChars, w2 - 2);
  return [line1, restChars.slice(0, keep).join('').trim() + '…'];
}

/** 名稱只印一行：超過寬度就截斷並以「…」結尾。 */
function fitLabelName(text, width) {
  const chars = Array.from(String(text || '').replace(/\s+/g, ' ').trim());
  if (textWidth(chars.join('')) <= width) return chars.join('');
  return chars.slice(0, takeWidth_(chars, width - 2)).join('').trim() + '…';
}

/** QR 網址：<qrBase>?<F|C|I><鍵>。 */
function labelUrl(qrBase, type, key) {
  const base = String(qrBase || '').replace(/\/?$/, '/');
  return base + '?' + ASSET_TYPES[type].qr + encodeURIComponent(key);
}

/**
 * 一筆資料轉成貼紙欄位。
 * 固定資產：黑框＝系所編號（系所借用的，例 CB-001），沒有就用部門代號，編號＝資產編號；保管品：黑框＝部門、編號＝材料編號；
 * 系所物品：黑框＝系所編號、編號＝連結的資產編號或材料編號（無帳留白）、保管人沒有時用經管人。
 * managerName：Email → 姓名（系所物品沒有保管人時用）；widths：[NAME1 寬度, NAME2 寬度]。
 */
function labelRow(qrBase, type, row, managerName, widths) {
  let box;
  let code;
  let name;
  let custodian = row['保管人姓名'] || '';
  if (type === 'ITEM') {
    box = row['系所編號'] || '';
    code = row['資產編號'] || row['材料編號'] || '';
    name = [row['名稱'], row['規格']].filter(Boolean).join(' ');
    if (!custodian && row['經管人']) custodian = (managerName && managerName(row['經管人'])) || '';
  } else {
    box = (type === 'FIXED' && row['系所編號']) || row['部門代號'] || '';
    code = type === 'FIXED' ? row['資產編號'] : row['材料編號'];
    name = assetName(type, row);
  }
  const head = [labelUrl(qrBase, type, qrKey(type, row)), box, code || ''];
  if (widths && widths.length === 1) return head.concat([fitLabelName(name, widths[0]), custodian]);
  const names = splitLabelName(name, widths && widths[0], widths && widths[1]);
  return head.concat([names[0], names[1], custodian]);
}

/** 轉成 CSV（逗號分隔、CRLF、必要時加引號；開頭加 BOM 讓 Excel／BarTender 正確讀中文）。 */
function toCsv(rows) {
  const cell = (v) => {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n') + '\r\n';
}

if (typeof module !== 'undefined') {
  module.exports = {
    LABEL_COLUMNS, LABEL_WIDTH1, LABEL_WIDTH2, labelColumns, textWidth, splitLabelName, fitLabelName, labelUrl, labelRow, toCsv,
  };
}
