// Reports → Compare & generate, on real team data (lead, 2026-11-27).
//
// The prototype's Compare & generate (reports.js) runs on invented history (FCR, QA,
// root causes). This one uses only what Scope records from the ServiceNow export and
// the shared log:
//   a ticket belongs to a side when it became someone's (Scope's hand-out) inside the
//   side's period, for the side's analyst (or the whole team);
//   time in our queue = from the first INC export Scope saw it in to Resolved/Transferred;
//   the goal = the regular-INC SLA target in Team settings (4 h);
//   3-Strike = tickets handed out in the period, finished or not finished in their window.
// Generate makes a standalone HTML report, a CSV for Excel or text to paste.
// S.reportPageHtml also renders the monthly report as a downloadable page.
;(function () {
  const { html, cls, attrs, icon, seg } = S
  const Q = () => S.queue
  const qm = () => S.qm
  const DAY = 864e5; const HOUR = 36e5

  // ---------- Periods ----------
  const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }
  const monday = (ms) => { const d = new Date(startOfDay(ms)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime() }
  const monthStart = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), 1).getTime() }
  const addMonths = (ms, n) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime() }
  const fmtDay = (ms) => new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
  const KINDS = [{ id: 'window', label: 'Last days' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }]
  // Options per kind, newest first. Each is { id, label, from, to }.
  function periods(kind, now = Date.now()) {
    const today = startOfDay(now)
    if (kind === 'window') {
      return [7, 14, 30].flatMap((n) => [
        { id: `l${n}`, label: `Last ${n} days`, from: today - (n - 1) * DAY, to: today + DAY },
        { id: `p${n}`, label: `Prior ${n} days`, from: today - (2 * n - 1) * DAY, to: today - (n - 1) * DAY },
      ])
    }
    if (kind === 'week') {
      return Array.from({ length: 12 }, (_, i) => {
        const from = monday(now) - i * 7 * DAY
        return { id: `w${from}`, label: i === 0 ? 'This week' : i === 1 ? 'Last week' : `Week of ${new Date(from).toLocaleDateString([], { day: 'numeric', month: 'short' })}`, from, to: from + 7 * DAY }
      })
    }
    return Array.from({ length: 12 }, (_, i) => {
      const from = addMonths(monthStart(now), -i)
      return { id: `m${from}`, label: new Date(from).toLocaleDateString([], { month: 'long', year: 'numeric' }) + (i === 0 ? ' (to date)' : ''), from, to: addMonths(from, 1) }
    })
  }
  const findPeriod = (s) => periods(s.kind).find((p) => p.id === s.val) || periods(s.kind)[0]

  // ---------- Measures ----------
  const goalH = () => Number(Q().view().settings['inc.slaHours']) || 4
  const closed = (t) => (t.tag === 'Resolved' || t.tag === 'Transferred') && t.tagAt
  // Time in our queue, leaving out any time On Hold (the user's clock, senior's review 2026-11-24).
  const queueMs = (t) => (closed(t) && Q().queuedAt(t) ? Math.max(0, t.tagAt - Q().queuedAt(t) - (S.reportHoldMs ? S.reportHoldMs(t) : 0)) : null)
  // RES MTTR in hours: handed out → Resolved, On Hold left out (same as the Monthly report).
  const resH = (t) => { if (t.tag !== 'Resolved' || !t.assignedAt || !t.tagAt) return null; return Math.max(0, t.tagAt - t.assignedAt - (S.reportHoldMs ? S.reportHoldMs(t) : 0)) / HOUR }
  const handMs = (t) => (t.assignedAt && Q().queuedAt(t) ? Math.max(0, t.assignedAt - Q().queuedAt(t)) : null)
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN)
  const share = (rows, f) => (rows.length ? rows.filter(f).length / rows.length : NaN)
  // better: 'high' / 'low' / 'none' (no side is better: volume).
  const MEASURES = {
    count: { label: 'Tickets received', fn: (r) => r.length, kind: 'n', better: 'none' },
    resolved: { label: 'Resolved', fn: (r) => r.filter((t) => t.tag === 'Resolved').length, kind: 'n', better: 'high' },
    transferred: { label: 'Transferred', fn: (r) => r.filter((t) => t.tag === 'Transferred').length, kind: 'n', better: 'none' },
    closedPct: { label: 'Closed (Resolved or Transferred)', fn: (r) => share(r, closed), kind: 'pct', better: 'high' },
    queueH: { label: 'Avg time in our queue to close', fn: (r) => avg(r.map(queueMs).filter((x) => x != null)) / HOUR, kind: 'h', better: 'low' },
    resH: { label: 'Avg RES MTTR', fn: (r) => avg(r.map(resH).filter((x) => x != null)), kind: 'h', better: 'low' },
    goal: { label: 'SLA attainment (RES within goal)', fn: (r) => { const x = r.map(resH).filter((v) => v != null); return x.length ? x.filter((v) => v <= goalH()).length / x.length : NaN }, kind: 'pct', better: 'high' },
    handMin: { label: 'Avg time to hand-out', fn: (r) => avg(r.map(handMs).filter((x) => x != null)) / 60e3, kind: 'min', better: 'low' },
    eers: { label: 'EERS tickets', fn: (r) => r.filter((t) => t.eers).length, kind: 'n', better: 'none' },
  }
  const MKEYS = Object.keys(MEASURES)
  const fmt = (m, v) => {
    if (v == null || isNaN(v)) return '—'
    const k = MEASURES[m] ? MEASURES[m].kind : 'n'
    return k === 'pct' ? `${Math.round(v * 100)}%` : k === 'h' ? `${v.toFixed(1)}h` : k === 'min' ? (v >= 90 ? `${(v / 60).toFixed(1)}h` : `${Math.round(v)} min`) : String(Math.round(v))
  }
  const diffText = (m, d) => {
    if (d == null || isNaN(d)) return '—'
    const k = MEASURES[m] ? MEASURES[m].kind : 'n'; const s = d > 0 ? '+' : ''
    return k === 'pct' ? `${s}${Math.round(d * 100)} pts` : k === 'h' ? `${s}${d.toFixed(1)}h` : k === 'min' ? `${s}${Math.round(d)} min` : `${s}${Math.round(d)}`
  }
  const better = (m, d, dir = MEASURES[m] && MEASURES[m].better) => {
    const k = MEASURES[m] ? MEASURES[m].kind : 'n'
    const min = k === 'pct' ? 0.005 : k === 'h' ? 0.05 : 0.5
    return d == null || isNaN(d) || Math.abs(d) < min || dir === 'none' || !dir ? null : dir === 'low' ? d < 0 : d > 0
  }
  const tone = (m, d, dir) => { const b = better(m, d, dir); return b == null ? '' : b ? 'good' : 'crit' }

  // ---------- Dimensions ----------
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const DIMS = {
    analyst: { label: 'Analyst', get: (t) => Q().nameOf(Q().owner(t)) || 'Nobody' },
    priority: { label: 'Priority', get: (t) => t.priority || '—' },
    group: { label: 'Assignment group', get: (t) => t.group || '—' },
    outcome: { label: 'Status in Scope', get: (t) => t.tag },
    code: { label: 'Resolution code', get: (t) => (t.res && t.res.code) || (t.tag === 'Resolved' ? 'No code' : 'Not resolved') },
    eers: { label: 'EERS', get: (t) => (t.eers ? 'EERS' : 'Regular INC') },
    dow: { label: 'Day of the week', get: (t) => DOW[new Date(t.assignedAt || Q().queuedAt(t)).getDay()] },
  }

  // ---------- State ----------
  const SIDE_COLOR = { a: 'var(--s2)', b: 'var(--s4)' }
  const ui = () => S.ui('p:reports:cmplive', () => ({
    dim: 'analyst', measure: 'count', title: '', format: 'html', withRows: true,
    a: { kind: 'month', val: periods('month')[0].id, who: 'All' },
    b: { kind: 'month', val: periods('month')[1].id, who: 'All' },
  }))
  const PRESETS = [
    { id: 'mom', label: 'Month vs last' },
    { id: 'wow', label: 'Week vs last' },
    { id: 'd7', label: '7 vs prior 7 days' },
    { id: 'd30', label: '30 vs prior 30 days' },
    { id: 'team', label: 'Analyst vs team' },
  ]

  function side(key, s) {
    const p = findPeriod(s)
    const now = Date.now()
    const end = Math.min(p.to, startOfDay(now) + DAY)
    const rows = Q().view().tickets.filter((t) => {
      if (!t.incSeen) return false // standard INC only; 3-Strike counted below
      const at = t.assignedAt || Q().queuedAt(t)
      return at >= p.from && at < p.to && (s.who === 'All' || Q().owner(t) === s.who)
    })
    // 3-Strike handed out in the period, finished or not finished in the window.
    let sDone = 0; let sMissed = 0; let sGiven = 0
    const days = []
    for (let d = p.from; d < p.to; d += DAY) days.push(Q().dayOf(d))
    for (const day of days) {
      if (day > Q().dayOf(now)) break
      for (const [soeid, qs] of S.strike.dayCounts(day)) {
        if (s.who !== 'All' && soeid !== s.who) continue
        for (const c of Object.values(qs)) { sGiven += c.given; sDone += c.done; sMissed += c.missed }
      }
    }
    const who = s.who === 'All' ? '' : Q().nameOf(s.who)
    const partial = s.kind !== 'window' && p.to > now ? Math.max(0, Math.min(1, (now - p.from) / (p.to - p.from))) : 0
    return { key, s, p, rows, end, days: days.length, partial, strike: { given: sGiven, done: sDone, missed: sMissed }, color: SIDE_COLOR[key], name: `${p.label}${who ? ` · ${who}` : ''}`, range: `${fmtDay(p.from)} – ${fmtDay(Math.min(p.to, end) - 1)}` }
  }
  const val = (m, rows) => MEASURES[m].fn(rows)

  function pairs(A, B, dim, m) {
    const group = (rows) => rows.reduce((g, t) => { const k = DIMS[dim].get(t); (g[k] = g[k] || []).push(t); return g }, {})
    const ga = group(A.rows); const gb = group(B.rows)
    const out = [...new Set([...Object.keys(ga), ...Object.keys(gb)])].map((label) => {
      const ra = ga[label] || []; const rb = gb[label] || []
      return { label, a: ra.length || m === 'count' ? val(m, ra) : NaN, b: rb.length || m === 'count' ? val(m, rb) : NaN, an: ra.length, bn: rb.length }
    })
    if (dim === 'dow') return out.sort((x, y) => ((DOW.indexOf(x.label) + 6) % 7) - ((DOW.indexOf(y.label) + 6) % 7))
    const top = (r) => Math.max(isNaN(r.a) ? -Infinity : r.a, isNaN(r.b) ? -Infinity : r.b)
    return out.sort((x, y) => top(y) - top(x) || (y.an + y.bn) - (x.an + x.bn))
  }
  // Day by day (or week by week past ~5 weeks), lined up from each side's start.
  function trend(A, B, m) {
    const long = (X) => X.p.to - X.p.from > 35 * DAY
    const unit = long(A) || long(B) ? 'week' : 'day'
    const step = unit === 'week' ? 7 * DAY : DAY
    const bins = (X) => { const out = []; for (let t = X.p.from; t < X.p.to; t += step) out.push([t, t + step]); return out }
    const ea = bins(A); const eb = bins(B)
    const n = Math.max(ea.length, eb.length)
    const now = Date.now()
    const values = (X, e) => {
      const v = e.map(([f, to]) => (f > now ? null : (() => { const r = X.rows.filter((t) => { const at = t.assignedAt || Q().queuedAt(t); return at >= f && at < to }); return m === 'count' || r.length ? val(m, r) : null })()))
      return v.concat(Array(n - v.length).fill(null))
    }
    const labels = Array.from({ length: n }, (_, i) => `${unit === 'week' ? 'Week' : 'Day'} ${i + 1}`)
    return { unit, labels, a: values(A, ea), b: values(B, eb) }
  }

  function view() {
    const u = ui()
    const A = side('a', u.a); const B = side('b', u.b)
    if (A.name === B.name) { A.name += ' (A)'; B.name += ' (B)' }
    const M = MEASURES[u.measure]
    const autoTitle = `${A.name} vs ${B.name} · ${M.label} by ${DIMS[u.dim].label.toLowerCase()}`
    return { u, A, B, M, m: u.measure, dim: u.dim, autoTitle, title: u.title.trim() || autoTitle, pairs: pairs(A, B, u.dim, u.measure), trend: trend(A, B, u.measure) }
  }
  // Every headline row: the ticket measures plus 3-Strike.
  function headline(v) {
    const { A, B } = v
    return [
      ...MKEYS.map((k) => ({ k, label: MEASURES[k].label, a: val(k, A.rows), b: val(k, B.rows), dir: MEASURES[k].better })),
      { k: 'n', label: '3-Strike handed out', a: A.strike.given, b: B.strike.given, dir: 'none' },
      { k: 'n', label: '3-Strike finished', a: A.strike.done, b: B.strike.done, dir: 'high' },
      { k: 'n', label: '3-Strike not finished in window', a: A.strike.missed, b: B.strike.missed, dir: 'low' },
    ]
  }

  // ---------- Page ----------
  const opt = (cur, value, label = value) => html`<option value="${value}" ${attrs({ selected: String(cur) === String(value) })}>${label}</option>`
  const people = () => qm().roster.filter((p) => p.active !== false)

  function pairedBars(rows, m) {
    const max = Math.max(1e-9, ...rows.flatMap((r) => [r.a, r.b]).filter((x) => !isNaN(x)))
    const w = (x) => (isNaN(x) ? 0 : (x / max) * 100)
    return html`<div class="pbars">${rows.map((r) => html`
      <div class="pbar" data-key="${r.label}" title="${r.label}: A ${fmt(m, r.a)} (${r.an} tickets) · B ${fmt(m, r.b)} (${r.bn} tickets)">
        <span class="pbar-l">${r.label}</span>
        <div class="pbar-tracks">
          <div class="hbar-track"><div class="hbar-fill" style="width:${w(r.a)}%;background:${SIDE_COLOR.a}"></div></div>
          <div class="hbar-track"><div class="hbar-fill" style="width:${w(r.b)}%;background:${SIDE_COLOR.b}"></div></div>
        </div>
        <span class="pbar-v num"><b>${fmt(m, r.a)}</b><span class="muted">${fmt(m, r.b)}</span></span>
        <span class="${cls('pill', tone(m, r.a - r.b))}">${diffText(m, r.a - r.b)}</span>
      </div>`)}</div>`
  }

  // One side's controls as a single row: colour, period type, period, analyst, the dates.
  function sideRow(X) {
    const s = X.s
    return html`<div class="cmp-row" style="--side:${X.color}" data-key="${X.key}">
      <span class="cmp-tag"><span class="cmp-dot" style="background:${X.color}"></span>${X.key.toUpperCase()}</span>
      ${seg(KINDS.map((k) => ({ id: `${X.key}:${k.id}`, label: k.label })), `${X.key}:${s.kind}`, 'rc.kind')}
      <select class="in sm" aria-label="Side ${X.key.toUpperCase()} period" data-change="rc.period" data-side="${X.key}">${periods(s.kind).map((p) => opt(X.p.id, p.id, p.label))}</select>
      <select class="in sm" aria-label="Side ${X.key.toUpperCase()} analyst" data-change="rc.who" data-side="${X.key}">${opt(s.who, 'All', 'Whole team')}${people().map((p) => opt(s.who, p.soeid, p.name))}</select>
      <span class="small muted nowrap">${X.range} · ${X.rows.length} tickets${X.partial > 0 ? html` · <span title="Counts will be lower until the period ends; compare rates and averages">${Math.round(X.partial * 100)}% through</span>` : ''}</span>
    </div>`
  }

  function page() {
    const v = view()
    const { u, A, B, M, m, dim } = v
    const text = reportText(v)
    const scale = (x) => (x == null ? null : M.kind === 'pct' ? x * 100 : x)
    const chartFmt = M.kind === 'pct' ? (x) => `${Math.round(x)}%` : M.kind === 'h' ? (x) => `${x.toFixed(1)}h` : M.kind === 'min' ? (x) => `${Math.round(x)}m` : (x) => String(Math.round(x))
    return html`<div class="stack" style="gap:16px">
      <section class="card cmp-ctl" aria-label="What to compare">
        <div class="card-h"><h3>Compare</h3><span class="muted small">two periods, or one analyst against the team</span><span class="spacer"></span>
          <button class="btn ghost sm" data-click="rc.swap">${icon('swap', 14)}Swap A and B</button>
          ${S.infoTip('rc-what', 'Compare', html`<span>Each row is one side: the type of period, the period and the analyst (or the whole team). A ticket counts on a side when it became someone's in that period.</span><span><b>Break down by</b> splits both sides; <b>Measure</b> is what the breakdown and trend show. Time in our queue leaves out time On Hold; SLA attainment is the share resolved with RES MTTR within ${goalH()} h, the same as the Monthly report.</span>`)}</div>
        <div class="card-b cmp-ctl-b">
          ${sideRow(A)}${sideRow(B)}
          <div class="cmp-row cmp-opts">
            <span class="cmp-tag muted">By</span>
            <select class="in sm" aria-label="Break down by" data-change="rc.dim">${Object.entries(DIMS).map(([k, d]) => opt(dim, k, d.label))}</select>
            <select class="in sm" aria-label="Measure" data-change="rc.measure">${MKEYS.map((k) => opt(m, k, MEASURES[k].label))}</select>
            <span class="spacer"></span>
            <span class="eyebrow">Quick</span>${PRESETS.map((p) => html`<button class="btn sm" data-click="rc.preset" data-v="${p.id}">${p.label}</button>`)}
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-h"><h3>Side by side</h3><span class="muted small">${A.rows.length} vs ${B.rows.length} INC tickets</span><span class="spacer"></span>
          ${(() => { const rows = headline(v).filter((r) => better(r.k, r.a - r.b, r.dir) != null); const a = rows.filter((r) => better(r.k, r.a - r.b, r.dir)).map((r) => r.label.toLowerCase()); const b = rows.filter((r) => !better(r.k, r.a - r.b, r.dir)).map((r) => r.label.toLowerCase())
            return S.infoTip('rc-side', 'Side by side', html`<span>Every measure for both sides and the difference (A − B). Green: A is better; red: B is. Volumes have no better side.</span>${(a.length || b.length) ? html`<span><b>Insights</b></span>${a.length > 0 && html`<span>• A is better on ${a.join(', ')}.</span>`}${b.length > 0 && html`<span>• B is better on ${b.join(', ')}.</span>`}` : ''}`) })()}</div>
        <div class="card-b">
          <div class="row tight small muted" style="margin-bottom:12px"><span class="cmp-dot" style="background:${A.color}"></span>A · ${A.name}<span style="width:14px"></span><span class="cmp-dot" style="background:${B.color}"></span>B · ${B.name}</div>
          <div class="cmp-minis">${headline(v).map((r) => { const mx = Math.max(1e-9, isNaN(r.a) ? 0 : r.a, isNaN(r.b) ? 0 : r.b); const w = (x) => (isNaN(x) || x == null ? 0 : (x / mx) * 100); return html`<div class="${cls('cmp-mini', r.k === m && 'sel')}" data-key="${r.label}">
            <div class="cmp-mini-h"><span>${r.label}</span><span class="${cls('pill', tone(r.k, r.a - r.b, r.dir))}">${diffText(r.k, r.a - r.b)}</span></div>
            <div class="cmp-mini-bar"><span class="cmp-mini-k">A</span><div class="hbar-track"><div class="hbar-fill" style="width:${w(r.a)}%;background:${A.color}"></div></div><b class="num">${fmt(r.k, r.a)}</b></div>
            <div class="cmp-mini-bar"><span class="cmp-mini-k">B</span><div class="hbar-track"><div class="hbar-fill" style="width:${w(r.b)}%;background:${B.color}"></div></div><b class="num">${fmt(r.k, r.b)}</b></div>
          </div>` })}</div>
        </div>
        <div class="card-f small muted">Green means A is better on that measure, red means B is. Volumes (tickets received, transferred, EERS, handed out) have no better side.</div>
      </section>

      <section class="grid g-2">
        <div class="card">
          <div class="card-h"><h3>${M.label} by ${DIMS[dim].label.toLowerCase()}</h3><span class="muted small">A over B</span><span class="spacer"></span>
            ${S.infoTip('rc-break', 'Breakdown', html`<span>${M.label} for each ${DIMS[dim].label.toLowerCase()}, A (top bar) over B. The pill is the difference.</span>${v.pairs[0] && html`<span><b>Insights</b></span><span>• Largest in A: ${v.pairs[0].label} (${fmt(m, v.pairs[0].a)}).</span>`}`)}</div>
          <div class="card-b">${v.pairs.length ? pairedBars(v.pairs.slice(0, 15), m) : html`<div class="empty">No tickets on either side.</div>`}</div>
        </div>
        <div class="card">
          <div class="card-h"><h3>${M.label} over time</h3><span class="muted small">by ${v.trend.unit}, lined up from each side's start</span><span class="spacer"></span>
            ${S.infoTip('rc-trend', 'Over time', html`<span>${M.label} ${v.trend.unit} by ${v.trend.unit}. Both sides start at ${v.trend.unit} 1 so periods of different dates line up.</span>`)}</div>
          <div class="card-b">${v.trend.labels.length ? S.lineChart('rc-trend', {
            labels: v.trend.labels, fmt: chartFmt, goal: m === 'queueH' ? goalH() : undefined,
            series: [{ name: `A · ${A.name}`, color: A.color, values: v.trend.a.map(scale) }, { name: `B · ${B.name}`, color: B.color, values: v.trend.b.map(scale) }],
          }) : html`<div class="empty">Nothing to show.</div>`}</div>
        </div>
      </section>

      <section class="grid g-1-2">
        <div class="card">
          <div class="card-h"><h3>Generate</h3><span class="muted small">from the comparison above</span><span class="spacer"></span>
            ${S.infoTip('rc-gen', 'Generate', html`<span><b>HTML page:</b> one file with the headline, breakdown, trend and tickets; opens anywhere and prints to PDF. <b>CSV:</b> for Excel. <b>Text:</b> for email or chat.</span>`)}</div>
          <div class="card-b stack lg">
            <label class="field"><span>Report title</span><input class="in" value="${u.title}" placeholder="${v.autoTitle}" data-input="rc.title"></label>
            <div class="stack"><span class="eyebrow">Format</span>
              ${seg([{ id: 'html', label: 'HTML page' }, { id: 'csv', label: 'CSV' }, { id: 'text', label: 'Text' }], u.format, 'rc.format')}
              <span class="small muted">${u.format === 'html' ? 'One file that opens in any browser, no internet needed: headline, breakdown, trend and (optionally) the tickets. Print it to PDF from the browser.' : u.format === 'csv' ? 'Opens in Excel: headline, breakdown and trend for both sides.' : 'Plain text for an email or chat. The preview shows exactly what gets copied.'}</span>
              ${u.format !== 'text' && html`<label class="check small"><input type="checkbox" ${attrs({ checked: u.withRows })} data-change="rc.rows">Include every ticket on both sides (${A.rows.length + B.rows.length})</label>`}
            </div>
            <button class="btn primary" data-click="rc.generate">${icon(u.format === 'text' ? 'copy' : 'download', 15)}${u.format === 'html' ? 'Download HTML report' : u.format === 'csv' ? 'Download CSV' : 'Copy report text'}</button>
            <span class="small muted">The file holds ticket numbers and short descriptions: keep it inside the team.</span>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Preview</h3><span class="muted small">text version</span><span class="spacer"></span><button class="btn ghost sm" data-click="rc.copy">${icon('copy', 14)}Copy</button>${S.infoTip('rc-prev', 'Preview', html`<span>Exactly what Copy (or the Text format) puts on the clipboard.</span>`)}</div>
          <div class="card-b"><pre class="qm-pre" style="max-height:480px;overflow:auto;margin:0">${text}</pre></div>
        </div>
      </section>
    </div>`
  }

  // ---------- Generate ----------
  function reportText(v) {
    const { A, B, M, m, dim } = v
    const vs = (r) => `A ${fmt(r.k, r.a)} · B ${fmt(r.k, r.b)} · ${diffText(r.k, r.a - r.b)}${better(r.k, r.a - r.b, r.dir) == null ? '' : better(r.k, r.a - r.b, r.dir) ? ' (A better)' : ' (B better)'}`
    const L = [v.title,
      `A = ${A.name}, ${A.range}, ${A.rows.length} INC tickets`,
      `B = ${B.name}, ${B.range}, ${B.rows.length} INC tickets`,
      `SLA attainment: resolved with RES MTTR within ${goalH()} h`]
    ;[A, B].forEach((X) => X.partial && L.push(`Note: ${X.p.label} is ${Math.round(X.partial * 100)}% through, so counts are not like for like.`))
    L.push('', 'Headline', ...headline(v).map((r) => `- ${r.label}: ${vs(r)}`))
    L.push('', `${M.label} by ${DIMS[dim].label.toLowerCase()}`, ...v.pairs.slice(0, 10).map((r) => `- ${r.label}: A ${fmt(m, r.a)} · B ${fmt(m, r.b)} (${r.an} vs ${r.bn} tickets)`))
    return L.join('\n')
  }
  const csvCell = (x) => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`
  const num = (k, x) => (x == null || isNaN(x) ? '' : MEASURES[k] && MEASURES[k].kind === 'pct' ? Math.round(x * 1000) / 10 : Math.round(x * 100) / 100)
  const unitOf = (k) => { const kd = MEASURES[k] && MEASURES[k].kind; return kd === 'pct' ? ' (%)' : kd === 'h' ? ' (h)' : kd === 'min' ? ' (min)' : '' }
  const ticketRow = (side, t) => [side, t.n, t.short, t.priority, t.group, Q().nameOf(Q().owner(t)) || '', new Date(t.assignedAt || Q().queuedAt(t)).toLocaleString(), t.tag, t.tagAt ? new Date(t.tagAt).toLocaleString() : '', queueMs(t) == null ? '' : Math.round(queueMs(t) / 6e4) / 60, (t.res && t.res.code) || '', t.eers ? 'Yes' : 'No']
  const TICKET_HEAD = ['Side', 'Ticket', 'Short description', 'Priority', 'Assignment group', 'Analyst', 'Became theirs', 'Status in Scope', 'Closed at', 'Time in our queue (h)', 'Resolution code', 'EERS']
  function reportCsv(v) {
    const { u, A, B, m, dim } = v
    const rows = [['Report', v.title], ['A', A.name, A.range], ['B', B.name, B.range], ['Goal (h in our queue)', goalH()], [], ['Section', 'Item', 'A', 'B', 'Difference']]
    headline(v).forEach((r) => rows.push(['Headline', r.label + unitOf(r.k), num(r.k, r.a), num(r.k, r.b), num(r.k, r.a - r.b)]))
    v.pairs.forEach((r) => rows.push([`${MEASURES[m].label}${unitOf(m)} by ${DIMS[dim].label.toLowerCase()}`, r.label, num(m, r.a), num(m, r.b), num(m, r.a - r.b)]))
    v.trend.labels.forEach((l, i) => rows.push([`${MEASURES[m].label}${unitOf(m)} by ${v.trend.unit}`, l, num(m, v.trend.a[i]), num(m, v.trend.b[i]), '']))
    if (u.withRows) { rows.push([], TICKET_HEAD); A.rows.forEach((t) => rows.push(ticketRow('A', t))); B.rows.forEach((t) => rows.push(ticketRow('B', t))) }
    return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  }

  // A standalone page: plain HTML and CSS, light and dark, prints cleanly.
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const PAGE_CSS = `:root{color-scheme:light dark;--bg:#f4f3f0;--tray:#ecebe7;--sheet:#fdfdfb;--ink:#1b1b19;--ink2:#4a4945;--muted:#85837e;--line:rgba(28,28,26,.12);--a:#5b9be0;--b:#e9bf3c;--good:#3d7a2a;--good-bg:#dbe8c6;--crit:#c2362f;--crit-bg:#f7d3cd}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--tray:#1c1c1a;--sheet:#151514;--ink:#f0efec;--ink2:#c5c2bc;--muted:#8b8882;--line:rgba(244,243,240,.1);--good:#8fd18c;--good-bg:#1f3a22;--crit:#f19a93;--crit-bg:#42201d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:1100px;margin:0 auto;padding:28px 16px 60px;display:flex;flex-direction:column;gap:16px}h1{font-size:24px;margin:0;letter-spacing:-.02em}
.sub{color:var(--muted);font-size:12.5px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.card{background:var(--tray);border:1px solid var(--line);border-radius:12px;padding:0 4px 4px}.card>h2{font:500 11.5px ui-monospace,Menlo,Consolas,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--ink2);margin:0;padding:11px 12px}
.sheet{background:var(--sheet);border:1px solid var(--line);border-radius:9px;padding:14px;overflow-x:auto}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.kpi .v{font:500 28px ui-monospace,Menlo,Consolas,monospace;letter-spacing:-.03em}.kpi .l{font:500 11px ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:top}th{font:500 11px ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.r{text-align:right;font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,Consolas,monospace}.pill{display:inline-block;border-radius:6px;padding:0 7px;line-height:20px;font-size:12px}.pill.good{background:var(--good-bg);color:var(--good)}.pill.crit{background:var(--crit-bg);color:var(--crit)}
.bar{height:7px;border-radius:4px;background:var(--line);position:relative;min-width:80px}.bar i{position:absolute;inset:0 auto 0 0;border-radius:4px}
.legend{display:flex;gap:12px;flex-wrap:wrap}.side{border-left:4px solid;padding:6px 12px;border-radius:4px;background:var(--sheet)}
.note{font-size:12.5px;color:var(--ink2)}.grid2{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr))}h2.h{font-size:18px;margin:8px 0 0}
:root{--g:#8fae5d;--s5c:#e87ba4}.sub.good{color:var(--good)}.sub.crit{color:var(--crit)}svg{width:100%;height:auto;display:block}svg text{fill:var(--muted);font-size:10.5px;font-family:ui-monospace,Menlo,monospace}
.legend .sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin:0 5px 0 12px;vertical-align:-1px}.heat{border-collapse:separate;border-spacing:2px;table-layout:fixed;width:100%}.heat th:first-child{width:34px}.heat td{height:16px;border-radius:3px;border:0;padding:0}.heat th{font-size:10px;padding:0 3px;border:0}
.split{display:flex;height:14px;border-radius:7px;overflow:hidden;margin-bottom:8px}.split i{display:block;height:100%}pre{white-space:pre-wrap;margin:0;font:12.5px/1.6 ui-monospace,Menlo,monospace}
@media print{body{background:#fff}.card{break-inside:avoid}}`
  function pageHtml({ title, sub, body }) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body><main><header><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></header>${body}</main></body></html>`
  }
  const section = (title, inner) => `<section class="card"><h2>${esc(title)}</h2><div class="sheet">${inner}</div></section>`
  function reportHtml(v) {
    const { u, A, B, M, m, dim } = v
    const pill = (r) => { const t = tone(r.k, r.a - r.b, r.dir); return `<span class="pill ${t}">${esc(diffText(r.k, r.a - r.b))}</span>` }
    const max = Math.max(1e-9, ...v.pairs.flatMap((r) => [r.a, r.b]).filter((x) => !isNaN(x)))
    const bar = (x, c) => `<div class="bar"><i style="width:${isNaN(x) ? 0 : (x / max) * 100}%;background:${c}"></i></div>`
    const body = [
      `<div class="legend">${[A, B].map((X) => `<div class="side" style="border-color:var(--${X.key})"><b>${X.key.toUpperCase()} · ${esc(X.name)}</b><div class="sub">${esc(X.range)} · ${X.rows.length} INC tickets${X.partial ? ` · ${Math.round(X.partial * 100)}% through` : ''}</div></div>`).join('')}</div>`,
      `<div class="note">Time in our queue runs from the first ServiceNow export Scope saw the ticket in to Resolved or Transferred, On Hold time left out. SLA attainment: resolved with RES MTTR within ${goalH()} h. Green means A is better.</div>`,
      section('Headline', `<table><thead><tr><th>Measure</th><th class="r">A</th><th class="r">B</th><th class="r">Difference</th></tr></thead><tbody>${headline(v).map((r) => `<tr><td>${esc(r.label)}</td><td class="r">${esc(fmt(r.k, r.a))}</td><td class="r">${esc(fmt(r.k, r.b))}</td><td class="r">${pill(r)}</td></tr>`).join('')}</tbody></table>`),
      section(`${M.label} by ${DIMS[dim].label.toLowerCase()}`, `<table><thead><tr><th>${esc(DIMS[dim].label)}</th><th>A</th><th class="r">A</th><th>B</th><th class="r">B</th><th class="r">A tickets</th><th class="r">B tickets</th></tr></thead><tbody>${v.pairs.map((r) => `<tr><td>${esc(r.label)}</td><td>${bar(r.a, 'var(--a)')}</td><td class="r">${esc(fmt(m, r.a))}</td><td>${bar(r.b, 'var(--b)')}</td><td class="r">${esc(fmt(m, r.b))}</td><td class="r">${r.an}</td><td class="r">${r.bn}</td></tr>`).join('')}</tbody></table>`),
      section(`${M.label} by ${v.trend.unit}`, `<table><thead><tr><th></th><th class="r">A</th><th class="r">B</th></tr></thead><tbody>${v.trend.labels.map((l, i) => `<tr><td>${esc(l)}</td><td class="r">${esc(fmt(m, v.trend.a[i]))}</td><td class="r">${esc(fmt(m, v.trend.b[i]))}</td></tr>`).join('')}</tbody></table>`),
      u.withRows && section(`Tickets (${A.rows.length + B.rows.length})`, `<table><thead><tr>${TICKET_HEAD.filter((h) => h !== 'Assignment group').map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${[...A.rows.map((t) => ['A', t]), ...B.rows.map((t) => ['B', t])].map(([sd, t]) => { const r = ticketRow(sd, t); r.splice(4, 1); return `<tr>${r.map((c, i) => `<td class="${i === 1 ? 'mono' : ''}">${esc(c)}</td>`).join('')}</tr>` }).join('')}</tbody></table>`),
      section('Summary', `<pre>${esc(reportText(v))}</pre>`),
    ].filter(Boolean).join('')
    return pageHtml({ title: v.title, sub: `Scope · Reports · Compare · generated ${new Date().toLocaleString()}`, body })
  }
  const stamp = () => new Date().toLocaleDateString('sv')
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  function generate() {
    const v = view()
    if (v.u.format === 'text') { S.copyText(reportText(v)); return }
    if (v.u.format === 'csv') S.download(`scope-compare-${slug(v.title)}-${stamp()}.csv`, reportCsv(v), 'text/csv')
    else S.download(`scope-compare-${slug(v.title)}-${stamp()}.html`, reportHtml(v), 'text/html')
    S.dispatch({ type: 'toast', text: v.u.format === 'csv' ? 'CSV downloaded' : 'HTML report downloaded' })
  }

  function preset(id) {
    const u = ui()
    const both = (kind, a, b) => S.set(u, { a: { ...u.a, kind, val: a, who: 'All' }, b: { ...u.b, kind, val: b, who: 'All' } })
    if (id === 'mom') both('month', periods('month')[0].id, periods('month')[1].id)
    if (id === 'wow') both('week', periods('week')[0].id, periods('week')[1].id)
    if (id === 'd7') both('window', 'l7', 'p7')
    if (id === 'd30') both('window', 'l30', 'p30')
    if (id === 'team') { const me = qm().me(); const who = u.a.who !== 'All' ? u.a.who : (me && me.soeid) || (people()[0] || {}).soeid; S.set(u, { a: { ...u.a, who }, b: { ...u.a, who: 'All' } }) }
  }

  S.reportCompare = page
  S.reportPageHtml = pageHtml
  S.reportSection = section
  S.reportEsc = esc
  S.on({
    'rc.dim': (el) => S.set(ui(), { dim: el.value }),
    'rc.measure': (el) => S.set(ui(), { measure: el.value }),
    'rc.kind': (el) => { const [k, kind] = el.dataset.v.split(':'); const u = ui(); if (u[k].kind === kind) return; const o = periods(kind); S.set(u, { [k]: { ...u[k], kind, val: (k === 'a' ? o[0] : o[1] || o[0]).id } }) },
    'rc.period': (el) => { const u = ui(); const k = el.dataset.side; S.set(u, { [k]: { ...u[k], val: el.value } }) },
    'rc.who': (el) => { const u = ui(); const k = el.dataset.side; S.set(u, { [k]: { ...u[k], who: el.value } }) },
    'rc.swap': () => { const u = ui(); S.set(u, { a: u.b, b: u.a }) },
    'rc.preset': (el) => preset(el.dataset.v),
    'rc.title': (el) => S.set(ui(), { title: el.value }),
    'rc.format': (el) => S.set(ui(), { format: el.dataset.v }),
    'rc.rows': (el) => S.set(ui(), { withRows: el.checked }),
    'rc.generate': generate,
    'rc.copy': () => S.copyText(reportText(view())),
  })
})()
