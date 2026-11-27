// 3-Strike: the On Hold follow-up BAU (vault: 3-Strike Process; senior's review 2026-11-24).
//
// 3-Strike is its own ServiceNow queue, split into regional views, each worked in a window
// (PHT) from the team's 3-Strike Monitoring Schedule. The queues and windows are Team
// settings (queue.js). For each window:
//  - Someone loads that view's export (Load ServiceNow export → pick the 3-Strike queue).
//  - While the window is open and before its cutoff, any open browser hands its tickets out
//    automatically to everyone scheduled today, to whoever has the fewest tickets today
//    (INC received + 3-Strike given), so Base INC + 3-Strike evens out.
//  - After the cutoff, automatic hand-out stops. The day's Main Proci, Proci Backup,
//    Weekend Support or a lead can still hand out or move tickets by hand, at any time.
//  - The analyst logs the contact attempt (Reached / Not reached) in Queue Management →
//    3-Strike. Strike 3 not reached = Resolved.
//  - A ticket handed out with no attempt by the end of the window is "Not finished in
//    window": it stays on that person's end-of-day report with that label (senior's request).
//    One handed out after the window closed (by hand) has until the end of the day.
// A ticket already attempted today isn't handed out again in a later window the same day.
// The events and the fold live in queue.js (strikeAssign, strikeLog).
;(function () {
  const { html, cls, attrs, icon } = S
  const Q = () => S.queue
  const qm = S.qm
  const DAY = 864e5
  const first = (soeid) => (Q().nameOf(soeid) || '').split(' ')[0]
  const today = () => Q().dayOf(Date.now())
  const dayStart = (day) => new Date(`${day}T00:00:00`).getTime()

  // ---------- Windows ----------
  function windowOf(q, day) {
    const d0 = dayStart(day)
    const start = Q().at(d0, q.start)
    const end = Q().at(d0, q.end)
    return { start, end, cutoff: end - (Number(q.cutoff) || 0) * 60e3, eod: d0 + DAY }
  }
  function phase(win, now) {
    return now < win.start ? 'upcoming' : now < win.cutoff ? 'open' : now < win.end ? 'cutoff' : 'closed'
  }
  const PHASE = { upcoming: ['plain', 'Not open yet'], open: ['good', 'Open · handing out'], cutoff: ['warn', 'Past cutoff · Proci or lead hands out'], closed: ['plain', 'Closed'] }
  const strikeQueues = (v = Q().view()) => v.queues.filter((q) => q.kind === 'strike')

  // The latest load of this queue's export on that day.
  const loadOf = (v, qid, day) => v.imports.filter((x) => x.queue === qid && x.day === day).pop() || null

  // Every ticket of one window: what its export holds, plus anything handed out in it.
  function windowRows(q, day, now = Date.now(), v = Q().view()) {
    const key = `${day}|${q.id}`
    const win = windowOf(q, day)
    const load = loadOf(v, q.id, day)
    const ns = new Set(load ? load.ns : [])
    const out = []
    for (const t of v.tickets) {
      const w = t.sk.find((x) => x.key === key)
      if (!w && !ns.has(t.n)) continue
      let status
      if (w && w.log) status = 'done'
      else if (w) status = now >= (w.at >= win.end ? win.eod : win.end) ? 'missed' : 'pending'
      else if (t.strikeClosed && !w) status = 'closed'
      else if (t.sk.some((x) => x.day === day && x.log && x.key !== key)) status = 'tried'
      else status = now >= win.end ? 'unhanded' : now < win.start ? 'upcoming' : 'waiting'
      out.push({ t, w, status, q, day, key, win, next: Math.min(3, Q().strikeCount(t) + (w && w.log ? 0 : 1)) })
    }
    const rank = { waiting: 0, pending: 1, missed: 2, unhanded: 3, upcoming: 4, done: 5, tried: 6, closed: 7 }
    return out.sort((a, b) => rank[a.status] - rank[b.status] || a.t.n.localeCompare(b.t.n))
  }
  // All of one day's 3-Strike assignments, per person: { soeid: { qid: { given, done, missed, pending } } }.
  function dayCounts(day, now = Date.now(), v = Q().view()) {
    const by = new Map()
    for (const q of strikeQueues(v)) {
      for (const r of windowRows(q, day, now, v)) {
        if (!r.w) continue
        if (!by.has(r.w.to)) by.set(r.w.to, {})
        const m = by.get(r.w.to)
        const c = m[q.id] || (m[q.id] = { given: 0, done: 0, missed: 0, pending: 0 })
        c.given++; c[r.status === 'done' ? 'done' : r.status === 'missed' ? 'missed' : 'pending']++
      }
    }
    return by
  }

  // ---------- Hand-out ----------
  // Pure: the window's waiting tickets go one by one to whoever has the fewest tickets today
  // (INC received today + verified manual + 3-Strike given today). Ties: name.
  function plan(rows, day, now, override = false) {
    const people = Q().scheduledToday(now)
    const v = Q().view()
    const counts = new Map(people.map((p) => [p.soeid, Q().loadToday(p.soeid, now, v.tickets).total]))
    for (const t of v.tickets) for (const w of t.sk) if (w.day === day && counts.has(w.to)) counts.set(w.to, counts.get(w.to) + 1)
    const list = []
    const extra = new Map() // given in this batch, for each person's daily limit (Team roster → In queue)
    for (const r of rows.filter((x) => x.status === 'waiting' || (override && x.status === 'unhanded'))) {
      const who = people.filter((p) => Q().underLimit(p, extra.get(p.soeid) || 0, now)).sort((a, b) => counts.get(a.soeid) - counts.get(b.soeid) || a.person.name.localeCompare(b.person.name))[0]
      if (!who) break
      list.push({ n: r.t.n, to: who.soeid, reason: `${override ? 'Handed out by hand' : 'Window open'}: fewest tickets today (${counts.get(who.soeid)}, INC + 3-Strike) of ${people.length} scheduled` })
      counts.set(who.soeid, counts.get(who.soeid) + 1); extra.set(who.soeid, (extra.get(who.soeid) || 0) + 1)
    }
    return { list, people }
  }
  async function handOut(q, day, override = false) {
    const now = Date.now()
    const p = plan(windowRows(q, day, now), day, now, override)
    if (p.list.length) await qm.send({ type: 'strikeAssign', day, queue: q.id, override, list: p.list })
    return p
  }

  // Automatic: after any render, if a window is open (before its cutoff) and has tickets
  // nobody has, hand them out. One attempt per browser at a time, at most every 10 s;
  // first hand-out wins in the log, so two browsers racing don't double-assign.
  let busy = false; let last = 0
  S.after(() => {
    if (busy || !qm.online || !qm.me() || !qm.loadedAt || Date.now() - last < 10e3) return
    const v = Q().view()
    if (v.settings.autoHandout === false || v.settings.autoHandout === 'false') return
    const now = Date.now(); const day = today()
    const q = strikeQueues(v).find((x) => x.active && phase(windowOf(x, day), now) === 'open' && windowRows(x, day, now, v).some((r) => r.status === 'waiting'))
    if (!q || !Q().scheduledToday(now).length) return
    busy = true; last = now
    handOut(q, day).then((p) => { if (p.list.length) S.dispatch({ type: 'toast', text: `3-Strike · ${q.name}: handed out ${p.list.length} ticket${p.list.length > 1 ? 's' : ''}` }) })
      .finally(() => { busy = false })
  })

  // ---------- Bits ----------
  const strikePill = (r) => html`<span class="${cls('pill strike-pill', r.next >= 3 ? 'crit' : r.next === 2 ? 'warn' : '')}" title="${Q().strikeCount(r.t)} of 3 contact attempts done before this one">Strike ${r.next}/3</span>`
  const STATUS = {
    waiting: ['warn', 'Waiting'], pending: ['sky', 'To do'], missed: ['crit', 'Not finished in window'], unhanded: ['crit', 'Not handed out'],
    upcoming: ['plain', 'Window not open'], done: ['good', 'Done'], tried: ['plain', 'Attempted earlier today'], closed: ['plain', 'Resolved after Strike 3'],
  }
  function statusPill(r) {
    if (r.status === 'done') {
      const l = r.w.log
      return html`<span class="${cls('pill', l.reached ? 'good' : l.strike >= 3 ? 'navy' : 'sky')}" title="Attempt logged by ${Q().nameOf(l.by)} at ${S.fmtTime(l.at)}">${l.reached ? 'Done · reached' : l.strike >= 3 ? 'Done · Strike 3, Resolved' : 'Done · not reached'}</span>`
    }
    const [tone, label] = STATUS[r.status]
    return html`<span class="${cls('pill', tone)}">${label}</span>`
  }
  const winLabel = (q) => `${q.start}–${q.end} · cutoff ${Q().strikeCutoff(q)}`

  // ---------- Home → 3-Strike (everyone sees it; Proci and leads can hand out and move) ----------
  function homeTab(me) {
    const v = Q().view()
    const day = today()
    const now = Date.now()
    const can = Q().canOverrideStrikes(me.soeid, day)
    const people = Q().scheduledToday(now)
    const qs = strikeQueues(v).filter((q) => q.active)
    if (!qs.length) return html`<div class="card-b empty">No 3-Strike queues in use. A lead sets them in Team Management → Team settings → Queues.</div>`
    return html`<div class="card-b stack lg" style="padding-top:12px">
      <div class="row tight small muted">
        <span>Windows in Philippine time, from Team settings → Queues.</span><span class="spacer"></span>
        ${S.infoTip('strike-rules', '3-Strike', html`
          <span>Each region's 3-Strike view is worked in its window. Load the view's export (Load ServiceNow export → pick the 3-Strike queue); while the window is open its tickets are handed out <b>automatically</b> to everyone scheduled today, to whoever has the <b>fewest tickets today (INC + 3-Strike)</b>.</span>
          <span><b>Cutoff:</b> automatic hand-out stops at the cutoff. The day's Main Proci, Proci Backup, Weekend Support or a lead can still hand out or move tickets at any time.</span>
          <span>Each attempt is a contact by Teams or phone; add <b>Contact attempt1/2/3</b> to the ServiceNow short description as usual. Log it in My queue → 3-Strike. <b>Strike 3 not reached:</b> Resolved; set it Resolved in ServiceNow too.</span>
          <span><b>Not finished in window:</b> handed out but no attempt logged by the end of the window. It stays on the person's end-of-day report with that label. A ticket attempted earlier today isn't handed out again in a later window.</span>`)}
      </div>
      ${qs.map((q) => {
        const win = windowOf(q, day)
        const ph = phase(win, now)
        const rows = windowRows(q, day, now, v)
        const load = loadOf(v, q.id, day)
        const waiting = rows.filter((r) => r.status === 'waiting' || r.status === 'unhanded').length
        return html`<div class="stack strike-win" style="gap:8px" data-key="${q.id}">
          <div class="row tight">
            <b>${q.name}</b><span class="muted small">${winLabel(q)}</span>
            <span class="${cls('pill', PHASE[ph][0])}">${PHASE[ph][1]}</span>
            <span class="spacer"></span>
            <span class="small muted">${load ? `Loaded ${S.fmtTime(load.at)} by ${first(load.by)} · ${load.rows} tickets` : 'Export not loaded today'}</span>
            ${can && waiting > 0 && people.length > 0 && ph !== 'upcoming' && html`<button class="btn sm primary" data-click="strike.handout" data-v="${q.id}" title="Hand out now to whoever has the fewest tickets today">${icon('send', 13)}Hand out ${waiting}</button>`}
          </div>
          ${rows.length ? html`<div class="tbl-wrap"><table class="tbl qm-compact strike-tbl">
            <colgroup><col><col style="width:92px"><col style="width:30%"><col style="width:24%"></colgroup>
            <thead><tr><th>Ticket</th><th>Strike</th><th>With</th><th>Status</th></tr></thead>
            <tbody>${rows.map((r) => html`<tr data-key="${r.t.n}">
              <td>${Q().incLink(r.t.n, r.t.sysId)}<div class="muted small clip">${r.t.short}</div></td>
              <td>${r.status === 'closed' ? '' : strikePill(r)}</td>
              <td>${can && r.w && !r.w.log ? html`<select class="in sm strike-who" aria-label="Move ${r.t.n}" data-change="strike.move" data-v="${r.t.n}" data-q="${q.id}">${qm.roster.filter((p) => p.active !== false).map((p) => html`<option value="${p.soeid}" ${attrs({ selected: p.soeid === r.w.to })}>${p.name}</option>`)}</select>`
                : r.w ? html`<span class="small">${Q().nameOf(r.w.to)}</span>${r.w.override && html` <span class="muted small" title="${r.w.reason}">· by hand</span>`}` : html`<span class="muted small">—</span>`}</td>
              <td>${statusPill(r)}</td>
            </tr>`)}</tbody></table></div>`
          : html`<div class="empty small">${load ? 'Nothing in this view today.' : ph === 'closed' ? 'No export was loaded for this window.' : 'Load this view\'s export when the window opens.'}</div>`}
        </div>`
      })}
    </div>`
  }

  // ---------- Queue Management → 3-Strike (my attempts today) ----------
  function mine(me, now = Date.now()) {
    const day = today()
    return strikeQueues().flatMap((q) => windowRows(q, day, now)).filter((r) => r.w && r.w.to === me.soeid)
  }
  function analystTab(me) {
    const list = mine(me)
    if (!list.length) return html`<div class="empty">No 3-Strike tickets for you today. They're handed out automatically when a region's window opens.</div>`
    return html`<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>INC</th><th>Short description</th><th>Region</th><th>Strike</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map((r) => html`<tr data-key="${r.key}|${r.t.n}">
        <td>${Q().incLink(r.t.n, r.t.sysId)}</td>
        <td class="clip">${r.t.short}</td>
        <td class="nowrap small">${r.q.name}<div class="muted">${r.status === 'pending' ? `until ${S.fmtTime(r.w.at >= r.win.end ? r.win.eod - 60e3 : r.win.end)}` : r.q.start + '–' + r.q.end}</div></td>
        <td>${strikePill(r)}</td>
        <td>${statusPill(r)}</td>
        <td>${r.status === 'pending' && html`<div class="row tight nowrap">
          <button class="btn sm" data-click="strike.log" data-v="${r.t.n}" data-k="${r.key}" data-r="1">${icon('check', 13)}Reached</button>
          <button class="${cls('btn sm', r.next === 3 ? 'danger' : '')}" data-click="strike.log" data-v="${r.t.n}" data-k="${r.key}" data-r="0" title="${r.next === 3 ? 'Strike 3: the ticket is Resolved. Set it Resolved in ServiceNow too.' : `Strike ${r.next} done; the next one is the next working day`}">${r.next === 3 ? 'Not reached · Resolve' : 'Not reached'}</button></div>`}</td>
      </tr>`)}</tbody></table></div>`
  }

  S.strike = {
    windowOf, phase, windowRows, dayCounts, strikeQueues, plan, homeTab, analystTab, statusPill,
    rows: () => strikeQueues().filter((q) => q.active).flatMap((q) => windowRows(q, today())).filter((r) => ['waiting', 'pending'].includes(r.status)),
    pendingFor: (me) => mine(me).filter((r) => r.status === 'pending').length,
  }
  S.on({
    'strike.handout': async (el) => {
      const q = Q().view().queues.find((x) => x.id === el.dataset.v)
      if (!q) return
      const p = await handOut(q, today(), true)
      S.dispatch({ type: 'toast', text: p.list.length ? `3-Strike · ${q.name}: handed out ${p.list.length}` : 'Nobody is scheduled today' })
    },
    'strike.move': async (el) => {
      const me = qm.me()
      if (await qm.send({ type: 'strikeAssign', day: today(), queue: el.dataset.q, override: true, list: [{ n: el.dataset.v, to: el.value, reason: `Moved by ${Q().nameOf(me && me.soeid)}` }] })) S.dispatch({ type: 'toast', text: `${el.dataset.v} moved to ${Q().nameOf(el.value)}` })
      else S.render()
    },
    'strike.log': async (el) => {
      const n = el.dataset.v
      const reached = el.dataset.r === '1'
      const r = mine(qm.me()).find((x) => x.t.n === n && x.key === el.dataset.k)
      if (!r) return
      if (!reached && r.next === 3 && !confirm(`${n}: Strike 3 and the user wasn't reached. Scope tags it Resolved; set it Resolved in ServiceNow too. Continue?`)) return
      if (await qm.send({ type: 'strikeLog', n, key: r.key, reached })) {
        S.dispatch({ type: 'toast', text: reached ? `${n}: user reached on Strike ${r.next}` : r.next === 3 ? `${n} Resolved after Strike 3` : `${n}: Strike ${r.next} logged` })
      }
    },
  })
})()
