# 公司追踪看板：开发说明（交给 Claude Code）

> 使用人：Danny（个人自用，原则是**简单**）。第一家公司是拼多多（PDD），之后会加腾讯、QQQ、SK 海力士等。
> 本包内容：`SPEC.md`（本文件）、`seed/pdd/*.json`（当前已核对的初始数据）、`reference/current_dashboard.html`（当前看板页面，作为布局与样式参考；它依赖原平台的 `dash` 运行时，不能直接运行，**照着它重写为独立网页**）。

---

## 0. 目标与原则

1. 一个静态网站 + 定时任务：财务数据、股价、13F 持仓**自动**更新；管理层问答、市场观点、重大事件**半自动**（程序起草，Danny 审核后上线）。
2. **数字只能来自原始披露**（SEC 文件、交易所行情），不估算、不手填。抽不到就留空（`null`）并在页面显示"—"，不要猜。
3. 自动抽取的数字必须过校验（第 5 节）。校验不过 → 不上线，开 PR / 发通知给 Danny。
4. 页面保持当前的"终端紧凑"风格（第 7 节）。不加多余功能。
5. 架构从第一天起支持多公司（第 2 节），但现在只实现 PDD；首页总览只留占位。

## 1. 推荐技术方案（可调整，但保持零运维）

- 代码仓库：GitHub（私有）。
- 前端：纯静态 HTML + CSS + 原生 JS + d3 v7（CDN 固定版本）。不需要框架。数据在构建时或运行时从 `data/` 下的 JSON 读取。
- 数据管道：Python 3.11 脚本（`scripts/`），依赖尽量少：`requests`、`beautifulsoup4`/`lxml`、`pandas`（可选）、`yfinance`、`anthropic`（仅半自动部分）。
- 定时：GitHub Actions。
- 部署：GitHub Pages（或 Vercel）。网站不需要公开搜索引擎收录；如需访问控制，用 Vercel 密码保护或 Cloudflare Access，二选一，先问 Danny。
- 通知：Actions 失败、或有待审核 PR 时，发邮件 / GitHub 通知即可。

### 定时任务

| 任务 | 频率（UTC） | 内容 | 是否自动上线 |
|---|---|---|---|
| `price` | 工作日 22:30 | 拉 PDD 收盘价、USD/CNY 汇率，更新 `val.json` 的 price/fx/日期 | 自动 |
| `edgar` | 每天 2 次（00:00、12:00） | 查 PDD 有无新 6-K（季报）/ 20-F（年报），有则抽取财务数据 | 校验通过自动；不通过开 PR |
| `13f` | 每周一次 + 13F 截止日后 3 天（约 2/17、5/18、8/17、11/17） | 抓被追踪投资人的 13F，计算 PDD 持仓变化 | 自动写入 `log.json`（kind=investor） |
| `qual` | 新季报抽取成功后触发；另每周一次 | 用 Claude API 起草管理层问答要点、重大新闻/观点变化 | **开 PR，Danny 审核合并** |

## 2. 目录与多公司结构

```
/site
  index.html            # 顶部导航：总览 | PDD | （以后的公司）| ＋
  app.js, style.css
/data
  companies.json        # 公司注册表
  /pdd
    config.json         # 该公司的抽取配置与手工参数（见 4.3）
    fin.json            # 季度财务（第 3 节）
    val.json            # 估值快照
    scen.json           # 零增长估值情景
    people.json         # 管理团队
    holders.json        # 前几大外部股东
    log.json            # 事件流：temu / event / qa / view / team / investor
/scripts
  edgar_pdd.py          # PDD 6-K/20-F 抽取器（每家公司一个 adapter）
  price.py
  thirteenf.py
  qual_draft.py
  validate.py
```

`companies.json` 示例：

```json
[{ "id": "pdd", "name": "拼多多", "ticker": "PDD", "exchange": "NASDAQ", "currency_report": "CNY", "currency_quote": "USD",
   "source": "sec", "cik": "0001737806", "adapter": "edgar_pdd", "enabled": true }]
```

注意：后续公司的数据源不同。腾讯在港交所披露（不在 SEC），SK 海力士在韩国 DART，QQQ 是 ETF（只有持仓与价格）。所以**每家公司一个 adapter**，输出同一套 `fin.json` 字段（不适用的字段为 `null`）。现在只做 PDD，但不要把 PDD 的假设写死在前端。

首页"总览"：现在只显示占位文字（"总览页待建"）。以后放各公司一行关键指标。

## 3. 数据：PDD 季度财务（`fin.json`）

### 3.1 来源

