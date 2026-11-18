// Home on real team data (used instead of the prototype's Home once the server and
// roster are there and you're signed in from the roster). Everything comes from the
// shared ops log: the loaded ServiceNow export (queue.js), the Proci rota (rota.js),
// the schedule and sign-ins (schedule.js) and the manual INC entries (S.qm.js).
// Rules shown are the team's own (QueueManager, vault: QueueManager Mechanics): health
// is time since the ticket was last touched, against the SLO/SLA in Team settings.
;(function () {
  const { html, cls, attrs, icon } = S
  // Home is where the team watches the queue: health, loading the ServiceNow export (top
  // right), how tickets are spread (and rebalanced), the week's schedule, and the
  // team-scoped tabs (team queue, handover, verifying manual entries). Your own tickets
  // and entries are on Queue Management.
  // Pages load before S.qm.js, so look S.qm up when used.
  const Q = () => S.queue

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
      unassigned: open.filter((t) => !Q().owner(t)).length,
      imp: Q().importHealth(v, now),
      scheduled: plans.filter((x) => x.pl.ready).length,
      leave: plans.filter((x) => x.pl.role === 'LEAVE').length,
      rest: plans.filter((x) => x.pl.role === 'REST').length,
      nowOn: shift.filter((p) => now < p.w.end).length,
    }
  }

  // ---------- Cards ----------
  // Tickets per person today (the prototype's "Assigned per online analyst" card, on the
  // team's real rule: an even share of tickets handled today, Team Operating Model Q17).
  function assignmentCard(m) {
    const me = S.qm.me()
    const lead = me.accessRole === 'Lead'
    const today = S.rota.today()
    const shift = new Map(m.shift.map((p) => [p.soeid, p]))
    const people = S.qm.roster.filter((p) => p.active !== false)
    const from = new Date(m.now).setHours(0, 0, 0, 0)
    const inPool = new Set(Q().scheduledToday(m.now).map((x) => x.soeid))
    const rows = people.map((p) => {
      const sp = shift.get(p.soeid)
      const pl = S.schedule.planFor(p.soeid, today)
      const l = Q().loadToday(p.soeid, m.now, m.v.tickets)
      const mine = m.v.tickets.filter((t) => Q().owner(t) === p.soeid)
      // Distributed today = tickets that became theirs today; done = those no longer open
      // (tagged Resolved or Transferred, or gone from the ServiceNow export).
      const given = mine.filter((t) => (t.to ? t.assignedAt : t.firstSeen) >= from)
      const done = given.filter((t) => !Q().isOpen(t)).length
      const open = mine.filter(Q().isOpen).length
      // Who shares tickets: everyone scheduled today, signed in or not (lead, 2026-11-19).
      const sched = inPool.has(p.soeid)
      const status = sched ? (sp ? ['good', 'Signed in', true] : ['plain', 'Scheduled · not signed in yet', true])
        : pl.role === 'LEAVE' ? ['plain', 'On leave', false] : pl.role === 'REST' ? ['plain', 'Rest day', false] : ['plain', 'Off today', false]
      return { p, sp, pl, l, assigned: given.length, done, open, status, inPool: status[2] }
    }).filter((r) => r.sp || r.pl.ready || r.open || r.l.total)
      .sort((a, b) => b.inPool - a.inPool || b.l.total - a.l.total || a.p.name.localeCompare(b.p.name))
    const pool = rows.filter((r) => r.inPool)
    const spread = pool.length ? Math.max(...pool.map((r) => r.l.total)) - Math.min(...pool.map((r) => r.l.total)) : 0
    const max = Math.max(1, ...rows.map((r) => r.open))
    const rb = Q().rebalancePreview(m.now)
    const auto = m.v.settings.autoHandout !== false && m.v.settings.autoHandout !== 'false'
    const work = rb.moves.length + (pool.length ? m.unassigned : 0)
    return html`<div class="card">
      <div class="card-h" style="flex-wrap:nowrap">
        <h2 style="white-space:nowrap">Tickets per person</h2>
        ${html`<button class="btn sm" data-click="live.rebalance" ${attrs({ disabled: !work, title: `${spread <= 1 ? 'Balanced' : 'Uneven'}: spread ${spread} (highest minus lowest today, among people getting tickets). ${work ? `${rb.moves.length} to move${m.unassigned && pool.length ? `, ${m.unassigned} to hand out` : ''}` : 'Already even.'}` })}>${icon('swap', 14)}Rebalance${work > 0 && html` <b class="num">${work}</b>`}</button>`}
        <span class="spacer"></span>
        ${S.infoTip('live-fair', 'Equal distribution', html`
          <span>The big number is what each person <b>holds now</b>: every open ticket on them, including ones carried over from earlier days and ones ServiceNow assigned to them. Under the name: how many became theirs <b>today</b> and how many of those are done (Resolved, Transferred or gone from the export). Faded rows aren't getting tickets today (hover a name to see why).</span>
          <span>Tickets are shared equally among <b>everyone scheduled to work today</b> in Team Management (a shift set, not on leave, not a rest day), whether or not they have signed in yet. Each new ticket goes to whoever has <b>the fewest tickets today</b> (assigned + verified manual entries). Ties go to whoever got one least recently.</span>
          <span>${auto ? html`<b>Automatic:</b> new tickets are handed out as soon as they load, so nobody presses a button.` : html`Automatic hand-out is <b>off</b> in Team settings, so use Rebalance or Hand out.`}</span>
          <span><b>EERS</b> tickets go to today's Proci Backup. Tickets ServiceNow already assigned to an active team member count for that person and are never moved.</span>
          <span><b>Evens out by itself:</b> when someone has 2 or more tickets more than someone else today, Scope moves <b>untouched</b> tickets (still Assigned, not updated in ServiceNow since Scope gave them out) to whoever has the fewest. Tickets of people not working today (leave, rest day) move too.</span>
          <span><b>Rebalance</b> (anyone) does the same on demand and can also move tickets that were updated in ServiceNow but are still tagged Assigned. Every move records its reason.</span>`)}
      </div>
      <div class="card-b stack" style="gap:10px">
        ${m.unassigned > 0 && html`<div class="callout warn small">${icon('user', 16)}<span><b>${m.unassigned} waiting.</b> ${pool.length ? (auto ? 'Handing them out…' : 'Rebalance or Hand out to share them.') : Q().waitingReason(m.v, m.now)}</span></div>`}
        ${rows.length ? rows.map((r) => html`<div class="dist-row" style="opacity:${r.inPool ? 1 : 0.55}" data-key="${r.p.soeid}">
            <span class="avatar sm">${S.initials(r.p.name)}</span>
            <span class="small dist-name" title="${r.p.name} · ${r.status[1]}${r.l.manual ? ` · +${r.l.manual} verified manual today` : ''}">${r.p.name}${r.sp && r.sp.duty !== 'ANALYST' ? html` <span class="muted">· ${S.dutyLabel(r.sp.duty)}</span>` : ''}
              <span class="muted dist-sub">+${r.assigned} new today${r.done ? ` · ${r.done} done` : ''}</span></span>
            <div class="dist-bar" title="${r.open} open on ${r.p.name.split(' ')[0]} now">
              <div class="dist-left" style="width:${(r.open / max) * 100}%"></div>
            </div>
            <span class="num dist-frac" title="Open tickets on them now"><b>${r.open}</b><span class="muted small"> open</span></span>
          </div>`) : html`<div class="empty">Nobody is scheduled or signed in today yet.</div>`}
      </div>
    </div>`
  }


  // ---------- Today's schedule ----------
  // One row per active team member: who they are, whether they're signed in, and today's
  // role and shift as tags (from Team Management: the Proci rota and Schedule & coverage).
  const ROLE_TAG = { MAIN_PROCI: ['role-main', 'shield'], PROCI_BACKUP: ['role-backup', 'shield'], WEEKEND_SUPPORT: ['role-weekend', 'cal'], ANALYST: ['', 'user'] }
  const SHIFT_TAG = { EARLY: 'shift-early', LATE: 'shift-late', WEEKEND: 'shift-weekend' }
  function todaySchedule(m) {
    const day = S.rota.today()
    const r = S.rota.dayRoles(day)
    const pres = S.schedule.todayPresence(day)
    const cov = S.schedule.coverage(day)
    const shift = new Map(m.shift.map((p) => [p.soeid, p]))
    const rank = { MAIN_PROCI: 0, PROCI_BACKUP: 1, WEEKEND_SUPPORT: 2, ANALYST: 3 }
    const rows = S.qm.roster.filter((p) => p.active !== false).map((p) => {
      const pl = S.schedule.planFor(p.soeid, day)
      const sp = shift.get(p.soeid)
      const pr = pres.get(p.soeid)
      const role = sp ? sp.duty : pl.role
      const sh = sp ? sp.shift : pl.shift
      const away = !sp && (pl.role === 'LEAVE' || pl.role === 'REST') // signed in = working
      const status = sp && m.now < sp.w.cutoff ? ['online', `Online · in ${S.fmtTime(pr ? pr.firstAt : sp.at)}`]
        : sp ? ['', `Past cutoff · in ${S.fmtTime(pr ? pr.firstAt : sp.at)}`]
        : pl.role === 'LEAVE' ? ['', 'On leave'] : pl.role === 'REST' ? ['', 'Rest day']
        : pl.ready ? ['warn', 'Not signed in yet'] : ['', 'Not scheduled']
      return { p, pl, role, sh, away, status, on: !!sp, working: !!sp || pl.ready }
    }).sort((a, b) => a.away - b.away || (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.p.name.localeCompare(b.p.name))
    // Only who works today: signed in, or scheduled in Team Management. Everyone else
    // (leave, rest day, no shift) is summed up in one line underneath.
    const list = rows.filter((x) => x.working)
    const off = rows.filter((x) => !x.working)
    const roleTag = (x) => {
      if (x.away && x.pl.role === 'LEAVE') return html`<span class="pill">On leave</span>`
      if (x.away) return html`<span class="pill">Rest day</span>`
      if (!x.role) return ''
      const [c, ic] = ROLE_TAG[x.role] || ['', 'user']
      return html`<span class="${cls('pill', c)}">${icon(ic, 12)}${S.dutyLabel(x.role)}</span>`
    }
    const shiftTag = (x) => x.away ? '' : x.sh && x.sh !== 'OFF' ? html`<span class="${cls('pill', SHIFT_TAG[x.sh])}">${S.shiftLabel(x.sh)}</span>`
      : html`<span class="pill warn" title="Set it in Team Management → Schedule & coverage">No shift set</span>`
    return html`<div class="card today-sched">
      <div class="card-h ts-head">
        <h2>Today's schedule</h2>
        <span class="muted small">${list.length} working${list.filter((x) => x.on).length < list.length ? ` · ${list.filter((x) => x.on).length} signed in` : ''}</span>
        <span class="spacer"></span>
        <button class="btn ghost sm nowrap" data-click="live.sched" data-v="${S.rota.mondayOf(day)}">Open schedule ${icon('arrowR', 14)}</button>
      </div>
      <div class="card-b stack" style="gap:10px">
        ${(r.gaps.length > 0 || cov.short.length > 0) && html`<div class="callout warn small">${icon('alert', 15)}<span>${[...r.gaps, ...cov.short.map((x) => `Short on ${x}`)].join(' · ')}. Fix it in Team Management.</span></div>`}
        ${list.length ? html`<ol class="ts-list">${list.map((x) => html`<li class="${cls('ts-row', x.away && 'away')}" data-key="${x.p.soeid}">
            <span class="avatar">${S.initials(x.p.name)}</span>
            <span class="ts-who"><b title="${x.p.name}">${x.p.name}</b><span class="${cls('ts-status small', x.status[0])}">${x.status[1]}</span></span>
            <span class="ts-tags">${roleTag(x)}${shiftTag(x)}</span>
          </li>`)}</ol>` : html`<div class="empty">Nobody is scheduled or signed in today.</div>`}
        ${off.length > 0 && html`<div class="small muted">Off today: ${off.map((x) => `${x.p.name.split(' ')[0]} (${x.pl.role === 'LEAVE' ? 'leave' : x.pl.role === 'REST' ? 'rest day' : 'no shift set'})`).join(', ')}</div>`}
      </div>
    </div>`
  }

  // ---------- Page ----------
  function HomeLive() {
    const me = S.qm.me()
    const lead = me.accessRole === 'Lead'
    const m = metrics()
    const u = S.ui('p:home:tabs', () => ({ tab: ['queue', 'strike', 'handover', 'verify', 'all'].includes(S.route.tab) ? S.route.tab : 'queue' }))
    const tab = !lead && (u.tab === 'verify' || u.tab === 'all') ? 'queue' : u.tab
    S.qm.team.drawers(me)
    Q().importModal(me)
    const healthState = m.sla ? 'crit' : m.slo ? 'warn' : 'good'
    return html`
      <section class="grid g-kpi home-top" aria-label="Queue health">
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
          info: html`<span>Open tickets nobody on the team owns yet. Scope shares them out by itself among everyone <b>scheduled to work today</b> in Team Management, signed in or not. Tickets ServiceNow already assigned to an active team member stay with them.</span>`,
          foot: m.unassigned ? Q().waitingReason(m.v, m.now) : 'Every open ticket has an owner' })}
        ${S.kpi({ label: 'On shift now', icon: 'team', tone: 'navy', value: m.nowOn, unit: `/ ${m.scheduled} scheduled`,
          info: html`<span>Signed in today and before the end of their shift. Scheduled comes from Team Management (rota and shifts).</span>`,
          foot: html`${m.leave} on leave · ${m.rest} resting` })}
      </section>
      <div class="grid g-3-1 home-cols">
      <section class="card team-col" aria-label="Team"><div class="team-fill">
        <div style="padding:4px 12px 0">${S.tabs([
          { id: 'queue', label: 'Team queue', icon: 'list', count: m.open.length },
          { id: 'strike', label: '3-Strike', icon: 'clock', count: S.strike.rows().length },
          { id: 'handover', label: 'Shift handover', icon: 'swap' },
          ...(lead ? [{ id: 'verify', label: 'To verify', icon: 'shield', count: S.qm.team.pending() }, { id: 'all', label: 'All manual entries', icon: 'table' }] : []),
        ], tab, 'live.tab')}</div>
        <div class="team-body">
        ${tab === 'queue' && Q().teamQueue(me)}
        ${tab === 'strike' && S.strike.homeTab(me)}
        ${tab === 'handover' && Q().handover()}
        ${tab === 'verify' && S.qm.team.verify()}
        ${tab === 'all' && html`<div class="card-b">${S.qm.team.all()}</div>`}
        </div>
      </div></section>
      <div class="stack home-side">${todaySchedule(m)}${assignmentCard(m)}</div>
      </div>`
  }

  S.homeLive = HomeLive
  S.on({
    'live.tab': (el) => S.set(S.ui('p:home:tabs'), { tab: el.dataset.v }),
    'live.sched': (el) => { S.nav('team'); S.set(S.ui('p:team'), { tab: 'schedule' }); S.schedule.showWeek(el.dataset.v) },
    'live.rebalance': async () => {
      const r = await Q().rebalance()
      S.dispatch({ type: 'toast', text: r.handed || r.moved ? `Rebalanced: ${[r.handed && `${r.handed} handed out`, r.moved && `${r.moved} moved`].filter(Boolean).join(', ')}` : 'Already even' })
    },
    'live.go': (el) => { S.nav(el.dataset.v); if (el.dataset.t) S.set(S.ui('p:team'), { tab: el.dataset.t }) },
  })
})()
