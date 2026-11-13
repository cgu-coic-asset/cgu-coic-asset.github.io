const test = require('node:test');
const assert = require('node:assert');
const { textWidth, splitLabelName, labelUrl, labelRow, toCsv } = require('./label.js');

const BASE = 'https://cgu-coic-asset.github.io/';

test('寬度：中文 2、英數 1', () => {
  assert.strictEqual(textWidth('AI電腦'), 6);
  assert.strictEqual(textWidth('BIG DATA'), 8);
  assert.strictEqual(textWidth(''), 0);
});

test('名稱分兩行：使用者範例', () => {
  assert.deepStrictEqual(splitLabelName('AI電腦模組(AI及BIG DATA工作站與周邊系統)'),
    ['AI電腦模組(AI及BIG DATA工', '作站與周邊系統)']);
});

test('短名稱只有第一行', () => {
  assert.deepStrictEqual(splitLabelName('筆記型電腦'), ['筆記型電腦', '']);
});

test('不把英文字切斷', () => {
  const [a, b] = splitLabelName('移動式互動式觸控顯示器BENQ RM7503');
  assert.strictEqual(a, '移動式互動式觸控顯示器');
  assert.strictEqual(b, 'BENQ RM7503');
  assert.ok(textWidth(a) <= 25);
});

test('太長時第二行以「…」結尾，寬度不超過', () => {
  const [a, b] = splitLabelName('塑膠椅面含座墊會議椅(訪客椅) 52cm(長)X59cm(寬)X84cm(高) 如附圖含安裝 工料');
  assert.ok(textWidth(a) <= 25, a);
  assert.ok(textWidth(b) <= 16, b);
  assert.ok(b.endsWith('…'));
});

test('QR 網址依類型加 F／C／I', () => {
  assert.strictEqual(labelUrl(BASE, 'FIXED', '0351360284'), BASE + '?F0351360284');
  assert.strictEqual(labelUrl('https://x.io', 'CUSTODY', 'D000000256-CMPPEE3-0A'), 'https://x.io/?CD000000256-CMPPEE3-0A');
  assert.strictEqual(labelUrl(BASE, 'ITEM', 'I000001'), BASE + '?II000001');
});

test('各類型的欄位內容', () => {
  assert.deepStrictEqual(labelRow(BASE, 'FIXED', { 資產編號: '0351360284', 資產名稱: '互動式觸控顯示器', 部門代號: 'D000', 保管人姓名: '馮建凱' }),
    [BASE + '?F0351360284', 'D000', '0351360284', '互動式觸控顯示器', '', '馮建凱']);
  assert.deepStrictEqual(labelRow(BASE, 'ITEM', { 物品ID: 'I000003', 系所編號: 'CB-001', 資產編號: '9K60900089', 名稱: 'Chromebook', 保管人姓名: '馮建凱' }),
    [BASE + '?II000003', 'CB-001', '9K60900089', 'Chromebook', '', '馮建凱']);
  const hdmi = labelRow(BASE, 'ITEM', { 物品ID: 'I000002', 系所編號: 'COIC-001', 名稱: 'HDMI 線', 規格: '3M', 經管人: 'a@x.com' }, () => '我');
  assert.deepStrictEqual(hdmi.slice(1), ['COIC-001', '', 'HDMI 線 3M', '', '我']);
});

test('CSV：BOM、逗號、引號跳脫、CRLF', () => {
  const csv = toCsv([['a', 'b,c', 'd"e'], ['1', '', '中']]);
  assert.strictEqual(csv, '﻿a,"b,c","d""e"\r\n1,,中\r\n');
});