- PDD（PDD Holdings Inc.）是外国私人发行人。**季度业绩以 6-K 提交，财报新闻稿是附件（一般为 Exhibit 99.1），HTML 格式**。6-K 通常不带 XBRL，所以季度数字要**解析新闻稿里的表格**。
- 年报为 20-F，带 XBRL，可用 `https://data.sec.gov/api/xbrl/companyfacts/CIK0001737806.json` 做年度交叉核对。
- 新文件发现：`https://data.sec.gov/submissions/CIK0001737806.json`，筛 `form == "6-K"`，再进入该 filing 的索引页找描述/文件名含 earnings / unaudited financial results 的附件。
- SEC 访问规则：必须带 `User-Agent: <姓名> <邮箱>`（用 Danny 提供的联系邮箱，放在仓库 secret 里，不要写死在代码），每秒请求 ≤10 次。
- CIK 0001737806 请在实现时先在 EDGAR 上确认一次。

### 3.2 单位

- 新闻稿表格单位是**人民币千元**（RMB thousands）——实现时请确认表头。`fin.json` 存**人民币百万元**（千元 ÷ 1000，四舍五入取整）。
- 季度标签格式 `YYQn`，如 `26Q2`。保留最近 **12 个季度**（同比的同比需要 9 个季度以上；当前 seed 只有 8 个，见 3.4）。

### 3.3 字段对照表

列名以新闻稿英文标签为准，实现时按标签模糊匹配（大小写、空格、脚注符号容错），并把实际匹配到的标签写进日志。

| 字段 | 报表 | 新闻稿标签（英文） | 说明 |
|---|---|---|---|
| `rev` | 利润表 | Total revenues | |
| `oms` | 利润表 | Online marketing services and others | 页面称"广告收入" |
| `ts` | 利润表 | Transaction services | |
| `cogs` | 利润表 | Costs of revenues | 正数存储 |
| `sm` | 利润表 | Sales and marketing expenses | 正数存储 |
| `op` | 利润表 | Operating profit | GAAP |
| `op_ng` | 非GAAP调节表 | Non-GAAP operating profit | |
| `ni_ng` | 非GAAP调节表 | Non-GAAP net income attributable to ordinary shareholders | |
| `cfo` | 现金流（摘要） | Net cash generated from operating activities | 单季 |
| `ncf` | 现金流（摘要） | Net increase/(decrease) in cash, cash equivalents and restricted cash | 单季 |
| `cash` | 资产负债表 | Cash and cash equivalents | |
| `restricted` | 资产负债表 | Restricted cash | |
| `cash_sti` | 资产负债表 | Cash and cash equivalents **+** Short-term investments | 与新闻稿正文"现金、现金等价物及短期投资"口径一致；**不含**受限资金 |
| `recv` | 资产负债表 | Receivables from online payment platforms | |
| `due_from_rel` | 资产负债表 | Amounts due from related parties | |
| `prepay` | 资产负债表 | Prepayments and other current assets | |
| `ppe` | 资产负债表 | Property, equipment and software, net | |
| `inventory` | 资产负债表 | Inventories | 目前无此科目 → `null`；一旦出现要在页面标"已出现" |
| `pay_merch` | 资产负债表 | Payable to merchants | |
| `merch_dep` | 资产负债表 | Merchant deposits | |
| `accrued` | 资产负债表 | Accrued expenses and other liabilities | |
| `advances` | 资产负债表 | Customer advances and deferred revenues | |
| `due_to_rel` | 资产负债表 | Amounts due to related parties | |
| `debt` | 资产负债表 | Convertible bonds（流动 + 非流动合计） | 无则 0 |

另外每季同时抽取并存入 `fin.json`（页面暂不展示，用于估值）：
- `ads_diluted_mn`：Non-GAAP 或 GAAP 的 "weighted-average number of ordinary shares outstanding – diluted" ÷ 4（**1 ADS = 4 股普通股**），单位百万 ADS。
- `source_url`：该季数据所在新闻稿的 SEC URL。
- `extracted_at`：抽取时间。

四季度（Q4）注意：PDD 的四季度新闻稿通常同时披露全年数，表格列会多，**只取三个月（three months ended）那一列**。资产负债表用期末列。25Q4 的 seed 已按年报审计口径录入。

### 3.4 回补

- seed 中 `24Q3` 与 `25Q2` 的资产负债表科目是 `null`（当时没录），请从对应 6-K 回补。
- 再往前回补到 `23Q3`，使总数达到 12 个季度。
- 回补时，**seed 已有的非空数字必须与重新抽取的结果一致（误差 ≤1 百万元）**——这是抽取器的验收测试。不一致先报告，不要覆盖 seed。

