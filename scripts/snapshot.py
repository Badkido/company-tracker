"""Recompute derived val.json fields from the latest fin.json row (SPEC 4.1).

net_cash_usd_bn = (cash_sti + lt_inv - debt) / fx / 1000   (restricted cash excluded)
Derived fields are only overwritten when every input is present; otherwise the manual value stays.
"""
import sys

from common import load, save


def refresh(company="pdd"):
    cfg, val, fin = load(company, "config"), load(company, "val"), load(company, "fin")
    snap = next(v for v in val if v["item"] == "snapshot")
    last, fx = fin[-1], snap["fx"]
    done = []
    if cfg.get("net_cash_auto") and None not in (last.get("cash_sti"), last.get("lt_inv"), last.get("debt")):
        snap["net_cash_usd_bn"] = round((last["cash_sti"] + last["lt_inv"] - last["debt"]) / fx / 1000, 1)
        done.append("net_cash_usd_bn")
    if last.get("restricted") is not None:
        snap["restricted_usd_bn"] = round(last["restricted"] / fx / 1000, 1)
        done.append("restricted_usd_bn")
    if last.get("ads_diluted_mn"):
        snap["ads_mn"] = last["ads_diluted_mn"]
        done.append("ads_mn")
    save(company, "val", val)
    print("snapshot refreshed:", ", ".join(done) or "nothing (inputs missing, manual values kept)")


if __name__ == "__main__":
    refresh(*sys.argv[1:])
