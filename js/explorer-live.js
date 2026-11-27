// Ticket Explorer on real team data: the history of every INC ticket Scope has seen.
//
// For each ticket, one timeline from the shared ops log plus the ServiceNow export:
//   Created           sys_created_on (else opened_at) from the export
//   Entered our queue the first standard INC export Scope saw it in (the export has no
//                     "entered the group" date)
//   Assigned / moved  Scope's hand-out and every move (ticketsAssigned)
//   Opened            the analyst clicked the INC link to open it in ServiceNow (ticketOpened)
//   Status changes    each tag change (ticketTag): the analyst documents it in ServiceNow then
//   3-Strike          hand-outs and contact attempts
// Each step shows the time since the previous step and the ticket's total age and queue age
// at that moment. The summary adds up the whole journey.
;(function () {
  const { html, cls, attrs, icon } = S
  const Q = () => S.queue
  const qm = () => S.qm

  const ui = () => S.ui('p:explorer:live', { q: '', status: 'All', who: '', open: null })
  const live = () => !!(S.queue && S.schedule && S.schedule.real() && S.qm.me())

  // One ticket's journey, oldest step first.
  function journey(t) {
    const q = Q()
    const created = q.createdAt(t)
    const queued = q.queuedAt(t)
    const steps = []
    if (created) steps.push({ at: created, kind: 'created', what: 'Created in ServiceNow', who: t.createdBy || '' })
    if (queued) steps.push({ at: queued, kind: 'queued', what: 'Entered our INC queue', who: '', note: "First ServiceNow export Scope saw it in" })
    for (const h of t.history) {
      const kind = h.kind || (/^(3-Strike|Strike|reached)/.test(h.what) ? 'strike' : 'other')
      steps.push({ at: h.at, kind, what: h.what, who: q.nameOf(h.by), note: h.note, tag: h.tag })
    }
    steps.sort((a, b) => a.at - b.at)
    let prev = null
    for (const s of steps) {
      s.since = prev == null ? null : s.at - prev
      s.total = created ? s.at - created : null
      s.queue = queued && s.at >= queued ? s.at - queued : null
      prev = s.at
    }
    return steps
  }

  // Where the journey ends: the last Resolved/Transferred tag, else now (still open).
  function summary(t) {
    const q = Q()
    const created = q.createdAt(t)
    const queued = q.queuedAt(t)
    const done = !q.isOpen(t) && (t.tag === 'Resolved' || t.tag === 'Transferred') ? t.tagAt : null
    const end = done || Date.now()
    const firstAssign = t.history.find((h) => h.kind === 'assign')
    const lastAssign = [...t.history].reverse().find((h) => h.kind === 'assign')
    const firstOpen = lastAssign && t.opens.filter((o) => o.by === t.to && o.at >= lastAssign.at).map((o) => o.at).sort((a, b) => a - b)[0]
    return {
      done, end,
      total: created ? end - created : null,
      inQueue: queued ? end - queued : null,
      toAssign: queued && firstAssign ? firstAssign.at - queued : null,
      toOpen: lastAssign && firstOpen ? firstOpen - lastAssign.at : null,
      withAnalyst: firstAssign ? end - firstAssign.at : null,
      statusChanges: t.history.filter((h) => h.kind === 'tag').length,
    }
  }

  const KIND_ICON = { created: 'plus', queued: 'upload', assign: 'user', open: 'external', tag: 'check', strike: 'clock', other: 'doc' }
  const dur = (ms) => (ms == null ? '—' : Q().fmtHm(ms))

  function timeline(t) {
    const q = Q()
    const steps = journey(t)
    const sm = summary(t)
    const end = sm.done ? t.tag.toLowerCase() : 'now'
    const cards = [
      ['Total time', sm.total, `Created → ${end}`],
      ['In our queue', sm.inQueue, `Entered → ${end}`],
      ['To assign', sm.toAssign, 'Entered → first assigned'],
      ['To open', sm.toOpen, 'Assigned → opened in ServiceNow'],
      ['With analyst', sm.withAnalyst, `First assigned → ${end}`],
    ]
    // A vertical timeline: a marker per step (filled = done), the time, what happened, then
    // who and how long since the step before. The last marker is "Still open" or the outcome.
    const mark = (s, last) => html`<span class="${cls('tl-mark', s.kind, last && 'last')}">${icon(KIND_ICON[s.kind] || 'doc', 12)}</span>`
    return html`<div class="stack" style="gap:18px">
      <div class="xh-stats">${cards.map(([label, v, foot]) => html`
        <div class="xh-stat" title="${foot}"><span class="xh-l">${label}</span><b>${dur(v)}</b><span class="xh-f">${foot}</span></div>`)}</div>
      ${t.res && resolution(t)}
      <ol class="tl">
        ${steps.map((s, i) => html`<li class="tl-item" data-key="st${i}">
          ${mark(s)}
          <div class="tl-body">
            <span class="tl-when">${q.fmtWhen(s.at)}${s.since != null ? html` · <span title="Since the step before">+${dur(s.since)}</span>` : ''}</span>
            <b class="tl-what">${s.kind === 'tag' && s.tag ? html`Status → ${q.tagPill(s.tag)}${s.what.includes(' with ') ? html` <span class="small muted">${s.what.split(' with ')[1]}</span>` : ''}` : s.what.charAt(0).toUpperCase() + s.what.slice(1)}</b>
            <span class="tl-desc">${[s.who && `by ${s.who}`, s.note].filter(Boolean).join(' · ') || ''}${s.total != null ? html`<span class="tl-ages"> · age ${dur(s.total)}${s.queue != null ? ` · in queue ${dur(s.queue)}` : ''}</span>` : ''}</span>
          </div></li>`)}
        <li class="tl-item end" data-key="end">
          <span class="${cls('tl-mark end', sm.done ? 'done' : 'open')}">${icon(sm.done ? 'check' : 'clock', 12)}</span>
          <div class="tl-body">
            <span class="tl-when">${sm.done ? q.fmtWhen(sm.end) : 'Now'}</span>
            <b class="tl-what">${sm.done ? t.tag : 'Still open'}</b>
            <span class="tl-desc">Total ${dur(sm.total)} · in our queue ${dur(sm.inQueue)}</span>
          </div></li>
      </ol>
      <span class="muted small">Total age counts from when the ticket was created in ServiceNow; queue age from when it came into our INC queue (the first export Scope saw it in). "Opened in ServiceNow" is logged when someone clicks the INC link in Scope. Each status change is when the analyst set it in Scope; the resolution above is what they documented in Scope's resolution journey.</span>
    </div>`
  }

  // What the analyst documented in the resolution journey (the same text they copy into ServiceNow).
  function resolution(t) {
    const q = Q()
    const r = t.res
    const rows = [
      ['Symptom', r.symptom && `${r.symptom}${r.impact ? ` (impact: ${r.impact})` : ''}`],
      ['Diagnosis', r.diagNote],
      ['Fix', `${r.fix || r.title}${r.runbook ? ` (runbook: ${r.runbook})` : ''}`],
      ['Validated', `${r.validated ? 'Yes' : 'No'}${r.validNote ? ` · ${r.validNote}` : ''}`],
      ['First contact', r.fcr ? 'Yes' : 'No'],
      ['Transfers', r.transfers > 0 && `${r.transfers}${r.escalatedTo ? `, escalated to ${r.escalatedTo}` : ''}`],
      ['SLA breach reason', r.breachCode && `${r.breachCode} ${(S.liveResolve && S.liveResolve.BREACH_REASONS[r.breachCode]) || ''}`.trim()],
      ['Close notes', r.closeNote],
    ].filter(([, v]) => v)
    return html`<div class="xh-res">
      <div class="row tight"><span class="eyebrow">Resolution</span><span class="code-chip">${r.code}</span><b>${r.title}</b>
        <span class="spacer"></span>${S.liveResolve && html`<button class="btn ghost sm" data-click="lres.copy" data-v="${t.n}">${icon('copy', 13)}Copy for ServiceNow</button>`}</div>
      <span class="muted small">${r.category || ''} · documented by ${q.nameOf(r.by)}, ${q.fmtWhen(r.at)}</span>
      <dl class="qm-dl">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
    </div>`
  }

  function drawer(t) {
    const q = Q()
    S.drawer({
      className: 'qm-drawer xh-drawer',
      onClose: 'xh.close',
      title: html`<span class="row tight">${t.inLatest || ['Resolved', 'Transferred'].includes(t.tag) ? q.tagPill(t.tag) : html`<span class="pill">Left the queue</span>`}${q.eersPill(t)}</span><h2 class="drawer-title">${q.incLink(t.n, t.sysId)}</h2>`,
      sub: html`<span class="muted small">${t.short} · ${t.priority} · ${q.owner(t) ? q.nameOf(q.owner(t)) : 'Unassigned'}</span>`,
      body: timeline(t),
    })
  }

  function section() {
    const q = Q()
    const v = q.view()
    const f = ui()
    const me = qm().me()
    const needle = f.q.trim().toLowerCase()
    const rows = v.tickets.filter((t) => q.queuedAt(t))
      .filter((t) => f.status === 'All' || (f.status === 'Open' ? q.isOpen(t) : f.status === 'Left' ? !t.inLatest && !['Resolved', 'Transferred'].includes(t.tag) : t.tag === f.status))
      .filter((t) => !f.who || q.owner(t) === f.who)
      .filter((t) => !needle || `${t.n} ${t.short} ${q.owner(t) ? q.nameOf(q.owner(t)) : ''}`.toLowerCase().includes(needle))
      .sort((a, b) => q.queuedAt(b) - q.queuedAt(a))
    const people = qm().roster.filter((p) => v.tickets.some((t) => q.owner(t) === p.soeid))
    const cur = f.open && v.ticketMap.get(f.open)
    const firstOpen = (t) => { const a = [...t.history].reverse().find((h) => h.kind === 'assign'); return a ? t.opens.filter((o) => o.by === t.to && o.at >= a.at).map((o) => o.at).sort((x, y) => x - y)[0] : null }
    const lastTag = (t) => [...t.history].reverse().find((h) => h.kind === 'tag')
    const short = (ms) => (ms ? html`<span title="${q.fmtWhen(ms)}">${new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>` : html`<span class="muted">—</span>`)
    return html`<section class="card">
      <div class="row" style="padding:12px">
        <input class="in" placeholder="Search ticket, description or owner" value="${f.q}" data-input="xh.f" data-k="q" style="flex:1;min-width:200px;max-width:320px">
        <select class="in" data-change="xh.f" data-k="status" aria-label="Status">${['All', 'Open', 'On Hold', 'Resolved', 'Transferred', 'Left'].map((x) => html`<option value="${x}" ${attrs({ selected: f.status === x })}>${x === 'Left' ? 'Left the queue' : x === 'All' ? 'All statuses' : x}</option>`)}</select>
        <select class="in" data-change="xh.f" data-k="who" aria-label="Owner"><option value="">Everyone</option>
          ${me && html`<option value="${me.soeid}" ${attrs({ selected: f.who === me.soeid })}>Me</option>`}
          ${people.filter((p) => !me || p.soeid !== me.soeid).map((p) => html`<option value="${p.soeid}" ${attrs({ selected: f.who === p.soeid })}>${p.name}</option>`)}</select>
        <span class="spacer"></span><span class="muted small">${rows.length} ticket${rows.length === 1 ? '' : 's'}</span>
      </div>
      <div class="tbl-wrap tbl-scroll"><table class="tbl qm-tbl qm-compact">
        <thead><tr><th>Ticket</th><th>Owner</th><th>Status</th><th>Created</th><th>Entered queue</th><th>Assigned</th><th>Opened by owner</th><th>Last status change</th><th class="r">Total age</th><th class="r">Queue age</th></tr></thead>
        <tbody>${rows.slice(0, 300).map((t) => { const sm = summary(t); const lt = lastTag(t); return html`<tr class="${cls('click', f.open === t.n && 'sel')}" data-click="xh.open" data-v="${t.n}" data-key="${t.n}">
          <td class="qm-tcell"><span class="mono">${t.n}</span><div class="small ink2 qm-tdesc" style="padding-left:0" title="${t.short}">${t.short || '—'}</div></td>
          <td class="nowrap small">${q.owner(t) ? q.nameOf(q.owner(t)) : html`<span class="muted">Unassigned</span>`}</td>
          <td class="nowrap">${t.inLatest || ['Resolved', 'Transferred'].includes(t.tag) ? q.tagPill(t.tag) : html`<span class="pill">Left the queue</span>`}${t.res && html` <span class="code-chip" title="${t.res.title}">${t.res.code}</span>`}</td>
          <td class="nowrap small">${short(q.createdAt(t))}</td>
          <td class="nowrap small">${short(q.queuedAt(t))}</td>
          <td class="nowrap small">${short(t.assignedAt)}</td>
          <td class="nowrap small">${short(firstOpen(t))}</td>
          <td class="nowrap small">${lt ? html`${q.tagPill(lt.tag)} ${short(lt.at)}` : html`<span class="muted">—</span>`}</td>
          <td class="r nowrap small">${dur(sm.total)}</td>
          <td class="r nowrap small">${dur(sm.inQueue)}</td>
        </tr>` })}</tbody></table>
        ${!rows.length && html`<div class="empty">${v.latest ? 'No tickets match.' : 'No export loaded yet. Tickets appear here once someone loads the ServiceNow export on Home.'}</div>`}
      </div>
      ${rows.length > 300 && html`<div class="small muted" style="padding:10px">Showing the 300 newest of ${rows.length}. Search or filter to find older ones.</div>`}
    </section>
    ${cur && drawer(cur)}`
  }

  S.explorerLive = { live, section, journey, summary }
  S.on({
    'xh.f': (el) => S.set(ui(), { [el.dataset.k]: el.value }),
    'xh.open': (el, ev) => { if (ev && ev.target.closest && ev.target.closest('a')) return; S.set(ui(), { open: el.dataset.v }) },
    'xh.close': () => S.set(ui(), { open: null }),
  })
})()
