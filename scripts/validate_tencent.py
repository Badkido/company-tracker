"""腾讯抽取校验（SPEC_tencent §10 的 1–5）。失败项打印并以非零码退出；用法：python validate_tencent.py"""
import json
import sys
from pathlib import Path

fin = json.loads((Path(__file__).resolve().parent.parent / 'data' / 'tencent' / 'fin.json').read_text())
errs, warn = [], []
for i, r in enumerate(fin):
    q = r['q']
    if abs(r['vas'] + r['mkt'] + r['fbs'] + r['others'] - r['rev']) > 1:
        errs.append(f'{q}: 分部收入合计 ≠ 营业收入')
    if all(r.get(k) is not None for k in ('game_dom', 'game_intl', 'social')) and abs(r['game_dom'] + r['game_intl'] + r['social'] - r['vas']) > 150:
        errs.append(f'{q}: 游戏 + 社交 与 VAS 相差超过 150')
    if r.get('op_exai') is not None and r['op_exai'] < r['op_ng']:
        errs.append(f'{q}: 剔除 AI 经营利润 < Non-IFRS 经营利润')
    if r.get('gp_vas') is not None and abs(r['gp_vas'] + r['gp_mkt'] + r['gp_fbs'] + r['gp_others'] - r['gp']) > 1:
        errs.append(f'{q}: 分部毛利合计 ≠ 毛利')
    miss = [k for k in ('net_cash', 'cash_total', 'inv_listed_fv', 'inv_unlisted_bv', 'capex', 'fcf') if r.get(k) is None]
    if miss:
        errs.append(f'{q}: 缺 {",".join(miss)}')
    if r.get('ni_ng') and (r.get('fcf') is None or not r['ni_ng']):
        errs.append(f'{q}: 现金转化率无法计算（fcf 或 ni_ng 缺失）')
    if i and r.get('op_exai') is not None and fin[i - 1].get('op_exai') is not None:
        d0, d1 = fin[i - 1]['op_exai'] - fin[i - 1]['op_ng'], r['op_exai'] - r['op_ng']
        if d0 and abs(d1 / d0 - 1) > 0.5:
            warn.append(f'{q}: AI 拖累较上季变化 {d1 / d0 - 1:+.0%}')
print('\n'.join(['WARN ' + w for w in warn] + ['FAIL ' + e for e in errs]) or 'ok')
sys.exit(1 if errs else 0)
