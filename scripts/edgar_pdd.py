"""PDD 6-K earnings-release extractor.

  python edgar_pdd.py check              # look for a new 6-K; extract; validate; write or stage
  python edgar_pdd.py backfill           # re-extract history, fill nulls, compare with seed

Numbers come only from the release tables (RMB thousands -> RMB millions). Anything that can't be
matched stays null. Exit code 0 = published/no news, 2 = validation failed (staged for a PR).
"""
import json
import re
import sys
from datetime import datetime, timezone

from bs4 import BeautifulSoup

from common import DATA, filing_index, filing_url, load, recent_filings, save, sec_get, submissions
from snapshot import refresh
from validate import qkey, validate_row

CIK = "0001737806"

# field -> (statement, regex on normalised label). First match in the statement wins.
FIELDS = {
    "rev": ("is", r"^(total )?revenues$"),
    "oms": ("is", r"^online marketing services and others$"),
    "ts": ("is", r"^transaction services$"),
    "cogs": ("is", r"^costs? of revenues$"),
    "sm": ("is", r"^sales and marketing expenses$"),
    "op": ("is", r"^operating profit$"),
    "op_ng": ("ng", r"^non-gaap operating profit$"),
    "ni_ng": ("ng", r"^non-gaap net income attributable to ordinary shareholders$"),
    "cfo": ("cf", r"^net cash generated from operating activities$"),
    "ncf": ("cf", r"^\(?(net )?(increase|decrease)\)?/?\(?(increase|decrease)?\)? in cash, cash equivalents and restricted cash$"),
    "cash": ("bs", r"^cash and cash equivalents$"),
    "restricted": ("bs", r"^restricted cash.*$"),
    "recv": ("bs", r"^receivables from online payment platforms$"),
    "due_from_rel": ("bs", r"^amounts? due from related parties$"),
    "prepay": ("bs", r"^prepayments and other current assets$"),
    "ppe": ("bs", r"^property, equipment and software, net$"),
    "inventory": ("bs", r"^inventor(y|ies)$"),
    "pay_merch": ("bs", r"^payables? to merchants$"),
    "merch_dep": ("bs", r"^merchant deposits$"),
    "accrued": ("bs", r"^accrued expenses and other liabilities$"),
    "advances": ("bs", r"^customer advances and deferred revenues$"),
    "due_to_rel": ("bs", r"^amounts? due to related parties$"),
}
STMT_MARK = {
    "is": r"total revenues",
    "ng": r"non-gaap operating profit",
    "cf": r"net cash generated from operating activities",
    "bs": r"total (current )?assets",
}
MONTHS = "january february march april may june july august september october november december".split()


def norm(s):
    s = re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip().lower()
    s = re.sub(r"^[-–•]\s*", "", s)
    return re.sub(r"\s*[\(\[]?(\d{1,2}|[*†‡])[\)\]]?$", "", s) if re.search(r"[a-z]\s*[\(\[](\d{1,2}|[*†‡])[\)\]]$", s) else s


def num(s):
    s = s.replace("\xa0", "").replace(",", "").replace("$", "").strip()
    m = re.fullmatch(r"\(?(-?\d+(?:\.\d+)?)\)?", s)
    if not m:
        return None
    v = float(m.group(1))
    return -v if s.startswith("(") else v


def table_rows(table):
    rows = []
    for tr in table.find_all("tr"):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
        cells = [c for c in cells if c not in ("", ")", "%", "$")]
        if cells:
            rows.append(cells)
    return rows


def pick_value(rows, label_rx, want_col):
    """Return (value_in_thousands, matched_label) from the first row matching label_rx."""
    for cells in rows:
        if re.search(label_rx, norm(cells[0])):
            vals = [num(c) for c in cells[1:]]
            vals = [v for v in vals if v is not None]
            if len(vals) > want_col:
                return vals[want_col], cells[0]
    return None, None


