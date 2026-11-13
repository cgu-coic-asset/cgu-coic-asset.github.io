#!/usr/bin/env python3
"""產生匯入範例檔 docs/匯入範本/*.xlsx（欄位取自 shared/importTemplate.js，資料全為虛構）。

用法：python3 tools/make-import-templates.py（需要 node 與 openpyxl）
"""
import json
import pathlib
import subprocess

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / '匯入範本'

# 虛構範例資料（不得放真實資產或人名）
EXTRA_ROWS = {
    'FIXED': [
        {'資產編號': '0399999901', '增值次數': '1', '資產名稱': '筆記型電腦', '廠牌規格': '加裝記憶體 16GB',
         '部門代號': 'D000', '存放位置': '管理大樓14樓 1202G', '保管人代號': 'D000000001', '保管人姓名': '王小明',
         '驗收取得日': '20250310', '取得價值': '3000', '耐用年數': '3'},
        {'資產編號': '35D9999902', '增值次數': '0', '資產名稱': '彩色液晶顯示器', '廠牌規格': 'ACME / P27 27吋',
         '產品序號': 'CN-0000-AAAA-01', '部門代號': 'D000', '存放位置': '管院10樓 公共空間',
         '保管人代號': 'D000000002', '保管人姓名': '陳小華', '驗收取得日': '20240718', '取得價值': '9800',
         '耐用年數': '3', '保固期限': '20270717', '研究計劃編號': 'TEST0000001'},
    ],
    'CUSTODY': [
        {'部門代號': 'D000', '保管人代號': 'D000000001', '保管人姓名': '王小明', '材料編號': 'CMPTEST-0A',
         '品名規格': '投影機遙控器 詳規範', '單位': 'ST', '帳面數量': '3', '來源最後異動日': '20230330'},
        {'部門代號': 'D100', '保管人代號': 'D000000002', '保管人姓名': '陳小華', '材料編號': 'TACSC999',
         '品名規格': '塑膠製低靠背旋轉椅 無扶手 五支腳', '單位': 'PC', '帳面數量': '12', '來源最後異動日': '20250319'},
    ],
}
FILES = {'FIXED': '固定資產匯入範本.xlsx', 'CUSTODY': '保管品匯入範本.xlsx'}


def load_templates():
    js = "console.log(JSON.stringify(require('./shared/importTemplate.js').IMPORT_TEMPLATES))"
    return json.loads(subprocess.check_output(['node', '-e', js], cwd=ROOT, text=True))


def build(key, template):
    wb = Workbook()
    ws = wb.active
    ws.title = template['label']
    cols = template['columns']
    rows = [{c['name']: c['example'] for c in cols}] + EXTRA_ROWS[key]
    ws.append([c['name'] for c in cols])
    for r in rows:
        ws.append([r.get(c['name'], '') for c in cols])
    head_fill = PatternFill('solid', fgColor='DDEBF7')
    need_fill = PatternFill('solid', fgColor='FCE4D6')
    for i, c in enumerate(cols, start=1):
        cell = ws.cell(row=1, column=i)
        cell.font = Font(bold=True)
        cell.fill = need_fill if c.get('required') else head_fill
        ws.column_dimensions[cell.column_letter].width = max(12, len(c['name']) * 2 + 4)
        # 全部設成文字，資產編號開頭的 0 才不會被 Excel 去掉
        for row in range(2, 501):
            ws.cell(row=row, column=i).number_format = '@'
    ws.freeze_panes = 'A2'

    doc = wb.create_sheet('欄位說明')
    doc.append(['欄位', '必填', '格式', '說明', '也接受的標題'])
    kinds = {'text': '文字', 'code': '代號（自動去空白、轉大寫）', 'date': '日期 YYYYMMDD', 'int': '整數', 'number': '數字'}
    for c in cols:
        doc.append([c['name'], '必填' if c.get('required') else '', kinds[c['kind']], c.get('note', ''),
                    '、'.join(c.get('aliases', []))])
    for cell in doc[1]:
        cell.font = Font(bold=True)
    for letter, width in zip('ABCDE', (14, 6, 26, 44, 24)):
        doc.column_dimensions[letter].width = width
    wb.save(OUT / FILES[key])


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for key, template in load_templates().items():
        build(key, template)
        print('已產生', OUT / FILES[key])
