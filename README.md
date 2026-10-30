# 公司追踪看板

静态网站 + Python 定时任务。设计与口径见 [SPEC.md](SPEC.md)。目前有 PDD 和腾讯（0700.HK，说明见 SPEC_tencent）。

## 目录
- `site/` 前端（HTML + d3，读 `data/` 下的 JSON）；`data/<公司>/` 数据；`scripts/` 抽取脚本；`.github/workflows/` 定时任务与部署。
- 本地预览：在仓库根目录 `python3 -m http.server`，打开 `http://localhost:8000/site/`。

## 手动触发各任务
GitHub → Actions → 选 `price` / `edgar` / `13f` / `qual` / `deploy` → Run workflow。本地：
```bash
pip install -r requirements.txt
cd scripts
python price.py pdd
SEC_USER_AGENT="姓名 邮箱" python edgar_pdd.py check      # 或 backfill（回补并与 seed 核对）
SEC_USER_AGENT="姓名 邮箱" python thirteenf.py pdd
ANTHROPIC_API_KEY=... python qual_draft.py weekly          # 或 qa <文字稿.txt>
python validate.py pdd
```
需要的仓库 Secrets：`SEC_USER_AGENT`（"姓名 邮箱"）、`ANTHROPIC_API_KEY`。

## 改手工参数
只改 `data/pdd/config.json`（税率、`eps26e_rmb`、`market_view`、13F 名单与 CIK/CUSIP、模型名）。其他 JSON 由脚本生成；情景表 `scen.json` 手工维护。

## 新增一家公司
1. `data/companies.json` 加一行；建 `data/<id>/`，放 `config.json`、`fin.json` 等同结构文件（不适用字段为 `null`）。
2. 在 `scripts/` 写该公司的 adapter（输出与 `fin.json` 相同字段），在 workflows 里加任务。
3. 前端：复制 `index.html` 里 `#pdd` 区块并按 id 改名，`app.js` 的 `main()` 按公司 id 读取数据（目前仅 PDD 已接通）。

## 待办 / 未验证
- `edgar_pdd.py` 只用合成的新闻稿 HTML 测过，需要用真实 6-K 跑 `backfill` 验收（SPEC 3.4、9.2）。
- `thirteenf.py` 需先填 CIK 与 CUSIP（config.json 里为 `null`）。
- 净现金按 SPEC 4.1 自动计算；6-K 无长期投资科目，用 config.json 的 `lt_inv_manual_rmb_mn`（46046，由原手工 74.0 倒推），每年 20-F 后更新。

## 腾讯（0700.HK）
- 数据：`data/tencent/`。`fin.json`（12 个季度，来自港交所披露易业绩公告）、`shares.json`（月报表股本）、`val.json`（行情与汇率）、`config.json`（手工参数）、`ai.json`/`log.json`（定性，Claude 起草后人工审核）。`holders.json`（权益披露，`hkex_di.py`）、`people.json`（年报“董事及高级管理层”，手工整理自 2025 年年报，年度更新）。
- 页面：`site/tencent.js`，四个标签页；估值框架在前端按 `config.json` 参数实时计算（每股价值 = ① 核心业务 ＋ ② 投资组合 ＋ ③ 净现金 − ④ AI 拖累，公式见 SPEC_tencent §5.2）。
- 手动触发（GitHub → Actions → `tencent`，选 `price` / `results` / `monthly`）。本地：
```bash
cd scripts
python hkex_tencent.py backfill 12   # 回补 12 个季度（会缓存 PDF 文本到 scripts/.cache_tencent）
python hkex_tencent.py check         # 只处理新公告
python hkex_monthly.py 14
python hkex_di.py                    # 主要股东（权益披露）
python price_tencent.py
python validate_tencent.py
```
- `config.json` 参数：`pe_options/pe_default` 核心 PE；`disc_options/disc_default` 投资组合折扣；`ai_modes/ai_mode_default` AI 拖累口径（不扣 / 近 4 季 / 最新季 ×4）；`r_options/r_default` 零增长要求回报率；`tax_override` 非空则覆盖有效税率；`market_view` 一行市场观点。
- 不做：日度回购、南向资金。定性内容不走 `qual_draft.py`，由外部 agent 按 `inbox/AGENT_PROMPT_tencent.md` 提交 PR。未完成：`op_exai` 之前季度的 AI 拖累（公司未披露，按 0 计）。研发费用公告不单列，表中为含研发的一般及行政。
