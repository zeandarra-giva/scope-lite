// Home (Queue command), ported from src/pages/Home.jsx: queue health KPIs,
// schedule preview, fair-share assignment, and the team queue / my work /
// shift handover / fix approvals tabs.
;(function () {
  const { html, style, attrs, icon, prio, slaPill } = S
  const { HOUR, MAX_LOAD_POINTS, PRIORITIES, SHIFT_CODES, byId, fmtDateTime, fmtDay, fmtDur, fmtTime, initials, loadOf, slaInfo } = S

  function queueMetrics(tickets, analysts, now) {
    const open = tickets.filter((t) => t.state !== 'Resolved')
    const n = Math.max(1, open.length)
    const sla = open.map((t) => slaInfo(t, now))
    const breached = sla.filter((s) => s.status === 'Breached').length
    const atRisk = sla.filter((s) => s.status === 'At risk').length
    const crit = open.filter((t) => t.priority === 'P1' || t.priority === 'P2').length
    const online = analysts.filter((a) => a.status === 'online')
    const load = open.reduce((s, t) => s + PRIORITIES[t.priority].weight, 0)
    const loadRatio = Math.min(1, load / Math.max(1, online.length * MAX_LOAD_POINTS))
    const avgQueueAge = open.reduce((s, t) => s + (now - t.queuedAt), 0) / n
    const ageRatio = Math.min(1, avgQueueAge / (8 * HOUR))
    const parts = [
      { label: 'SLA pressure', w: 40, v: Math.min(1, (breached + atRisk * 0.6) / n) },
      { label: 'P1/P2 share', w: 25, v: crit / n },
      { label: 'Load vs. capacity', w: 20, v: loadRatio },
      { label: 'Queue age', w: 15, v: ageRatio },
    ]
    const risk = Math.round(parts.reduce((s, p) => s + p.w * p.v, 0))
    const slaHealth = sla.reduce((s, x) => s + x.pct, 0) / n
    const ageHealth = open.filter((t) => now - t.openedAt < PRIORITIES[t.priority].slaH * HOUR * 0.5).length / n
    return { open, breached, atRisk, crit, online, risk, parts, slaHealth, ageHealth, p1: open.filter((t) => t.priority === 'P1').length }
  }

  const toneOf = (risk) => (risk >= 60 ? 'crit' : risk >= 35 ? 'warn' : 'good')
  const STATES = ['New', 'In Progress', 'Awaiting Customer', 'On Hold', 'Resolved']
  const options = (items, cur) => items.map((x) => {
    const [v, l] = Array.isArray(x) ? x : [x, x]
    return html`<option value="${v}" ${attrs({ selected: v === cur })}>${l}</option>`
  })
  // Page state: the open tab, the ticket in the drawer and the ticket being resolved.
  const page = () => S.ui('p:home', () => {
    const route = S.route
    const lead = S.state.role === 'lead'
    return { tab: route.tab || (route.approval ? 'approvals' : lead ? 'queue' : 'mine'), drawer: route.ticket || null, resolving: null }
  })

  function Home(route) {
    const state = S.state
    const me = S.currentUser(state)
    const lead = state.role === 'lead'
    const u = page()
    const m = queueMetrics(state.tickets, state.analysts, state.now)
    const myOpen = state.tickets.filter((t) => t.assignedTo === me.id)
    const pendingFix = state.approvals.filter((a) => a.status === 'Pending').length
    const drawerTicket = state.tickets.find((t) => t.id === u.drawer)

    const tabs = [
      { id: 'queue', label: 'Team queue', count: m.open.length },
      { id: 'mine', label: 'My work queue', count: myOpen.length },
      { id: 'handover', label: 'Shift handover' },
      ...(lead ? [{ id: 'approvals', label: 'Fix approvals', count: pendingFix }] : []),
    ]
    const slaState = m.slaHealth < 0.35 ? 'crit' : m.slaHealth < 0.55 ? 'warn' : 'good'

    // Render the tab body before the drawer and modal so overlays stack in the same order as React.
    const body = html`
      <section class="grid g-kpi" aria-label="Queue health" data-tour="kpis">
        ${S.kpi({ label: 'Active incidents', icon: 'alert', value: m.open.length, state: m.p1 ? 'crit' : undefined,
          info: html`<span>Open incidents pulled from ServiceNow, refreshed every 30 seconds.</span><span><b>Breached</b>: past the SLA deadline for its priority (P1 4h, P2 8h, P3 24h, P4 72h).</span><span><b>At risk</b>: less than 25% of the SLA window left.</span>`,
          foot: html`<span class="prio P1">P1 ${m.p1}</span><span class="prio P2">P2 ${m.crit - m.p1}</span><span>${m.breached} breached · ${m.atRisk} at risk</span>` })}
        ${S.kpiShell({ label: 'Queue risk score', icon: 'bolt', state: toneOf(m.risk), info: html`
              <span>0–100, recomputed from the live queue on every sync.</span>
              ${m.parts.map((p, i) => html`
                <div class="stack" style="gap:3px">
                  <div class="row"><b class="ink">${p.label}</b><span class="muted">× ${p.w}</span><span class="spacer"></span><b class="num">${Math.round(p.w * p.v)} pts</b></div>
                  <div class="meter" style="height:6px"><i style="width:${p.v * 100}%;background:var(--kb-${i + 1})"></i></div>
                  <span class="muted">${[
                    'Breached count fully, at-risk (under 25% SLA left) count 60%.',
                    'Share of open tickets that are P1 or P2.',
                    `Weighted load (P1 = 3, P2 = 2, P3/P4 = 1) vs ${MAX_LOAD_POINTS} points per online analyst.`,
                    'Average time in queue vs an 8-hour ceiling.',
                  ][i]}</span>
                </div>`)}
              <span>Below 35 is low, 35–59 elevated, 60+ high.</span>` }, html`
          <div class="row" style="justify-content:space-between;flex-wrap:nowrap">
            <div class="kpi-v">${m.risk}<small>/100</small></div>
            <span class="pill ${toneOf(m.risk)}">${m.risk >= 60 ? 'High' : m.risk >= 35 ? 'Elevated' : 'Low'}</span>
          </div>
          <div class="meter">${m.parts.map((p, i) => html`<i style="width:${p.w * p.v}%;background:var(--kb-${i + 1})" title="${p.label}: ${Math.round(p.w * p.v)} pts"></i>`)}</div>
          <div class="kpi-foot">Driven by ${m.parts.slice().sort((a, b) => b.w * b.v - a.w * a.v)[0].label.toLowerCase()}</div>`)}
        ${S.kpiShell({ label: 'SLA health average', icon: 'clock', state: slaState, info: html`
              <span><b>Expiration health</b>: the average share of SLA time still left across all open tickets. 100 means every ticket was just opened; 0 means everything has breached.</span>
              <span><b>Ticket age health</b>: share of open tickets younger than half of their SLA window.</span>
              <span>The ring turns amber below 55 and red below 35.</span>` }, html`
          <div class="row" style="flex-wrap:nowrap;gap:14px">
            ${S.ring(m.slaHealth, slaState, 'SLA time remaining')}
            <div class="stack" style="gap:8px;flex:1">
              <div><div class="small ink2">Expiration health</div><b class="num">${Math.round(m.slaHealth * 100)}% SLA time left</b></div>
              <div><div class="small ink2">Ticket age health</div><b class="num">${Math.round(m.ageHealth * 100)}% under half of SLA</b></div>
            </div>
          </div>`)}
        ${S.kpi({ label: 'Analysts online', icon: 'team', tone: 'navy', info: html`<span>Analysts signed in and on shift right now. Only online analysts receive new tickets.</span>`, value: m.online.length, unit: `/ ${state.analysts.length}`,
          foot: html`${state.analysts.filter((a) => a.status === 'leave').length} on leave · ${state.analysts.filter((a) => a.status === 'offline').length} off shift` })}
      </section>

      <section class="grid g-2">
        ${scheduleCard()}
        ${assignmentCard()}
      </section>

      <section class="card">
        <div style="padding:4px 12px 0">${S.tabs(tabs, u.tab, 'home.tab')}</div>
        ${u.tab === 'queue' && queueTable()}
        ${u.tab === 'mine' && myWork()}
        ${u.tab === 'handover' && handover()}
        ${u.tab === 'approvals' && approvals(route.approval)}
      </section>`

    if (drawerTicket) {
      S.drawer({ title: html`<span class="eyebrow">Ticket workspace</span>`, onClose: 'home.closeDrawer', body: S.ticketWorkspace(drawerTicket, { onResolve: 'home.resolve' }) })
    }
    if (u.resolving) S.resolveModal(u.resolving, { onClose: 'home.closeResolve' })
    return body
  }

  // onOpen gets { view, date } from the day cells and shift bars, nothing from "Open schedule".
  function scheduleCard() {
    return S.weekPreview ? S.weekPreview({ onOpen: 'home.schedule' }) : ''
  }

  function assignmentCard() {
    const state = S.state
    const lead = state.role === 'lead'
    const rows = state.analysts
      .filter((a) => a.status !== 'leave')
      .map((a) => ({ a, load: loadOf(a.id, state.tickets), count: state.tickets.filter((t) => t.assignedTo === a.id).length, today: state.stats[a.id]?.today || 0 }))
      .sort((x, y) => (x.a.status === 'online' ? 0 : 1) - (y.a.status === 'online' ? 0 : 1) || y.load - x.load)
    const online = rows.filter((r) => r.a.status === 'online')
    const spread = online.length ? Math.max(...online.map((r) => r.load)) - Math.min(...online.map((r) => r.load)) : 0
    return html`<div class="card" data-tour="assign">
      <div class="card-h">
        <h2>Assigned per online analyst</h2>
        <span class="pill ${spread <= 2 ? 'good' : spread <= 4 ? 'warn' : 'crit'}">${spread <= 2 ? 'Balanced' : 'Uneven'} · spread ${spread} pts</span>
        <span class="spacer"></span>
        ${lead && html`<button class="btn sm" data-tour="rebalance" data-click="home.rebalance">${icon('swap', 14)}Rebalance</button>`}
        ${S.infoTip('home-fairshare', 'Fair-share assignment', html`
          <span>New tickets go to the online analyst with the lowest <b>weighted load</b>: P1 = 3 pts, P2 = 2, P3/P4 = 1, capped at ${MAX_LOAD_POINTS} pts each.</span>
          <span>Ties go to whoever has the fewest tickets assigned today, then whoever has waited longest since their last assignment.</span>
          <span>Offline and on-leave analysts are skipped. <b>Spread</b> is the gap between the highest and lowest load; 2 pts or less counts as balanced.</span>
          ${lead && html`<span>Set someone offline, then use <b>Rebalance</b> to hand their tickets to the rest of the shift.</span>`}`)}
      </div>
      <div class="card-b stack lg">
        <div class="stack" style="gap:10px">
          ${rows.map((r) => html`
            <div class="load-row" style="opacity:${r.a.status === 'online' ? 1 : 0.6}" data-key="${r.a.id}">
              <span class="avatar sm">${initials(r.a.name)}</span>
              <span class="small load-name">${r.a.name}</span>
              <div class="hbar-track load-bar" title="${r.load} load points">
                <div class="hbar-fill" style="width:${(r.load / MAX_LOAD_POINTS) * 100}%;background:${r.load >= MAX_LOAD_POINTS * 0.8 ? 'var(--crit)' : 'var(--s7)'}"></div>
              </div>
              <span class="num small load-open"><b>${r.count}</b> open · ${r.load}p</span>
              <span class="num small muted load-today">${r.today} today</span>
              ${lead
                ? html`<select class="in sm load-status" aria-label="${r.a.name} status" data-change="home.status" data-v="${r.a.id}">
                    ${options([['online', 'Online'], ['offline', 'Offline']], r.a.status)}
                  </select>`
                : html`<span class="pill load-status ${r.a.status === 'online' ? 'good' : 'plain'}">${r.a.status}</span>`}
            </div>`)}
        </div>
      </div>
    </div>`
  }

  function queueTable() {
    const state = S.state
    const me = S.currentUser(state)
    const f = S.ui('p:home:queue', { q: '', prio: 'All', sla: 'All', mine: false })
    const { q, prio: pr, sla, mine } = f
    const rows = state.tickets
      .map((t) => ({ t, s: slaInfo(t, state.now) }))
      .filter(({ t, s }) => (pr === 'All' || t.priority === pr) && (sla === 'All' || s.status === sla) && (!mine || t.assignedTo === me.id) &&
        (!q || `${t.id} ${t.desc} ${byId[t.assignedTo]?.name || ''}`.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => a.s.remaining - b.s.remaining)
    return html`<div>
      <div class="row" style="padding:12px">
        <input id="queue-search" class="in" placeholder="Search ID, description, analyst" value="${q}" data-input="home.qf" data-k="q" style="flex:1;min-width:200px;max-width:360px">
        <select id="queue-prio" class="in" data-change="home.qf" data-k="prio" aria-label="Priority">${options(['All', 'P1', 'P2', 'P3', 'P4'], pr)}</select>
        <select id="queue-sla" class="in" data-change="home.qf" data-k="sla" aria-label="SLA status">${options(['All', 'Breached', 'At risk', 'On track'], sla)}</select>
        <label class="check small"><input type="checkbox" ${attrs({ checked: mine })} data-change="home.qf" data-k="mine">Only mine</label>
        <span class="spacer"></span>
        <span class="muted small">Sorted by SLA time left · ${rows.length} tickets</span>
      </div>
      <div class="tbl-wrap tbl-scroll">
        <table class="tbl">
          <thead><tr>
            <th>Ticket ID</th><th>Description</th><th>Priority</th><th>State</th><th class="r">Total age</th><th class="r">Age in queue</th><th>SLA status</th><th>Assigned at</th><th>Assigned to</th>
          </tr></thead>
          <tbody>
            ${rows.map(({ t, s }) => html`
              <tr class="click" data-click="home.open" data-v="${t.id}" data-key="${t.id}">
                <td class="mono nowrap">${t.id}</td>
                <td class="desc">${t.desc}<div class="muted small">${t.businessApp}</div></td>
                <td>${prio(t.priority)}</td>
                <td data-click="home.noop">
                  <select class="in sm" aria-label="State of ${t.id}" data-change="home.qstate" data-v="${t.id}">
                    ${options(STATES, t.state)}
                  </select>
                </td>
                <td class="r nowrap">${fmtDur(state.now - t.openedAt)}</td>
                <td class="r nowrap">${fmtDur(state.now - t.queuedAt)}</td>
                <td class="nowrap">${slaPill(s.status)}<div class="muted small num">${s.remaining > 0 ? `${fmtDur(s.remaining)} left` : `${fmtDur(-s.remaining)} over`}</div></td>
                <td class="nowrap small">${t.assignedAt ? fmtDateTime(t.assignedAt) : '—'}</td>
                <td class="nowrap" ${attrs({ title: t.assignReason })}>${t.assignedTo ? html`<span class="row tight"><span class="avatar sm">${initials(byId[t.assignedTo].name)}</span>${byId[t.assignedTo].name}</span>` : html`<span class="pill warn">Waiting</span>`}</td>
              </tr>`)}
          </tbody>
        </table>
        ${!rows.length && html`<div class="empty">No tickets match these filters.</div>`}
      </div>
    </div>`
  }

  function myWork() {
    const state = S.state
    const me = S.currentUser(state)
    const mine = state.tickets
      .filter((t) => t.assignedTo === me.id)
      .map((t) => {
        const s = slaInfo(t, state.now)
        const score = PRIORITIES[t.priority].weight * 20 + (1 - s.pct) * 50 + (s.status === 'Breached' ? 30 : 0) - (t.state === 'Awaiting Customer' || t.state === 'On Hold' ? 25 : 0)
        return { t, s, score }
      })
      .sort((a, b) => b.score - a.score)
    const u = S.ui('p:home:mine', () => ({ sel: mine[0]?.t.id }))
    const cur = state.tickets.find((t) => t.id === u.sel) || mine[0]?.t
    if (!mine.length) return html`<div class="empty">Nothing assigned to ${me.name} right now. New tickets arrive automatically when you're online.</div>`
    return html`<div class="grid g-1-2" style="padding:12px;gap:16px">
      <div class="stack">
        <div class="row"><span class="section-title">Prioritised for ${me.name.split(' ')[0]}</span><span class="muted small">priority × SLA urgency</span></div>
        ${mine.map(({ t, s, score }, i) => html`
          <button data-click="home.sel" data-v="${t.id}" data-key="${t.id}" class="qa" style="${style({ borderColor: cur?.id === t.id ? 'var(--accent)' : null, background: cur?.id === t.id ? 'var(--accent-soft)' : null, flexDirection: 'column', gap: 6 })}">
            <div class="row" style="width:100%"><span class="mono small muted">#${i + 1}</span><span class="mono">${t.id}</span>${prio(t.priority)}<span class="spacer"></span>${slaPill(s.status)}</div>
            <div class="small" style="text-align:left">${t.desc}</div>
            <div class="row small muted" style="width:100%"><span>${t.state}</span><span class="spacer"></span><span class="num">${s.remaining > 0 ? `${fmtDur(s.remaining)} left` : `${fmtDur(-s.remaining)} over`}</span><span class="num" title="Priority score">· ${Math.round(score)}</span></div>
          </button>`)}
      </div>
      <div class="card" style="padding:16px">${cur && S.ticketWorkspace(cur, { onResolve: 'home.resolve' })}</div>
    </div>`
  }

  // Everything the handover form shows and copies, from the live state.
  function handoverData() {
    const state = S.state
    const me = S.currentUser(state)
    const f = S.ui('p:home:handover', { notes: '', to: 'a7' })
    const shiftStart = state.now - 8 * HOUR
    const done = state.history.filter((h) => h.resolvedAt >= shiftStart)
    const crit = state.tickets.filter((t) => t.priority === 'P1' || t.priority === 'P2')
    const m = queueMetrics(state.tickets, state.analysts, state.now)
    const byCode = {}
    done.forEach((h) => (byCode[h.code] = (byCode[h.code] || 0) + 1))
    const summary = [
      `Shift handover · ${fmtDateTime(state.now)} · ${me.name} → ${byId[f.to].name}`,
      `Completed: ${done.length} resolved (${Object.entries(byCode).map(([c, n]) => `${c} ×${n}`).join(', ') || 'none'})`,
      `Unresolved critical: ${crit.map((t) => `${t.id} ${t.priority} ${slaInfo(t, state.now).status}`).join('; ') || 'none'}`,
      `Queue: ${m.open.length} open, risk ${m.risk}/100, ${m.breached} breached`,
      f.notes && `Notes: ${f.notes}`,
    ].filter(Boolean).join('\n')
    return { state, me, f, done, crit, m, summary }
  }

  function handover() {
    const { state, me, f, done, crit, m } = handoverData()
    const nextWeek = state.schedule.days.slice(7, 14)
    return html`<div class="stack lg" style="padding:16px">
      <div class="row">
        <span class="small ink2">Covers the last 8 hours. Fields fill in from the queue; add context the next shift needs.</span>
        <span class="spacer"></span>
        <button class="btn ghost sm" data-click="home.handoverLog">Handover history ${icon('arrowR', 14)}</button>
      </div>
      ${m.risk >= 60 && html`<div class="callout crit small">${icon('alert', 16)}Queue risk is high (${m.risk}/100). Call out staffing needs in your notes.</div>`}
      <div class="grid g-kpi" style="grid-template-columns:repeat(auto-fit, minmax(min(100%, 280px), 1fr))">
        <div class="card" style="padding:14px">
          <div class="row"><span class="section-title">Completed this shift</span><span class="spacer"></span><b class="kpi-v" style="font-size:22px">${done.length}</b></div>
          <div class="stack small" style="margin-top:8px">
            ${done.slice(0, 6).map((h) => html`<div class="row" data-key="${h.id}"><span class="mono">${h.id}</span><span class="code-chip">${h.code}</span><span class="muted">${byId[h.analyst]?.name.split(' ')[0]}</span></div>`)}
            ${!done.length && html`<span class="muted">Nothing resolved yet. Resolve a ticket from the queue and it shows up here.</span>`}
          </div>
        </div>
        <div class="card" style="padding:14px">
          <div class="row"><span class="section-title">Unresolved critical incidents</span><span class="spacer"></span><b class="kpi-v" style="${style({ fontSize: 22, color: crit.length ? 'var(--crit)' : null })}">${crit.length}</b></div>
          <div class="stack small" style="margin-top:8px">
            ${crit.map((t) => html`<div class="row" style="flex-wrap:nowrap" data-key="${t.id}">${prio(t.priority)}<span class="mono">${t.id}</span><span class="ink2" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${t.desc}</span>${slaPill(slaInfo(t, state.now).status)}</div>`)}
          </div>
        </div>
        <div class="card" style="padding:14px">
          <div class="section-title">Coverage next week</div>
          <div class="stack small" style="margin-top:8px;gap:4px">
            ${nextWeek.map((d, i) => {
              const idx = i + 7
              const working = state.analysts.filter((a) => SHIFT_CODES[state.schedule.sched[a.id]?.[idx]]?.kind === 'shift').length
              const hol = state.analysts.some((a) => state.schedule.sched[a.id]?.[idx] === 'H')
              const min = i >= 5 ? 2 : 5
              return html`<div class="row"><b style="width:64px">${fmtDay(d)}</b><span class="num">${working} on shift</span>${hol && html`<span class="pill warn">Holiday</span>`}<span class="spacer"></span>${working < min ? html`<span class="pill crit">Below min ${min}</span>` : html`<span class="pill good">OK</span>`}</div>`
            })}
          </div>
        </div>
      </div>
      <div class="form-grid">
        <label class="field"><span>Hand over to</span>
          <select id="ho-to" class="in" data-change="home.ho" data-k="to">${options(state.analysts.filter((a) => a.id !== me.id).map((a) => [a.id, `${a.name} · ${a.shift}`]), f.to)}</select>
        </label>
      </div>
      <label class="field"><span>Notes for the next shift</span><textarea id="ho-notes" class="in" rows="3" data-input="home.ho" data-k="notes" placeholder="Vendor cases open, callbacks owed, monitoring to watch">${f.notes}</textarea></label>
      <div class="row">
        <button class="btn" data-click="home.hoCopy">${icon('copy', 15)}Copy summary</button>
        <span class="spacer"></span>
        <button class="btn primary" data-click="home.hoSubmit">${icon('clip', 15)}Submit handover</button>
      </div>
    </div>`
  }

  function approvals(highlight) {
    const state = S.state
    return html`<div class="tbl-wrap">
      <table class="tbl">
        <thead><tr><th>Request</th><th>Ticket</th><th>Code</th><th>Proposed fix</th><th>Requested by</th><th>When</th><th>Decision</th></tr></thead>
        <tbody>
          ${state.approvals.map((a) => html`
            <tr class="${a.id === highlight ? 'sel' : ''}" data-key="${a.id}">
              <td class="mono">${a.id}</td>
              <td class="mono">${a.ticket}</td>
              <td><span class="code-chip">${a.code}</span></td>
              <td>${a.fix}</td>
              <td class="nowrap">${a.by}</td>
              <td class="nowrap small">${fmtTime(a.at)}</td>
              <td class="nowrap">${a.status === 'Pending'
                ? html`<span class="row tight">
                    <button class="btn primary sm" data-click="home.decide" data-v="${a.id}" data-status="Approved">Approve & run</button>
                    <button class="btn sm" data-click="home.decide" data-v="${a.id}" data-status="Rejected">Reject</button>
                  </span>`
                : html`<span class="pill ${a.status === 'Approved' ? 'good' : 'crit'}">${a.status}</span>`}</td>
            </tr>`)}
        </tbody>
      </table>
      <div class="small muted" style="padding:12px">Automated fixes come from resolution codes marked automatable. Nothing runs until a team lead approves it.</div>
    </div>`
  }

  // ---------- Handlers ----------
  const ticketOf = (id) => S.state.tickets.find((t) => t.id === id)
  S.on({
    'home.tab': (el) => S.set(page(), { tab: el.dataset.v }),
    'home.open': (el) => S.set(page(), { drawer: el.dataset.v }),
    'home.closeDrawer': () => S.set(page(), { drawer: null }),
    // onResolve from the queue, the drawer and My work: el.dataset.v is the ticket id.
    'home.resolve': (el) => { const t = ticketOf(el.dataset.v); if (t) S.set(page(), { resolving: t }) },
    'home.closeResolve': () => {
      const u = page()
      S.set(u, { resolving: null, drawer: u.resolving && u.resolving.id === u.drawer ? null : u.drawer })
    },
    'home.noop': () => {},
    'home.schedule': (el) => {
      const opts = (el.dataset.arg && S.arg(el)) || (el.dataset.view ? { view: el.dataset.view, date: isNaN(+el.dataset.date) ? el.dataset.date : +el.dataset.date } : {})
      S.nav('team', { tab: 'schedule', ...opts })
    },
    'home.rebalance': () => S.dispatch({ type: 'rebalance' }),
    'home.status': (el) => S.dispatch({ type: 'analystStatus', id: el.dataset.v, status: el.value }),
    'home.qf': (el) => S.set(S.ui('p:home:queue'), { [el.dataset.k]: el.type === 'checkbox' ? el.checked : el.value }),
    'home.qstate': (el) => {
      const t = ticketOf(el.dataset.v)
      if (!t) return
      if (el.value === 'Resolved') { el.value = t.state; S.set(page(), { resolving: t }) }
      else S.dispatch({ type: 'setState', id: t.id, state: el.value })
    },
    'home.sel': (el) => S.set(S.ui('p:home:mine'), { sel: el.dataset.v }),
    'home.handoverLog': () => S.nav('explorer', { tab: 'handover' }),
    'home.ho': (el) => S.set(S.ui('p:home:handover'), { [el.dataset.k]: el.value }),
    'home.hoCopy': () => S.copyText(handoverData().summary),
    'home.hoSubmit': () => {
      const { me, f, done, crit } = handoverData()
      S.dispatch({ type: 'submitHandover', handover: { at: Date.now(), shift: `${me.shift} → ${byId[f.to].shift}`, by: me.name, to: byId[f.to].name, resolved: done.length, openCritical: crit.length, notes: f.notes || 'No additional notes.', acknowledged: false } })
      S.set(f, { notes: '' })
    },
    'home.decide': (el) => S.dispatch({ type: 'decideFix', id: el.dataset.v, status: el.dataset.status }),
  })

  S.pages.home = Home
  S.queueMetrics = queueMetrics
})()
