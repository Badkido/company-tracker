const DATA = location.pathname.includes('/site/') ? '../data' : 'data';
const fYi = d3.format(',.1f');
const fPct = d3.format('.1%');
const fSigned = d3.format('+.1%');
const fmtUnit = (v, unit) => (v == null ? '—' : unit === '%' ? fPct(v) : fYi(v));
const qn = (q) => (+q.slice(0, 2)) * 4 + (+q.slice(3));
const prevYear = (q) => (+q.slice(0, 2) - 1) + q.slice(2);
const $ = (id) => document.getElementById(id);
const g = (a, b) => (a == null || b == null ? null : a / b - 1);

const load = (path) => fetch(`${DATA}/${path}`).then((r) => {
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
});

// ---- calculations ----

function finTable(fin) {
  const by = Object.fromEntries(fin.map((r) => [r.q, r]));
  const yo = (r) => by[prevYear(r.q)] || {};
  const yi = (v) => (v == null ? null : v / 100);
  const sh = (a, r) => (a == null ? null : a / r.rev);
  const sum = (...xs) => (xs.some((x) => x == null) ? null : xs.reduce((t, x) => t + x, 0));
  const defs = [
    ['收入', '营业收入', '亿元', 0, (r) => yi(r.rev)],
    ['收入', '收入同比', '%', 1, (r) => g(r.rev, yo(r).rev)],
    ['收入', '广告收入', '亿元', 1, (r) => yi(r.oms)],
    ['收入', '广告收入同比', '%', 2, (r) => g(r.oms, yo(r).oms)],
    ['收入', '交易服务收入', '亿元', 1, (r) => yi(r.ts)],
    ['收入', '交易服务收入同比', '%', 2, (r) => g(r.ts, yo(r).ts)],
    ['利润', '毛利', '亿元', 0, (r) => yi(r.rev - r.cogs)],
    ['利润', '毛利率', '%', 1, (r) => sh(r.rev - r.cogs, r)],
    ['利润', 'GAAP经营利润', '亿元', 0, (r) => yi(r.op)],
    ['利润', 'GAAP经营利润率', '%', 1, (r) => sh(r.op, r)],
    ['利润', '非GAAP经营利润', '亿元', 0, (r) => yi(r.op_ng)],
    ['利润', '非GAAP经营利润率', '%', 1, (r) => sh(r.op_ng, r)],
    ['利润', '非GAAP净利润', '亿元', 0, (r) => yi(r.ni_ng)],
    ['利润', '非GAAP净利率', '%', 1, (r) => sh(r.ni_ng, r)],
    ['费用', '销售费用', '亿元', 0, (r) => yi(r.sm)],
    ['费用', '销售费用率', '%', 1, (r) => sh(r.sm, r)],
    ['现金流', '经营现金流', '亿元', 0, (r) => yi(r.cfo)],
    ['现金流', '现金净增加额', '亿元', 0, (r) => yi(r.ncf)],
    ['资产负债', '现金余额', '亿元', 0, (r) => yi(r.cash)],
    ['资产负债', '其他现金类（受限 + 短期投资）', '亿元', 0, (r) => yi(sum(r.cash, r.cash_sti, r.restricted) == null ? null : r.cash_sti - r.cash + r.restricted)],
    ['资产负债', '应收', '亿元', 0, (r) => yi(sum(r.recv, r.due_from_rel, r.prepay))],
    ['资产负债', '应付', '亿元', 0, (r) => yi(sum(r.pay_merch, r.merch_dep, r.accrued, r.advances, r.due_to_rel))],
    ['资产负债', '固定资产净值', '亿元', 0, (r) => yi(r.ppe)],
    ['资产负债', '存货', '亿元', 0, (r) => yi(r.inventory)],
    ['资产负债', '有息负债', '亿元', 0, (r) => yi(r.debt)]
  ];
  const last = fin.slice(-4);
  return { cols: last.map((r) => r.q), rows: defs.map(([grp, metric, unit, level, f]) => {
    const row = { metric, grp, unit, level };
    last.forEach((r) => { row[r.q] = f(r); });
    return row;
  }) };
}

function growthRows(fin) {
  const by = Object.fromEntries(fin.map((r) => [r.q, r]));
  const all = fin.map((r) => {
    const y = by[prevYear(r.q)] || {};
    return { q: r.q, rev_yoy: g(r.rev, y.rev), oms_yoy: g(r.oms, y.oms), ts_yoy: g(r.ts, y.ts) };
  }).filter((r) => r.rev_yoy != null);
  return all.slice(-8);
}

