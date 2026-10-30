"""腾讯业绩公告发现与抽取（HKEXnews → data/tencent/fin.json）。

用法：
  python hkex_tencent.py backfill [N]   # 回补最近 N 个季度（默认 12）
  python hkex_tencent.py check          # 只处理比 fin.json 更新的公告
依赖：requests、pypdf。金额单位：人民币百万元；十亿元精度字段在 _precision 里标 "0.1bn"。
"""
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from pypdf import PdfReader

import logging
logging.getLogger('pypdf').setLevel(logging.CRITICAL)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'tencent'
CACHE = ROOT / 'scripts' / '.cache_tencent'
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh) company-tracker personal research'}
STOCK_ID = 7609  # HKEXnews 内部 id（00700）
HOST = 'https://www1.hkexnews.hk'
NUM = r'\(?-?[\d,]+(?:\.\d+)?\)?\*?'


def get(url, headers=None, **kw):
    for i in range(3):
        try:
            r = requests.get(url, headers=headers or UA, timeout=60, **kw)
            r.raise_for_status()
            time.sleep(1)
            return r
        except requests.RequestException:
            if i == 2:
                raise
            time.sleep(2 ** i)


def discover(from_date='20230701'):
    to = datetime.now().strftime('%Y%m%d')
    url = (f'{HOST}/search/titleSearchServlet.do?sortDir=0&sortByOptions=DateTime&category=0&market=SEHK'
           f'&stockId={STOCK_ID}&documentType=-1&fromDate={from_date}&toDate={to}&title=RESULTS&searchType=1'
           '&t1code=-2&t2Gcode=-2&t2code=-2&rowRange=200&lang=EN')
    rows = json.loads(get(url).json()['result'])
    docs = []
    for r in rows:
        t = re.sub(r'\s+', ' ', re.sub('<[^>]+>', '', r['TITLE']))
        m = re.match(r'ANNOUNCEMENT OF THE (?:ANNUAL )?RESULTS FOR THE (.+) ENDED (\d+) (\w+) (\d{4})', t)
        if not m:
            continue
        month = datetime.strptime(m.group(3)[:3], '%b').month
        q = f'{m.group(4)[2:]}Q{(month - 1) // 3 + 1}'
        d = r['DATE_TIME'][:10].split('/')
        docs.append({'q': q, 'date': f'{d[2]}-{d[1]}-{d[0]}', 'url': HOST + r['FILE_LINK']})
    return sorted(docs, key=lambda x: x['q'])


def pdf_text(doc):
    CACHE.mkdir(exist_ok=True)
    f = CACHE / f"{doc['q']}.txt"
    if f.exists():
        return f.read_text()
    pdf = CACHE / f"{doc['q']}.pdf"
    pdf.write_bytes(get(doc['url']).content)
    txt = '\n'.join(p.extract_text() for p in PdfReader(str(pdf)).pages)
    f.write_text(txt)
    return txt


def n(s):
    s = s.replace(',', '').replace('*', '')
    neg = s.startswith('(') or s.startswith('-')
    v = float(s.strip('()-'))
    return -v if neg else v


def nums(line):
    return [n(x) for x in re.findall(NUM, line) if re.search(r'\d', x)]


class Doc:
    def __init__(self, text):
        self.text = text
        self.lines = [l.strip() for l in text.split('\n')]
        self.flat = re.sub(r'\s+', ' ', text)

    def first(self, label, start=0, end=None):
        """label 开头的行，返回其后的数字列表；标签折行时拼接下一行。"""
        for i in range(start, min(end or len(self.lines), len(self.lines))):
            if re.match(label, self.lines[i]):
                ns = nums(re.sub(label, '', self.lines[i], count=1))
                if not ns and i + 1 < len(self.lines):
                    ns = nums(self.lines[i + 1])
                if ns:
                    return i, ns
        return None, []

    def rx(self, pattern, start=0):
        m = re.search(pattern, self.flat[start:], re.I)
        return m


