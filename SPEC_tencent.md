# 公司追踪看板：腾讯（0700.HK）开发说明（交给 Claude Code）

> 使用人：Danny（个人自用，原则是**简单**）。本文件是在已有 PDD 看板（见 PDD 的 `SPEC.md`）之上**新增第二家公司**的说明。
> 通用部分（技术栈、目录结构、风格、通知、部署、访问控制）**沿用 PDD 的 SPEC**，本文件只写腾讯的差异。凡与 PDD SPEC 冲突处，以本文件为准，但仅限腾讯。
> 版式参考：Design 画布"腾讯追踪看板"（四个标签页，含模拟数据）。照它的布局实现，数字全部换成真实抽取结果。

---

## 0. 目标与原则（在 PDD 原则上补充）

1. **数字只来自原始披露**：港交所披露易（HKEXnews）上的公司公告、港交所 CCASS 持股纪录、交易所行情。**不使用任何卖方预测或第三方估算**（包括一致预期 EPS）。抽不到就 `null`，页面显示"—"。
2. 估值框架是本看板的主线：**每股价值 = ① 核心业务 ＋ ② 投资组合 ＋ ③ 净现金 − ④ AI 拖累**。页面上四部分必须各自独立成块，能一眼看出哪一部分本季有变化。
3. AI 产出（第 4 个标签页）**只做定性跟踪**，半自动（Claude 起草 → PR → Danny 审核）。等有稳定披露和数据源后再量化（见 §9.4 升级条件）。
4. 架构上腾讯是一个新的 adapter，输出与 PDD 结构相同、字段不同的 JSON；前端按公司配置渲染，**不要把腾讯的字段写死进 PDD 的组件，反之亦然**。

## 1. 与 PDD 的关键差异

| 项目 | PDD | 腾讯 |
|---|---|---|
| 披露地 | SEC（6-K / 20-F） | 港交所 HKEXnews（业绩公告 PDF） |
| 报表币种 / 报价币种 | 人民币 / 美元 | 人民币 / 港元 |
| 汇率 | USD/CNY | **CNY per HKD**（页面统一用"人民币 ÷ 汇率 = 港元"） |
| 股本 | ADS（1 ADS = 4 股） | 普通股；**已发行股数用港交所月报表** |
| 持股 | 13F | **CCASS 前 10 名参与者**（无 13F） |
| 回购 | 无 | **翌日披露报表**（每个交易日） |
| 估值 | 零增长情景 | **四部分估值框架 + 敏感性矩阵 + 零增长** |
| 涨跌色 | 绿涨红跌 | 绿涨红跌（同 PDD） |

## 2. 目录（新增部分）

```
/data
  companies.json          # 新增腾讯一行
  /tencent
    config.json           # 手工参数（§6）
    fin.json              # 季度财务（§3）
    val.json              # 行情快照（§5.1）
    buyback.json          # 每日回购（§4.1）
    shares.json           # 月报表股本（§4.2）
    ccass.json            # CCASS 前 10 名与南向（§4.3）
    people.json           # 管理团队（年报）
    log.json              # 事件流（§8）
    ai.json               # AI 产出定性跟踪（§9）
/scripts
  hkex_tencent.py         # 业绩公告发现与抽取（adapter）
  hkex_buyback.py         # 翌日披露报表
  hkex_monthly.py         # 月报表
  ccass.py                # CCASS 持股
  price.py                # 复用，增加 0700.HK 与 HKD/CNY
  validate_tencent.py
  qual_draft.py           # 复用，增加腾讯提示词与 ai.json 起草
```

`companies.json` 新增：

```json
{ "id": "tencent", "name": "腾讯", "ticker": "0700.HK", "exchange": "HKEX", "stock_code": "00700",
  "currency_report": "CNY", "currency_quote": "HKD", "source": "hkex", "adapter": "hkex_tencent", "enabled": true }
```

### 定时任务（UTC）

| 任务 | 频率 | 内容 | 是否自动上线 |
|---|---|---|---|
| `price` | 港股交易日 08:30（港股收盘后） | 0700.HK 收盘价、HKD/CNY | 自动 |
| `hkex_results` | 每天 2 次（02:00、11:00） | 查腾讯有无新的季度/中期/年度业绩公告；有则抽取 | 校验通过自动；不通过开 PR |
| `hkex_buyback` | 港股交易日 12:00 | 抓前一交易日的翌日披露报表 | 自动 |
| `hkex_monthly` | 每月 1–10 日每天 1 次 | 抓上月证券变动月报表 | 自动 |
| `ccass` | 港股交易日 01:00 | 前一日 CCASS 持股，前 10 名参与者 + 南向 | 自动 |
| `qual` | 新业绩抽取成功后触发；另每周 1 次 | 管理层问答、事件、AI 产出定性条目 | **开 PR，Danny 审核** |