function trackRows(fin) {
  const by = Object.fromEntries(fin.map((r) => [r.q, r]));
  const L = fin[fin.length - 1];
  const P = fin[fin.length - 2];
  const Y = by[prevYear(L.q)];
  const PY = P && by[prevYear(P.q)];
  const YY = Y && by[prevYear(Y.q)];
  const sh = (r, k) => (r && r[k] != null ? r[k] / r.rev : null);
  const yi = (r, k) => (r && r[k] != null ? r[k] / 100 : null);
  const yoy = (a, b, k) => (a && b ? g(a[k], b[k]) : null);
  const dir = (a, b) => (a == null || b == null ? '—' : a - b > 0.005 ? '回升' : a - b < -0.005 ? '下降' : '持平');
  const rows = [
    { metric: '广告收入同比', unit: '%', latest: yoy(L, Y, 'oms'), prev: yoy(P, PY, 'oms'), yago: yoy(Y, YY, 'oms') },
    { metric: '交易服务收入同比', unit: '%', latest: yoy(L, Y, 'ts'), prev: yoy(P, PY, 'ts'), yago: yoy(Y, YY, 'ts') },
    { metric: '非GAAP经营利润率', unit: '%', latest: sh(L, 'op_ng'), prev: sh(P, 'op_ng'), yago: sh(Y, 'op_ng') },
    { metric: '销售费用率', unit: '%', latest: sh(L, 'sm'), prev: sh(P, 'sm'), yago: sh(Y, 'sm') },
    { metric: '固定资产净值', unit: '亿元', latest: yi(L, 'ppe'), prev: yi(P, 'ppe'), yago: yi(Y, 'ppe') },
    { metric: '预付款及其他流动资产', unit: '亿元', latest: yi(L, 'prepay'), prev: yi(P, 'prepay'), yago: yi(Y, 'prepay') },
    { metric: '存货', unit: '亿元', latest: yi(L, 'inventory'), prev: yi(P, 'inventory'), yago: yi(Y, 'inventory') },
    { metric: '现金及短期投资', unit: '亿元', latest: yi(L, 'cash_sti'), prev: yi(P, 'cash_sti'), yago: yi(Y, 'cash_sti') }
  ];
  return rows.map((r) => {
    let signal;
    if (r.unit === '%') signal = dir(r.latest, r.prev);
    else if (r.metric === '存货') signal = r.latest == null ? '未出现' : '已出现';
    else if (r.latest == null || r.prev == null) signal = '—';
    else signal = r.latest / r.prev > 1.5 ? '跳升' : '持平';
    let delta = null;
    if (r.latest != null && r.prev != null) delta = r.unit === '%' ? r.latest - r.prev : r.latest / r.prev - 1;
    return { quarter: L.q, signal, delta, ...r };
  });
}

function valuation(v, fin) {
  const last = fin.slice(-4);
  const niUsd = last.reduce((s, r) => s + r.ni_ng, 0) / v.fx / 1000;
  const opUsd = last.reduce((s, r) => s + r.op_ng, 0) / v.fx / 1000;
  const mcap = v.price_usd * v.ads_mn / 1000;
  return {
    mcap_bn: mcap * 10,
    pe_ttm: mcap / niUsd,
    pe_26e: v.price_usd / (v.eps26e_rmb / v.fx),
    ev_op: (mcap - v.net_cash_usd_bn) / opUsd,
    cash_per_ads: v.net_cash_usd_bn * 1000 / v.ads_mn
  };
}

function scenarios(scen, v) {
  return scen.map((s) => {
    const perAds = (s.nopat_bn / s.r + v.net_cash_usd_bn * (1 - s.cash_disc)) * 1000 / v.ads_mn;
    return { ...s, per_ads: perAds, vs_price: perAds / v.price_usd - 1 };
  });
}

// ---- rendering ----