def current_col(rows, kind):
    """Index of the latest-period RMB column among the numeric columns.

    Release tables list e.g. [prior-year RMB, current RMB, current US$] (income/cash flow) or
    [prior year-end RMB, current RMB, current US$] (balance sheet). The first column carrying the
    max year in the header is the RMB one for the current period. For quarterly flow statements the
    'three months ended' columns come first, so only the header prefix is considered.
    """
    hdr = []
    for cells in rows[:6]:
        years = [(i, int(m)) for i, c in enumerate(cells) for m in re.findall(r"\b(20\d\d)\b", c)]
        if len(years) >= 2:
            hdr = years
            break
    if not hdr:
        return 1
    top = max(y for _, y in hdr)
    ordered = [y for _, y in hdr]
    return ordered.index(top)


def find_release(cik, filing):
    idx = filing_index(cik, filing["accession"])
    names = [it["name"] for it in idx["directory"]["item"]]
    cands = [n for n in names if re.search(r"(ex-?99|ex99).*\.htm$", n, re.I)]
    for n in cands:
        html = sec_get(filing_url(cik, filing["accession"], n)).text
        if re.search(r"unaudited financial results|financial results for the", html, re.I):
            return n, html
    return None, None


def period_of(html):
    t = BeautifulSoup(html, "html.parser").get_text(" ")
    m = re.search(r"(first|second|third|fourth) quarter(?: and fiscal year)? (20\s*\d\s*\d)", t, re.I)
    if m:
        n = ["first", "second", "third", "fourth"].index(m.group(1).lower()) + 1
        year = int(re.sub(r"\s", "", m.group(2)))
        return f"{year % 100:02d}Q{n}"
    m = re.search(r"three months ended\s+(" + "|".join(MONTHS) + r")\s+\d{1,2},?\s+(20\d\d)", t, re.I)
    if not m:
        return None
    month = MONTHS.index(m.group(1).lower()) + 1
    return f"{int(m.group(2)) % 100:02d}Q{(month - 1) // 3 + 1}"