港股交易日以港交所假期表为准（放 `config.json` 或用 `pandas_market_calendars` 的 `XHKG`）。

## 3. 数据：季度财务（`fin.json`）

### 3.1 来源与发现

- 首选：**HKEXnews 业绩公告 PDF**（`www1.hkexnews.hk/listedco/listconews/sehk/YYYY/MMDD/*.pdf`）。用 HKEXnews 标题检索（股份代号 00700，类别"财务报表/环境、社会及管治资料"下的"业绩公告"）发现新文件。
  - 已实测可抓取样例：2026 年中期业绩公告 `https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0812/2026081200296.pdf`。
- 备用：腾讯 IR 的 `www.tencent.com/wp-content/uploads/YYYY/MM/*.pdf`（中英文新闻稿版本，含同样的数字）。
  - **不要用 `static.www.tencent.com` 域名**：有反爬验证（EdgeOne），脚本拿到的是 JS 挑战页。
- 港交所访问：带合理 User-Agent，请求间隔 ≥1 秒，失败重试 3 次指数退避。
- 季度标签 `YYQn`。腾讯每季都发业绩公告：Q1、Q3 为季度业绩；Q2 为中期业绩（同时含三个月与六个月）；Q4 为全年业绩（同时含三个月与全年）。**只取"三个月"列**；资产负债表取期末列。
- 保留最近 **12 个季度**（同比的同比需要 ≥9 季）。

### 3.2 单位

- 公告表格单位为**人民币百万元**（实现时确认表头）。`fin.json` 存人民币百万元，整数。
- 正文中以"人民币 xx.x 十亿元"出现的数（如国内游戏 47.3）换算为百万元（47,300），并在该字段的 `_precision` 标记为 `"0.1bn"`。

### 3.3 字段对照表

列名以公告英文标签为准；中文版公告作交叉核对。按标签模糊匹配（大小写、空格、脚注符号容错），并记录实际匹配的标签。

| 字段 | 来源位置 | 英文标签（参考） | 说明 |
|---|---|---|---|
| `rev` | 利润表 | Revenues | |
| `vas` | 分部表 | Value-added Services | |
| `game_dom` | 正文（管理层讨论） | Domestic Games revenues | 十亿元精度 |
| `game_intl` | 正文 | International Games revenues | 十亿元精度 |
| `social` | 正文 | Social Networks revenues | 十亿元精度 |
| `mkt` | 分部表 | Marketing Services | 页面称"广告" |
| `fbs` | 分部表 | FinTech and Business Services | **合计披露，不拆分** |
| `others` | 分部表 | Others | |
| `gp_vas` / `gp_mkt` / `gp_fbs` | 分部表 | Gross profit by segment | |
| `gp` | 利润表 | Gross profit | |
| `rd` | 利润表 / 附注 | Research and development expenses | 若利润表只给"一般及行政开支"合计，则取附注中研发；取不到为 `null` |
| `sm` | 利润表 | Selling and marketing expenses | 正数存储 |
| `ga` | 利润表 | General and administrative expenses | 正数存储 |
| `op` | 利润表 | Operating profit | IFRS |
| `op_ng` | 非 IFRS 调节表 | Non-IFRS operating profit | |
| `op_exai` | 正文 / 摘要 | Operating profit excluding New AI Products（非 IFRS） | **公司口径**；首次出现的季度之前为 `null` |
| `ni` | 利润表 | Profit attributable to equity holders of the Company | IFRS |
| `ni_ng` | 非 IFRS 调节表 | Non-IFRS profit attributable to equity holders | |
| `assoc_ng` | 非 IFRS 调节表 | Share of (profit)/loss of associates and joint ventures（非 IFRS 口径） | **必须用非 IFRS 口径**。IFRS 口径会被被投企业的公允价值调整扭曲（26Q2：IFRS 为 −9,993，非 IFRS 为 6,359） |
| `tax` / `pbt` | 利润表 | Income tax expense / Profit before income tax | 用于有效税率 |
| `cfo` | 摘要 | Net cash generated from operating activities | |
| `capex` | 摘要（其他财务资料） | Capital expenditures | 权责口径，与"资本开支付款"不同；两者都存，**页面只显示 `capex_paid`（现金口径）** |
| `capex_paid` | 摘要（现金流量段落） | capital expenditure payments / payments for capital expenditures | 现金口径；12 个季度均可从公告正文抽取，页面使用 |
| `fcf` | 摘要 | Free cash flow | 公司口径 |
| `fcf_ex_prepay` | 摘要 | Free cash flow excluding prepayments for compute procurement | **26Q2 起**；之前为 `null` |
| `cash_total` | 流动性表 | Cash and cash equivalents + Term deposits and others | 公告没有单列"Total cash"，取这两项相加（26Q2 = 206,930 + 304,224 = 511,154）；页面标"现金余额" |
| `net_cash` | 摘要 | Net cash | 公司口径，**直接用，不自行计算** |
| `borrow_cur` / `borrow_nc` | 资产负债表 | Borrowings（流动 / 非流动） | |
| `notes_cur` / `notes_nc` | 资产负债表 | Notes payable（流动 / 非流动） | |
| `inv_listed_fv` | 摘要 | Fair value of shareholdings in listed investee companies (excluding subsidiaries) | |
| `inv_unlisted_bv` | 摘要 | Carrying book value of shareholdings in unlisted investee companies (excluding subsidiaries) | |
| `buyback_shares` / `buyback_hkd` | 摘要 | repurchased approximately X million shares … aggregate consideration HKD Y | 当季 |
| `wavg_basic` / `wavg_diluted` | EPS 附注 | Weighted average number of ordinary shares（basic / diluted） | 百万股 |
| `wx_mau` | 经营数据 | Combined MAU of Weixin and WeChat | 百万 |
| `qq_mau` | 经营数据 | Mobile device MAU of QQ | 百万 |
| `vas_subs` | 经营数据 | Fee-based VAS registered subscriptions | 百万 |

