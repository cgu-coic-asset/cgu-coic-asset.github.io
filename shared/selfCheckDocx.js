/**
 * 資產自主盤點資料表匯出 Word（純邏輯，前後端共用）：產生 .docx 的 XML 各部分，壓縮由前端（JSZip）做。
 * 版面照學校範本：標楷體 12pt、A4、表格欄寬 4252／2411／1842、文字列高 1cm；
 * 範本只有兩格照片，這裡第一格放全貌、第二格左右放編號貼紙與廠牌型號（同第 1、3 列的左右各半）。
 * 照片由前端縮成長邊 800 像素；每檔最多 50 件。
 */

var DOCX_MAX_PAGES = 50;
var DOCX_PHOTO_SIDE = 800;

var EMU_PER_CM = 360000;
/** 照片框（EMU）：全貌一整列、下方兩格各半；高度扣掉說明文字。 */
var DOCX_BOX_BIG = { w: 14.6 * EMU_PER_CM, h: 8.1 * EMU_PER_CM };
var DOCX_BOX_SMALL = { w: 7.1 * EMU_PER_CM, h: 8.1 * EMU_PER_CM };

function xmlEsc(v) {
  return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** 照片等比例縮進框內，回傳 { cx, cy }（EMU 整數）。 */
function docxFit(width, height, box) {
  const k = Math.min(box.w / width, box.h / height);
  return { cx: Math.round(width * k), cy: Math.round(height * k) };
}

/** 依每檔上限切成多份：[[列…], …]。 */
function docxChunks(rows, size) {
  const n = size || DOCX_MAX_PAGES;
  const out = [];
  for (let i = 0; i < (rows || []).length; i += n) out.push(rows.slice(i, i + n));
  return out;
}

const RUN_FONT_ = '<w:rFonts w:ascii="標楷體" w:eastAsia="標楷體" w:hAnsi="標楷體"/>';

function run_(text, extra) {
  return '<w:r><w:rPr>' + RUN_FONT_ + (extra || '') + '</w:rPr><w:t xml:space="preserve">' + xmlEsc(text) + '</w:t></w:r>';
}

function para_(runs, opts) {
  const o = opts || {};
  return '<w:p><w:pPr>' + (o.pageBreak ? '<w:pageBreakBefore/>' : '') + '<w:spacing w:before="0" w:after="0"/>' +
    (o.center ? '<w:jc w:val="center"/>' : '') + '</w:pPr>' + runs + '</w:p>';
}

function cell_(width, span, content, opts) {
  const o = opts || {};
  return '<w:tc><w:tcPr><w:tcW w:w="' + width + '" w:type="dxa"/>' + (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '') +
    '<w:vAlign w:val="' + (o.top ? 'top' : 'center') + '"/></w:tcPr>' + content + '</w:tc>';
}

/** 文字列用最小高度（名稱長會換行）；照片列固定高度，一件才不會跨頁。 */
function row_(height, cells, exact) {
  return '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:hRule="' + (exact ? 'exact' : 'atLeast') + '" w:val="' + height + '"/></w:trPr>' + cells + '</w:tr>';
}

function label_(name, value) {
  return para_(run_(name + '：' + (value || '')));
}

let docxPicId_ = 0;

/** 一張照片的 inline drawing；img：{ rid, cx, cy, name }。 */
function drawing_(img) {
  const id = ++docxPicId_;
  return '<w:r><w:rPr>' + RUN_FONT_ + '<w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="' + img.cx + '" cy="' + img.cy + '"/><wp:docPr id="' + id + '" name="照片 ' + id + '"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
    '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + xmlEsc(img.name || 'photo.jpg') + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + img.rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + img.cx + '" cy="' + img.cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}

/** 照片格內容：照片（或「沒有照片」）＋小字說明（格名、拍攝日與來源）。 */
function photoCell_(photo, img) {
  const caption = photo.slot + (photo.label ? '　' + photo.label : '');
  const body = img ? para_(drawing_(img), { center: true }) : para_(run_('（沒有照片）', '<w:color w:val="808080"/>'), { center: true });
  return body + para_(run_(caption, '<w:sz w:val="18"/><w:szCs w:val="18"/>'), { center: true });
}

/**
 * document.xml。pages：[{ 名稱, 資產編號, 保管人姓名, 位置, entry（selfCheckEntry）, images: [img|null ×3] }]。
 */
function selfCheckDocumentXml(pages) {
  docxPicId_ = 0;
  const body = (pages || []).map(function (p, i) {
    const e = p.entry;
    const title = para_(run_('資產自主盤點資料表', '<w:sz w:val="32"/><w:szCs w:val="32"/>') +
      (e.pending ? run_(' (' + e.pending + ')', '<w:color w:val="FF0000"/><w:sz w:val="32"/><w:szCs w:val="32"/>') : ''),
    { center: true, pageBreak: i > 0 });
    const imgs = p.images || [];
    const table = '<w:tbl><w:tblPr><w:tblW w:w="8505" w:type="dxa"/><w:tblInd w:w="-5" w:type="dxa"/>' +
      '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
      '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
      '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders>' +
      '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="85" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="4252"/><w:gridCol w:w="2411"/><w:gridCol w:w="1842"/></w:tblGrid>' +
      row_(567, cell_(4252, 1, label_('設備名稱', p['名稱'])) + cell_(4253, 2, label_('數量', '1'))) +
      row_(567, cell_(4252, 1, label_('設備編號', p['資產編號'])) + cell_(2411, 1, label_('保管人', p['保管人姓名'])) + cell_(1842, 1, label_('分機', ''))) +
      row_(567, cell_(4252, 1, label_('放置位置', p['位置'])) + cell_(4253, 2, label_('盤點日期', e.date || '　　/　　/　　'))) +
      row_(567, cell_(8505, 3, para_(run_('佐證照片：') + run_('(', '<w:color w:val="538135"/>') +
        run_('必須能辨識設備資產編號、廠牌型號及全貌', '<w:color w:val="0033CC"/>') + run_(')', '<w:color w:val="538135"/>')))) +
      row_(5103, cell_(8505, 3, photoCell_(e.photos[0], imgs[0]), { top: true }), true) +
      row_(5103, cell_(4252, 1, photoCell_(e.photos[1], imgs[1]), { top: true }) + cell_(4253, 2, photoCell_(e.photos[2], imgs[2]), { top: true }), true) +
      '</w:tbl>';
    return title + table;
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1797" w:bottom="567" w:left="1797" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>';
}

/**
 * .docx 各檔案（路徑 → 文字）；照片檔由前端另外放到 word/media/<name>。
 * mediaNames：[{ rid, name }]。
 */
function selfCheckDocxParts(pages, mediaNames) {
  const rels = (mediaNames || []).map(function (m) {
    return '<Relationship Id="' + m.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + xmlEsc(m.name) + '"/>';
  }).join('');
  return {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + rels + '</Relationships>',
    'word/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' + RUN_FONT_ + '<w:kern w:val="2"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="zh-TW"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:widowControl w:val="0"/></w:pPr></w:style></w:styles>',
    'word/document.xml': selfCheckDocumentXml(pages),
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    DOCX_MAX_PAGES, DOCX_PHOTO_SIDE, DOCX_BOX_BIG, DOCX_BOX_SMALL,
    xmlEsc, docxFit, docxChunks, selfCheckDocumentXml, selfCheckDocxParts,
  };
}
