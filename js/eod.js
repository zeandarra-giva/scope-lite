// End-of-day report (lead, 2026-11-24): what each person handled on a day.
//  - Home → End of day: the overview for everyone, one row per person.
//  - Queue Management → End of day: my own breakdown, ticket by ticket.
// The equal share is Base INC + 3-Strike (senior's review, 2026-11-24): INC tickets that
// became theirs that day, plus verified manual entries, plus 3-Strike tickets they FINISHED
// (an attempt logged). 3-Strike tickets handed out but not finished in their window are
// listed with that label and don't count toward the total.
;(function () {
  const { html, cls, attrs, icon } = S
  const Q = () => S.queue
  const qm = S.qm
  const DAY = 864e5
  const dayStart = (day) => new Date(`${day}T00:00:00`).getTime()
  const ui = () => S.ui('p:eod', () => ({ day: Q().dayOf(Date.now()) }))

  function report(day, now = Date.now()) {
    const v = Q().view()
    const from = dayStart(day); const to = from + DAY
    const qs = S.strike.strikeQueues(v)
    const strike = S.strike.dayCounts(day, now, v)
    const people = qm.roster.filter((p) => p.active !== false).map((p) => {
      const inc = v.tickets.filter((t) => Q().owner(t) === p.soeid && t.assignedAt >= from && t.assignedAt < to)
      const closed = inc.filter((t) => ['Resolved', 'Transferred'].includes(t.tag)).length
      const onHold = inc.filter((t) => t.tag === 'On Hold').length
      const manual = (qm.entries || []).filter((x) => x.by === p.soeid && x.status === 'Verified' && x.handledAt >= from && x.handledAt < to).length
      const sk = strike.get(p.soeid) || {}
      const sum = (k) => Object.values(sk).reduce((a, c) => a + c[k], 0)
      const pl = S.schedule ? S.schedule.planFor(p.soeid, day) : {}
      const row = { p, inc: inc.length, closed, onHold, manual, sk, sDone: sum('done'), sMissed: sum('missed'), sPending: sum('pending'), sGiven: sum('given'), worked: !!pl.ready }
      row.total = row.inc + row.manual + row.sDone
      return row
    }).filter((r) => r.worked || r.inc || r.manual || r.sGiven)
      .sort((a, b) => b.total - a.total || a.p.name.localeCompare(b.p.name))
    const sharing = people.filter((r) => r.worked || r.total)
    const total = sharing.reduce((a, r) => a + r.total, 0)
    // Per window: loaded, handed out, finished, not finished, never handed out.
    const windows = qs.map((q) => {
      const rows = S.strike.windowRows(q, day, now, v)
      return { q, rows, loaded: rows.length, done: rows.filter((r) => r.status === 'done').length, missed: rows.filter((r) => r.status === 'missed').length, unhanded: rows.filter((r) => r.status === 'unhanded').length }
    })
    return { day, people, qs, windows, total, fair: sharing.length ? total / sharing.length : 0, n: sharing.length }
  }

  const n1 = (x) => (Math.round(x * 10) / 10)
  const dayPicker = () => html`<label class="row tight small"><span class="muted">Day</span><input class="in sm" type="date" value="${ui().day}" max="${Q().dayOf(Date.now())}" data-change="eod.day"></label>`
  function cell(c) {
    if (!c || !c.given) return html`<span class="muted">—</span>`
    return html`<span class="nowrap"><b class="num">${c.done}</b><span class="muted small"> / ${c.given}</span></span>${c.missed > 0 && html`<div class="crit-ink small nowrap" title="Handed out, no attempt logged by the end of the window">${c.missed} not finished</div>`}`
  }
  const info = () => S.infoTip('eod', 'End of day', html`
    <span><b>INC:</b> standard INC tickets that became theirs that day (from the INC export), with how many are Resolved or Transferred.</span>
    <span><b>3-Strike, per region:</b> finished / handed out. Finished = a contact attempt logged (reached or not). <b>Not finished</b> = handed out, but no attempt logged by the end of that region's window; it's listed, but doesn't count.</span>
    <span><b>Total</b> = INC + verified manual entries + 3-Strike finished. The equal share is the team's total divided by everyone who worked that day; the goal is that totals stay close to it.</span>`)

  // ---------- Home → End of day ----------
  function homeTab() {
    const r = report(ui().day)
    return html`<div class="card-b stack" style="gap:12px;padding-top:12px">
      <div class="row tight">${dayPicker()}<span class="spacer"></span>
        <span class="small muted">${r.n ? html`Equal share <b class="num">${n1(r.fair)}</b> each · ${r.total} handled by ${r.n}` : ''}</span>${info()}</div>
      ${r.people.length ? html`<div class="tbl-wrap"><table class="tbl qm-compact eod-tbl">
        <thead><tr><th rowspan="2">Analyst</th><th rowspan="2">INC</th><th colspan="${r.qs.length}" class="eod-group">3-Strike · finished / handed out</th><th rowspan="2">Manual</th><th rowspan="2">Total</th><th rowspan="2" title="Total minus the equal share">± share</th></tr>
          <tr>${r.qs.map((q) => html`<th class="eod-q" title="${q.start}–${q.end}">${q.name}</th>`)}</tr></thead>
        <tbody>${r.people.map((x) => { const d = x.total - r.fair; return html`<tr data-key="${x.p.soeid}">
          <td class="nowrap">${x.p.name}</td>
          <td><b class="num">${x.inc}</b>${x.inc > 0 && html`<div class="muted small nowrap">${x.closed} closed</div>`}</td>
          ${r.qs.map((q) => html`<td>${cell(x.sk[q.id])}</td>`)}
          <td class="num">${x.manual || html`<span class="muted">—</span>`}</td>
          <td class="num"><b>${x.total}</b></td>
          <td class="num ${cls(Math.abs(d) >= 2 && (d > 0 ? 'ink2' : 'crit-ink'))}">${r.n ? (d > 0 ? '+' : '') + n1(d) : ''}</td>
        </tr>` })}</tbody>
        <tfoot><tr><td><b>Team</b></td><td class="num"><b>${r.people.reduce((a, x) => a + x.inc, 0)}</b></td>
          ${r.windows.map((w) => html`<td class="small">${w.loaded ? html`<span class="nowrap"><b>${w.done}</b> / ${w.loaded} loaded</span>${w.missed > 0 && html`<div class="crit-ink nowrap">${w.missed} not finished</div>`}${w.unhanded > 0 && html`<div class="crit-ink nowrap">${w.unhanded} not handed out</div>`}` : html`<span class="muted">Not loaded</span>`}</td>`)}
          <td class="num">${r.people.reduce((a, x) => a + x.manual, 0)}</td><td class="num"><b>${r.total}</b></td><td></td></tr></tfoot>
      </table></div>` : html`<div class="empty">Nobody worked or handled tickets on this day.</div>`}
    </div>`
  }

  // ---------- Queue Management → End of day (mine) ----------
  function myTab(me) {
    const day = ui().day
    const r = report(day)
    const x = r.people.find((p) => p.p.soeid === me.soeid)
    const v = Q().view()
    const from = dayStart(day)
    const inc = v.tickets.filter((t) => Q().owner(t) === me.soeid && t.assignedAt >= from && t.assignedAt < from + DAY).sort((a, b) => a.assignedAt - b.assignedAt)
    const sk = r.windows.map((w) => ({ q: w.q, rows: w.rows.filter((row) => row.w && row.w.to === me.soeid) })).filter((w) => w.rows.length)
    return html`<div class="stack" style="gap:14px">
      <div class="row tight">${dayPicker()}<span class="spacer"></span>${info()}</div>
      <div class="grid g-kpi">
        ${S.kpi({ label: 'Total handled', icon: 'check', tone: 'good', value: x ? x.total : 0, foot: r.n ? `Equal share ${n1(r.fair)} · team ${r.total} by ${r.n}` : 'Nobody worked this day' })}
        ${S.kpi({ label: 'INC', icon: 'list', tone: 'sky', value: x ? x.inc : 0, foot: x ? `${x.closed} closed · ${x.onHold} On Hold · ${x.manual} verified manual` : '' })}
        ${S.kpi({ label: '3-Strike finished', icon: 'clock', tone: 'navy', value: x ? x.sDone : 0, foot: x ? `of ${x.sGiven} handed out${x.sPending ? ` · ${x.sPending} still to do` : ''}` : '' })}
        ${S.kpi({ label: 'Not finished in window', icon: 'alert', tone: x && x.sMissed ? 'warn' : 'good', value: x ? x.sMissed : 0, foot: '3-Strike, no attempt by the window\'s end' })}
      </div>
      <div class="card"><div class="card-h"><b>INC tickets</b><span class="muted small">${inc.length}</span></div>
        ${inc.length ? html`<div class="tbl-wrap"><table class="tbl qm-compact"><thead><tr><th>INC</th><th>Short description</th><th>Given</th><th>Tag</th></tr></thead>
          <tbody>${inc.map((t) => html`<tr data-key="${t.n}"><td>${Q().incLink(t.n, t.sysId)}</td><td class="clip">${t.short}</td><td class="nowrap small">${S.fmtTime(t.assignedAt)}</td><td>${Q().tagPill(t.tag)}</td></tr>`)}</tbody></table></div>`
          : html`<div class="card-b empty small">No INC tickets became yours this day.</div>`}</div>
      ${S.strike.strikeQueues(v).filter((q) => q.active || sk.some((w) => w.q.id === q.id)).map((q) => { const w = sk.find((y) => y.q.id === q.id); return html`<div class="card" data-key="${q.id}">
        <div class="card-h"><b>3-Strike · ${q.name}</b><span class="muted small">${q.start}–${q.end}</span><span class="spacer"></span>${cell(x && x.sk[q.id])}</div>
        ${w ? html`<div class="tbl-wrap"><table class="tbl qm-compact"><thead><tr><th>INC</th><th>Short description</th><th>Given</th><th>Status</th></tr></thead>
          <tbody>${w.rows.map((row) => html`<tr data-key="${row.t.n}"><td>${Q().incLink(row.t.n, row.t.sysId)}</td><td class="clip">${row.t.short}</td><td class="nowrap small">${S.fmtTime(row.w.at)}${row.w.override ? ' · by hand' : ''}</td><td>${S.strike.statusPill(row)}</td></tr>`)}</tbody></table></div>`
          : html`<div class="card-b empty small">None for you in this window.</div>`}
      </div>` })}
    </div>`
  }

  S.eod = { report, homeTab, myTab }
  S.on({ 'eod.day': (el) => { if (/^\d{4}-\d{2}-\d{2}$/.test(el.value)) S.set(ui(), { day: el.value }) } })
})()