每季同时存：`source_url`、`source_lang`（en/zh）、`extracted_at`、`labels`（字段 → 实际匹配标签）。

### 3.4 验收数字（26Q2，来自 2026-08-12 公告，人民币百万元）

抽取器对 26Q2 的结果必须等于以下数字（误差 ≤1；十亿元精度字段 ≤50）：

| 字段 | 值 | 字段 | 值 |
|---|---|---|---|
| `rev` | 204,785 | `capex` | 52,784 |
| `vas` | 98,414 | `capex_paid` | 59,300（公告为 59.3bn） |
| `mkt` | 43,565 | `fcf` | −13,800 |
| `fbs` | 60,286 | `fcf_ex_prepay` | 37,600 |
| `others` | 2,520 | `cfo` | 52,700 |
| `game_dom` | 47,300 | `net_cash` | 58,200 |
| `game_intl` | 18,600 | `cash_total` | 511,154（两项相加；约 511,200） |
| `social` | 32,500 | `inv_listed_fv` | 487,200 |
| `op_ng` | 75,636 | `inv_unlisted_bv` | 387,900 |
| `op_exai` | 86,100 | `assoc_ng` | 6,359 |
| `ni_ng` | 68,400（约） | `borrow_cur` / `borrow_nc` | 86,292 / 212,650 |
| `wavg_diluted` | 9,153（百万股） | `notes_nc` | 154,021 |
| `buyback_shares` | 37.4（百万股） | `buyback_hkd` | 16,900（百万港元） |
| `wx_mau` | 1,439 | | |

### 3.5 回补

- 回补到 `23Q3`，达到 12 个季度。
- `op_exai`、`fcf_ex_prepay` 首次披露之前的季度保持 `null`，**不要倒推**（例外：公告若给出"同比增长 x%"，**不要**用它反推去年同期值写入 `fin.json`；页面的同比直接显示公告给出的百分比，存于 `op_exai_yoy_reported`）。

## 4. 数据：资金面

### 4.1 回购（`buyback.json`）

- 来源：HKEXnews **翌日披露报表**（Next Day Disclosure Return），股份代号 00700，每个有回购的交易日一份。
- 每条存：`date`、`shares`、`price_high`、`price_low`、`consideration_hkd`、`source_url`。均价 = 金额 ÷ 股数。
- 页面按月汇总，并显示去年同月。
- 校验：每季汇总应与该季业绩公告的 `buyback_shares` 一致（误差 ≤1%）；不一致开 PR。

