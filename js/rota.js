// Proci rota: the whole week's roles follow from one list, who is the Proci each week.
//
// Rules (vault: Team Operating Model §3, §3a, §3b; lead, 2026-11-12). P = this week's
// Proci, P−1 = last week's, P+1 = next week's, P+2 = the week after (Backup ×2):
//  - Monday:   Main = P,   Backup = P+1   (P−1 rests after their weekend)
//  - Tue–Thu:  Main = P,   Backup = P−1
//  - Friday:   Main = P−1, Backup = P+1   (P rests before their weekend)
//  - Sat–Sun:  Weekend Support = P (also the Main Proci)
//  - Main Proci on leave: the day's Backup moves up to Main, P+2 becomes Backup.
//  - Backup on leave: P+2 becomes Backup (assumed, Q24). Weekend Support on leave:
//    nobody is defined (Q23), so Scope shows the gap.
// The Proci queue (round robin): a lead orders the team once (rotaOrderSet: order, from
// week) and every week from then on takes the next person in that order. A one-off
// change for a single week (rotaSet, e.g. a swap when the Proci is on leave) wins over
// the queue for that week only, without shifting anyone else.
// Stored in the shared ops log: rotaOrderSet and rotaSet (lead), leaveAdd / leaveCancel
// (the person or a lead).
;(function () {
  const { html, cls, icon, seg, uid } = S
  const qm = S.qm
  const DAY = 864e5

  // ---------- Dates (local, YYYY-MM-DD) ----------
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d) }
  const mondayOf = (s) => { const d = parse(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return iso(d) }
  const today = () => iso(new Date())
  const fmtDay = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => parse(s).toLocaleDateString([], opts)

  // ---------- Fold ----------
  const isLead = (soeid) => ((qm.roster.find((p) => p.soeid === soeid) || {}).accessRole === 'Lead')
  const nameOf = (soeid) => (soeid ? (qm.roster.find((p) => p.soeid === soeid) || {}).name || soeid : '')
  const first = (soeid) => nameOf(soeid).split(' ')[0]
  let memo = { events: null }
  function fold(events) {
    const weeks = new Map() // monday -> soeid, one-off weeks
    const orders = [] // { from, order, seq }: the queue, from a week on
    const log = []
    const leaves = new Map()
    for (const ev of events) {
      const e = ev.e || {}
      if (e.type === 'rotaSet' && isLead(ev.by) && /^\d{4}-\d{2}-\d{2}$/.test(e.week || '')) {
        const wk = mondayOf(e.week)
        log.push({ week: wk, from: weeks.get(wk) || null, to: e.soeid || null, by: ev.by, at: ev.at })
        if (e.soeid) weeks.set(wk, e.soeid); else weeks.delete(wk)
      } else if (e.type === 'rotaOrderSet' && isLead(ev.by) && /^\d{4}-\d{2}-\d{2}$/.test(e.from || '') && Array.isArray(e.order)) {
        orders.push({ from: mondayOf(e.from), order: e.order.filter((s) => typeof s === 'string'), seq: orders.length, by: ev.by, at: ev.at })
      } else if (e.type === 'leaveAdd' && e.id && e.soeid && (ev.by === e.soeid || isLead(ev.by)) && e.from && e.to && e.from <= e.to) {
        leaves.set(e.id, { id: e.id, soeid: e.soeid, from: e.from, to: e.to, note: e.note || '', by: ev.by, at: ev.at, cancelled: false })
      } else if (e.type === 'leaveCancel') {
        const l = leaves.get(e.id)
        if (l && (ev.by === l.soeid || isLead(ev.by))) Object.assign(l, { cancelled: true, cancelledBy: ev.by })
      }
    }
    return { weeks, orders, log, leaves: [...leaves.values()].filter((l) => !l.cancelled).sort((a, b) => a.from.localeCompare(b.from)) }
  }
  function view() {
    if (memo.events !== qm.events || memo.roster !== qm.roster) memo = { events: qm.events, roster: qm.roster, v: fold(qm.events || []) }
    return memo.v
  }
  // The queue in force for a week: the one starting latest on or before it (a later save
  // wins a tie). Weeks before the first saved queue use that queue too, counted
  // backwards, so last week's Proci is known from day one. With nothing saved, the
  // default is the active roster in roster.json order, from DEFAULT_FROM: the team's
  // starting Proci order (lead, 2026-11-13), which a lead overrides in Team Management.
  const DEFAULT_FROM = '2026-11-09'
  function queueFor(week, v = view()) {
    let best = null
    for (const o of v.orders) if (o.from <= week && (!best || o.from > best.from || (o.from === best.from && o.seq > best.seq))) best = o
    if (!best && v.orders.length) best = v.orders.reduce((a, o) => (o.from < a.from || (o.from === a.from && o.seq > a.seq) ? o : a))
    if (!best) best = { from: DEFAULT_FROM, order: qm.roster.filter((p) => p.active !== false).map((p) => p.soeid), seq: -1, isDefault: true }
    const order = best.order.filter((s) => qm.roster.some((p) => p.soeid === s && p.active !== false))
    return order.length ? { ...best, order } : null
  }
  const fromQueue = (week, v = view()) => {
    const q = queueFor(week, v)
    if (!q) return null
    const k = Math.round((parse(week) - parse(q.from)) / (7 * DAY))
    return q.order[((k % q.order.length) + q.order.length) % q.order.length]
  }
  // This week's Proci: a one-off change for the week, else the queue.
  const procOf = (week, v = view()) => (v.weeks.has(week) ? v.weeks.get(week) : fromQueue(week, v))
  const onLeave = (soeid, day, v = view()) => !!soeid && v.leaves.some((l) => l.soeid === soeid && l.from <= day && day <= l.to)

  // ---------- Who holds what on a day ----------
  function dayRoles(day, v = view()) {
    const wk = mondayOf(day)
    const P = (n) => procOf(addDays(wk, 7 * n), v) || null
    const wd = (parse(day).getDay() + 6) % 7 // 0 = Monday
    const p = { m1: P(-1), p0: P(0), p1: P(1), p2: P(2) }
    let main = null; let backup = null; let weekend = null; const rest = []
    if (wd === 0) { main = p.p0; backup = p.p1; rest.push(p.m1) }
    else if (wd <= 3) { main = p.p0; backup = p.m1 }
    else if (wd === 4) { main = p.m1; backup = p.p1; rest.push(p.p0) }
    else { main = p.p0; weekend = p.p0 }
    const normal = { main, backup, weekend }
    const notes = []; const gaps = []
    const away = (s) => onLeave(s, day, v)
    if (wd <= 4) {
      if (main && away(main)) {
        const up = backup && !away(backup) ? backup : null
        const next = p.p2 && !away(p.p2) && p.p2 !== up ? p.p2 : null
        notes.push(`${first(main)} on leave: ${up ? `${first(up)} moves up to Main Proci` : 'no Backup to move up'}${next ? `, ${first(next)} (Backup ×2) is Backup` : ''}`)
        main = up; backup = next
      } else if (backup && away(backup)) {
        const next = p.p2 && !away(p.p2) && p.p2 !== main ? p.p2 : null
        notes.push(`${first(backup)} on leave: ${next ? `${first(next)} (Backup ×2) is Backup (assumed, Q24)` : 'no Backup ×2 available'}`)
        backup = next
      }
      if (!main) gaps.push(p.p0 || wd === 4 ? 'No Main Proci' : 'No Proci set for this week')
      if (!backup) gaps.push(`No Proci Backup${!(wd === 0 || wd === 4 ? p.p1 : p.m1) ? ` (set ${wd === 0 || wd === 4 ? "next week's" : "last week's"} Proci)` : ''}`)
    } else if (weekend && away(weekend)) {
      notes.push(`${first(weekend)} on leave: nobody is defined to take the weekend (Q23)`)
      gaps.push('No Weekend Support'); main = null; weekend = null
    } else if (!weekend) gaps.push('No Weekend Support (no Proci set)')
    return { day, wd, main, backup, weekend, rest: rest.filter(Boolean), normal, notes, gaps, set: !!p.p0, p }
  }
  // A person's rota role on a day, or null when the rota says nothing about them.
  function roleOf(soeid, day = today()) {
    const v = view()
    if (onLeave(soeid, day, v)) return 'LEAVE'
    if (!procOf(mondayOf(day), v)) return null
    const r = dayRoles(day, v)
    if (r.weekend === soeid) return 'WEEKEND_SUPPORT'
    if (r.main === soeid) return 'MAIN_PROCI'
    if (r.backup === soeid) return 'PROCI_BACKUP'
    if (r.rest.includes(soeid)) return 'REST'
    return 'ANALYST'
  }

  // ---------- Leave writes (shared by the calendar and the shift grid) ----------
  const dayDiff = (a, b) => Math.round((parse(b) - parse(a)) / DAY)
  const canLeave = (soeid) => { const me = qm.me(); return !!me && (me.accessRole === 'Lead' || me.soeid === soeid) }
  // Add leave, merged with any of the person's leave it overlaps or touches, so the
  // list and the calendar show one block rather than many single days.
  async function addLeave(soeid, from, to, note = '') {
    const touching = view().leaves.filter((l) => l.soeid === soeid && l.from <= addDays(to, 1) && addDays(from, -1) <= l.to)
    if (touching.some((l) => l.from <= from && to <= l.to)) return 'already'
    const lo = [from, ...touching.map((l) => l.from)].sort()[0]
    const hi = [to, ...touching.map((l) => l.to)].sort().pop()
    const keepNote = note || (touching.find((l) => l.note) || {}).note || ''
    for (const l of touching) if (!(await qm.send({ type: 'leaveCancel', id: l.id }))) return false
    return qm.send({ type: 'leaveAdd', id: uid('lv'), soeid, from: lo, to: hi, note: keepNote })
  }
  // Take one day out of a person's leave, splitting the block around it if needed.
  async function removeLeaveDay(soeid, day) {
    const l = view().leaves.find((x) => x.soeid === soeid && x.from <= day && day <= x.to)
    if (!l) return 'none'
    if (!(await qm.send({ type: 'leaveCancel', id: l.id }))) return false
    if (l.from < day && !(await qm.send({ type: 'leaveAdd', id: uid('lv'), soeid, from: l.from, to: addDays(day, -1), note: l.note }))) return false
    if (day < l.to && !(await qm.send({ type: 'leaveAdd', id: uid('lv'), soeid, from: addDays(day, 1), to: l.to, note: l.note }))) return false
    return true
  }

  // ---------- Proci rota & leave calendar (Team Management → Schedule & coverage) ----------
  // One click: pick a person, then click a week to make them its Proci, or click the
  // first and last day of their leave.
  const ui = () => S.ui('p:team:rota', () => {
    const me = qm.me()
    const lead = !!me && me.accessRole === 'Lead'
    return { month: today().slice(0, 8) + '01', mode: lead ? 'proci' : 'leave', who: lead ? null : me && me.soeid, lvStart: null, note: '', sel: null, wsel: null }
  })
  const WD = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const MAX_LANES = 3
  const ini = (soeid) => nameOf(soeid).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  function leaveBars(week, v) {
    const end = addDays(week, 6)
    const bars = v.leaves.filter((l) => l.from <= end && week <= l.to).map((l) => {
      const s = l.from < week ? week : l.from
      const e = l.to > end ? end : l.to
      return { l, start: dayDiff(week, s), span: dayDiff(s, e) + 1 }
    }).sort((a, b) => a.start - b.start || b.span - a.span)
    const lanes = []
    bars.forEach((b) => {
      let k = lanes.findIndex((last) => last < b.start)
      if (k === -1) { k = lanes.length; lanes.push(-1) }
      lanes[k] = b.start + b.span - 1
      b.lane = k
    })
    return bars
  }

  function rotaCalendar() {
    if (location.protocol === 'file:' || !qm.loadedAt) return html`<div class="card"><div class="card-b empty">The rota lives on the Scope Lite server. Start Scope with run.bat or share.bat.</div></div>`
    const v = view()
    const me = qm.me()
    const lead = !!me && me.accessRole === 'Lead'
    const u = ui()
    const mode = lead ? u.mode : 'leave'
    const who = lead ? u.who : me && me.soeid
    const people = qm.roster.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name))
    const first1 = u.month
    const last = iso(new Date(parse(first1).getFullYear(), parse(first1).getMonth() + 1, 0))
    const start = mondayOf(first1)
    const weeks = Array.from({ length: Math.ceil((dayDiff(start, last) + 1) / 7) }, (_, i) => addDays(start, 7 * i))
    const mon = parse(first1).getMonth()
    const t = today()
    // Coverage per day: Early/Late (or Weekend) counts from the shift grid, plus the rota's gaps.
    const active = qm.roster.filter((p) => p.active !== false)
    const covOf = (d) => {
      const pl = S.schedule ? active.map((p) => S.schedule.planFor(p.soeid, d)) : []
      const n = (sh) => pl.filter((x) => x.shift === sh).length
      return { e: n('EARLY'), l: n('LATE'), w: n('WEEKEND'), unset: pl.filter((x) => x.shift === null && x.role !== 'LEAVE' && x.role !== 'REST').length }
    }
    const gapDays = weeks.flatMap((w) => Array.from({ length: 7 }, (_, i) => addDays(w, i))).filter((d) => parse(d).getMonth() === mon && (dayRoles(d, v).gaps.length || covOf(d).unset)).length
    const sel = u.sel && v.leaves.find((l) => l.id === u.sel)
    const hint = mode === 'proci'
      ? (who === undefined || who === null ? 'Pick a person, then click any day of a week to make them that week\'s Proci.' : who === '' ? 'Click a week to put it back to the queue order.' : `Click a week to make ${first(who)} its Proci.`)
      : !who ? 'Pick whose leave this is.' : u.lvStart ? `Now click the last day of ${first(who)}'s leave (or the same day for one day).` : `Click the first day of ${first(who)}'s leave.`

    return html`<section class="card cal rota-cal">
      <div class="cal-top">
        <div class="stack" style="gap:2px"><b>Schedule calendar</b><span class="muted small">Every day's roles (from the Proci queue), who is on leave, and how many are on Early and Late. Gaps and changes also go to the bell.</span></div>
        <span class="spacer"></span>
        <div class="cal-status ${gapDays ? 'low' : 'ok'}" role="status">
          <span class="cal-status-ic">${icon(gapDays ? 'alert' : 'check', 15, { stroke: 2.4 })}</span>
          <div class="stack" style="gap:0"><b>${gapDays ? 'Coverage gaps' : 'Fully covered'}</b><span class="small muted">${gapDays ? `${gapDays} day${gapDays > 1 ? 's' : ''} this month missing a role or a shift` : 'Every day has its roles and shifts'}</span></div>
        </div>
      </div>

      <div class="brush-bar">
        ${lead && seg([{ id: 'proci', label: html`${icon('swap', 13)} Set Proci` }, { id: 'leave', label: html`${icon('cal', 13)} Add leave` }], mode, 'rota.calMode')}
        <div class="brush-people" role="radiogroup" aria-label="${mode === 'proci' ? 'Proci to place' : 'Whose leave'}">
          ${(lead ? people : people.filter((p) => me && p.soeid === me.soeid)).map((p) => html`<button class="${cls('brush', who === p.soeid && 'on')}" role="radio" aria-checked="${who === p.soeid}" data-click="rota.calWho" data-v="${p.soeid}"><span class="ev-av">${ini(p.soeid)}</span>${p.name.split(' ')[0]}</button>`)}
          ${mode === 'proci' && html`<button class="${cls('brush', who === '' && 'on')}" role="radio" aria-checked="${who === ''}" data-click="rota.calWho" data-v="">${icon('x', 13)}Queue order</button>`}
        </div>
        ${mode === 'leave' && html`<input class="in brush-note" maxlength="120" value="${u.note}" data-input="rota.calNote" placeholder="Note (optional), e.g. vacation" aria-label="Leave note">`}
      </div>
      <div class="row small"><span class="${cls(u.lvStart || who ? 'ink2' : 'muted')}">${icon('bolt', 13)} ${hint}</span>${u.lvStart && html`<button class="btn ghost sm" data-click="rota.calCancel">Cancel</button>`}</div>

      <div class="cal-head">
        <h2>${fmtDay(first1, { month: 'long', year: 'numeric' })}</h2>
        <span class="spacer"></span>
        ${first1 !== t.slice(0, 8) + '01' && html`<button class="btn sm" data-click="rota.calMonth" data-v="${t.slice(0, 8)}01">Today</button>`}
        <button class="cal-nav" data-click="rota.calMonth" data-v="${iso(new Date(parse(first1).getFullYear(), mon - 1, 1))}" aria-label="Previous month">${icon('chevL', 16)}</button>
        <button class="cal-nav" data-click="rota.calMonth" data-v="${iso(new Date(parse(first1).getFullYear(), mon + 1, 1))}" aria-label="Next month">${icon('chevR', 16)}</button>
      </div>
      <div class="cal-legend">
        <span><i class="ev-sw W"></i>Weekly Proci (Main Mon–Thu + Weekend)</span>
        <span><i class="ev-sw PL"></i>Leave</span>
        <span class="muted">M = Main Proci · B = Backup · W = Weekend Support</span>
      </div>

      <div class="cal-month" role="grid" aria-label="Proci rota and leave">
        <div class="cal-dow" role="row">${WD.map((d) => html`<span role="columnheader">${d.slice(0, 2)}</span>`)}</div>
        ${weeks.map((w) => {
          const bars = leaveBars(w, v)
          const lanes = Math.min(MAX_LANES, Math.max(0, ...bars.map((b) => b.lane + 1)))
          const hidden = Array.from({ length: 7 }, (_, i) => bars.filter((b) => b.lane >= MAX_LANES && i >= b.start && i < b.start + b.span).length)
          const P = procOf(w, v)
          return html`<div class="cal-week" role="row" data-key="w${w}" style="${S.style({ gridTemplateRows: `34px 30px ${'30px '.repeat(lanes)}minmax(58px, 1fr)` })}">
            ${Array.from({ length: 7 }, (_, i) => {
              const d = addDays(w, i)
              const r = dayRoles(d, v)
              const inRange = mode === 'leave' && u.lvStart === d
              const roles = r.wd >= 5 ? [['W', r.weekend]] : [['M', r.main], ['B', r.backup]]
              return html`<button class="${cls('cal-day', parse(d).getMonth() !== mon && 'out', r.wd >= 5 && 'we', inRange && 'pick')}" data-key="d${d}" style="grid-column:${i + 1};grid-row:1 / -1"
                data-click="rota.calDay" data-v="${d}"
                title="${[...r.notes, ...r.gaps.map((g) => `⚠ ${g}`)].join('\n')}"
                aria-label="${fmtDay(d, { weekday: 'long', month: 'long', day: 'numeric' })}: ${roles.map(([k, s]) => `${k} ${s ? nameOf(s) : 'none'}`).join(', ')}${r.gaps.length ? `, ${r.gaps.join(', ')}` : ''}">
                <span class="${cls('cal-num', d === t && 'today')}">${parse(d).getDate()}</span>
                <span class="cal-cell-foot">
                  ${hidden[i] > 0 && html`<span class="cal-more">+${hidden[i]} more</span>`}
                  <span class="${cls('rota-roles', r.gaps.length && 'low', r.notes.length && 'chg')}">${roles.map(([k, s]) => html`<span>${k} <b>${s ? first(s) : '—'}</b></span>`)}</span>
                  ${(() => { const c = covOf(d); const low = r.gaps.length || c.unset; return html`<span class="${cls('cov', low ? 'low' : 'ok')}" title="${[c.unset ? `${c.unset} with no shift set` : '', ...r.gaps].filter(Boolean).join('\n')}">${r.wd >= 5 ? `${c.w} W` : `${c.e}E ${c.l}L`}${low ? ' ⚠' : ''}</span>` })()}
                </span>
              </button>`
            })}
            <button class="${cls('ev', P ? 'W' : 'rota-unset', P && me && P === me.soeid && 'mine')}" data-key="p${w}" style="grid-column:1 / span 7;grid-row:2"
              data-click="${mode === 'proci' && lead && who !== null && who !== undefined ? 'rota.calDay' : 'rota.calWeek'}" data-v="${w}" title="${P ? `${nameOf(P)} is the Proci for the week of ${fmtDay(w, { day: 'numeric', month: 'short' })}` : 'No Proci set for this week'}">
              ${P ? html`<span class="ev-av">${ini(P)}</span><span class="ev-t">Proci · <b>${nameOf(P)}</b> <span class="muted">· Backup Tue–Thu ${first(procOf(addDays(w, -7), v)) || '—'} · Mon &amp; Fri ${first(procOf(addDays(w, 7), v)) || '—'}</span></span>`
                : html`<span class="ev-av">${icon('plus', 12)}</span><span class="ev-t">No Proci set${lead ? ' — pick a person, then click this week' : ''}</span>`}
            </button>
            ${bars.filter((b) => b.lane < MAX_LANES).map((b) => html`<button class="${cls('ev PL', me && b.l.soeid === me.soeid && 'mine', u.sel === b.l.id && 'sel')}" data-key="l${b.l.id}${w}"
              style="grid-column:${b.start + 1} / span ${b.span};grid-row:${b.lane + 3}" data-click="rota.leaveSel" data-v="${b.l.id}"
              title="${nameOf(b.l.soeid)} on leave ${fmtDay(b.l.from)} – ${fmtDay(b.l.to)}${b.l.note ? ` (${b.l.note})` : ''}">
              <span class="ev-av">${ini(b.l.soeid)}</span><span class="ev-t">${first(b.l.soeid)} · Leave${b.l.note ? ` · ${b.l.note}` : ''}</span></button>`)}
          </div>`
        })}
      </div>

      ${sel && html`<div class="callout rota-sel">${icon('cal', 16)}<span style="flex:1"><b>${nameOf(sel.soeid)}</b> on leave ${fmtDay(sel.from)} – ${fmtDay(sel.to)} (${dayDiff(sel.from, sel.to) + 1} day${sel.from === sel.to ? '' : 's'})${sel.note ? ` · ${sel.note}` : ''}. <span class="muted small">Added by ${nameOf(sel.by)}.</span></span>
        ${canLeave(sel.soeid) && html`<button class="btn sm" data-click="rota.leaveCancel" data-v="${sel.id}">Cancel this leave</button>`}
        <button class="btn ghost sm" data-click="rota.leaveSel" data-v="">Close</button></div>`}

      ${u.wsel && weekPanel(u.wsel, v, lead)}

      <details class="small muted cal-foot"><summary>How the rota works</summary>
        <p>One list runs the rota: who is the Proci each week. The Proci is Main Proci Monday–Thursday and Weekend Support, and rests Friday and the Monday after. The Backup is next week's Proci on Monday and Friday and last week's Proci Tuesday–Thursday; on Friday last week's Proci is Main. If the Main Proci is on leave, the Backup moves up and the Proci two weeks ahead (Backup ×2) becomes Backup. Click a leave bar to see or cancel it; click a day with no person picked to show that week in the shift grid.</p>
      </details>
    </section>`
  }

  // ---------- Proci queue (round robin), Team Management → Schedule & coverage ----------
  // The shift grid's rows are the queue: the top row is the Proci of the "Starts" week,
  // the next row the week after, and so on round. A lead drags rows (or uses the arrows),
  // then saves. Below the grid, the coming weeks with their Backups and leave clashes;
  // "Swap" trades one week with the next without touching the rest.
  // Starts this week by default, so the top row is always the current Proci.
  const qui = () => S.ui('p:team:pq', () => ({ draft: null, from: mondayOf(today()), drag: null, over: null }))
  // The order as it runs from a week: the queue in force, rotated so `from` comes first.
  function orderFrom(from, v = view()) {
    const q = queueFor(from, v)
    const active = qm.roster.filter((p) => p.active !== false)
    if (q) {
      const k = Math.round((parse(from) - parse(q.from)) / (7 * DAY))
      const i = ((k % q.order.length) + q.order.length) % q.order.length
      return [...q.order.slice(i), ...q.order.slice(0, i)]
    }
    // No queue yet: a suggestion from the weeks set so far, then everyone else.
    const set = [...v.weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    const ahead = [...new Set(set.filter(([w]) => w >= from).map(([, s]) => s))]
    const last = new Map(set.map(([w, s]) => [s, w]))
    const rest = active.map((p) => p.soeid).filter((s) => !ahead.includes(s)).sort((a, b) => (last.get(a) || '9').localeCompare(last.get(b) || '9') || nameOf(a).localeCompare(nameOf(b)))
    return [...ahead, ...rest].filter((s) => active.some((p) => p.soeid === s))
  }
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

  // The queue as the shift grid shows it: its rows are the queue, in order (drag to reorder).
  function pqState() {
    const v = view()
    const me = qm.me()
    const lead = !!me && me.accessRole === 'Lead'
    const u = qui()
    const saved = orderFrom(u.from, v)
    const order = u.draft || saved
    return { v, lead, u, order, dirty: !!u.draft && !sameList(u.draft, saved), hasQueue: v.orders.length > 0, from: u.from, thisWeek: mondayOf(today()) }
  }
  // Start week, Save / Discard: shown in the grid's card when there's something to save.
  function pqControls(st = pqState()) {
    if (!st.lead) return ''
    const { u, v, dirty, hasQueue, order, thisWeek } = st
    const overrides = [...v.weeks.keys()].filter((w) => w >= u.from)
    const startOpts = Array.from({ length: 8 }, (_, i) => addDays(thisWeek, 7 * i))
    return html`<div class="${cls('pq-bar', (dirty || !hasQueue) && 'on')}">
      ${icon('swap', 15)}
      <span class="small">${dirty ? html`<b>Proci order changed.</b>` : !hasQueue ? html`<b>No Proci queue saved yet.</b> This order is a suggestion.` : html`<b>Proci queue</b>`} <span class="muted">Drag rows to reorder; the top row is the Proci of the start week, the next row the week after, and so on round.</span></span>
      <span class="spacer"></span>
      <label class="row tight small"><span class="muted">Starts</span><select class="in sm" data-change="rota.qFrom" aria-label="Queue starts the week of">${startOpts.map((w) => html`<option value="${w}" ${S.attrs({ selected: w === u.from })}>${fmtDay(w, { day: 'numeric', month: 'short' })}${w === thisWeek ? ' (this week)' : ''}</option>`)}</select></label>
      ${dirty && html`<button class="btn ghost sm" data-click="rota.qDiscard">Discard</button>`}
      ${(dirty || !hasQueue) && html`<button class="btn primary sm" data-click="rota.qSave" ${S.attrs({ disabled: order.length < 3, title: overrides.length ? `${overrides.length} one-off week${overrides.length > 1 ? 's' : ''} from then on will follow the new order` : null })}>${icon('check', 14)}Save order</button>`}
    </div>`
  }
  // Which coming week a person is next the Proci (from the queue), for the row label.
  function nextProciWeek(soeid, st = pqState()) {
    const i = st.order.indexOf(soeid)
    return i < 0 ? null : addDays(st.from, 7 * i)
  }

  const moveIn = (list, s, to) => { const a = list.filter((x) => x !== s); a.splice(Math.max(0, Math.min(to, a.length)), 0, s); return a }
  const qList = () => { const u = qui(); return u.draft || orderFrom(u.from) }

  // A week picked on the calendar: its Proci and Backups, leave clashes, swap.
  function weekPanel(w, v, lead) {
    const P = procOf(w, v); const nxt = procOf(addDays(w, 7), v); const one = v.weeks.has(w)
    const away = P ? [0, 1, 2, 3, 5, 6].map((i) => addDays(w, i)).filter((d) => onLeave(P, d, v)) : []
    return html`<div class="callout rota-sel">${icon('swap', 16)}<span style="flex:1">
        Week of <b>${fmtDay(w, { day: 'numeric', month: 'short' })}</b>: Proci <b>${P ? nameOf(P) : 'not set'}</b>${one && html` <span class="pill">this week only</span>`}
        <span class="muted small">· Backup Tue–Thu ${first(procOf(addDays(w, -7), v)) || '—'} · Mon &amp; Fri ${first(nxt) || '—'} · Backup ×2 ${first(procOf(addDays(w, 14), v)) || '—'}</span>
        ${away.length > 0 && html`<div class="warn-t small">⚠ ${first(P)} is on leave ${away.map((d) => fmtDay(d, { weekday: 'short' })).join(', ')}. Scope moves the Backup up on those days; swap if they're away all week.</div>`}
      </span>
      ${lead && (one ? html`<button class="btn sm" data-click="rota.qUnswap" data-v="${w}">Back to queue</button>`
        : html`<button class="btn sm" data-click="rota.qSwap" data-v="${w}" ${S.attrs({ disabled: !P || !nxt })}>${icon('swap', 13)}Swap with next week</button>`)}
      <button class="btn ghost sm" data-click="rota.calShowWeek" data-v="${w}">Show in shift grid</button>
      <button class="btn ghost sm" data-click="rota.calWeek" data-v="">Close</button>
    </div>`
  }

  // Upcoming leave, as a list next to the calendar.
  function leaveCard() {
    const v = view()
    const upcoming = v.leaves.filter((l) => l.to >= addDays(today(), -7))
    return html`<div class="card"><div class="card-h"><b>Upcoming leave</b><span class="muted small">Anyone can add their own; a lead can add anyone's. The rota adjusts by itself.</span></div>
      ${upcoming.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Person</th><th>From</th><th>To</th><th class="r">Days</th><th>Note</th><th></th></tr></thead>
        <tbody>${upcoming.map((l) => html`<tr data-key="${l.id}"><td class="nowrap">${nameOf(l.soeid)}</td><td class="nowrap">${fmtDay(l.from)}</td><td class="nowrap">${fmtDay(l.to)}</td><td class="r">${dayDiff(l.from, l.to) + 1}</td><td class="small">${l.note}</td>
          <td>${canLeave(l.soeid) && html`<button class="btn ghost sm" data-click="rota.leaveCancel" data-v="${l.id}">Cancel</button>`}</td></tr>`)}</tbody></table></div>`
        : html`<div class="card-b empty small">No leave coming up.</div>`}
    </div>`
  }

  // ---------- Exports ----------
  S.rota = { view, dayRoles, procOf, queueFor, pqState, pqControls, nextProciWeek, roleOf, onLeave, mondayOf, addDays, today, parse, fmtDay, rotaCalendar, leaveCard, leaveBars, addLeave, removeLeaveDay, canLeave, _test: { fold, dayRoles } }

  // ---------- Handlers ----------
  S.on({
    'rota.qDragStart': (el, ev) => { if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', el.dataset.v) } S.set(qui(), { drag: el.dataset.v }) },
    'rota.qDragOver': (el, ev) => { const u = qui(); if (!u.drag) return; ev.preventDefault(); if (u.over !== el.dataset.v) S.set(u, { over: el.dataset.v }) },
    'rota.qDrop': (el, ev) => {
      ev.preventDefault()
      const u = qui()
      const s = u.drag
      if (!s || s === el.dataset.v) { S.set(u, { drag: null, over: null }); return }
      const list = qList()
      S.set(u, { draft: moveIn(list, s, list.indexOf(el.dataset.v)), drag: null, over: null })
    },
    'rota.qDragEnd': () => S.set(qui(), { drag: null, over: null }),
    'rota.qMove': (el) => { const list = qList(); S.set(qui(), { draft: moveIn(list, el.dataset.v, list.indexOf(el.dataset.v) + Number(el.dataset.d)) }) },
    'rota.qRemove': (el) => S.set(qui(), { draft: qList().filter((s) => s !== el.dataset.v) }),
    'rota.qAdd': (el) => S.set(qui(), { draft: [...qList(), el.dataset.v] }),
    'rota.qFrom': (el) => { const u = qui(); S.set(u, { from: el.value, draft: u.draft && !sameList(u.draft, orderFrom(u.from)) ? u.draft : null }) },
    'rota.qDiscard': () => S.set(qui(), { draft: null }),
    'rota.qSave': async () => {
      const u = qui()
      const order = qList()
      if (order.length < 3) return
      if (!(await qm.send({ type: 'rotaOrderSet', from: u.from, order }))) return
      // One-off weeks from then on would hide the new order, so they go back to the queue.
      for (const w of [...view().weeks.keys()].filter((x) => x >= u.from)) if (!(await qm.send({ type: 'rotaSet', week: w, soeid: null }))) return
      S.set(u, { draft: null })
      S.dispatch({ type: 'toast', text: `Proci queue saved: ${nameOf(order[0])} from the week of ${fmtDay(u.from, { day: 'numeric', month: 'short' })}, then ${order.slice(1, 3).map(first).join(', ')}…` })
    },
    'rota.qSwap': async (el) => {
      const w = el.dataset.v; const n = addDays(w, 7)
      const a = procOf(w); const b = procOf(n)
      if (!a || !b) return
      if ((await qm.send({ type: 'rotaSet', week: w, soeid: b })) && (await qm.send({ type: 'rotaSet', week: n, soeid: a }))) S.dispatch({ type: 'toast', text: `Swapped: ${first(b)} the week of ${fmtDay(w, { day: 'numeric', month: 'short' })}, ${first(a)} the week after` })
    },
    'rota.qUnswap': async (el) => { if (await qm.send({ type: 'rotaSet', week: el.dataset.v, soeid: null })) S.dispatch({ type: 'toast', text: `The week of ${fmtDay(el.dataset.v, { day: 'numeric', month: 'short' })} follows the queue again` }) },
    'rota.calMonth': (el) => S.set(ui(), { month: el.dataset.v, sel: null }),
    'rota.calMode': (el) => S.set(ui(), { mode: el.dataset.v, who: null, lvStart: null }),
    'rota.calWho': (el) => { const u = ui(); S.set(u, { who: u.who === el.dataset.v ? null : el.dataset.v, lvStart: null }) },
    'rota.calNote': (el) => { ui().note = el.value },
    'rota.calCancel': () => S.set(ui(), { lvStart: null }),
    'rota.calWeek': (el) => { const u = ui(); S.set(u, { wsel: el.dataset.v && u.wsel !== el.dataset.v ? el.dataset.v : null, sel: null }) },
    'rota.calShowWeek': (el) => { if (S.schedule) S.schedule.showWeek(el.dataset.v); const g = document.getElementById('sched-grid'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    'rota.calDay': async (el) => {
      const u = ui()
      const day = el.dataset.v
      const me = qm.me()
      const lead = !!me && me.accessRole === 'Lead'
      const mode = lead ? u.mode : 'leave'
      const who = lead ? u.who : me && me.soeid
      if (mode === 'proci') {
        if (!lead || who === null || who === undefined) { if (S.schedule) S.schedule.showWeek(mondayOf(day)); return }
        const wk = mondayOf(day)
        const q = fromQueue(wk)
        const target = who && who !== q ? who : null // null: follow the queue
        const cur = view().weeks.has(wk) ? view().weeks.get(wk) : null
        if (cur === target) return
        if (await qm.send({ type: 'rotaSet', week: wk, soeid: target })) S.dispatch({ type: 'toast', text: target ? `${nameOf(target)} is the Proci for the week of ${fmtDay(wk, { day: 'numeric', month: 'short' })} (this week only)` : `The week of ${fmtDay(wk, { day: 'numeric', month: 'short' })} follows the queue${q ? `: ${nameOf(q)}` : ''}` })
        return
      }
      if (!who) { if (S.schedule) S.schedule.showWeek(mondayOf(day)); return }
      if (!u.lvStart) { S.set(u, { lvStart: day, sel: null }); return }
      const [from, to] = [u.lvStart, day].sort()
      S.set(u, { lvStart: null })
      const r = await addLeave(who, from, to, u.note.trim())
      if (r === 'already') S.dispatch({ type: 'toast', text: `${first(who)} is already on leave then` })
      else if (r) { u.note = ''; S.dispatch({ type: 'toast', text: `Leave added for ${nameOf(who)}: ${fmtDay(from)}${from !== to ? ` – ${fmtDay(to)}` : ''}` }) }
    },
    'rota.leaveSel': (el) => { const u = ui(); S.set(u, { sel: el.dataset.v && u.sel !== el.dataset.v ? el.dataset.v : null }) },
    'rota.leaveCancel': async (el) => { if (await qm.send({ type: 'leaveCancel', id: el.dataset.v })) { const u = ui(); if (u.sel === el.dataset.v) u.sel = null; S.dispatch({ type: 'toast', text: 'Leave cancelled' }) } },
  })
})()
