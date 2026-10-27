"""Draft qualitative log entries with Claude. Output is a PR for Danny to review, never auto-published.

  python qual_draft.py qa <transcript.txt>   # management Q&A after a new quarter (kind=qa)
  python qual_draft.py weekly                # last 7 days of PDD/Temu news (view/event/temu/team)

New entries are appended to log.json and a Chinese PR body is written to data/pdd/pr_body.md.
If there is nothing material, nothing is written and the exit code is 0 (workflow opens no PR).
"""
import json
import re
import sys
from datetime import date

import anthropic

from common import DATA, load, save

QA_RULES = ("只保留有信息量的实质回答；套话、口水话、重复的战略表述一律忽略。"
            "每条：一句话标题(title) + 一句话补充(detail)，最多 4 条。")
WEEKLY_RULES = ("搜索过去 7 天 PDD / Temu 的：监管处罚与政策（中、美、欧）、Temu 动态、董事/高管变动、"
                "主要投行评级或目标价的明显变化。只记录重大变化；没有就返回空数组。每条必须带可访问的 source URL。")
SCHEMA = ('只输出 JSON 数组，不要其他文字。元素字段：kind(qa|view|event|temu|team), date(YYYY-MM-DD), '
          'quarter(如 26Q3), title, detail, source(URL)。')


def call(prompt, web=False):
    cfg = load("pdd", "config")["qual"]
    client = anthropic.Anthropic()
    kw = {"tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 8}]} if web else {}
    msg = client.messages.create(model=cfg["model"], max_tokens=4000,
                                 messages=[{"role": "user", "content": prompt}], **kw)
    text = "".join(b.text for b in msg.content if b.type == "text")
    m = re.search(r"\[.*\]", text, re.S)
    return json.loads(m.group(0)) if m else []


def latest_quarter():
    return load("pdd", "fin")[-1]["q"]


def add(entries):
    log = load("pdd", "log")
    have = {(r["kind"], r["title"]) for r in log}
    prefix = {"qa": "q", "view": "v", "event": "e", "temu": "t", "team": "m"}
    out = []
    for e in entries:
        if not e.get("source") or (e["kind"], e["title"]) in have or e["kind"] not in prefix:
            continue
        n = 1 + max([int(re.sub(r"\D", "", r["id"]) or 0) for r in log if r["kind"] == e["kind"]] + [0])
        e["id"] = f"{prefix[e['kind']]}{n}"
        log.append(e)
        out.append(e)
    if out:
        save("pdd", "log", log)
        body = ["## 自动起草的条目（请审核）\n"] + [f"- **[{e['kind']}] {e['title']}** — {e['detail']}（[来源]({e['source']})）" for e in out]
        (DATA / "pdd" / "pr_body.md").write_text("\n".join(body) + "\n", encoding="utf-8")
    print(f"{len(out)} new entries")


def main(mode, arg=None):
    if mode == "qa":
        text = open(arg, encoding="utf-8").read() if arg else ""
        if not text:
            (DATA / "pdd" / "pr_body.md").write_text("业绩会文字稿未取得，请粘贴文字稿后重新运行 `qual_draft.py qa <文件>`。\n", encoding="utf-8")
            return
        add(call(f"季度 {latest_quarter()} 的业绩会文字稿如下。{QA_RULES}\n{SCHEMA}\nkind 固定为 qa。\n\n{text}"))
    elif mode == "weekly":
        add(call(f"今天是 {date.today()}。{WEEKLY_RULES}\n{SCHEMA}", web=True))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(*sys.argv[1:])
