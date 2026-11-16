const test = require('node:test');
const assert = require('node:assert');
const D = require('./selfCheckDocx.js');

test('照片縮進框內、切檔、跳脫', () => {
  const big = D.docxFit(800, 600, D.DOCX_BOX_BIG);
  assert.ok(big.cx <= D.DOCX_BOX_BIG.w && big.cy <= D.DOCX_BOX_BIG.h);
  assert.strictEqual(Math.round(big.cx / big.cy * 100), 133);
  const tall = D.docxFit(600, 800, D.DOCX_BOX_SMALL);
  assert.strictEqual(tall.cy, Math.round(D.DOCX_BOX_SMALL.h));
  assert.deepStrictEqual(D.docxChunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.strictEqual(D.docxChunks(new Array(120).fill(0)).length, 3);
  assert.strictEqual(D.xmlEsc('A&B <x> "q"\u0001'), 'A&amp;B &lt;x&gt; &quot;q&quot;');
});

test('文件內容：每件一頁、照片與說明、待補盤', () => {
  const entry = (pending, date) => ({
    pending, date, photos: [
      { slot: '全貌', label: '2026/11/10 本次盤點' }, { slot: '編號貼紙', label: '' }, { slot: '廠牌型號', label: '2024/02/01 建檔' },
    ],
  });
  const pages = [
    { 名稱: 'A&B 電腦', 資產編號: '001', 保管人姓名: '王', 位置: '301', entry: entry('', '115/11/10'), images: [{ rid: 'rIdImg1', cx: 1, cy: 2 }, null, { rid: 'rIdImg2', cx: 3, cy: 4 }] },
    { 名稱: '投影機', 資產編號: '002', 保管人姓名: '李', 位置: '302', entry: entry('借用中，待補盤', ''), images: [] },
  ];
  const xml = D.selfCheckDocumentXml(pages);
  assert.ok(xml.indexOf('設備名稱：A&amp;B 電腦') !== -1);
  assert.ok(xml.indexOf('盤點日期：115/11/10') !== -1);
  assert.strictEqual((xml.match(/<w:pageBreakBefore\/>/g) || []).length, 1);
  assert.strictEqual((xml.match(/<w:drawing>/g) || []).length, 2);
  assert.strictEqual((xml.match(/（沒有照片）/g) || []).length, 4);
  assert.ok(xml.indexOf('全貌　2026/11/10 本次盤點') !== -1);
  assert.ok(xml.indexOf(' (借用中，待補盤)') !== -1);
  assert.strictEqual(new Set(xml.match(/wp:docPr id="\d+"/g)).size, 2, 'docPr id 不重複');
  const parts = D.selfCheckDocxParts(pages, [{ rid: 'rIdImg1', name: 'p1.jpg' }, { rid: 'rIdImg2', name: 'p2.jpg' }]);
  assert.ok(parts['word/_rels/document.xml.rels'].indexOf('Target="media/p2.jpg"') !== -1);
  assert.deepStrictEqual(Object.keys(parts).sort(), ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml']);
});
