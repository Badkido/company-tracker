// 腾讯（0700.HK）页面。依赖 app.js 里的全局：d3、$、g、load、fillBody、showPage、prevYear。
// 估值框架：每股价值 = ① 核心业务 ＋ ② 投资组合 ＋ ③ 净现金 − ④ AI 拖累（口径见 SPEC_tencent §5.2）。
(() => {
  const S = { pe: 15, disc: 0.3, mode: 'ttm', r: 0.15 };
  const MODES = { none: '不扣', ttm: '近 4 季永久化', lq4: '最新季 ×4 永久化' };
  const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
  const yi = (v) => (v == null ? null : v / 100);
  const ok = (v) => v != null && Number.isFinite(v);
  const num = (v, d = 1) => (ok(v) ? d3.format(',.' + d + 'f')(v) : '—');
  const pct = (v, d = 1) => (ok(v) ? d3.format('.' + d + '%')(v) : '—');
  const spct = (v, d = 1) => (ok(v) ? (v >= 0 ? '+' : '−') + d3.format('.' + d + '%')(Math.abs(v)) : '—');
  const sgn = (v) => (ok(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : '') : '');
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const by = (q) => S.fin.findIndex((r) => r.q === q);

  // ---- 计算 ----

  function sumWin(i, f) {
    if (i < 3) return null;
    let s = 0;
    for (let j = i - 3; j <= i; j++) {
      const x = f(S.fin[j]);
      if (!ok(x)) return null;
      s += x;
    }
    return s;
  }
  const dragQ = (r) => (r.op_exai == null ? null : r.op_exai - r.op_ng);

  // 第 i 季末的四部分（人民币百万元）与每股价值（港元）。口径首次披露前的季度，AI 拖累按 0 计。
  function calc(i, p) {
    const F = S.fin;
    const K = S.val.fx_cny_per_hkd * S.val.shares_mn;
    const ttm = (k) => sumWin(i, (r) => r[k]);
    const tax = S.cfg.tax_override ?? ttm('tax') / ttm('pbt');
    const ttmDrag = sumWin(i, (r) => dragQ(r) ?? 0);
    const dq = dragQ(F[i]) ?? 0;
    const core = ttm('ni_ng') - ttm('assoc_ng') + ttmDrag * (1 - tax);
    const ded = { none: 0, ttm: ttmDrag * (1 - tax), lq4: dq * 4 * (1 - tax) };
    const inv = F[i].inv_listed_fv + F[i].inv_unlisted_bv;
    const A = core * p.pe;
    const B = inv * (1 - p.disc);
    const C = F[i].net_cash;
    const D = ded[p.mode] * p.pe;
    return { tax, core, ded, dq, ttmDrag, inv, A, B, C, D, K, ttmNi: ttm('ni_ng'), ttmAssoc: ttm('assoc_ng'), ps: (A + B + C - D) / K };
  }
  const cur = () => calc(S.fin.length - 1, S);
  const prev = () => calc(S.fin.length - 2, S);

  // ---- 通用表格 ----

  function groupedTable(table, cols, rows) {
    const head = table.querySelector('thead tr');
    head.textContent = '';
    head.appendChild(el('th', '', '指标'));
    cols.forEach((c) => head.appendChild(el('th', 'n', c)));
    const tb = table.querySelector('tbody');
    tb.textContent = '';
    let grp = null;
    rows.forEach((r) => {
      if (r.grp !== grp) {
        grp = r.grp;
        const gr = el('tr', 'grp');
        const gh = el('th', '', grp);
        gh.colSpan = cols.length + 1;
        gr.appendChild(gh);
        tb.appendChild(gr);
      }
      const tr = el('tr', r.unit === '%' ? 'ratio' : '');
      tr.appendChild(el('td', 'nowrap lv' + r.level, r.metric));
      r.vals.forEach((v) => tr.appendChild(el('td', 'n' + (r.level === 0 ? ' lv0n' : ''), r.fmt(v))));
      tb.appendChild(tr);
    });
  }
  function plainTable(table, cols, rows, cls) {
    const head = table.querySelector('thead tr');
    head.textContent = '';
    cols.forEach((c, k) => head.appendChild(el('th', k ? 'n' : '', c)));
    const tb = table.querySelector('tbody');
    tb.textContent = '';
    rows.forEach((r) => {
      const tr = el('tr', r.cls || '');
      r.cells.forEach((c, k) => {
        const td = el('td', (k ? 'n ' : 'nowrap ') + ((cls && cls(r, k)) || ''), c);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
  }
  function buttons(box, opts, get, set, label, sub) {
    box.textContent = '';
    opts.forEach((o) => {
      const b = el('button', 'opt');
      b.setAttribute('aria-pressed', String(get() === o));
      b.appendChild(el('span', '', label(o)));
      if (sub) b.appendChild(el('span', 'sub2', sub(o)));
      b.addEventListener('click', () => { set(o); renderAll(); });
      box.appendChild(b);
    });
  }

  // ---- 顶部 ----

  function renderHead() {
    const c = cur();
    const v = S.val;
    const mcapCny = v.price_hkd * v.shares_mn * v.fx_cny_per_hkd;
    $('tx-date').textContent = `${v.price_date}${v.stale ? '（行情未更新）' : ''} · 财务截至 ${S.fin[S.fin.length - 1].q}`;
    $('tx-price').textContent = num(v.price_hkd, 2);
    $('tx-mcap').textContent = num(v.price_hkd * v.shares_mn / 100, 0);
    $('tx-pettm').textContent = num(mcapCny / c.ttmNi, 1) + 'x';
    $('tx-cpe').textContent = num((mcapCny - c.B - c.C) / (c.ttmNi - c.ttmAssoc), 1) + 'x';
    $('tx-dy').textContent = pct(v.dps_hkd / v.price_hkd, 2);
    $('tx-dy').parentElement.title = `每股股息 ${v.dps_hkd} 港元（${v.dps_year} 年末期）`;
    $('tx-mcap').parentElement.title = `${num(v.shares_mn, 1)} 百万股（${v.shares_asof} 月报表，已发行 − 库存股）`;
    $('tx-view').textContent = S.cfg.market_view || '';
    return mcapCny;
  }

  // ---- 标签 1：公司档案 ----

  function renderProfile() {
    const F = S.fin;
    const n = F.length;
    const idx = [n - 4, n - 3, n - 2, n - 1];
    const yoy = (k) => (i) => (i >= 4 && ok(F[i][k]) && ok(F[i - 4][k]) ? F[i][k] / F[i - 4][k] - 1 : null);
    const A = (k) => (i) => yi(F[i][k]);
    const sh = (k) => (i) => (ok(F[i][k]) ? F[i][k] / F[i].rev : null);
    const shareAt = (i) => {
      const m = F[i].q.slice(0, 2) === '' ? '' : `20${F[i].q.slice(0, 2)}-${String((+F[i].q[3]) * 3).padStart(2, '0')}`;
      const s = S.shares.find((x) => x.month === m);
      return s ? (s.issued_ex_treasury - s.treasury) / 1e8 : null;
    };
    const defs = [
      ['收入', '营业收入', '亿元', 0, A('rev')], ['收入', '同比', '%', 1, yoy('rev')],
      ['收入', '国内游戏', '亿元', 1, A('game_dom')], ['收入', '同比', '%', 2, yoy('game_dom')],
      ['收入', '海外游戏', '亿元', 1, A('game_intl')], ['收入', '同比', '%', 2, yoy('game_intl')],
      ['收入', '社交网络', '亿元', 1, A('social')], ['收入', '同比', '%', 2, yoy('social')],
      ['收入', '广告', '亿元', 0, A('mkt')], ['收入', '同比', '%', 1, yoy('mkt')],
      ['收入', '金融科技及企业服务', '亿元', 0, A('fbs')], ['收入', '同比', '%', 1, yoy('fbs')],
      ['收入', '其他', '亿元', 0, A('others')],
      ['利润', '毛利', '亿元', 0, A('gp')], ['利润', '毛利率', '%', 1, sh('gp')],
      ['利润', 'Non-IFRS 经营利润', '亿元', 0, A('op_ng')], ['利润', '经营利润率', '%', 1, sh('op_ng')],
      ['利润', '剔除新 AI 产品经营利润', '亿元', 0, A('op_exai')], ['利润', '经营利润率', '%', 1, sh('op_exai')],
      ['利润', 'AI 拖累（两者之差）', '亿元', 1, (i) => yi(dragQ(F[i]))],
      ['利润', 'Non-IFRS 归母净利润', '亿元', 0, A('ni_ng')], ['利润', '净利率', '%', 1, sh('ni_ng')],
      ['利润', 'IFRS 归母净利润', '亿元', 0, A('ni')],
      ['费用', '一般及行政（含研发）', '亿元', 0, A('ga')], ['费用', '费用率', '%', 1, sh('ga')],
      ['费用', '销售及市场', '亿元', 0, A('sm')], ['费用', '费用率', '%', 1, sh('sm')],
      ['现金流', '经营现金流', '亿元', 0, A('cfo')], ['现金流', '资本开支（公司口径，权责）', '亿元', 0, A('capex')], ['现金流', '资本开支付款（现金）', '亿元', 0, A('capex_paid')],
      ['现金流', '自由现金流', '亿元', 0, A('fcf')], ['现金流', '剔除算力预付款的自由现金流', '亿元', 0, A('fcf_ex_prepay')],
      ['股本与回购', '期末已发行股数（亿股，月报表）', '亿股', 0, shareAt],
      ['股本与回购', '当季回购金额（亿港元）', '亿港元', 0, (i) => yi(F[i].buyback_hkd)]
    ];
    const rows = defs.map(([grp, metric, unit, level, f]) => ({
      grp, metric, unit, level, vals: idx.map(f),
      fmt: (v) => (unit === '%' ? pct(v) : unit === '亿股' ? num(v, 2) : num(v))
    }));
    groupedTable($('t-tx-fin'), idx.map((i) => F[i].q), rows);
    const pd = $('t-tx-people').querySelector('tbody');
    pd.textContent = '';
    if (!S.people.length) {
      const tr = el('tr');
      const td = el('td', '', '年报“董事及高级管理层”抽取待接入。');
      td.colSpan = 5;
      tr.appendChild(td);
      pd.appendChild(tr);
    } else {
      fillBody($('t-tx-people'), S.people, [{ f: 'name', cls: 'nowrap' }, { f: 'age', cls: 'n' }, { f: 'title' }, { f: 'edu' }, { f: 'background' }]);
    }
    const hb = $('t-tx-hold').querySelector('tbody');
    hb.textContent = '';
    if (!S.holders.length) {
      const tr = el('tr');
      const td = el('td', '', '权益披露（≥5% 股东及董事权益）抽取待接入；CCASS 为表单页，暂未接通。');
      td.colSpan = 5;
      tr.appendChild(td);
      hb.appendChild(tr);
    } else {
      fillBody($('t-tx-hold'), S.holders, [{ f: 'holder', link: true }, { f: 'type', cls: 'nowrap' }, { cls: 'n', fmt: (r) => d3.format(',.0f')(r.shares) },
        { cls: 'n', fmt: (r) => d3.format('.2%')(r.pct) }, { f: 'asof', cls: 'nowrap' }]);
    }
  }

  // ---- 标签 2：判断与追踪 ----

  function renderFormula() {
    const c = cur();
    const p = prev();
    const F = S.fin;
    const n = F.length;
    const L = F[n - 1];
    const P = F[n - 2];
    const ch = (a, b) => (ok(a) && ok(b) && b !== 0 ? a / b - 1 : null);
    const blocks = [
      { id: 'tx-s1', t: '① 核心业务', main: num(yi(c.core)) + ' 亿', d: ch(c.core, p.core), dtxt: spct(ch(c.core, p.core)),
        lines: [`近 4 季核心利润`, `剔除 AI 经营利润同比 ${pct(L.op_exai_yoy_reported, 0)}（公司披露）`, `倍数：${S.pe}x PE`] },
      { id: 'tx-s2', t: '② 投资组合', main: num(yi(c.inv)) + ' 亿', d: ch(c.inv, p.inv), dtxt: spct(ch(c.inv, p.inv)),
        lines: [`折扣 ${pct(S.disc, 0)}（折后 ${num(yi(c.B))} 亿）`, `上市 ${spct(ch(L.inv_listed_fv, P.inv_listed_fv))} · 非上市 ${spct(ch(L.inv_unlisted_bv, P.inv_unlisted_bv))}`] },
      { id: 'tx-s3', t: '③ 净现金', main: num(yi(c.C)) + ' 亿', d: c.C - p.C, dtxt: (c.C - p.C >= 0 ? '+' : '−') + num(Math.abs(yi(c.C - p.C))) + ' 亿',
        lines: [`上季 ${num(yi(p.C))} 亿`, `自由现金流 ${num(yi(L.fcf))} · 回购 ${num(yi(L.buyback_hkd))} 亿港元`] },
      { id: 'tx-s4', t: '④ AI 拖累', main: num(yi(c.ded[S.mode])) + ' 亿', d: ch(c.ded[S.mode], p.ded[S.mode]), dtxt: spct(ch(c.ded[S.mode], p.ded[S.mode])), bad: true,
        lines: [`倍数：${S.pe}x PE · ${MODES[S.mode]}`, `最新季 ${num(yi(c.dq))} 亿 · 环比 ${spct(ch(dragQ(L), dragQ(P)), 0)}`] }
    ];
    const bar = $('tx-formula');
    bar.textContent = '';
    blocks.forEach((b, k) => {
      if (k) bar.appendChild(el('span', 'op', k === 3 ? '−' : '＋'));
      const box = el('button', 'fblock');
      box.appendChild(el('span', 'lab', b.t));
      box.appendChild(el('span', 'num big', b.main));
      const dl = el('span', 'num ' + (b.bad ? (ok(b.d) && b.d > 0 ? 'down' : b.d < 0 ? 'up' : '') : sgn(b.d)), '较上季 ' + b.dtxt);
      box.appendChild(dl);
      b.lines.forEach((t) => box.appendChild(el('span', 'note1', t)));
      box.addEventListener('click', () => $(b.id).scrollIntoView({ behavior: 'smooth', block: 'start' }));
      bar.appendChild(box);
    });
    $('tx-take').textContent = `本季要点：核心利润 ${num(yi(c.core))} 亿（${spct(ch(c.core, p.core))}）；投资组合 ${num(yi(c.inv))} 亿；净现金 ${num(yi(c.C))} 亿；` +
      `AI 拖累扣除 ${num(yi(c.ded[S.mode]))} 亿。参数：PE ${S.pe}x · 折扣 ${pct(S.disc, 0)} · AI 口径「${MODES[S.mode]}」。“较上季”用同一组参数分别作用于两个季度，只反映数据变化。`;
  }

  function renderCore() {
    buttons($('tx-pe'), S.cfg.pe_options, () => S.pe, (v) => { S.pe = v; }, (v) => v + 'x');
    const F = S.fin;
    const n = F.length;
    const yo = (k) => (j) => (j >= 4 && ok(F[j][k]) && ok(F[j - 4][k]) ? F[j][k] / F[j - 4][k] - 1 : null);
    const rowsDef = [
      { m: '剔除 AI 经营利润（亿元）', kind: 'amt', f: (j) => yi(F[j].op_exai) },
      { m: '其同比（公司披露）', kind: 'pct', f: (j) => F[j].op_exai_yoy_reported },
      { m: '广告同比', kind: 'pct', f: yo('mkt') },
      { m: '国内游戏同比', kind: 'pct', f: yo('game_dom'), star: !!F[n - 1].game_dom_note },
      { m: '海外游戏同比', kind: 'pct', f: yo('game_intl') },
      { m: '金融科技及企业服务同比', kind: 'pct', f: yo('fbs') }
    ];
    const rows = rowsDef.map((r) => {
      const a = r.f(n - 1);
      const b = r.f(n - 2);
      const y = r.f(n - 5);
      let delta = null;
      let signal = '—';
      if (ok(a) && ok(b)) {
        if (r.kind === 'pct') { delta = a - b; signal = delta > 0.005 ? '回升' : delta < -0.005 ? '下降' : '持平'; }
        else { delta = a / b - 1; signal = delta > 0 ? '环比增长' : delta < 0 ? '环比下降' : '持平'; }
      }
      const fm = (v) => (r.kind === 'pct' ? pct(v) : num(v));
      const dtxt = delta == null ? '—' : (delta > 0 ? '▲ ' : delta < 0 ? '▼ ' : '') + (r.kind === 'pct' ? d3.format('.1f')(Math.abs(delta) * 100) + 'pp' : d3.format('.1%')(Math.abs(delta)));
      return { cells: [r.m + (r.star ? ' *' : ''), fm(a), fm(b), fm(y), dtxt, signal], delta, signal };
    });
    plainTable($('t-tx-drv'), ['指标', '最新季', '上一季', '去年同季', '较上季', '信号'], rows, (r, k) =>
      (k === 4 ? sgn(r.delta) : k === 5 ? (/回升|增长/.test(r.signal) ? 'up' : /下降/.test(r.signal) ? 'down' : '') : ''));
    $('tx-drv-note').textContent = F[n - 1].game_dom_note ? '* 国内游戏（公告原文）：' + F[n - 1].game_dom_note : '';
    const c = cur();
    $('tx-core-calc').textContent = `核心利润 = Non-IFRS 归母净利润 近4季 ${num(yi(c.ttmNi))} − 联营（非 IFRS）${num(yi(c.ttmAssoc))} + AI 拖累税后 ${num(yi(c.ttmDrag * (1 - c.tax)))} = ${num(yi(c.core))} 亿元；` +
      `有效税率 ${pct(c.tax)}；× ${S.pe}x PE = ${num(yi(c.A))} 亿元。` + '（剔除口径 26Q1 起披露，此前季度 AI 拖累按 0 计。）';
    const rowsG = F.map((r, j) => ({
      q: r.q, mkt: yo('mkt')(j), game_dom: yo('game_dom')(j), game_intl: yo('game_intl')(j), fbs: yo('fbs')(j)
    })).filter((r) => ok(r.mkt)).slice(-8);
    S.growth = rowsG;
    drawLines('tx-c-growth', rowsG, [
      { k: 'mkt', name: '广告', color: 'var(--fg)', w: 1.75, dash: null },
      { k: 'game_dom', name: '国内游戏', color: 'var(--muted)', w: 1.25, dash: null },
      { k: 'game_intl', name: '海外游戏', color: 'var(--muted)', w: 1.25, dash: '4 3' },
      { k: 'fbs', name: '金科企服', color: 'var(--muted)', w: 1.25, dash: '1 3' }
    ]);
  }

  function renderPortfolio() {
    const F = S.fin;
    const n = F.length;
    const K = S.val.fx_cny_per_hkd * S.val.shares_mn;
    const c = cur();
    buttons($('tx-disc'), S.cfg.disc_options, () => S.disc, (v) => { S.disc = v; }, (v) => pct(v, 0),
      (v) => num(calc(n - 1, { ...S, disc: v }).ps, 0));
    const idx = [n - 4, n - 3, n - 2, n - 1];
    const rows = [
      ['上市公允价值（亿元）', (i) => yi(F[i].inv_listed_fv)],
      ['非上市账面价值（亿元）', (i) => yi(F[i].inv_unlisted_bv)],
      ['合计（亿元）', (i) => yi(F[i].inv_listed_fv + F[i].inv_unlisted_bv)],
      [`折后（${pct(S.disc, 0)}，亿元）`, (i) => yi((F[i].inv_listed_fv + F[i].inv_unlisted_bv) * (1 - S.disc))],
      ['折后每股（港元）', (i) => (F[i].inv_listed_fv + F[i].inv_unlisted_bv) * (1 - S.disc) / K]
    ].map(([m, f]) => ({ cells: [m, ...idx.map((i) => num(f(i), m.includes('港元') ? 1 : 1))] }));
    plainTable($('t-tx-port'), ['指标', ...idx.map((i) => F[i].q)], rows);
    $('tx-port-take').textContent = `折后每股 ${num(c.B / K, 1)} 港元，占现价 ${pct(c.B / K / S.val.price_hkd, 0)}。每股用最新汇率和股本折算。`;
  }

  function renderCash() {
    const F = S.fin;
    const n = F.length;
    const K = S.val.fx_cny_per_hkd * S.val.shares_mn;
    const idx = [n - 4, n - 3, n - 2, n - 1];
    const debt = (r) => r.borrow_cur + r.borrow_nc + (r.notes_cur ?? 0) + r.notes_nc;
    const bbCny = (r) => (ok(r.buyback_hkd) ? r.buyback_hkd * S.val.fx_cny_per_hkd : null);
    const d = (i) => F[i].net_cash - F[i - 1].net_cash;
    const rows = [
      ['总现金（亿元）', (i) => yi(F[i].cash_total)], ['借款 + 应付票据（亿元）', (i) => yi(debt(F[i]))],
      ['净现金（公司口径，亿元）', (i) => yi(F[i].net_cash)], ['每股净现金（港元）', (i) => F[i].net_cash / K],
      ['净现金变动（亿元）', (i) => yi(d(i))], ['　自由现金流', (i) => yi(F[i].fcf)],
      ['　回购（估算，按最新汇率折人民币）', (i) => (ok(bbCny(F[i])) ? -yi(bbCny(F[i])) : null)],
      ['　其他（含派息、投资等，倒挤）', (i) => (ok(bbCny(F[i])) ? yi(d(i) - F[i].fcf + bbCny(F[i])) : null)]
    ].map(([m, f]) => ({ cells: [m, ...idx.map((i) => num(f(i)))] }));
    plainTable($('t-tx-cash'), ['指标', ...idx.map((i) => F[i].q)], rows);
  }

  function renderDrag() {
    const F = S.fin;
    const n = F.length;
    const c = cur();
    buttons($('tx-mode'), S.cfg.ai_modes, () => S.mode, (v) => { S.mode = v; }, (v) => MODES[v]);
    const idx = [n - 4, n - 3, n - 2, n - 1];
    const rows = [
      ['AI 拖累（税前单季，亿元）', (i) => num(yi(dragQ(F[i])))],
      ['占剔除 AI 经营利润比', (i) => (dragQ(F[i]) == null ? '—' : pct(dragQ(F[i]) / F[i].op_exai))],
      ['资本开支（权责，亿元）', (i) => num(yi(F[i].capex))],
      ['拖累 ÷ 资本开支', (i) => (dragQ(F[i]) == null ? '—' : pct(dragQ(F[i]) / F[i].capex))]
    ].map(([m, f]) => ({ cells: [m, ...idx.map(f)] }));
    plainTable($('t-tx-drag'), ['指标', ...idx.map((i) => F[i].q)], rows);
    $('tx-drag-take').textContent = `税后：近 4 季 ${num(yi(c.ded.ttm))} 亿 · 最新季 ×4 ${num(yi(c.ded.lq4))} 亿；当前口径扣除 ${num(yi(c.ded[S.mode]))} 亿 × ${S.pe}x = ${num(yi(c.D))} 亿元。` +
      '剔除口径 26Q1 起披露，此前季度无拖累数据。';
    S.bars = F.slice(-6).map((r) => ({ q: r.q, capex: yi(r.capex), drag: yi(dragQ(r)) }));
    drawBars('tx-c-capex', S.bars);
  }

  function renderMatrix() {
    const n = S.fin.length;
    const price = S.val.price_hkd;
    const rows = S.cfg.pe_options.map((pe) => {
      const cells = Object.keys(MODES).map((m) => calc(n - 1, { ...S, pe, mode: m }).ps);
      return { cells: [pe + 'x', ...cells.map((v) => `${num(v, 0)}  (${spct(v / price - 1, 0)})`)], vals: cells, pe };
    });
    plainTable($('t-tx-matrix'), ['核心 PE', ...Object.values(MODES)], rows, (r, k) =>
      (k ? sgn(r.vals[k - 1] / price - 1) + (r.pe === S.pe && Object.keys(MODES)[k - 1] === S.mode ? ' curcell' : '') : ''));
  }

  function renderZero() {
    buttons($('tx-r'), S.cfg.r_options, () => S.r, (v) => { S.r = v; }, (v) => pct(v, 0));
    const c = cur();
    const price = S.val.price_hkd;
    const mcapCny = price * S.val.shares_mn * S.val.fx_cny_per_hkd;
    const es = Object.keys(MODES).map((m) => c.core - c.ded[m]);
    const ps = es.map((e) => (e / S.r + c.B + c.C) / c.K);
    const ret = es.map((e) => e / (mcapCny - c.B - c.C));
    const rows = [
      { cells: ['每股价值（港元）', ...ps.map((v) => `${num(v, 0)}  (${spct(v / price - 1, 0)})`)], v: ps.map((v) => v / price - 1) },
      { cells: ['现价买入年回报', ...ret.map((v) => pct(v))], v: ret.map(() => null) },
      { cells: ['所需永续增长', ...ret.map((v) => pct(S.r - v))], v: ret.map(() => null) }
    ];
    plainTable($('t-tx-zero'), ['', ...Object.values(MODES)], rows, (r, k) => (k ? sgn(r.v[k - 1]) : ''));
  }

  function renderQa() {
    const all = S.log.filter((r) => r.kind === 'qa').sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1));
    const keep = new Set([...new Set(all.map((r) => r.quarter))].slice(0, 4));  // 近 4 个季度，每季最多 4 条
    const qa = all.filter((r) => keep.has(r.quarter));
    const latest = S.fin[S.fin.length - 1].q;
    if (!qa.length) {
      const tb = $('t-tx-qa').querySelector('tbody');
      tb.textContent = '';
      const tr = el('tr');
      const td = el('td', '', '腾讯不提供官方业绩会文字稿；粘贴文字稿后由 qual_draft 起草，经 PR 审核后显示。');
      td.colSpan = 3;
      tr.appendChild(td);
      tb.appendChild(tr);
      return;
    }
    fillBody($('t-tx-qa'), qa, [{ f: 'quarter', cls: 'nowrap' }, { f: 'title', link: true }, { f: 'detail' }], (r) => r.quarter === latest);
  }

  // ---- 标签 3：资金面与事件 ----

  function renderFlow() {
    const F = S.fin;
    const n = F.length;
    const rows = F.slice(-8).map((r, k) => {
      const yago = F[n - 8 + k - 4];
      return { cells: [r.q, num(r.buyback_shares, 1), num(yi(r.buyback_hkd)), ok(r.buyback_hkd) ? num(r.buyback_hkd / r.buyback_shares, 1) : '—', yago ? num(yi(yago.buyback_hkd)) : '—'] };
    });
    plainTable($('t-tx-bb'), ['季度', '股数（百万）', '金额（亿港元）', '均价（港元）', '去年同季金额'], rows);
    const sh = S.shares.slice(-7).map((s, k, a) => ({
      cells: [s.month, num((s.issued_ex_treasury - s.treasury) / 1e8, 3), k ? num((s.issued_ex_treasury - a[k - 1].issued_ex_treasury) / 1e6, 1) : '—', num(s.treasury / 1e6, 1)]
    }));
    plainTable($('t-tx-sh'), ['月份', '已发行 − 库存（亿股）', '当月变动（百万股）', '库存股（百万）'], sh);
    const lastDate = F[n - 1].announce_date;
    const of = (k) => S.log.filter((r) => r.kind === k).sort((a, b) => (a.date < b.date ? 1 : -1));
    const dated = [{ f: 'date', cls: 'nowrap' }, { f: 'title', link: true }, { f: 'detail' }];
    const isNew = (r) => r.date > lastDate;
    fillBody($('t-tx-holder'), of('holder'), dated, isNew);
    fillBody($('t-tx-event'), [...of('event'), ...of('view'), ...of('team')].sort((a, b) => (a.date < b.date ? 1 : -1)), dated, isNew);
  }

  // ---- 标签 4：AI 产出 ----

  function renderAi() {
    const { signals, turns, products } = S.ai;
    fillBody($('t-tx-sig'), signals, [{ f: 'name', cls: 'nowrap' }, { f: 'judgment' }, { f: 'basis' }, { f: 'status', cls: 'nowrap' }, { f: 'updated', cls: 'nowrap' }]);
    fillBody($('t-tx-turn'), turns, [{ f: 'text' }, { f: 'status', cls: (r) => 'nowrap' + (r.status === '已出现' ? ' up' : '') }, { f: 'evidence' }, { f: 'updated', cls: 'nowrap' }]);
    const box = $('tx-products');
    box.textContent = '';
    ['应用', '模型与平台', '算力对外'].forEach((grp) => {
      const items = products.filter((p) => p.group === grp);
      if (!items.length) return;
      box.appendChild(el('h4', '', grp));
      items.forEach((p) => {
        const det = el('details', 'prod');
        const sm = el('summary');
        sm.appendChild(el('b', '', p.name));
        sm.appendChild(el('span', 'tagx', p.tag));
        sm.appendChild(el('span', 'note1', p.position + ' — ' + p.judgment));
        det.appendChild(sm);
        if (!p.logs.length) det.appendChild(el('p', 'note', '本季公告未提及。'));
        p.logs.forEach((l) => {
          const li = el('p', 'logrow');
          li.appendChild(el('span', 'd', `${l.date} · ${l.kind}${l.secondhand ? ' · 转述' : ''}`));
          const a = el('a', '', ' ' + l.text);
          a.href = l.source;
          a.target = '_blank';
          a.rel = 'noopener';
          a.style.color = 'inherit';
          li.appendChild(a);
          det.appendChild(li);
        });
        box.appendChild(det);
      });
    });
  }

  // ---- 图表 ----

  function drawLines(id, rows, series) {
    const box = $(id);
    if (!box || !box.clientWidth || !rows.length) return;
    box.textContent = '';
    const W = box.clientWidth;
    const H = 220;
    const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('font-family', MONO);
    const vals = rows.flatMap((r) => series.map((s) => r[s.k])).filter(ok);
    const y = d3.scaleLinear([Math.min(0, d3.min(vals)), d3.max(vals) * 1.15], [H - 24, 12]).nice();
    const left = 40;
    const right = 120;
    const x = d3.scalePoint(rows.map((r) => r.q), [left, W - right]).padding(0.2);
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('x1', left).attr('x2', W - right).attr('y1', y).attr('y2', y)
      .attr('stroke', (d) => (d === 0 ? 'var(--muted)' : 'var(--line)')).attr('stroke-width', (d) => (d === 0 ? 1 : 0.5));
    svg.append('g').selectAll('text').data(y.ticks(4)).join('text').attr('x', left - 6).attr('y', y).attr('dy', '0.32em').attr('text-anchor', 'end')
      .attr('font-size', 11).attr('fill', 'var(--muted)').text((d) => d3.format('.0%')(d));
    svg.append('g').selectAll('text').data(rows).join('text').attr('x', (d) => x(d.q)).attr('y', H - 6).attr('text-anchor', 'middle')
      .attr('font-size', 11).attr('fill', 'var(--muted)').text((d) => d.q);
    const ends = [];
    series.forEach((s) => {
      const pts = rows.filter((r) => ok(r[s.k]));
      svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', s.w).attr('stroke-dasharray', s.dash)
        .attr('stroke-linejoin', 'round').attr('d', d3.line().x((d) => x(d.q)).y((d) => y(d[s.k])));
      const last = pts[pts.length - 1];
      if (last) {
        svg.append('circle').attr('cx', x(last.q)).attr('cy', y(last[s.k])).attr('r', 2.5).attr('fill', s.color);
        ends.push({ s, v: last[s.k], y: y(last[s.k]), x: x(last.q) });
      }
    });
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    ends.forEach((e) => svg.append('text').attr('x', e.x + 8).attr('y', e.y).attr('dy', '0.32em').attr('font-size', 11)
      .attr('fill', e.s === series[0] ? 'var(--fg)' : 'var(--muted)').text(e.s.name + ' ' + pct(e.v)));
    const tip = el('div', 'tip');
    box.appendChild(tip);
    const step = rows.length > 1 ? x(rows[1].q) - x(rows[0].q) : W;
    svg.append('g').selectAll('rect').data(rows).join('rect').attr('x', (d) => x(d.q) - step / 2).attr('y', 0).attr('width', step).attr('height', H).attr('fill', 'transparent')
      .on('mousemove', (ev, d) => {
        tip.textContent = '';
        tip.appendChild(el('div', 't', d.q));
        series.forEach((s) => tip.appendChild(el('div', '', s.name + ' ' + pct(d[s.k]))));
        const [mx, my] = d3.pointer(ev, box);
        tip.style.opacity = 1;
        tip.style.left = Math.min(Math.max(0, mx + 12), box.clientWidth - tip.offsetWidth) + 'px';
        tip.style.top = Math.max(0, my - 20) + 'px';
      })
      .on('mouseleave', () => { tip.style.opacity = 0; });
  }

  function drawBars(id, rows) {
    const box = $(id);
    if (!box || !box.clientWidth || !rows.length) return;
    box.textContent = '';
    const W = box.clientWidth;
    const H = 220;
    const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('font-family', MONO);
    const y = d3.scaleLinear([0, d3.max(rows, (r) => Math.max(r.capex ?? 0, r.drag ?? 0)) * 1.15], [H - 24, 12]).nice();
    const left = 40;
    const x0 = d3.scaleBand(rows.map((r) => r.q), [left, W - 8]).padding(0.25);
    const x1 = d3.scaleBand(['capex', 'drag'], [0, x0.bandwidth()]).padding(0.1);
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('x1', left).attr('x2', W - 8).attr('y1', y).attr('y2', y)
      .attr('stroke', 'var(--line)').attr('stroke-width', 0.5);
    svg.append('g').selectAll('text').data(y.ticks(4)).join('text').attr('x', left - 6).attr('y', y).attr('dy', '0.32em').attr('text-anchor', 'end')
      .attr('font-size', 11).attr('fill', 'var(--muted)').text((d) => d3.format(',.0f')(d));
    svg.append('g').selectAll('text').data(rows).join('text').attr('x', (d) => x0(d.q) + x0.bandwidth() / 2).attr('y', H - 6).attr('text-anchor', 'middle')
      .attr('font-size', 11).attr('fill', 'var(--muted)').text((d) => d.q);
    [['capex', 'var(--fg)'], ['drag', 'var(--muted)']].forEach(([k, color]) => {
      svg.append('g').selectAll('rect').data(rows.filter((r) => ok(r[k]))).join('rect')
        .attr('x', (d) => x0(d.q) + x1(k)).attr('width', x1.bandwidth()).attr('y', (d) => y(d[k])).attr('height', (d) => y(0) - y(d[k])).attr('fill', color);
      svg.append('g').selectAll('text').data(rows.filter((r) => ok(r[k]))).join('text')
        .attr('x', (d) => x0(d.q) + x1(k) + x1.bandwidth() / 2).attr('y', (d) => y(d[k]) - 3).attr('text-anchor', 'middle').attr('font-size', 10)
        .attr('fill', 'var(--muted)').text((d) => d3.format(',.0f')(d[k]));
    });
    svg.append('text').attr('x', left + 4).attr('y', 10).attr('font-size', 11).attr('fill', 'var(--fg)').text('■ 资本开支（亿元）');
    svg.append('text').attr('x', left + 140).attr('y', 10).attr('font-size', 11).attr('fill', 'var(--muted)').text('■ AI 拖累（亿元，税前）');
  }

  // ---- 导航与入口 ----

  function showTx(id) {
    document.querySelectorAll('.txtab').forEach((b) => {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', on);
      $(b.dataset.tab).hidden = !on;
    });
    redrawCharts();
  }
  function redrawCharts() {
    if (!S.fin || $('tx-track').hidden) return;
    drawLines('tx-c-growth', S.growth, [
      { k: 'mkt', name: '广告', color: 'var(--fg)', w: 1.75, dash: null },
      { k: 'game_dom', name: '国内游戏', color: 'var(--muted)', w: 1.25, dash: null },
      { k: 'game_intl', name: '海外游戏', color: 'var(--muted)', w: 1.25, dash: '4 3' },
      { k: 'fbs', name: '金科企服', color: 'var(--muted)', w: 1.25, dash: '1 3' }
    ]);
    drawBars('tx-c-capex', S.bars);
  }
  window.txShown = redrawCharts;

  function renderAll() {
    renderHead();
    renderFormula();
    renderCore();
    renderPortfolio();
    renderCash();
    renderDrag();
    renderMatrix();
    renderZero();
    redrawCharts();
  }

  async function main() {
    const names = ['fin', 'val', 'config', 'shares', 'log', 'ai', 'people', 'holders'];
    const data = await Promise.all(names.map((n) => load(`tencent/${n}.json`)));
    [S.fin, S.val, S.cfg, S.shares, S.log, S.ai, S.people, S.holders] = data;
    S.pe = S.cfg.pe_default;
    S.disc = S.cfg.disc_default;
    S.mode = S.cfg.ai_mode_default;
    S.r = S.cfg.r_default;
    document.querySelectorAll('.txtab').forEach((b) => b.addEventListener('click', () => {
      showTx(b.dataset.tab);
      history.replaceState(null, '', '#' + b.dataset.tab);
    }));
    window.addEventListener('resize', redrawCharts);
    renderProfile();
    renderQa();
    renderFlow();
    renderAi();
    renderAll();
    const h = location.hash.slice(1);
    showTx(h.startsWith('tx-') ? h : 'tx-track');
  }

  main().catch((e) => {
    const d = el('div', 'fail', '腾讯数据加载失败：' + e.message);
    $('tencent').prepend(d);
  });
})();
