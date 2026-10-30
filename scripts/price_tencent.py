"""腾讯行情：0700.HK 收盘价与 HKD/CNY → data/tencent/val.json。yfinance 为主，失败时用 Yahoo chart 接口，再失败保留旧值。
用法：python price_tencent.py
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import requests

DATA = Path(__file__).resolve().parent.parent / 'data' / 'tencent'


def via_yfinance(sym):
    import yfinance as yf
    h = yf.Ticker(sym).history(period='5d')['Close'].dropna()
    return float(h.iloc[-1]), h.index[-1].strftime('%Y-%m-%d')


def via_chart(sym):
    r = requests.get(f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=5d&interval=1d',
                     headers={'User-Agent': 'Mozilla/5.0'}, timeout=30)
    r.raise_for_status()
    res = r.json()['chart']['result'][0]
    pts = [(t, c) for t, c in zip(res['timestamp'], res['indicators']['quote'][0]['close']) if c is not None]
    t, c = pts[-1]
    return float(c), datetime.fromtimestamp(t + res['meta'].get('gmtoffset', 0), timezone.utc).strftime('%Y-%m-%d')


def quote(sym):
    for f in (via_yfinance, via_chart):
        try:
            return f(sym)
        except Exception as e:  # noqa: BLE001
            print(f'{f.__name__} failed for {sym}: {e}')
    return None


def main():
    f = DATA / 'val.json'
    val = json.loads(f.read_text()) if f.exists() else {}
    px, fx = quote('0700.HK'), quote('HKDCNY=X')
    if px and 10 < px[0] < 3000:
        val.update(price_hkd=round(px[0], 2), price_date=px[1], stale=False)
    else:
        val['stale'] = True
    if fx and 0.5 < fx[0] < 1.5:
        val['fx_cny_per_hkd'] = round(fx[0], 4)
    f.write_text(json.dumps(val, ensure_ascii=False, indent=1) + '\n')
    print(val)


if __name__ == '__main__':
    main()