## 4. 数据：估值与其他

### 4.1 `val.json`

```json
[{"item":"snapshot","price_usd":80,"price_date":"2026-10 中旬（约）","fx":6.79,"ads_mn":1473.5,
  "net_cash_usd_bn":74.0,"restricted_usd_bn":18.0,"nopat_usd_bn":11.4,"eps26e_rmb":64.64,"employees_2024":23465}]
```

| 字段 | 来源 | 更新方式 |
|---|---|---|
| `price_usd`、`price_date` | yfinance `PDD` 收盘价；日期写 `YYYY-MM-DD` | 自动，每个交易日 |
| `fx` | USD/CNY（yfinance `CNY=X` 或其他免费源） | 自动，与股价同步 |
| `ads_mn` | 最新季度 `ads_diluted_mn` | 新季报后自动 |
| `net_cash_usd_bn` | 见下方"待确认" | 新季报后自动（定口径后） |
| `restricted_usd_bn` | `restricted` ÷ fx ÷ 1000 | 新季报后自动 |
| `nopat_usd_bn` | 近 4 季 `op_ng` 合计 × (1 − 税率) ÷ fx ÷ 1000；税率放 `config.json`。当前值 11.4 是对话中手工设定的（约为近 4 季非GAAP经营利润 157 亿美元的 73%，隐含税率约 27%），自动化前请与 Danny 确认口径 | 新季报后自动 |
| `eps26e_rmb` | 市场一致预期 | **手工**，放 `config.json` |
| `employees_2024` | 20-F 员工人数 | 每年 20-F 后自动/手工 |

**待确认（实现前问 Danny）**：`net_cash_usd_bn = 74.0` 是之前在对话中按"现金+短期投资+其他投资类资产 − 有息负债"的口径手算的，口径未在本包里固定。建议定为：`(cash_sti + 长期定期存款等投资类资产 − debt) ÷ fx ÷ 1000`，**不含**受限资金；把公式写进 `config.json` 并在页面 tooltip 中说明。

### 4.2 `scen.json`（零增长估值情景，手工维护）

每行：`name`、`nopat_bn`（十亿美元）、`r`（要求回报率）、`cash_disc`（净现金折扣）、`note`。
每 ADS 价值 = `(nopat_bn / r + net_cash_usd_bn × (1 − cash_disc)) × 1000 / ads_mn`；与股价比较：`per_ads / price_usd − 1`。
页面上 `nopat_bn` **×10 显示为"亿美元"**（如 11.5 → 115 亿美元），并注明"假设值，参考 2025 年实际约 114 亿美元"。

### 4.3 `config.json`（PDD）

放：税率假设、`eps26e_rmb`、净现金公式开关、追踪的 13F 机构列表、Claude 起草所用的提示词版本号等所有手工参数。**手工参数只放这里**，其他 JSON 由脚本生成。

### 4.4 `people.json`、`holders.json`

- `people.json`：姓名、年龄、职位、学历、经历。来源：20-F 第 6 项 "Directors, Senior Management and Employees"。每年 20-F 后自动更新年龄/职位，学历经历保留人工内容；值为"待核实"的条目，从 20-F 能补就补。
- `holders.json`：前几大外部股东及持股比例、截至日期、来源。来源：20-F 第 7 项 "Major Shareholders"（年度）；季度间不更新。当前 seed 来自二手转述（格隆汇），**首个 20-F 抓取后用原文替换，并把 `source` 改为 20-F**。

### 4.5 `log.json`（事件流）

```json
{"id":"q7","date":"2026-08-24","quarter":"26Q2","kind":"qa","title":"一句话要点","detail":"一句话补充","source":"URL（新增条目必填）"}
```

`kind`：`temu`（Temu 历程）、`event`（重大事件/监管/处罚）、`qa`（业绩会管理层表态）、`view`（市场观点/评级的重大变化）、`team`（人事）、`investor`（13F 建仓减仓）。
`id` 唯一，按 kind 首字母 + 序号。新条目必须带 `source`。

## 5. 抽取校验（`validate.py`）

新季度数据写入前全部通过才自动上线，否则开 PR 并在 PR 描述里列出失败项：

1. `abs(oms + ts − rev) ≤ 1`。
2. 资产负债表关键科目全部非空（`inventory` 除外）。
3. `cash ≤ cash_sti`；`op_ng ≥ op`（PDD 的非 GAAP 加回股权激励，历史上恒成立）。
4. 与上季相比变动超过 ±50% 的科目逐一列出（不阻断，但要在通知里说明；`ppe` 已知在 26Q2 跳升，属正常）。
5. 若 SEC companyfacts 有同期年度数，Q1–Q4 单季加总与年报差异 ≤ 0.5%。
6. 记录每个字段匹配到的原始英文标签；标签与上季不同 → 阻断，人工确认。

