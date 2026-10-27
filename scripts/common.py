"""Shared helpers: paths, JSON IO, SEC HTTP client."""
import json
import os
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

_last_call = 0.0


def load(company, name):
    return json.loads((DATA / company / f"{name}.json").read_text(encoding="utf-8"))


def save(company, name, obj):
    path = DATA / company / f"{name}.json"
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def sec_get(url, **kw):
    """GET with the SEC-required User-Agent (SEC_USER_AGENT secret, e.g. 'Name email'), <=10 req/s."""
    global _last_call
    ua = os.environ.get("SEC_USER_AGENT")
    if not ua:
        raise SystemExit("SEC_USER_AGENT is not set (format: 'Your Name your@email')")
    wait = 0.15 - (time.time() - _last_call)
    if wait > 0:
        time.sleep(wait)
    _last_call = time.time()
    r = requests.get(url, headers={"User-Agent": ua, "Accept-Encoding": "gzip, deflate"}, timeout=60, **kw)
    r.raise_for_status()
    return r


def submissions(cik):
    return sec_get(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json").json()


def filing_index(cik, accession):
    acc = accession.replace("-", "")
    return sec_get(f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc}/index.json").json()


def filing_url(cik, accession, name):
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{name}"


def recent_filings(sub, forms):
    r = sub["filings"]["recent"]
    for i, form in enumerate(r["form"]):
        if form in forms:
            yield {"form": form, "accession": r["accessionNumber"][i], "date": r["filingDate"][i],
                   "primary": r["primaryDocument"][i]}
