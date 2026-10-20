// Reports, ported from src/pages/Reports.jsx.
;(function () {
  const { html, cls, attrs, style, icon, kpi, seg, hBars, lineChart, barChart } = S
  const { ANALYSTS, ASSIGNMENT_GROUPS, DAY, RES_GOAL_H, avg, fmtDate, fmtH, initials } = S
  const { DIMENSIONS, MEASURES, TEMPLATES, aggregate, inWindow, parseQuery, qaScore } = S

  // <option> with the selected attribute (the morph reads it to set the value).
  const opt = (cur, value, label = value) => html`<option value="${value}" ${attrs({ selected: String(cur) === String(value) })}>${label}</option>`

  const pageUi = () => S.ui('p:reports', { mode: 'insight', tab: 'perf' })
  // Each section keeps its own state under p:reports:<name>. Switching mode or
  // tab drops it, as the React page did when it unmounted the section.
  // Chart hover lives in the shared S.ui('chartHover'), so clear it for this page's charts too.
  const CHARTS = ['reports-mttr', 'reports-volume', 'reports-explore', 'reports-search']
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
          { id: 'explore', label: 'Explorer', icon: 'filter' },
          { id: 'search', label: 'Template search', icon: 'search' },
        ], u.tab, 'reports.tab')}
        ${u.tab === 'perf' && performance()}
        ${u.tab === 'qa' && quality()}
        ${u.tab === 'explore' && selfServe()}
        ${u.tab === 'search' && templateSearch()}` : compareGenerate()}`
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

  // id: unique chart id for this view.
  function resultView(id, { rows, dim, measure, title }) {
    const data = aggregate(rows, dim, measure)
    const M = MEASURES[measure]
    return html`<div class="grid g-2">
      <div class="card">
        <div class="card-h"><h3>${title || `${M.label} by ${DIMENSIONS[dim].label.toLowerCase()}`}</h3><span class="muted small">${rows.length} tickets</span></div>
        <div class="card-b">
          ${dim === 'week'
            ? lineChart(id, { labels: data.map((d) => d.label), series: [{ name: M.label, color: 'var(--s1)', values: data.map((d) => d.value) }], fmt: M.fmt })
            : hBars({ rows: data.slice(0, 12), fmt: M.fmt })}
          ${!data.length && html`<div class="empty">No tickets match.</div>`}
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h3>Table view</h3></div>
        <div class="tbl-wrap" style="max-height:340px;overflow-y:auto">
          <table class="tbl">
            <thead><tr><th>${DIMENSIONS[dim].label}</th><th class="r">${M.label}</th><th class="r">Tickets</th></tr></thead>
            <tbody>${data.map((d) => html`<tr data-key="${d.label}"><td>${d.label}</td><td class="r">${M.fmt(d.value)}</td><td class="r">${d.n}</td></tr>`)}</tbody>
          </table>
        </div>
      </div>
    </div>`
  }

  function selfServe() {
    const state = S.state
    const q = S.ui('p:reports:explore', { dim: 'businessApp', measure: 'res', days: '30', prio: 'All', channel: 'All', fcr: 'All' })
    const rows = inWindow(state.history, state.now, Number(q.days), q.prio).filter((h) => (q.channel === 'All' || h.channel === q.channel) && (q.fcr === 'All' || (q.fcr === 'Yes') === h.fcr))
    return html`
      <div class="callout small">${icon('filter', 16)}<span><b>Explorer · Tier 1.</b> Pick a dimension, a measure and filters to answer a question nobody pre-built. Computed in the browser from Ticket Explorer records.</span></div>
      <section class="card"><div class="card-b form-grid" style="padding-top:16px">
        <label class="field"><span>Dimension</span><select id="ss-dim" class="in" data-change="reports.q" data-k="dim">${Object.entries(DIMENSIONS).map(([k, v]) => opt(q.dim, k, v.label))}</select></label>
        <label class="field"><span>Measure</span><select id="ss-measure" class="in" data-change="reports.q" data-k="measure">${Object.entries(MEASURES).map(([k, v]) => opt(q.measure, k, v.label))}</select></label>
        <label class="field"><span>Window</span><select id="ss-days" class="in" data-change="reports.q" data-k="days">${opt(q.days, '7', 'Last 7 days')}${opt(q.days, '30', 'Last 30 days')}${opt(q.days, '90', 'Last 90 days')}</select></label>
        <label class="field"><span>Priority</span><select id="ss-prio" class="in" data-change="reports.q" data-k="prio">${['All', 'P1', 'P2', 'P3', 'P4'].map((p) => opt(q.prio, p))}</select></label>
        <label class="field"><span>Channel</span><select id="ss-ch" class="in" data-change="reports.q" data-k="channel">${opt(q.channel, 'All')}${['Phone', 'Chat', 'Email', 'Self-service portal', 'Monitoring alert'].map((p) => opt(q.channel, p))}</select></label>
        <label class="field"><span>FCR</span><select id="ss-fcr" class="in" data-change="reports.q" data-k="fcr">${opt(q.fcr, 'All')}${opt(q.fcr, 'Yes')}${opt(q.fcr, 'No')}</select></label>
      </div></section>
      ${resultView('reports-explore', { rows, dim: q.dim, measure: q.measure })}`
  }

  const EXAMPLES = ['slowest business apps by MTTR last 30 days', 'top 5 root causes this quarter', 'FCR by channel', 'SLA attainment trend for P1', 'which analyst has the most transfers', 'lost time by assignment group last 2 weeks', 'most used resolution codes last 7 days']

  function templateSearch() {
    const state = S.state
    const u = S.ui('p:reports:search', () => { const text = 'slowest business apps by MTTR last 30 days'; return { text, run: text } })
    const p = parseQuery(u.run)
    const rows = inWindow(state.history, state.now, p.days, p.prio)
    const tplInfo = TEMPLATES[p.tpl]
    let data = aggregate(rows, p.dim, p.measure)
    if (p.tpl === 'rank') data = (p.asc ? data.slice().reverse() : data).slice(0, p.topN || 5)
    return html`
      <div class="callout small">${icon('search', 16)}<span><b>Template Search · Tier 2.</b> Type a question. Keywords map to a fixed query template, so the same words always give the same answer. Rules only until an approved AI gateway exists.</span></div>
      <form class="row" data-submit="reports.run">
        <input id="ts-q" class="in" style="flex:1;min-width:220px;font-size:15px;padding:10px 12px" value="${u.text}" data-input="reports.text" placeholder="e.g. slowest apps by MTTR last 30 days">
        <button class="btn primary" type="submit">${icon('search', 15)}Run</button>
      </form>
      <div class="row">${EXAMPLES.map((x) => html`<button class="btn sm" data-click="reports.example" data-v="${x}">${x}</button>`)}</div>
      <section class="card" style="padding:14px">
        <div class="row small">
          <span class="eyebrow">Matched</span>
          <span class="code-chip">${tplInfo.id}</span><b>${tplInfo.name}</b>
          <span class="pill plain">dimension: ${DIMENSIONS[p.dim].label}</span>
          <span class="pill plain">measure: ${MEASURES[p.measure].label}</span>
          <span class="pill plain">window: ${p.days}d</span>
          ${p.prio !== 'All' && html`<span class="pill plain">priority: ${p.prio}</span>`}
          ${p.tpl === 'rank' && html`<span class="pill plain">${p.asc ? 'bottom' : 'top'} ${p.topN || 5}</span>`}
        </div>
      </section>
      ${p.tpl === 'rank' ? html`
        <div class="card">
          <div class="card-h"><h3>${p.asc ? 'Bottom' : 'Top'} ${p.topN || 5} · ${DIMENSIONS[p.dim].label} by ${MEASURES[p.measure].label}</h3><span class="muted small">${rows.length} tickets</span></div>
          <div class="card-b">${hBars({ rows: data, fmt: MEASURES[p.measure].fmt })}</div>
        </div>` : resultView('reports-search', { rows, dim: p.dim, measure: p.measure })}`
  }

  // ---------- Compare & generate ----------
  const CHANNEL_OPTS = ['Phone', 'Chat', 'Email', 'Self-service portal', 'Monitoring alert']
  const SECTIONS = [['kpis', 'Headline KPIs'], ['causes', 'Root causes'], ['groups', 'Assignment groups'], ['qa', 'Quality & coaching'], ['handover', 'Shift handovers']]
  const cmpUi = () => S.ui('p:reports:compare', () => ({ by: 'period', a: 'Service Desk L2', b: 'Apps Support', tpl: 'weekly', sections: { kpis: true, causes: true, groups: true, qa: true, handover: true } }))

  // The report text for the chosen template and sections.
  function reportLines() {
    const state = S.state
    const { tpl, sections } = cmpUi()
    const now = state.now
    const days = tpl === 'weekly' ? 7 : tpl === 'monthly' ? 30 : 30
    const R = state.history.filter((h) => h.resolvedAt >= now - days * DAY)
    const tplName = { weekly: 'Weekly service operations report', monthly: 'Monthly SLA review', coaching: 'Team coaching pack' }[tpl]
    return [
      `${tplName}`,
      `Period: ${fmtDate(now - days * DAY)} – ${fmtDate(now)} · ${R.length} resolved tickets`,
      sections.kpis && `\nHeadline\n- Avg EZE MTTR ${fmtH(MEASURES.eze.fn(R))}, RES MTTR ${fmtH(MEASURES.res.fn(R))}\n- SLA attainment ${MEASURES.sla.fmt(MEASURES.sla.fn(R))}, resolved under ${RES_GOAL_H}h ${MEASURES.goal.fmt(MEASURES.goal.fn(R))}\n- FCR ${MEASURES.fcr.fmt(MEASURES.fcr.fn(R))}, transfer rate ${MEASURES.transfers.fmt(MEASURES.transfers.fn(R))}`,
      sections.causes && `\nTop root causes\n${aggregate(R, 'cause', 'count').slice(0, 4).map((c) => `- ${c.label}: ${c.value}`).join('\n')}`,
      sections.groups && `\nAssignment groups\n${ASSIGNMENT_GROUPS.map((g) => { const r = R.filter((h) => h.assignmentGroup === g); return `- ${g}: ${r.length} tickets, RES ${fmtH(MEASURES.res.fn(r))}, SLA ${MEASURES.sla.fmt(MEASURES.sla.fn(r))}` }).join('\n')}`,
      sections.qa && `\nQuality\n- Average QA score ${Math.round(avg(R.map(qaScore)) || 0)}/100\n- Lowest criterion: ${['documentation', 'contactLogged', 'correctCode', 'validated'].map((k) => [k, R.filter((h) => h.qa[k]).length / Math.max(1, R.length)]).sort((x, y) => x[1] - y[1])[0][0]}`,
      sections.handover && `\nShift handovers\n- ${state.handovers.filter((h) => h.at >= now - days * DAY).length} handovers, ${state.handovers.filter((h) => h.at >= now - days * DAY && h.openCritical).length} with open critical incidents`,
    ].filter(Boolean).join('\n')
  }

  function compareGenerate() {
    const state = S.state
    const u = cmpUi()
    const { by, a, b, tpl, sections } = u
    const now = state.now
    const setsFor = () => {
      if (by === 'period') return [
        { name: 'Last 30 days', rows: state.history.filter((h) => h.resolvedAt >= now - 30 * DAY) },
        { name: 'Prior 30 days', rows: state.history.filter((h) => h.resolvedAt < now - 30 * DAY && h.resolvedAt >= now - 60 * DAY) },
      ]
      const key = by === 'group' ? 'assignmentGroup' : 'channel'
      return [{ name: a, rows: state.history.filter((h) => h[key] === a) }, { name: b, rows: state.history.filter((h) => h[key] === b) }]
    }
    const [A, B] = setsFor()
    const opts = by === 'group' ? ASSIGNMENT_GROUPS : CHANNEL_OPTS
    const metrics = ['count', 'res', 'eze', 'lost', 'sla', 'fcr', 'transfers', 'goal']
    const lines = reportLines()

    return html`
      <section class="card">
        <div class="card-h"><h3>Compare</h3>
          <span class="spacer"></span>
          ${seg([{ id: 'period', label: 'Period' }, { id: 'group', label: 'Assignment group' }, { id: 'channel', label: 'Channel' }], by, 'reports.by')}
        </div>
        <div class="card-b stack lg">
          ${by !== 'period' && html`
            <div class="row">
              <select id="cmp-a" class="in" data-change="reports.cmp" data-k="a" aria-label="Compare A">${opts.map((o) => opt(a, o))}</select>
              <span class="muted">vs</span>
              <select id="cmp-b" class="in" data-change="reports.cmp" data-k="b" aria-label="Compare B">${opts.map((o) => opt(b, o))}</select>
            </div>`}
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Measure</th><th class="r">${A.name}</th><th class="r">${B.name}</th><th class="r">Difference</th></tr></thead>
              <tbody>
                ${metrics.map((m) => {
                  const va = MEASURES[m].fn(A.rows), vb = MEASURES[m].fn(B.rows)
                  const d = va - vb
                  const better = MEASURES[m].better === 'none' ? null : MEASURES[m].better === 'low' ? d < 0 : d > 0
                  const dtxt = ['res', 'eze', 'lost'].includes(m) ? `${d > 0 ? '+' : ''}${d.toFixed(1)}h` : m === 'count' ? `${d > 0 ? '+' : ''}${Math.round(d)}` : `${d > 0 ? '+' : ''}${Math.round(d * 100)} pts`
                  return html`
                    <tr data-key="${m}">
                      <td>${MEASURES[m].label}</td>
                      <td class="r">${MEASURES[m].fmt(va)}</td>
                      <td class="r">${MEASURES[m].fmt(vb)}</td>
                      <td class="r"><span class="pill ${better == null || Math.abs(d) < 1e-9 ? 'plain' : better ? 'good' : 'crit'}">${dtxt}</span></td>
                    </tr>`
                })}
              </tbody>
            </table>
          </div>
          <div class="small muted">Green means ${A.name} is better on that measure.</div>
        </div>
      </section>
      <section class="grid g-1-2">
        <div class="card">
          <div class="card-h"><h3>Generate a report</h3></div>
          <div class="card-b stack lg">
            <label class="field"><span>Template</span>
              <select id="gen-tpl" class="in" data-change="reports.cmp" data-k="tpl">
                ${opt(tpl, 'weekly', 'Weekly service operations report')}${opt(tpl, 'monthly', 'Monthly SLA review')}${opt(tpl, 'coaching', 'Team coaching pack')}
              </select>
            </label>
            <div class="stack">
              <span class="section-title">Sections</span>
              ${SECTIONS.map(([k, l]) => html`
                <label class="check small"><input type="checkbox" ${attrs({ checked: sections[k] })} data-change="reports.section" data-v="${k}">${l}</label>`)}
            </div>
            <button class="btn primary" data-click="reports.copy">${icon('copy', 15)}Copy report text</button>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Preview</h3><span class="muted small">built from Ticket Explorer records</span></div>
          <div class="card-b"><pre class="mono" style="${style({ whiteSpace: 'pre-wrap', margin: 0, background: 'var(--surface-2)', padding: 14, borderRadius: 8, fontSize: 12.5, lineHeight: 1.6 })}">${lines}</pre></div>
        </div>
      </section>`
  }

  // ---------- Handlers ----------
  S.on({
    'reports.mode': (el) => { const u = pageUi(); if (u.mode !== el.dataset.v) resetSections(); S.set(u, { mode: el.dataset.v }) },
    'reports.tab': (el) => { const u = pageUi(); if (u.tab !== el.dataset.v) resetSections(); S.set(u, { tab: el.dataset.v }) },
    'reports.days': (el) => S.set(S.ui('p:reports:perf'), { days: Number(el.dataset.v) }),
    'reports.sel': (el) => S.set(S.ui('p:reports:qa'), { sel: el.dataset.v }),
    'reports.q': (el) => S.set(S.ui('p:reports:explore'), { [el.dataset.k]: el.value }),
    'reports.text': (el) => S.set(S.ui('p:reports:search'), { text: el.value }),
    'reports.run': () => { const u = S.ui('p:reports:search'); S.set(u, { run: u.text }) },
    'reports.example': (el) => S.set(S.ui('p:reports:search'), { text: el.dataset.v, run: el.dataset.v }),
    'reports.by': (el) => {
      const v = el.dataset.v
      const patch = { by: v }
      if (v === 'group') Object.assign(patch, { a: 'Service Desk L2', b: 'Apps Support' })
      if (v === 'channel') Object.assign(patch, { a: 'Phone', b: 'Chat' })
      S.set(cmpUi(), patch)
    },
    'reports.cmp': (el) => S.set(cmpUi(), { [el.dataset.k]: el.value }),
    'reports.section': (el) => { const u = cmpUi(); S.set(u, { sections: { ...u.sections, [el.dataset.v]: el.checked } }) },
    'reports.copy': () => S.copyText(reportLines()),
  })
})()