## 6. 半自动：Claude 起草（`qual_draft.py`）

- 使用 Anthropic API（API key 放 GitHub secret）。模型名放 `config.json`。
- **管理层问答（kind=qa）**：新季报后触发。输入：新闻稿全文 + 业绩会文字稿。文字稿不在 SEC：先尝试公司 IR 网站（investor.pddholdings.com）的公开材料；拿不到就在 PR 里留空并提示 Danny 粘贴文字稿。起草规则：**只保留有信息量的实质回答，套话、口水话、重复的战略表述一律忽略**；每条一句话标题 + 一句话补充；最多 4 条。
- **市场/事件（view/event/temu/team）**：每周一次，用带网页搜索的 Claude 调用，搜过去 7 天 PDD/Temu 的：监管处罚与政策（中、美、欧）、Temu 动态、董事/高管变动、主要投行评级或目标价的**明显**变化。**只记录重大变化；无重大变化就不开 PR。**
- **顶部"市场观点"一句话**存在 `config.json` 的 `market_view` 字段。当前文本：
  "增长明显放缓，现金流充沛却不分红、不回购，估值因此明显折价；监管风险和新投入的回报不确定，进一步压低了估值。"
  只有主线判断发生实质变化（如宣布分红/回购、增长重新加速、重大监管结论）时，才在 PR 里**建议**修改，由 Danny 决定。
- 所有起草内容以 PR 形式提交，PR 描述用中文列出新增条目及来源链接。

## 7. 13F（`thirteenf.py`）

- 追踪名单放 `config.json`：当前为 Himalaya Capital（李录）、H&H International Investment（段永平）。CIK 请在 EDGAR 公司搜索中查实后写入，不要猜。
- 每份 13F-HR 的 information table（XML）中按 PDD ADS 的 CUSIP 查找（CUSIP 请从 13F 原文或公开资料核实后写入 `config.json`）。
- 与上一期比较股数：新建仓 / 加仓 / 减仓 / 清仓，计算占组合比例。变化超过 ±10% 或建仓清仓才写 `log.json`（kind=investor），`detail` 写"增至 X 万股（±Y%），占组合 Z%"。
- 页面注明 13F 为季末快照、约 45 天滞后。

## 8. 页面规格

### 8.1 风格（"终端紧凑"，已与 Danny 确认）

- 背景、文字跟随系统浅色/深色模式（`prefers-color-scheme`），不强制配色。
- **数字一律等宽字体**：`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`，`font-variant-numeric: tabular-nums`。中文标签用系统无衬线字体。
- 不用卡片阴影；以细线分隔（1px 浅灰）；表格行高紧凑（上下约 3px）。
- 涨跌颜色：**绿涨红跌**（美股习惯），配 ▲ / ▼ 符号。
- 颜色只用中性灰阶 + 绿/红两个语义色；图表也用灰阶（见 8.4）。
- 手机宽度可用：左右留 16px，表格横向滚动在表格容器内，不让整页横向滚动。

### 8.2 页面结构（PDD）

1. 顶部导航：`总览` | `拼多多` | `＋ 添加公司`（禁用）。
2. 标题行：左 `PDD · 拼多多`，右 价格日期（小号灰字），下方一条细线。
3. 关键数字一行（标签灰字 + 等宽数字，横向排列可换行）：
   股价 | 市值（亿美元）| PE TTM | PE 26E | EV/经营利润 | 净现金/ADS
4. 市场观点：粗体"市场观点"与一句话同一行（小号灰字）。
5. 三个子标签页：
   - **公司档案**：核心财务（滚动 4 季度，见 8.3）、前几大外部股东、Temu 历程（log kind=temu）、管理团队（people）。
   - **判断与追踪**：本季度核心指标（8.5）、收入同比增速折线图（8.4）、零增长估值情景表、管理层问答（kind=qa，最新一季高亮）。
   - **变化与事件**：市场新闻与观点变化（view）、投资人建仓与减仓（investor）、团队变化（team）、重大事件（event）。比最新财报季更新的条目高亮。

### 8.3 核心财务表（滚动最近 4 季；单位亿元 = 百万元 ÷ 100）

分组标题行 + 层级缩进：第 0 级加粗，第 1 级缩进，比率行再缩进一级且灰色。