def extract(html, source_url=None):
    q = period_of(html)
    if not q:
        raise ValueError("cannot determine quarter from release text")
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ")
    scale = 1000 if re.search(r"in thousands", text, re.I) else 1  # releases moved from RMB thousands to millions
    bs_rows, flow_rows = [], []
    for t in soup.find_all("table"):
        rows = table_rows(t)
        if rows and re.match(r"as of", norm(rows[0][0])):
            bs_rows += rows  # assets and liabilities are separate tables
        elif rows and any(re.search(r"three\s+months\s+ended", r[0], re.I) for r in rows[:2]):
            flow_rows += rows  # income statement, non-GAAP reconciliation, cash flow
    tables = {"bs": bs_rows or None, "is": flow_rows or None, "ng": flow_rows or None, "cf": flow_rows or None}
    row, labels = {"q": q}, {}
    for k, (stmt, rx) in FIELDS.items():
        rows = tables[stmt]
        if not rows:
            row[k] = None
            continue
        v, lab = pick_value(rows, rx, current_col(rows, stmt))
        row[k] = None if v is None else int(round(v / scale))
        if k in ("cogs", "sm") and row[k] is not None:
            row[k] = abs(row[k])  # stored positive (SPEC 3.3)
        if lab:
            labels[k] = lab
    # cash + short-term investments, convertible bonds
    if tables["bs"]:
        col = current_col(tables["bs"], "bs")
        sti, lab = pick_value(tables["bs"], r"^short-term investments$", col)
        if row["cash"] is not None and sti is not None:
            row["cash_sti"] = row["cash"] + int(round(sti / scale))
            labels["cash_sti"] = f"cash and cash equivalents + {lab}"
        else:
            row["cash_sti"] = None
        debt = 0
        for cells in tables["bs"]:
            if re.search(r"convertible (senior )?(bonds|notes)", norm(cells[0])):
                vals = [v for v in map(num, cells[1:]) if v is not None]
                if len(vals) > col:
                    debt += int(round(vals[col] / scale))
        row["debt"] = debt
        lt, labs = 0, []
        for cells in tables["bs"]:
            if re.search(r"^(long-term (investments|time deposits)|time deposits.*non-?current|non-?current time deposits)", norm(cells[0])):
                vals = [v for v in map(num, cells[1:]) if v is not None]
                if len(vals) > col:
                    lt += int(round(vals[col] / scale))
                    labs.append(cells[0])
        row["lt_inv"] = lt if labs else None
        if labs:
            labels["lt_inv"] = " + ".join(labs)
    row["source_url"] = source_url
    row["extracted_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return row, labels


def merge_into(fin, row, keep_seed=()):
    by = {r["q"]: r for r in fin}
    old = by.get(row["q"], {})
    if row["q"] in keep_seed:  # audited seed (20-F basis) wins over the unaudited 6-K
        return fin, []
    conflicts = [f"{row['q']}: {k} seed={old[k]} extracted={row[k]}" for k in old
                 if isinstance(old[k], (int, float)) and isinstance(row.get(k), (int, float)) and abs(old[k] - row[k]) > 1]
    if conflicts:
        return fin, conflicts
    by[row["q"]] = {**old, **{k: v for k, v in row.items() if v is not None or k not in old}}
    out = sorted(by.values(), key=lambda r: qkey(r["q"]))
    return out[-12:], []


def sixks(cik=CIK, limit=14):
    sub = submissions(cik)
    return list(recent_filings(sub, {"6-K"}))[: limit * 4]


def run(mode):
    fin = load("pdd", "fin")
    labels_path = DATA / "pdd" / "labels.json"
    all_labels = json.loads(labels_path.read_text()) if labels_path.exists() else {}
    known = {r["q"] for r in fin}
    report, failed = [], False
    n_seen = 0
    for f in sixks():
        name, html = find_release(CIK, f)
        if not html:
            continue
        n_seen += 1
        try:
            row, labels = extract(html, filing_url(CIK, f["accession"], name))
        except ValueError as e:
            report.append(f"skip {f['accession']}: {e}")
            continue
        if qkey(row["q"]) < qkey("23Q3"):
            continue
        if mode == "check" and row["q"] in known and all(fin_row.get("rev") for fin_row in fin if fin_row["q"] == row["q"]):
            break  # newest known quarter reached
        prev_q = sorted(known | {row["q"]}, key=qkey)
        prev = next((r for r in reversed(sorted(fin, key=lambda r: qkey(r["q"]))) if qkey(r["q"]) < qkey(row["q"])), None)
        prev_labels = all_labels.get(prev["q"]) if prev else None
        errs, warns = validate_row(row, prev, labels, prev_labels)
        fin_new, conflicts = merge_into(fin, row, load("pdd", "config").get("seed_authoritative", []))
        errs += conflicts
        report += [f"ERROR {e}" for e in errs] + [f"WARN {w}" for w in warns]
        if errs:
            failed = True
            (DATA / "pdd" / "pending").mkdir(exist_ok=True)
            (DATA / "pdd" / "pending" / f"{row['q']}.json").write_text(json.dumps({"row": row, "labels": labels}, ensure_ascii=False, indent=1))
            continue
        fin, known = fin_new, {r["q"] for r in fin_new}
        all_labels[row["q"]] = labels
        report.append(f"OK {row['q']} from {row['source_url']}")
        if mode == "check":
            break
    if not failed:
        save("pdd", "fin", fin)
        refresh("pdd")
        labels_path.write_text(json.dumps(all_labels, ensure_ascii=False, indent=1) + "\n")
    out = DATA / "pdd" / "extract_report.txt"
    out.write_text("\n".join(report) + "\n")
    print("\n".join(report) or f"no new releases ({n_seen} checked)")
    return 2 if failed else 0


if __name__ == "__main__":
    sys.exit(run(sys.argv[1] if len(sys.argv) > 1 else "check"))