### 4.2 股本（`shares.json`）

- 来源：HKEXnews **证券变动月报表**（Monthly Return），每月初发布。
- 存：月末 `issued_shares`、`treasury_shares`、当月股份奖励计划发行、当月回购但未注销股数、`source_url`。
- **估值使用的股本 = 最新月报表的已发行股数 − 库存股**。页面标注"截至 YYYY-MM 月报表"。
- 参考值：2026-08 月末已发行 9,103,150,424 股，库存股 0。

### 4.3 CCASS（`ccass.json`）

- 来源：港交所**中央结算系统持股纪录**（HKEXnews CCASS Shareholding Search，股份代号 00700）。每日。
- 存：日期、前 10 名参与者（编号、名称、持股数、占已发行股本比例）、南向合计。
- **南向合计** = 中国证券登记结算两个参与者（沪港通、深港通）持股之和。参与者编号在实现时于页面上核实后写入 `config.json`，**不要猜**。
- 页面：
  - 公司档案页"主要持股"：前 10 名 + 较上月变化（pp）。注明"托管行和券商，不是最终持有人；港股不披露前 10 名实益股东"。
  - 资金面页"南向资金"：周度持股比例与**周持股变化**。**不显示"净买入金额"**（港交所只公布每日成交前十个股的净买入，不保证覆盖腾讯）。如需金额，显示"持股变化 × 周末收盘价（估算）"，并明确标"估算"。
- **风险**：CCASS 页面为表单提交页，开发前先实测可抓取性（本次核查因访问限制未能实测）。
- **CCASS 不可行时的替代方案（已与 Danny 确认）**：不换第三方源，改用"实益股东表"（`holders.json`）：
  - 内容：**只列持股 ≥5% 的主要股东**（来自港交所权益披露"主要股东完整名单"，`hkex_di.py`），持股数、占已发行股本比例、最后申报日期；**不列董事权益**。同一持仓由多方申报的（如 Prosus 与 Naspers、Advance Data 与马化腾）合并成一行。
  - 名称显示：`config.holder_aliases` 把原始名称映射为简称（如 Prosus N.V. → Prosus）；不在映射中的去掉 Limited / Ltd / N.V. / Corporation / Inc. / (Hong Kong) 等后缀。名称单元格不换行，超长省略，悬停（title）显示原始全称；JSON 中仍保存原始全称。
  - 来源：HKEXnews 权益披露（Disclosure of Interests，股份代号 00700）中的最新申报；董事权益以年报"董事于股份的权益"为准，年度更新。
  - 页面标题改为"主要股东（实益）"，注明"港股只披露 ≥5% 股东及董事权益，不披露前 10 名"。
  - 此时资金面页"南向资金"模块显示"数据源待定"。

### 4.4 大股东增减持

- 来源：HKEXnews **权益披露**（Disclosure of Interests，股份代号 00700）中 Prosus/Naspers 及董事的申报；以及 Naspers/Prosus 官网的监管公告（SENS）。
- 有新申报时写入 `log.json`（kind=`holder`），`detail` 写"持股由 X% 变为 Y%（申报日）"。

## 5. 数据：行情与估值

### 5.1 `val.json`

| 字段 | 来源 | 更新 |
|---|---|---|
| `price_hkd`、`price_date` | yfinance `0700.HK` 收盘价 | 自动 |
| `fx_cny_per_hkd` | yfinance `HKDCNY=X`（备用：`CNY=X` ÷ `HKD=X`） | 自动 |
| `shares_mn` | `shares.json` 最新（已发行 − 库存） | 自动 |
| `dps_hkd`、`dps_year` | 最新年度业绩公告的末期股息 | 年度，自动 |

- yfinance 是非官方接口，会被限流（本次核查返回过 429）。实现：失败重试 + 备用源（stooq 或港交所日行情），三者都失败则保留上一日值并在页面标"行情未更新"。

### 5.1b 现金转化率（利润质量）

- 现金转化率 = `fcf` ÷ `ni_ng`（Non-IFRS 归母净利润）；剔除预付版 = `fcf_ex_prepay` ÷ `ni_ng`。
- 单季与近 4 季（TTM = 4 季 `fcf` 之和 ÷ 4 季 `ni_ng` 之和）都算；分子为负照常显示负数，不截断；`fcf_ex_prepay` 为 null 的季度（及不满 4 季披露的 TTM）显示"—"。
- 验收（人民币百万元）：26Q1 = 56,700 ÷ 67,905 = 83.5%；26Q2 = −13,800 ÷ 68,415 = −20.2%；26Q2 剔除预付版 = 37,600 ÷ 68,415 = 55.0%。