| 分组 | 行（级别） | 计算 |
|---|---|---|
| 收入 | 营业收入(0)；收入同比(1)；广告收入(1)；广告收入同比(2)；交易服务收入(1)；交易服务收入同比(2) | 同比 = 本季 / 去年同季 − 1 |
| 利润 | 毛利(0)＝rev−cogs；毛利率(1)；GAAP经营利润(0)；利润率(1)；非GAAP经营利润(0)；利润率(1)；非GAAP净利润(0)；净利率(1) | 率 = ÷ rev |
| 费用 | 销售费用(0)；销售费用率(1) | |
| 现金流 | 经营现金流(0)；现金净增加额(0) | |
| 资产负债 | 现金余额(0)＝cash；其他现金类（受限 + 短期投资）(0)＝cash_sti − cash + restricted；应收(0)＝recv + due_from_rel + prepay；应付(0)＝pay_merch + merch_dep + accrued + advances + due_to_rel；固定资产净值(0)；存货(0)（null 显示"无科目"）；有息负债(0) | 任一项为 null 则合计为 null |

### 8.4 收入同比增速图

- 最近 4 季（数据够时可做成 8 季），三条线：营业收入（深色实线 1.75px）、广告（灰色实线 1.25px）、交易（灰色虚线 1.25px，`4 3`）。
- 只在最新一季画小圆点，线尾直接写"名称 + 数值"，不要图例。
- Y 轴百分比标签固定留 40px 左边距（**不要依赖隐藏状态下测文字宽度**——之前的 bug：图在隐藏标签页内绘制，Y 轴被裁掉）；切换到该标签页和窗口缩放时重绘。0% 线加深，其他网格线 0.5px 浅灰。字号 11px 等宽。
- 悬停显示该季三项数值。

### 8.5 本季度核心指标表

列：指标 | 最新季 | 上一季 | 去年同季 | 较上季 | 信号。
行：广告收入同比、交易服务收入同比、非GAAP经营利润率、销售费用率（%）；固定资产净值、预付款及其他流动资产、存货、现金及短期投资（亿元）。
- "较上季"：百分比指标显示差值（pp），金额指标显示变动率；正为绿 ▲，负为红 ▼。
- 信号：百分比指标差值 > 0.5pp 为"回升"、< −0.5pp 为"下降"，否则"持平"；金额指标 > 1.5 倍为"跳升"；存货非空为"已出现"，空为"未出现"。
- "去年同季"的同比需要第 9 个更早的季度，数据回补后自动可用。

### 8.6 估值倍数（与当前页面口径一致）

- 市值（十亿美元）= price_usd × ads_mn ÷ 1000；页面以亿美元显示（×10）。
- PE TTM = 市值 ÷ (近 4 季 ni_ng 合计 ÷ fx ÷ 1000)。
- PE 26E = price_usd ÷ (eps26e_rmb ÷ fx)。
- EV/经营利润 = (市值 − net_cash_usd_bn) ÷ (近 4 季 op_ng 合计 ÷ fx ÷ 1000)。
- 净现金/ADS（美元）= net_cash_usd_bn × 1000 ÷ ads_mn。

当前快照下应约为：市值 ≈ 1179 亿美元、EV/经营利润 ≈ 2.8x、净现金/ADS ≈ 50.2（用于验收）。

## 9. 验收标准

1. 用 seed 数据渲染的页面与 `reference/current_dashboard.html` 的内容、数字一致。
2. 抽取器重新抽取 24Q4–26Q2 的结果与 seed 一致（3.4）；回补 24Q3、25Q2 资产负债表和 23Q3–24Q2 全部字段。
3. 手动触发 `edgar` 任务，能识别出最近一份 6-K 并通过校验；故意改坏一个标签能触发阻断和 PR。
4. `price` 任务跑完，页面股价、日期、倍数同步变化。
5. `13f` 任务能列出两位投资人最近两期的 PDD 持仓。
6. `qual` 任务产出一个中文 PR，条目有来源链接；无重大变化时不产出 PR。
7. 手机与桌面、浅色与深色下都可正常阅读。
8. 在 README 写明：如何手动触发各任务、如何改 `config.json`、如何新增一家公司。

## 10. 近期时间点（便于测试）

- PDD 2026 年三季度财报：预计 2026-11-18。
- 13F（2026Q3 持仓）截止：约 2026-11-14。
- 欧盟对 Temu《数字服务法》整改的后续决定：时间未定，关注 event。

## 11. 已知的数据局限（页面上保留说明）

- GMV 不披露，不展示。
- 员工人数只有年度数。
- 无存货科目（新拼姆自营品牌若开始备货，此科目会出现——这是追踪信号之一）。
- Temu 无单独财务披露。
- 股东持股为年度快照。
