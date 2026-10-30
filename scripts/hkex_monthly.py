"""腾讯证券变动月报表 → data/tencent/shares.json（月末已发行股数、库存股、当月回购注销）。
用法：python hkex_monthly.py [月数，默认 14]
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from pypdf import PdfReader

import logging
from hkex_tencent import HOST, STOCK_ID, CACHE, get, n

logging.getLogger('pypdf').setLevel(logging.CRITICAL)
OUT = Path(__file__).resolve().parent.parent / 'data' / 'tencent' / 'shares.json'


def discover(months):
    frm = f'{datetime.now().year - 2}0101'
    url = (f'{HOST}/search/titleSearchServlet.do?sortDir=0&sortByOptions=DateTime&category=0&market=SEHK'
           f'&stockId={STOCK_ID}&documentType=-1&fromDate={frm}&toDate={datetime.now():%Y%m%d}&title=Monthly%20Return'
           '&searchType=1&t1code=-2&t2Gcode=-2&t2code=-2&rowRange=60&lang=EN')
    rows = json.loads(get(url).json()['result'])
    return [HOST + r['FILE_LINK'] for r in rows][:months]


def parse(url):
    CACHE.mkdir(exist_ok=True)
    pdf = CACHE / ('mr_' + url.rsplit('/', 1)[1])
    if not pdf.exists():
        pdf.write_bytes(get(url).content)
    t = '\n'.join(p.extract_text() for p in PdfReader(str(pdf)).pages)
    f = re.sub(r'\s+', ' ', t)
    month = datetime.strptime(re.search(r'For the month ended: (\d+ \w+ \d{4})', f).group(1), '%d %B %Y').strftime('%Y-%m')
    m = re.search(r'Balance at close of the month ([\d,]+) ([\d,]+) ([\d,]+)', f[f.index('II. Movements in Issued'):])
    bb = re.search(r'Increase/ decrease \(-\) in issued shares \(excluding treasury shares\): (-?[\d,]+)', f)
    return {'month': month, 'issued_ex_treasury': n(m.group(1)), 'treasury': n(m.group(2)), 'issued_total': n(m.group(3)),
            'other_movement': n(bb.group(1)) if bb else 0, 'source_url': url}


def main():
    months = int(sys.argv[1]) if len(sys.argv) > 1 else 14
    rows = sorted((parse(u) for u in discover(months)), key=lambda r: r['month'])
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1) + '\n')
    print(f'wrote {len(rows)} months: {rows[0]["month"]}..{rows[-1]["month"]}')


if __name__ == '__main__':
    main()