### 5.2 估值框架（前端计算；参数见 §6）

记 `TTM(x)` 为最近 4 季 `x` 之和；`K = fx_cny_per_hkd × shares_mn`（人民币 → 每股港元的除数）。

1. **AI 拖累（税前，单季）** `drag_q = op_exai − op_ng`
2. **有效税率** `t = TTM(tax) ÷ TTM(pbt)`（IFRS）；`config.tax_override` 非空则用之。
3. **核心利润（税后，剔除 AI、剔除联营）** `core = TTM(ni_ng) − TTM(assoc_ng) + TTM(drag_q) × (1 − t)`
4. **AI 拖累扣除额**（按口径）：
   - `none`：0
   - `ttm`：`TTM(drag_q) × (1 − t)`
   - `lq4`：`drag_q(最新季) × 4 × (1 − t)`
5. **四部分（人民币百万元）**
   - ① 核心业务 = `core × PE`
   - ② 投资组合 = `(inv_listed_fv + inv_unlisted_bv) × (1 − disc)`（最新季末）
   - ③ 净现金 = `net_cash`（最新季末）
   - ④ AI 拖累 = `AI 拖累扣除额 × PE`（与核心业务用同一个 PE，已确认）
6. **每股价值（港元）** = `(① + ② + ③ − ④) ÷ K`
7. **顶部关键数字**
   - 市值（亿港元）= `price_hkd × shares_mn ÷ 100`
   - PE TTM = 市值（人民币）÷ `TTM(ni_ng)`
   - 核心 PE = `(市值人民币 − ② − ③) ÷ (TTM(ni_ng) − TTM(assoc_ng))`
   - 股息率 = `dps_hkd ÷ price_hkd`
   - 不显示 PE 26E（无一致预期）。
8. **零增长**：每股 = `(E ÷ r + ② + ③) ÷ K`，`E` 按 AI 口径取 `core`、`core − ttm 扣除额`、`core − lq4 扣除额`；年回报 = `E ÷ (市值人民币 − ② − ③)`；所需永续增长 = `r − 年回报`。

**"较上季"口径**：公式条与四个板块的"较上季"一律用**同一组参数**分别作用于本季与上季数据，只反映数据变化，不反映参数调整。

## 6. `config.json`（腾讯）

```json
{
  "pe_options": [12, 15, 18],          "pe_default": 15,
  "pe_ai_follow_core": true,
  "ai_mode_default": "ttm",            "ai_modes": ["none", "ttm", "lq4"],
  "disc_options": [0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9], "disc_default": 0.3,
  "r_options": [0.10, 0.12, 0.15],     "r_default": 0.15,
  "tax_override": null,
  "ccass_southbound_ids": [],          "// ccass_southbound_ids": "不做南向资金，保持为空",
  "holder_aliases": { "Prosus N.V.": "Prosus", "Naspers Limited": "Naspers", "China Securities Depository and Clearing Corporation Limited": "中国结算", "The Hongkong and Shanghai Banking Corporation Limited": "汇丰", "Citibank N.A.": "花旗" },
  "market_view": "核心业务（游戏、广告）稳健但增速放缓；AI 资本开支压制利润和现金流，回购大幅收缩；中国资产的风险溢价压低了估值倍数。",
  "claude_model": "",                  "prompt_version": "tencent-v1"
}
```

手工参数只放这里。`market_view` 修改规则同 PDD（只在主线判断实质变化时由 PR 建议）。

## 7. 页面规格

### 7.1 通用

- 风格完全沿用 PDD SPEC §8.1（终端紧凑、等宽数字、灰阶 + 绿红、浅深色跟随系统、手机宽度可用）。
- 顶部导航：`总览 | 拼多多 | 腾讯 | ＋ 添加公司（禁用）`。
- 标题行：左 `0700.HK · 腾讯控股`；右 `价格日期 · 财务截至 YYQn`。
- 关键数字一行：股价（港元）| 市值（亿港元）| PE TTM | 核心 PE | 股息率。
- 市场观点一行（`config.market_view`）。
- 四个标签页，默认打开"判断与追踪"。

### 7.2 标签 1：公司档案

