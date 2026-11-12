// Queue: real INC tickets from the ServiceNow export, handed out automatically.
//
// Replaces the team's QueueManager tool (vault: QueueManager Mechanics, D13–D18):
//  - Team settings: SLA/SLO targets, shift times, EERS keywords. Lead edits, everyone follows.
//  - Who's on shift: each roster sign-in records today's role and shift (shiftStart).
//  - Import: drop the ServiceNow CSV. Rows are deduped by INC number; a row only
//    replaces what we have when its sys_updated_on is newer. The description is
//    read once for the EERS keywords and never stored (it's full of personal data).
//  - Assignment: the moment tickets load, EERS tickets go to today's Proci Backup and
//    the rest to whoever has handled the fewest tickets today, among the people on
//    shift and before their cutoff. Every assignment carries its reason. Tickets
//    already assigned in ServiceNow are skipped and count for that person.
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
    { key: 'inc.sloHours', group: 'Targets', label: 'Regular INC: SLO', unit: 'hours untouched', type: 'num', def: 4 },
    { key: 'inc.slaHours', group: 'Targets', label: 'Regular INC: SLA', unit: 'hours untouched', type: 'num', def: 4 },
    { key: 'eers.sloHours', group: 'Targets', label: 'EERS: SLO', unit: 'hours untouched', type: 'num', def: 1 },
    { key: 'eers.slaHours', group: 'Targets', label: 'EERS: SLA', unit: 'hours untouched', type: 'num', def: 8 },
    { key: 'backlogHour', group: 'Targets', label: 'Backlog after', unit: 'a ticket untouched since before this time today (or a prior day) is backlog', type: 'time', def: '05:00' },
    { key: 'early.start', group: 'Shifts', label: 'Early shift starts', type: 'time', def: '05:00' },
    { key: 'early.end', group: 'Shifts', label: 'Early shift ends', type: 'time', def: '14:00' },
    { key: 'late.start', group: 'Shifts', label: 'Late shift starts', type: 'time', def: '06:00' },
    { key: 'late.end', group: 'Shifts', label: 'Late shift ends', type: 'time', def: '15:00' },
    { key: 'cutoffMinutes', group: 'Shifts', label: 'Stop handing out tickets', unit: 'minutes before the shift ends', type: 'num', def: 30 },
    { key: 'eersKeywords', group: 'Assignment', label: 'EERS keywords', unit: 'whole words, comma-separated, in the short description or description', type: 'text', def: 'EERS, entitlement, entitlements' },
    { key: 'pool.mainProci', group: 'Assignment', label: 'Main Proci gets regular tickets', type: 'bool', def: true },
    { key: 'pool.backup', group: 'Assignment', label: 'Proci Backup gets regular tickets too', type: 'bool', def: true },
    { key: 'uploadReminder', group: 'Data', label: 'Remind to load a new export after', unit: 'minutes', type: 'num', def: 45 },
    { key: 'exportTz', group: 'Data', label: 'Time zone of the export\'s dates', type: 'tz', def: 'local' },
  ]
  const TZ_OPTIONS = [['local', "Same as this computer's clock"], ...Array.from({ length: 27 }, (_, i) => i - 12).flatMap((h) => (h === 5 ? [[String(h), 'UTC+5'], ['5.5', 'UTC+5:30']] : [[String(h), h === 0 ? 'UTC' : `UTC${h > 0 ? '+' : ''}${h}`]]))]
  const def = Object.fromEntries(SETTINGS.map((s) => [s.key, s.def]))

  // ---------- Fold ----------
  // Memoised on the loaded log: every render reads the same folded view.
  let memo = { events: null }
  const isLead = (soeid) => ((qm.roster.find((p) => p.soeid === soeid) || {}).accessRole === 'Lead')
  const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

  function fold(events) {
    const undone = new Set(events.filter((ev) => ev.e && ev.e.type === 'importUndo').filter((ev) => {
      const imp = events.find((x) => x.e && x.e.type === 'ticketsImported' && x.e.importId === ev.e.importId)
      return imp && (ev.by === imp.by || isLead(ev.by))
    }).map((ev) => ev.e.importId))
    const settings = { ...def }
    const settingsLog = []
    const presence = new Map() // `${day}|${soeid}` -> { soeid, duty, shift, at }
    const tickets = new Map()
    const imports = new Map()
    for (const ev of events) {
      const e = ev.e || {}
      if (e.type === 'settingsSet' && isLead(ev.by) && e.values && typeof e.values === 'object') {
        for (const [k, v] of Object.entries(e.values)) if (k in def) { settingsLog.push({ key: k, from: settings[k], to: v, by: ev.by, at: ev.at }); settings[k] = v }
      } else if (e.type === 'shiftStart' && e.day) {
        presence.set(`${e.day}|${ev.by}`, { soeid: ev.by, duty: e.duty, shift: e.shift, at: ev.at, day: e.day, edited: !!e.edited })
      } else if (e.type === 'ticketsImported' && !undone.has(e.importId) && Array.isArray(e.rows)) {
        const imp = imports.get(e.importId) || { id: e.importId, by: ev.by, at: ev.at, file: e.file || '', total: e.total || 0, rows: 0, added: 0, updated: 0 }
        imports.set(e.importId, imp)
        for (const r of e.rows) {
          if (!r || !INC_RE.test(r.n)) continue
          imp.rows++
          const t = tickets.get(r.n)
          if (!t) {
            tickets.set(r.n, { ...r, firstSeen: ev.at, importId: e.importId, lastImport: e.importId, to: null, assignedAt: null, reason: '', assignedBy: null, tag: 'Assigned', tagAt: null, tagBy: null, notes: [], history: [] })
            imp.added++
          } else {
            t.lastImport = e.importId
            if ((r.updated || 0) > (t.updated || 0)) { Object.assign(t, r); imp.updated++ }
          }
        }
      } else if (e.type === 'ticketsAssigned' && !undone.has(e.importId) && Array.isArray(e.list)) {
        for (const a of e.list) {
          const t = a && tickets.get(a.n)
          const target = a && qm.roster.find((p) => p.soeid === a.to)
          if (!t || !target) continue
          if (t.to && !(e.override && isLead(ev.by))) continue // first assignment wins; only a lead moves a ticket
          t.history.push({ what: t.to ? `moved from ${nameOf(t.to)} to ${target.name}` : `assigned to ${target.name}`, by: ev.by, at: ev.at, note: a.reason || '' })
          Object.assign(t, { to: a.to, assignedAt: ev.at, reason: a.reason || '', assignedBy: ev.by })
        }
      } else if (e.type === 'ticketTag' && TAGS.includes(e.tag)) {
        const t = tickets.get(e.n)
        if (t && (ev.by === owner(t) || isLead(ev.by))) { t.history.push({ what: `tagged ${e.tag}`, by: ev.by, at: ev.at, note: '' }); Object.assign(t, { tag: e.tag, tagAt: ev.at, tagBy: ev.by }) }
      } else if (e.type === 'ticketNote' && String(e.text || '').trim()) {
        const t = tickets.get(e.n)
        if (t) t.notes.push({ by: ev.by, at: ev.at, text: String(e.text).trim() })
      }
    }
    const latest = [...imports.values()].pop() || null
    for (const t of tickets.values()) t.inLatest = !!latest && t.lastImport === latest.id
    return { settings, settingsLog, presence, tickets: [...tickets.values()], imports: [...imports.values()], latest, undone }
  }
  function view() {
    if (memo.events !== qm.events || memo.roster !== qm.roster) memo = { events: qm.events, roster: qm.roster, v: fold(qm.events || []) }
    return memo.v
  }

  // ---------- People, shifts, load ----------
  const nameOf = (soeid) => ((qm.roster.find((p) => p.soeid === soeid) || {}).name || soeid)
  // The ticket's owner: whoever Scope assigned it to, else the roster person ServiceNow names.
  function owner(t) {
    if (t.to) return t.to
    if (!t.sn) return null
    const p = qm.roster.find((x) => norm(x.name) === norm(t.sn))
    return p ? p.soeid : null
  }
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
  const startOfDay = (now) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() }
  // Handled today = tickets that became theirs today (any tag, Transferred included)
  // plus verified manual entries handled today (D12).
  function loadToday(soeid, now = Date.now(), tickets = view().tickets) {
    const from = startOfDay(now)
    const t = tickets.filter((x) => owner(x) === soeid && (x.to ? x.assignedAt : x.firstSeen) >= from).length
    const m = (qm.entries || []).filter((x) => x.by === soeid && x.status === 'Verified' && x.handledAt >= from).length
    return { total: t + m, tickets: t, manual: m }
  }

  // ---------- Health ----------
  function health(t, s, now = Date.now()) {
    const eers = !!t.eers
    const slo = Number(eers ? s['eers.sloHours'] : s['inc.sloHours']) * HOUR
    const sla = Number(eers ? s['eers.slaHours'] : s['inc.slaHours']) * HOUR
    const untouched = now - (t.updated || t.opened || now)
    const backlogFrom = at(now, s.backlogHour)
    return { untouched, sloBreached: untouched > slo, slaBreached: untouched > sla, backlog: (t.updated || t.opened || now) < backlogFrom }
  }
  const isOpen = (t) => t.inLatest && OPEN_TAGS.includes(t.tag)

  // ---------- Automatic assignment (D15) ----------
  // Pure: given the folded tickets, who's on shift and the settings, decide who gets what.
  function plan({ tickets, people, settings, now, load }) {
    const pool = people.filter((p) => now < p.w.cutoff)
    const counts = new Map(pool.map((p) => [p.soeid, load(p.soeid)]))
    const last = new Map() // tie-break: whoever got a ticket least recently in this batch
    const todo = tickets.filter((t) => t.inLatest && !t.to && !t.sn && t.tag === 'Assigned')
      .sort((a, b) => (a.p || 9) - (b.p || 9) || (a.opened || 0) - (b.opened || 0))
    const regular = pool.filter((p) => (p.duty !== 'MAIN_PROCI' || settings['pool.mainProci'] !== false) && (p.duty !== 'PROCI_BACKUP' || settings['pool.backup'] !== false))
    const backups = pool.filter((p) => p.duty === 'PROCI_BACKUP')
    const pick = (list) => list.slice().sort((a, b) => counts.get(a.soeid) - counts.get(b.soeid) || (last.get(a.soeid) || 0) - (last.get(b.soeid) || 0) || a.person.name.localeCompare(b.person.name))[0]
    const out = []
    const left = []
    let i = 0
    for (const t of todo) {
      let who; let why
      if (t.eers && backups.length) {
        who = pick(backups)
        why = `EERS (${t.eers}) → Proci Backup, fewest handled today (${counts.get(who.soeid)})`
      } else {
        const list = regular.length ? regular : pool
        who = pick(list)
        if (who) why = `${t.eers ? `EERS (${t.eers}), but no Proci Backup on shift. ` : ''}Fewest handled today (${counts.get(who.soeid)}) of ${list.length} on shift`
      }
      if (!who) { left.push(t); continue }
      out.push({ n: t.n, to: who.soeid, reason: why })
      counts.set(who.soeid, counts.get(who.soeid) + 1)
      last.set(who.soeid, ++i)
    }
    return { list: out, left, pool }
  }
  async function handOut(importId) {
    const now = Date.now()
    const v = view()
    const p = plan({ tickets: v.tickets, people: onShift(now), settings: v.settings, now, load: (s) => loadToday(s, now, v.tickets).total })
    if (!p.list.length) return p
    for (let k = 0; k < p.list.length; k += 300) {
      if (!(await qm.send({ type: 'ticketsAssigned', importId: importId || null, list: p.list.slice(k, k + 300) }))) break
    }
    return p
  }

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
  }
  const REQUIRED = ['n', 'opened', 'updated', 'short', 'state', 'group', 'sn']
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
  function normalise(table, settings) {
    const head = table[0].map((h) => h.trim().toLowerCase())
    const idx = {}
    for (const [k, names] of Object.entries(COLS)) idx[k] = head.findIndex((h) => names.includes(h))
    const missing = REQUIRED.filter((k) => idx[k] < 0).map((k) => COLS[k][0])
    if (missing.length) return { error: `This doesn't look like the ServiceNow incident export: no ${missing.join(', ')} column.` }
    const byN = new Map(); const skipped = []
    table.slice(1).forEach((r, i) => {
      const get = (k) => (idx[k] >= 0 ? r[idx[k]] || '' : '')
      const n = get('n').trim().toUpperCase()
      if (!INC_RE.test(n)) { skipped.push({ line: i + 2, why: n ? `"${n.slice(0, 20)}" isn't an INC number` : 'no INC number' }); return }
      const opened = parseWhen(get('opened'), settings.exportTz)
      const updated = parseWhen(get('updated'), settings.exportTz)
      if (opened == null || updated == null) { skipped.push({ line: i + 2, why: `${n}: unreadable opened or updated date` }); return }
      const short = clean(get('short')).slice(0, 300)
      const priority = clean(get('priority')).slice(0, 40)
      const row = {
        n, opened, updated, short, priority, p: Number((priority.match(/^\d/) || [9])[0]),
        state: clean(get('state')).slice(0, 40), group: clean(get('group')).slice(0, 120), sn: clean(get('sn')).slice(0, 120),
        createdBy: clean(get('createdBy')).slice(0, 40), location: clean(get('location')).slice(0, 120),
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
    const out = normalise(parseCsv(text), view().settings)
    if (out.error) { S.set(u, { busy: false, error: out.error }); return }
    const known = new Map(view().tickets.map((t) => [t.n, t]))
    const fresh = out.rows.filter((r) => !known.has(r.n))
    const newer = out.rows.filter((r) => known.has(r.n) && r.updated > (known.get(r.n).updated || 0))
    const inFile = new Set(out.rows.map((r) => r.n))
    const gone = view().tickets.filter((t) => t.inLatest && !inFile.has(t.n))
    S.set(u, { busy: false, preview: { file: file.name, enc, rows: out.rows, skipped: out.skipped, dupes: out.dupes, fresh: fresh.length, newer: newer.length, same: out.rows.length - fresh.length - newer.length, gone: gone.length, eers: out.rows.filter((r) => r.eers).length, snAssigned: out.rows.filter((r) => r.sn).length } })
  }
  async function confirmImport() {
    const u = imp()
    const pv = u.preview
    if (!pv || u.busy) return
    S.set(u, { busy: true })
    const importId = uid('imp')
    const parts = Math.max(1, Math.ceil(pv.rows.length / CHUNK))
    for (let k = 0; k < parts; k++) {
      const ok = await qm.send({ type: 'ticketsImported', importId, file: pv.file, total: pv.rows.length, part: k + 1, parts, rows: pv.rows.slice(k * CHUNK, (k + 1) * CHUNK) })
      if (!ok) { S.set(u, { busy: false }); return }
    }
    const p = await handOut(importId)
    S.set(u, { busy: false, preview: null, last: { importId, rows: pv.rows.length, assigned: p.list.length, left: p.left.length, pool: p.pool.length } })
    S.dispatch({ type: 'toast', text: `${pv.rows.length} tickets loaded · ${p.list.length} handed out` })
  }

  // ---------- UI helpers ----------
  const imp = () => S.ui('p:qm:import', { busy: false, error: null, preview: null, last: null, drag: false })
  const fmtWhen = (ms) => (ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—')
  const fmtAgo = (ms) => { const m = Math.round(ms / 60e3); return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} days` }
  const tagPill = (tag) => html`<span class="${cls('pill', TAG_TONE[tag])}">${tag}</span>`
  function healthPills(t, s) {
    const h = health(t, s)
    return html`<span class="row tight nowrap">
      ${h.slaBreached ? html`<span class="pill crit" title="Untouched longer than the SLA">SLA</span>` : h.sloBreached ? html`<span class="pill warn" title="Untouched longer than the SLO">SLO</span>` : html`<span class="pill good">OK</span>`}
      ${h.backlog && html`<span class="pill" title="Untouched since before ${s.backlogHour} today">Backlog</span>`}
      <span class="muted small">${fmtAgo(h.untouched)}</span></span>`
  }
  const eersPill = (t) => t.eers && html`<span class="pill sky" title="${t.eers}">EERS</span>`
  const ownerCell = (t) => {
    const o = owner(t)
    if (o) return html`${nameOf(o)}${!t.to && html` <span class="muted small" title="Assigned in ServiceNow">(ServiceNow)</span>`}`
    if (t.sn) return html`<span class="muted" title="Assigned in ServiceNow to someone not on the roster">${t.sn}</span>`
    return html`<span class="pill warn">Unassigned</span>`
  }

  // ---------- My tickets (D13) ----------
  function myTickets(me) {
    const v = view()
    const u = S.ui('p:qm:mine-t', { show: 'open' })
    const mine = v.tickets.filter((t) => owner(t) === me.soeid)
    const today = startOfDay(Date.now())
    const list = mine.filter((t) => (u.show === 'open' ? isOpen(t) : u.show === 'today' ? (t.to ? t.assignedAt : t.firstSeen) >= today : true))
      .sort((a, b) => health(b, v.settings).untouched - health(a, v.settings).untouched)
    return html`<div class="card">
      <div class="card-h qm-toolbar">
        <b>My tickets</b>
        <span class="muted small">Tag each ticket as you work it. Everyone sees the tags straight away.</span>
        <span class="spacer"></span>
        <select class="in" aria-label="Show" data-change="queue.show">
          ${[['open', 'Still open'], ['today', 'Handed to me today'], ['all', 'All my tickets']].map(([k, l]) => html`<option value="${k}" ${attrs({ selected: u.show === k })}>${l}</option>`)}
        </select>
      </div>
      ${list.length ? ticketTable(list, v.settings, { mine: true }) : html`<div class="empty">${!v.latest ? 'No tickets yet. They appear here once someone loads the ServiceNow export on the Team queue tab.' : u.show === 'open' ? 'Nothing open on you.' : 'No tickets here.'}</div>`}
    </div>`
  }

  function ticketTable(list, s, { mine = false } = {}) {
    const sel = S.ui('p:qm').tsel
    return html`<div class="tbl-wrap tbl-scroll"><table class="tbl qm-tbl">
      <thead><tr><th>INC</th><th>Short description</th><th>Priority</th>${!mine && html`<th>Owner</th>`}<th>Tag</th><th>Untouched</th><th>ServiceNow state</th></tr></thead>
      <tbody>${list.map((t) => html`<tr data-key="${t.n}" class="${cls(sel === t.n && 'sel', !t.inLatest && 'muted')}">
        <td class="nowrap"><button class="btn ghost sm mono" data-click="queue.open" data-v="${t.n}">${t.n}</button> ${eersPill(t)}</td>
        <td class="qm-clip" title="${t.short}">${t.short || html`<span class="muted">(no short description)</span>`}</td>
        <td class="nowrap">${t.priority}</td>
        ${!mine && html`<td class="nowrap">${ownerCell(t)}</td>`}
        <td>${!t.inLatest ? html`<span class="pill" title="Not in the latest export: closed or moved to another group in ServiceNow">Left the queue</span>` : tagPill(t.tag)}</td>
        <td>${t.inLatest && OPEN_TAGS.includes(t.tag) ? healthPills(t, s) : html`<span class="muted small">—</span>`}</td>
        <td class="nowrap small">${t.state}</td>
      </tr>`)}</tbody></table></div>`
  }

  function ticketDrawer(t, me) {
    const v = view()
    const o = owner(t)
    const canTag = me && (me.soeid === o || me.accessRole === 'Lead')
    const lead = me && me.accessRole === 'Lead'
    const u = S.ui('p:qm')
    S.drawer({
      className: 'qm-drawer',
      onClose: 'queue.close',
      title: html`<span class="row tight">${tagPill(t.tag)}${eersPill(t)}</span><h2 class="drawer-title mono">${t.n}</h2>`,
      sub: html`<span class="muted small">${t.short}</span>`,
      body: html`<div class="stack" style="gap:16px">
        <dl class="qm-dl">
          <dt>Owner</dt><dd>${ownerCell(t)}</dd>
          ${t.reason && html`<dt>Why them</dt><dd>${t.reason}<div class="muted small">${fmtWhen(t.assignedAt)}</div></dd>`}
          <dt>Priority</dt><dd>${t.priority}</dd>
          <dt>ServiceNow</dt><dd>${t.state} · ${t.group}${t.sn && html` · assigned to ${t.sn}`}</dd>
          <dt>Opened</dt><dd>${fmtWhen(t.opened)}</dd>
          <dt>Last updated</dt><dd>${fmtWhen(t.updated)} ${t.inLatest && healthPills(t, v.settings)}</dd>
          ${t.eers && html`<dt>EERS because</dt><dd>${t.eers}</dd>`}
          ${t.location && html`<dt>Location</dt><dd>${t.location}</dd>`}
          ${!t.inLatest && html`<dt>Queue</dt><dd>Not in the latest export: closed, or moved to another group in ServiceNow.</dd>`}
        </dl>
        ${canTag && html`<div class="stack" style="gap:8px">
          <span class="eyebrow">Tag</span>
          <div class="row tight">${TAGS.map((g) => html`<button class="${cls('btn sm', t.tag === g && 'primary')}" data-click="queue.tag" data-v="${t.n}" data-t="${g}" ${attrs({ 'aria-pressed': String(t.tag === g) })}>${g}</button>`)}</div>
          <span class="muted small">Transferred still counts as handled; reports show it separately.</span>
        </div>`}
        ${lead && html`<div class="stack" style="gap:8px">
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
  }

  // ---------- Team queue: load the export, see the spread ----------
  function freshness(v) {
    if (!v.latest) return html`<div class="callout warn">${icon('upload', 16)}<span><b>No export loaded yet.</b> Export the incident list from ServiceNow as CSV and drop it below.</span></div>`
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
    return html`<div class="card"><div class="card-b stack" style="gap:12px">
      <label class="${cls('qm-drop', u.drag && 'on')}" data-dragover="queue.dragover" data-dragleave="queue.dragleave" data-drop="queue.drop">
        ${icon('upload', 20)}
        <span><b>Drop the ServiceNow incident export here</b> or <u>choose the file</u></span>
        <span class="muted small">CSV with the usual columns (number, opened_at, sys_updated_on, short_description, state, assignment_group, assigned_to…). Descriptions are only checked for EERS keywords, never stored.</span>
        <input type="file" accept=".csv,text/csv" class="sr-only" data-change="queue.file">
      </label>
      ${u.busy && html`<div class="muted small">Working…</div>`}
      ${u.error && html`<div class="callout crit">${icon('alert', 16)}<span>${u.error}</span></div>`}
      ${pv && html`<div class="stack" style="gap:10px">
        <div class="row"><b>${pv.file}</b><span class="muted small">${pv.rows.length} tickets · read as ${pv.enc}</span></div>
        <div class="grid g-kpi">
          ${S.kpi({ label: 'New', icon: 'plus', tone: 'good', value: pv.fresh, foot: 'Not seen before' })}
          ${S.kpi({ label: 'Updated', icon: 'refresh', tone: 'sky', value: pv.newer, foot: 'Newer in ServiceNow' })}
          ${S.kpi({ label: 'EERS', icon: 'key', tone: 'navy', value: pv.eers, foot: 'Go to the Proci Backup' })}
          ${S.kpi({ label: 'Left the queue', icon: 'swap', tone: 'warn', value: pv.gone, foot: 'Open before, not in this file' })}
        </div>
        <div class="muted small">${pv.same} unchanged · ${pv.snAssigned} already assigned in ServiceNow (skipped, counted for that person)${pv.dupes > 0 && ` · ${pv.dupes} repeated rows merged`}</div>
        ${pv.skipped.length > 0 && html`<details class="small"><summary>${pv.skipped.length} rows skipped</summary><ul>${pv.skipped.slice(0, 20).map((x) => html`<li>Line ${x.line}: ${x.why}</li>`)}</ul></details>`}
        <div class="row"><span class="spacer"></span><button class="btn ghost" data-click="queue.cancel">Cancel</button>
          <button class="btn primary" data-click="queue.confirm" ${attrs({ disabled: u.busy || !pv.rows.length })}>${icon('check', 15)}Load and hand out</button></div>
      </div>`}
      ${u.last && !pv && html`<div class="callout good">${icon('check', 16)}<span>Loaded ${u.last.rows} tickets. Handed out ${u.last.assigned} to ${u.last.pool} on shift.${u.last.left > 0 && html` <b>${u.last.left} left unassigned</b>: nobody on shift before their cutoff.`}</span>
        ${canUndo(v.imports.find((x) => x.id === u.last.importId)) && html`<span class="spacer"></span><button class="btn sm" data-click="queue.undo" data-v="${u.last.importId}">Undo this load</button>`}</div>`}
    </div></div>`
  }

  function shiftCard(v) {
    const now = Date.now()
    const people = onShift(now)
    return html`<div class="card"><div class="card-h"><b>On shift today</b><span class="muted small">From today's sign-ins · handled today = tickets that became theirs today + verified manual entries</span></div>
      ${people.length ? html`<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Analyst</th><th>Role · shift</th><th class="num">Handled today</th><th class="num">Still open</th><th>Gets tickets until</th></tr></thead>
        <tbody>${people.map((p) => { const l = loadToday(p.soeid, now, v.tickets); const open = v.tickets.filter((t) => owner(t) === p.soeid && isOpen(t)).length; return html`<tr data-key="${p.soeid}">
          <td>${p.person.name}</td><td>${S.dutyLabel(p.duty)}${p.fromRota && html` <span class="muted small" title="From the Proci rota">(rota)</span>`}${p.edited && html` <span class="muted small" title="Changed after signing in">(changed)</span>`} · ${S.shiftLabel(p.shift)}</td>
          <td class="num" title="${l.tickets} tickets + ${l.manual} manual">${l.total}</td><td class="num">${open}</td>
          <td>${now < p.w.cutoff ? S.fmtTime(p.w.cutoff) : html`<span class="muted">Past cutoff</span>`}</td></tr>` })}</tbody>
      </table></div>` : html`<div class="card-b empty">Nobody has signed in today yet. People appear here when they sign in with their role and shift.</div>`}
    </div>`
  }

  function teamQueue(me) {
    const v = view()
    const u = S.ui('p:qm:queue', { show: 'open', q: '' })
    const q = u.q.trim().toLowerCase()
    const unassigned = v.tickets.filter((t) => t.inLatest && !owner(t) && !t.sn && t.tag === 'Assigned')
    const list = v.tickets
      .filter((t) => (u.show === 'open' ? isOpen(t) : u.show === 'unassigned' ? unassigned.includes(t) : u.show === 'gone' ? !t.inLatest : true))
      .filter((t) => !q || [t.n, t.short, t.group, t.sn, nameOf(owner(t))].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (a.p || 9) - (b.p || 9) || (a.opened || 0) - (b.opened || 0))
    const open = v.tickets.filter(isOpen)
    const h = open.map((t) => health(t, v.settings))
    return html`<div class="stack" style="gap:16px">
      ${freshness(v)}
      <div class="grid g-kpi">
        ${S.kpi({ label: 'Open tickets', icon: 'alert', value: open.length, foot: `${open.filter((t) => t.eers).length} EERS` })}
        ${S.kpi({ label: 'Unassigned', icon: 'user', tone: unassigned.length ? 'warn' : 'good', value: unassigned.length, foot: 'Waiting for someone on shift' })}
        ${S.kpi({ label: 'Past SLO', icon: 'clock', tone: 'warn', value: h.filter((x) => x.sloBreached && !x.slaBreached).length, foot: 'Untouched longer than the SLO' })}
        ${S.kpi({ label: 'Past SLA', icon: 'alert', tone: 'crit', value: h.filter((x) => x.slaBreached).length, foot: `${h.filter((x) => x.backlog).length} backlog` })}
      </div>
      ${importCard(me)}
      ${shiftCard(v)}
      <div class="card">
        <div class="card-h qm-toolbar">
          <div class="kb-search">${icon('search', 16)}<input type="search" placeholder="Search INC, description, group, owner" value="${u.q}" data-input="queue.q" aria-label="Search tickets"></div>
          <select class="in" aria-label="Show" data-change="queue.qshow">
            ${[['open', 'Open'], ['unassigned', 'Unassigned'], ['gone', 'Left the queue'], ['all', 'All']].map(([k, l]) => html`<option value="${k}" ${attrs({ selected: u.show === k })}>${l}</option>`)}
          </select>
          <span class="spacer"></span>
          ${unassigned.length > 0 && html`<button class="btn sm primary" data-click="queue.handout">${icon('send', 14)}Hand out ${unassigned.length} now</button>`}
        </div>
        ${list.length ? ticketTable(list, v.settings) : html`<div class="empty">${v.tickets.length ? 'Nothing matches.' : 'No tickets yet.'}</div>`}
      </div>
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
            : html`<input class="in" ${attrs({ type: s.type === 'num' ? 'number' : s.type === 'time' ? 'time' : 'text', min: s.type === 'num' ? '0' : null, step: s.type === 'num' ? 'any' : null, disabled: !lead })} value="${val(s)}" data-input="queue.set" data-k="${s.key}">`}
          ${u.tried && errs[s.key] && html`<span class="qm-err" role="alert">${errs[s.key]}</span>`}</label>`)}
      </div></div>`)}
      ${lead && html`<div class="row"><span class="muted small">${dirty.length ? `${dirty.length} unsaved change${dirty.length > 1 ? 's' : ''}` : 'No changes'}</span><span class="spacer"></span>
        <button class="btn ghost" data-click="queue.setReset" ${attrs({ disabled: !dirty.length })}>Discard</button>
        <button class="btn primary" data-click="queue.setSave" ${attrs({ disabled: !dirty.length })}>${icon('check', 15)}Save for the team</button></div>`}
      <div class="card"><div class="card-h"><b>Change history</b></div>
        ${v.settingsLog.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Setting</th><th>From</th><th>To</th></tr></thead>
          <tbody>${v.settingsLog.slice().reverse().slice(0, 50).map((x, i) => html`<tr data-key="${i}"><td class="nowrap">${fmtWhen(x.at)}</td><td>${nameOf(x.by)}</td><td>${(SETTINGS.find((s) => s.key === x.key) || {}).label}</td><td>${String(x.from)}</td><td><b>${String(x.to)}</b></td></tr>`)}</tbody></table></div>`
          : html`<div class="card-b empty">No changes yet: the values above are QueueManager's.</div>`}
      </div>
    </div>`
  }
  function checkSetting(s, v) {
    if (s.type === 'num') return v === '' || isNaN(Number(v)) || Number(v) < 0 ? 'Enter a number (0 or more).' : null
    if (s.type === 'time') return /^\d{2}:\d{2}$/.test(String(v)) ? null : 'Use HH:MM.'
    if (s.type === 'text') return String(v).trim() ? null : 'Add at least one keyword.'
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
    const unassigned = open.filter((t) => !owner(t) && !t.sn).length
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
        <span class="muted small snow-in">In:</span>
        <span class="dash-chip">${open.length} open</span>
        <span class="dash-chip">P1 ${p1}</span>
        <span class="dash-chip">${unassigned} waiting</span>
      </button>
      ${pop && html`<div class="popover popover-center" style="width:340px">
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
          ] : [['Source', 'ServiceNow incident export (CSV)'], ['Status', 'Nothing loaded yet']]).map(([k, val]) => html`<div class="row" style="justify-content:space-between;gap:12px"><span class="muted">${k}</span><b class="num" style="text-align:right">${val}</b></div>`)}
          ${h.tone !== 'good' && html`<div class="muted small">${v.latest ? 'The team loads a fresh export every ' + v.settings.uploadReminder + ' minutes; anyone can do it.' : 'Export the incident list from ServiceNow as CSV and load it.'}</div>`}
          <div class="row" style="margin-top:6px"><button class="btn sm primary" data-click="queue.goImport">${icon('upload', 14)}Load an export</button></div>
        </div>
      </div>`}
    </div>`
  }

  // ---------- Exports ----------
  S.queue = { importHealth, importPill, ticketTable, view, owner, onShift, loadToday, health, isOpen, plan, handOut, myTickets, teamQueue, ticketDrawer, settingsPanel, nameOf,
    _test: { parseCsv, normalise, parseWhen, eersMatch, fold, shiftWindow } }

  // ---------- Handlers ----------
  const page = () => S.ui('p:qm')
  S.on({
    'queue.show': (el) => S.set(S.ui('p:qm:mine-t'), { show: el.value }),
    'queue.qshow': (el) => S.set(S.ui('p:qm:queue'), { show: el.value }),
    'queue.q': (el) => S.set(S.ui('p:qm:queue'), { q: el.value }),
    'queue.open': (el) => S.set(page(), { tsel: el.dataset.v, tnote: '', moveTo: '' }),
    'queue.close': () => S.set(page(), { tsel: null }),
    'queue.noteText': (el) => { const p = page(); const was = !!(p.tnote || '').trim(); p.tnote = el.value; if (was !== !!el.value.trim()) S.render() },
    'queue.note': async (el) => { const p = page(); if (await qm.send({ type: 'ticketNote', n: el.dataset.v, text: (p.tnote || '').trim() })) S.set(p, { tnote: '' }) },
    'queue.tag': async (el) => { if (await qm.send({ type: 'ticketTag', n: el.dataset.v, tag: el.dataset.t })) S.dispatch({ type: 'toast', text: `${el.dataset.v} tagged ${el.dataset.t}` }) },
    'queue.moveTo': (el) => S.set(page(), { moveTo: el.value }),
    'queue.move': async (el) => {
      const p = page()
      if (p.moveTo && await qm.send({ type: 'ticketsAssigned', override: true, list: [{ n: el.dataset.v, to: p.moveTo, reason: `Moved by ${nameOf((qm.me() || {}).soeid)}` }] })) {
        S.dispatch({ type: 'toast', text: `${el.dataset.v} moved to ${nameOf(p.moveTo)}` }); S.set(p, { moveTo: '' })
      }
    },
    'queue.file': (el) => { readFile(el.files && el.files[0]); el.value = '' },
    'queue.dragover': (el, ev) => { ev.preventDefault(); if (!imp().drag) S.set(imp(), { drag: true }) },
    'queue.dragleave': () => S.set(imp(), { drag: false }),
    'queue.drop': (el, ev) => { ev.preventDefault(); S.set(imp(), { drag: false }); readFile(ev.dataTransfer && ev.dataTransfer.files[0]) },
    'queue.cancel': () => S.set(imp(), { preview: null, error: null }),
    'queue.confirm': () => confirmImport(),
    'queue.undo': async (el) => { if (await qm.send({ type: 'importUndo', importId: el.dataset.v })) { S.set(imp(), { last: null }); S.dispatch({ type: 'toast', text: 'Load undone' }) } },
    'queue.handout': async () => { const p = await handOut(null); S.dispatch({ type: 'toast', text: p.list.length ? `Handed out ${p.list.length} tickets` : 'Nobody on shift before their cutoff' }) },
    'queue.set': (el) => { const u = S.ui('p:team:settings'); u.draft = { ...u.draft, [el.dataset.k]: el.value }; S.render() },
    'queue.setReset': () => S.set(S.ui('p:team:settings'), { draft: {}, tried: false }),
    'queue.setSave': () => saveSettings(),
    'queue.goImport': () => { S.pop = null; S.nav('qm'); S.set(page(), { tab: 'queue', sel: null, tsel: null }) },
  })
})()