def bn(m, idx=1):
    return None if not m else round(float(m.group(idx).replace(',', '')) * 1000)


def extract(doc_meta, text):
    d = Doc(text)
    r = {'q': doc_meta['q'], 'announce_date': doc_meta['date']}
    prec = {}
    # 摘要表（首个表为当季）
    for k, lab in [('rev', r'Revenues'), ('gp', r'Gross profit'), ('op', r'Operating profit(?: \(Restated[^)]*\))?'),
                   ('op_ng', r'Non-IFRS operating profit(?: \(Restated[^)]*\))?')]:
        r[k] = d.first(lab)[1][0] if d.first(lab)[1] else None
    flat = d.flat
    m = re.search(r'Profit attributable to equity holders of the Company ([\d,]+)', flat)
    r['ni'] = n(m.group(1)) if m else None
    m = re.search(r'Non-IFRS profit attributable to equity holders of the Company ([\d,]+)', flat)
    r['ni_ng'] = n(m.group(1)) if m else None
    for k, pat in [('wx_mau', r'Combined MAU of Weixin and WeChat ([\d,]+)'), ('qq_mau', r'Mobile device MAU of QQ ([\d,]+)'),
                   ('vas_subs', r'Fee-based VAS (?:registered |paying )?subscriptions #? ?([\d,]+)')]:
        m = re.search(pat, flat)
        r[k] = n(m.group(1)) if m else None
    rev = r['rev']
    # 利润表：取首列等于当季收入的区块
    start = next((i for i, l in enumerate(d.lines) if re.match(r'Revenues\s+' + re.escape(f'{rev:,.0f}') + r'\b', l)
                  and any(x.startswith('Cost of revenues') for x in d.lines[i + 1:i + 4])), None)
    if start is None:
        start = 0
    end = start + 40
    for k, lab in [('sm', r'Selling and marketing expenses'), ('ga', r'General and administrative expenses'),
                   ('pbt', r'Profit before income tax'), ('tax', r'Income tax expense'),
                   ('assoc', r'Share of profit/\(loss\) of associates and joint ventures, net')]:
        v = d.first(lab, start, end)[1]
        r[k] = (abs(v[0]) if k in ('sm', 'ga', 'tax') else v[0]) if v else None
    # 分部收入：VAS+营销+金科+其他 = 当季收入 的那一组
    seg_pos = None
    for i, l in enumerate(d.lines):
        if re.match(r'(VAS|Value-added Services)\s+[\d,]+', l):
            vs = [d.first(a, i, i + 6)[1] for a in (r'(?:Marketing Services|Online Advertising)', r'FinTech and Business Services', r'Others')]
            if all(vs):
                tot = nums(l)[0] + sum(x[0] for x in vs)
                if abs(tot - rev) <= 1:
                    seg_pos = i
                    r['vas'], r['mkt'], r['fbs'], r['others'] = nums(l)[0], vs[0][0], vs[1][0], vs[2][0]
                    break
    # 分部毛利
    if seg_pos is not None:
        for i in range(seg_pos + 1, len(d.lines)):
            if re.match(r'(VAS|Value-added Services)\s+[\d,]+', d.lines[i]) and i > seg_pos + 4:
                vs = [d.first(a, i, i + 6)[1] for a in (r'(?:Marketing Services|Online Advertising)', r'FinTech and Business Services', r'Others')]
                if all(vs) and abs(nums(d.lines[i])[0] + sum(x[0] for x in vs) - r['gp']) <= 1:
                    r['gp_vas'], r['gp_mkt'], r['gp_fbs'], r['gp_others'] = nums(d.lines[i])[0], vs[0][0], vs[1][0], vs[2][0]
                    break
        # 十亿元精度的 VAS 拆分，只在 VAS 段落里取
        off = len('\n'.join(d.lines[:seg_pos]))
        for k, pat in [('game_dom', r'Domestic Games revenues[\s\S]{0,160}?RMB\s?([\d.]+)\s*billion'),
                       ('game_intl', r'International Games revenues[\s\S]{0,160}?RMB\s?([\d.]+)\s*billion'),
                       ('social', r'Social Networks revenues[\s\S]{0,160}?RMB\s?([\d.]+)\s*billion')]:
            m = d.rx(pat, int(off * 0.95))
            r[k] = bn(m)
            if m:
                prec[k] = '0.1bn'
    if 'gp_vas' not in r:
        for l in d.lines:
            if l.startswith('Gross profit/(loss)'):
                ns = nums(l)
                if len(ns) == 5 and abs(ns[-1] - r['gp']) <= 1:
                    r['gp_vas'], r['gp_mkt'], r['gp_fbs'], r['gp_others'] = ns[:4]
                    break
    # 现金与净现金
    for k, lab in [('cash', r'Cash and cash equivalents'), ('term', r'Term deposits and others'),
                   ('net_cash', r'Net cash(?:/\(debt\))?')]:
        i0 = next((i for i, l in enumerate(d.lines) if l.startswith('Borrowings (')), 0)
        v = d.first(lab, max(0, i0 - 8), i0 + 8)[1]
        r[k] = v[0] if v else None
    r['cash_total'] = r['cash'] + r['term'] if r['cash'] is not None and r['term'] is not None else None
    del r['cash'], r['term']
    for k, lab in [('capex', r'Capital expenditures \(d\)')]:
        v = d.first(lab)[1]
        r[k] = v[0] if v else None
    for k, pat in [('fcf', r'(?:negative )?free cash flow (?:for the [\w ]+ )?(?:of|was|were) (?:RMB)?\s?(-?[\d.]+) billion'),
                   ('cfo', r'operating activities of RMB\s?([\d.]+) billion'),
                   ('capex_paid', r'capital expenditure payments of RMB\s?([\d.]+)\s+billion'),
                   ('fcf_ex_prepay', r'Excluding the prepayments for compute procurement, our free cash flow would have been RMB\s?([\d.]+) billion')]:
        m = d.rx(pat)
        v = bn(m)
        if k == 'fcf' and m and re.search(r'negative free cash flow', m.group(0), re.I):
            v = -abs(v)
        r[k] = v
        if m:
            prec[k] = '0.1bn'
    m = d.rx(r'excluding new AI products\s*\d*\s*(?:contributions)?[\s\S]{0,100}?RMB\s?([\d.]+) billion')
    r['op_exai'] = bn(m)
    if m:
        prec['op_exai'] = '0.1bn'
    m = d.rx(r'fair value of our shareholdings\s*\d*\s*in listed investee companies[\s\S]{0,60}?RMB\s?([\d.,]+) billion')
    r['inv_listed_fv'] = bn(m)
    m = d.rx(r'excluding new AI products\s*\d*\s*(?:contributions,?)?\s*(?:increased|rose|grew) by (\d+)% year-on-year')
    r['op_exai_yoy_reported'] = int(m.group(1)) / 100 if m else None
    m = d.rx(r'Domestic Games revenues([\s\S]{0,700}?)International Games revenues')
    kw = m and re.search(r'deferr|Spring Festival|Lunar New Year|Chinese New Year|recognition', m.group(0), re.I)
    r['game_dom_note'] = ('…' + m.group(0)[max(0, kw.start() - 140):kw.start() + 100].strip() + '…') if kw else None
    m = d.rx(r'book value of our (?:shareholdings in )?unlisted (?:investee companies|investments)[\s\S]{0,60}?RMB\s?([\d.,]+) billion')
    r['inv_unlisted_bv'] = bn(m)
    # 资产负债表借款（先非流动、后流动）
    for k, lab in [('borrow', r'Borrowings \d+'), ('notes', r'Notes payable \d+')]:
        hits = [nums(re.sub(lab, '', l, count=1))[0] for l in d.lines if re.match(lab + r'\s+[\d,]+', l)][:2]
        r[k + '_nc'], r[k + '_cur'] = (hits + [None, None])[:2]
    # 非 IFRS 调节表中的联营利润
    if r.get('assoc') is not None:
        for i, l in enumerate(d.lines):
            if 'of associates and' in l or l.startswith('joint ventures, net'):
                seg = ' '.join(d.lines[i:i + 2])
                ns = nums(seg.split('net', 1)[-1]) if 'net' in seg else []
                if len(ns) >= 6 and ns[0] == r['assoc']:
                    r['assoc_ng'] = ns[-1]
                    break
    r.setdefault('assoc_ng', None)
    # 加权股数
    m = d.rx(r'for the calculation of diluted EPS \(million shares\) ([\d,]+)')
    r['wavg_diluted'] = n(m.group(1)) if m else None
    m = d.rx(r'scheme and treasury shares \(million shares\) ([\d,]+)')
    r['wavg_basic'] = n(m.group(1)) if m else None
    # 回购（期间累计，之后换算单季）
    m = d.rx(r'During the (three|six|nine) months ended [\w ]+, the Company repurchased a total of ([\d,]+) shares[\s\S]{0,80}?HKD\s?([\d.,]+) billion')
    m2 = d.rx(r'During the year ended [\w ]+, the Company repurchased a total of ([\d,]+) shares[\s\S]{0,80}?HKD\s?([\d.,]+) billion')
    if m:
        r['_bb'] = {'span': m.group(1), 'shares': n(m.group(2)) / 1e6, 'hkd': float(m.group(3).replace(',', '')) * 1000}
    elif m2:
        r['_bb'] = {'span': 'year', 'shares': n(m2.group(1)) / 1e6, 'hkd': float(m2.group(2).replace(',', '')) * 1000}
    r['_precision'] = prec
    r['source_url'] = doc_meta['url']
    r['source_lang'] = 'en'
    r['extracted_at'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    return r


def settle_buyback(rows):
    """把累计回购换算成单季（H1−Q1、9M 文案本身是单季、全年−前三季）。"""
    by = {r['q']: r for r in rows}
    for r in rows:
        bb = r.pop('_bb', None)
        r['buyback_shares'] = r['buyback_hkd'] = None
        if not bb:
            continue
        y, qq = r['q'][:2], int(r['q'][3])
        prior = [by.get(f'{y}Q{i}') for i in range(1, qq)]
        if bb['span'] in ('three',):
            r['buyback_shares'], r['buyback_hkd'] = bb['shares'], bb['hkd']
        elif all(p and p.get('buyback_shares') is not None for p in prior):
            r['buyback_shares'] = round(bb['shares'] - sum(p['buyback_shares'] for p in prior), 1)
            r['buyback_hkd'] = bb['hkd'] - sum(p['buyback_hkd'] for p in prior)
    for r in rows:
        if r.get('buyback_shares') is not None:
            r['buyback_shares'], r['buyback_hkd'] = round(r['buyback_shares'], 1), round(r['buyback_hkd'])
    return rows


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
    keep = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    docs = discover()
    OUT.mkdir(parents=True, exist_ok=True)
    f = OUT / 'fin.json'
    old = json.loads(f.read_text()) if f.exists() else []
    have = {r['q'] for r in old}
    # 公告里最新一期之前的期别需要同年前几季的回购，故全部重算
    todo = docs[-keep - 3:] if mode == 'backfill' else [d for d in docs if d['q'] not in have]
    rows = []
    for doc in todo:
        rows.append(extract(doc, pdf_text(doc)))
    if mode != 'backfill':
        rows = [r for r in old] + rows
    rows = settle_buyback(sorted(rows, key=lambda r: r['q']))
    rows = [r for r in rows][-keep:]
    f.write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    print(f'wrote {len(rows)} quarters: {rows[0]["q"]}..{rows[-1]["q"]}')


if __name__ == '__main__':
    main()
