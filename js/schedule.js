// Real schedule and attendance, from the team roster (replaces the prototype's sample
// Schedule & coverage and Attendance tabs when the server and roster are there).
//
// Who works when, per day:
//  - Role: the Proci rota (rota.js): Main Proci, Proci Backup, Weekend Support, rest, leave.
//  - Shift: a lead sets each person's shift (Early or Late) per week. A week without an
//    entry carries the person's last set shift forward, so a fixed pattern is set once.
//    The weekend is the Weekend Support person only, on Early hours.
// Sign-in uses this to fill in today's role and shift, so nobody picks them by hand.
// Guardrail: once signed in, anyone can change today's role or shift, with a reason;
// the change is recorded (who, when, from → to, why) and shown to the team.
// Attendance is the first sign-in of the day per person, compared with the shift start.
;(function () {
  const { html, cls, attrs, icon } = S
  const qm = S.qm
  const R = () => S.rota
  const nameOf = (soeid) => ((qm.roster.find((p) => p.soeid === soeid) || {}).name || soeid)
  const isLead = (soeid) => ((qm.roster.find((p) => p.soeid === soeid) || {}).accessRole === 'Lead')
  const SHIFT_OPTS = [['EARLY', 'Early'], ['LATE', 'Late']]
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  // ---------- Fold ----------
  let memo = { events: null }
  function fold(events) {
    const plan = new Map() // `${week}|${soeid}` -> shift
    const presence = [] // every shiftStart, in order
    for (const ev of events) {
      const e = ev.e || {}
      if (e.type === 'shiftPlanSet' && isLead(ev.by) && e.week && e.soeid) {
        const k = `${R().mondayOf(e.week)}|${e.soeid}`
        if (e.shift === 'EARLY' || e.shift === 'LATE') plan.set(k, e.shift); else plan.delete(k)
      } else if (e.type === 'shiftStart' && e.day) {
        presence.push({ soeid: ev.by, day: e.day, duty: e.duty, shift: e.shift, at: ev.at, edited: !!e.edited, reason: e.reason || '', auto: !!e.auto })
      }
    }
    return { plan, presence }
  }
  function view() {
    if (memo.events !== qm.events || memo.roster !== qm.roster) memo = { events: qm.events, roster: qm.roster, v: fold(qm.events || []) }
    return memo.v
  }
  const real = () => location.protocol !== 'file:' && !!qm.loadedAt && qm.roster.length > 0

  // The shift a lead set for this person, this week or carried from an earlier week.
  function plannedShift(soeid, day, v = view()) {
    const wk = R().mondayOf(day)
    let best = null; let bestWk = ''
    for (const [k, sh] of v.plan) {
      const [w, s] = k.split('|')
      if (s === soeid && w <= wk && w > bestWk) { best = sh; bestWk = w }
    }
    return best
  }
  // What the schedule says for a person on a day: { role, shift, ready }.
  // role: MAIN_PROCI | PROCI_BACKUP | WEEKEND_SUPPORT | ANALYST | REST | LEAVE | null (rota not set)
  // shift: EARLY | LATE | WEEKEND | OFF | null (not set)
  function planFor(soeid, day = R().today()) {
    const role = R().roleOf(soeid, day)
    const wd = (R().parse(day).getDay() + 6) % 7
    let shift
    if (role === 'LEAVE' || role === 'REST') shift = 'OFF'
    else if (wd >= 5) shift = role === 'WEEKEND_SUPPORT' ? 'WEEKEND' : 'OFF'
    else shift = plannedShift(soeid, day)
    const working = shift && shift !== 'OFF'
    return { role, shift, ready: !!role && !!working, off: shift === 'OFF' }
  }
  // Today's sign-ins: the latest one per person counts (an edit replaces the first).
  function todayPresence(day = R().today()) {
    const m = new Map()
    for (const p of view().presence) {
      if (p.day !== day) continue
      const prev = m.get(p.soeid)
      m.set(p.soeid, { ...p, firstAt: prev ? prev.firstAt : p.at, edits: [...(prev ? prev.edits : []), ...(p.edited ? [p] : [])] })
    }
    return m
  }

  // ---------- Schedule & coverage ----------
  const ui = () => S.ui('p:team:schedreal', () => ({ week: R().mondayOf(R().today()) }))
  const ROLE_CHIP = { MAIN_PROCI: ['Main', 'accent'], PROCI_BACKUP: ['Backup', 'sky'], WEEKEND_SUPPORT: ['Weekend', 'navy'] }
  function cell(p, day) {
    const pl = planFor(p.soeid, day)
    if (pl.role === 'LEAVE') return html`<span class="pill warn">Leave</span>`
    if (pl.role === 'REST') return html`<span class="muted small">Rest</span>`
    if (pl.shift === 'OFF') return html`<span class="muted small">Off</span>`
    const chip = ROLE_CHIP[pl.role]
    return html`<span class="stack" style="gap:2px">${pl.shift ? html`<span class="small">${S.shiftLabel(pl.shift)}</span>` : html`<span class="pill warn" title="No shift set for this person">Shift?</span>`}${chip && html`<span class="${cls('pill', chip[1])}">${chip[0]}</span>`}</span>`
  }
  function schedulePanel() {
    const v = view()
    const me = qm.me()
    const lead = me && me.accessRole === 'Lead'
    const u = ui()
    const days = Array.from({ length: 7 }, (_, i) => R().addDays(u.week, i))
    const people = qm.roster.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name))
    const cover = days.map((d) => {
      const pl = people.map((p) => planFor(p.soeid, d))
      const r = R().dayRoles(d)
      return { early: pl.filter((x) => x.shift === 'EARLY').length, late: pl.filter((x) => x.shift === 'LATE').length, weekend: pl.filter((x) => x.shift === 'WEEKEND').length, unset: pl.filter((x) => x.shift === null && x.role !== 'LEAVE' && x.role !== 'REST').length, gaps: r.gaps }
    })
    return html`<div class="stack" style="gap:16px">
      <div class="callout accent">${icon('cal', 16)}<span><b>The real schedule.</b> Roles come from the <b>Proci rota</b>; ${lead ? 'you set each person\'s shift for the week here' : 'a lead sets each person\'s shift for the week'}. A week left blank keeps the person's last shift. Sign-in fills in today's role and shift from this, and anyone can still change theirs after signing in (with a reason).</span></div>
      <div class="card">
        <div class="card-h">
          <button class="btn ghost sm" data-click="sched.week" data-v="${R().addDays(u.week, -7)}" aria-label="Previous week">${icon('chevL', 15)}</button>
          <b>Week of ${R().fmtDay(u.week, { day: 'numeric', month: 'long', year: 'numeric' })}</b>
          <button class="btn ghost sm" data-click="sched.week" data-v="${R().addDays(u.week, 7)}" aria-label="Next week">${icon('chevR', 15)}</button>
          ${u.week !== R().mondayOf(R().today()) && html`<button class="btn ghost sm" data-click="sched.week" data-v="${R().mondayOf(R().today())}">This week</button>`}
        </div>
        <div class="tbl-wrap tbl-scroll"><table class="tbl sched-real">
          <thead><tr><th>Analyst</th><th>Shift this week</th>${days.map((d, i) => html`<th class="${cls(d === R().today() && 'today')}">${WD[i]} <span class="muted">${R().fmtDay(d, { day: 'numeric' })}</span></th>`)}</tr></thead>
          <tbody>${people.map((p) => { const sh = plannedShift(p.soeid, u.week, v); const own = v.plan.get(`${u.week}|${p.soeid}`); return html`<tr data-key="${p.soeid}">
            <td class="nowrap">${p.name}</td>
            <td>${lead ? html`<select class="in" aria-label="${p.name}'s shift this week" data-change="sched.shift" data-s="${p.soeid}">
                <option value="">${sh && !own ? `${S.shiftLabel(sh)} (carried)` : 'Not set'}</option>
                ${SHIFT_OPTS.map(([k, l]) => html`<option value="${k}" ${attrs({ selected: own === k })}>${l}</option>`)}</select>`
              : sh ? S.shiftLabel(sh) : html`<span class="muted">Not set</span>`}</td>
            ${days.map((d) => html`<td class="${cls(d === R().today() && 'today')}">${cell(p, d)}</td>`)}</tr>` })}</tbody>
          <tfoot><tr><td colspan="2"><b>Coverage</b></td>${cover.map((c, i) => html`<td class="small">${i < 5 ? html`E ${c.early} · L ${c.late}` : html`W ${c.weekend}`}${c.unset > 0 && html`<div class="warn-t">${c.unset} no shift</div>`}${c.gaps.length > 0 && html`<div class="warn-t" title="${c.gaps.join('; ')}">⚠️ ${c.gaps.length} gap${c.gaps.length > 1 ? 's' : ''}</div>`}</td>`)}</tr></tfoot>
        </table></div>
      </div>
      ${R().leaveCard()}
    </div>`
  }

  // ---------- Attendance ----------
  function attendancePanel() {
    const today = R().today()
    const pres = todayPresence(today)
    const s = S.queue ? S.queue.view().settings : {}
    const startOf = (shift) => (shift === 'LATE' ? s['late.start'] : s['early.start']) || '00:00'
    const atTime = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime() }
    const people = qm.roster.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name))
    const rows = people.map((p) => {
      const pl = planFor(p.soeid, today)
      const pr = pres.get(p.soeid)
      const shift = pr ? pr.shift : pl.shift
      const after = pr && shift && shift !== 'OFF' ? Math.round((pr.firstAt - atTime(startOf(shift))) / 60e3) : null
      return { p, pl, pr, shift, after }
    })
    // Last 30 days: days the schedule had them working vs days they signed in, and leave days.
    const days = Array.from({ length: 30 }, (_, i) => R().addDays(today, -i - 1))
    const signed = new Set(view().presence.map((x) => `${x.day}|${x.soeid}`))
    const month = people.map((p) => {
      let sched = 0; let inDays = 0; let leave = 0
      for (const d of days) { const pl = planFor(p.soeid, d); if (pl.role === 'LEAVE') leave++; else if (pl.ready) { sched++; if (signed.has(`${d}|${p.soeid}`)) inDays++ } }
      return { p, sched, inDays, leave, other: [...signed].filter((k) => k.endsWith(`|${p.soeid}`) && days.includes(k.split('|')[0])).length }
    })
    const scheduledToday = rows.filter((r) => r.pl.ready)
    return html`<div class="stack" style="gap:16px">
      <section class="grid g-kpi">
        ${S.kpi({ label: 'Signed in today', icon: 'clock', value: rows.filter((r) => r.pr).length, unit: `/ ${scheduledToday.length} scheduled` })}
        ${S.kpi({ label: 'Not signed in yet', icon: 'user', tone: 'warn', value: scheduledToday.filter((r) => !r.pr).length, foot: 'Scheduled today' })}
        ${S.kpi({ label: 'On leave', icon: 'cal', tone: 'azure', value: rows.filter((r) => r.pl.role === 'LEAVE').length })}
        ${S.kpi({ label: 'Changed today\'s role or shift', icon: 'edit', tone: 'navy', value: rows.filter((r) => r.pr && r.pr.edits.length).length, foot: 'After signing in' })}
      </section>
      <section class="grid g-2">
        <div class="card"><div class="card-h"><b>Today</b><span class="muted small">From sign-ins. Minutes after the shift start are shown, not judged.</span></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Analyst</th><th>Scheduled</th><th>Signed in</th><th>Today as</th></tr></thead>
            <tbody>${rows.map((r) => html`<tr data-key="${r.p.soeid}">
              <td class="nowrap">${r.p.name}</td>
              <td class="small">${r.pl.role === 'LEAVE' ? 'Leave' : r.pl.role === 'REST' ? 'Rest day' : r.pl.off ? 'Off' : html`${r.pl.shift ? S.shiftLabel(r.pl.shift) : 'Shift not set'}${r.pl.role && r.pl.role !== 'ANALYST' ? ` · ${S.dutyLabel(r.pl.role)}` : ''}`}</td>
              <td class="nowrap">${r.pr ? html`<span class="mono">${S.fmtTime(r.pr.firstAt)}</span>${r.after != null && html` <span class="muted small">${r.after <= 0 ? 'before start' : `${r.after} min after start`}</span>`}` : html`<span class="muted">—</span>`}</td>
              <td class="small">${r.pr ? html`${S.dutyLabel(r.pr.duty)} · ${S.shiftLabel(r.pr.shift)}${r.pr.edits.length > 0 && html` <span class="pill warn" title="${r.pr.edits.map((e) => `${S.fmtTime(e.at)}: ${e.reason}`).join('\n')}">Changed: ${r.pr.edits[r.pr.edits.length - 1].reason}</span>`}` : ''}</td></tr>`)}</tbody>
          </table></div></div>
        <div class="card"><div class="card-h"><b>Last 30 days</b><span class="muted small">Days scheduled vs days signed in</span></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Analyst</th><th class="r">Scheduled</th><th class="r">Signed in</th><th class="r">Leave days</th></tr></thead>
            <tbody>${month.map((m) => html`<tr data-key="${m.p.soeid}"><td class="nowrap">${m.p.name}</td><td class="r">${m.sched}</td><td class="r">${m.inDays}${m.other > m.inDays && html` <span class="muted small" title="Signed in on days not scheduled">+${m.other - m.inDays}</span>`}</td><td class="r">${m.leave}</td></tr>`)}</tbody>
          </table></div></div>
      </section>
    </div>`
  }

  // ---------- Guardrail: change today's role or shift after signing in ----------
  const edit = () => S.ui('schedEdit', () => ({ open: false, duty: null, shift: null, reason: '', tried: false }))
  function editModal() {
    const u = edit()
    if (!u.open) return ''
    const m = qm.me()
    const t = qm.today() || {}
    const pl = m ? planFor(m.soeid) : {}
    const same = u.duty === t.duty && u.shift === t.shift
    return S.modal({
      title: "Change today's role or shift",
      sub: html`<span class="muted small">Scheduled: ${pl.role && pl.role !== 'ANALYST' ? S.dutyLabel(pl.role) : 'Analyst'} · ${pl.shift && pl.shift !== 'OFF' ? S.shiftLabel(pl.shift) : 'not set'}. The change is recorded with your reason and shown to the team.</span>`,
      onClose: 'sched.editClose',
      body: html`<div class="stack" style="gap:12px">
        <div class="stack" style="gap:6px"><span class="eyebrow">Role today</span><div class="row tight" role="radiogroup">${S.DUTIES.map((d) => html`<button class="${cls('btn sm', u.duty === d.id && 'primary')}" role="radio" aria-checked="${u.duty === d.id}" data-click="sched.editDuty" data-v="${d.id}">${d.label}</button>`)}</div></div>
        <div class="stack" style="gap:6px"><span class="eyebrow">Shift today</span><div class="row tight" role="radiogroup">${S.SHIFTS.map((s) => html`<button class="${cls('btn sm', u.shift === s.id && 'primary')}" role="radio" aria-checked="${u.shift === s.id}" data-click="sched.editShift" data-v="${s.id}">${s.label} <span class="muted small">${s.times}</span></button>`)}</div></div>
        <label class="field"><span>Reason <span class="hint">required</span></span><input class="in" maxlength="200" value="${u.reason}" placeholder="e.g. swapped with Cal, covering a colleague" data-input="sched.editReason"></label>
        ${u.tried && !u.reason.trim() && html`<span class="qm-err" role="alert">Say why, so the team knows.</span>`}
      </div>`,
      footer: html`<button class="btn" data-click="sched.editClose">Cancel</button><button class="btn primary" data-click="sched.editSave" ${attrs({ disabled: same })}>Save change</button>`,
    })
  }

  // ---------- Roster & access (real) ----------
  // data/roster.json on the host is the source; Scope reads it, it doesn't edit it.
  function rosterPanel() {
    const me = qm.me()
    const lead = me && me.accessRole === 'Lead'
    const today = R().today()
    const pres = todayPresence(today)
    const Qv = S.queue ? S.queue.view() : { tickets: [] }
    const all = qm.roster.slice().sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name))
    const active = all.filter((p) => p.active !== false)
    return html`<div class="stack" style="gap:16px">
      <section class="grid g-kpi">
        ${S.kpi({ label: 'Active people', icon: 'team', value: active.length, foot: `${active.filter((p) => p.accessRole === 'Lead').length} leads · ${all.length - active.length} inactive` })}
        ${S.kpi({ label: 'Signed in today', icon: 'clock', tone: 'good', value: pres.size })}
        ${S.kpi({ label: 'On leave today', icon: 'cal', tone: 'azure', value: active.filter((p) => planFor(p.soeid, today).role === 'LEAVE').length })}
        ${S.kpi({ label: 'Open tickets on people', icon: 'alert', tone: 'navy', value: Qv.tickets.filter((t) => S.queue.isOpen(t) && S.queue.owner(t)).length })}
      </section>
      <div class="card">
        <div class="card-h"><h3>Team roster</h3><span class="muted small">From <span class="code-chip">data\roster.json</span> on the host${lead ? '. To add someone, change an access role or mark a leaver, edit that file and reload.' : ''}</span></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Name</th><th>SOEID</th><th>Access</th><th>Today</th><th>Signed in</th><th class="r">Handled today</th><th class="r">Open now</th></tr></thead>
          <tbody>${all.map((p) => { const pl = planFor(p.soeid, today); const pr = pres.get(p.soeid); const l = S.queue ? S.queue.loadToday(p.soeid) : { total: 0 }; return html`<tr data-key="${p.soeid}" class="${cls(p.active === false && 'muted')}">
            <td class="nowrap">${p.name}${p.active === false && html` <span class="pill">Inactive</span>`}</td>
            <td class="mono small">${p.soeid}</td>
            <td><span class="${cls('pill', p.accessRole === 'Lead' && 'accent')}">${p.accessRole === 'Lead' ? 'Lead' : 'Analyst'}</span></td>
            <td class="small">${p.active === false ? '—' : pl.role === 'LEAVE' ? 'On leave' : pl.role === 'REST' ? 'Rest day' : pl.off ? 'Off' : html`${pl.shift ? S.shiftLabel(pl.shift) : 'Shift not set'}${pl.role && pl.role !== 'ANALYST' ? ` · ${S.dutyLabel(pl.role)}` : ''}`}</td>
            <td class="nowrap small">${pr ? html`<span class="mono">${S.fmtTime(pr.firstAt)}</span>` : html`<span class="muted">—</span>`}</td>
            <td class="r">${l.total}</td>
            <td class="r">${Qv.tickets.filter((t) => S.queue.isOpen(t) && S.queue.owner(t) === p.soeid).length}</td></tr>` })}</tbody>
        </table></div>
      </div>
    </div>`
  }

  S.schedule = { rosterPanel, real, planFor, plannedShift, todayPresence, schedulePanel, attendancePanel, editModal, _test: { fold } }

  S.on({
    'sched.week': (el) => S.set(ui(), { week: el.dataset.v }),
    'sched.shift': async (el) => {
      if (await qm.send({ type: 'shiftPlanSet', week: ui().week, soeid: el.dataset.s, shift: el.value || null })) S.dispatch({ type: 'toast', text: `${nameOf(el.dataset.s)}: ${el.value ? S.shiftLabel(el.value) : 'shift cleared'} for this week` })
    },
    'sched.editOpen': () => { S.pop = null; const t = qm.today() || {}; S.set(edit(), { open: true, duty: t.duty || 'ANALYST', shift: t.shift || 'EARLY', reason: '', tried: false }) },
    'sched.editClose': () => S.set(edit(), { open: false }),
    'sched.editDuty': (el) => S.set(edit(), { duty: el.dataset.v }),
    'sched.editShift': (el) => S.set(edit(), { shift: el.dataset.v }),
    'sched.editReason': (el) => { const u = edit(); const was = !!u.reason.trim(); u.reason = el.value; if (was !== !!el.value.trim() && u.tried) S.render() },
    'sched.editSave': async () => {
      const u = edit()
      if (!u.reason.trim()) { S.set(u, { tried: true }); return }
      if (await qm.changeToday(u.duty, u.shift, u.reason.trim())) { S.set(u, { open: false }); S.dispatch({ type: 'toast', text: `Today: ${S.dutyLabel(u.duty)} · ${S.shiftLabel(u.shift)}` }) }
    },
  })
})()
