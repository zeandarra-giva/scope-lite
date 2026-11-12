// Home on real team data (used instead of the prototype's Home once the server and
// roster are there and you're signed in from the roster). Everything comes from the
// shared ops log: the loaded ServiceNow export (queue.js), the Proci rota (rota.js),
// the schedule and sign-ins (schedule.js) and the manual INC entries (S.qm.js).
// Rules shown are the team's own (QueueManager, vault: QueueManager Mechanics): health
// is time since the ticket was last touched, against the SLO/SLA in Team settings.
;(function () {
  const { html, cls, attrs, icon } = S
  // Pages load before S.qm.js, so look S.qm up when used.
  const Q = () => S.queue
  const nameOf = (s) => (s ? (S.qm.roster.find((p) => p.soeid === s) || {}).name || s : '')
  const fmtAgo = (ms) => { const m = Math.round(ms / 60e3); return m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} days` }
  const fmtWhen = (ms) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

  function metrics() {
    const v = Q().view()
    const now = Date.now()
    const open = v.tickets.filter(Q().isOpen)
    const h = open.map((t) => ({ t, h: Q().health(t, v.settings, now) }))
    const today = S.rota.today()
    const people = S.qm.roster.filter((p) => p.active !== false)
    const plans = people.map((p) => ({ p, pl: S.schedule.planFor(p.soeid, today) }))
    const shift = Q().onShift(now)
    return {
      v, now, open, h, plans, shift,
      p1: open.filter((t) => t.p === 1).length, p2: open.filter((t) => t.p === 2).length, eers: open.filter((t) => t.eers).length,
      sla: h.filter((x) => x.h.slaBreached).length, slo: h.filter((x) => x.h.sloBreached && !x.h.slaBreached).length, backlog: h.filter((x) => x.h.backlog).length,
      within: open.length ? h.filter((x) => !x.h.sloBreached).length / open.length : 1,
      unassigned: open.filter((t) => !Q().owner(t) && !t.sn).length,
      imp: Q().importHealth(v, now),
      scheduled: plans.filter((x) => x.pl.ready).length,
      leave: plans.filter((x) => x.pl.role === 'LEAVE').length,
      rest: plans.filter((x) => x.pl.role === 'REST').length,
      nowOn: shift.filter((p) => now < p.w.end).length,
    }
  }

  // ---------- Cards ----------
  function rolesCard(m) {
    const day = S.rota.today()
    const r = S.rota.dayRoles(day)
    const weekend = r.wd >= 5
    const byShift = (id) => m.plans.filter((x) => x.pl.shift === id).map((x) => x.p.name)
    const row = (label, who, extra) => html`<div class="row" style="flex-wrap:nowrap;gap:10px"><span class="muted small" style="width:132px;flex:none">${label}</span>${who ? html`<b>${who}</b>` : html`<span class="pill warn">Not set</span>`}${extra && html`<span class="muted small">${extra}</span>`}</div>`
    return html`<div class="card">
      <div class="card-h"><h2>Today's roles</h2><span class="spacer"></span><button class="btn ghost sm" data-click="live.go" data-v="team" data-t="rota">Proci rota ${icon('arrowR', 14)}</button></div>
      <div class="card-b stack" style="gap:10px">
        ${weekend ? row('Weekend Support', nameOf(r.weekend), 'all BAUs, Early hours') : html`
          ${row('Main Proci', nameOf(r.main), 'Severity Line · INC · CMP · Handover')}
          ${row('Proci Backup', nameOf(r.backup), 'QM · Support Line · EERS')}`}
        ${r.p.p2 && !weekend && row('Backup ×2', nameOf(r.p.p2), 'steps in if the Main Proci is on leave')}
        ${[...r.notes, ...r.gaps.map((g) => `⚠️ ${g}`)].map((n) => html`<div class="callout ${n.startsWith('⚠️') ? 'warn' : 'accent'} small">${n}</div>`)}
        <div class="divider"></div>
        ${weekend ? '' : html`${row('Early shift', byShift('EARLY').join(', ') || '—')}${row('Late shift', byShift('LATE').join(', ') || '—')}`}
        ${m.plans.some((x) => x.pl.role === 'REST') && row('Resting', m.plans.filter((x) => x.pl.role === 'REST').map((x) => x.p.name).join(', '))}
        ${m.leave > 0 && row('On leave', m.plans.filter((x) => x.pl.role === 'LEAVE').map((x) => x.p.name).join(', '))}
        ${m.plans.some((x) => !x.pl.off && !x.pl.shift && x.pl.role !== 'LEAVE' && x.pl.role !== 'REST') && html`<span class="muted small">No shift set for: ${m.plans.filter((x) => !x.pl.off && !x.pl.shift && x.pl.role !== 'LEAVE' && x.pl.role !== 'REST').map((x) => x.p.name).join(', ')} (Team Management → Schedule &amp; coverage)</span>`}
      </div>
    </div>`
  }

  function spreadCard(m) {
    const rows = m.shift.map((p) => {
      const l = Q().loadToday(p.soeid, m.now, m.v.tickets)
      const mine = m.v.tickets.filter((t) => Q().owner(t) === p.soeid)
      return { p, l, open: mine.filter(Q().isOpen).length, eers: mine.filter((t) => t.eers && (t.to ? t.assignedAt : t.firstSeen) >= new Date().setHours(0, 0, 0, 0)).length, cut: m.now >= p.w.cutoff }
    }).sort((a, b) => b.l.total - a.l.total)
    const pool = rows.filter((r) => !r.cut)
    const max = Math.max(1, ...rows.map((r) => r.l.total))
    const spread = pool.length ? Math.max(...pool.map((r) => r.l.total)) - Math.min(...pool.map((r) => r.l.total)) : 0
    return html`<div class="card">
      <div class="card-h"><h2>Tickets per person today</h2>${pool.length > 1 && html`<span class="pill plain" title="Highest minus lowest handled today, among people still getting tickets">Spread ${spread}</span>`}<span class="spacer"></span>
        ${m.unassigned > 0 && html`<button class="btn sm primary" data-click="queue.handout">${icon('send', 14)}Hand out ${m.unassigned}</button>`}
        ${S.infoTip('live-fair', 'How tickets are shared', html`<span>Each ticket goes to whoever has <b>handled the fewest tickets today</b> (tickets that became theirs today + verified manual entries), among people signed in and before their cutoff.</span><span><b>EERS</b> tickets go to today's Proci Backup. Tickets already assigned in ServiceNow count for that person.</span><span>Transferred tickets still count as handled.</span>`)}</div>
      <div class="card-b stack" style="gap:10px">
        ${rows.length ? rows.map((r) => html`<div class="load-row" style="opacity:${r.cut ? 0.6 : 1}" data-key="${r.p.soeid}">
            <span class="avatar sm">${S.initials ? S.initials(r.p.person.name) : ''}</span>
            <span class="small load-name" title="${S.dutyLabel(r.p.duty)}">${r.p.person.name}</span>
            <div class="hbar-track load-bar" title="${r.l.total} handled today"><div class="hbar-fill" style="width:${(r.l.total / max) * 100}%;background:var(--s7)"></div></div>
            <span class="num small load-open" title="${r.l.total} handled today, ${r.open} still open"><b>${r.l.total}</b> · ${r.open} open</span>
            <span class="small muted load-today" title="EERS handed to them today">${r.eers > 0 ? `${r.eers} EERS` : ''}</span>
            <span class="${cls('pill load-status', r.cut ? 'plain' : 'good')}">${r.cut ? 'Past cutoff' : `Until ${S.fmtTime(r.p.w.cutoff)}`}</span>
          </div>`) : html`<div class="empty">Nobody has signed in today yet.</div>`}
      </div>
    </div>`
  }

  // ---------- Tabs ----------
  function queueTab() {
    const v = Q().view()
    const u = S.ui('p:home:live', { show: 'open', q: '' })
    const q = u.q.trim().toLowerCase()
    const list = v.tickets
      .filter((t) => (u.show === 'open' ? Q().isOpen(t) : u.show === 'unassigned' ? Q().isOpen(t) && !Q().owner(t) && !t.sn : u.show === 'breached' ? Q().isOpen(t) && Q().health(t, v.settings).slaBreached : u.show === 'gone' ? !t.inLatest : true))
      .filter((t) => !q || [t.n, t.short, t.group, t.sn, nameOf(Q().owner(t))].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (a.p || 9) - (b.p || 9) || (a.opened || 0) - (b.opened || 0))
    return html`<div class="card-h qm-toolbar">
        <div class="kb-search">${icon('search', 16)}<input type="search" placeholder="Search INC, description, group, owner" value="${u.q}" data-input="live.q" aria-label="Search tickets"></div>
        <select class="in" aria-label="Show" data-change="live.show">${[['open', 'Open'], ['unassigned', 'Unassigned'], ['breached', 'Past SLA'], ['gone', 'Left the queue'], ['all', 'All']].map(([k, l]) => html`<option value="${k}" ${attrs({ selected: u.show === k })}>${l}</option>`)}</select>
        <span class="spacer"></span>
        <button class="btn ghost sm" data-click="queue.goImport">${icon('upload', 14)}Load an export</button>
      </div>
      ${list.length ? Q().ticketTable(list, v.settings) : html`<div class="empty">${v.latest ? 'Nothing matches.' : 'No export loaded yet. Load the ServiceNow export on Queue Management → Team queue.'}</div>`}`
  }

  // A draft from real tickets. The team's actual handover template isn't in Scope yet
  // (vault: Team Operating Model §4), so this is a summary to copy, not the template.
  function handoverText(m) {
    const from = new Date().setHours(0, 0, 0, 0)
    const r = S.rota.dayRoles(S.rota.today())
    const done = m.v.tickets.filter((t) => ['Resolved', 'Transferred'].includes(t.tag) && t.tagAt >= from)
    const crit = m.open.filter((t) => t.p <= 2)
    const breached = m.h.filter((x) => x.h.slaBreached).map((x) => x.t)
    const onHold = m.v.tickets.filter((t) => t.inLatest && t.tag === 'On Hold')
    const notes = S.ui('p:home:ho', { notes: '' }).notes.trim()
    const list = (ts) => ts.map((t) => `${t.n} ${t.priority}${t.short ? ` – ${t.short}` : ''}${Q().owner(t) ? ` (${nameOf(Q().owner(t))})` : ''}`).join('\n  ') || 'none'
    return [
      `Handover · ${new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · Main Proci ${nameOf(r.main) || '—'}`,
      `Open: ${m.open.length} (P1 ${m.p1}, P2 ${m.p2}, EERS ${m.eers}) · unassigned ${m.unassigned} · backlog ${m.backlog}`,
      `Closed today in Scope: ${done.filter((t) => t.tag === 'Resolved').length} resolved, ${done.filter((t) => t.tag === 'Transferred').length} transferred`,
      `P1/P2 still open:\n  ${list(crit)}`,
      `Past SLA:\n  ${list(breached)}`,
      `On Hold (waiting on the user): ${onHold.length}`,
      notes && `Notes: ${notes}`,
      `Data: ServiceNow export loaded ${m.v.latest ? `${fmtAgo(m.now - m.v.latest.at)} ago` : 'not yet'}`,
    ].filter(Boolean).join('\n')
  }
  function handoverTab(m) {
    const f = S.ui('p:home:ho', { notes: '' })
    return html`<div class="stack lg" style="padding:16px">
      <div class="callout warn small">${icon('info', 16)}<span><b>Draft from the live queue.</b> The team's handover template and the partner-site call aren't in Scope yet; copy this into your usual handover message.</span></div>
      <label class="field"><span>Notes for the next shift</span><textarea class="in" rows="3" data-input="live.hoNotes" placeholder="Callbacks owed, vendor cases, anything to watch">${f.notes}</textarea></label>
      <pre class="qm-pre live-ho">${handoverText(m)}</pre>
      <div class="row"><span class="spacer"></span><button class="btn primary" data-click="live.hoCopy">${icon('copy', 15)}Copy summary</button></div>
    </div>`
  }
  function verifyTab() {
    const me = S.qm.me()
    const list = (S.qm.entries || []).filter((x) => x.status === 'Pending' && x.by !== me.soeid).sort((a, b) => a.at - b.at)
    return list.length ? html`<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>INC</th><th>Handled</th><th>Analyst</th><th>Reason</th><th></th></tr></thead>
        <tbody>${list.map((x) => html`<tr data-key="${x.id}"><td class="mono">${x.inc}</td><td class="nowrap">${fmtWhen(x.handledAt)}</td><td>${nameOf(x.by)}</td><td class="qm-clip" title="${x.reason}">${x.reason}</td>
          <td><button class="btn sm" data-click="live.verify" data-v="${x.id}">Review</button></td></tr>`)}</tbody></table></div>`
      : html`<div class="empty">Nothing to verify. All caught up.</div>`
  }

  // ---------- Page ----------
  function HomeLive() {
    const me = S.qm.me()
    const lead = me.accessRole === 'Lead'
    const m = metrics()
    const u = S.ui('p:home:tabs', { tab: 'queue' })
    const pending = (S.qm.entries || []).filter((x) => x.status === 'Pending' && x.by !== me.soeid).length
    const tab = u.tab === 'verify' && !lead ? 'queue' : u.tab
    const tsel = S.ui('p:qm').tsel
    const t = tsel && m.v.tickets.find((x) => x.n === tsel)
    if (t) Q().ticketDrawer(t, me)
    const healthState = m.sla ? 'crit' : m.slo ? 'warn' : 'good'
    return html`
      <section class="grid g-kpi" aria-label="Queue health">
        ${S.kpi({ label: 'Open incidents', icon: 'alert', value: m.open.length, state: m.p1 ? 'crit' : undefined,
          info: html`<span>Open tickets in the latest ServiceNow export that aren't tagged Resolved or Transferred in Scope.</span>`,
          foot: html`<span class="prio P1">P1 ${m.p1}</span><span class="prio P2">P2 ${m.p2}</span><span>${m.eers} EERS</span>` })}
        ${S.kpiShell({ label: 'Queue health', icon: 'clock', state: healthState, info: html`
            <span>Measured on <b>time since the ticket was last touched</b> in ServiceNow, not its total age (the team's QueueManager rule).</span>
            <span><b>SLO</b> ${m.v.settings['inc.sloHours']} h and <b>SLA</b> ${m.v.settings['inc.slaHours']} h for regular INC; EERS ${m.v.settings['eers.sloHours']} h / ${m.v.settings['eers.slaHours']} h. <b>Backlog</b>: untouched since before ${m.v.settings.backlogHour} today. Change them in Team Management → Team settings.</span>` }, html`
          <div class="row" style="flex-wrap:nowrap;gap:14px">
            ${S.ring(m.within, healthState, 'Within SLO')}
            <div class="stack" style="gap:6px;flex:1">
              <div><div class="small ink2">Within SLO</div><b class="num">${Math.round(m.within * 100)}% of open</b></div>
              <div class="small"><b class="num">${m.slo}</b> past SLO · <b class="num">${m.sla}</b> past SLA · <b class="num">${m.backlog}</b> backlog</div>
            </div>
          </div>`)}
        ${S.kpi({ label: 'Waiting for someone', icon: 'user', tone: m.unassigned ? 'warn' : 'good', value: m.unassigned,
          info: html`<span>Open tickets nobody owns yet: no one was on shift before their cutoff when they loaded. Use <b>Hand out</b> once someone signs in.</span>`,
          foot: html`<span class="${cls('pill', m.imp.tone)}">${m.imp.label}</span><span>${m.imp.age == null ? 'no export yet' : `export ${fmtAgo(m.imp.age)} old`}</span>` })}
        ${S.kpi({ label: 'On shift now', icon: 'team', tone: 'navy', value: m.nowOn, unit: `/ ${m.scheduled} scheduled`,
          info: html`<span>Signed in today and before the end of their shift. Scheduled comes from Team Management (rota and shifts).</span>`,
          foot: html`${m.leave} on leave · ${m.rest} resting` })}
      </section>
      <section class="grid g-2">${rolesCard(m)}${spreadCard(m)}</section>
      <section class="card">
        <div style="padding:4px 12px 0">${S.tabs([
          { id: 'queue', label: 'Team queue', count: m.open.length },
          { id: 'handover', label: 'Shift handover' },
          ...(lead ? [{ id: 'verify', label: 'To verify', count: pending }] : []),
        ], tab, 'live.tab')}</div>
        ${tab === 'queue' && queueTab()}
        ${tab === 'handover' && handoverTab(m)}
        ${tab === 'verify' && verifyTab()}
      </section>`
  }

  S.homeLive = HomeLive
  S.on({
    'live.tab': (el) => S.set(S.ui('p:home:tabs'), { tab: el.dataset.v }),
    'live.q': (el) => S.set(S.ui('p:home:live'), { q: el.value }),
    'live.show': (el) => S.set(S.ui('p:home:live'), { show: el.value }),
    'live.hoNotes': (el) => { S.ui('p:home:ho').notes = el.value; S.render() },
    'live.hoCopy': () => { const t = handoverText(metrics()); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => S.dispatch({ type: 'toast', text: 'Handover summary copied' }), () => S.dispatch({ type: 'toast', text: "Couldn't copy; select the text instead" })) },
    'live.verify': (el) => { S.nav('qm'); S.set(S.ui('p:qm'), { tab: 'verify', sel: el.dataset.v }) },
    'live.go': (el) => { S.nav(el.dataset.v); if (el.dataset.t) S.set(S.ui('p:team'), { tab: el.dataset.t }) },
  })
})()
