"""Merge entries dropped into inbox/*.json (by an external agent or qual_draft) into data/pdd/log.json.

Each inbox file is a JSON array of {kind, date, title, detail, source[, quarter]}. Nothing is written
unless every entry in every file is valid; processed files move to inbox/processed/.
"""
import json
import re
import sys
from pathlib import Path

from common import ROOT, load, save

KINDS = {
    "pdd": {"view", "event", "temu", "team", "qa", "investor"},
    "tencent": {"view", "event", "team", "qa", "holder"},
}
PREFIX = {"view": "v", "event": "e", "temu": "t", "team": "m", "qa": "q", "investor": "i", "holder": "h"}
AI_KINDS = {"财报", "管理层", "第三方", "市场"}
INBOX = ROOT / "inbox"


def calendar_quarter(d):
    return f"{int(d[:4]) % 100:02d}Q{(int(d[5:7]) - 1) // 3 + 1}"


def check(e, company="pdd"):
    errs = []
    if e.get("kind") == "ai_log" and company == "tencent":
        return check_ai(e)
    if e.get("kind") not in KINDS[company]:
        errs.append(f"bad kind {e.get('kind')!r}")
    if not re.fullmatch(r"20\d\d-\d\d(-\d\d)?", str(e.get("date", ""))):
        errs.append("date must be YYYY-MM-DD")
    for k in ("title", "detail"):
        if not str(e.get(k, "")).strip():
            errs.append(f"{k} is empty")
    if not re.match(r"https?://", str(e.get("source", ""))):
        errs.append("source must be a URL")
    if e.get("kind") == "qa" and not re.fullmatch(r"\d\dQ[1-4]", str(e.get("quarter", ""))):
        errs.append("qa entries need quarter like 26Q3")
    return errs


def check_ai(e):
    """腾讯 AI 产出：给某个产品追加一条动态（ai.json → products[].logs）。"""
    errs = []
    if not re.fullmatch(r"20\d\d-\d\d-\d\d", str(e.get("date", ""))):
        errs.append("date must be YYYY-MM-DD")
    if not str(e.get("product", "")).strip():
        errs.append("product (id in ai.json) is required")
    if e.get("log_kind") not in AI_KINDS:
        errs.append(f"log_kind must be one of {sorted(AI_KINDS)}")
    if not str(e.get("text", "")).strip():
        errs.append("text is empty")
    if not re.match(r"https?://", str(e.get("source", ""))):
        errs.append("source must be a URL")
    return errs


def add_ai(entries):
    ai = load("tencent", "ai")
    prods = {p["id"]: p for p in ai["products"]}
    problems, added = [], 0
    for e in entries:
        errs = check_ai(e)
        if not errs and e["product"] not in prods:
            errs.append(f"unknown product {e['product']!r}; ids: {sorted(prods)}")
        if errs:
            problems.append(f"{e.get('text', '?')[:30]}: {'; '.join(errs)}")
            continue
        logs = prods[e["product"]]["logs"]
        if any(l["source"] == e["source"] and l["text"] == e["text"].strip() for l in logs):
            continue
        logs.append({"date": e["date"], "kind": e["log_kind"], "text": e["text"].strip(), "source": e["source"],
                     "secondhand": bool(e.get("secondhand", False))})
        added += 1
    if not problems and added:
        save("tencent", "ai", ai)
    return added, problems


def add(entries, company="pdd"):
    """Validate and append entries; returns (added, problems). Writes only if no problems."""
    log = load(company, "log")
    seen = {(r["kind"], r["title"]) for r in log} | {r.get("source") for r in log if r.get("source")}
    problems, added = [], []
    for e in entries:
        errs = check(e, company)
        if errs:
            problems.append(f"{e.get('title', '?')}: {'; '.join(errs)}")
            continue
        if (e["kind"], e["title"]) in seen or e["source"] in seen:
            continue  # duplicate, skip silently
        n = 1 + max([int(re.sub(r"\D", "", r["id"]) or 0) for r in log + added if r["kind"] == e["kind"]] + [0])
        new = {"id": f"{PREFIX[e['kind']]}{n}", "date": e["date"], "quarter": e.get("quarter") or calendar_quarter(e["date"]),
               "kind": e["kind"], "title": e["title"].strip(), "detail": e["detail"].strip(), "source": e["source"]}
        added.append(new)
        seen |= {(new["kind"], new["title"]), new["source"]}
    if not problems and added:
        save(company, "log", log + added)
    return added, problems


def main():
    files = sorted(p for p in INBOX.glob("*.json"))
    entries, problems = [], []
    for p in files:
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            assert isinstance(data, list)
        except Exception as ex:
            problems.append(f"{p.name}: not a JSON array ({ex})")
            continue
        entries += data
    added = []
    for company in ("pdd", "tencent"):
        mine = [e for e in entries if e.get("company", "pdd") == company and e.get("kind") != "ai_log"]
        a, more = add(mine, company)
        added += a
        problems += more
    ai_added, more = add_ai([e for e in entries if e.get("company") == "tencent" and e.get("kind") == "ai_log"])
    problems += more
    for line in problems:
        print("ERROR", line)
    if problems:
        sys.exit(1)
    (INBOX / "processed").mkdir(exist_ok=True)
    for p in files:
        p.rename(INBOX / "processed" / p.name)
    print(f"{len(added)} log entries and {ai_added} AI entries added from {len(files)} file(s)")


if __name__ == "__main__":
    main()
