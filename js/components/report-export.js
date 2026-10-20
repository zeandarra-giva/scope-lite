// Interactive HTML report for Reports → Compare & generate.
// S.reportHtml(model) returns a complete standalone page. The model (built by
// reportModel in js/pages/reports.js) is embedded as JSON and reportApp below
// renders it in the reader's browser: no Scope, network or libraries needed.
// reportApp is serialised with toString, so it may only use its argument and
// browser globals.
;(function () {
  const CSS = `
:root { color-scheme: light dark; --bg: #f6f5f2; --card: #ffffff; --ink: #1b1b19; --ink2: #5c5b57; --muted: #8a8984; --line: #e4e2dc; --track: #eceae4;
  --a: #4f8fd6; --b: #d9a521; --good: #2f7d3b; --good-bg: #e2f1e0; --crit: #b3261e; --crit-bg: #fbe3e1; --plain-bg: #eceae4; --hi: #f1efe9; --mark: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --bg: #151514; --card: #1f1f1d; --ink: #f0efec; --ink2: #b9b7b1; --muted: #8d8b85; --line: #34332f; --track: #2c2b28;
  --a: #6aaae8; --b: #e2b53c; --good: #8fd18c; --good-bg: #1f3a22; --crit: #f19a93; --crit-bg: #42201d; --plain-bg: #2c2b28; --hi: #282825; --mark: #f19a93; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 28px 16px 60px; display: flex; flex-direction: column; gap: 18px; }
h1 { font-size: 24px; line-height: 1.25; margin: 0; letter-spacing: -.02em; }
h2 { font-size: 16px; margin: 0; }
.muted { color: var(--muted); } .ink2 { color: var(--ink2); } .small { font-size: 12.5px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 18px 20px; min-width: 0; }
.card > h2 { margin-bottom: 12px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.grid2 { display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 460px), 1fr)); }
.dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; flex: none; }
.legend { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); }
.side { border-left: 4px solid; padding: 6px 12px; border-radius: 4px; background: var(--hi); }
.note { font-size: 12.5px; color: var(--ink2); }
select, input[type=search] { font: inherit; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 6px 10px; }
label.f { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--ink2); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { font-weight: 600; color: var(--ink2); font-size: 12px; }
th.s { cursor: pointer; user-select: none; } th.s:hover { color: var(--ink); }
.r { text-align: right; font-variant-numeric: tabular-nums; }
tr.on td { background: var(--hi); }
.wrap { overflow-x: auto; }
.pill { display: inline-block; border-radius: 999px; padding: 0 9px; line-height: 22px; font-size: 12px; font-weight: 500; background: var(--plain-bg); }
.pill.good { background: var(--good-bg); color: var(--good); } .pill.crit { background: var(--crit-bg); color: var(--crit); }
.pbars { display: flex; flex-direction: column; gap: 9px; }
.pbar { display: grid; grid-template-columns: minmax(90px, 1.1fr) minmax(80px, 2fr) 64px 76px; gap: 10px; align-items: center; font-size: 13px; cursor: pointer; border-radius: 8px; }
.pbar:hover .l, .pbar.on .l { text-decoration: underline; }
.pbar .l { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tracks { display: flex; flex-direction: column; gap: 3px; }
.track { height: 7px; background: var(--track); border-radius: 999px; position: relative; }
.track i { position: absolute; inset: 0 auto 0 0; border-radius: 999px; }
.vals { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.2; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.pbar .pill { text-align: center; }
svg { width: 100%; height: auto; display: block; overflow: visible; }
svg text { fill: var(--muted); font-size: 11px; }
svg .grid { stroke: var(--line); }
.chart { position: relative; }
.tip { position: absolute; top: 6px; pointer-events: none; background: var(--ink); color: var(--card); border-radius: 10px; padding: 6px 10px; font-size: 12px; white-space: nowrap; }
pre { white-space: pre-wrap; margin: 0; font: 12.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--hi); padding: 14px; border-radius: 10px; }
button { font: inherit; color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 999px; padding: 5px 14px; cursor: pointer; }
button:hover { background: var(--hi); }
.chip { display: inline-flex; gap: 6px; align-items: center; }
@media (max-width: 560px) { .pbar { grid-template-columns: minmax(0, 1fr) auto auto; } .tracks { grid-column: 1 / -1; order: 3; } h1 { font-size: 20px; } }
`

  function reportApp(D) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
    const RATIO = ['sla', 'fcr', 'transfers', 'goal'], HOURS = ['res', 'eze', 'lost']
    const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN)
    const share = (r, f) => (r.length ? r.filter(f).length / r.length : NaN)
    const FN = {
      count: (r) => r.length, res: (r) => avg(r.map((x) => x.res)), eze: (r) => avg(r.map((x) => x.eze)), lost: (r) => avg(r.map((x) => x.lost)),
      sla: (r) => share(r, (x) => x.sla), fcr: (r) => share(r, (x) => x.fcr), transfers: (r) => share(r, (x) => x.transfers > 0), goal: (r) => share(r, (x) => x.res < D.goalH),
    }
    const fmt = (m, v) => (v == null || isNaN(v) ? '—' : RATIO.includes(m) ? `${Math.round(v * 100)}%` : HOURS.includes(m) ? `${v.toFixed(1)}h` : String(Math.round(v)))
    const diff = (m, d) => (d == null || isNaN(d) ? '—' : HOURS.includes(m) ? `${d > 0 ? '+' : ''}${d.toFixed(1)}h` : m === 'count' ? `${d > 0 ? '+' : ''}${Math.round(d)}` : `${d > 0 ? '+' : ''}${Math.round(d * 100)} pts`)
    const better = (m, d) => (d == null || isNaN(d) || Math.abs(d) < 1e-9 || D.measures[m].better === 'none' ? null : D.measures[m].better === 'low' ? d < 0 : d > 0)
    const pill = (m, d) => { const b = better(m, d); return `<span class="pill ${b == null ? '' : b ? 'good' : 'crit'}">${esc(diff(m, d))}</span>` }
    const [A, B] = D.sides
    const COLOR = { a: 'var(--a)', b: 'var(--b)' }
    const st = { dim: D.dim, measure: D.measure, all: false, sort: null, desc: true, pick: null, q: '', side: 'both' }

    const groupBy = (rows, k) => rows.reduce((g, h) => { (g[h[k]] = g[h[k]] || []).push(h); return g }, {})
    function pairs(k, m) {
      const ga = groupBy(A.rows, k), gb = groupBy(B.rows, k)
      const out = [...new Set([...Object.keys(ga), ...Object.keys(gb)])].map((label) => {
        const ra = ga[label] || [], rb = gb[label] || []
        const a = m !== 'count' && !ra.length ? NaN : FN[m](ra), b = m !== 'count' && !rb.length ? NaN : FN[m](rb)
        return { label, a, b, d: a - b, an: ra.length, bn: rb.length }
      })
      const top = (r) => Math.max(isNaN(r.a) ? -Infinity : r.a, isNaN(r.b) ? -Infinity : r.b)
      return k === 'priority' ? out.sort((x, y) => x.label.localeCompare(y.label)) : out.sort((x, y) => top(y) - top(x))
    }
    function pairedBars(rows, m, clickable) {
      const max = Math.max(1e-9, ...rows.flatMap((r) => [r.a, r.b]).filter((v) => !isNaN(v)))
      const w = (v) => (isNaN(v) ? 0 : (v / max) * 100)
      return `<div class="pbars">${rows.map((r) => `
        <div class="pbar ${clickable && st.pick === r.label ? 'on' : ''}" ${clickable ? `data-pick="${esc(r.label)}"` : ''} title="${esc(r.label)}: A ${esc(fmt(m, r.a))} (${r.an} tickets) · B ${esc(fmt(m, r.b))} (${r.bn} tickets)">
          <span class="l">${esc(r.label)}</span>
          <div class="tracks"><div class="track"><i style="width:${w(r.a)}%;background:var(--a)"></i></div><div class="track"><i style="width:${w(r.b)}%;background:var(--b)"></i></div></div>
          <span class="vals"><b>${esc(fmt(m, r.a))}</b><span class="muted">${esc(fmt(m, r.b))}</span></span>
          ${pill(m, r.d)}
        </div>`).join('')}</div>`
    }

    // Trend: each side's rows into its own buckets, lined up by position.
    function trendValues(side, edges, m) {
      const bins = edges.map(() => [])
      side.rows.forEach((h) => { const i = edges.findIndex((e) => h.at < e[1]); const b = bins[i < 0 ? edges.length - 1 : i]; if (b) b.push(h) })
      const v = bins.map((r) => (m === 'count' ? r.length : r.length ? FN[m](r) : null))
      while (v.length < D.trend.labels.length) v.push(null)
      return v
    }
    function lineSvg(labels, series, m) {
      const W = 760, H = 250, l = 46, r = 12, t = 14, b = 28, iw = W - l - r, ih = H - t - b
      const scale = RATIO.includes(m) ? 100 : 1
      const all = series.flatMap((s) => s.values.filter((v) => v != null).map((v) => v * scale)).concat(m === 'res' ? [D.goalH] : [])
      let max = Math.max(1e-9, ...all) * 1.08
      const p = Math.pow(10, Math.floor(Math.log10(max))); const n = max / p
      max = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p
      const x = (i) => l + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw)
      const y = (v) => t + ih - (v / max) * ih
      const every = Math.ceil(labels.length / 12)
      const tick = (v) => (RATIO.includes(m) ? `${Math.round(v)}%` : HOURS.includes(m) ? `${+v.toFixed(1)}h` : Math.round(v))
      let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(D.measures[m].label)} over time">`
      ;[0, 0.25, 0.5, 0.75, 1].forEach((f) => { svg += `<line class="grid" x1="${l}" x2="${l + iw}" y1="${y(f * max)}" y2="${y(f * max)}"/><text x="${l - 6}" y="${y(f * max) + 4}" text-anchor="end">${tick(f * max)}</text>` })
      labels.forEach((lb, i) => { if (i % every === 0) svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(lb)}</text>` })
      if (m === 'res') svg += `<line x1="${l}" x2="${l + iw}" y1="${y(D.goalH)}" y2="${y(D.goalH)}" stroke="var(--mark)" stroke-dasharray="4 4" stroke-width="1.5"/><text x="${l + iw}" y="${y(D.goalH) - 5}" text-anchor="end" style="fill:var(--mark)">Goal ${D.goalH}h</text>`
      series.forEach((s) => {
        const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v * scale)])).filter(Boolean)
        if (!pts.length) return
        svg += `<path d="${pts.map((q, i) => `${i ? 'L' : 'M'}${q[0]},${q[1]}`).join('')}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round"/>`
        pts.forEach((q) => { svg += `<circle cx="${q[0]}" cy="${q[1]}" r="3" fill="${s.color}"/>` })
      })
      svg += `<line class="hover-l" x1="0" x2="0" y1="${t}" y2="${t + ih}" stroke="var(--muted)" visibility="hidden"/>`
      return { svg: svg + '</svg>', x, W, l, iw }
    }

    function headline() {
      const keys = Object.keys(D.measures)
      return `<section class="card"><h2>Headline measures <span class="small muted">green means A is better</span></h2><div class="wrap"><table>
        <thead><tr><th>Measure</th><th class="r"><span class="chip"><i class="dot" style="background:var(--a)"></i>A</span></th><th class="r"><span class="chip"><i class="dot" style="background:var(--b)"></i>B</span></th><th class="r">Difference</th></tr></thead>
        <tbody>${keys.map((k) => { const a = A.rows.length || k === 'count' ? FN[k](A.rows) : NaN, b = B.rows.length || k === 'count' ? FN[k](B.rows) : NaN; return `<tr class="${k === st.measure ? 'on' : ''}"><td>${esc(D.measures[k].label)}</td><td class="r">${esc(fmt(k, a))}</td><td class="r">${esc(fmt(k, b))}</td><td class="r">${pill(k, a - b)}</td></tr>` }).join('')}</tbody>
      </table></div></section>`
    }
    function breakdown() {
      const m = st.measure, rows = pairs(st.dim, m)
      const shown = st.all ? rows : rows.slice(0, 12)
      const sorted = st.sort ? rows.slice().sort((x, y) => { const p = x[st.sort], q = y[st.sort]; const c = typeof p === 'string' ? p.localeCompare(q) : (isNaN(p) ? -Infinity : p) - (isNaN(q) ? -Infinity : q); return st.desc ? -c : c }) : rows
      const th = (k, label, r) => `<th class="s ${r ? 'r' : ''}" data-sort="${k}">${label}${st.sort === k ? (st.desc ? ' ↓' : ' ↑') : ''}</th>`
      const title = `${esc(D.measures[m].label)} by ${esc(D.dims[st.dim].toLowerCase())}`
      return `<div class="grid2">
        <section class="card"><h2>${title} <span class="small muted">A over B · click a row to see its tickets</span></h2>
          ${shown.length ? pairedBars(shown, m, true) : '<p class="muted">No tickets match on either side.</p>'}
          ${rows.length > 12 ? `<p><button data-all>${st.all ? 'Show the top 12' : `Show all ${rows.length}`}</button></p>` : ''}
        </section>
        <section class="card"><h2>Table <span class="small muted">click a heading to sort</span></h2><div class="wrap" style="max-height:460px;overflow-y:auto"><table>
          <thead><tr>${th('label', esc(D.dims[st.dim]))}${th('a', 'A', 1)}${th('b', 'B', 1)}${th('d', 'Difference', 1)}${th('an', 'A tickets', 1)}${th('bn', 'B tickets', 1)}</tr></thead>
          <tbody>${sorted.map((r) => `<tr class="${st.pick === r.label ? 'on' : ''}"><td>${esc(r.label)}</td><td class="r">${esc(fmt(m, r.a))}</td><td class="r">${esc(fmt(m, r.b))}</td><td class="r">${pill(m, r.d)}</td><td class="r">${r.an}</td><td class="r">${r.bn}</td></tr>`).join('')}</tbody>
        </table></div></section>
      </div>`
    }
    function trend() {
      const m = st.measure
      return `<section class="card"><h2>${esc(D.measures[m].label)} over time <span class="small muted">by ${esc(D.trend.unit)}, periods lined up from their start · hover for values</span></h2>
        <div class="chart" id="trend"></div>
        <div class="row small ink2" style="margin-top:6px"><span class="chip"><i class="dot" style="background:var(--a)"></i>A · ${esc(A.name)}</span><span class="chip"><i class="dot" style="background:var(--b)"></i>B · ${esc(B.name)}</span></div>
      </section>`
    }
    function mountTrend() {
      const el = document.getElementById('trend')
      if (!el) return
      const m = st.measure
      const series = [{ name: `A · ${A.name}`, color: 'var(--a)', values: trendValues(A, D.trend.edges.a, m) }, { name: `B · ${B.name}`, color: 'var(--b)', values: trendValues(B, D.trend.edges.b, m) }]
      const g = lineSvg(D.trend.labels, series, m)
      el.innerHTML = g.svg + '<div class="tip" hidden></div>'
      const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), hl = el.querySelector('.hover-l')
      svg.addEventListener('mousemove', (ev) => {
        const box = svg.getBoundingClientRect()
        const px = ((ev.clientX - box.left) / box.width) * g.W
        const n = D.trend.labels.length
        const i = Math.max(0, Math.min(n - 1, Math.round(((px - g.l) / g.iw) * (n - 1))))
        hl.setAttribute('x1', g.x(i)); hl.setAttribute('x2', g.x(i)); hl.setAttribute('visibility', 'visible')
        tip.hidden = false
        tip.innerHTML = `<b>${esc(D.trend.labels[i])}</b>` + series.map((s) => `<div>${esc(s.name)}: <b>${esc(fmt(m, s.values[i]))}</b></div>`).join('')
        tip.style.left = `${Math.min((g.x(i) / g.W) * box.width + 12, box.width - tip.offsetWidth - 4)}px`
      })
      svg.addEventListener('mouseleave', () => { tip.hidden = true; hl.setAttribute('visibility', 'hidden') })
    }
    function causes() {
      return `<section class="card"><h2>Root causes <span class="small muted">tickets · A over B</span></h2>${pairedBars(pairs('cause', 'count').slice(0, 8), 'count', false)}</section>`
    }
    function groups() {
      const cell = (rows) => `<td class="r">${rows.length}</td><td class="r">${esc(fmt('res', rows.length ? FN.res(rows) : NaN))}</td><td class="r">${esc(fmt('sla', rows.length ? FN.sla(rows) : NaN))}</td>`
      return `<section class="card"><h2>Assignment groups</h2><div class="wrap"><table>
        <thead><tr><th>Group</th><th class="r">A tickets</th><th class="r">A RES MTTR</th><th class="r">A SLA</th><th class="r">B tickets</th><th class="r">B RES MTTR</th><th class="r">B SLA</th></tr></thead>
        <tbody>${D.groups.map((g) => `<tr><td><b>${esc(g)}</b></td>${cell(A.rows.filter((h) => h.assignmentGroup === g))}${cell(B.rows.filter((h) => h.assignmentGroup === g))}</tr>`).join('')}</tbody>
      </table></div></section>`
    }
    function quality() {
      const s = (side) => ({ avg: avg(side.rows.map((h) => h.qa)), full: share(side.rows, (h) => h.qa === 100) })
      const a = s(A), b = s(B)
      return `<section class="card"><h2>Quality <span class="small muted">QA score per ticket, out of 100</span></h2><div class="wrap"><table>
        <thead><tr><th></th><th class="r">A</th><th class="r">B</th></tr></thead>
        <tbody><tr><td>Average QA score</td><td class="r">${isNaN(a.avg) ? '—' : Math.round(a.avg)}</td><td class="r">${isNaN(b.avg) ? '—' : Math.round(b.avg)}</td></tr>
        <tr><td>Tickets with a perfect score</td><td class="r">${esc(fmt('sla', a.full))}</td><td class="r">${esc(fmt('sla', b.full))}</td></tr></tbody>
      </table></div></section>`
    }

    function renderMain() {
      const on = D.sections
      document.getElementById('main').innerHTML = [on.kpis && headline(), on.breakdown && breakdown(), on.trend && trend(), (on.causes || on.groups) && `<div class="grid2">${on.causes ? causes() : ''}${on.groups ? groups() : ''}</div>`, on.qa && quality()].filter(Boolean).join('')
      mountTrend()
      renderTickets()
    }
    function renderTickets() {
      const box = document.getElementById('tk')
      if (!box) return
      const q = st.q.toLowerCase()
      const rows = [].concat(st.side === 'b' ? [] : A.rows.map((h) => ['A', h]), st.side === 'a' ? [] : B.rows.map((h) => ['B', h]))
        .filter(([, h]) => (!st.pick || String(h[st.dim]) === st.pick) && (!q || `${h.id} ${h.desc} ${h.code} ${h.analyst} ${h.businessApp} ${h.cause}`.toLowerCase().includes(q)))
        .sort((x, y) => y[1].at - x[1].at)
      document.getElementById('tk-n').textContent = `${rows.length} tickets${st.pick ? ` · ${D.dims[st.dim]}: ${st.pick}` : ''}${rows.length > 300 ? ' · showing the 300 most recent' : ''}`
      document.getElementById('tk-clear').hidden = !st.pick
      box.innerHTML = rows.slice(0, 300).map(([s, h]) => `<tr><td><span class="chip"><i class="dot" style="background:${s === 'A' ? 'var(--a)' : 'var(--b)'}"></i>${s}</span></td><td><b>${esc(h.id)}</b><div class="small muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis">${esc(h.desc)}</div></td><td>${esc(new Date(h.at).toLocaleDateString())}</td><td>${esc(h.priority)}</td><td>${esc(h.analyst)}</td><td>${esc(h.businessApp)}</td><td>${esc(h.code)}</td><td class="r">${esc(fmt('res', h.res))}</td><td>${h.sla ? 'Met' : '<span class="pill crit">Breached</span>'}</td><td>${h.fcr ? 'Yes' : 'No'}</td></tr>`).join('')
    }

    const opts = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(typeof v === 'string' ? v : v.label)}</option>`).join('')
    const sideBox = (s, key) => `<div class="side" style="border-color:${COLOR[key]}"><b>${key.toUpperCase()} · ${esc(s.name)}</b><div class="small ink2">${esc(s.range)} · ${s.rows.length} tickets</div>${s.partial ? `<div class="note">Still running, ${Math.round(s.partial * 100)}% through: ticket volume is not like for like.</div>` : ''}</div>`
    document.body.innerHTML = `<main>
      <header class="row" style="justify-content:space-between;align-items:flex-start">
        <div><h1>${esc(D.title)}</h1><div class="small muted">Scope · Reports · generated ${esc(D.generated)}</div></div>
      </header>
      <div class="legend">${sideBox(A, 'a')}${sideBox(B, 'b')}</div>
      <div class="small ink2">Filters: ${D.filters.length ? D.filters.map(esc).join(' · ') : 'none'}</div>
      <section class="card row" style="align-items:flex-end">
        <label class="f">Dimension<select id="dim">${opts(D.dims, st.dim)}</select></label>
        <label class="f">Measure<select id="measure">${opts(D.measures, st.measure)}</select></label>
      </section>
      <div id="main" style="display:flex;flex-direction:column;gap:18px"></div>
      ${D.withRows ? `<section class="card"><h2>Tickets <span class="small muted" id="tk-n"></span> <button id="tk-clear" hidden>Clear selection</button></h2>
        <div class="row" style="margin-bottom:10px"><input type="search" id="q" placeholder="Search ticket, description, code, analyst" style="flex:1;min-width:220px;max-width:380px">
          <select id="side"><option value="both">Both sides</option><option value="a">A only</option><option value="b">B only</option></select></div>
        <div class="wrap" style="max-height:520px;overflow-y:auto"><table><thead><tr><th>Side</th><th>Ticket</th><th>Resolved</th><th>Priority</th><th>Analyst</th><th>Business app</th><th>Code</th><th class="r">RES MTTR</th><th>SLA</th><th>FCR</th></tr></thead><tbody id="tk"></tbody></table></div>
      </section>` : ''}
      <section class="card"><h2>Summary <span class="small muted">ready to paste</span> <button id="copy">Copy</button></h2><pre id="text">${esc(D.text)}</pre></section>
    </main>`

    document.getElementById('dim').addEventListener('change', (e) => { st.dim = e.target.value; st.pick = null; st.all = false; st.sort = null; renderMain() })
    document.getElementById('measure').addEventListener('change', (e) => { st.measure = e.target.value; renderMain() })
    document.getElementById('main').addEventListener('click', (e) => {
      const pk = e.target.closest('[data-pick]'), so = e.target.closest('[data-sort]')
      if (pk) { st.pick = st.pick === pk.dataset.pick ? null : pk.dataset.pick; renderMain(); const t = document.getElementById('tk'); if (st.pick && t) t.closest('section').scrollIntoView({ behavior: 'smooth' }) }
      if (so) { st.desc = st.sort === so.dataset.sort ? !st.desc : true; st.sort = so.dataset.sort; renderMain() }
      if (e.target.closest('[data-all]')) { st.all = !st.all; renderMain() }
    })
    if (D.withRows) {
      document.getElementById('q').addEventListener('input', (e) => { st.q = e.target.value; renderTickets() })
      document.getElementById('side').addEventListener('change', (e) => { st.side = e.target.value; renderTickets() })
      document.getElementById('tk-clear').addEventListener('click', () => { st.pick = null; renderMain() })
    }
    document.getElementById('copy').addEventListener('click', async (e) => {
      try { await navigator.clipboard.writeText(D.text); e.target.textContent = 'Copied' } catch { e.target.textContent = 'Select the text to copy' }
      setTimeout(() => { e.target.textContent = 'Copy' }, 1600)
    })
    renderMain()
  }

  const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  S.reportHtml = (model) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(model.title)}</title><style>${CSS}</style></head>
<body><noscript>This report needs JavaScript to draw its charts.</noscript>
<script>(${reportApp.toString()})(${JSON.stringify(model).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')})</script>
</body></html>`
})()
