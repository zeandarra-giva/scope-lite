// Reports, ported from src/pages/Reports.jsx.
;(function () {
  const { html, cls, attrs, style, icon, kpi, seg, hBars, lineChart, barChart } = S
  const { ANALYSTS, ASSIGNMENT_GROUPS, DAY, RES_GOAL_H, avg, byId, fmtH, initials } = S
  const { DIMENSIONS, MEASURES, MONTH_NAMES, PERIOD_KINDS, aggregate, inWindow, periodOptions, periodRange, qaScore } = S

  // <option> with the selected attribute (the morph reads it to set the value).
  const opt = (cur, value, label = value) => html`<option value="${value}" ${attrs({ selected: String(cur) === String(value) })}>${label}</option>`

  const pageUi = () => S.ui('p:reports', { mode: 'insight', tab: 'perf' })
  // Each section keeps its own state under p:reports:<name>. Switching mode or
  // tab drops it, as the React page did when it unmounted the section.
  // Chart hover lives in the shared S.ui('chartHover'), so clear it for this page's charts too.
  const CHARTS = ['reports-mttr', 'reports-volume', 'reports-cmp-trend']
  const resetSections = () => {
    S.resetUi('p:reports:')
    const hv = S.ui('chartHover')
    CHARTS.forEach((id) => { hv[id] = null })
  }

  S.pages.reports = function Reports() {
    const u = pageUi()
    return html`
      <div class="row">
        ${seg([{ id: 'insight', label: 'Insights' }, { id: 'compare', label: 'Compare & generate' }], u.mode, 'reports.mode')}
        <span class="spacer"></span>
        <span class="pill plain wrap">${icon('shield', 12)}All analysis runs in your browser. Copilot answers cite the data they use.</span>
      </div>
      ${u.mode === 'insight' ? html`
        ${S.tabs([
          { id: 'perf', label: 'Performance', icon: 'chart' },
          { id: 'qa', label: 'Quality & coaching', icon: 'check' },
        ], u.tab, 'reports.tab')}
        ${u.tab === 'perf' && performance()}
        ${u.tab === 'qa' && quality()}` : compareGenerate()}`
  }

  function performance() {
    const state = S.state
    const { days } = S.ui('p:reports:perf', { days: 60 })
    const rows = inWindow(state.history, state.now, days)
    const prev = state.history.filter((h) => h.resolvedAt < state.now - days * DAY && h.resolvedAt >= state.now - 2 * days * DAY)
    const weeks = aggregate(rows, 'week', 'count')
    const weekRes = aggregate(rows, 'week', 'res')
    const weekEze = aggregate(rows, 'week', 'eze')
    const delta = (m) => {
      const a = MEASURES[m].fn(rows), b = MEASURES[m].fn(prev)
      if (!prev.length || isNaN(b)) return null
      const d = a - b
      const good = MEASURES[m].better === 'low' ? d < 0 : d > 0
      const txt = m === 'res' || m === 'eze' ? `${d > 0 ? '+' : ''}${d.toFixed(1)}h` : m === 'count' ? `${d > 0 ? '+' : ''}${Math.round(d)}` : `${d > 0 ? '+' : ''}${Math.round(d * 100)} pts`
      return html`<span style="color:${MEASURES[m].better === 'none' ? 'var(--ink-2)' : good ? 'var(--good)' : 'var(--crit)'}">${txt} vs prior ${days}d</span>`
    }
    const causes = aggregate(rows, 'cause', 'count')
    const groups = ASSIGNMENT_GROUPS.map((g) => {
      const r = rows.filter((h) => h.assignmentGroup === g)
      return { g, n: r.length, res: MEASURES.res.fn(r), sla: MEASURES.sla.fn(r), tr: MEASURES.transfers.fn(r), fcr: MEASURES.fcr.fn(r), goal: MEASURES.goal.fn(r) }
    })
    const handovers = state.handovers.filter((h) => h.at >= state.now - days * DAY)
    const topCodes = aggregate(rows, 'code', 'count').slice(0, 6)
    const withCrit = handovers.filter((h) => h.openCritical > 0).length
    return html`
      <div class="row">
        <span class="section-title">Window</span>
        ${seg([{ id: 30, label: '30 days' }, { id: 60, label: '60 days' }, { id: 90, label: '90 days' }], days, 'reports.days')}
      </div>
      ${S.insightsPanel ? S.insightsPanel() : ''}
      <section class="grid g-kpi">
        ${kpi({ label: 'Avg EZE MTTR', icon: 'clock', value: fmtH(MEASURES.eze.fn(rows)), foot: delta('eze') })}
        ${kpi({ label: 'Avg RES MTTR', icon: 'bolt', tone: 'azure', value: fmtH(MEASURES.res.fn(rows)), foot: delta('res') })}
        ${kpi({ label: 'SLA attainment', icon: 'shield', value: MEASURES.sla.fmt(MEASURES.sla.fn(rows)), foot: delta('sla'), state: MEASURES.sla.fn(rows) < 0.85 ? 'warn' : 'good' })}
        ${kpi({ label: 'Ticket volume', icon: 'doc', tone: 'ice', value: rows.length, foot: delta('count') })}
        ${kpi({ label: 'Transfer rate', icon: 'swap', tone: 'navy', value: MEASURES.transfers.fmt(MEASURES.transfers.fn(rows)), foot: delta('transfers') })}
      </section>
      <section class="grid g-2">
        <div class="card">
          <div class="card-h"><h3>MTTR by week</h3><span class="muted small">hours, one axis</span></div>
          <div class="card-b">
            ${lineChart('reports-mttr', { labels: weekRes.map((w) => w.label), goal: RES_GOAL_H, unit: 'h', fmt: (v) => `${v.toFixed(1)}h`,
              series: [{ name: 'EZE MTTR', color: 'var(--s2)', values: weekEze.map((w) => w.value) }, { name: 'RES MTTR', color: 'var(--s1)', values: weekRes.map((w) => w.value) }] })}
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Ticket volume by week</h3><span class="muted small">resolved tickets</span></div>
          <div class="card-b">${barChart('reports-volume', { labels: weeks.map((w) => w.label), values: weeks.map((w) => w.value), fmt: (v) => `${Math.round(v)} tickets` })}</div>
        </div>
      </section>
      <section class="grid g-2">
        <div class="card">
          <div class="card-h"><h3>Root causes</h3><span class="muted small">from resolution codes</span></div>
          <div class="card-b">${hBars({ rows: causes, fmt: (v) => v })}</div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Most used resolution codes</h3></div>
          <div class="card-b">${hBars({ rows: topCodes, color: 'var(--s3)' })}</div>
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h3>Assignment group performance</h3></div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Group</th><th class="r">Volume</th><th class="r">Avg RES MTTR</th><th class="r">SLA attainment</th><th class="r">Resolved &lt; ${RES_GOAL_H}h</th><th class="r">Transfer rate</th><th class="r">FCR</th></tr></thead>
            <tbody>
              ${groups.map((g) => html`
                <tr data-key="${g.g}">
                  <td><b>${g.g}</b></td><td class="r">${g.n}</td>
                  <td class="r" ${attrs({ style: g.res >= RES_GOAL_H ? 'color:var(--crit)' : null })}>${fmtH(g.res)}</td>
                  <td class="r">${MEASURES.sla.fmt(g.sla)}</td><td class="r">${MEASURES.goal.fmt(g.goal)}</td>
                  <td class="r">${MEASURES.transfers.fmt(g.tr)}</td><td class="r">${MEASURES.fcr.fmt(g.fcr)}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h3>Shift handover signal</h3><span class="muted small">handover logs in this window, tied to the queue</span></div>
        <div class="card-b grid g-kpi">
          ${kpi({ label: 'Handovers logged', icon: 'clip', value: handovers.length })}
          ${kpi({ label: 'Handed over with open criticals', icon: 'alert', value: withCrit, foot: `${Math.round((withCrit / Math.max(1, handovers.length)) * 100)}% of shifts`, state: 'warn' })}
          ${kpi({ label: 'Avg resolved per shift', icon: 'check', tone: 'azure', value: Math.round(avg(handovers.map((h) => h.resolved)) || 0) })}
          ${kpi({ label: 'Not yet acknowledged', icon: 'bell', tone: 'ice', value: handovers.filter((h) => !h.acknowledged).length })}
        </div>
      </section>`
  }

  const CRIT = [['documentation', 'Documentation'], ['contactLogged', 'Contact logged'], ['correctCode', 'Correct code'], ['validated', 'Validated']]
  const COACH = {
    documentation: 'Walk through the resolution journey form together; aim for a note on every stage.',
    contactLogged: 'Log every customer touchpoint in the contact log, including voicemails.',
    correctCode: 'Review the resolution code library; pair on 3 tickets where the code was changed in QA.',
    validated: 'Confirm with the customer before resolving; use the validation step instead of closing on silence.',
    sla: 'Look at queue habits: pick up P1/P2 within 15 minutes and use At-risk alerts in notifications.',
  }

  function quality() {
    const state = S.state
    const { sel } = S.ui('p:reports:qa', { sel: null })
    const rows = inWindow(state.history, state.now, 30)
    const crit = CRIT
    const cards = ANALYSTS.filter((a) => a.role === 'Analyst').map((a) => {
      const r = rows.filter((h) => h.analyst === a.id)
      const rates = Object.fromEntries(crit.map(([k]) => [k, r.filter((h) => h.qa[k]).length / Math.max(1, r.length)]))
      rates.sla = MEASURES.sla.fn(r)
      const weakest = [...crit, ['sla', 'SLA met']].sort((x, y) => rates[x[0]] - rates[y[0]])[0]
      const score = Math.round(avg(r.map(qaScore)) || 0)
      return { a, r, score, rates, weakest, fcr: MEASURES.fcr.fn(r), tr: MEASURES.transfers.fn(r), res: MEASURES.res.fn(r) }
    }).sort((x, y) => x.score - y.score)
    const cur = cards.find((c) => c.a.id === sel)
    return html`
      <section class="card">
        <div class="card-h"><h3>QA rubric</h3><span class="muted small">Scored automatically on every resolved ticket · 20 points each</span></div>
        <div class="card-b row">
          ${[...crit.map((c) => c[1]), 'SLA met'].map((c) => html`<span class="pill plain">${c}</span>`)}
        </div>
      </section>
      <section class="grid g-3-1">
        <div class="card">
          <div class="card-h"><h3>Analyst scorecards</h3><span class="muted small">last 30 days · lowest first</span></div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Analyst</th><th class="r">Tickets</th><th class="r">QA score</th><th class="r">SLA</th><th class="r">FCR</th><th class="r">Transfers</th><th class="r">RES MTTR</th><th>Coaching focus</th></tr></thead>
              <tbody>
                ${cards.map((c) => html`
                  <tr class="${cls('click', sel === c.a.id && 'sel')}" data-click="reports.sel" data-v="${c.a.id}" data-key="${c.a.id}">
                    <td class="nowrap"><span class="row tight"><span class="avatar sm">${initials(c.a.name)}</span>${c.a.name}</span></td>
                    <td class="r">${c.r.length}</td>
                    <td class="r"><span class="pill ${c.score >= 85 ? 'good' : c.score >= 75 ? 'warn' : 'crit'}">${c.score}</span></td>
                    <td class="r">${MEASURES.sla.fmt(c.rates.sla)}</td>
                    <td class="r">${MEASURES.fcr.fmt(c.fcr)}</td>
                    <td class="r">${MEASURES.transfers.fmt(c.tr)}</td>
                    <td class="r">${fmtH(c.res)}</td>
                    <td class="nowrap small">${c.weakest[1]} (${Math.round(c.rates[c.weakest[0]] * 100)}%)</td>
                  </tr>`)}
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Coaching plan</h3></div>
          <div class="card-b stack lg">
            ${!cur && html`<div class="muted small">Select an analyst to see where their score is lost and what to coach.</div>`}
            ${cur && html`
              <div class="row"><span class="avatar">${initials(cur.a.name)}</span><div><b>${cur.a.name}</b><div class="muted small">${cur.a.group} · ${cur.r.length} tickets</div></div></div>
              ${hBars({ rows: [...crit, ['sla', 'SLA met']].map(([k, l]) => ({ label: l, value: cur.rates[k] * 100 })), max: 100, target: 90, fmt: (v) => `${Math.round(v)}%` })}
              <div class="small muted">Marker shows the 90% team standard.</div>
              <div class="callout accent small">${icon('user', 16)}<span><b>Focus: ${cur.weakest[1]}.</b> ${COACH[cur.weakest[0]]}</span></div>
              <div class="stack">
                <div class="section-title">Tickets to review together</div>
                ${cur.r.slice().sort((a, b) => qaScore(a) - qaScore(b)).slice(0, 4).map((h) => html`
                  <div class="list-row small" data-key="${h.id}"><span class="mono">${h.id}</span><span class="code-chip">${h.code}</span><span class="spacer"></span><span class="pill ${qaScore(h) >= 80 ? 'good' : 'warn'}">${qaScore(h)}</span></div>`)}
              </div>`}
          </div>
        </div>
      </section>`
  }

  // ---------- Compare & generate ----------
  // The explorer and the comparison in one view. Dimension, measure and the
  // filters apply to the whole page; each side (A on the left, B on the right)
  // picks its own period and analyst. Generate turns what's on screen into an
  // interactive HTML report, a CSV or text to paste into an update.
  const SIDE_COLOR = { a: 'var(--s2)', b: 'var(--s4)' }
  // Page filters. Keys that are also dimensions match on DIMENSIONS[k].get, so
  // a clicked bar can become a filter.
  const FILTERS = [['priority', 'Priority'], ['channel', 'Channel'], ['assignmentGroup', 'Assignment group'], ['businessApp', 'Business app'], ['productGroup', 'Product group'], ['cause', 'Root cause']]
  const FLAGS = { fcr: (h, v) => (v === 'Yes') === h.fcr, sla: (h, v) => (v === 'Met') === h.slaMet }
  const FLAG_LABEL = { fcr: 'FCR', sla: 'SLA' }
  // Clicking a bar filters to it and breaks it down one level further.
  const DRILL_NEXT = { cause: 'code', businessApp: 'cause', productGroup: 'businessApp', channel: 'cause', assignmentGroup: 'analyst', priority: 'cause', analyst: 'cause' }
  const METRICS = ['count', 'res', 'eze', 'lost', 'sla', 'fcr', 'transfers', 'goal']
  const RATIO = ['sla', 'fcr', 'transfers', 'goal']
  const HOURS = ['res', 'eze', 'lost']
  const SECTIONS = [['kpis', 'Headline measures'], ['breakdown', 'Breakdown'], ['trend', 'Trend'], ['causes', 'Root causes'], ['groups', 'Assignment groups'], ['qa', 'Quality']]
  const FORMATS = [{ id: 'html', label: 'Interactive HTML' }, { id: 'csv', label: 'CSV' }, { id: 'text', label: 'Text' }]
  const FORMAT_HINT = {
    html: 'One file with the charts and tickets. Open it in any browser, no internet needed, to switch the dimension and measure, hover for values and search tickets.',
    csv: 'Opens in Excel or Sheets: headline measures, the breakdown and the trend for both sides.',
    text: 'Plain text for an email, chat or stand-up. The preview shows exactly what gets copied.',
  }
  const DEFAULT_FILTERS = { priority: 'All', channel: 'All', assignmentGroup: 'All', businessApp: 'All', productGroup: 'All', cause: 'All', fcr: 'All', sla: 'All' }
  const PRESETS = [
    { id: 'p30', label: 'Last 30 vs prior 30 days' },
    { id: 'mom', label: 'Month over month' },
    { id: 'qoq', label: 'Quarter over quarter' },
    { id: 'yoy', label: 'Year over year' },
    { id: 'sqly', label: 'Same quarter last year' },
    { id: 'team', label: 'Analyst vs team' },
  ]

  // Comparisons reach past the 90 days of history into the older archive.
  const allRows = (state) => state.history.concat(state.archive)
  const firstAt = (state) => allRows(state).reduce((m, h) => Math.min(m, h.resolvedAt), state.now)
  const options = (kind) => periodOptions(kind, S.state.now, firstAt(S.state))
  const cmpUi = () => S.ui('p:reports:compare', () => ({
    dim: 'businessApp', measure: 'res', all: false, title: '', format: 'html', withRows: true,
    f: { ...DEFAULT_FILTERS },
    a: { kind: 'window', val: '30', analyst: 'All' },
    b: { kind: 'window', val: 'p30', analyst: 'All' },
    sections: Object.fromEntries(SECTIONS.map(([k]) => [k, true])),
  }))

  // A measure over a set, NaN when there's nothing to average (MEASURES gives 0% for an empty set).
  const val = (m, rows) => (m !== 'count' && !rows.length ? NaN : MEASURES[m].fn(rows))
  const fv = (m, v) => (v == null || isNaN(v) ? '—' : MEASURES[m].fmt(v))
  const diffText = (m, d) => isNaN(d) ? '—' : HOURS.includes(m) ? `${d > 0 ? '+' : ''}${d.toFixed(1)}h` : m === 'count' ? `${d > 0 ? '+' : ''}${Math.round(d)}` : `${d > 0 ? '+' : ''}${Math.round(d * 100)} pts`
  // true when A is better than B on m, null when the measure has no better side or there's no difference.
  const better = (m, d) => (isNaN(d) || Math.abs(d) < 1e-9 || MEASURES[m].better === 'none' ? null : MEASURES[m].better === 'low' ? d < 0 : d > 0)
  const tone = (m, d) => { const b = better(m, d); return b == null ? 'plain' : b ? 'good' : 'crit' }
  const groupBy = (rows, dim) => rows.reduce((g, h) => { const k = DIMENSIONS[dim].get(h); (g[k] = g[k] || []).push(h); return g }, {})
  const fmtRange = (r) => `${new Date(r.from).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} – ${new Date(r.to - 1).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`

  function filtered(rows, f) {
    return rows.filter((h) => FILTERS.every(([k]) => f[k] === 'All' || DIMENSIONS[k].get(h) === f[k]) && Object.entries(FLAGS).every(([k, fn]) => f[k] === 'All' || fn(h, f[k])))
  }

  function sideSet(state, base, key, s) {
    const range = periodRange(s.kind, s.val, state.now, firstAt(state))
    // A period that runs to now also takes tickets stamped a moment later.
    const end = range.to >= state.now ? Infinity : range.to
    const rows = base.filter((h) => h.resolvedAt >= range.from && h.resolvedAt < end && (s.analyst === 'All' || h.analyst === s.analyst))
    const who = s.analyst === 'All' ? '' : byId[s.analyst]?.name
    return { key, kind: s.kind, rows, range, color: SIDE_COLOR[key], name: who ? `${range.label} · ${who}` : range.label }
  }

  // Both sides, broken down by dim, sorted by the larger of the two values.
  function pairs(A, B, dim, m) {
    const ga = groupBy(A.rows, dim), gb = groupBy(B.rows, dim)
    const out = [...new Set([...Object.keys(ga), ...Object.keys(gb)])].map((label) => {
      const ra = ga[label] || [], rb = gb[label] || []
      return { label, a: val(m, ra), b: val(m, rb), an: ra.length, bn: rb.length }
    })
    const top = (r) => Math.max(isNaN(r.a) ? -Infinity : r.a, isNaN(r.b) ? -Infinity : r.b)
    return dim === 'priority' ? out.sort((x, y) => x.label.localeCompare(y.label)) : out.sort((x, y) => top(y) - top(x) || (y.an + y.bn) - (x.an + x.bn))
  }

  // Each side cut into weeks (or months when both span more than ~4 months),
  // lined up by position so periods of different dates overlay.
  function trend(A, B, m) {
    const long = (s) => s.range.to - s.range.from > 120 * DAY
    const unit = long(A) && long(B) ? 'month' : 'week'
    const edges = (s) => {
      const out = []
      for (let t = s.range.from; t < s.range.to;) {
        const d = new Date(t)
        const n = unit === 'week' ? t + 7 * DAY : new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
        out.push([t, Math.min(n, s.range.to)]); t = n
      }
      return out
    }
    const ea = edges(A), eb = edges(B)
    const n = Math.max(ea.length, eb.length)
    const values = (s, e) => {
      const bins = e.map(() => [])
      s.rows.forEach((h) => { const i = e.findIndex(([, t]) => h.resolvedAt < t); bins[i < 0 ? e.length - 1 : i]?.push(h) })
      const v = bins.map((r) => (m === 'count' ? r.length : r.length ? MEASURES[m].fn(r) : null))
      return v.concat(Array(n - v.length).fill(null))
    }
    const months = unit === 'month' && A.kind === 'year' && B.kind === 'year'
    const labels = Array.from({ length: n }, (_, i) => (months ? MONTH_NAMES[i] : `${unit === 'month' ? 'Month' : 'Week'} ${i + 1}`))
    return { unit, labels, a: values(A, ea), b: values(B, eb), edges: { a: ea, b: eb } }
  }

  // Everything the view, the text, the CSV and the HTML export are built from.
  function compareView() {
    const state = S.state
    const u = cmpUi()
    const base = filtered(allRows(state), u.f)
    const A = sideSet(state, base, 'a', u.a), B = sideSet(state, base, 'b', u.b)
    if (A.name === B.name) { A.name += ' (A)'; B.name += ' (B)' }
    const M = MEASURES[u.measure]
    const active = [...FILTERS.filter(([k]) => u.f[k] !== 'All').map(([k, l]) => ({ k, text: `${l}: ${u.f[k]}` })),
      ...Object.keys(FLAGS).filter((k) => u.f[k] !== 'All').map((k) => ({ k, text: `${FLAG_LABEL[k]}: ${u.f[k]}` }))]
    const autoTitle = `${A.name} vs ${B.name} · ${M.label} by ${DIMENSIONS[u.dim].label.toLowerCase()}`
    return { u, A, B, M, m: u.measure, dim: u.dim, active, autoTitle, title: u.title.trim() || autoTitle, pairs: pairs(A, B, u.dim, u.measure), trend: trend(A, B, u.measure) }
  }

  // Two bars per row (A over B), the values and the difference. onClick gets the label in data-v.
  function pairedBars(rows, m, onClick) {
    const max = Math.max(1e-9, ...rows.flatMap((r) => [r.a, r.b]).filter((v) => !isNaN(v)))
    const w = (v) => (isNaN(v) ? 0 : (v / max) * 100)
    return html`<div class="pbars">${rows.map((r) => html`
      <div class="pbar" data-key="${r.label}" title="${r.label}: A ${fv(m, r.a)} (${r.an} tickets) · B ${fv(m, r.b)} (${r.bn} tickets)" ${attrs({ 'data-click': onClick || null, 'data-v': onClick ? r.label : null })}>
        <span class="pbar-l">${r.label}</span>
        <div class="pbar-tracks">
          <div class="hbar-track"><div class="hbar-fill" style="width:${w(r.a)}%;background:${SIDE_COLOR.a}"></div></div>
          <div class="hbar-track"><div class="hbar-fill" style="width:${w(r.b)}%;background:${SIDE_COLOR.b}"></div></div>
        </div>
        <span class="pbar-v num"><b>${fv(m, r.a)}</b><span class="muted">${fv(m, r.b)}</span></span>
        <span class="pill ${tone(m, r.a - r.b)}">${diffText(m, r.a - r.b)}</span>
      </div>`)}</div>`
  }

  function sideCard(v, X) {
    const s = v.u[X.key]
    const first = firstAt(S.state)
    const shown = [...new Set(['count', v.m, 'res', 'sla', 'fcr'])].slice(0, 4)
    const data = aggregate(X.rows, v.dim, v.m).filter((d) => !isNaN(d.value)).slice(0, 8)
    // Same scale on both sides so the bars can be compared across columns.
    const other = X.key === 'a' ? v.B : v.A
    const max = Math.max(1e-9, ...aggregate(X.rows, v.dim, v.m).concat(aggregate(other.rows, v.dim, v.m)).map((d) => d.value).filter((x) => !isNaN(x)))
    return html`<div class="card cmp-side" style="--side:${X.color}" data-tour="cmp-side-${X.key}">
      <div class="card-h"><span class="cmp-dot" style="background:${X.color}"></span><h3>Side ${X.key.toUpperCase()}</h3><span class="muted small">${X.name}</span></div>
      <div class="card-b stack lg">
        ${seg(PERIOD_KINDS.map((k) => ({ id: `${X.key}:${k.id}`, label: k.label })), `${X.key}:${s.kind}`, 'reports.kind')}
        <div class="row">
          <select id="cmp-${X.key}-period" class="in" data-change="reports.period" data-side="${X.key}" aria-label="Side ${X.key.toUpperCase()} period" style="flex:1;min-width:150px">
            ${periodOptions(s.kind, S.state.now, first).map((o) => opt(s.val, o.id, o.label))}
          </select>
          <select id="cmp-${X.key}-analyst" class="in" data-change="reports.analyst" data-side="${X.key}" aria-label="Side ${X.key.toUpperCase()} analyst" style="flex:1;min-width:150px">
            ${opt(s.analyst, 'All', 'All analysts')}${ANALYSTS.filter((a) => a.role === 'Analyst').map((a) => opt(s.analyst, a.id, a.name))}
          </select>
        </div>
        <span class="small muted">${fmtRange(X.range)}</span>
        ${X.range.partial && html`<div class="callout warn small">${icon('clock', 15)}<span>${X.range.label.replace(' (to date)', '')} is ${Math.round(X.range.partial * 100)}% through. Compare rates and averages; ticket volume will be lower until it ends.</span></div>`}
        <div class="cmp-stats">
          ${shown.map((m) => html`<div class="stack" style="gap:2px"><span class="eyebrow">${MEASURES[m].label}</span><b class="num" style="font-size:20px;font-family:var(--f-cond)">${fv(m, val(m, X.rows))}</b></div>`)}
        </div>
        <div class="stack">
          <span class="section-title">${v.M.label} by ${DIMENSIONS[v.dim].label.toLowerCase()}</span>
          ${data.length ? hBars({ rows: data, max, fmt: (x) => fv(v.m, x), color: X.color, onClick: DRILL_NEXT[v.dim] ? 'reports.drill' : undefined })
            : html`<div class="empty">No tickets in this period with these filters.</div>`}
        </div>
      </div>
    </div>`
  }

  function compareGenerate() {
    const state = S.state
    const v = compareView()
    const { u, A, B, M, m, dim } = v
    const all = allRows(state)
    const values = (k) => [...new Set(all.map((h) => DIMENSIONS[k].get(h)))].sort()
    const drill = DRILL_NEXT[dim] ? 'reports.drill' : undefined
    const shown = u.all ? v.pairs : v.pairs.slice(0, 12)
    const ratio = RATIO.includes(m)
    const scale = (x) => (x == null ? null : ratio ? x * 100 : x)
    const chartFmt = ratio ? (x) => `${Math.round(x)}%` : HOURS.includes(m) ? (x) => `${x.toFixed(1)}h` : (x) => Math.round(x)
    const text = reportText(v)
    return html`
      <div class="callout small">${icon('filter', 16)}<span><b>Explore and compare.</b> Pick what to measure and filter for the whole page, then a period and analyst for each side. Click a bar to filter to it and drill one level down. Computed in the browser from ${all.length.toLocaleString()} resolved tickets back to ${new Date(firstAt(state)).getFullYear()}.${S.canUseCopilot(state) && html` For a quick ranking, trend or breakdown, use the <button class="link-btn" data-click="cp.go" data-v="copilot">prompt templates in Copilot</button>.`}</span></div>

      <section class="card" data-tour="cmp-filters">
        <div class="card-h"><h3>What to measure</h3><span class="muted small">applies to both sides</span><span class="spacer"></span>
          <button class="btn ghost sm" data-click="reports.swap">${icon('swap', 14)}Swap A and B</button>
        </div>
        <div class="card-b stack lg">
          <div class="form-grid">
            <label class="field"><span>Dimension</span><select id="cmp-dim" class="in" data-change="reports.dim">${Object.entries(DIMENSIONS).filter(([k]) => k !== 'week').map(([k, d]) => opt(dim, k, d.label))}</select></label>
            <label class="field"><span>Measure</span><select id="cmp-measure" class="in" data-change="reports.measure">${METRICS.map((k) => opt(m, k, MEASURES[k].label))}</select></label>
            ${FILTERS.map(([k, l]) => html`<label class="field"><span>${l}</span><select id="cmp-f-${k}" class="in" data-change="reports.f" data-k="${k}">${opt(u.f[k], 'All')}${values(k).map((x) => opt(u.f[k], x))}</select></label>`)}
            <label class="field"><span>FCR</span><select id="cmp-f-fcr" class="in" data-change="reports.f" data-k="fcr">${opt(u.f.fcr, 'All')}${opt(u.f.fcr, 'Yes')}${opt(u.f.fcr, 'No')}</select></label>
            <label class="field"><span>SLA</span><select id="cmp-f-sla" class="in" data-change="reports.f" data-k="sla">${opt(u.f.sla, 'All')}${opt(u.f.sla, 'Met')}${opt(u.f.sla, 'Breached')}</select></label>
          </div>
          <div class="row small">
            <span class="eyebrow">Quick compare</span>
            ${PRESETS.map((p) => html`<button class="btn sm" data-click="reports.preset" data-v="${p.id}">${p.label}</button>`)}
          </div>
          ${v.active.length > 0 && html`<div class="row small">
            <span class="eyebrow">Filtered to</span>
            ${v.active.map((a) => html`<span class="pill accent" data-key="${a.k}">${a.text}<button class="pill-x" aria-label="Remove ${a.text}" data-click="reports.unfilter" data-v="${a.k}">${icon('x', 11)}</button></span>`)}
            <button class="link-btn" data-click="reports.clear">Clear all</button>
          </div>`}
        </div>
      </section>

      <section class="grid cmp-sides">${sideCard(v, A)}${sideCard(v, B)}</section>

      <section class="card">
        <div class="card-h"><h3>Side by side</h3><span class="muted small">${A.rows.length} vs ${B.rows.length} tickets</span></div>
        <div class="card-b stack lg">
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Measure</th><th class="r"><span class="row tight" style="justify-content:flex-end"><span class="cmp-dot" style="background:${A.color}"></span>A · ${A.name}</span></th><th class="r"><span class="row tight" style="justify-content:flex-end"><span class="cmp-dot" style="background:${B.color}"></span>B · ${B.name}</span></th><th class="r">Difference</th></tr></thead>
              <tbody>
                ${METRICS.map((k) => {
                  const va = val(k, A.rows), vb = val(k, B.rows)
                  return html`<tr class="${cls(k === m && 'sel')}" data-key="${k}">
                    <td>${MEASURES[k].label}</td><td class="r">${fv(k, va)}</td><td class="r">${fv(k, vb)}</td>
                    <td class="r"><span class="pill ${tone(k, va - vb)}">${diffText(k, va - vb)}</span></td>
                  </tr>`
                })}
              </tbody>
            </table>
          </div>
          <div class="small muted">Green means A is better on that measure, red means B is.</div>
        </div>
      </section>

      <section class="grid g-2">
        <div class="card">
          <div class="card-h"><h3>${M.label} by ${DIMENSIONS[dim].label.toLowerCase()}</h3><span class="muted small">A over B${drill ? ' · click to drill in' : ''}</span></div>
          <div class="card-b stack">
            ${shown.length ? pairedBars(shown, m, drill) : html`<div class="empty">No tickets match on either side.</div>`}
            ${v.pairs.length > 12 && html`<button class="link-btn small" style="align-self:flex-start" data-click="reports.all">${u.all ? 'Show the top 12' : `Show all ${v.pairs.length}`}</button>`}
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>${M.label} over time</h3><span class="muted small">by ${v.trend.unit}, periods lined up from their start</span></div>
          <div class="card-b">
            ${v.trend.labels.length ? lineChart('reports-cmp-trend', {
              labels: v.trend.labels, fmt: chartFmt, goal: m === 'res' ? RES_GOAL_H : undefined,
              series: [{ name: `A · ${A.name}`, color: A.color, values: v.trend.a.map(scale) }, { name: `B · ${B.name}`, color: B.color, values: v.trend.b.map(scale) }],
            }) : html`<div class="empty">No tickets match.</div>`}
          </div>
        </div>
      </section>

      <section class="grid g-1-2">
        <div class="card" data-tour="cmp-generate">
          <div class="card-h"><h3>Generate</h3><span class="muted small">from the comparison above</span></div>
          <div class="card-b stack lg">
            <label class="field"><span>Report title</span><input id="gen-title" class="in" value="${u.title}" placeholder="${v.autoTitle}" data-input="reports.title"></label>
            <div class="stack">
              <span class="section-title">Include</span>
              ${SECTIONS.map(([k, l]) => html`
                <label class="check small"><input type="checkbox" ${attrs({ checked: u.sections[k] })} data-change="reports.section" data-v="${k}">${k === 'breakdown' ? `${M.label} by ${DIMENSIONS[dim].label.toLowerCase()}` : l}</label>`)}
            </div>
            <div class="stack">
              <span class="section-title">Format</span>
              ${seg(FORMATS, u.format, 'reports.format')}
              <span class="small muted">${FORMAT_HINT[u.format]}</span>
              ${u.format !== 'text' && html`<label class="check small"><input type="checkbox" ${attrs({ checked: u.withRows })} data-change="reports.rows">Include every ticket on both sides (${(A.rows.length + B.rows.length).toLocaleString()} rows)</label>`}
            </div>
            <button class="btn primary" data-click="reports.generate">${icon(u.format === 'text' ? 'copy' : 'download', 15)}${u.format === 'html' ? 'Generate HTML report' : u.format === 'csv' ? 'Generate CSV' : 'Copy report text'}</button>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Preview</h3><span class="muted small">text version, ready to paste into an email, chat or stand-up</span><span class="spacer"></span>
            <button class="btn ghost sm" data-click="reports.copy">${icon('copy', 14)}Copy</button>
          </div>
          <div class="card-b"><pre class="mono" style="${style({ whiteSpace: 'pre-wrap', margin: 0, background: 'var(--surface-2)', padding: 14, borderRadius: 8, fontSize: 12.5, lineHeight: 1.6, maxHeight: 560, overflowY: 'auto' })}">${text}</pre></div>
        </div>
      </section>`
  }

  // ---------- Generate ----------
  const weakest = (rows) => rows.length ? CRIT.map(([k, l]) => [l, rows.filter((h) => h.qa[k]).length / rows.length]).sort((x, y) => x[1] - y[1])[0] : null
  const groupRow = (rows) => `${rows.length} tickets, RES ${fmtH(MEASURES.res.fn(rows))}, SLA ${fv('sla', val('sla', rows))}`

  // The plain-text report: what the preview shows and Copy puts on the clipboard.
  function reportText(v) {
    const { u, A, B, M, m, dim } = v
    const on = u.sections
    const vs = (k, a, b) => `A ${fv(k, a)} · B ${fv(k, b)} · ${diffText(k, a - b)}${better(k, a - b) == null ? '' : better(k, a - b) ? ' (A better)' : ' (B better)'}`
    const L = [
      v.title,
      `A = ${A.name}, ${fmtRange(A.range)}, ${A.rows.length} tickets`,
      `B = ${B.name}, ${fmtRange(B.range)}, ${B.rows.length} tickets`,
      `Filters: ${v.active.length ? v.active.map((a) => a.text).join(' · ') : 'none'}`,
    ]
    ;[A, B].forEach((X) => X.range.partial && L.push(`Note: ${X.range.label.replace(' (to date)', '')} is ${Math.round(X.range.partial * 100)}% through, so ticket volume is not like for like.`))
    if (on.kpis) L.push('', 'Headline', ...METRICS.map((k) => `- ${MEASURES[k].label}: ${vs(k, val(k, A.rows), val(k, B.rows))}`))
    if (on.breakdown) {
      L.push('', `${M.label} by ${DIMENSIONS[dim].label.toLowerCase()}`, ...v.pairs.slice(0, 8).map((r) => `- ${r.label}: ${vs(m, r.a, r.b)} (${r.an} vs ${r.bn} tickets)`))
      // Only rows with a few tickets on both sides, so one slow ticket doesn't lead.
      const movers = v.pairs.filter((r) => r.an >= 3 && r.bn >= 3 && better(m, r.a - r.b) != null).sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b)).slice(0, 3)
      if (movers.length) L.push('', 'Biggest movers', ...movers.map((r) => `- ${r.label}: ${diffText(m, r.a - r.b)}, ${better(m, r.a - r.b) ? 'better' : 'worse'} in A`))
    }
    if (on.trend) L.push('', `${M.label} by ${v.trend.unit}`, ...v.trend.labels.map((l, i) => `- ${l}: A ${fv(m, v.trend.a[i])} · B ${fv(m, v.trend.b[i])}`))
    if (on.causes) L.push('', 'Root causes (tickets)', ...pairs(A, B, 'cause', 'count').slice(0, 6).map((r) => `- ${r.label}: A ${r.an} · B ${r.bn}`))
    if (on.groups) L.push('', 'Assignment groups', ...ASSIGNMENT_GROUPS.map((g) => `- ${g}: A ${groupRow(A.rows.filter((h) => h.assignmentGroup === g))} | B ${groupRow(B.rows.filter((h) => h.assignmentGroup === g))}`))
    if (on.qa) {
      const wa = weakest(A.rows), wb = weakest(B.rows)
      L.push('', 'Quality', `- Average QA score: A ${Math.round(avg(A.rows.map(qaScore)) || 0)}/100 · B ${Math.round(avg(B.rows.map(qaScore)) || 0)}/100`,
        `- Weakest criterion: A ${wa ? `${wa[0]} (${Math.round(wa[1] * 100)}%)` : '—'} · B ${wb ? `${wb[0]} (${Math.round(wb[1] * 100)}%)` : '—'}`)
    }
    return L.join('\n')
  }

  const csvCell = (x) => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`
  const num = (k, x) => (x == null || isNaN(x) ? '' : RATIO.includes(k) ? Math.round(x * 1000) / 10 : HOURS.includes(k) ? Math.round(x * 100) / 100 : x)
  const unitOf = (k) => (RATIO.includes(k) ? ' (%)' : HOURS.includes(k) ? ' (h)' : '')
  function reportCsv(v) {
    const { u, A, B, m, dim } = v
    const rows = [['Report', v.title], ['A', A.name, fmtRange(A.range)], ['B', B.name, fmtRange(B.range)], ['Filters', v.active.map((a) => a.text).join('; ') || 'none'], [],
      ['Section', 'Item', 'A', 'B', 'Difference', 'A tickets', 'B tickets']]
    if (u.sections.kpis) METRICS.forEach((k) => { const a = val(k, A.rows), b = val(k, B.rows); rows.push(['Headline', MEASURES[k].label + unitOf(k), num(k, a), num(k, b), num(k, a - b), A.rows.length, B.rows.length]) })
    if (u.sections.breakdown) v.pairs.forEach((r) => rows.push([`${MEASURES[m].label}${unitOf(m)} by ${DIMENSIONS[dim].label.toLowerCase()}`, r.label, num(m, r.a), num(m, r.b), num(m, r.a - r.b), r.an, r.bn]))
    if (u.sections.trend) v.trend.labels.forEach((l, i) => rows.push([`${MEASURES[m].label}${unitOf(m)} by ${v.trend.unit}`, l, num(m, v.trend.a[i]), num(m, v.trend.b[i]), num(m, v.trend.a[i] - v.trend.b[i]), '', '']))
    if (u.sections.causes) pairs(A, B, 'cause', 'count').forEach((r) => rows.push(['Root causes (tickets)', r.label, r.an, r.bn, r.an - r.bn, r.an, r.bn]))
    if (u.sections.groups) ASSIGNMENT_GROUPS.forEach((g) => ['res', 'sla'].forEach((k) => { const ra = A.rows.filter((h) => h.assignmentGroup === g), rb = B.rows.filter((h) => h.assignmentGroup === g); rows.push(['Assignment groups', `${g} · ${MEASURES[k].label}${unitOf(k)}`, num(k, val(k, ra)), num(k, val(k, rb)), num(k, val(k, ra) - val(k, rb)), ra.length, rb.length]) }))
    if (u.sections.qa) rows.push(['Quality', 'Average QA score', Math.round(avg(A.rows.map(qaScore)) || 0), Math.round(avg(B.rows.map(qaScore)) || 0), '', A.rows.length, B.rows.length])
    if (u.withRows) {
      rows.push([], ['Side', 'Ticket', 'Resolved', 'Priority', 'Channel', 'Business app', 'Product group', 'Assignment group', 'Analyst', 'Root cause', 'Resolution code', 'RES MTTR (h)', 'EZE MTTR (h)', 'Lost time (h)', 'SLA met', 'FCR', 'Transfers', 'QA score'])
      ;[A, B].forEach((X) => X.rows.forEach((h) => rows.push([X.key.toUpperCase(), h.id, new Date(h.resolvedAt).toLocaleString(), h.priority, h.channel, h.businessApp, h.productGroup, h.assignmentGroup, byId[h.analyst]?.name || '', DIMENSIONS.cause.get(h), h.code, num('res', h.resH), num('res', h.ezeH), num('res', h.lostH), h.slaMet ? 'Yes' : 'No', h.fcr ? 'Yes' : 'No', h.transfers, qaScore(h)])))
    }
    // BOM so Excel opens accented names correctly.
    return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  }

  // The data the standalone HTML report needs: slim ticket rows per side and
  // the trend buckets. js/components/report-export.js renders it.
  function reportModel(v) {
    const { u, A, B } = v
    const slim = (h) => ({ id: h.id, at: h.resolvedAt, desc: h.desc, priority: h.priority, channel: h.channel, businessApp: h.businessApp, productGroup: h.productGroup, assignmentGroup: h.assignmentGroup, analyst: byId[h.analyst]?.name || '—', cause: DIMENSIONS.cause.get(h), code: h.code, res: h.resH, eze: h.ezeH, lost: h.lostH, sla: h.slaMet, fcr: h.fcr, transfers: h.transfers, qa: qaScore(h) })
    const side = (X) => ({ key: X.key, name: X.name, range: fmtRange(X.range), partial: X.range.partial, rows: X.rows.map(slim) })
    return {
      title: v.title, generated: new Date().toLocaleString(), filters: v.active.map((a) => a.text), dim: v.dim, measure: v.m, goalH: RES_GOAL_H,
      sections: u.sections, withRows: u.withRows, text: reportText(v),
      dims: Object.fromEntries(Object.entries(DIMENSIONS).filter(([k]) => k !== 'week').map(([k, d]) => [k, d.label])),
      measures: Object.fromEntries(METRICS.map((k) => [k, { label: MEASURES[k].label, better: MEASURES[k].better }])),
      groups: ASSIGNMENT_GROUPS, trend: { unit: v.trend.unit, labels: v.trend.labels, edges: v.trend.edges }, sides: [side(A), side(B)],
    }
  }

  const stamp = () => new Date().toISOString().slice(0, 10)
  const fileName = (v, ext) => `scope-compare-${v.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}-${stamp()}.${ext}`
  function generate() {
    const v = compareView()
    if (v.u.format === 'text') return S.copyText(reportText(v))
    if (v.u.format === 'csv') S.download(fileName(v, 'csv'), reportCsv(v), 'text/csv')
    else S.download(fileName(v, 'html'), S.reportHtml(reportModel(v)), 'text/html')
    S.dispatch({ type: 'toast', text: v.u.format === 'csv' ? 'CSV downloaded' : 'HTML report downloaded' })
  }

  function preset(id) {
    const u = cmpUi()
    const q = options('quarter'), mo = options('month'), y = options('year')
    const both = (kind, a, b) => S.set(u, { a: { ...u.a, kind, val: a, analyst: 'All' }, b: { ...u.b, kind, val: b, analyst: 'All' } })
    if (id === 'p30') both('window', '30', 'p30')
    if (id === 'mom') both('month', mo[0].id, (mo[1] || mo[0]).id)
    if (id === 'qoq') both('quarter', q[0].id, (q[1] || q[0]).id)
    if (id === 'yoy') both('year', y[0].id, (y[1] || y[0]).id)
    if (id === 'sqly') both('quarter', q[0].id, (q[4] || q[q.length - 1]).id)
    // The same period for one analyst against the whole team.
    if (id === 'team') S.set(u, { a: { ...u.a, analyst: u.a.analyst !== 'All' ? u.a.analyst : ANALYSTS.find((a) => a.role === 'Analyst').id }, b: { ...u.a, analyst: 'All' } })
  }

  // ---------- Handlers ----------
  S.on({
    'reports.mode': (el) => { const u = pageUi(); if (u.mode !== el.dataset.v) resetSections(); S.set(u, { mode: el.dataset.v }) },
    'reports.tab': (el) => { const u = pageUi(); if (u.tab !== el.dataset.v) resetSections(); S.set(u, { tab: el.dataset.v }) },
    'reports.days': (el) => S.set(S.ui('p:reports:perf'), { days: Number(el.dataset.v) }),
    'reports.sel': (el) => S.set(S.ui('p:reports:qa'), { sel: el.dataset.v }),
    // Compare & generate
    'reports.dim': (el) => S.set(cmpUi(), { dim: el.value, all: false }),
    'reports.measure': (el) => S.set(cmpUi(), { measure: el.value }),
    'reports.f': (el) => { const u = cmpUi(); S.set(u, { f: { ...u.f, [el.dataset.k]: el.value } }) },
    'reports.unfilter': (el) => { const u = cmpUi(); S.set(u, { f: { ...u.f, [el.dataset.v]: 'All' } }) },
    'reports.clear': () => S.set(cmpUi(), { f: { ...DEFAULT_FILTERS } }),
    'reports.drill': (el) => {
      const u = cmpUi()
      const label = el.dataset.v
      if (u.dim === 'analyst') {
        const a = ANALYSTS.find((x) => x.name === label)
        if (a) S.set(u, { a: { ...u.a, analyst: a.id }, b: { ...u.b, analyst: a.id }, dim: DRILL_NEXT.analyst, all: false })
        return
      }
      if (!DRILL_NEXT[u.dim]) return
      S.set(u, { f: { ...u.f, [u.dim]: label }, dim: DRILL_NEXT[u.dim], all: false })
    },
    'reports.kind': (el) => {
      const [key, kind] = el.dataset.v.split(':')
      const u = cmpUi()
      if (u[key].kind === kind) return
      const o = options(kind)
      // B starts one step back from A, so a fresh pick is already a comparison.
      const val = kind === 'window' ? (key === 'a' ? '30' : 'p30') : (key === 'a' ? o[0] : o[1] || o[0]).id
      S.set(u, { [key]: { ...u[key], kind, val } })
    },
    'reports.period': (el) => { const u = cmpUi(), k = el.dataset.side; S.set(u, { [k]: { ...u[k], val: el.value } }) },
    'reports.analyst': (el) => { const u = cmpUi(), k = el.dataset.side; S.set(u, { [k]: { ...u[k], analyst: el.value } }) },
    'reports.swap': () => { const u = cmpUi(); S.set(u, { a: u.b, b: u.a }) },
    'reports.preset': (el) => preset(el.dataset.v),
    'reports.all': () => { const u = cmpUi(); S.set(u, { all: !u.all }) },
    'reports.title': (el) => S.set(cmpUi(), { title: el.value }),
    'reports.section': (el) => { const u = cmpUi(); S.set(u, { sections: { ...u.sections, [el.dataset.v]: el.checked } }) },
    'reports.format': (el) => S.set(cmpUi(), { format: el.dataset.v }),
    'reports.rows': (el) => S.set(cmpUi(), { withRows: el.checked }),
    'reports.generate': generate,
    'reports.copy': () => S.copyText(reportText(compareView())),
  })
})()
