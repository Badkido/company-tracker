"""Track PDD ADS holdings of the investors in config.json via 13F-HR information tables.

Writes kind=investor entries to log.json when a position is opened/closed or changes by >10%.
CIKs and the PDD CUSIP must be filled in config.json (verified from EDGAR / the 13F text, never guessed).
"""
import re
import sys
import xml.etree.ElementTree as ET

from common import filing_index, filing_url, load, recent_filings, save, sec_get, submissions


def holdings(cik, filing, cusip):
    idx = filing_index(cik, filing["accession"])
    xmls = [i["name"] for i in idx["directory"]["item"] if i["name"].lower().endswith(".xml") and "primary_doc" not in i["name"].lower()]
    shares = value = total = 0
    for n in xmls:
        root = ET.fromstring(sec_get(filing_url(cik, filing["accession"], n)).content)
        for it in root.iter():
            if not it.tag.endswith("infoTable"):
                continue
            g = lambda tag: next((c.text for c in it.iter() if c.tag.endswith(tag)), None)
            v = int(g("value") or 0)
            total += v
            if (g("cusip") or "").upper() == cusip.upper():
                shares += int(g("sshPrnamt") or 0)
                value += v
    return {"shares": shares, "value": value, "total": total}


def quarter_of(report_date):
    y, m = int(report_date[:4]), int(report_date[5:7])
    return f"{y % 100:02d}Q{(m - 1) // 3 + 1}"


def run(company="pdd"):
    cfg = load(company, "config")["thirteenf"]
    if not cfg.get("pdd_cusip") or any(not i.get("cik") for i in cfg["investors"]):
        raise SystemExit("config.json thirteenf: fill pdd_cusip and every investor cik first (verify on EDGAR)")
    log = load(company, "log")
    have = {r["id"] for r in log}
    for inv in cfg["investors"]:
        sub = submissions(inv["cik"])
        fl = [f for f in recent_filings(sub, {"13F-HR", "13F-HR/A"})][:2]
        rep = {f["accession"]: sub["filings"]["recent"]["reportDate"][sub["filings"]["recent"]["accessionNumber"].index(f["accession"])] for f in fl}
        if len(fl) < 2:
            print(f"{inv['name']}: fewer than two 13F filings, skipping")
            continue
        new, old = (holdings(inv["cik"], f, cfg["pdd_cusip"]) for f in fl)
        q = quarter_of(rep[fl[0]["accession"]])
        print(f"{inv['name']} {q}: {old['shares']:,} -> {new['shares']:,} shares")
        if new["shares"] == old["shares"]:
            continue
        pct = None if not old["shares"] else new["shares"] / old["shares"] - 1
        if old["shares"] == 0:
            action = "建仓 PDD"
        elif new["shares"] == 0:
            action = "清仓 PDD"
        elif abs(pct) > 0.10:
            action = "加仓 PDD" if pct > 0 else "减仓 PDD"
        else:
            continue
        weight = new["value"] / new["total"] if new["total"] else 0
        detail = (f"{'增至' if pct and pct > 0 else '降至'} {new['shares'] / 10000:,.1f} 万股"
                  + (f"（{pct:+.0%}）" if pct is not None else "") + f"，占组合 {weight:.1%}")
        eid = f"i-{re.sub(r'[^a-z]', '', inv['name'].lower())[:6]}-{q}"
        if eid in have or any(r["kind"] == "investor" and r.get("quarter") == q and inv.get("alias", "\0") in r["title"] for r in log):
            continue
        log.append({"id": eid, "date": rep[fl[0]["accession"]], "quarter": q, "kind": "investor",
                    "title": f"{inv['name']} {action}", "detail": detail,
                    "source": filing_url(inv["cik"], fl[0]["accession"], "")})
    save(company, "log", log)


if __name__ == "__main__":
    run(*sys.argv[1:])
