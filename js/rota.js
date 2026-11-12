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
// Stored in the shared ops log: rotaSet (lead), leaveAdd / leaveCancel (the person or a lead).
;(function () {
  const { html, cls, attrs, icon, uid } = S
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
    const weeks = new Map() // monday -> soeid
    const log = []
    const leaves = new Map()
    for (const ev of events) {
      const e = ev.e || {}
      if (e.type === 'rotaSet' && isLead(ev.by) && /^\d{4}-\d{2}-\d{2}$/.test(e.week || '')) {
        const wk = mondayOf(e.week)
        log.push({ week: wk, from: weeks.get(wk) || null, to: e.soeid || null, by: ev.by, at: ev.at })
        if (e.soeid) weeks.set(wk, e.soeid); else weeks.delete(wk)
      } else if (e.type === 'leaveAdd' && e.id && e.soeid && (ev.by === e.soeid || isLead(ev.by)) && e.from && e.to && e.from <= e.to) {
        leaves.set(e.id, { id: e.id, soeid: e.soeid, from: e.from, to: e.to, note: e.note || '', by: ev.by, at: ev.at, cancelled: false })
      } else if (e.type === 'leaveCancel') {
        const l = leaves.get(e.id)
        if (l && (ev.by === l.soeid || isLead(ev.by))) Object.assign(l, { cancelled: true, cancelledBy: ev.by })
      }
    }
    return { weeks, log, leaves: [...leaves.values()].filter((l) => !l.cancelled).sort((a, b) => a.from.localeCompare(b.from)) }
  }
  function view() {
    if (memo.events !== qm.events || memo.roster !== qm.roster) memo = { events: qm.events, roster: qm.roster, v: fold(qm.events || []) }
    return memo.v
  }
  const onLeave = (soeid, day, v = view()) => !!soeid && v.leaves.some((l) => l.soeid === soeid && l.from <= day && day <= l.to)

  // ---------- Who holds what on a day ----------
  function dayRoles(day, v = view()) {
    const wk = mondayOf(day)
    const P = (n) => v.weeks.get(addDays(wk, 7 * n)) || null
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
    if (!v.weeks.has(mondayOf(day))) return null
    const r = dayRoles(day, v)
    if (r.weekend === soeid) return 'WEEKEND_SUPPORT'
    if (r.main === soeid) return 'MAIN_PROCI'
    if (r.backup === soeid) return 'PROCI_BACKUP'
    if (r.rest.includes(soeid)) return 'REST'
    return 'ANALYST'
  }

  // ---------- Team Management → Proci rota ----------
  const ui = () => S.ui('p:team:rota', () => ({ week: mondayOf(today()), lv: { soeid: '', from: today(), to: today(), note: '' }, lvTried: false }))
  const WD = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  function personCell(s, normal) {
    if (!s) return html`<span class="pill warn">Gap</span>`
    return html`<span class="${cls(normal !== undefined && s !== normal && 'rota-changed')}">${nameOf(s)}</span>`
  }

  function rotaPanel() {
    if (location.protocol === 'file:' || !qm.loadedAt) return html`<div class="card"><div class="card-b empty">The rota lives on the Scope Lite server. Start Scope with run.bat or share.bat.</div></div>`
    const v = view()
    const me = qm.me()
    const lead = me && me.accessRole === 'Lead'
    const u = ui()
    const thisWeek = mondayOf(today())
    const weeks = Array.from({ length: 10 }, (_, i) => addDays(thisWeek, 7 * (i - 2)))
    const people = qm.roster.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name))
    const days = Array.from({ length: 7 }, (_, i) => dayRoles(addDays(u.week, i), v))
    const P = (n) => v.weeks.get(addDays(u.week, 7 * n))
    return html`<div class="stack" style="gap:16px">
      <div class="callout accent">${icon('cal', 16)}<span><b>One list runs the rota: who is the Proci each week.</b> The Proci is Main Proci Monday–Thursday and Weekend Support, and rests Friday and the Monday after. The Backup is next week's Proci on Monday and Friday and last week's Proci Tuesday–Thursday; on Friday last week's Proci is Main. If the Main Proci is on leave, the Backup moves up and the Proci two weeks ahead (Backup ×2) becomes Backup. ${lead ? 'You can set the Proci per week.' : 'A lead sets the Proci per week.'}</span></div>

      <div class="card"><div class="card-h"><b>Proci by week</b><span class="muted small">Scope works out every day's roles from this list</span></div>
        <div class="tbl-wrap"><table class="tbl rota-weeks">
          <thead><tr><th>Week of</th><th>Proci</th><th>Backup Tue–Thu <span class="muted">(P−1)</span></th><th>Backup Mon &amp; Fri <span class="muted">(P+1)</span></th><th>Backup ×2 <span class="muted">(P+2)</span></th></tr></thead>
          <tbody>${weeks.map((w) => { const g = (n) => v.weeks.get(addDays(w, 7 * n)); return html`<tr data-key="${w}" class="${cls(w === u.week && 'sel')}">
            <td class="nowrap"><button class="btn ghost sm" data-click="rota.week" data-v="${w}">${fmtDay(w, { day: 'numeric', month: 'short', year: 'numeric' })}</button>${w === thisWeek && html` <span class="pill sky">This week</span>`}</td>
            <td>${lead ? html`<select class="in" aria-label="Proci for the week of ${w}" data-change="rota.set" data-w="${w}">
                <option value="">Not set</option>${people.map((p) => html`<option value="${p.soeid}" ${attrs({ selected: g(0) === p.soeid })}>${p.name}</option>`)}</select>`
              : g(0) ? html`<b>${nameOf(g(0))}</b>` : html`<span class="muted">Not set</span>`}</td>
            <td>${g(-1) ? nameOf(g(-1)) : html`<span class="muted">—</span>`}</td>
            <td>${g(1) ? nameOf(g(1)) : html`<span class="muted">—</span>`}</td>
            <td>${g(2) ? nameOf(g(2)) : html`<span class="muted">—</span>`}</td></tr>` })}</tbody>
        </table></div>
      </div>

      <div class="card">
        <div class="card-h">
          <button class="btn ghost sm" data-click="rota.week" data-v="${addDays(u.week, -7)}" aria-label="Previous week">${icon('chevL', 15)}</button>
          <b>Week of ${fmtDay(u.week, { day: 'numeric', month: 'long', year: 'numeric' })}</b>
          <button class="btn ghost sm" data-click="rota.week" data-v="${addDays(u.week, 7)}" aria-label="Next week">${icon('chevR', 15)}</button>
          <span class="muted small">Proci ${P(0) ? html`<b>${nameOf(P(0))}</b>` : 'not set'} · P−1 ${nameOf(P(-1)) || '—'} · P+1 ${nameOf(P(1)) || '—'} · P+2 ${nameOf(P(2)) || '—'}</span>
        </div>
        <div class="tbl-wrap"><table class="tbl rota-days">
          <thead><tr><th>Day</th><th>Main Proci</th><th>Proci Backup</th><th>Weekend Support</th><th>Rest</th><th>On leave</th><th>Changes</th></tr></thead>
          <tbody>${days.map((d) => { const weekendDay = d.wd >= 5; const away = v.leaves.filter((l) => l.from <= d.day && d.day <= l.to); return html`<tr data-key="${d.day}" class="${cls(d.day === today() && 'sel')}">
            <td class="nowrap"><b>${WD[d.wd]}</b> <span class="muted small">${fmtDay(d.day, { day: 'numeric', month: 'short' })}</span></td>
            <td>${weekendDay ? (d.weekend ? nameOf(d.weekend) : html`<span class="muted">—</span>`) : personCell(d.main, d.normal.main)}</td>
            <td>${weekendDay ? html`<span class="muted">none</span>` : personCell(d.backup, d.normal.backup)}</td>
            <td>${weekendDay ? personCell(d.weekend, d.normal.weekend) : ''}</td>
            <td>${d.rest.map(nameOf).join(', ')}</td>
            <td>${away.map((l) => nameOf(l.soeid)).join(', ')}</td>
            <td class="small">${[...d.notes, ...d.gaps.map((g) => `⚠️ ${g}`)].join(' · ')}</td></tr>` })}</tbody>
        </table></div>
      </div>

      <div class="muted small">Leave is entered on the <b>Schedule &amp; coverage</b> tab; the rota adjusts by itself.</div>
    </div>`
  }

  // Leave card (rendered on Team Management → Schedule & coverage).
  function leaveCard() {
    const v = view()
    const me = qm.me()
    const lead = me && me.accessRole === 'Lead'
    const u = ui()
    const people = qm.roster.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name))
    const upcoming = v.leaves.filter((l) => l.to >= addDays(today(), -7))
    const lvErr = !u.lv.soeid ? 'Pick a person.' : !u.lv.from || !u.lv.to ? 'Add both dates.' : u.lv.from > u.lv.to ? 'The end is before the start.' : null
    return html`<div class="stack" style="gap:0">
      <div class="card"><div class="card-h"><b>Leave</b><span class="muted small">Anyone can add their own; a lead can add anyone's. The rota adjusts by itself.</span></div>
        <div class="card-b stack" style="gap:12px">
          <div class="form-grid rota-leave">
            <label class="field"><span>Person</span><select class="in" data-change="rota.lv" data-f="soeid">
              <option value="">Pick a person</option>${people.filter((p) => lead || (me && p.soeid === me.soeid)).map((p) => html`<option value="${p.soeid}" ${attrs({ selected: u.lv.soeid === p.soeid })}>${p.name}</option>`)}</select></label>
            <label class="field"><span>From</span><input class="in" type="date" value="${u.lv.from}" data-change="rota.lv" data-f="from"></label>
            <label class="field"><span>To</span><input class="in" type="date" value="${u.lv.to}" data-change="rota.lv" data-f="to"></label>
            <label class="field"><span>Note <span class="hint">optional</span></span><input class="in" maxlength="120" value="${u.lv.note}" data-input="rota.lvNote" placeholder="e.g. vacation, sick"></label>
          </div>
          <div class="row">${u.lvTried && lvErr && html`<span class="qm-err" role="alert">${lvErr}</span>`}<span class="spacer"></span><button class="btn primary sm" data-click="rota.leaveAdd">${icon('plus', 14)}Add leave</button></div>
          ${upcoming.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Person</th><th>From</th><th>To</th><th>Note</th><th></th></tr></thead>
            <tbody>${upcoming.map((l) => html`<tr data-key="${l.id}"><td>${nameOf(l.soeid)}</td><td>${fmtDay(l.from)}</td><td>${fmtDay(l.to)}</td><td class="small">${l.note}</td>
              <td>${(lead || (me && me.soeid === l.soeid)) && html`<button class="btn ghost sm" data-click="rota.leaveCancel" data-v="${l.id}">Cancel</button>`}</td></tr>`)}</tbody></table></div>`
            : html`<div class="empty small">No leave coming up.</div>`}
        </div>
      </div>
    </div>`
  }

  // ---------- Exports ----------
  S.rota = { view, dayRoles, roleOf, onLeave, mondayOf, addDays, today, parse, fmtDay, rotaPanel, leaveCard, _test: { fold, dayRoles } }

  // ---------- Handlers ----------
  S.on({
    'rota.week': (el) => S.set(ui(), { week: el.dataset.v }),
    'rota.set': async (el) => { if (await qm.send({ type: 'rotaSet', week: el.dataset.w, soeid: el.value || null })) S.dispatch({ type: 'toast', text: el.value ? `${nameOf(el.value)} is the Proci for the week of ${fmtDay(el.dataset.w, { day: 'numeric', month: 'short' })}` : 'Proci cleared for that week' }) },
    'rota.lv': (el) => { const u = ui(); S.set(u, { lv: { ...u.lv, [el.dataset.f]: el.value } }) },
    'rota.lvNote': (el) => { ui().lv.note = el.value },
    'rota.leaveAdd': async () => {
      const u = ui()
      const l = u.lv
      if (!l.soeid || !l.from || !l.to || l.from > l.to) { S.set(u, { lvTried: true }); return }
      if (await qm.send({ type: 'leaveAdd', id: uid('lv'), soeid: l.soeid, from: l.from, to: l.to, note: l.note.trim() })) {
        S.set(u, { lv: { soeid: '', from: today(), to: today(), note: '' }, lvTried: false })
        S.dispatch({ type: 'toast', text: `Leave added for ${nameOf(l.soeid)}` })
      }
    },
    'rota.leaveCancel': async (el) => { if (await qm.send({ type: 'leaveCancel', id: el.dataset.v })) S.dispatch({ type: 'toast', text: 'Leave cancelled' }) },
  })
})()
