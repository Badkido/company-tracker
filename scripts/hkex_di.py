"""腾讯权益披露（港交所 DI）→ data/tencent/holders.json。
来源：di.hkex.com.hk 的“主要股东完整名单”（按各人最后一次申报列示，只保留 ≥5%）。
用法：python hkex_di.py
"""
import html as htmllib
import json
import re
from datetime import datetime
from pathlib import Path

from hkex_tencent import get, n

OUT = Path(__file__).resolve().parent.parent / 'data' / 'tencent' / 'holders.json'
DI = 'https://di.hkex.com.hk/di'
BROWSER = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
SID = 6893  # DI 内部 id（00700）
Q = (f'sid={SID}&corpn=Tencent+Holdings+Ltd.&sd=01/01/2025&ed={datetime.now():%d/%m/%Y}&cid=0&sc=00700&src=MAIN&lang=EN&g_lang=en&sa1=cl&scsd=01/01/2025&sced={datetime.now():%d/%m/%Y}')


def rows(page, sa2):
    html = get(f'{DI}/{page}?sa2={sa2}&{Q}', headers=BROWSER).text
    body = re.sub(r'<script.*?</script>|<style.*?</style>', '', html, flags=re.S)
    text = re.sub(r'\s+', ' ', re.sub('<[^>]+>', ' ', body))
    out = []
    for m in re.finditer(r'\b([CD][SA]\d{8}E\d{5}) (.+?) ([\d,]+)\(L\)(?: [\d,]+\(S\))? ([\d.]+)\(L\)(?: [\d.]+\(S\))? (\d\d/\d\d/\d{4})', text):
        d = m.group(5).split('/')
        out.append({'holder': htmllib.unescape(m.group(2)).strip(), 'shares': n(m.group(3)), 'pct': n(m.group(4)) / 100, 'asof': f'{d[2]}-{d[1]}-{d[0]}',
                    'source': f'{DI}/NSForm{"3A" if m.group(1).startswith("DA") else "1"}.aspx?fn={m.group(1)}&{Q}'})
    return out


def main():
    ss = rows('NSAllSSList.aspx', 'as')
    merged = []  # 同一持仓由多方申报（如母公司与子公司、公司与其董事），合并成一行
    for r in ss:
        twin = next((m for m in merged if m['shares'] == r['shares'] and m['asof'] == r['asof']), None)
        if twin:
            twin['holder'] += ' / ' + r['holder']
        else:
            merged.append(dict(r))
    holders = [dict(r, type='主要股东（≥5%）') for r in merged if r['pct'] >= 0.05]  # 董事权益不列
    OUT.write_text(json.dumps(holders, ensure_ascii=False, indent=1) + '\n')
    print(f'wrote {len(holders)} substantial holders')


if __name__ == '__main__':
    main()
