// Queue: real INC tickets from the ServiceNow export, handed out automatically.
//
// Replaces the team's QueueManager tool (vault: QueueManager Mechanics, D13–D18):
//  - Team settings: SLA/SLO targets, shift times, EERS keywords. Lead edits, everyone follows.
//  - Sign-in records today's role and shift (shiftStart) for attendance; it doesn't decide
//    who gets tickets.
//  - Import: drop the ServiceNow CSV. Rows are deduped by INC number; a row only
//    replaces what we have when its sys_updated_on is newer. The description is
//    read once for the EERS keywords and never stored (it's full of personal data).
//  - Assignment: the moment tickets load, EERS tickets go to today's Proci Backup and
//    the rest to whoever holds the fewest open tickets, among everyone scheduled
//    to work today (lead, 2026-11-19; signed in or not). Every assignment carries its
//    reason. ServiceNow's "assigned to" doesn't decide it: every ticket is shared out.
//    With "Hand out automatically" on (Team settings), any open browser hands out new
//    unassigned tickets as soon as they load, so nobody has to press a button.
//  - Rebalance (anyone; also automatic for untouched tickets): moves tickets so today's handled counts are even,
//    and moves tickets off people who aren't working today (leave, rest day).
//  - My tickets: a working view. The owner tags each ticket (Assigned / On Hold /
//    Transferred / Resolved) and adds notes. Transferred counts as handled (D17).
//
// Everything is an event in the shared ops log (see qm.js), folded the same way in
// every browser. ServiceNow stays the system of record: nothing is written back.
;(function () {
  const { html, cls, attrs, icon, uid } = S
  const qm = S.qm
  const HOUR = 3600e3
  const INC_RE = /^INC\d{7,}$/
  const TAGS = ['Assigned', 'On Hold', 'Transferred', 'Resolved']
  const TAG_TONE = { Assigned: 'sky', 'On Hold': 'warn', Transferred: 'navy', Resolved: 'good' }
  const OPEN_TAGS = ['Assigned', 'On Hold']
  const CHUNK = 150 // rows per import event, to stay well under the server's body limit

  // ---------- Team settings (D14) ----------
  // Seeded from QueueManager's tbl_GlobalSettings / tbl_Queues / tbl_Shifts (2026-11-12).
  const SETTINGS = [
    // SLA targets (team, 2026-11-24): regular INC 4 h, EERS 1 h, critical 30 min.
    // Critical = priority 1 in the export; it beats EERS when a ticket is both.
    { key: 'inc.sloHours', group: 'Targets', label: 'Regular INC: SLO', unit: 'hours', type: 'num', def: 4 },
    { key: 'inc.slaHours', group: 'Targets', label: 'Regular INC: SLA', unit: 'hours', type: 'num', def: 4 },
    { key: 'eers.sloHours', group: 'Targets', label: 'EERS: SLO', unit: 'hours', type: 'num', def: 1 },
    { key: 'eers.slaHours', group: 'Targets', label: 'EERS: SLA', unit: 'hours', type: 'num', def: 1 },
    { key: 'crit.sloHours', group: 'Targets', label: 'Critical (P1): SLO', unit: 'hours (0.5 = 30 minutes)', type: 'num', def: 0.5 },
    { key: 'crit.slaHours', group: 'Targets', label: 'Critical (P1): SLA', unit: 'hours (0.5 = 30 minutes)', type: 'num', def: 0.5 },
    { key: 'early.start', group: 'Shifts', label: 'Early shift starts', type: 'time', def: '05:00' },
    { key: 'early.end', group: 'Shifts', label: 'Early shift ends', type: 'time', def: '14:00' },
    { key: 'late.start', group: 'Shifts', label: 'Late shift starts', type: 'time', def: '06:00' },
    { key: 'late.end', group: 'Shifts', label: 'Late shift ends', type: 'time', def: '15:00' },
    { key: 'minEarly', group: 'Shifts', label: 'At least on Early', unit: 'people, each weekday', type: 'num', def: 2 },
    { key: 'minLate', group: 'Shifts', label: 'At least on Late', unit: 'people, each weekday', type: 'num', def: 1 },
    { key: 'cutoffMinutes', group: 'Shifts', label: 'Stop handing out tickets', unit: 'minutes before the shift ends', type: 'num', def: 30 },
    { key: 'eersKeywords', group: 'Assignment', label: 'EERS keywords', unit: 'whole words, comma-separated, in the short description or description', type: 'text', def: 'EERS, #EERS' }, // QueueManager's keywords (lead, 2026-11-19; 'entitlement' matched too much)
    { key: 'autoHandout', group: 'Assignment', label: 'Hand out new tickets automatically', unit: 'as soon as they load, to everyone scheduled today', type: 'bool', def: true },
    { key: 'pool.mainProci', group: 'Assignment', label: 'Main Proci gets regular tickets', type: 'bool', def: true },
    { key: 'pool.backup', group: 'Assignment', label: 'Proci Backup gets regular tickets too', type: 'bool', def: true },
    { key: 'uploadReminder', group: 'Data', label: 'Remind to load a new export after', unit: 'minutes', type: 'num', def: 45 },
    { key: 'snowUrl', group: 'Data', label: 'ServiceNow address', unit: 'e.g. https://yourcompany.service-now.com: every INC number opens that ticket in ServiceNow', type: 'url', def: '' },
    { key: 'exportTz', group: 'Data', label: 'Time zone of the export\'s dates', type: 'tz', def: 'local' },
  ]
  const TZ_OPTIONS = [['local', "Same as this computer's clock"], ...Array.from({ length: 27 }, (_, i) => i - 12).flatMap((h) => (h === 5 ? [[String(h), 'UTC+5'], ['5.5', 'UTC+5:30']] : [[String(h), h === 0 ? 'UTC' : `UTC${h > 0 ? '+' : ''}${h}`]]))]
  const def = Object.fromEntries(SETTINGS.map((s) => [s.key, s.def]))

  // ---------- Queues (Team settings) ----------
  // Each ServiceNow export Scope loads belongs to a queue. The standard INC queue runs all
  // day. 3-Strike queues are separate ServiceNow views, one per region, each worked in its
  // own window (PHT) from the team's 3-Strike Monitoring Schedule (lead, 2026-11-24). Their
  // tickets are handed out automatically when the window opens, until the cutoff; after the
  // cutoff only the Proci or a lead hands out. A ticket handed out but not attempted by
  // the end of the window is "Not finished in window". Times are edited here when daylight
  // saving moves the regions' working hours.
  const DEFAULT_QUEUES = [
    { id: 'inc', kind: 'inc', name: 'Standard INC', view: '', start: '', end: '', cutoff: 0, active: true },
    { id: 'strike-nam', kind: 'strike', name: 'NAM & LATAM', view: 'NAM - 3 Strike (2 Hours)', start: '06:00', end: '08:00', cutoff: 30, active: true },
    { id: 'strike-apac-xin', kind: 'strike', name: 'APAC (excl. India)', view: 'APAC (Excluding India) - 3 Strike (2 Hours)', start: '08:00', end: '11:30', cutoff: 30, active: true },
    { id: 'strike-apac', kind: 'strike', name: 'APAC (incl. India)', view: 'APAC - 3 Strike (2 Hours)', start: '11:30', end: '16:00', cutoff: 30, active: true },
  ]
  const TIME_RE = /^\d{2}:\d{2}$/
  function cleanQueue(q) {
    if (!q || typeof q !== 'object' || !/^[a-z0-9-]{2,40}$/.test(q.id || '')) return null
    const kind = q.id === 'inc' ? 'inc' : 'strike'
    const out = { id: q.id, kind, name: String(q.name || '').trim().slice(0, 60), view: String(q.view || '').trim().slice(0, 120), start: String(q.start || ''), end: String(q.end || ''), cutoff: Math.max(0, Number(q.cutoff) || 0), active: q.active !== false }
    if (!out.name) return null
    if (kind === 'strike' && !(TIME_RE.test(out.start) && TIME_RE.test(out.end) && out.start < out.end)) return null
    return out
  }

  // ---------- Fold ----------
  // Memoised on the loaded log: every render reads the same folded view.
  let memo = { events: null }
  const isLead = (soeid) => ((qm.roster.find((p) => p.soeid === soeid) || {}).accessRole === 'Lead')
  const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

  // ---------- 3-Strike ----------
  // Strikes done: the higher of what Scope logged since the ticket went On Hold and
  // "Contact attempt N" in the ServiceNow short description (the team writes it there).
  const ATTEMPT_RE = /contact\s*attempt\s*#?\s*([123])/i
  // Strikes done: the higher of the attempts Scope logged since the user was last reached
  // and "Contact attempt N" in the ServiceNow short description.
  function strikeCount(t) {
    const m = ATTEMPT_RE.exec(t.short || '')
    const logs = (t.sk || []).map((w) => w.log).filter(Boolean).sort((a, b) => a.at - b.at)
    let logged = 0
    for (const l of logs) logged = l.reached ? 0 : logged + 1
    return Math.max(m ? Number(m[1]) : 0, logged)
  }
  // Who can hand out or move 3-Strike tickets by hand, at any time (also after the cutoff):
  // the day's Main Proci, Proci Backup or Weekend Support, or a lead (lead, 2026-11-24).
  function canOverrideStrikes(soeid, day) {
    if (isLead(soeid)) return true
    const r = S.rota && S.rota.dayRoles(day)
    return !!r && (r.main === soeid || r.backup === soeid || r.weekend === soeid)
  }
  const TIME_DAY_RE = /^\d{4}-\d{2}-\d{2}$/
  const queueName = (queues, id) => ((queues.find((q) => q.id === id) || {}).name || id)

  function fold(events) {
    const undone = new Set(events.filter((ev) => ev.e && ev.e.type === 'importUndo').filter((ev) => {
      const imp = events.find((x) => x.e && x.e.type === 'ticketsImported' && x.e.importId === ev.e.importId)
      return imp && (ev.by === imp.by || isLead(ev.by))
    }).map((ev) => ev.e.importId))
    const settings = { ...def }
    const settingsLog = []
    let queues = DEFAULT_QUEUES.map((q) => ({ ...q }))
    const inQueue = new Map() // `${day}|${soeid}` -> { on, limit, by, at }
    let queuesBy = null
    const presence = new Map() // `${day}|${soeid}` -> { soeid, duty, shift, at }
    const tickets = new Map()
    const imports = new Map()
    for (const ev of events) {
      const e = ev.e || {}
      if (e.type === 'settingsSet' && isLead(ev.by) && e.values && typeof e.values === 'object') {
        for (const [k, v] of Object.entries(e.values)) if (k in def) { settingsLog.push({ key: k, from: settings[k], to: v, by: ev.by, at: ev.at }); settings[k] = v }
      } else if (e.type === 'queueSet' && TIME_DAY_RE.test(e.day || '') && e.soeid && (isLead(ev.by) || canOverrideStrikes(ev.by, e.day))) {
        // Team roster → In queue (lead, 2026-11-27): put someone in or out of today's hand-out
        // whether or not they've signed in, with an optional ticket limit for the day.
        const lim = Number(e.limit)
        inQueue.set(`${e.day}|${e.soeid}`, { on: e.on === null || e.on === undefined ? null : !!e.on, limit: lim > 0 ? Math.floor(lim) : null, by: ev.by, at: ev.at })
      } else if (e.type === 'queuesSet' && isLead(ev.by) && Array.isArray(e.queues)) {
        const list = e.queues.map(cleanQueue).filter(Boolean)
        if (list.some((q) => q.id === 'inc') && new Set(list.map((q) => q.id)).size === list.length) { queues = list; queuesBy = { by: ev.by, at: ev.at } }
      } else if (e.type === 'shiftStart' && e.day) {
        presence.set(`${e.day}|${ev.by}`, { soeid: ev.by, duty: e.duty, shift: e.shift, at: ev.at, day: e.day, edited: !!e.edited })
      } else if (e.type === 'ticketsImported' && !undone.has(e.importId) && Array.isArray(e.rows)) {
        // queue: which export this is (older loads have none: the standard INC queue).
        const qid = /^[a-z0-9-]{2,40}$/.test(e.queue || '') ? e.queue : 'inc'
        const strikeQ = qid !== 'inc'
        const imp = imports.get(e.importId) || { id: e.importId, queue: qid, by: ev.by, at: ev.at, day: dayOf(ev.at), file: e.file || '', total: e.total || 0, rows: 0, added: 0, updated: 0, ns: [] }
        imports.set(e.importId, imp)
        for (const r of e.rows) {
          if (!r || !INC_RE.test(r.n)) continue
          imp.rows++; imp.ns.push(r.n)
          let t = tickets.get(r.n)
          if (!t) {
            t = { ...r, eers: strikeQ ? '' : r.eers, firstSeen: ev.at, incSeen: strikeQ ? null : ev.at, importId: e.importId, lastImport: strikeQ ? null : e.importId, to: null, assignedAt: null, reason: '', assignedBy: null, tag: 'Assigned', tagAt: null, tagBy: null, notes: [], history: [], opens: [], sk: [] }
            tickets.set(r.n, t)
            imp.added++
          } else {
            if ((r.updated || 0) > (t.updated || 0)) { const keep = t.eers; Object.assign(t, r); if (strikeQ) t.eers = keep; imp.updated++ } else if (!strikeQ) { t.eers = r.eers; t.sn = r.sn } // keywords may have changed
            if (!strikeQ) { t.lastImport = e.importId; if (!t.incSeen) t.incSeen = ev.at }
          }
        }
      } else if (e.type === 'ticketsAssigned' && !undone.has(e.importId) && Array.isArray(e.list)) {
        for (const a of e.list) {
          const t = a && tickets.get(a.n)
          const target = a && qm.roster.find((p) => p.soeid === a.to)
          if (!t || !target) continue
          if (t.to && !(e.override && qm.roster.some((p) => p.soeid === ev.by))) continue // first assignment wins; anyone on the roster can move a ticket (lead, 2026-11-19)
          t.history.push({ kind: 'assign', to: a.to, what: t.to ? `moved from ${nameOf(t.to)} to ${target.name}` : `assigned to ${target.name}`, by: ev.by, at: ev.at, note: a.reason || '' })
          Object.assign(t, { to: a.to, assignedAt: ev.at, reason: a.reason || '', assignedBy: ev.by })
        }
      } else if (e.type === 'ticketTag' && TAGS.includes(e.tag)) {
        const t = tickets.get(e.n)
        if (t && (ev.by === owner(t) || isLead(ev.by))) {
          const res = e.tag === 'Resolved' && e.res && typeof e.res === 'object' && /^[A-Z]{2,5}-[A-Z]{2,5}-\d{2,3}$/.test(e.res.code || '') ? { ...e.res, by: ev.by, at: ev.at } : null
          t.history.push({ kind: 'tag', tag: e.tag, what: `tagged ${e.tag}${res ? ` with ${res.code}` : ''}`, by: ev.by, at: ev.at, note: '' })
          Object.assign(t, { tag: e.tag, tagAt: ev.at, tagBy: ev.by, res: e.tag === 'Resolved' ? res : null })
          // On Hold: the ticket leaves this queue in ServiceNow for the user's regional
          // 3-Strike queue, and comes back to Scope through that queue's export.
        }
      } else if (e.type === 'strikeAssign' && TIME_DAY_RE.test(e.day || '') && /^[a-z0-9-]{2,40}$/.test(e.queue || '') && Array.isArray(e.list)) {
        // A 3-Strike window's tickets handed out: automatically by any browser while the
        // window is open (first hand-out wins), or by the day's Proci or a lead at any time
        // (override: moves a ticket, or hands out after the cutoff).
        const over = !!e.override
        if (over && !canOverrideStrikes(ev.by, e.day)) continue
        if (!qm.roster.some((p) => p.soeid === ev.by)) continue
        const key = `${e.day}|${e.queue}`
        for (const a of e.list) {
          const t = a && tickets.get(a.n)
          if (!t || !qm.roster.some((p) => p.soeid === a.to)) continue
          const w = t.sk.find((x) => x.key === key)
          if (w && (!over || w.log)) continue // first hand-out wins; an attempted one stays put
          if (w) Object.assign(w, { to: a.to, at: ev.at, by: ev.by, reason: String(a.reason || ''), override: true })
          else t.sk.push({ key, day: e.day, queue: e.queue, to: a.to, at: ev.at, by: ev.by, reason: String(a.reason || ''), override: over, log: null })
          t.history.push({ what: `3-Strike ${e.day} (${queueName(queues, e.queue)}) ${w ? 'moved' : 'given'} to ${nameOf(a.to)}`, by: ev.by, at: ev.at, note: String(a.reason || '') })
        }
      } else if (e.type === 'strikeLog') {
        // A contact attempt on a handed-out 3-Strike ticket. Reached: logged, and the ticket
        // carries on in ServiceNow. Not reached: the next strike. Not reached on Strike 3:
        // Resolved (set it Resolved in ServiceNow too).
        const t = tickets.get(e.n)
        const w = t && t.sk.find((x) => x.key === e.key)
        if (!w || w.log || !(ev.by === w.to || canOverrideStrikes(ev.by, w.day))) continue
        const n = strikeCount(t) + 1
        w.log = { strike: n, reached: !!e.reached, by: ev.by, at: ev.at }
        if (e.reached) t.history.push({ what: `reached the user on Strike ${n}`, by: ev.by, at: ev.at, note: '' })
        else if (n >= 3) {
          t.history.push({ what: 'Strike 3: user not reached, Resolved', by: ev.by, at: ev.at, note: '' })
          Object.assign(t, { tag: 'Resolved', tagAt: ev.at, tagBy: ev.by, res: null, strikeClosed: true })
        } else t.history.push({ what: `Strike ${n}: user not reached`, by: ev.by, at: ev.at, note: '' })
      } else if (e.type === 'ticketOpened') {
        // Someone clicked the INC link to open the ticket in ServiceNow. Every click is kept;
        // the history shows the first one per person after each assignment.
        const t = tickets.get(e.n)
        if (!t || !qm.roster.some((p) => p.soeid === ev.by)) continue
        if (!t.opens.some((o) => o.by === ev.by && o.at >= (t.assignedAt || 0))) t.history.push({ kind: 'open', what: 'opened it in ServiceNow', by: ev.by, at: ev.at, note: '' })
        t.opens.push({ by: ev.by, at: ev.at })
      } else if (e.type === 'ticketNote' && String(e.text || '').trim()) {
        const t = tickets.get(e.n)
        if (t) t.notes.push({ by: ev.by, at: ev.at, text: String(e.text).trim() })
      }
    }
    // The INC queue is whatever the latest standard INC export holds.
    const latest = [...imports.values()].filter((x) => x.queue === 'inc').pop() || null
    for (const t of tickets.values()) t.inLatest = !!latest && t.lastImport === latest.id
    // Resolution code library, built only from real resolutions (the first use of a code names it).
    const codes = new Map()
    for (const t of tickets.values()) {
      if (!t.res) continue
      const c = codes.get(t.res.code) || { code: t.res.code, cause: t.res.cause, sub: t.res.sub, title: t.res.title, runbook: t.res.runbook || '', uses: 0, first: t.res.at, tickets: [] }
      if (t.res.at < c.first) Object.assign(c, { title: t.res.title, runbook: t.res.runbook || '', first: t.res.at })
      c.uses++; c.tickets.push(t.n)
      codes.set(c.code, c)
    }
    return { settings, settingsLog, queues, queuesBy, inQueue, presence, tickets: [...tickets.values()], ticketMap: tickets, imports: [...imports.values()], latest, undone, codes: [...codes.values()].sort((a, b) => a.code.localeCompare(b.code)) }
  }
  function view() {
    if (memo.events !== qm.events || memo.roster !== qm.roster) memo = { events: qm.events, roster: qm.roster, v: fold(qm.events || []) }
    return memo.v
  }

  // ---------- People, shifts, load ----------
  const nameOf = (soeid) => ((qm.roster.find((p) => p.soeid === soeid) || {}).name || soeid)
  // The ticket's owner: whoever Scope assigned it to, else the roster person ServiceNow names.
  // The ticket's owner is whoever Scope gave it to. ServiceNow's "assigned to" doesn't decide
  // it (lead, 2026-11-19, replaces D20): every ticket in the export is shared evenly across
  // everyone scheduled today, and the analyst reassigns it in ServiceNow to match.
  function owner(t) {
    return t.to || null
  }
  // The active team member ServiceNow names in "assigned to", if any (shown, never used to assign).
  const snMember = (t) => (t.sn ? qm.roster.find((x) => x.active !== false && norm(x.name) === norm(t.sn)) || null : null)
  const minutes = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return (h || 0) * 60 + (m || 0) }
  const at = (now, hhmm) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() + minutes(hhmm) * 60e3 }
  function shiftWindow(shiftId, s, now) {
    const k = shiftId === 'LATE' ? 'late' : 'early' // the weekend runs on Early hours
    const start = at(now, s[`${k}.start`])
    const end = at(now, s[`${k}.end`])
    return { start, end, cutoff: end - (Number(s.cutoffMinutes) || 0) * 60e3 }
  }
  // People signed in today with a shift, from the shared log. When the week's Proci
  // is set in the rota, the rota decides who is Main, Backup and Weekend Support
  // (rota.js); otherwise the role picked at sign-in counts. People on leave drop out.
  function onShift(now = Date.now()) {
    const v = view()
    const day = dayOf(now)
    return [...v.presence.values()].filter((p) => p.day === day)
      .map((p) => {
        // A change made after signing in (with a reason) beats the rota.
        const r = !p.edited && S.rota ? S.rota.roleOf(p.soeid, day) : null
        return { ...p, duty: r && r !== 'REST' ? r : p.duty, fromRota: !!r, person: qm.roster.find((x) => x.soeid === p.soeid), w: shiftWindow(p.shift, v.settings, now) }
      })
      .filter((p) => p.person && p.person.active !== false && p.duty !== 'LEAVE')
      .sort((a, b) => a.person.name.localeCompare(b.person.name))
  }
  // Who shares today's tickets (lead, 2026-11-19): everyone SCHEDULED to work today in Team
  // Management (a shift, not on leave, not a rest day), whether or not they have signed in yet.
  // Signing in doesn't decide it, so the first person in doesn't get the whole backlog.
  // Role: a change made after signing in (with a reason) wins; otherwise the rota's.
  function scheduledToday(now = Date.now()) {
    if (!S.schedule) return []
    const day = dayOf(now)
    const signed = new Map([...view().presence.values()].filter((p) => p.day === day).map((p) => [p.soeid, p]))
    return qm.roster.filter((p) => p.active !== false).map((person) => inQueueToday(person, day, signed))
      .filter((p) => p.ok).sort((a, b) => a.person.name.localeCompare(b.person.name))
  }
  // Is this person in today's hand-out? (Team roster → In queue, lead 2026-11-27.)
  //  - On leave: never.
  //  - Signed in today: always (automatic).
  //  - Not signed in (late, for example): out, unless a lead or the day's Proci switches them
  //    on in Team Management → Roster → In queue (lead, 2026-11-27; replaces "everyone
  //    scheduled shares, signed in or not" of 2026-11-19). Switched on, they get their equal
  //    share as if they were online.
  // limit: the most tickets they get today (INC + 3-Strike handed out), or null.
  function inQueueToday(person, day = dayOf(Date.now()), signed = null) {
    const pl = S.schedule.planFor(person.soeid, day)
    const pres = signed || new Map([...view().presence.values()].filter((p) => p.day === day).map((p) => [p.soeid, p]))
    const pr = pres.get(person.soeid)
    const duty = pr && pr.edited ? pr.duty : pl.role || 'ANALYST'
    const leave = pl.role === 'LEAVE' || duty === 'LEAVE'
    const scheduled = !!pl.shift && pl.shift !== 'OFF' && pl.role !== 'REST'
    const set = view().inQueue.get(`${day}|${person.soeid}`) || null
    const why = leave ? 'leave' : pr ? 'signed' : set && set.on != null ? 'toggle' : 'offline'
    const ok = !leave && (!!pr || (!!set && set.on === true))
    return { soeid: person.soeid, person, duty, shift: pl.shift, w: { cutoff: Infinity }, ok, why, scheduled, signedIn: !!pr, limit: set ? set.limit : null, set }
  }
  // Tickets given to someone today, for the limit: INC that became theirs + 3-Strike handed out.
  function givenToday(soeid, now = Date.now(), tickets = view().tickets) {
    const day = dayOf(now)
    return loadToday(soeid, now, tickets).tickets + tickets.reduce((a, t) => a + (t.sk || []).filter((w) => w.day === day && w.to === soeid).length, 0)
  }
  const underLimit = (p, extra = 0, now = Date.now()) => !p.limit || givenToday(p.soeid, now) + extra < p.limit
  const startOfDay = (now) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() }
  // What each person holds now: open tickets on them (Assigned or On Hold), whatever day
  // they got them. Distribution and rebalancing even THIS out (lead, 2026-11-19: "all
  // tickets must be evenly distributed"), so tickets carried over from earlier days count.
  const openLoad = (soeid, tickets = view().tickets) => tickets.filter((x) => isOpen(x) && owner(x) === soeid).length
  // Handled today = tickets that became theirs today (any tag, Transferred included)
  // plus verified manual entries handled today (D12). Shown as "+N new today"; no longer
  // what distribution balances on.
  function loadToday(soeid, now = Date.now(), tickets = view().tickets) {
    const from = startOfDay(now)
    const t = tickets.filter((x) => owner(x) === soeid && (x.to ? x.assignedAt : x.firstSeen) >= from).length
    const m = (qm.entries || []).filter((x) => x.by === soeid && x.status === 'Verified' && x.handledAt >= from).length
    return { total: t + m, tickets: t, manual: m }
  }

  // ---------- Health ----------
  // Which SLO/SLA a ticket is held to: critical (P1), else EERS, else regular INC.
  function targets(t, s) {
    const k = t.p === 1 ? 'crit' : t.eers ? 'eers' : 'inc'
    return { kind: { crit: 'Critical', eers: 'EERS', inc: 'Regular INC' }[k], slo: Number(s[`${k}.sloHours`]) * HOUR, sla: Number(s[`${k}.slaHours`]) * HOUR }
  }
  function health(t, s, now = Date.now()) {
    const { slo, sla } = targets(t, s)
    const untouched = now - (t.updated || t.opened || now)
    // Backlog (lead, 2026-11-24): created in ServiceNow before today's Early shift start, or
    // on an earlier day. Follows the Early shift time in Team settings.
    const created = t.created || t.opened || now
    return { untouched, sloBreached: untouched > slo, slaBreached: untouched > sla, backlog: created < at(now, s['early.start']) }
  }
  const isOpen = (t) => t.inLatest && OPEN_TAGS.includes(t.tag)
  // Total age counts from when the ticket was created in ServiceNow (sys_created_on, else
  // opened_at). Queue age counts from when it came into our INC queue: the export has no
  // "entered the group" date, so it's the first standard INC export Scope saw it in.
  const createdAt = (t) => t.created || t.opened || null
  const queuedAt = (t) => t.incSeen || t.firstSeen || null
  // SLA status: queue age against the team's SLO/SLA targets (EERS has its own).
  function queueHealth(t, s, now = Date.now()) {
    const { slo, sla } = targets(t, s)
    const q = queuedAt(t)
    const end = isOpen(t) ? now : (t.tagAt || now)
    const age = q ? Math.max(0, end - q) : 0
    return { age, slo, sla, kind: targets(t, s).kind, sloBreached: age > slo, slaBreached: age > sla }
  }

  // ---------- Automatic assignment (D15) ----------
  // Pure: given the folded tickets, who's scheduled today and the settings, decide who gets what.
  function plan({ tickets, people, settings, now, load }) {
    const pool = people.filter((p) => now < p.w.cutoff)
    const counts = new Map(pool.map((p) => [p.soeid, load(p.soeid)]))
    const last = new Map() // tie-break: whoever got a ticket least recently in this batch
    // Shared out: every ticket Scope hasn't given to anyone yet, whatever ServiceNow's
    // "assigned to" says (lead, 2026-11-19).
    const todo = tickets.filter((t) => t.inLatest && !t.to && !owner(t) && t.tag === 'Assigned')
      .sort((a, b) => (a.p || 9) - (b.p || 9) || (a.opened || 0) - (b.opened || 0))
    const regular = pool.filter((p) => (p.duty !== 'MAIN_PROCI' || settings['pool.mainProci'] !== false) && (p.duty !== 'PROCI_BACKUP' || settings['pool.backup'] !== false))
    const backups = pool.filter((p) => p.duty === 'PROCI_BACKUP')
    const extra = new Map() // given in this batch, for the daily limit
    const pick = (list) => list.filter((p) => underLimit(p, extra.get(p.soeid) || 0, now)).sort((a, b) => counts.get(a.soeid) - counts.get(b.soeid) || (last.get(a.soeid) || 0) - (last.get(b.soeid) || 0) || a.person.name.localeCompare(b.person.name))[0]
    const out = []
    const left = []
    let i = 0
    for (const t of todo) {
      let who; let why
      if (t.eers && backups.length) {
        who = pick(backups)
        why = `EERS (${t.eers}) → Proci Backup, who had ${counts.get(who.soeid)} open`
      } else {
        const list = regular.length ? regular : pool
        who = pick(list)
        if (who) why = `${t.eers ? `EERS (${t.eers}), but no Proci Backup on shift. ` : ''}Fewest open tickets (${counts.get(who.soeid)}) of ${list.length} on shift`
      }
      if (!who) { left.push(t); continue }
      if (t.sn) { const m = snMember(t); if (!m || m.soeid !== who.soeid) why += m ? `. In ServiceNow it's with ${m.name}: reassign it there` : '. In ServiceNow it\'s assigned to someone not on the active team: reassign it there' }
      out.push({ n: t.n, to: who.soeid, reason: why })
      counts.set(who.soeid, counts.get(who.soeid) + 1)
      extra.set(who.soeid, (extra.get(who.soeid) || 0) + 1)
      last.set(who.soeid, ++i)
    }
    return { list: out, left, pool }
  }
  async function handOut(importId) {
    const now = Date.now()
    const v = view()
    const p = plan({ tickets: v.tickets, people: scheduledToday(now), settings: v.settings, now, load: (s) => openLoad(s, v.tickets) })
    if (!p.list.length) return p
    for (let k = 0; k < p.list.length; k += 300) {
      if (!(await qm.send({ type: 'ticketsAssigned', importId: importId || null, list: p.list.slice(k, k + 300) }))) break
    }
    return p
  }

  // ---------- Rebalance (manual button for anyone, and automatic) ----------
  // Pure. Two kinds of move, both only for tickets Scope assigned that are still tagged
  // Assigned (On Hold means someone is working it; ServiceNow-assigned ones stay put):
  //  1. Off people who no longer get tickets (past cutoff, signed out, on leave).
  //  2. From whoever holds the most open tickets to whoever holds the fewest, until the
  //     gap is 1 or less. Any day's tickets can move (still Assigned, not EERS).
  // EERS tickets only move to a Proci Backup.
  // untouchedOnly (the automatic even-out): also skip any ticket updated in ServiceNow since
  // Scope gave it out, so a ticket someone has started on stays with them.
  function rebalancePlan({ tickets, people, now, load, untouchedOnly = false }) {
    const pool = people.filter((p) => now < p.w.cutoff)
    const inPool = new Set(pool.map((p) => p.soeid))
    const counts = new Map(pool.map((p) => [p.soeid, load(p.soeid)]))
    const backups = pool.filter((p) => p.duty === 'PROCI_BACKUP')
    const movable = tickets.filter((t) => t.inLatest && t.to && t.tag === 'Assigned' && (!untouchedOnly || (t.updated || 0) <= (t.assignedAt || 0)))
    const got = new Map()
    const open = (p) => underLimit(p, got.get(p.soeid) || 0, now)
    const least = (list) => list.filter(open).sort((a, b) => counts.get(a.soeid) - counts.get(b.soeid) || a.person.name.localeCompare(b.person.name))[0]
    const moves = []
    for (const t of movable.filter((x) => !inPool.has(x.to))) {
      const who = least(t.eers && backups.length ? backups : pool)
      if (!who) break
      moves.push({ n: t.n, from: t.to, to: who.soeid, reason: `Rebalanced: ${nameOf(t.to)} no longer gets tickets; ${who.person.name} had the fewest open (${counts.get(who.soeid)})` })
      counts.set(who.soeid, counts.get(who.soeid) + 1); got.set(who.soeid, (got.get(who.soeid) || 0) + 1)
    }
    const moved = new Set(moves.map((m) => m.n))
    const stuck = new Set() // people with nothing left that can move
    for (let guard = 0; guard < 500 && pool.length > 1; guard++) {
      const sorted = pool.slice().sort((a, b) => counts.get(b.soeid) - counts.get(a.soeid) || a.person.name.localeCompare(b.person.name))
      const hi = sorted.find((p) => !stuck.has(p.soeid))
      const lo = sorted.filter(open).pop()
      if (!hi || !lo || hi === lo || counts.get(hi.soeid) - counts.get(lo.soeid) <= 1) break
      const t = movable.filter((x) => x.to === hi.soeid && !moved.has(x.n) && !x.eers).sort((a, b) => (b.p || 9) - (a.p || 9) || b.assignedAt - a.assignedAt)[0]
      if (!t) { stuck.add(hi.soeid); continue } // nothing of theirs can move; look at the next person
      moves.push({ n: t.n, from: hi.soeid, to: lo.soeid, reason: `Rebalanced: ${hi.person.name} had ${counts.get(hi.soeid)} open, ${lo.person.name} ${counts.get(lo.soeid)}` })
      moved.add(t.n)
      counts.set(hi.soeid, counts.get(hi.soeid) - 1)
      counts.set(lo.soeid, counts.get(lo.soeid) + 1); got.set(lo.soeid, (got.get(lo.soeid) || 0) + 1)
    }
    return { moves, pool }
  }
  function rebalancePreview(now = Date.now(), untouchedOnly = false) {
    const v = view()
    return rebalancePlan({ tickets: v.tickets, people: scheduledToday(now), now, load: (s) => openLoad(s, v.tickets), untouchedOnly })
  }
  async function rebalance() {
    const handed = await handOut(null)
    const p = rebalancePreview()
    if (p.moves.length) await qm.send({ type: 'ticketsAssigned', override: true, list: p.moves.map(({ n, to, reason }) => ({ n, to, reason })) })
    // Still uneven after moving: say why the rest can't move.
    const now = Date.now(); const v = view()
    const people = scheduledToday(now)
    const counts = people.map((x) => openLoad(x.soeid, v.tickets))
    const spread = counts.length ? Math.max(...counts) - Math.min(...counts) : 0
    const why = !people.length ? 'Nobody is scheduled to work today.'
      : spread > 1 ? "The rest can't move: they're On Hold, EERS with the Proci Backup, or verified manual entries, which stay with their person." : ''
    return { handed: handed.list.length, moved: p.moves.length, why }
  }

  // Why open tickets are still waiting for an owner, in words (Home's "Waiting" card).
  function waitingReason(v = view(), now = Date.now()) {
    const waiting = v.tickets.filter((t) => isOpen(t) && !owner(t))
    if (!waiting.length) return null
    if (v.settings.autoHandout === false || v.settings.autoHandout === 'false') return 'Automatic hand-out is off in Team settings. Use Hand out in Team queue.'
    const on = scheduledToday(now)
    if (!on.length) return 'Nobody is in today\'s queue yet: people join when they sign in, or a lead switches them on in Team Management → Roster → In queue.'
    if (!plan({ tickets: v.tickets, people: on, settings: v.settings, now, load: (s) => openLoad(s, v.tickets) }).list.length) return 'Nobody scheduled today takes these tickets: check "Main Proci gets regular tickets" and "Proci Backup gets regular tickets too" in Team settings.'
    return 'Handing them out now…'
  }

  // ---------- Automatic hand-out ----------
  // After every render (new data arrives every 15 s), if there are unassigned tickets and
  // someone on shift can take them, hand them out. One attempt at a time per browser,
  // at most every 10 s; the log's first-assignment-wins rule absorbs two browsers racing.
  // Then even things out (lead, 2026-11-19): when someone scheduled today has 2+ more tickets
  // than someone else, untouched tickets (still Assigned and not updated in ServiceNow since
  // Scope gave them out) move to whoever has the fewest. Tickets of people not working today
  // (leave, rest day) move too. Every move records its reason; Rebalance stays as a button.
  let autoBusy = false; let autoLast = 0
  S.after(() => {
    if (autoBusy || !qm.online || !qm.me() || Date.now() - autoLast < 10e3) return
    const v = view()
    if (v.settings.autoHandout === false || v.settings.autoHandout === 'false') return
    const now = Date.now()
    const people = scheduledToday(now)
    const waiting = v.tickets.some((t) => t.inLatest && !t.to && !owner(t) && t.tag === 'Assigned') &&
      plan({ tickets: v.tickets, people, settings: v.settings, now, load: (s) => openLoad(s, v.tickets) }).list.length > 0
    const even = !waiting && rebalancePreview(now, true).moves
    if (!waiting && !(even && even.length)) return
    autoBusy = true; autoLast = now
    const run = waiting
      ? handOut(null).then((p) => { if (p.list.length) S.dispatch({ type: 'toast', text: `Handed out ${p.list.length} new ticket${p.list.length > 1 ? 's' : ''} automatically` }) })
      : qm.send({ type: 'ticketsAssigned', override: true, list: even.map(({ n, to, reason }) => ({ n, to, reason: `${reason} (automatic)` })) })
        .then((ok) => { if (ok) S.dispatch({ type: 'toast', text: `Evened out: moved ${even.length} untouched ticket${even.length > 1 ? 's' : ''}` }) })
    run.finally(() => { autoBusy = false })
  })


  // ---------- A new export loaded: tell everyone (lead, 2026-11-27) ----------
  // Every open browser except the one that loaded it shows who loaded it, how many tickets
  // were shared out and how many are theirs. (Each ticket of theirs also rings below.)
  let lastLoadSeen = null
  S.after(() => {
    const me = qm.me()
    if (!me || !qm.loadedAt) return
    const L = view().latest
    if (!L) return
    if (lastLoadSeen === null) { lastLoadSeen = L.id; return }
    if (L.id === lastLoadSeen) return
    lastLoadSeen = L.id
    if (L.by === me.soeid) return
    setTimeout(() => {
      const mine = view().tickets.filter((t) => t.to === me.soeid && t.assignedAt >= L.at && t.assignedAt < L.at + 5 * 60e3).length
      S.dispatch({ type: 'toast', text: `${nameOf(L.by).split(' ')[0]} loaded the ServiceNow export: ${L.added} new ticket${L.added === 1 ? '' : 's'}${mine ? ` · ${mine} for you` : ''}` })
    }, 2500)
  })

  // ---------- "Assigned to you": toast + sound ----------
  // When a ticket becomes mine (automatic hand-out, a rebalance or someone moving it to me),
  // this browser shows a toast and plays a short chime; the bell lists it under Needs action.
  // What was already mine when the page opened doesn't ring. The chime is a Web Audio tone
  // (no sound file); browsers only allow it after the first click on the page. Each person
  // can turn it off in the profile menu (kept in this browser).
  const SOUND_KEY = 'scope-lite-sound'
  const soundOn = () => S.storage ? S.storage.get(SOUND_KEY) !== 'off' : true
  let actx = null
  function chime() {
    if (!soundOn()) return
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)()
      if (actx.state === 'suspended') actx.resume()
      const t0 = actx.currentTime
      ;[[880, 0], [1320, 0.14]].forEach(([f, d]) => {
        const o = actx.createOscillator(); const g = actx.createGain()
        o.type = 'sine'; o.frequency.value = f
        g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.25, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.35)
        o.connect(g).connect(actx.destination); o.start(t0 + d); o.stop(t0 + d + 0.4)
      })
    } catch { /* audio blocked or unavailable: the toast and bell still show it */ }
  }
  // Unlock audio on the first click, so a later assignment can ring.
  window.addEventListener('pointerdown', () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume() } catch {} }, { once: true })
  let mineSeen = null; let mineFor = null
  S.after(() => {
    const me = qm.me()
    if (!me || !qm.loadedAt) return
    const keys = view().tickets.filter((t) => t.to === me.soeid && isOpen(t)).map((t) => `${t.n}|${t.assignedAt}`)
    if (mineFor !== me.soeid || !mineSeen) { mineSeen = new Set(keys); mineFor = me.soeid; return }
    const fresh = keys.filter((k) => !mineSeen.has(k))
    if (!fresh.length) return
    fresh.forEach((k) => mineSeen.add(k))
    const ns = fresh.map((k) => k.split('|')[0])
    chime()
    S.dispatch({ type: 'toast', text: ns.length === 1 ? `${ns[0]} was assigned to you` : `${ns.length} tickets were assigned to you` })
  })

  // ---------- CSV import ----------
  // RFC 4180: quoted fields, doubled quotes, line breaks inside quotes.
  function parseCsv(text) {
    const rows = []; let row = []; let f = ''; let q = false
    text = text.replace(/^﻿/, '')
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c
      } else if (c === '"') q = true
      else if (c === ',') { row.push(f); f = '' }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = '' }
      else f += c
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row) }
    return rows.filter((r) => r.some((x) => x.trim() !== ''))
  }
  // Try UTF-8 first; a file Excel saved in the Windows code page falls back to it.
  async function readText(file) {
    const buf = await file.arrayBuffer()
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'UTF-8' } } catch { return { text: new TextDecoder('windows-1252').decode(buf), enc: 'Windows-1252' } }
  }
  // ServiceNow column names, plus the display labels in case a list is exported with those.
  const COLS = {
    n: ['number'], opened: ['opened_at', 'opened'], priority: ['priority'], updated: ['sys_updated_on', 'updated'],
    short: ['short_description', 'short description'], desc: ['description'], state: ['state'],
    group: ['assignment_group', 'assignment group'], sn: ['assigned_to', 'assigned to'],
    createdBy: ['sys_created_by', 'created by'], location: ['location'],
    created: ['sys_created_on', 'created'], // optional: when the ticket was created (else opened_at)
    sysId: ['sys_id'], // optional: when the export includes it, the link opens the exact record
  }
  const REQUIRED = ['n', 'opened', 'updated', 'short', 'state', 'group', 'sn']
  const REQUIRED_STRIKE = ['n', 'opened', 'updated', 'short'] // the 3-Strike views' columns aren't confirmed yet
  const clean = (s) => String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\\\|/g, '|').replace(/\s+/g, ' ').trim()
  // "2026-11-11 09:26" or "2026-11-11 09:26:05", read in the export's time zone.
  function parseWhen(s, tz) {
    const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (!m) return null
    const [y, mo, d, h, mi, se] = m.slice(1).map((x) => Number(x || 0))
    return tz === 'local' || tz == null ? new Date(y, mo - 1, d, h, mi, se).getTime() : Date.UTC(y, mo - 1, d, h, mi, se) - Number(tz) * HOUR
  }
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  function eersMatch(short, desc, keywords) {
    for (const kw of String(keywords || '').split(',').map((k) => k.trim().replace(/^#/, '')).filter(Boolean)) {
      const re = new RegExp(`(^|[^A-Za-z0-9])#?${escRe(kw)}($|[^A-Za-z0-9])`, 'i')
      if (re.test(short)) return `"${kw}" in the short description`
      if (re.test(desc)) return `"${kw}" in the description`
    }
    return ''
  }
  function normalise(table, settings, strike = false) {
    const head = table[0].map((h) => h.trim().toLowerCase())
    const idx = {}
    for (const [k, names] of Object.entries(COLS)) idx[k] = head.findIndex((h) => names.includes(h))
    const missing = (strike ? REQUIRED_STRIKE : REQUIRED).filter((k) => idx[k] < 0).map((k) => COLS[k][0])
    if (missing.length) return { error: `This doesn't look like a ServiceNow incident export: no ${missing.join(', ')} column.` }
    const byN = new Map(); const skipped = []
    table.slice(1).forEach((r, i) => {
      const get = (k) => (idx[k] >= 0 ? r[idx[k]] || '' : '')
      const n = get('n').trim().toUpperCase()
      if (!INC_RE.test(n)) { skipped.push({ line: i + 2, why: n ? `"${n.slice(0, 20)}" isn't an INC number` : 'no INC number' }); return }
      const opened = parseWhen(get('opened'), settings.exportTz)
      const updated = parseWhen(get('updated'), settings.exportTz)
      if (opened == null || updated == null) { skipped.push({ line: i + 2, why: `${n}: unreadable opened or updated date` }); return }
      const short = clean(get('short')).slice(0, 300)
      const created = parseWhen(get('created'), settings.exportTz)
      const priority = clean(get('priority')).slice(0, 40)
      const row = {
        n, opened, ...(created != null && { created }), updated, short, priority, p: Number((priority.match(/^\d/) || [9])[0]),
        state: clean(get('state')).slice(0, 40), group: clean(get('group')).slice(0, 120), sn: clean(get('sn')).slice(0, 120),
        createdBy: clean(get('createdBy')).slice(0, 40), location: clean(get('location')).slice(0, 120),
        ...(/^[0-9a-f]{32}$/i.test(get('sysId').trim()) && { sysId: get('sysId').trim().toLowerCase() }),
        eers: eersMatch(short, clean(get('desc')), settings.eersKeywords), // the description itself is dropped here
      }
      const prev = byN.get(n)
      if (!prev || row.updated > prev.updated) byN.set(n, row)
    })
    return { rows: [...byN.values()], skipped, dupes: table.length - 1 - skipped.length - byN.size }
  }
  async function readFile(file) {
    const u = imp()
    if (!file) return
    if (!/\.csv$/i.test(file.name)) { S.set(u, { error: `${file.name} isn't a .csv file. Export the incident list as CSV.`, preview: null }); return }
    S.set(u, { busy: true, error: null, preview: null })
    const { text, enc } = await readText(file)
    const table = parseCsv(text)
    const qid = impQueue(table)
    const strike = qid !== 'inc'
    const out = normalise(table, view().settings, strike)
    if (out.error) { S.set(u, { busy: false, error: out.error }); return }
    u.file = file
    const known = new Map(view().tickets.map((t) => [t.n, t]))
    const fresh = out.rows.filter((r) => !known.has(r.n))
    const newer = out.rows.filter((r) => known.has(r.n) && r.updated > (known.get(r.n).updated || 0))
    const inFile = new Set(out.rows.map((r) => r.n))
    const gone = strike ? [] : view().tickets.filter((t) => t.inLatest && !inFile.has(t.n))
    S.set(u, { busy: false, preview: { queue: qid, file: file.name, enc, rows: out.rows, skipped: out.skipped, dupes: out.dupes, fresh: fresh.length, newer: newer.length, same: out.rows.length - fresh.length - newer.length, gone: gone.length, eers: out.rows.filter((r) => r.eers).length, snAssigned: out.rows.filter((r) => r.sn).length } })
  }
  async function confirmImport() {
    const u = imp()
    const pv = u.preview
    if (!pv || u.busy) return
    S.set(u, { busy: true })
    const importId = uid('imp')
    const parts = Math.max(1, Math.ceil(pv.rows.length / CHUNK))
    for (let k = 0; k < parts; k++) {
      const ok = await qm.send({ type: 'ticketsImported', importId, queue: pv.queue, file: pv.file, total: pv.rows.length, part: k + 1, parts, rows: pv.rows.slice(k * CHUNK, (k + 1) * CHUNK) })
      if (!ok) { S.set(u, { busy: false }); return }
    }
    if (pv.queue !== 'inc') {
      // 3-Strike: handed out when its window is open (S.strike does it after the render).
      const q = view().queues.find((x) => x.id === pv.queue)
      S.set(u, { busy: false, preview: null, queue: null, file: null, last: { importId, rows: pv.rows.length, strike: q ? q.name : pv.queue } })
      S.dispatch({ type: 'toast', text: `${pv.rows.length} 3-Strike tickets loaded (${q ? q.name : pv.queue})` })
      return
    }
    const p = await handOut(importId)
    S.set(u, { busy: false, preview: null, queue: null, file: null, last: { importId, rows: pv.rows.length, assigned: p.list.length, left: p.left.length, pool: p.pool.length } })
    S.dispatch({ type: 'toast', text: `${pv.rows.length} tickets loaded · ${p.list.length} handed out` })
  }

  const strikeCutoff = (q) => { const m = minutes(q.end) - (Number(q.cutoff) || 0); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }

  // ---------- UI helpers ----------
  const imp = () => S.ui('p:qm:import', { open: false, busy: false, error: null, preview: null, last: null, drag: false, queue: null })
  // Which queue a file is for. The window stays the original one (no question up front):
  // a 3-Strike export is recognised by its rows (nearly all On Hold), and goes to the
  // 3-Strike window that's on now (else the next one today, else the last). The preview
  // shows "Read as …" with a dropdown to change it.
  function impQueue(table) {
    const qs = view().queues.filter((q) => q.active)
    const picked = imp().queue
    if (picked && qs.some((q) => q.id === picked)) return picked
    const head = (table && table[0] || []).map((h) => h.trim().toLowerCase())
    const si = head.findIndex((h) => COLS.state.includes(h))
    const rows = table ? table.slice(1).filter((r) => r.some((c) => c && c.trim())) : []
    const held = si < 0 ? 0 : rows.filter((r) => /on hold/i.test(r[si] || '')).length
    if (!rows.length || held / rows.length < 0.8) return 'inc'
    const strikes = qs.filter((q) => q.kind === 'strike')
    const now = Date.now()
    const q = strikes.find((x) => now >= at(now, x.start) && now < at(now, x.end)) || strikes.find((x) => now < at(now, x.start)) || strikes[strikes.length - 1]
    return q ? q.id : 'inc'
  }
  const fmtWhen = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—')
  const fmtAgo = (ms) => { const m = Math.round(ms / 60e3); return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} days` }
  const ageShort = (ms) => { const m = Math.max(0, Math.round(ms / 60e3)); return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d` }
  const fmtShort = (ms) => (startOfDay(ms) === startOfDay(Date.now()) ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
  const tagPill = (tag) => html`<span class="${cls('pill', TAG_TONE[tag])}">${tag}</span>`
  const fmtHm = (ms) => { const m = Math.max(0, Math.round(ms / 60e3)); const p2 = (x) => String(x).padStart(2, '0'); return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${p2(m % 60)}m` : `${Math.floor(m / 1440)}d ${p2(Math.floor(m / 60) % 24)}h ${p2(m % 60)}m` }
  // The time in our queue, colored against the goal (lead, 2026-11-24): red once it's past the
  // SLA target (4 h for regular INC, EERS its own), green while it's still within it.
  function slaPill(t, s) {
    const h = queueHealth(t, s)
    const tip = `In our queue since ${fmtWhen(queuedAt(t))}. ${h.kind} goal: within ${fmtHm(h.sla)}. ${h.slaBreached ? 'Past the goal.' : 'Within the goal.'}`
    return html`<span class="${cls('sla-time nowrap', h.slaBreached ? 'over' : 'within')}" title="${tip}">${fmtHm(h.age)}</span>`
  }
  function healthPills(t, s) {
    const h = health(t, s)
    return html`<span class="row tight nowrap">
      ${h.slaBreached ? html`<span class="pill crit" title="Untouched longer than the SLA">SLA</span>` : h.sloBreached ? html`<span class="pill warn" title="Untouched longer than the SLO">SLO</span>` : html`<span class="pill good">OK</span>`}
      ${h.backlog && html`<span class="pill" title="${backlogTip(s)}">Backlog</span>`}
      <span class="muted small">${fmtAgo(h.untouched)}</span></span>`
  }
  // Untouched time (since ServiceNow's last update) and the backlog flag; the SLA pill lives
  // in the SLA status column on My tickets.
  const backlogTip = (s) => `Backlog: created in ServiceNow before ${s['early.start']} today (the Early shift start) or on an earlier day`
  function untouchedCell(t, s) {
    const h = health(t, s)
    return html`<span class="row tight nowrap">${h.backlog && html`<span class="pill" title="${backlogTip(s)}">Backlog</span>`}<span class="muted small" title="Since ServiceNow last updated it: ${fmtWhen(t.updated)}">${fmtAgo(h.untouched)}</span></span>`
  }
  // The INC number links to the ticket in ServiceNow once a lead sets the ServiceNow address
  // in Team settings (the export has no link of its own). With sys_id in the export the
  // link opens that exact record; otherwise ServiceNow looks the number up.
  function snowHref(n, sysId) {
    const base = String(view().settings.snowUrl || '').trim().replace(/\/+$/, '')
    if (!/^https:\/\//i.test(base) || !INC_RE.test(n)) return null
    return sysId ? `${base}/incident.do?sys_id=${encodeURIComponent(sysId)}` : `${base}/incident.do?sysparm_query=${encodeURIComponent(`number=${n}`)}`
  }
  // INC number for tables: a link to ServiceNow, or (no address set) the button that opens the drawer.
  const incLink = (n, sysId, { open = 'queue.open', v = n } = {}) => {
    const href = snowHref(n, sysId)
    return href ? html`<a class="inc-link mono" href="${href}" target="_blank" rel="noopener noreferrer" title="Open ${n} in ServiceNow" data-click="queue.snOpen" data-v="${n}">${n}${icon('external', 12)}</a>`
      : html`<button class="btn ghost sm mono" data-click="${open}" data-v="${v}">${n}</button>`
  }
  // With the link on the number, the description (or a small button) opens Scope's drawer.
  const detailsBtn = (n, sysId, { open = 'queue.open', v = n } = {}) => snowHref(n, sysId) && html`<button class="btn ghost sm inc-details" data-click="${open}" data-v="${v}" aria-label="Details of ${n} in Scope" title="Details in Scope">${icon('eye', 14)}</button>`
  const eersPill = (t) => t.eers && html`<span class="pill sky" title="${t.eers}">EERS</span>`
  const ownerCell = (t) => {
    const o = owner(t)
    if (o) return html`${nameOf(o)}`
    if (t.sn) return html`<span class="pill warn" title="Not shared out yet. ServiceNow's 'assigned to' doesn't decide who gets it in Scope.">Unassigned</span>`
    return html`<span class="pill warn">Unassigned</span>`
  }

  // Team queue: anyone can move an open ticket to someone else (lead, 2026-11-19).
  // Every move is logged on the ticket with who did it.
  const ownerPick = (t) => {
    const o = owner(t)
    const people = qm.roster.filter((p) => p.active !== false || p.soeid === o)
    return html`<select class="in sm owner-sel" aria-label="Owner of ${t.n}" title="Move ${t.n} to someone else" data-change="queue.reassign" data-v="${t.n}">
        ${!o && html`<option value="" selected>Unassigned</option>`}
        ${people.map((p) => html`<option value="${p.soeid}" ${attrs({ selected: p.soeid === o })}>${p.name}</option>`)}
      </select>${o && !t.to && html`<div class="muted small" title="Assigned in ServiceNow">(ServiceNow)</div>`}`
  }

  // ---------- My tickets (D13) ----------
  // My tickets: a plain table of what I still have to work, longest untouched first.
  // Setting a status moves it out: On Hold → the 3-Strike queue (Home), Transferred out,
  // Resolved → the resolution journey first.
  const workingOn = (t, soeid) => owner(t) === soeid && t.inLatest && t.tag === 'Assigned'
  function myTickets(me) {
    const v = view()
    const list = v.tickets.filter((t) => workingOn(t, me.soeid))
      .sort((a, b) => health(b, v.settings).untouched - health(a, v.settings).untouched)
    return list.length ? ticketTable(list, v.settings, { mine: true })
      : html`<div class="empty">${!v.latest ? 'No tickets yet. They appear here once someone loads the ServiceNow export on Home.' : 'Nothing open on you.'}</div>`
  }

  function ticketTable(list, s, { mine = false, compact = false, byAnalyst = false } = {}) {
    const sel = S.ui('p:qm').tsel
    // Home → Team queue: QueueManager's columns (Ticket # with its description, Priority,
    // Queue, Total age, Queue age, Assigned at, Tag), plus the owner, which anyone can change.
    // Notes are left out of the table for now (they're in the drawer, and resolution notes
    // come from the resolution journey). byAnalyst groups the rows under each owner.
    if (compact) {
      const now = Date.now()
      const row = (t) => html`<tr data-key="${t.n}" class="${cls(sel === t.n && 'sel', !t.inLatest && 'muted')}">
        <td class="qm-tcell"><div class="row tight nowrap">${incLink(t.n, t.sysId)}</div>
          <button class="small ink2 qm-tdesc link-plain" data-click="queue.open" data-v="${t.n}" title="${t.short} (details in Scope)">${t.short || html`<span class="muted">(no short description)</span>`}</button></td>
        <td class="nowrap">${t.p ? html`<span class="${cls('prio', `P${t.p}`)}" title="${t.priority}">P${t.p}</span>` : t.priority}</td>
        <td class="tq-queue">${t.eers ? eersPill(t) : html`<span class="small ink2" title="${t.group}">${t.group || '—'}</span>`}</td>
        <td>${t.inLatest && OPEN_TAGS.includes(t.tag) && qm.me() ? ownerPick(t) : html`<div>${ownerCell(t)}</div>`}</td>
        <td class="nowrap small" title="Since the ticket was created: ${fmtWhen(createdAt(t))}">${createdAt(t) ? ageShort(now - createdAt(t)) : '—'}</td>
        <td class="nowrap small" title="Since it came into our INC queue (Scope's first export with it): ${fmtWhen(queuedAt(t))}">${queuedAt(t) ? ageShort(now - queuedAt(t)) : '—'}</td>
        <td class="nowrap small">${t.to ? html`<span title="${fmtWhen(t.assignedAt)}">${fmtShort(t.assignedAt)}</span>` : '—'}</td>
        <td class="tq-tag"><span class="row tight" style="flex-wrap:nowrap">${t.inLatest ? tagPill(t.tag) : html`<span class="pill" title="Not in the latest export: closed or moved to another group in ServiceNow">Left the queue</span>`}
          ${t.inLatest && OPEN_TAGS.includes(t.tag) && healthPills(t, s)}</span></td>
      </tr>`
      let body
      if (byAnalyst) {
        const groups = new Map()
        for (const t of list) { const o = owner(t) || ''; if (!groups.has(o)) groups.set(o, []); groups.get(o).push(t) }
        const label = (k) => (!k ? 'Unassigned' : nameOf(k))
        const keys = [...groups.keys()].sort((a, b) => (!a) - (!b) || label(a).localeCompare(label(b)))
        body = keys.map((k) => html`<tr class="tq-grp" data-key="grp-${k || 'none'}"><td colspan="8"><span class="row tight">${k ? html`<span class="avatar xs">${S.initials(label(k))}</span>` : ''}<b>${label(k)}</b><span class="muted small">${groups.get(k).length} ticket${groups.get(k).length > 1 ? 's' : ''}</span></span></td></tr>
          ${groups.get(k).map(row)}`)
      } else body = list.map(row)
      return html`<div class="tbl-wrap tbl-scroll"><table class="tbl qm-tbl qm-compact">
      <thead><tr><th>Ticket #</th><th>Priority</th><th>Queue</th><th>Owner</th><th>Total age</th><th>Queue age</th><th>Assigned at</th><th>Tag</th></tr></thead>
      <tbody>${body}</tbody></table></div>`
    }
    // My tickets: the ticket number and its description in one column, when it was given to
    // me, the SLA status (age in our queue), total age (since created) and untouched time.
    const now = Date.now()
    return html`<div class="tbl-wrap tbl-scroll"><table class="tbl qm-tbl">
      <thead><tr><th>Ticket</th><th>Priority</th>${!mine && html`<th>Owner</th>`}<th>${mine ? 'Status' : 'Tag'}</th><th>Assigned at</th><th>SLA status</th><th>Total age</th><th>Untouched</th><th>ServiceNow state</th></tr></thead>
      <tbody>${list.map((t) => html`<tr data-key="${t.n}" class="${cls(sel === t.n && 'sel', !t.inLatest && 'muted')}">
        <td class="qm-tcell"><span class="row tight" style="flex-wrap:nowrap">${incLink(t.n, t.sysId)}${eersPill(t)}</span>
          <button class="small ink2 qm-tdesc link-plain" data-click="queue.open" data-v="${t.n}" title="${t.short} (details in Scope)">${t.short || html`<span class="muted">(no short description)</span>`}</button></td>
        <td class="nowrap">${t.priority}</td>
        ${!mine && html`<td class="nowrap">${ownerCell(t)}</td>`}
        <td class="nowrap">${mine && t.inLatest ? html`<select class="${cls('in sm tag-sel', TAG_TONE[t.tag])}" aria-label="Status of ${t.n}" data-change="queue.tagSel" data-v="${t.n}">${TAGS.map((g) => html`<option value="${g}" ${attrs({ selected: t.tag === g })}>${g === 'Resolved' ? 'Resolved…' : g}</option>`)}</select>`
          : !t.inLatest ? html`<span class="pill" title="Not in the latest export: closed or moved to another group in ServiceNow">Left the queue</span>` : tagPill(t.tag)}${t.res && html` <span class="code-chip" title="${t.res.title}">${t.res.code}</span>`}</td>
        <td class="nowrap small">${t.assignedAt ? html`<span title="${fmtWhen(t.assignedAt)}">${fmtShort(t.assignedAt)}</span>` : '—'}</td>
        <td>${queuedAt(t) ? slaPill(t, s) : html`<span class="muted small">—</span>`}</td>
        <td class="nowrap small" title="Since the ticket was created: ${fmtWhen(createdAt(t))}">${createdAt(t) ? fmtHm(now - createdAt(t)) : '—'}</td>
        <td>${t.inLatest && OPEN_TAGS.includes(t.tag) ? untouchedCell(t, s) : html`<span class="muted small">—</span>`}</td>
        <td class="nowrap small">${t.state}</td>
      </tr>`)}</tbody></table></div>`
  }

  function ticketDrawer(t, me) {
    const v = view()
    const o = owner(t)
    const canTag = me && (me.soeid === o || me.accessRole === 'Lead')
    const u = S.ui('p:qm')
    S.drawer({
      className: 'qm-drawer',
      onClose: 'queue.close',
      title: html`<span class="row tight">${tagPill(t.tag)}${eersPill(t)}</span><h2 class="drawer-title mono">${snowHref(t.n, t.sysId) ? html`<a class="inc-link" href="${snowHref(t.n, t.sysId)}" target="_blank" rel="noopener noreferrer" title="Open ${t.n} in ServiceNow" data-click="queue.snOpen" data-v="${t.n}">${t.n}${icon('external', 16)}</a>` : t.n}</h2>`,
      sub: html`<span class="muted small">${t.short}</span>`,
      body: html`<div class="stack" style="gap:16px">
        <dl class="qm-dl">
          <dt>Owner</dt><dd>${ownerCell(t)}</dd>
          ${t.reason && html`<dt>Why them</dt><dd>${t.reason}<div class="muted small">${fmtWhen(t.assignedAt)}</div></dd>`}
          <dt>Priority</dt><dd>${t.priority}</dd>
          <dt>ServiceNow</dt><dd>${t.state} · ${t.group}${t.sn && (snMember(t) ? html` · assigned to ${snMember(t).name}${snMember(t).soeid !== t.to ? ' (reassign it there)' : ''}` : html` · assigned to someone not on the active team`)}</dd>
          <dt>Opened</dt><dd>${fmtWhen(t.opened)}</dd>
          <dt>Last updated</dt><dd>${fmtWhen(t.updated)} ${t.inLatest && healthPills(t, v.settings)}</dd>
          ${t.eers && html`<dt>EERS because</dt><dd>${t.eers}</dd>`}
          ${t.res && html`<dt>Resolution</dt><dd><span class="code-chip">${t.res.code}</span> ${t.res.title}<div class="muted small">${t.res.category || ''}${t.res.fcr ? ' · first contact' : ''} · by ${nameOf(t.res.by)}, ${fmtWhen(t.res.at)}</div>
            ${S.liveResolve && html`<button class="btn ghost sm" data-click="lres.copy" data-v="${t.n}">${icon('copy', 13)}Copy for ServiceNow</button>`}</dd>`}
          ${t.location && html`<dt>Location</dt><dd>${t.location}</dd>`}
          ${!t.inLatest && html`<dt>Queue</dt><dd>Not in the latest export: closed, or moved to another group in ServiceNow.</dd>`}
        </dl>
        ${canTag && html`<div class="stack" style="gap:8px">
          <span class="eyebrow">Tag</span>
          <div class="row tight">${TAGS.map((g) => html`<button class="${cls('btn sm', t.tag === g && 'primary')}" data-click="${g === 'Resolved' && S.liveResolve ? 'lres.open' : 'queue.tag'}" data-v="${t.n}" data-t="${g}" ${attrs({ 'aria-pressed': String(t.tag === g) })}>${g === 'Resolved' && S.liveResolve ? html`${icon('check', 13)}Resolve with code` : g}</button>`)}</div>
          <span class="muted small">Resolving walks you through the resolution journey and gives the ticket a resolution code to copy into ServiceNow. Transferred still counts as handled.</span>
        </div>`}
        ${me && t.inLatest && html`<div class="stack" style="gap:8px">
          <span class="eyebrow">Move to someone else</span>
          <div class="row tight">
            <select class="in" aria-label="New owner" data-change="queue.moveTo">
              <option value="">Pick a person</option>
              ${qm.roster.filter((p) => p.active !== false && p.soeid !== o).map((p) => html`<option value="${p.soeid}" ${attrs({ selected: u.moveTo === p.soeid })}>${p.name}</option>`)}
            </select>
            <button class="btn sm" data-click="queue.move" data-v="${t.n}" ${attrs({ disabled: !u.moveTo })}>Move</button>
          </div>
        </div>`}
        <div class="stack" style="gap:8px">
          <span class="eyebrow">Notes</span>
          ${t.notes.length ? t.notes.map((n) => html`<div class="small"><b>${nameOf(n.by)}</b> · <span class="muted">${fmtWhen(n.at)}</span><div class="qm-pre ink2">${n.text}</div></div>`) : html`<span class="muted small">No notes yet.</span>`}
          <textarea class="in" rows="2" maxlength="2000" placeholder="Add a note for the team (no passwords or personal details)" data-input="queue.noteText">${u.tnote || ''}</textarea>
          <div class="row"><span class="spacer"></span><button class="btn sm" data-click="queue.note" data-v="${t.n}" ${attrs({ disabled: !(u.tnote || '').trim() })}>Add note</button></div>
        </div>
        ${t.history.length > 0 && html`<div class="stack" style="gap:6px"><span class="eyebrow">History</span>
          ${t.history.map((h) => html`<div class="small"><b>${nameOf(h.by)}</b> ${h.what} · <span class="muted">${fmtWhen(h.at)}</span>${h.note && html`<div class="muted">${h.note}</div>`}</div>`)}</div>`}
      </div>`,
    })
    if (S.liveResolve) S.liveResolve.modal()
  }

  // ---------- Team queue: load the export, see the spread ----------
  function freshness(v) {
    if (!v.latest) return html`<div class="callout warn">${icon('upload', 16)}<span><b>No export loaded yet.</b> Export the incident list from ServiceNow as CSV and drop it here.</span></div>`
    const age = Date.now() - v.latest.at
    const stale = age > Number(v.settings.uploadReminder) * 60e3
    return html`<div class="${cls('callout', stale ? 'warn' : 'accent')}">${icon(stale ? 'alert' : 'refresh', 16)}<span>
      <b>Data ${fmtAgo(age)} old</b>, loaded by ${nameOf(v.latest.by)} at ${S.fmtTime(v.latest.at)} (${v.latest.file || 'export'}, ${v.latest.rows} tickets).
      ${stale && html` Time for a fresh export: the team loads one every ${v.settings.uploadReminder} minutes. Anyone can do it.`}</span></div>`
  }

  function importCard(me) {
    const u = imp()
    const v = view()
    const pv = u.preview
    const canUndo = (x) => x && !v.undone.has(x.id) && (x.by === me.soeid || me.accessRole === 'Lead')
    return html`<div class="stack" style="gap:12px">
      ${freshness(v)}
      <label class="${cls('qm-drop', u.drag && 'on')}" data-dragover="queue.dragover" data-dragleave="queue.dragleave" data-drop="queue.drop">
        ${icon('upload', 20)}
        <span><b>Drop the ServiceNow incident export here</b> or <u>choose the file</u></span>
        <span class="muted small">CSV with the usual columns (number, opened_at, sys_updated_on, short_description, state, assignment_group, assigned_to…). Descriptions are only checked for EERS keywords, never stored.</span>
        <input type="file" accept=".csv,text/csv" class="sr-only" data-change="queue.file">
      </label>
      ${u.busy && html`<div class="muted small">Working…</div>`}
      ${u.error && html`<div class="callout crit">${icon('alert', 16)}<span>${u.error}</span></div>`}
      ${pv && html`<div class="stack" style="gap:10px">
        <div class="row"><b>${pv.file}</b><span class="muted small">${pv.rows.length} tickets · read as ${pv.enc}</span><span class="spacer"></span>
          <label class="row tight small muted">Read as <select class="in sm" data-change="queue.impQueue" aria-label="Which export this is">${v.queues.filter((x) => x.active).map((x) => html`<option value="${x.id}" ${attrs({ selected: x.id === pv.queue })}>${x.kind === 'strike' ? `3-Strike · ${x.name} (${x.start}–${x.end})` : x.name}</option>`)}</select></label></div>
        ${pv.queue !== 'inc' ? html`<div class="callout accent small">${icon('clock', 16)}<span><b>${pv.rows.length} tickets for 3-Strike · ${(v.queues.find((x) => x.id === pv.queue) || {}).name || pv.queue}.</b> ${pv.fresh} not seen before in Scope.</span></div>` : html`<div class="grid g-kpi">
          ${S.kpi({ label: 'New', icon: 'plus', tone: 'good', value: pv.fresh, foot: 'Not seen before' })}
          ${S.kpi({ label: 'Updated', icon: 'refresh', tone: 'sky', value: pv.newer, foot: 'Newer in ServiceNow' })}
          ${S.kpi({ label: 'EERS', icon: 'key', tone: 'navy', value: pv.eers, foot: 'Go to the Proci Backup' })}
          ${S.kpi({ label: 'Left the queue', icon: 'swap', tone: 'warn', value: pv.gone, foot: 'Open before, not in this file' })}
        </div>
        <div class="muted small">${pv.same} unchanged · ${pv.snAssigned} with an 'assigned to' in ServiceNow (shared out like the rest)${pv.dupes > 0 && ` · ${pv.dupes} repeated rows merged`}</div>`}
        ${pv.skipped.length > 0 && html`<details class="small"><summary>${pv.skipped.length} rows skipped</summary><ul>${pv.skipped.slice(0, 20).map((x) => html`<li>Line ${x.line}: ${x.why}</li>`)}</ul></details>`}
        <div class="row"><span class="spacer"></span><button class="btn ghost" data-click="queue.cancel">Cancel</button>
          <button class="btn primary" data-click="queue.confirm" ${attrs({ disabled: u.busy || !pv.rows.length })}>${icon('check', 15)}Load and hand out</button></div>
      </div>`}
      ${u.last && !pv && u.last.strike && html`<div class="callout good">${icon('check', 16)}<span>Loaded ${u.last.rows} tickets into 3-Strike · ${u.last.strike}. They're handed out while the window is open; see Home → 3-Strike.</span>
        ${canUndo(v.imports.find((x) => x.id === u.last.importId)) && html`<span class="spacer"></span><button class="btn sm" data-click="queue.undo" data-v="${u.last.importId}">Undo this load</button>`}</div>`}
      ${u.last && !pv && !u.last.strike && html`<div class="callout good">${icon('check', 16)}<span>Loaded ${u.last.rows} tickets. Handed out ${u.last.assigned} to ${u.last.pool} on shift.${u.last.left > 0 && html` <b>${u.last.left} left unassigned</b>: nobody on shift before their cutoff.`}</span>
        ${canUndo(v.imports.find((x) => x.id === u.last.importId)) && html`<span class="spacer"></span><button class="btn sm" data-click="queue.undo" data-v="${u.last.importId}">Undo this load</button>`}</div>`}
    </div>`
  }

  // Home's top-right action: how old the data is, and the button that opens the import.
  function importAction() {
    const v = view()
    const h = importHealth(v)
    return html`<div class="row home-actions">
      <span class="spacer"></span>
      <span class="row tight small muted" title="${v.latest ? `Loaded by ${nameOf(v.latest.by)} at ${S.fmtTime(v.latest.at)} (${v.latest.file || 'export'})` : ''}"><span class="${cls('dot', { good: 'live', warn: 'warn', crit: 'crit' }[h.tone])}"></span>${h.age == null ? 'No export loaded yet' : `Data ${fmtAgo(h.age)} old`}</span>
      <button class="${cls('btn', h.tone === 'good' ? '' : 'primary')}" data-click="queue.impOpen">${icon('upload', 15)}Load ServiceNow export</button>
    </div>`
  }
  function importModal(me) {
    if (!imp().open) return
    S.modal({ title: 'Load the ServiceNow export', sub: 'Anyone can load it. The team loads a fresh one about every ' + view().settings.uploadReminder + ' minutes.', wide: true, onClose: 'queue.impClose', body: importCard(me) })
  }

  // Who is on shift right now, as a row of circles (Queue Management header). The
  // per-person counts and balancing live on Home ("Tickets per person today").
  function onShiftStack() {
    if (!qm.loadedAt || !qm.roster.length || !qm.me()) return ''
    const now = Date.now()
    const people = onShift(now).filter((p) => now < p.w.end)
    const shown = people.slice(0, 6)
    const tip = (p) => `${p.person.name} · ${S.dutyLabel(p.duty)} · ${S.shiftLabel(p.shift)}${now < p.w.cutoff ? ` · gets tickets until ${S.fmtTime(p.w.cutoff)}` : ' · past cutoff'}`
    return html`<div class="shift-stack" aria-label="${people.length} on shift now">
      <div class="shift-avatars">${shown.map((p) => html`<span class="${cls('avatar', now >= p.w.cutoff && 'past')}" data-key="${p.soeid}" title="${tip(p)}">${S.initials(p.person.name)}<i class="dot ${now < p.w.cutoff ? 'live' : ''}"></i></span>`)}
        ${people.length > shown.length && html`<span class="avatar more" title="${people.slice(6).map((p) => p.person.name).join(', ')}">+${people.length - shown.length}</span>`}</div>
      <span class="small muted">${people.length ? html`<b class="num">${people.length}</b> on shift` : 'Nobody on shift yet'}</span>
    </div>`
  }

  // ---------- Shift handover (Queue Management tab) ----------
  // A draft from real tickets. The team's actual handover template isn't in Scope yet
  // (vault: Team Operating Model §4), so this is a summary to copy, not the template.
  const ho = () => S.ui('p:qm:ho', { notes: '' })
  function handoverText() {
    const v = view()
    const now = Date.now()
    const open = v.tickets.filter(isOpen)
    const h = open.map((t) => ({ t, h: health(t, v.settings, now) }))
    const from = startOfDay(now)
    const r = S.rota.dayRoles(S.rota.today())
    const done = v.tickets.filter((t) => ['Resolved', 'Transferred'].includes(t.tag) && t.tagAt >= from)
    const onHold = v.tickets.filter((t) => t.inLatest && t.tag === 'On Hold')
    const notes = ho().notes.trim()
    const list = (ts) => ts.map((t) => `${t.n} ${t.priority}${t.short ? ` – ${t.short}` : ''}${owner(t) ? ` (${nameOf(owner(t))})` : ''}`).join('\n  ') || 'none'
    return [
      `Handover · ${new Date(now).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · Main Proci ${nameOf(r.main) || '—'}`,
      `Open: ${open.length} (P1 ${open.filter((t) => t.p === 1).length}, P2 ${open.filter((t) => t.p === 2).length}, EERS ${open.filter((t) => t.eers).length}) · unassigned ${open.filter((t) => !owner(t)).length} · backlog ${h.filter((x) => x.h.backlog).length}`,
      `Closed today in Scope: ${done.filter((t) => t.tag === 'Resolved').length} resolved, ${done.filter((t) => t.tag === 'Transferred').length} transferred`,
      `P1/P2 still open:\n  ${list(open.filter((t) => t.p <= 2))}`,
      `Past SLA:\n  ${list(h.filter((x) => x.h.slaBreached).map((x) => x.t))}`,
      `On Hold (waiting on the user): ${onHold.length}`,
      notes && `Notes: ${notes}`,
      `Data: ServiceNow export loaded ${v.latest ? `${fmtAgo(now - v.latest.at)} ago` : 'not yet'}`,
    ].filter(Boolean).join('\n')
  }
  function handover() {
    return html`<div class="card-b stack lg" style="padding-top:16px">
      <div class="callout warn small">${icon('info', 16)}<span><b>Draft from the live queue.</b> The team's handover template and the partner-site call aren't in Scope yet; copy this into your usual handover message.</span></div>
      <label class="field"><span>Notes for the next shift</span><textarea class="in" rows="3" data-input="queue.hoNotes" placeholder="Callbacks owed, vendor cases, anything to watch">${ho().notes}</textarea></label>
      <pre class="qm-pre live-ho">${handoverText()}</pre>
      <div class="row"><span class="spacer"></span><button class="btn primary" data-click="queue.hoCopy">${icon('copy', 15)}Copy summary</button></div>
    </div>`
  }

  // The whole team's tickets. Queue health, loading the export and the per-person
  // spread are on Home; this is the list you work from.
  function teamQueue(me) {
    const v = view()
    const u = S.ui('p:qm:queue', { show: 'all', q: '' })
    const q = u.q.trim().toLowerCase()
    const unassigned = v.tickets.filter((t) => t.inLatest && !owner(t) && t.tag === 'Assigned')
    const list = v.tickets
      // Everything open in the queue, narrowed by the filter.
      .filter((t) => isOpen(t) && (u.show === 'assigned' ? t.tag === 'Assigned' : u.show === 'backlog' ? health(t, v.settings).backlog
        : u.show === 'priority' ? t.p && t.p <= 2 : u.show === 'slo' ? health(t, v.settings).sloBreached : true))
      .filter((t) => !q || [t.n, t.short, t.group, t.sn, nameOf(owner(t))].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (a.p || 9) - (b.p || 9) || (a.opened || 0) - (b.opened || 0))
    return html`<div>
        <div class="card-h qm-toolbar">
          <div class="kb-search tq-search">${icon('search', 16)}<input type="search" placeholder="Search INC, description, group, owner" value="${u.q}" data-input="queue.q" aria-label="Search tickets"></div>
          <select class="in" aria-label="Show" data-change="queue.qshow" title="All: every open ticket · Assigned: being worked (not On Hold) · Backlog: created before ${v.settings['early.start']} today (Early shift start) or earlier · Priority: P1 and P2 · SLO breach: untouched longer than the SLO">
            ${[['all', 'All'], ['assigned', 'Assigned'], ['backlog', 'Backlog'], ['priority', 'Priority'], ['slo', 'SLO Breach']].map(([k, l]) => html`<option value="${k}" ${attrs({ selected: u.show === k })}>${l}</option>`)}
          </select>
          <label class="row tight small nowrap tq-by"><input type="checkbox" data-change="queue.byAnalyst" ${attrs({ checked: !!u.byAnalyst })}>View by analyst</label>
          ${unassigned.length > 0 && html`<button class="btn sm primary" data-click="queue.handout">${icon('send', 14)}Hand out ${unassigned.length} now</button>`}
        </div>
        ${list.length ? ticketTable(list, v.settings, { compact: true, byAnalyst: !!u.byAnalyst }) : html`<div class="empty">${v.latest ? 'Nothing matches.' : 'No export loaded yet. Use Import data in the header.'}</div>`}
      </div>`
  }

  // ---------- Team settings tab (Team Management) ----------
  function settingsPanel() {
    if (location.protocol === 'file:' || !qm.loadedAt) return html`<div class="card"><div class="card-b empty">Team settings live on the Scope Lite server. Start Scope with run.bat or share.bat.</div></div>`
    const v = view()
    const me = qm.me()
    const lead = me && me.accessRole === 'Lead'
    const u = S.ui('p:team:settings', () => ({ draft: {}, tried: false }))
    const val = (s) => (s.key in u.draft ? u.draft[s.key] : v.settings[s.key])
    const errs = Object.fromEntries(SETTINGS.map((s) => [s.key, checkSetting(s, val(s))]))
    const dirty = Object.keys(u.draft).filter((k) => String(u.draft[k]) !== String(v.settings[k]))
    const groups = [...new Set(SETTINGS.map((s) => s.group))]
    return html`<div class="stack" style="gap:16px">
      <div class="callout accent">${icon('gear', 16)}<span><b>Settings the whole team follows.</b> ${lead ? 'You can change them; every change is recorded with your name.' : 'Only a lead can change them.'} Seeded from QueueManager's settings. When the shift mode changes, update the shift times here.</span></div>
      ${groups.map((g) => html`<div class="card"><div class="card-h"><b>${g}</b></div><div class="card-b form-grid qm-settings">
        ${SETTINGS.filter((s) => s.group === g).map((s) => html`<label class="field"><span>${s.label}${s.unit && html` <span class="hint">${s.unit}</span>`}</span>
          ${s.type === 'bool' ? html`<select class="in" data-change="queue.set" data-k="${s.key}" ${attrs({ disabled: !lead })}><option value="true" ${attrs({ selected: val(s) === true || val(s) === 'true' })}>Yes</option><option value="false" ${attrs({ selected: val(s) === false || val(s) === 'false' })}>No</option></select>`
            : s.type === 'tz' ? html`<select class="in" data-change="queue.set" data-k="${s.key}" ${attrs({ disabled: !lead })}>${TZ_OPTIONS.map(([k, l]) => html`<option value="${k}" ${attrs({ selected: String(val(s)) === k })}>${l}</option>`)}</select>`
            : html`<input class="in" ${attrs({ type: s.type === 'num' ? 'number' : s.type === 'time' ? 'time' : s.type === 'url' ? 'url' : 'text', placeholder: s.type === 'url' ? 'https://yourcompany.service-now.com' : null, min: s.type === 'num' ? '0' : null, step: s.type === 'num' ? 'any' : null, disabled: !lead })} value="${val(s)}" data-input="queue.set" data-k="${s.key}">`}
          ${u.tried && errs[s.key] && html`<span class="qm-err" role="alert">${errs[s.key]}</span>`}</label>`)}
      </div></div>`)}
      ${lead && html`<div class="row"><span class="muted small">${dirty.length ? `${dirty.length} unsaved change${dirty.length > 1 ? 's' : ''}` : 'No changes'}</span><span class="spacer"></span>
        <button class="btn ghost" data-click="queue.setReset" ${attrs({ disabled: !dirty.length })}>Discard</button>
        <button class="btn primary" data-click="queue.setSave" ${attrs({ disabled: !dirty.length })}>${icon('check', 15)}Save for the team</button></div>`}
      ${queuesCard(lead)}
      <div class="card"><div class="card-h"><b>Change history</b></div>
        ${v.settingsLog.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Setting</th><th>From</th><th>To</th></tr></thead>
          <tbody>${v.settingsLog.slice().reverse().slice(0, 50).map((x, i) => html`<tr data-key="${i}"><td class="nowrap">${fmtWhen(x.at)}</td><td>${nameOf(x.by)}</td><td>${(SETTINGS.find((s) => s.key === x.key) || {}).label}</td><td>${String(x.from)}</td><td><b>${String(x.to)}</b></td></tr>`)}</tbody></table></div>`
          : html`<div class="card-b empty">No changes yet: the values above are QueueManager's.</div>`}
      </div>
    </div>`
  }
  // ---------- Queues card ----------
  const qDraft = () => { const u = S.ui('p:team:queues', { draft: null, tried: false }); return (u.draft || view().queues).map((q) => ({ ...q })) }
  function queueErr(q, list, i) {
    if (!String(q.name || '').trim()) return 'Give it a name.'
    if (list.some((x, j) => j !== i && x.name.trim().toLowerCase() === q.name.trim().toLowerCase())) return 'Two queues have this name.'
    if (q.kind === 'inc') return null
    if (!TIME_RE.test(q.start || '') || !TIME_RE.test(q.end || '')) return 'Set the window, HH:MM to HH:MM.'
    if (q.start >= q.end) return 'The window must end after it starts (same day).'
    if (q.cutoff === '' || isNaN(Number(q.cutoff)) || Number(q.cutoff) < 0) return 'Cutoff: minutes, 0 or more.'
    if (minutes(q.end) - Number(q.cutoff) < minutes(q.start)) return 'The cutoff falls before the window opens.'
    return null
  }
  function queuesCard(lead) {
    const v = view()
    const u = S.ui('p:team:queues', { draft: null, tried: false })
    const list = u.draft || v.queues
    const dirty = !!u.draft && JSON.stringify(u.draft) !== JSON.stringify(v.queues)
    const dis = attrs({ disabled: !lead })
    const strikeQs = list.map((q, i) => ({ q, i })).filter((x) => x.q.kind === 'strike')
    const overlap = strikeQs.some((a) => strikeQs.some((b) => a.i < b.i && a.q.active && b.q.active && a.q.start < b.q.end && b.q.start < a.q.end))
    return html`<div class="card">
      <div class="card-h"><b>Queues</b><span class="spacer"></span>
        ${S.infoTip('queues', 'Queues', html`
          <span>Each ServiceNow export you load belongs to a queue. <b>Standard INC</b> runs all day. Each <b>3-Strike</b> queue is one regional ServiceNow view, worked in its own window (Philippine time).</span>
          <span><b>When the window opens</b>, its 3-Strike tickets are handed out automatically to everyone scheduled today, to whoever has the fewest tickets today (INC + 3-Strike), so the totals stay even.</span>
          <span><b>Cutoff:</b> automatic hand-out stops this many minutes before the window ends. After that the day's Main Proci, Proci Backup, Weekend Support or a lead can still hand out or move tickets by hand, at any time.</span>
          <span><b>Not finished in window:</b> a ticket handed out but with no contact attempt logged by the end of the window. It still shows on that person's end-of-day report, labelled. One handed out after the window closed has until the end of the day.</span>
          <span><b>Daylight saving:</b> Manila's clock never changes, but the regions' working hours do, so the windows move by an hour. Change the times here on the day it happens.</span>`)}
      </div>
      <div class="card-b stack" style="gap:10px">
        ${list.map((q, i) => { const err = u.tried && queueErr(q, list, i); return html`<div class="queue-row" data-key="${q.id}">
          <label class="field"><span>${q.kind === 'inc' ? 'Queue' : '3-Strike region'}</span><input class="in" value="${q.name}" maxlength="60" data-input="queue.qf" data-i="${i}" data-k="name" ${dis}></label>
          <label class="field"><span>ServiceNow view <span class="hint">to export from</span></span><input class="in" value="${q.view}" maxlength="120" placeholder="${q.kind === 'inc' ? 'The team\'s incident list' : 'e.g. NAM - 3 Strike (2 Hours)'}" data-input="queue.qf" data-i="${i}" data-k="view" ${dis}></label>
          ${q.kind === 'strike' ? html`
            <label class="field"><span>Window opens</span><input class="in" type="time" value="${q.start}" data-input="queue.qf" data-i="${i}" data-k="start" ${dis}></label>
            <label class="field"><span>Window closes</span><input class="in" type="time" value="${q.end}" data-input="queue.qf" data-i="${i}" data-k="end" ${dis}></label>
            <label class="field"><span>Cutoff <span class="hint">min before close${TIME_RE.test(q.end || '') && !isNaN(Number(q.cutoff)) ? ` = ${strikeCutoff(q)}` : ''}</span></span><input class="in" type="number" min="0" step="5" value="${q.cutoff}" data-input="queue.qf" data-i="${i}" data-k="cutoff" ${dis}></label>
            <label class="row tight small nowrap queue-on"><input type="checkbox" data-change="queue.qf" data-i="${i}" data-k="active" ${attrs({ checked: q.active !== false, disabled: !lead })}>In use</label>
            ${lead ? html`<button class="btn ghost sm" title="Remove this queue" aria-label="Remove ${q.name || 'queue'}" data-click="queue.qdel" data-v="${q.id}" data-i="${i}">${icon('x', 14)}</button>` : html`<span></span>`}`
          : html`<span class="small muted queue-allday">All day · handed out as soon as it loads</span>`}
          ${err && html`<span class="qm-err" role="alert">${err}</span>`}
        </div>` })}
        ${overlap && html`<div class="callout warn small">${icon('alert', 15)}<span>Two 3-Strike windows overlap. That works (each hands out its own tickets), but check it's intended.</span></div>`}
        ${lead && html`<div class="row"><button class="btn sm" data-click="queue.qadd">${icon('plus', 14)}Add a 3-Strike queue</button>
          <span class="spacer"></span><span class="muted small">${v.queuesBy ? `Last changed by ${nameOf(v.queuesBy.by)}, ${fmtWhen(v.queuesBy.at)}` : 'From the team\'s 3-Strike Monitoring Schedule'}</span>
          <button class="btn ghost" data-click="queue.qreset" ${attrs({ disabled: !dirty })}>Discard</button>
          <button class="btn primary" data-click="queue.qsave" ${attrs({ disabled: !dirty })}>${icon('check', 15)}Save queues</button></div>`}
      </div></div>`
  }

  function checkSetting(s, v) {
    if (s.type === 'num') return v === '' || isNaN(Number(v)) || Number(v) < 0 ? 'Enter a number (0 or more).' : null
    if (s.type === 'time') return /^\d{2}:\d{2}$/.test(String(v)) ? null : 'Use HH:MM.'
    if (s.type === 'text') return String(v).trim() ? null : 'Add at least one keyword.'
    if (s.type === 'url') return !String(v).trim() || /^https:\/\/[^\s/]+\.[^\s/]+\/?$/i.test(String(v).trim()) ? null : 'Use the address only, starting with https:// (e.g. https://yourcompany.service-now.com).'
    return null
  }
  async function saveSettings() {
    const u = S.ui('p:team:settings')
    const v = view()
    if (SETTINGS.some((s) => checkSetting(s, s.key in u.draft ? u.draft[s.key] : v.settings[s.key]))) { S.set(u, { tried: true }); return }
    const values = {}
    for (const [k, raw] of Object.entries(u.draft)) {
      const s = SETTINGS.find((x) => x.key === k)
      const val = s.type === 'num' ? Number(raw) : s.type === 'bool' ? raw === true || raw === 'true' : String(raw).trim()
      if (String(val) !== String(v.settings[k])) values[k] = val
    }
    if (!Object.keys(values).length) return
    if (await qm.send({ type: 'settingsSet', values })) { S.set(u, { draft: {}, tried: false }); S.dispatch({ type: 'toast', text: 'Settings saved for the team' }) }
  }

  // Shift times in the sign-in come from the team settings.
  for (const sh of S.SHIFTS) {
    Object.defineProperty(sh, 'times', {
      configurable: true,
      get() {
        const s = qm.events ? view().settings : def
        if (sh.id === 'WEEKEND') return `Saturday–Sunday, ${s['early.start']}–${s['early.end']}`
        const k = sh.id === 'LATE' ? 'late' : 'early'
        return `${s[`${k}.start`]}–${s[`${k}.end`]}`
      },
    })
  }

  // ---------- Header: ServiceNow import health (replaces the simulated sync pill) ----------
  // Healthy while the last load is younger than the team's upload reminder, Due up to
  // twice that, then Stale. No load yet = No data.
  function importHealth(v = view(), now = Date.now()) {
    const lim = Number(v.settings.uploadReminder) * 60e3
    if (!v.latest) return { tone: 'warn', label: 'No data', age: null }
    const age = now - v.latest.at
    return age <= lim ? { tone: 'good', label: 'Healthy', age } : age <= 2 * lim ? { tone: 'warn', label: 'Due', age } : { tone: 'crit', label: 'Stale', age }
  }
  function importPill() {
    const v = view()
    const h = importHealth(v)
    const open = v.tickets.filter(isOpen)
    const p1 = open.filter((t) => t.p === 1).length
    const unassigned = open.filter((t) => !owner(t)).length
    const breached = open.filter((t) => health(t, v.settings).slaBreached).length
    const today = startOfDay(Date.now())
    const loadsToday = v.imports.filter((x) => x.at >= today && !v.undone.has(x.id))
    const pop = S.pop === 'snow'
    const dot = { good: 'live', warn: 'warn', crit: 'crit' }[h.tone]
    return html`<div class="pop-anchor" data-pop-anchor="snow" data-tour="snow">
      <button class="snow-pill" data-click="app.pop" data-v="snow" aria-expanded="${pop}" title="ServiceNow export: ${h.label}">
        <span class="snow-ic">${icon('upload', 15)}</span>
        <b>ServiceNow import</b>
        <span class="row tight muted snow-live"><span class="${cls('dot', dot)}"></span>${h.age == null ? 'No export yet' : `${h.label} · ${fmtAgo(h.age)} ago`}</span>
      </button>
      <button class="btn sm primary snow-import" data-click="queue.goImport">${icon('upload', 14)}Import data</button>
      ${pop && html`<div class="popover popover-center" style="width:min(480px, calc(100vw - 32px))">
        <div class="card-h"><h3>Import health</h3><span class="spacer"></span><span class="${cls('pill', h.tone)}">${h.label}</span></div>
        <div class="card-b stack">
          ${(v.latest ? [
            ['Source', 'ServiceNow incident export (CSV)'],
            ['Last load', `${S.fmtTime(v.latest.at)} by ${nameOf(v.latest.by)}`],
            ['File', v.latest.file || '—'],
            ['Data age', `${fmtAgo(h.age)} · fresh within ${v.settings.uploadReminder} min`],
            ['In the last load', `${v.latest.rows} tickets · ${v.latest.added} new · ${v.latest.updated} updated`],
            ['Loads today', loadsToday.length],
            ['Open tickets', `${open.length} · ${open.filter((t) => t.eers).length} EERS`],
            ['P1 open', p1],
            ['Waiting for someone on shift', unassigned],
            ['Past SLA', breached],
            ['Export time zone', v.settings.exportTz === 'local' ? "This computer's clock" : `UTC${Number(v.settings.exportTz) >= 0 ? '+' : ''}${v.settings.exportTz}`],
          ] : [['Source', 'ServiceNow incident export (CSV)'], ['Status', 'Nothing loaded yet']]).map(([k, val]) => html`<div class="row" style="justify-content:space-between;gap:16px;flex-wrap:nowrap"><span class="muted nowrap" style="flex:none">${k}</span><b class="num" style="text-align:right;min-width:0">${val}</b></div>`)}
          ${h.tone !== 'good' && html`<div class="muted small">${v.latest ? 'The team loads a fresh export every ' + v.settings.uploadReminder + ' minutes; anyone can do it.' : 'Export the incident list from ServiceNow as CSV and load it.'}</div>`}
          <label class="${cls('qm-drop sm', imp().drag && 'on')}" style="margin-top:6px" data-dragover="queue.dragover" data-dragleave="queue.dragleave" data-drop="queue.popDrop">
            ${icon('upload', 16)}
            <span><b>Drop the CSV here</b> or <u>choose the file</u></span>
            <input type="file" accept=".csv,text/csv" class="sr-only" data-change="queue.popFile">
          </label>
          <div class="row"><span class="spacer"></span><button class="btn sm ghost" data-click="queue.goQueue">Open Team queue</button></div>
        </div>
      </div>`}
    </div>`
  }

  // ---------- Exports ----------
  S.queue = { inQueueToday, givenToday, underLimit, targets, createdAt, queuedAt, queueHealth, slaPill, fmtHm, fmtWhen, soundOn, chime, SOUND_KEY, scheduledToday, waitingReason, snowHref, incLink, detailsBtn, parseCsv, readText, workingOn, strikeCount, canOverrideStrikes, dayOf, at, minutes, startOfDay, DEFAULT_QUEUES, cleanQueue, strikeCutoff, tagPill, eersPill, ownerCell, healthPills, importHealth, importPill, importAction, importModal, onShiftStack, handover, ticketTable, view, owner, onShift, loadToday, health, isOpen, plan, handOut, rebalancePlan, rebalancePreview, rebalance, TAGS, myTickets, teamQueue, ticketDrawer, settingsPanel, nameOf,
    _test: { parseCsv, normalise, parseWhen, eersMatch, fold, shiftWindow, rebalancePlan } }

  // Loading the export lives on Home; the ticket list on Queue Management → Team queue.
  function goImport() { S.pop = null; if (S.route.page !== 'home') S.nav('home'); S.set(imp(), { open: true }) }
  function goQueue() { S.pop = null; S.nav('home'); S.set(S.ui('p:home:tabs', { tab: 'queue' }), { tab: 'queue' }) }

  // ---------- Handlers ----------
  const page = () => S.ui('p:qm')
  S.on({
    'queue.qshow': (el) => S.set(S.ui('p:qm:queue'), { show: el.value }),
    'queue.byAnalyst': (el) => S.set(S.ui('p:qm:queue'), { byAnalyst: el.checked }),
    'queue.q': (el) => S.set(S.ui('p:qm:queue'), { q: el.value }),
    'queue.open': (el) => S.set(page(), { tsel: el.dataset.v, tnote: '', moveTo: '' }),
    'queue.close': () => S.set(page(), { tsel: null }),
    // The INC link opens ServiceNow in a new tab (the browser does that); this only logs when.
    // One log per person per assignment is enough for the ticket history.
    'queue.snOpen': (el) => {
      const me = qm.me()
      const t = view().ticketMap.get(el.dataset.v)
      if (!me || !t || t.opens.some((o) => o.by === me.soeid && o.at >= (t.assignedAt || 0))) return
      qm.send({ type: 'ticketOpened', n: t.n })
    },
    'queue.noteText': (el) => { const p = page(); const was = !!(p.tnote || '').trim(); p.tnote = el.value; if (was !== !!el.value.trim()) S.render() },
    'queue.note': async (el) => { const p = page(); if (await qm.send({ type: 'ticketNote', n: el.dataset.v, text: (p.tnote || '').trim() })) S.set(p, { tnote: '' }) },
    'queue.tagSel': async (el) => {
      const n = el.dataset.v
      const g = el.value
      if (g === 'Resolved' && S.liveResolve) { el.value = 'Assigned'; S.liveResolve.start(n); return }
      if (await qm.send({ type: 'ticketTag', n, tag: g })) S.dispatch({ type: 'toast', text: g === 'On Hold' ? `${n} is On Hold: in ServiceNow it moves to the user's regional 3-Strike queue` : `${n} tagged ${g}` })
      else S.render()
    },
    'queue.tag': async (el) => { if (await qm.send({ type: 'ticketTag', n: el.dataset.v, tag: el.dataset.t })) S.dispatch({ type: 'toast', text: `${el.dataset.v} tagged ${el.dataset.t}` }) },
    'queue.moveTo': (el) => S.set(page(), { moveTo: el.value }),
    'queue.move': async (el) => {
      const p = page()
      if (p.moveTo && await qm.send({ type: 'ticketsAssigned', override: true, list: [{ n: el.dataset.v, to: p.moveTo, reason: `Moved by ${nameOf((qm.me() || {}).soeid)}` }] })) {
        S.dispatch({ type: 'toast', text: `${el.dataset.v} moved to ${nameOf(p.moveTo)}` }); S.set(p, { moveTo: '' })
      }
    },
    'queue.reassign': async (el) => {
      const n = el.dataset.v
      const t = view().tickets.find((x) => x.n === n)
      if (!t || !el.value || el.value === owner(t)) return
      if (await qm.send({ type: 'ticketsAssigned', override: true, list: [{ n, to: el.value, reason: `Moved by ${nameOf((qm.me() || {}).soeid)}` }] })) S.dispatch({ type: 'toast', text: `${n} moved to ${nameOf(el.value)}` })
      else S.render()
    },
    'queue.file': (el) => { readFile(el.files && el.files[0]); el.value = '' },
    'queue.dragover': (el, ev) => { ev.preventDefault(); if (!imp().drag) S.set(imp(), { drag: true }) },
    'queue.dragleave': () => S.set(imp(), { drag: false }),
    'queue.drop': (el, ev) => { ev.preventDefault(); S.set(imp(), { drag: false }); readFile(ev.dataTransfer && ev.dataTransfer.files[0]) },
    'queue.cancel': () => S.set(imp(), { preview: null, error: null, queue: null, file: null }),
    'queue.confirm': () => confirmImport(),
    'queue.undo': async (el) => { if (await qm.send({ type: 'importUndo', importId: el.dataset.v })) { S.set(imp(), { last: null }); S.dispatch({ type: 'toast', text: 'Load undone' }) } },
    'queue.handout': async () => { const p = await handOut(null); S.dispatch({ type: 'toast', text: p.list.length ? `Handed out ${p.list.length} tickets` : 'Nobody on shift before their cutoff' }) },
    'queue.set': (el) => { const u = S.ui('p:team:settings'); u.draft = { ...u.draft, [el.dataset.k]: el.value }; S.render() },
    'queue.setReset': () => S.set(S.ui('p:team:settings'), { draft: {}, tried: false }),
    'queue.setSave': () => saveSettings(),
    'queue.goImport': () => goImport(),
    'queue.goQueue': () => goQueue(),
    'queue.impOpen': () => S.set(imp(), { open: true }),
    'queue.impQueue': (el) => { const u = imp(); S.set(u, { queue: el.value, error: null }); if (u.file) readFile(u.file) },
    'queue.impClose': () => S.set(imp(), { open: false, preview: null, error: null, last: null, queue: null, file: null }),
    'queue.qf': (el) => { const u = S.ui('p:team:queues'); const list = qDraft(); const q = list[Number(el.dataset.i)]; if (!q) return; q[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; u.draft = list; S.render() },
    'queue.qadd': () => { const u = S.ui('p:team:queues'); const list = qDraft(); list.push({ id: `strike-${uid('q').slice(-6).toLowerCase().replace(/[^a-z0-9]/g, '')}`, kind: 'strike', name: '', view: '', start: '', end: '', cutoff: 30, active: true }); u.draft = list; S.render() },
    'queue.qdel': (el) => { const u = S.ui('p:team:queues'); const list = qDraft(); list.splice(Number(el.dataset.i), 1); u.draft = list; S.render() },
    'queue.qreset': () => S.set(S.ui('p:team:queues'), { draft: null, tried: false }),
    'queue.qsave': async () => {
      const u = S.ui('p:team:queues')
      const list = qDraft()
      if (list.some((q, i) => queueErr(q, list, i))) { S.set(u, { tried: true }); return }
      if (await qm.send({ type: 'queuesSet', queues: list.map(cleanQueue) })) { S.set(u, { draft: null, tried: false }); S.dispatch({ type: 'toast', text: 'Queues saved for the team' }) }
    },
    'queue.hoNotes': (el) => { ho().notes = el.value; S.render() },
    'queue.hoCopy': () => { const t = handoverText(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => S.dispatch({ type: 'toast', text: 'Handover summary copied' }), () => S.dispatch({ type: 'toast', text: "Couldn't copy; select the text instead" })) },
    // From the header popover: go Home and open the import first (navigating resets the
    // import state), then read the file so its preview shows next to "Load and hand out".
    'queue.popFile': (el) => { const f = el.files && el.files[0]; el.value = ''; if (f) { goImport(); readFile(f) } },
    'queue.popDrop': (el, ev) => { ev.preventDefault(); const f = ev.dataTransfer && ev.dataTransfer.files[0]; S.set(imp(), { drag: false }); if (f) { goImport(); readFile(f) } },
  })
})()