function fillBody(table, rows, cells, isNew) {
  const tb = table.querySelector('tbody');
  tb.textContent = '';
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    if (isNew && isNew(r)) tr.className = 'new';
    cells.forEach((c) => {
      const td = document.createElement('td');
      if (c.cls) td.className = typeof c.cls === 'function' ? c.cls(r) : c.cls;
      const v = c.fmt ? c.fmt(r) : r[c.f];
      if (c.link && r.source) {
        const a = document.createElement('a');
        a.href = r.source;
        a.textContent = v == null ? '—' : String(v);
        a.target = '_blank';
        a.rel = 'noopener';
        a.style.color = 'inherit';
        td.appendChild(a);
      } else td.textContent = v == null ? '—' : String(v);
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
}

function renderFin(fin) {
  const { cols, rows } = finTable(fin);
  const t = $('t-fin');
  const head = t.querySelector('thead tr');
  head.textContent = '';
  const h0 = document.createElement('th');
  h0.textContent = '指标';
  head.appendChild(h0);
  cols.forEach((c) => {
    const th = document.createElement('th');
    th.className = 'n';
    th.textContent = c;
    head.appendChild(th);
  });
  const tb = t.querySelector('tbody');
  tb.textContent = '';
  let grp = null;
  rows.forEach((r) => {
    if (r.grp !== grp) {
      grp = r.grp;
      const gr = document.createElement('tr');
      gr.className = 'grp';
      const gh = document.createElement('th');
      gh.colSpan = cols.length + 1;
      gh.textContent = grp;
      gr.appendChild(gh);
      tb.appendChild(gr);
    }
    const tr = document.createElement('tr');
    if (r.unit === '%') tr.className = 'ratio';
    const td0 = document.createElement('td');
    td0.className = 'nowrap lv' + r.level;
    td0.textContent = r.metric;
    tr.appendChild(td0);
    cols.forEach((c) => {
      const td = document.createElement('td');
      td.className = 'n' + (r.level === 0 ? ' lv0n' : '');
      td.textContent = r.metric === '存货' && r[c] == null ? '无科目' : fmtUnit(r[c], r.unit);
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
}

function renderTrack(rows) {
  const sigCls = (r) => (r.signal === '回升' ? 'up' : r.signal === '下降' ? 'down' : r.signal === '跳升' || r.signal === '已出现' ? 'flag' : '');
  fillBody($('t-track'), rows, [
    { f: 'metric' },
    { cls: 'n', fmt: (r) => (r.metric === '存货' && r.latest == null ? '无科目' : fmtUnit(r.latest, r.unit)) },
    { cls: 'n', fmt: (r) => fmtUnit(r.prev, r.unit) },
    { cls: 'n', fmt: (r) => fmtUnit(r.yago, r.unit) },
    { cls: (r) => 'n ' + (r.delta == null ? '' : r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''),
      fmt: (r) => (r.delta == null ? '—' : (r.delta > 0 ? '▲ ' : r.delta < 0 ? '▼ ' : '') + (r.unit === '%' ? d3.format('.1f')(Math.abs(r.delta) * 100) + 'pp' : d3.format('.0%')(Math.abs(r.delta)))) },
    { f: 'signal', cls: sigCls }
  ]);
}

let growthData = null;
function drawGrowth(rows) {
  growthData = rows;
  const box = $('c-growth');
  if (!box.clientWidth || !rows.length) return;
  box.textContent = '';
  const W = box.clientWidth;
  const H = 220;
  const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
  const series = [
    { k: 'rev_yoy', name: '营业收入', color: 'var(--fg)', w: 1.75, dash: null },
    { k: 'oms_yoy', name: '广告', color: 'var(--muted)', w: 1.25, dash: null },
    { k: 'ts_yoy', name: '交易', color: 'var(--muted)', w: 1.25, dash: '4 3' }
  ];
  const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', '收入同比增速折线图').attr('font-family', MONO);
  const vals = rows.flatMap((r) => series.map((s) => r[s.k])).filter((v) => v != null);
  const y = d3.scaleLinear([Math.min(0, d3.min(vals)), d3.max(vals) * 1.15], [H - 24, 12]).nice();
  const left = 40;
  const right = 110;
  const x = d3.scalePoint(rows.map((r) => r.q), [left, W - right]).padding(0.2);
  svg.append('g').selectAll('line').data(y.ticks(4)).join('line')
    .attr('x1', left).attr('x2', W - right).attr('y1', y).attr('y2', y)
    .attr('stroke', (d) => (d === 0 ? 'var(--muted)' : 'var(--line)')).attr('stroke-width', (d) => (d === 0 ? 1 : 0.5));
  svg.append('g').selectAll('text').data(y.ticks(4)).join('text')
    .attr('x', left - 6).attr('y', y).attr('dy', '0.32em').attr('text-anchor', 'end')
    .attr('font-size', 11).attr('fill', 'var(--muted)').text((d) => d3.format('.0%')(d));
  svg.append('g').selectAll('text').data(rows).join('text')
    .attr('x', (d) => x(d.q)).attr('y', H - 6).attr('text-anchor', 'middle')
    .attr('font-size', 11).attr('fill', 'var(--muted)').text((d) => d.q);
  const ends = [];
  series.forEach((s) => {
    const pts = rows.filter((r) => r[s.k] != null);
    svg.append('path').datum(pts).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', s.w)
      .attr('stroke-dasharray', s.dash).attr('stroke-linejoin', 'round')
      .attr('d', d3.line().x((d) => x(d.q)).y((d) => y(d[s.k])));
    const last = pts[pts.length - 1];
    if (last) {
      svg.append('circle').attr('cx', x(last.q)).attr('cy', y(last[s.k])).attr('r', 2.5).attr('fill', s.color);
      ends.push({ s, v: last[s.k], y: y(last[s.k]), x: x(last.q) });
    }
  });
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  ends.forEach((e) => {
    svg.append('text').attr('x', e.x + 8).attr('y', e.y).attr('dy', '0.32em').attr('font-size', 11)
      .attr('fill', e.s.k === 'rev_yoy' ? 'var(--fg)' : 'var(--muted)').text(e.s.name + ' ' + fPct(e.v));
  });
  const tip = document.createElement('div');
  tip.className = 'tip';
  box.appendChild(tip);
  const step = rows.length > 1 ? x(rows[1].q) - x(rows[0].q) : W;
  svg.append('g').selectAll('rect').data(rows).join('rect')
    .attr('x', (d) => x(d.q) - step / 2).attr('y', 0).attr('width', step).attr('height', H).attr('fill', 'transparent')
    .on('mousemove', (ev, d) => {
      tip.textContent = '';
      const t = document.createElement('div');
      t.className = 't';
      t.textContent = d.q;
      tip.appendChild(t);
      series.forEach((s) => {
        const line = document.createElement('div');
        line.textContent = s.name + ' ' + (d[s.k] == null ? '—' : fPct(d[s.k]));
        tip.appendChild(line);
      });
      const [mx, my] = d3.pointer(ev, box);
      tip.style.opacity = 1;
      tip.style.left = Math.min(Math.max(0, mx + 12), box.clientWidth - tip.offsetWidth) + 'px';
      tip.style.top = Math.max(0, my - 20) + 'px';
    })
    .on('mouseleave', () => { tip.style.opacity = 0; });
}

// ---- navigation ----

function showPage(id) {
  document.querySelectorAll('.toptab').forEach((b) => {
    const on = b.dataset.page === id;
    b.setAttribute('aria-selected', on);
    const el = $(b.dataset.page);
    if (el) el.hidden = !on;
  });
  if (id === 'tencent' && window.txShown) window.txShown();
}
function showTab(id) {
  document.querySelectorAll('.subtab').forEach((b) => {
    const on = b.dataset.tab === id;
    b.setAttribute('aria-selected', on);
    $(b.dataset.tab).hidden = !on;
  });
  if (id === 'pdd-track' && growthData) drawGrowth(growthData);
}

function buildNav(companies) {
  const top = $('top');
  const mk = (label, page) => {
    const b = document.createElement('button');
    b.className = 'tab toptab';
    b.setAttribute('role', 'tab');
    b.dataset.page = page;
    b.textContent = label;
    b.addEventListener('click', () => { showPage(page); history.replaceState(null, '', '#' + page); });
    top.appendChild(b);
  };
  mk('总览', 'overview');
  companies.filter((c) => c.enabled).forEach((c) => mk(`${c.name} ${c.ticker}`, c.id));
  const add = document.createElement('button');
  add.className = 'tab';
  add.disabled = true;
  add.textContent = '＋ 添加公司';
  top.appendChild(add);
  document.querySelectorAll('.subtab').forEach((b) => b.addEventListener('click', () => {
    showTab(b.dataset.tab);
    history.replaceState(null, '', '#' + b.dataset.tab);
  }));
  window.addEventListener('resize', () => { if (growthData) drawGrowth(growthData); });
  const h = location.hash.slice(1);
  if (['pdd-profile', 'pdd-track', 'pdd-change'].includes(h)) { showPage('pdd'); showTab(h); }
  else if (h === 'tencent' || h.startsWith('tx-')) showPage('tencent');
  else showPage(h === 'overview' ? 'overview' : 'pdd');
}

// ---- main ----

async function main() {
  const companies = await load('companies.json').catch(() => [{ id: 'pdd', name: '拼多多', ticker: 'PDD', enabled: true }]);
  buildNav(companies);
  const [fin, valArr, scen, people, holders, log, cfg] = await Promise.all(
    ['fin', 'val', 'scen', 'people', 'holders', 'log', 'config'].map((n) => load(`pdd/${n}.json`))
  );
  const v = valArr[0];
  $('price-date').textContent = v.price_date;
  $('k-price').textContent = d3.format('.2f')(v.price_usd);
  const c = valuation({ ...v, eps26e_rmb: cfg.eps26e_rmb ?? v.eps26e_rmb }, fin);
  $('k-mcap').textContent = d3.format(',.0f')(c.mcap_bn);
  $('k-pe').textContent = d3.format('.1f')(c.pe_ttm) + 'x';
  $('k-pe26').textContent = d3.format('.1f')(c.pe_26e) + 'x';
  $('k-ev').textContent = d3.format('.1f')(c.ev_op) + 'x';
  $('k-cash').textContent = d3.format('.1f')(c.cash_per_ads);
  $('k-cash').parentElement.title = cfg.net_cash_formula || '';
  $('market-view').textContent = cfg.market_view || '';

  const latestQ = fin[fin.length - 1].q;
  const isNew = (r) => qn(r.quarter) > qn(latestQ);

  renderFin(fin);
  renderTrack(trackRows(fin));
  drawGrowth(growthRows(fin));

  fillBody($('t-scen'), scenarios(scen, v), [
    { f: 'name', cls: 'nowrap' },
    { cls: 'n', fmt: (r) => d3.format(',.0f')(r.nopat_bn * 10) },
    { cls: 'n', fmt: (r) => d3.format('.0%')(r.r) },
    { cls: 'n', fmt: (r) => d3.format('.0%')(r.cash_disc) },
    { cls: 'n', fmt: (r) => '$' + d3.format('.0f')(r.per_ads) },
    { cls: (r) => 'n ' + (r.vs_price >= 0 ? 'up' : 'down'), fmt: (r) => (r.vs_price >= 0 ? '▲ ' : '▼ ') + fPct(Math.abs(r.vs_price)) }
  ]);
  fillBody($('t-people'), people, [{ f: 'name', cls: 'nowrap' }, { f: 'age', cls: 'n' }, { f: 'title' }, { f: 'edu' }, { f: 'background' }]);
  fillBody($('t-hold'), holders, [
    { f: 'holder', cls: 'nowrap' }, { f: 'type' }, { cls: 'n', fmt: (r) => d3.format('.2%')(r.pct) }, { f: 'asof' }, { f: 'source' }
  ]);
  $('hold-note').textContent = `员工人数（2024年末）：${v.employees_2024 == null ? '—' : d3.format(',')(v.employees_2024)} 人。` +
    (holders.some((h) => !/20-F/.test(h.source || '')) ? ' 部分持股来自媒体转述，待以 20-F 核实。' : '');

  const of = (k) => log.filter((r) => r.kind === k).sort((a, b) => (a.date < b.date ? 1 : -1));
  const dated = [{ f: 'date', cls: 'nowrap' }, { f: 'title', link: true }, { f: 'detail' }];
  const quarterly = [{ f: 'quarter', cls: 'nowrap' }, { f: 'title', link: true }, { f: 'detail' }];
  fillBody($('t-temu'), of('temu'), dated, isNew);
  fillBody($('t-event'), of('event'), dated, isNew);
  fillBody($('t-view'), of('view'), dated, isNew);
  fillBody($('t-team'), of('team'), dated, isNew);
  fillBody($('t-inv'), of('investor'), quarterly, isNew);
  fillBody($('t-qa'), of('qa'), quarterly, (r) => r.quarter === latestQ);
}

main().catch((e) => {
  const d = document.createElement('div');
  d.className = 'fail';
  d.textContent = '数据加载失败：' + e.message;
  $('app').prepend(d);
});
