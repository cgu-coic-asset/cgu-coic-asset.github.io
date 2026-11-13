const test = require('node:test');
const assert = require('node:assert');
const { textWidth, splitLabelName, fitLabelName, labelColumns, labelUrl, labelRow, toCsv } = require('./label.js');

const BASE = 'https://cgu-coic-asset.github.io/';

test('寬度：中文 2，英數依字形（大寫 1.3、數字 1.1、窄字 0.6、寬字 1.8）', () => {
  assert.strictEqual(textWidth('電腦'), 4);
  assert.ok(Math.abs(textWidth('AB') - 2.6) < 1e-9);
  assert.ok(Math.abs(textWidth('12') - 2.2) < 1e-9);
  assert.ok(Math.abs(textWidth('il') - 1.2) < 1e-9);
  assert.ok(Math.abs(textWidth('W') - 1.8) < 1e-9);
  assert.strictEqual(textWidth(''), 0);
  assert.ok(textWidth('BIG DATA') > 8, '英文字比半個中文字寬');
});

test('名稱分兩行：每行寬度不超過', () => {
  const [a, b] = splitLabelName('AI電腦模組(AI及BIG DATA工作站與周邊系統)');
  assert.ok(textWidth(a) <= 25 && textWidth(b) <= 16, a + '/' + b);
  assert.strictEqual((a + b).replace('…', '').length > 10, true);
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

test('寬度可調整', () => {
  const r = labelRow(BASE, 'FIXED', { 資產編號: 'A', 資產名稱: 'AI電腦模組(AI及BIG DATA工作站與周邊系統)' }, null, [32, 32]);
  assert.ok(textWidth(r[3]) <= 32 && textWidth(r[4]) <= 32);
  assert.strictEqual(r[3] + r[4], 'AI電腦模組(AI及BIG DATA工作站與周邊系統)');
});

test('CSV：BOM、逗號、引號跳脫、CRLF', () => {
  const csv = toCsv([['a', 'b,c', 'd"e'], ['1', '', '中']]);
  assert.strictEqual(csv, '﻿a,"b,c","d""e"\r\n1,,中\r\n');
});

test('保管品 QR 用短碼，編號只印材料編號', () => {
  const r = labelRow(BASE, 'CUSTODY', { 保管品鍵: 'D000000256-CMPDDUD24044701', QR碼: '000017', 材料編號: 'CMPDDUD24044701', 品名規格: 'SSD', 部門代號: 'D000' }, null, [32]);
  assert.strictEqual(r[0], BASE + '?C000017');
  assert.strictEqual(r[2], 'CMPDDUD24044701');
});

test('固定資產黑框：有系所編號就用它，沒有用部門代號', () => {
  const cb = labelRow(BASE, 'FIXED', { 資產編號: '9K60900089', 資產名稱: 'Chromebook', 部門代號: 'D100', 系所編號: 'CB-001' }, null, [32]);
  assert.strictEqual(cb[1], 'CB-001');
  const plain = labelRow(BASE, 'FIXED', { 資產編號: '0351360284', 資產名稱: 'x', 部門代號: 'D100' }, null, [32]);
  assert.strictEqual(plain[1], 'D100');
});

test('只印一行：截斷加「…」；欄位沒有 NAME2；名稱用修正後的', () => {
  assert.strictEqual(fitLabelName('筆記型電腦', 32), '筆記型電腦');
  const long = fitLabelName('AI電腦模組(AI及BIG DATA工作站與周邊系統)', 32);
  assert.ok(textWidth(long) <= 32 && long.endsWith('…'), long);
  assert.deepStrictEqual(labelColumns([32]), ['QR網址', '黑框', '編號', 'NAME1', '保管人']);
  const r = labelRow(BASE, 'FIXED', { 資產編號: '0351360284', 資產名稱: '周邊 統', 名稱修正: '周邊系統', 部門代號: 'D000', 保管人姓名: '甲' }, null, [32]);
  assert.deepStrictEqual(r, [BASE + '?F0351360284', 'D000', '0351360284', '周邊系統', '甲']);
});