1. **核心财务表**（滚动 4 季，亿元 = 百万元 ÷ 100），分组：
   - 收入：营业收入及同比；国内游戏、海外游戏、社交网络（各附同比）；广告及同比；金融科技及企业服务及同比；其他
   - 利润：毛利及毛利率；Non-IFRS 经营利润及利润率；剔除新 AI 产品经营利润及利润率；AI 拖累（两者之差）；Non-IFRS 归母净利润及净利率；IFRS 归母净利润
   - 费用：研发及费用率；销售及市场及费用率
   - 现金流：经营现金流；资本开支（现金付款）；自由现金流，其下一行灰色比率行"现金转化率"；剔除算力预付款的自由现金流，其下一行"现金转化率"（`fcf_ex_prepay` 为 null 的季度显示"—"）；最后一行**现金余额**（`cash_total`，最新季加粗；不新增"资产负债"分组）
   - 股本与回购：期末已发行股数（月报表）；当季回购金额
   - 页脚说明：金融科技与企业服务拆分、云收入、单款游戏收入公司不披露。
2. **主要股东**：只显示持股 ≥5% 的主要股东（§4.3 替代方案，权益披露）；名称简化、不换行、悬停显示全称；不显示董事权益。
3. **管理团队**：只显示高级管理层，不显示董事。来源为年报"董事及高级管理层"。判定：职位含管理职务（首席…官、总裁、高级执行副总裁、执行副总裁、高级副总裁、高级管理顾问等）的显示；只担任董事（非执行董事、独立非执行董事）的不显示；同时担任董事与管理职务的保留，职位只写管理职务（如"首席执行官（兼董事会主席）"）。

### 7.3 标签 2：判断与追踪（估值框架主页）

自上而下：

1. **估值框架公式条**：`① 核心业务 ＋ ② 投资组合 ＋ ③ 净现金 − ④ AI 拖累`，**不计算、不显示每股价值总数**。每块显示：
   - ① 主数字：近 4 季核心利润（亿元）；较上季变动率；要点："增长：剔除 AI 经营利润同比 x%（公司披露）"、"倍数：PE"
   - ② 主数字：投资组合合计（亿元）；较上季变动率；要点："折扣 x%（折后 y 亿）"、"上市 ±a% · 非上市 ±b%"
   - ③ 主数字：净现金（亿元）；较上季变动额；要点："上季 x 亿"、"自由现金流 · 回购 · 派息"本季金额
   - ④ 主数字：所选口径的税后拖累（亿元）；较上季变动率（**上升为红**）；要点："倍数：PE · 口径"、"最新季 x 亿 · 环比 y%"
   - 公式条下一行"本季要点"汇总四项变化与参数。
   - 再下一行**"现金校验"**：近 4 季现金转化率、剔除预付版，及各自较上季变化（pp，上升为绿、下降为红）；说明："利润中能转化为股东现金的比例。比例越低，按利润估值得出的结论越需要打折扣。"剔除预付版须连续 4 季都有 `fcf_ex_prepay` 才计算，否则显示"—"（不倒推）。
   - 每块可点击，跳到对应明细板块。
2. **① 核心业务**：PE 选择（12/15/18）；驱动指标表（列：最新季｜上一季｜去年同季｜较上季｜信号；行：剔除 AI 经营利润金额、其同比（公司披露）、广告同比、国内游戏同比、海外游戏同比、金融科技及企业服务同比）；核心利润计算式；分业务收入同比折线图（近 8 季，规则同 PDD §8.4，线尾标注、无图例、Y 轴固定 40px）。
   - 信号规则：同 PDD §8.5（±0.5pp）。**剔除 AI 经营利润看环比金额**：环比为正"环比增长"，为负"环比下降"。
   - 国内游戏同比旁加脚注规则：若该季公告提到"春节"或"递延"，自动加 `*` 并显示原文一句。
