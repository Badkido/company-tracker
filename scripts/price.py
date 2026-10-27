"""Update val.json price / fx / date from yfinance. Run on weekdays after the US close."""
import sys

import yfinance as yf

from common import load, save
from snapshot import refresh


def last_close(ticker):
    h = yf.Ticker(ticker).history(period="5d")["Close"].dropna()
    if h.empty:
        raise SystemExit(f"no price data for {ticker}")
    return float(h.iloc[-1]), h.index[-1].strftime("%Y-%m-%d")


def main(company="pdd"):
    cfg = load(company, "config")
    val = load(company, "val")
    price, day = last_close(cfg["price_ticker"])
    fx, _ = last_close(cfg["fx_ticker"])
    if not (0 < price < 10000 and 3 < fx < 12):
        raise SystemExit(f"implausible quote price={price} fx={fx}")
    snap = next(v for v in val if v["item"] == "snapshot")
    snap.update(price_usd=round(price, 2), price_date=day, fx=round(fx, 4))
    save(company, "val", val)
    refresh(company)
    print(f"{company}: {price:.2f} USD, fx {fx:.4f}, {day}")


if __name__ == "__main__":
    main(*sys.argv[1:])
