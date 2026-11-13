#!/usr/bin/env python3
"""把學校系統的 PDF 轉成匯入範本格式的 Excel（docs/匯入範本.md）。

支援：
- 固定資產「財產目錄（使用部門）」
- 保管品「個人保管工具明細表」（可一次給多個部門的 PDF，合併成一個檔）

用法：
  python3 tools/pdf_to_excel.py 20260413_固定資產清單.pdf -o 固定資產.xlsx
  python3 tools/pdf_to_excel.py 20260401_D000_ALL個人保管品.pdf 20260401_D100_ALL個人保管品.pdf -o 保管品.xlsx

需要：pdftotext（Mac：brew install poppler）、openpyxl、node。
依每個字在頁面上的座標分欄，所以學校報表版面改了就要調整下面的欄位範圍。
轉完會用 shared/importTemplate.js 做一次匯入檢查並列出結果。
**輸出檔含學校資料，不要存進這個 repo。**
"""
import argparse
import html
import json
import pathlib
import re
import subprocess
import sys

from openpyxl import Workbook
from openpyxl.styles import Font

ROOT = pathlib.Path(__file__).resolve().parent.parent
# PDF 內嵌字型的造字區字元（看不到也印不出來），一律去掉
PRIVATE_USE = re.compile('[\ue000-\uf8ff]')
WORD_RE = re.compile(
    r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([^<]*)</word>')


# ---------- 讀 PDF ----------

def read_pages(pdf):
    """回傳每頁的「行」：[(y, [(x, 字), ...]), ...]，同一行的 y 相差 3 以內。"""
    out = subprocess.run(['pdftotext', '-bbox', str(pdf), '-'], check=True,
                         capture_output=True, text=True).stdout
    pages = []
    for chunk in out.split('<page ')[1:]:
        words = sorted((float(y), float(x), PRIVATE_USE.sub('', html.unescape(t)))
                       for x, y, t in WORD_RE.findall(chunk))
        lines = []
        for y, x, t in words:
            if lines and y - lines[-1][0] <= 3:
                lines[-1][1].append((x, t))
            else:
                lines.append((y, [(x, t)]))
        pages.append([(y, sorted(ws)) for y, ws in lines])
    return pages


def pick(words, lo, hi):
    """取出 x 落在 [lo, hi) 的字，以空白連接。"""
    return ' '.join(t for x, t in words if lo <= x < hi)


def join_wrapped(parts):
    """把同一欄跨行的文字接起來：英數字之間補空白，中文直接接。"""
    text = ''
    for p in (p for p in parts if p):
        if text and re.search(r'[\x21-\x7e]$', text) and re.match(r'[\x21-\x7e]', p):
            text += ' ' + p
        else:
            text += p
    return text


def after_label(words, label):
    for i, (_, t) in enumerate(words):
        if t.startswith(label):
            rest = t[len(label):]
            if rest:
                return rest
            return words[i + 1][1] if i + 1 < len(words) else ''
    return ''


# ---------- 固定資產 ----------

# 第一行（資產編號那行）與第二行（請購案號那行）的欄位範圍
FIXED_TOP = [
    ('資產編號', 0, 100), ('增值次數', 100, 130), ('驗收取得日', 130, 185), ('單位', 185, 215),
    ('數量', 215, 295), ('耐用年數', 295, 325), ('保管人', 325, 455), ('保固期限', 455, 510),
    ('獎補助編號', 510, 620), ('研究計劃編號', 620, 700), ('附註', 700, 9999),
]
FIXED_LINE2 = [('請購案號', 130, 190)] + [c for c in FIXED_TOP if c[1] >= 510]
# 第三行起（可能跨行）
FIXED_BOTTOM = [
    ('資產名稱', 0, 215), ('增值補充說明', 215, 325), ('廠牌規格', 325, 510), ('存放位置', 510, 620),
    ('產品序號', 620, 9999),
]
FIXED_CODE = re.compile(r'^[0-9A-Z*]{10}$')


def parse_fixed(pages):
    records = []
    cur = None
    for page in pages:
        dept = ''
        body_top = None
        for y, words in page:
            texts = [t for _, t in words]
            if any(t.startswith('使用部門') for t in texts):
                dept = after_label(words, '使用部門:') or after_label(words, '使用部門：')
            if '資產名稱' in texts:
                body_top = y
                continue
            if body_top is None:
                continue
            first_x, first_t = words[0]
            has_sub = any(100 <= x < 130 and t.isdigit() for x, t in words)
            if first_x < 100 and FIXED_CODE.match(first_t) and has_sub:
                cur = {'部門代號': dept, '_top': {}, '_bottom': {}, '_stage': 'top', '_page_dept': dept}
                records.append(cur)
                for name, lo, hi in FIXED_TOP:
                    cur['_top'].setdefault(name, []).append(pick(words, lo, hi))
                continue
            if cur is None:
                continue
            if cur['_stage'] == 'top' and first_x >= 130 and any(130 <= x < 190 for x, _ in words):
                for name, lo, hi in FIXED_LINE2:
                    cur['_top'].setdefault(name, []).append(pick(words, lo, hi))
                cur['_stage'] = 'line2'
                continue
            cur['_stage'] = 'bottom'
            for name, lo, hi in FIXED_BOTTOM:
                cur['_bottom'].setdefault(name, []).append(pick(words, lo, hi))

    out = []
    for r in records:
        f = {}
        # 同一欄在第一、二行重複出現（例：研究計畫編號）時只留一次
        for k, v in r['_top'].items():
            uniq = [p for i, p in enumerate(v) if p and p not in v[:i]]
            f[k] = ' '.join(uniq)
        f.update({k: join_wrapped(v) for k, v in r['_bottom'].items()})
        m = re.match(r'^(\S+)\s*(.*)$', f.get('保管人', ''))
        f['保管人代號'], f['保管人姓名'] = (m.group(1), m.group(2)) if m else ('', '')
        f['部門代號'] = r['部門代號']
        out.append(f)
    return out


# ---------- 保管品 ----------

CUSTODY_ITEM = [
    ('項次', 55, 95), ('材料編號', 95, 270), ('單位', 270, 320), ('帳面數量', 320, 400),
    ('處理方式', 400, 455), ('移入', 455, 680), ('來源最後異動日', 680, 9999),
]


def parse_custody(pages):
    out = []
    cur = None
    for page in pages:
        dept = code = name = ''
        in_body = False
        for y, words in page:
            texts = [t for _, t in words]
            if texts and texts[0].startswith('公司'):
                dept = after_label(words, '保管部門:')
                code = after_label(words, '保管人員:')
                name = ' '.join(t for x, t in words if x > 330 and not t.startswith('本單編號'))
                continue
            if texts[:1] == ['品']:
                in_body = True
                continue
            if any(t.startswith('回收點收人') for t in texts):
                in_body = False
                continue
            if not in_body:
                continue
            item_no = pick(words, 55, 95)
            if item_no.isdigit() and pick(words, 95, 270):
                cur = {k: pick(words, lo, hi) for k, lo, hi in CUSTODY_ITEM}
                cur.update({'部門代號': dept, '保管人代號': code, '保管人姓名': name, '_spec': []})
                out.append(cur)
            elif cur is not None:
                cur['_spec'].append(' '.join(texts))
    for r in out:
        r['品名規格'] = ' '.join(r.pop('_spec'))
    return out


# ---------- 輸出與檢查 ----------

def load_templates():
    js = "console.log(JSON.stringify(require('./shared/importTemplate.js').IMPORT_TEMPLATES))"
    return json.loads(subprocess.check_output(['node', '-e', js], cwd=ROOT, text=True))


def check(kind, rows):
    js = (
        "const {parseImportRows}=require('./shared/importTemplate.js');"
        "const rows=JSON.parse(require('fs').readFileSync(0,'utf8'));"
        f"console.log(JSON.stringify(parseImportRows('{kind}',rows)));"
    )
    res = subprocess.run(['node', '-e', js], cwd=ROOT, input=json.dumps(rows), capture_output=True,
                         text=True, check=True)
    return json.loads(res.stdout)


def detect(pages):
    first = ''.join(t for _, ws in pages[0][:3] for _, t in ws)
    if '財產目錄' in first:
        return 'FIXED'
    if '個人保管工具明細表' in first.replace(' ', ''):
        return 'CUSTODY'
    sys.exit('看不出是哪一種報表（財產目錄／個人保管工具明細表）')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf', nargs='+')
    ap.add_argument('-o', '--output', required=True)
    args = ap.parse_args()

    kind, rows = None, []
    for pdf in args.pdf:
        pages = read_pages(pdf)
        k = detect(pages)
        if kind and k != kind:
            sys.exit('一次只能轉同一種報表')
        kind = k
        part = parse_fixed(pages) if k == 'FIXED' else parse_custody(pages)
        print(f'{pdf}：{len(part)} 筆')
        rows += part

    template = load_templates()[kind]
    cols = [c['name'] for c in template['columns']]
    wb = Workbook()
    ws = wb.active
    ws.title = template['label']
    ws.append(cols)
    for c in ws[1]:
        c.font = Font(bold=True)
    for r in rows:
        ws.append([r.get(c, '') for c in cols])
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.number_format = '@'
    wb.save(args.output)
    print(f'已輸出 {args.output}：{len(rows)} 筆')

    # 範本沒有的欄位：有內容就提醒，避免漏看
    extra = ['數量', '單位', '獎補助編號', '附註', '增值補充說明'] if kind == 'FIXED' else ['處理方式', '移入']
    for name in extra:
        vals = [r.get(name, '') for r in rows]
        if name == '數量':
            vals = [v for v in vals if v not in ('', '1')]
        elif name == '單位':
            vals = []
        else:
            vals = [v for v in vals if v]
        if vals:
            print(f'注意：範本沒有的「{name}」有 {len(vals)} 筆有值，例：{vals[:3]}')
    if kind == 'FIXED':
        depts = {}
        for r in rows:
            depts[r['部門代號']] = depts.get(r['部門代號'], 0) + 1
        print('各部門筆數：', '、'.join(f'{k} {v}' for k, v in sorted(depts.items())))

    result = check(kind, [{c: r.get(c, '') for c in cols} for r in rows])
    errors = [i for i in result['issues'] if i['level'] == 'error']
    warnings = [i for i in result['issues'] if i['level'] == 'warning']
    print(f'匯入檢查：可匯入 {len(result["records"])} 筆，錯誤 {len(errors)}，提醒 {len(warnings)}')
    for i in (errors + warnings)[:30]:
        print(f'  第 {i["row"]} 列 {i["field"]}：{i["message"]}')


if __name__ == '__main__':
    main()