3. **② 投资组合**：折扣 10%–90% 九个按钮（按钮下显示该折扣的每股港元）；近 4 季上市公允价值、非上市账面价值、合计、折后、每股。
4. **③ 净现金**：近 4 季总现金、借款 + 应付票据、净现金（公司口径）、每股；**净现金变动来源**：自由现金流、回购（按季内平均汇率折人民币）、派息、其他（倒挤）；其后加两行**单季现金转化率**（自由现金流 ÷ 净利润）及其剔除预付版。
5. **④ AI 拖累**：口径选择（不扣 / 近 4 季永久化 / 最新季 ×4 永久化）；近 4 季拖累、占剔除 AI 经营利润比、两种年化口径、资本开支、拖累 ÷ 资本开支；资本开支 vs AI 拖累柱状图（近 6 季）。
6. **敏感性矩阵**：核心 PE × AI 口径 → 每股价值（港元）及相对现价；当前选择加框；投资组合折扣随 ② 联动。
7. **零增长估值**：要求回报率选择；三列 AI 口径；行：每股价值、现价买入年回报、所需永续增长。
8. **管理层问答**：同 PDD（kind=`qa`，最多 4 条，最新季高亮）。

### 7.4 标签 3：资金面与事件

1. **公司回购**：按月（股数、金额、均价、去年同月），近 7 个月；注明当月截止日与禁售期。
2. **南向资金**：周度持股比例与周持股变化（§4.3）。
3. **大股东增减持**：log kind=`holder`。
4. **重大事件与观点变化**：log kind=`event` / `view` / `team`；比最新业绩公告日更新的条目高亮。观点变化只记录**评级或目标价明显变化的事实**，不引用其预测数字。

### 7.5 标签 4：AI 产出（定性）

见 §9。

## 8. `log.json`

结构同 PDD。`kind`：`event`（监管、版号、出口管制、名单等）、`qa`、`view`、`team`、`holder`（大股东申报）。新条目必须带 `source`。

## 9. AI 产出（`ai.json`，半自动、定性）

### 9.1 结构

```json
{
  "signals": [ {"id":"s1","name":"投入与使用","judgment":"一句话","basis":"依据（引用公告/业绩会）","status":"观察|压力在后|未确认|改善","updated":"YYQn"} ],
  "turns":   [ {"id":"t1","text":"财报中 AI 拖累不再扩大","status":"未出现|观察中|已出现","evidence":"一句话","updated":"YYQn"} ],
  "products":[ {"id":"workbuddy","group":"应用|模型与平台|算力对外","name":"WorkBuddy","position":"一句话定位",
                "tag":"状态标签","judgment":"一句话判断",
                "logs":[{"date":"YYYY-MM-DD","kind":"财报|管理层|第三方|市场","text":"一句话","source":"URL","secondhand":false}] } ]
}
```

### 9.2 跟踪对象

- 应用：WorkBuddy、元宝、小微、CodeBuddy
- 模型与平台：TokenHub、混元调用量、混元排名、新模型发布
- 算力对外：GPU 对外出租
- 变现信号三条：投入与使用、投入与利润表、算力对外变现
- 拐点四条：AI 拖累不再扩大；单独披露 AI 产品收入或付费用户；确认对外出租 GPU/MaaS 带来可观收入；资源集中形成商业化主线

### 9.3 起草规则（`qual_draft.py`）

- 触发：新业绩抽取成功后；另每周一次（只看新模型发布与重大产品动态）。
- 输入：业绩公告全文（中英文）、业绩会文字稿（腾讯不提供官方文字稿；先尝试公开渠道，拿不到就在 PR 中留空并提示 Danny 粘贴）、过去 7 天的网页搜索结果。
- **不写数字**，除非数字直接出现在腾讯业绩公告原文中（例如"Hy3 按 OpenRouter token 消耗量持续位列全球前三"可以写）。卖方报告、媒体转述的数字一律不写；若要提及，改成定性表述并 `secondhand: true`。
- 每个产品每季最多新增 2 条动态；判断句与状态标签只在有实质变化时修改。
- 拐点状态由"未出现 → 观察中 → 已出现"单向推进，回退需在 PR 中说明理由。
- 混元调用量条目须注明免费期（例：Hy3 免费期 2026-07-06 至 07-21），免费期内的排名不作为采用证据。
- 新模型发布：可用 Hugging Face `tencent` 账号的模型列表自动发现新模型（只记录名称、日期、是否开源、上下文长度等模型卡上的事实）。

### 9.4 升级为量化的条件

满足任一条件，开 issue 提议把对应项改为量化字段（进 `fin.json` 或新增 JSON，走 §10 校验）：
- 腾讯在**业绩公告**中连续两季披露同一口径的数字（如 WorkBuddy 付费用户数、TokenHub token 量、云收入增速）；
- 出现可程序化访问、口径稳定的公开数据源（如 OpenRouter 官方 API 提供按模型的用量时间序列）。

