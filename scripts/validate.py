"""Validation gate for extracted quarterly data (SPEC section 5).

validate_row() returns (errors, warnings). Any error blocks auto-publish.
CLI: `python validate.py [company]` checks every row already in fin.json.
"""
import sys

from common import load

REQUIRED_BS = ["cash", "restricted", "cash_sti", "recv", "due_from_rel", "prepay", "ppe",
               "pay_merch", "merch_dep", "accrued", "advances", "due_to_rel", "debt"]
REQUIRED_IS = ["rev", "oms", "ts", "cogs", "sm", "op", "op_ng", "ni_ng", "cfo", "ncf"]
SKIP_JUMP = {"ppe": "26Q2"}  # known jump, SPEC 5.4


def qkey(q):
    return int(q[:2]) * 4 + int(q[3])


def validate_row(row, prev=None, labels=None, prev_labels=None, annual=None):
    errors, warnings = [], []
    q = row["q"]
    for k in REQUIRED_IS + REQUIRED_BS:
        if row.get(k) is None:
            errors.append(f"{q}: {k} is empty")
    if not errors:
        if abs(row["oms"] + row["ts"] - row["rev"]) > 1:
            errors.append(f"{q}: oms+ts={row['oms'] + row['ts']} != rev={row['rev']}")
        if row["cash"] > row["cash_sti"]:
            errors.append(f"{q}: cash {row['cash']} > cash_sti {row['cash_sti']}")
        if row["op_ng"] < row["op"]:
            errors.append(f"{q}: op_ng {row['op_ng']} < op {row['op']}")
    if prev:
        for k, v in row.items():
            p = prev.get(k)
            if isinstance(v, (int, float)) and isinstance(p, (int, float)) and p and k != "q":
                if abs(v / p - 1) > 0.5 and SKIP_JUMP.get(k) != q:
                    warnings.append(f"{q}: {k} moved {v / p - 1:+.0%} vs prior quarter ({p} -> {v})")
    if labels and prev_labels:
        for k, lab in labels.items():
            if k in prev_labels and prev_labels[k] != lab:
                errors.append(f"{q}: label for {k} changed: '{prev_labels[k]}' -> '{lab}'")
    if annual:  # {"rev": full-year value in RMB mn, "quarters": [4 rows]}
        for k, total in annual.get("totals", {}).items():
            qs = [r.get(k) for r in annual["quarters"]]
            if total and None not in qs and abs(sum(qs) / total - 1) > 0.005:
                errors.append(f"{q}: sum of quarterly {k} {sum(qs)} differs from annual {total} by >0.5%")
    return errors, warnings


def validate_file(company="pdd"):
    fin = sorted(load(company, "fin"), key=lambda r: qkey(r["q"]))
    bad = 0
    for i, row in enumerate(fin):
        # historical rows may have unfilled balance sheets; only identities are enforced here
        errs = []
        if None not in (row.get("oms"), row.get("ts"), row.get("rev")) and abs(row["oms"] + row["ts"] - row["rev"]) > 1:
            errs.append("oms+ts != rev")
        if row.get("cash") is not None and row.get("cash_sti") is not None and row["cash"] > row["cash_sti"]:
            errs.append("cash > cash_sti")
        if None not in (row.get("op_ng"), row.get("op")) and row["op_ng"] < row["op"]:
            errs.append("op_ng < op")
        if errs:
            bad += 1
            print(f"FAIL {row['q']}: {', '.join(errs)}")
    print(f"{len(fin)} quarters checked, {bad} failing")
    return bad


if __name__ == "__main__":
    sys.exit(1 if validate_file(*sys.argv[1:]) else 0)
