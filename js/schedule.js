// Real schedule and attendance, from the team roster (replaces the prototype's sample
// Schedule & coverage and Attendance tabs when the server and roster are there).
//
// Who works when, per day:
//  - Role: the Proci rota (rota.js): Main Proci, Proci Backup, Weekend Support, rest, leave.
//  - Shift: by default Scope plans each weekday so the team's minimums are met (Team
//    settings: at least 2 on Early and 1 on Late, lead 2026-11-13): one person rotates
//    onto Late each day, everyone else is Early. A lead can set a person's shift for a
//    week (carried forward), and anyone can change their own shift for any single day
//    (shiftDaySet); a lead can change anyone's. A day entry wins over the week's shift,
//    which wins over the default. Changes that break the minimums are refused for
//    analysts (a lead can still make them; the day then shows as short).
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
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  // ---------- Fold ----------
  let memo = { events: null }
  function fold(events) {
    const plan = new Map() // `${week}|${soeid}` -> shift
    const dayPlan = new Map() // `${day}|${soeid}` -> shift, one day only
    const presence = [] // every shiftStart, in order
    for (const ev of events) {
      const e = ev.e || {}
      if (e.type === 'shiftPlanSet' && isLead(ev.by) && e.week && e.soeid) {
        const k = `${R().mondayOf(e.week)}|${e.soeid}`
        if (e.shift === 'EARLY' || e.shift === 'LATE') plan.set(k, e.shift); else plan.delete(k)
      } else if (e.type === 'shiftDaySet' && (isLead(ev.by) || ev.by === e.soeid) && /^\d{4}-\d{2}-\d{2}$/.test(e.day || '') && e.soeid) {
        const k = `${e.day}|${e.soeid}`
        if (e.shift === 'EARLY' || e.shift === 'LATE') dayPlan.set(k, e.shift); else dayPlan.delete(k)
      } else if (e.type === 'shiftStart' && e.day) {
        presence.push({ soeid: ev.by, day: e.day, duty: e.duty, shift: e.shift, at: ev.at, edited: !!e.edited, reason: e.reason || '', auto: !!e.auto })
      }
    }
    return { plan, dayPlan, presence, defaults: new Map() }
  }
  const mins = () => { const st = S.queue ? S.queue.view().settings : {}; return { early: Number(st.minEarly ?? 2), late: Number(st.minLate ?? 1) } }
  // The default shifts for a weekday: whoever has no shift set is Early, except that
  // enough of them go Late to reach the Late minimum without dropping Early below its
  // own. Who goes Late rotates by day, in roster order, so it's shared out.
  function defaultShifts(day, v = view()) {
    if (v.defaults.has(day)) return v.defaults.get(day)
    const out = new Map()
    const wd = (R().parse(day).getDay() + 6) % 7
    if (wd < 5) {
      const working = qm.roster.filter((p) => p.active !== false && !['LEAVE', 'REST'].includes(R().roleOf(p.soeid, day)))
      const set = (p) => v.dayPlan.get(`${day}|${p.soeid}`) || plannedShift(p.soeid, day, v)
      const free = working.filter((p) => !set(p))
      const E = working.filter((p) => set(p) === 'EARLY').length
      const L = working.filter((p) => set(p) === 'LATE').length
      const m = mins()
      const late = Math.max(0, Math.min(m.late - L, free.length - Math.max(0, m.early - E)))
      const start = free.length ? Math.round(R().parse(day).getTime() / 864e5) % free.length : 0
      free.forEach((p, i) => out.set(p.soeid, ((i - start + free.length) % free.length) < late ? 'LATE' : 'EARLY'))
    }
    v.defaults.set(day, out)
    return out
  }
  // How a weekday stands against the minimums.
  function coverage(day) {
    const wd = (R().parse(day).getDay() + 6) % 7
    if (wd >= 5) return { early: 0, late: 0, short: [] }
    const pls = qm.roster.filter((p) => p.active !== false).map((p) => planFor(p.soeid, day))
    const e = pls.filter((x) => x.shift === 'EARLY').length
    const l = pls.filter((x) => x.shift === 'LATE').length
    const m = mins()
    return { early: e, late: l, short: [e < m.early && `Early ${e}/${m.early}`, l < m.late && `Late ${l}/${m.late}`].filter(Boolean) }
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
    else shift = view().dayPlan.get(`${day}|${soeid}`) || plannedShift(soeid, day) || defaultShifts(day).get(soeid) || null
    const auto = !view().dayPlan.has(`${day}|${soeid}`) && !plannedShift(soeid, day) && wd < 5 && !!shift && shift !== 'OFF'
    const working = shift && shift !== 'OFF'
    return { role, shift, ready: !!role && !!working, off: shift === 'OFF', oneDay: view().dayPlan.has(`${day}|${soeid}`), auto }
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
  // Every person × day is a cell. One-click mode: pick a brush (Early, Late, Leave,
  // Clear), then each click on a cell applies it. The "Week" column sets the shift for
  // the whole week (carried forward); a day cell sets that day only.
  const ui = () => S.ui('p:team:schedreal', () => ({ week: R().mondayOf(R().today()), brush: null }))
  const showWeek = (wk) => S.set(ui(), { week: wk })
  const ROLE_CHIP = { MAIN_PROCI: ['Main', 'accent'], PROCI_BACKUP: ['Backup', 'sky'], WEEKEND_SUPPORT: ['Weekend', 'navy'] }
  const BRUSHES = [
    { id: 'EARLY', label: 'Early', sw: 'E' },
    { id: 'LATE', label: 'Late', sw: 'L' },
    { id: 'LEAVE', label: 'Leave', sw: 'PL' },
    { id: 'CLEAR', label: 'Clear', ic: 'x' },
  ]
  const brushLabel = (id) => (BRUSHES.find((b) => b.id === id) || {}).label || id
  const isWeekendDay = (day) => (R().parse(day).getDay() + 6) % 7 >= 5

  function canPaint(brush, soeid, day, lead) {
    if (!brush) return false
    if (brush === 'LEAVE') return R().canLeave(soeid)
    if (brush === 'CLEAR') return lead || (R().onLeave(soeid, day) && R().canLeave(soeid))
    // Shifts: a lead for anyone, everyone else for their own days.
    return (lead || (qm.me() && qm.me().soeid === soeid)) && !isWeekendDay(day)
  }
  function cellBody(pl) {
    if (pl.role === 'LEAVE') return html`<span class="ev PL sc-chip">Leave</span>`
    if (pl.role === 'REST') return html`<span class="sc-chip off">Rest</span>`
    if (pl.shift === 'OFF') return html`<span class="sc-chip off">Off</span>`
    if (pl.shift === 'WEEKEND') return html`<span class="ev W sc-chip">Weekend</span>`
    const chip = ROLE_CHIP[pl.role]
    return html`${pl.shift
      ? html`<span class="${cls('ev sc-chip', pl.shift === 'EARLY' ? 'E' : 'L')}" title="${pl.oneDay ? 'Set for this day only' : pl.auto ? 'Default (meets the Early and Late minimums)' : 'From the week\'s shift'}">${S.shiftLabel(pl.shift)}${pl.oneDay && html`<i class="sc-dot" aria-label="this day only"></i>`}</span>`
      : html`<span class="sc-chip unset" title="No shift set for this person">Shift?</span>`}
      ${chip && html`<span class="${cls('pill', chip[1])}">${chip[0]}</span>`}`
  }
  function cell(p, day, brush, lead) {
    const pl = planFor(p.soeid, day)
    const today = day === R().today()
    const what = pl.role === 'LEAVE' ? 'on leave' : pl.role === 'REST' ? 'rest day' : pl.shift === 'OFF' ? 'off' : pl.shift ? S.shiftLabel(pl.shift) : 'no shift set'
    if (!canPaint(brush, p.soeid, day, lead)) return html`<td class="${cls('sc-td', today && 'today')}"><div class="sc-cell ro">${cellBody(pl)}</div></td>`
    return html`<td class="${cls('sc-td', today && 'today')}"><button class="sc-cell" data-click="sched.paint" data-s="${p.soeid}" data-d="${day}"
      aria-label="${p.name}, ${R().fmtDay(day)}: ${what}. Click to set ${brushLabel(brush)}">${cellBody(pl)}</button></td>`
  }
  function weekCell(p, v, lead, brush) {
    const u = ui()
    const sh = plannedShift(p.soeid, u.week, v)
    const own = v.plan.get(`${u.week}|${p.soeid}`)
    const body = sh ? html`<span class="${cls('ev sc-chip', sh === 'EARLY' ? 'E' : 'L')}">${S.shiftLabel(sh)}</span>${!own && html`<span class="muted small">carried</span>`}` : html`<span class="sc-chip unset">Not set</span>`
    if (!(lead && ['EARLY', 'LATE', 'CLEAR'].includes(brush))) return html`<td class="sc-td sc-wk"><div class="sc-cell ro">${body}</div></td>`
    return html`<td class="sc-td sc-wk"><button class="sc-cell" data-click="sched.paintWeek" data-s="${p.soeid}"
      aria-label="${p.name}, whole week: ${sh ? S.shiftLabel(sh) : 'not set'}. Click to set ${brush === 'CLEAR' ? 'back to the carried shift' : brushLabel(brush)} for the week">${body}</button></td>`
  }

  function schedulePanel() {
    const v = view()
    const me = qm.me()
    const lead = me && me.accessRole === 'Lead'
    const u = ui()
    const brush = u.brush
    const days = Array.from({ length: 7 }, (_, i) => R().addDays(u.week, i))
    // Rows: the Proci queue in order (drag to reorder), then anyone not in it.
    const st = R().pqState()
    const active = qm.roster.filter((p) => p.active !== false)
    const inQ = st.order.map((s) => active.find((p) => p.soeid === s)).filter(Boolean)
    const outQ = active.filter((p) => !st.order.includes(p.soeid)).sort((a, b) => a.name.localeCompare(b.name))
    const people = [...inQ, ...outQ]
    const qu = st.u
    const nowP = R().procOf(st.thisWeek)
    const nameCell = (p, i) => {
      const inQueue = i >= 0
      const wk = inQueue ? R().nextProciWeek(p.soeid, st) : null
      return html`<td class="sc-name"><div class="row tight" style="flex-wrap:nowrap">
        ${inQueue && lead && html`<span class="pq-grip" title="Drag to change the Proci order" aria-hidden="true">⋮⋮</span>`}
        ${inQueue && html`<span class="pq-n">${i + 1}</span>`}
        <span class="stack" style="gap:1px;min-width:0">
          <span class="nowrap">${p.name}${me && p.soeid === me.soeid && html` <span class="muted small">(you)</span>`}</span>
          ${inQueue ? html`<span class="small muted nowrap">${nowP === p.soeid ? html`<span class="pill W-pill">Proci this week</span> · ` : ''}Proci wk of ${R().fmtDay(wk, { day: 'numeric', month: 'short' })}</span>` : html`<span class="small muted">Not in the Proci queue</span>`}
        </span>
        <span class="spacer"></span>
        ${lead && (inQueue ? html`<span class="pq-act">
            <button class="pq-btn" data-click="rota.qMove" data-v="${p.soeid}" data-d="-1" aria-label="Move ${p.name} earlier in the Proci order" ${attrs({ disabled: i === 0 })}>${icon('chevUp', 13)}</button>
            <button class="pq-btn" data-click="rota.qMove" data-v="${p.soeid}" data-d="1" aria-label="Move ${p.name} later in the Proci order" ${attrs({ disabled: i === inQ.length - 1 })}>${icon('chevDown', 13)}</button>
            <button class="pq-btn" data-click="rota.qRemove" data-v="${p.soeid}" aria-label="Take ${p.name} out of the Proci queue">${icon('x', 13)}</button></span>`
          : html`<button class="btn ghost sm" data-click="rota.qAdd" data-v="${p.soeid}">${icon('plus', 12)}Add to queue</button>`)}
      </div></td>`
    }
    const cover = days.map((d) => {
      const pl = people.map((p) => planFor(p.soeid, d))
      const r = R().dayRoles(d)
      return { early: pl.filter((x) => x.shift === 'EARLY').length, late: pl.filter((x) => x.shift === 'LATE').length, weekend: pl.filter((x) => x.shift === 'WEEKEND').length, unset: pl.filter((x) => x.shift === null && x.role !== 'LEAVE' && x.role !== 'REST').length, gaps: r.gaps, notes: r.notes }
    })
    const brushes = BRUSHES.filter((b) => lead || !b.lead)
    const hint = !brush ? (lead ? 'Pick a brush, then click cells to set shifts or leave in one click.' : 'Pick Early, Late or Leave, then click your own days. Each day needs at least the Early and Late minimums.')
      : brush === 'LEAVE' ? `Click a day to put ${lead ? 'someone' : 'yourself'} on leave.`
        : brush === 'CLEAR' ? 'Click a day to remove its leave or its one-day shift; click the Week column to go back to the carried shift.'
          : `Click a day to make it ${brushLabel(brush)} for that day only, or the Week column for the whole week.`
    // The month calendar (roles, leave, coverage) is the main view; the week's shift grid,
    // whose rows are the Proci queue, sits under it. Gaps and changes go to the bell.
    return html`<div class="stack" style="gap:16px">
      ${R().rotaCalendar()}
      <div class="card" id="sched-grid">
        <div class="card-h">
          <button class="btn ghost sm" data-click="sched.week" data-v="${R().addDays(u.week, -7)}" aria-label="Previous week">${icon('chevL', 15)}</button>
          <b>Week of ${R().fmtDay(u.week, { day: 'numeric', month: 'long', year: 'numeric' })}</b>
          <button class="btn ghost sm" data-click="sched.week" data-v="${R().addDays(u.week, 7)}" aria-label="Next week">${icon('chevR', 15)}</button>
          ${u.week !== R().mondayOf(R().today()) && html`<button class="btn ghost sm" data-click="sched.week" data-v="${R().mondayOf(R().today())}">This week</button>`}
          <span class="spacer"></span>
          <span class="muted small">Proci <b>${R().procOf(u.week) ? nameOf(R().procOf(u.week)) : 'not set'}</b></span>
        </div>
        <div class="card-b stack" style="gap:10px">
          <div class="brush-bar" role="radiogroup" aria-label="One-click brush">
            <span class="eyebrow">One-click</span>
            <button class="${cls('brush', !brush && 'on')}" role="radio" aria-checked="${!brush}" data-click="sched.brush" data-v="">${icon('eye', 13)}View</button>
            ${brushes.map((b) => html`<button class="${cls('brush', brush === b.id && 'on')}" role="radio" aria-checked="${brush === b.id}" data-click="sched.brush" data-v="${b.id}">${b.sw ? html`<i class="ev-sw ${b.sw}"></i>` : icon(b.ic, 13)}${b.label}</button>`)}
          </div>
          <span class="small ${brush ? 'ink2' : 'muted'}">${icon('bolt', 13)} ${hint}</span>
          ${R().pqControls(st)}
        </div>
        <div class="tbl-wrap tbl-scroll"><table class="${cls('tbl sched-real', brush && 'painting')}">
          <thead><tr><th>Analyst</th><th>Week</th>${days.map((d, i) => html`<th class="${cls(d === R().today() && 'today')}">${WD[i]} <span class="muted">${R().fmtDay(d, { day: 'numeric' })}</span></th>`)}</tr></thead>
          <tbody>${inQ.map((p, i) => html`<tr data-key="${p.soeid}" class="${cls('pq-tr', qu.drag === p.soeid && 'dragging', qu.over === p.soeid && qu.drag && qu.drag !== p.soeid && 'over', nowP === p.soeid && 'now')}"
              ${attrs({ draggable: lead ? 'true' : null })} data-v="${p.soeid}" data-dragstart="rota.qDragStart" data-dragover="rota.qDragOver" data-drop="rota.qDrop" data-dragend="rota.qDragEnd">
            ${nameCell(p, i)}
            ${weekCell(p, v, lead, brush)}
            ${days.map((d) => cell(p, d, brush, lead))}</tr>`)}
            ${outQ.length > 0 && inQ.length > 0 && html`<tr class="pq-sep"><td colspan="${days.length + 2}">Not in the Proci queue</td></tr>`}
            ${outQ.map((p) => html`<tr data-key="${p.soeid}">${nameCell(p, -1)}${weekCell(p, v, lead, brush)}${days.map((d) => cell(p, d, brush, lead))}</tr>`)}</tbody>
          <tfoot><tr><td colspan="2"><b>Coverage</b></td>${cover.map((c, i) => html`<td class="small">${i < 5 ? html`E ${c.early} · L ${c.late}` : html`W ${c.weekend}`}${c.unset > 0 && html`<div class="warn-t">${c.unset} no shift</div>`}${c.gaps.length > 0 && html`<div class="warn-t" title="${c.gaps.join('; ')}">⚠️ ${c.gaps.length} gap${c.gaps.length > 1 ? 's' : ''}</div>`}</td>`)}</tr></tfoot>
        </table></div>
      </div>
      ${R().leaveCard()}
    </div>`
  }

  // ---------- Home: Schedule this week (the prototype's week preview, on real data) ----------
  // Read-only. Proci and leave bars come from the rota; each day shows how many work and
  // the Early/Late split. A day is "short" when the rota has a gap or someone has no shift.
  const PREVIEW_LANES = 2
  const ini = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  function weekPreview() {
    const today = R().today()
    const wk = R().mondayOf(today)
    const rv = R().view()
    const days = Array.from({ length: 7 }, (_, i) => R().addDays(wk, i))
    const people = qm.roster.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name))
    const me = qm.me()
    const info = days.map((d) => {
      const pl = people.map((p) => ({ p, pl: planFor(p.soeid, d) }))
      const r = R().dayRoles(d)
      const n = (sh) => pl.filter((x) => x.pl.shift === sh).length
      const unset = pl.filter((x) => x.pl.shift === null && x.pl.role !== 'LEAVE' && x.pl.role !== 'REST').length
      return { d, r, pl, e: n('EARLY'), l: n('LATE'), w: n('WEEKEND'), unset, ok: !r.gaps.length && !unset && !coverage(d).short.length }
    })
    const short = info.filter((x) => !x.ok).length
    const t = info.find((x) => x.d === today)
    const pres = todayPresence(today)
    const who = (f) => t.pl.filter(f).map((x) => x.p)
    const groups = [
      ['Signed in', people.filter((p) => pres.has(p.soeid)), 'E'],
      ...(t.r.wd >= 5 ? [['Weekend', who((x) => x.pl.shift === 'WEEKEND'), 'W']] : [['Early', who((x) => x.pl.shift === 'EARLY'), 'M'], ['Late', who((x) => x.pl.shift === 'LATE'), 'L']]),
      ['On leave', who((x) => x.pl.role === 'LEAVE'), 'PL'],
    ]
    const detail = (p) => { const pl = planFor(p.soeid, today); const pr = pres.get(p.soeid); return [pl.role && !['ANALYST', 'LEAVE'].includes(pl.role) ? S.dutyLabel(pl.role) : '', pl.shift && pl.shift !== 'OFF' ? S.shiftLabel(pl.shift) : '', pr ? `in ${S.fmtTime(pr.firstAt)}` : ''].filter(Boolean).join(' · ') }
    const open = S.pop === 'cal-today'
    const bars = R().leaveBars(wk, rv)
    const lanes = Math.min(PREVIEW_LANES, Math.max(0, ...bars.map((b) => b.lane + 1)))
    const hidden = days.map((_, i) => bars.filter((b) => b.lane >= PREVIEW_LANES && i >= b.start && i < b.start + b.span).length)
    const P = R().procOf(wk)
    const role = (label, s) => html`<span class="today-chip">${label} <b>${s ? nameOf(s) : '—'}</b></span>`
    return html`<div class="card cal cal-preview">
      <div class="cal-head">
        <div class="stack" style="gap:2px"><h2>Schedule this week</h2><span class="muted small">${R().fmtDay(days[0], { month: 'short', day: 'numeric' })} – ${R().fmtDay(days[6], { month: 'short', day: 'numeric' })}</span></div>
        <span class="spacer"></span>
        <span class="pill ${short ? 'crit' : 'good'}" title="${short ? 'A day is short when the rota has a gap or someone has no shift set' : ''}">${icon(short ? 'alert' : 'check', 12, { stroke: 2.4 })}${short ? `${short} day${short > 1 ? 's' : ''} short` : 'Fully covered'}</span>
        <button class="btn ghost sm" data-click="live.sched" data-v="${wk}">Open schedule ${icon('arrowR', 14)}</button>
      </div>
      <div class="row tight live-roles">
        ${t.r.wd >= 5 ? role('Weekend Support', t.r.weekend) : html`${role('Main Proci', t.r.main)}${role('Proci Backup', t.r.backup)}`}
      </div>
      <div class="today-dd" data-pop-anchor="cal-today">
        <button class="today-btn" aria-expanded="${open}" aria-haspopup="true" data-click="cal.todayPop">
          <b>Today</b>
          ${groups.map(([l, list, tone]) => html`<span class="today-chip"><i class="ev-sw ${tone}"></i>${l} <b class="num">${list.length}</b></span>`)}
          <span class="spacer"></span>${icon(open ? 'chevUp' : 'chevDown', 16)}
        </button>
        ${open && html`<div class="today-pop" role="dialog" aria-label="Who is working today">
          ${groups.map(([l, list, tone]) => html`<div class="today-g"><span class="eyebrow"><i class="ev-sw ${tone}"></i>${l} · ${list.length}</span>
            ${list.length ? list.map((p) => html`<div class="today-row"><span class="ev-av">${ini(p.name)}</span><span class="ev-t">${p.name}</span><span class="small muted">${detail(p)}</span></div>`) : html`<span class="small muted">Nobody</span>`}</div>`)}
        </div>`}
      </div>
      <div class="cal-month">
        <div class="cal-dow">${days.map((d) => html`<span>${R().fmtDay(d, { weekday: 'short' }).slice(0, 2)}</span>`)}</div>
        <div class="cal-week" style="${S.style({ gridTemplateRows: `32px 30px ${'30px '.repeat(lanes)}minmax(44px, 1fr)` })}">
          ${info.map((x, i) => html`<button class="${cls('cal-day', x.r.wd >= 5 && 'we')}" data-key="d${x.d}" style="grid-column:${i + 1};grid-row:1 / -1" data-click="live.sched" data-v="${wk}"
            title="${[...x.r.notes, ...x.r.gaps.map((g) => `⚠ ${g}`), x.unset ? `${x.unset} with no shift set` : ''].filter(Boolean).join('\n')}"
            aria-label="${R().fmtDay(x.d, { weekday: 'long', month: 'long', day: 'numeric' })}: ${x.e + x.l + x.w} working${x.ok ? '' : ', short'}">
            <span class="${cls('cal-num', x.d === today && 'today')}">${R().parse(x.d).getDate()}</span>
            <span class="cal-cell-foot">
              ${hidden[i] > 0 && html`<span class="cal-more">+${hidden[i]}</span>`}
              <span class="cal-working"><b class="num">${x.e + x.l + x.w}</b> on</span>
              <span class="cov ${x.ok ? 'ok' : 'low'}">${x.r.wd >= 5 ? `${x.w} W` : `${x.e}E ${x.l}L`}${!x.ok && ' ⚠'}</span>
            </span>
          </button>`)}
          <button class="${cls('ev', P ? 'W' : 'rota-unset', P && me && P === me.soeid && 'mine')}" style="grid-column:1 / span 7;grid-row:2" data-click="live.sched" data-v="${wk}" title="${P ? `${nameOf(P)} is this week's Proci` : 'No Proci set for this week'}">
            ${P ? html`<span class="ev-av">${ini(nameOf(P))}</span><span class="ev-t">Proci · ${nameOf(P)}</span>` : html`<span class="ev-av">${icon('alert', 12)}</span><span class="ev-t">No Proci set this week</span>`}
          </button>
          ${bars.filter((b) => b.lane < PREVIEW_LANES).map((b) => html`<button class="${cls('ev PL', me && b.l.soeid === me.soeid && 'mine')}" data-key="l${b.l.id}" style="grid-column:${b.start + 1} / span ${b.span};grid-row:${b.lane + 3}" data-click="live.sched" data-v="${wk}" title="${nameOf(b.l.soeid)} on leave">
            <span class="ev-av">${ini(nameOf(b.l.soeid))}</span><span class="ev-t">${nameOf(b.l.soeid).split(' ')[0]} · Leave</span></button>`)}
        </div>
      </div>
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
    const same = !!qm.today() && u.duty === t.duty && u.shift === t.shift
    return S.modal({
      title: qm.today() ? "Change today's role or shift" : "Start today's shift",
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

  // ---------- Bell notifications on real data ----------
  // Replaces the prototype's sample notifications once you're signed in from the roster.
  // Needs action: rota gaps and missing shifts in the next 7 days, a week's Proci on leave,
  // tickets waiting or past SLA, manual entries to verify. Updates: schedule changes from
  // the shared log (last 7 days, by other people), today's rota adjustments, tickets
  // handed to you. Ids are stable, so read/unread survives re-renders.
  function liveNotifications() {
    if (!real() || !qm.me()) return null
    const me = qm.me()
    const lead = me.accessRole === 'Lead'
    const now = Date.now()
    const today = R().today()
    const fd = (d) => R().fmtDay(d)
    const fw = (w) => R().fmtDay(w, { day: 'numeric', month: 'short' })
    const first = (s) => nameOf(s).split(' ')[0]
    const sched = { page: 'team', tab: 'schedule' }
    const out = []
    const active = qm.roster.filter((p) => p.active !== false)

    // Needs action: the coming 7 days.
    for (let i = 0; i < 7; i++) {
      const d = R().addDays(today, i)
      const r = R().dayRoles(d)
      const cv = coverage(d)
      if (cv.short.length) out.push({ id: `cov|${d}|${cv.short.join('|')}`, group: 'action', kind: 'coverage', tone: i === 0 ? 'crit' : 'warn', title: `${i === 0 ? 'Today' : fd(d)}: short on ${cv.short.join(', ')}`, sub: 'Below the Early / Late minimums in Team settings', at: now - i - 0.5, ...sched })
      if (r.gaps.length) out.push({ id: `gap|${d}|${r.gaps.join('|')}`, group: 'action', kind: 'coverage', tone: i === 0 ? 'crit' : 'warn', title: `${i === 0 ? 'Today' : fd(d)}: ${r.gaps.join(', ')}`, sub: lead ? 'Set the order in the shift grid or a week on the calendar' : 'A lead sets the Proci rota', at: now - i, ...sched })
    }
    // Shifts not set in the coming 7 days: one notification, per person how many days.
    if (lead) {
      const miss = new Map()
      for (let i = 0; i < 7; i++) {
        const d = R().addDays(today, i)
        if ((R().parse(d).getDay() + 6) % 7 >= 5) continue
        for (const p of active) { const pl = planFor(p.soeid, d); if (pl.shift === null && pl.role !== 'LEAVE' && pl.role !== 'REST') miss.set(p.soeid, (miss.get(p.soeid) || 0) + 1) }
      }
      if (miss.size) out.push({ id: `unset|${today}|${[...miss].join(',')}`, group: 'action', kind: 'coverage', tone: 'warn', title: `${miss.size} ${miss.size > 1 ? 'people have' : 'person has'} no shift set in the next 7 days`, sub: [...miss].map(([s, n]) => `${first(s)} (${n} day${n > 1 ? 's' : ''})`).join(', '), at: now - 0.5, ...sched })
    }
    // A week's Proci on leave during their duty (next 4 weeks).
    const wk = R().mondayOf(today)
    for (let k = 0; k < 4; k++) {
      const w = R().addDays(wk, 7 * k)
      const P = R().procOf(w)
      if (!P) continue
      const away = [0, 1, 2, 3, 5, 6].map((i) => R().addDays(w, i)).filter((d) => d >= today && R().onLeave(P, d))
      if (away.length) out.push({ id: `clash|${w}|${P}|${away.join(',')}`, group: 'action', kind: 'leave', tone: 'warn', title: `${first(P)} is the Proci for the week of ${fw(w)} but on leave ${away.map((d) => R().fmtDay(d, { weekday: 'short' })).join(', ')}`, sub: 'The Backup moves up on those days. Swap the week on the calendar if they are away all week.', at: now - 10 - k, ...sched })
    }
    // Tickets.
    if (S.queue) {
      const v = S.queue.view()
      const open = v.tickets.filter(S.queue.isOpen)
      const waiting = open.filter((t) => !S.queue.owner(t) && !t.sn)
      if (waiting.length) out.push({ id: `wait|${waiting.map((t) => t.n).join(',')}`, group: 'action', kind: 'assign', tone: 'warn', title: `${waiting.length} ticket${waiting.length > 1 ? 's' : ''} waiting for someone on shift`, sub: 'They go out automatically when someone signs in', at: now - 20, page: 'home' })
      const late = open.filter((t) => S.queue.health(t, v.settings, now).slaBreached && (lead || S.queue.owner(t) === me.soeid))
      if (late.length) out.push({ id: `sla|${late.map((t) => t.n).join(',')}`, group: 'action', kind: 'sla', tone: 'crit', title: `${late.length} ${lead ? '' : 'of your '}ticket${late.length > 1 ? 's' : ''} past SLA`, sub: late.slice(0, 4).map((t) => t.n).join(', ') + (late.length > 4 ? '…' : ''), at: now - 21, page: 'home' })
      const mine = v.tickets.filter((t) => t.to === me.soeid && t.assignedAt > now - 8 * 3600e3 && S.queue.isOpen(t)).sort((a, b) => b.assignedAt - a.assignedAt)
      if (mine.length > 3) out.push({ id: `as|${mine.map((t) => t.n).join(',')}`, group: 'update', kind: 'assign', tone: 'accent', title: `${mine.length} tickets were handed to you`, sub: mine.slice(0, 5).map((t) => t.n).join(', ') + (mine.length > 5 ? '…' : ''), at: mine[0].assignedAt, page: 'qm' })
      else for (const t of mine) out.push({ id: `as|${t.n}|${t.assignedAt}`, group: 'update', kind: 'assign', tone: 'accent', title: `${t.n} was handed to you`, sub: t.reason, at: t.assignedAt, page: 'qm', tab: 'tickets', ticket: t.n })
    }
    if (lead) {
      const pend = (qm.entries || []).filter((x) => x.status === 'Pending' && x.by !== me.soeid)
      if (pend.length) out.push({ id: `verify|${pend.map((x) => x.id).join(',')}`, group: 'action', kind: 'approval', tone: 'accent', title: `${pend.length} manual INC entr${pend.length > 1 ? 'ies' : 'y'} to verify`, sub: pend.map((x) => `${x.inc} (${first(x.by)})`).slice(0, 3).join(', '), at: now - 22, page: 'home', tab: 'verify' })
    }
    // Updates: today's and tomorrow's rota adjustments (leave succession).
    for (let i = 0; i < 2; i++) {
      const d = R().addDays(today, i)
      for (const n of R().dayRoles(d).notes) out.push({ id: `note|${d}|${n}`, group: 'update', kind: 'rota', tone: 'accent', title: `${i === 0 ? 'Today' : 'Tomorrow'}: ${n}`, sub: fd(d), at: now - 30 - i, ...sched })
    }
    // Updates: schedule changes in the shared log, last 7 days, by others.
    // A burst of shift edits by one person (one-click painting) becomes one notification.
    const since = now - 7 * 864e5
    const bursts = new Map()
    for (const ev of qm.events || []) {
      const e = ev.e || {}
      if (ev.at < since || ev.by === me.soeid) continue
      const who = first(ev.by)
      const push = (kind, title, sub) => out.push({ id: `ev|${ev.seq}`, group: 'update', kind, tone: 'accent', title, sub, at: ev.at, ...sched })
      if (e.type === 'leaveAdd') push('leave', ev.by === e.soeid ? `${who} added leave: ${fd(e.from)}${e.from !== e.to ? ` – ${fd(e.to)}` : ''}` : `${who} added leave for ${first(e.soeid)}: ${fd(e.from)}${e.from !== e.to ? ` – ${fd(e.to)}` : ''}`, e.note || '')
      else if (e.type === 'leaveCancel') push('leave', `${who} cancelled a leave`, '')
      else if (e.type === 'rotaOrderSet') push('rota', `${who} changed the Proci order from the week of ${fw(e.from)}`, (e.order || []).map(first).join(' → '))
      else if (e.type === 'rotaSet') push('rota', e.soeid ? `${who} made ${first(e.soeid)} the Proci for the week of ${fw(e.week)}` : `${who} put the week of ${fw(e.week)} back to the Proci order`, '')
      else if (e.type === 'shiftStart' && e.edited) push('shift', `${who} changed today's role or shift: ${S.dutyLabel(e.duty)} · ${S.shiftLabel(e.shift)}`, e.reason || '')
      else if (e.type === 'shiftPlanSet' || e.type === 'shiftDaySet') {
        const key = ev.by
        const b = bursts.get(key)
        if (b && ev.at - b.last < 10 * 60e3) { b.n++; b.last = ev.at; b.people.add(e.soeid) } else {
          const nb = { seq: ev.seq, by: ev.by, n: 1, first: ev.at, last: ev.at, people: new Set([e.soeid]) }
          bursts.set(key, nb); out.push(nb)
        }
      }
    }
    // Turn the bursts into notifications.
    for (let i = 0; i < out.length; i++) {
      const b = out[i]
      if (!b.people) continue
      const ppl = [...b.people].map(first)
      out[i] = { id: `ev|${b.seq}|${b.n}`, group: 'update', kind: 'shift', tone: 'accent', title: `${first(b.by)} changed ${b.n} shift${b.n > 1 ? 's' : ''}`, sub: `For ${ppl.slice(0, 4).join(', ')}${ppl.length > 4 ? '…' : ''}`, at: b.last, ...sched }
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 80)
  }

  S.liveNotifications = liveNotifications
  S.schedule = { coverage, defaultShifts, rosterPanel, real, planFor, plannedShift, todayPresence, schedulePanel, attendancePanel, editModal, showWeek, weekPreview, _test: { fold } }

  S.on({
    'sched.week': (el) => S.set(ui(), { week: el.dataset.v }),
    'sched.brush': (el) => { const u = ui(); S.set(u, { brush: el.dataset.v && u.brush !== el.dataset.v ? el.dataset.v : null }) },
    'sched.paint': async (el) => {
      const { brush } = ui()
      const soeid = el.dataset.s
      const day = el.dataset.d
      const pl = planFor(soeid, day)
      const who = nameOf(soeid).split(' ')[0]
      const when = R().fmtDay(day)
      const toast = (text) => S.dispatch({ type: 'toast', text })
      if (brush === 'LEAVE') {
        const r = await R().addLeave(soeid, day, day)
        if (r === 'already') toast(`${who} is already on leave on ${when}`); else if (r) toast(`${who}: leave on ${when}`)
        return
      }
      if (brush === 'CLEAR') {
        if (pl.role === 'LEAVE') { if (await R().removeLeaveDay(soeid, day)) toast(`${who}: leave removed on ${when}`); return }
        if (pl.oneDay) { if (await qm.send({ type: 'shiftDaySet', day, soeid, shift: null })) toast(`${who}: back to the week's shift on ${when}`); return }
        toast(`Nothing to clear for ${who} on ${when}`)
        return
      }
      if (pl.role === 'LEAVE') { toast(`${who} is on leave on ${when}. Clear the leave first.`); return }
      if (pl.role === 'REST') { toast(`${when} is ${who}'s rest day in the Proci rota`); return }
      if (pl.shift === brush) return
      // Same as the week's shift: drop the one-day entry rather than store a copy.
      const shift = plannedShift(soeid, day) === brush ? null : brush
      // Analysts can't leave the day under the minimums; a lead can (the day shows short).
      const me = qm.me()
      if (!(me && me.accessRole === 'Lead')) {
        const c = coverage(day)
        const m = mins()
        const e = c.early - (pl.shift === 'EARLY' ? 1 : 0) + (brush === 'EARLY' ? 1 : 0)
        const l = c.late - (pl.shift === 'LATE' ? 1 : 0) + (brush === 'LATE' ? 1 : 0)
        if (e < m.early || l < m.late) { toast(`${when} needs at least ${m.early} on Early and ${m.late} on Late. Swap with someone, or ask a lead.`); return }
      }
      if (await qm.send({ type: 'shiftDaySet', day, soeid, shift })) toast(`${who}: ${brushLabel(brush)} on ${when}`)
    },
    'sched.paintWeek': async (el) => {
      const { brush, week } = ui()
      const soeid = el.dataset.s
      const shift = brush === 'CLEAR' ? null : brush
      const oneDays = [...view().dayPlan.keys()].map((k) => k.split('|')).filter(([d, s]) => s === soeid && R().mondayOf(d) === week)
      if (!(await qm.send({ type: 'shiftPlanSet', week, soeid, shift }))) return
      for (const [d] of oneDays) if (!(await qm.send({ type: 'shiftDaySet', day: d, soeid, shift: null }))) return
      S.dispatch({ type: 'toast', text: `${nameOf(soeid)}: ${shift ? S.shiftLabel(shift) : 'back to the carried shift'} for the week of ${R().fmtDay(week, { day: 'numeric', month: 'short' })}` })
    },
    'sched.editOpen': () => {
      S.pop = null
      // Not on shift yet (nothing scheduled today): start from what the rota and schedule say.
      const t = qm.today() || {}; const m = qm.me(); const pl = m ? planFor(m.soeid) : {}
      const role = S.DUTIES.some((d) => d.id === pl.role) ? pl.role : 'ANALYST'
      const shift = S.SHIFTS.some((x) => x.id === pl.shift) ? pl.shift : 'EARLY'
      S.set(edit(), { open: true, duty: t.duty || role, shift: t.shift || shift, reason: '', tried: false })
    },
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