## 10. 抽取校验（`validate_tencent.py`）

全部通过才自动上线，否则开 PR 列出失败项：

1. `abs(vas + mkt + fbs + others − rev) ≤ 1`。
2. `abs(game_dom + game_intl + social − vas) ≤ 150`（十亿元精度容差）。
3. `op_exai ≥ op_ng`（若两者都非空）；`drag_q` 较上季变化超过 ±50% 列出（不阻断）。
4. `abs(gp_vas + gp_mkt + gp_fbs + gp_others − gp) ≤ 1`（若分部毛利齐全）。
5. 资产负债与"其他财务资料"关键字段非空：`net_cash`、`cash_total`、`inv_listed_fv`、`inv_unlisted_bv`、`capex`、`fcf`。
6. `abs(TTM 回购股数（buyback.json 汇总） − 公告 buyback_shares) / 公告值 ≤ 1%`（按季）。
7. 年度业绩公告发布后：Q1–Q4 的 `rev`、`op_ng`、`ni_ng` 单季加总与全年值差异 ≤0.5%。
8. 标签与上季不同 → 阻断，人工确认。
9. 中英文公告同一字段不一致 → 阻断。
10. `ni_ng` 非空时，现金转化率必须可计算（`fcf` 非空且 `ni_ng` ≠ 0）。

## 11. 验收标准

1. `hkex_tencent.py` 对 2026 年中期业绩公告抽取结果与 §3.4 一致。
2. 回补 23Q3–26Q1，`op_exai`、`fcf_ex_prepay` 在首次披露前为 `null`。
3. `hkex_buyback.py` 能抓到 2026-05-22 的翌日披露报表：回购 1,132,000 股，价格 439–445 港元，金额约 5.0056 亿港元。
4. `hkex_monthly.py` 能抓到 2026-08 月报表：已发行 9,103,150,424 股、库存股 0。
5. `ccass.py` 能列出任一交易日前 10 名参与者并算出南向合计；若无法实现，按 §4.3 替代方案改用实益股东表，并在 README 说明原因。
6. `price` 任务在 yfinance 失败时切换备用源，页面显示正确日期。
7. 公式条四块与明细板块数值一致；改 PE / 折扣 / AI 口径后，公式条要点、敏感性矩阵、零增长、顶部"核心 PE"同步变化；"较上季"在改参数时**不变号、不受参数影响方向**（只随数据变）。
8. `qual` 产出中文 PR：qa、event、ai.json 条目均带来源；`ai.json` 中无公告以外的数字。
9. 手机与桌面、浅色与深色下可读；Y 轴不被裁切（标签页隐藏时不测量文字宽度）。
10. README 增补：腾讯各任务的手动触发、`config.json` 各参数含义、估值公式说明。
11. 现金转化率：26Q1 单季 ≈ 83.5%，26Q2 单季 ≈ −20.2%，26Q2 剔除预付版 ≈ 55.0%；现金余额 26Q2 页面显示 5,111.5 亿（511,154 百万，公告无单列"Total cash"）。
12. 主要股东表只有 ≥5% 股东，团队表只有高级管理层；手机宽度下这两张表不出现整页横向滚动。

## 12. 近期时间点

- 腾讯 2026 年三季度业绩：预计 2026 年 11 月中旬（以港交所董事会会议通告为准，通告发布后写入 `log.json`）。
- 业绩前禁售期：回购通常暂停，回购表显示"禁售期"。
- 年度末期股息：年度业绩公告中宣派，次年 5 月中旬除净。

## 13. 已知数据局限（页面保留说明）

- 金融科技与企业服务只披露合计；云收入、单款游戏收入不披露。
- 国内游戏、海外游戏、社交网络只在正文以十亿元精度披露。
- 剔除新 AI 产品经营利润、剔除算力预付款的自由现金流为近期新增口径，历史季度为空。
- 新 AI 产品的收入、用户数、成本构成不披露；AI 产出页为定性跟踪。
- CCASS 显示托管参与者，不是最终持有人；港股不披露前 10 名实益股东。
- 南向净买入金额无逐股官方数据。
- 联营公司利润必须用非 IFRS 口径。

## 14. 已确认事项（Danny，2026-10-30）

1. 访问控制：与 PDD 相同。
2. CCASS 不可行：改用实益股东表（§4.3 替代方案），不换第三方源。
3. ④ AI 拖累的倍数：与核心 PE 相同，不单独设置。
