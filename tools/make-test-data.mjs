// Test data for the demo (lead, 2026-11-27): 13 weeks of realistic history for YOUR team
// (data/roster.json), written into data/ so plain `pwsh server.ps1` shows it. Stop the server,
// then run:   node tools/make-test-data.mjs
// It never changes data/roster.json, and backs up data/ops.jsonl to data/backup/ first.
// Tickets, callers and apps are invented; data/ is gitignored, so nothing reaches the repo.
//
// What it models (in this computer's time zone):
//  - 13 weeks for the roster's people: weekly Proci rota, Early/Late shifts,
//    a few leaves, sign-ins every working day.
//  - The standard INC queue: 14–26 tickets a weekday (Mondays busier), 3–7 at weekends,
//    a quarter created overnight (so the morning starts with backlog). The export is loaded
//    every hour on the shift (06:05–15:05) and three times a day at weekends; each load holds
//    the open queue at that moment.
//  - Scope hands each new ticket to whoever holds the fewest; the analyst opens it in
//    ServiceNow, then Resolves (72%, with a resolution code), Transfers (14%) or puts it On
//    Hold (14%). Time with the analyst is log-normal around 1.6 h, so SLA attainment sits
//    in the mid-80s against the 90% north star, with weekly ups and downs.
//  - On Hold tickets go through 3-Strike: the region's view is loaded when its window opens
//    (NAM 06:00, APAC excl. India 08:00, APAC 11:30), handed out, and attempted (some not
//    finished in the window); reached → resolved later that day; Strike 3 → Resolved.
//  - A verified manual entry most weeks.
// Everything is invented: people, SOEIDs, INC numbers, apps, groups. Deterministic (seeded).
//
// Demo on this computer (lead, 2026-11-27):
//   node tools/make-test-data.mjs --into data
// builds the same kind of history for YOUR team (data/roster.json: the first Lead, then the
// other active people as analysts) in this computer's time zone, straight into data/ (old
// ops.jsonl backed up to data/backup/). Today is left clean for the demo: everyone working
// today is signed in except the person whose name matches --late (default "Marvin"), and
// no export has been loaded yet. It also writes two exports to load live, in
// data/demo-exports/: the standard INC export (a multiple of today's team size, with EERS
// tickets, so the hand-out comes out exactly even) and a 3-Strike export. data/ is
// gitignored, so real names never reach the repo. Stop the server before running it.
import fs from 'fs'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const INTO = opt('--into') || 'data' // always your team's data folder (one UI, one way to run: lead, 2026-11-27)
const LATE = new RegExp(opt('--late') || 'marvin', 'i')
const OUT = INTO || 'samples/test-data'
const PHT = 8 * 3600e3
const DAY = 864e5
const H = 3600e3; const M = 60e3

// ---------- Seeded random ----------
let seed = 20261127
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = (a) => a[Math.floor(rnd() * a.length)]
const between = (a, b) => a + rnd() * (b - a)
const weighted = (pairs) => { let r = rnd() * pairs.reduce((s, p) => s + p[1], 0); for (const [v, w] of pairs) { if ((r -= w) <= 0) return v } return pairs[0][0] }
const gauss = () => { let u = 0; let v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }

// ---------- Calendar (wall time in Manila) ----------
// --into: this computer's local time; otherwise Manila time (the committed sample).
const pht = INTO
  ? (day, h, m = 0) => { const [y, mo, d] = day.split('-').map(Number); return new Date(y, mo - 1, d, 0, 0).getTime() + (h * 60 + m) * M }
  : (day, h, m = 0) => { const [y, mo, d] = day.split('-').map(Number); return Date.UTC(y, mo - 1, d, 0, 0) - PHT + (h * 60 + m) * M }
const dayOf = INTO
  ? (ms) => { const x = new Date(ms); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
  : (ms) => new Date(ms + PHT).toISOString().slice(0, 10)
const addDays = (day, n) => dayOf(pht(day, 12) + n * DAY)
const wd = (day) => { const [y, mo, d] = day.split('-').map(Number); return (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7 } // 0 = Monday
const mondayOf = (day) => addDays(day, -wd(day))
const anchor = (argv[0] && /^\d{4}-\d{2}-\d{2}$/.test(argv[0]) ? argv[0] : null) || dayOf(Date.now())
const anchorMonday = mondayOf(anchor)
const WEEKS = 13
const start = addDays(anchorMonday, -7 * (WEEKS - 1))
const end = addDays(anchorMonday, 6)
const days = []; for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)

// ---------- Team ----------
// Your team from data/roster.json, never a sample one (lead, 2026-11-27).
const LEAD = { soeid: '', name: '', accessRole: 'Lead', active: true }
const ANALYSTS = []
let ROSTER = []
let SHIFT = {}
if (INTO) {
  // Your team from data/roster.json: the first active Lead, then everyone else active.
  const real = JSON.parse(fs.readFileSync(opt('--roster') || `${INTO}/roster.json`, 'utf8')).filter((p) => p && p.soeid && p.active !== false)
  const lead = real.find((p) => p.accessRole === 'Lead') || real[0]
  const rest = real.filter((p) => p !== lead)
  if (!lead || !rest.length) { console.error('data/roster.json needs at least a lead and one analyst.'); process.exit(1) }
  LEAD.soeid = lead.soeid; LEAD.name = lead.name
  ANALYSTS.length = 0; rest.forEach((p) => ANALYSTS.push({ soeid: p.soeid, name: p.name, accessRole: 'Analyst', active: true }))
  ROSTER = [LEAD, ...ANALYSTS]
  SHIFT = Object.fromEntries(ROSTER.map((p, i) => [p.soeid, i > 0 && i % 3 === 0 ? 'LATE' : 'EARLY']))
}
const SHIFT_T = { EARLY: [6, 15], LATE: [7, 16], WEEKEND: [6, 15] }
const ORDER = ANALYSTS.map((p) => p.soeid)
const weekIdx = (day) => Math.round((pht(mondayOf(day), 12) - pht(start, 12)) / (7 * DAY))
const proci = (day, back = 0) => ORDER[((weekIdx(day) - back) % ORDER.length + ORDER.length) % ORDER.length]
// Leaves: [soeid, first day offset from start, length in weekdays]
// A few leaves, none in the last (demo) week.
const LEAVES = [[0, 17, 2], [3, 38, 3], [1, 59, 1], [2, 73, 2]].filter(([i]) => i < ORDER.length).map(([i, o, n]) => ({ soeid: ORDER[i], from: addDays(start, o), to: addDays(start, o + n - 1) })).filter((l) => l.to < anchorMonday)
const onLeave = (s, day) => LEAVES.some((l) => l.soeid === s && day >= l.from && day <= l.to)
// Who works and in what role (same rules as the team's rota: the week's Proci is Main
// Mon–Thu and Weekend Support, rests Friday and the Monday after).
function working(day) {
  const w = wd(day); const P = proci(day); const P1 = proci(day, 1)
  if (w >= 5) return onLeave(P, day) ? [] : [{ soeid: P, duty: 'WEEKEND_SUPPORT', shift: 'WEEKEND' }]
  const out = []
  for (const p of ROSTER) {
    if (onLeave(p.soeid, day)) continue
    if ((w === 4 && p.soeid === P) || (w === 0 && p.soeid === P1)) continue
    const duty = p.soeid === P && w <= 3 ? 'MAIN_PROCI' : (w >= 1 && w <= 3 && p.soeid === P1) ? 'PROCI_BACKUP' : (w === 4 && p.soeid === P1) ? 'MAIN_PROCI' : 'ANALYST'
    out.push({ soeid: p.soeid, duty, shift: SHIFT[p.soeid] })
  }
  return out
}

// ---------- Ticket content (invented) ----------
const APPS = ['Payroll Portal', 'HR Self-Service', 'Trade Desk', 'Expense Hub', 'Client CRM', 'Shared Mailbox', 'Citrix Workspace', 'VPN', 'Data Warehouse', 'Procurement Portal', 'Treasury Hub', 'Ticketing Portal']
const CODES = [
  ['IAM-LOCK-01', 'IAM', 'LOCK', 'Unlock AD account, clear cached credentials', 'RB-201 Account lockout', 'Identity & access › Account lockout', 24],
  ['IAM-MFA-01', 'IAM', 'MFA', 'Re-enrol MFA factor after device change', 'RB-204 MFA re-enrolment', 'Identity & access › MFA enrolment', 18],
  ['IAM-ROLE-01', 'IAM', 'ROLE', 'Grant missing role through access request', 'RB-210 Access request', 'Identity & access › Missing role / entitlement', 20],
  ['NET-VPN-01', 'NET', 'VPN', 'Reset VPN client profile and reissue certificate', 'RB-112 VPN client recovery', 'Network › VPN tunnel / client', 9],
  ['APP-CFG-01', 'APP', 'CFG', 'Correct application config and restart app pool', 'RB-301 App config', 'Application › Misconfiguration', 7],
  ['APP-BUG-01', 'APP', 'BUG', 'Apply vendor workaround for known defect', 'RB-311 Known defects', 'Application › Known defect', 4],
  ['EUC-PRF-01', 'EUC', 'PRF', 'Rebuild corrupted user profile', 'RB-410 Profile rebuild', 'End-user device › Profile corruption', 6],
  ['INF-CRT-01', 'INF', 'CRT', 'Renew and bind expired certificate', 'RB-520 Certificate renewal', 'Infrastructure › Certificate expiry', 3],
  ['USR-HOW-01', 'USR', 'HOW', 'Walk user through steps; share KB article', 'KB-0091 How-to', 'User / how-to › How-to guidance', 9],
]
const SHORTS = {
  'IAM-LOCK-01': ['Account locked after password change, cannot sign in to {a}', 'Unable to login - account locked ({a})', 'Password expired and locked out of {a}'],
  'IAM-MFA-01': ['MFA token not syncing after phone replacement', 'Soft token not accepted on {a} login', 'MFA prompt loops on {a}'],
  'IAM-ROLE-01': ['Access request: read access to {a}', 'Missing approver role in {a}', 'Need access to {a} shared folder', 'Role not provisioned after transfer - {a}'],
  'NET-VPN-01': ['VPN token not syncing after replacement', 'VPN disconnects every few minutes', 'Cannot connect to VPN from home'],
  'APP-CFG-01': ['{a} returns error on save', '{a} page not loading after update'],
  'APP-BUG-01': ['{a} report export fails', '{a} freezes on submit'],
  'EUC-PRF-01': ['Desktop profile resets on every login to {a}', 'Outlook profile corrupted after migration'],
  'INF-CRT-01': ['Certificate warning on {a} login page'],
  'USR-HOW-01': ['How to request access to {a}', 'How to reset my own password for {a}', 'How to add a delegate to {a}'],
}
const GROUPS = [['IAM Service Desk L1', 85], ['IAM Access Operations', 15]]
const PRIO = [['2 - High', 8], ['3 - Moderate', 61], ['4 - Low', 30], ['1 - Critical', 1]]
let incNo = 29160000 + Math.floor(rnd() * 5000)

// ---------- Event log ----------
const events = []
const ev = (at, by, e) => events.push({ at: Math.round(at), by, e })
let uidN = 0
const uid = (p) => `${p}${(++uidN).toString(36)}`
ev(pht(start, 5, 40) - 3 * DAY, LEAD.soeid, { type: 'settingsSet', values: { 'early.start': '06:00', 'early.end': '15:00', 'late.start': '07:00', 'late.end': '16:00' } })
ev(pht(start, 5, 41) - 3 * DAY, LEAD.soeid, { type: 'rotaOrderSet', from: start, order: ORDER })
for (const p of ROSTER) ev(pht(start, 5, 42) - 3 * DAY, LEAD.soeid, { type: 'shiftPlanSet', week: start, soeid: p.soeid, shift: SHIFT[p.soeid] })
for (const l of LEAVES) ev(pht(l.from, 9) - 9 * DAY, l.soeid, { type: 'leaveAdd', id: uid('lv'), soeid: l.soeid, from: l.from, to: l.to, note: pick(['Vacation leave', 'Family event', 'Medical appointment']) })

// ---------- Tickets ----------
const tickets = []
// A slow drift so weeks differ: some weeks faster, some slower.
const weekPace = Array.from({ length: WEEKS }, () => between(0.8, 1.25))
for (const day of days) {
  const w = wd(day)
  const n = w >= 5 ? Math.round(between(3, 7)) : Math.round(between(14, 24) * (w === 0 ? 1.3 : 1) * between(0.9, 1.1))
  for (let i = 0; i < n; i++) {
    // A quarter overnight (other regions' day), the rest through the Manila day.
    const hour = rnd() < 0.25 ? (rnd() < 0.5 ? between(0, 6) : between(18, 24) - 24) : weighted([[between(6, 9), 2], [between(9, 12), 4], [between(12, 15), 4], [between(15, 18), 2]])
    const created = pht(day, 0) + hour * H
    const c = weighted(CODES.map((x) => [x, x[6]]))
    const app = pick(APPS)
    const eers = rnd() < 0.04
    let short = pick(SHORTS[c[0]]).replace('{a}', app)
    if (eers) short = `EERS - entitlement review for ${app}`
    const prio = weighted(PRIO)
    tickets.push({ n: `INC00${++incNo}`, created, short, priority: prio, p: Number(prio[0]), group: weighted(GROUPS), code: c, eers, caller: `user${Math.floor(rnd() * 9000 + 1000)}` })
  }
}
tickets.sort((a, b) => a.created - b.created)

// Export loads: hourly on weekdays 06:05–15:05, three at weekends.
const loads = []
for (const day of days) {
  const hrs = wd(day) >= 5 ? [7, 11, 14] : [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
  for (const h of hrs) loads.push(pht(day, h, 5 + Math.floor(rnd() * 4)))
}
const nextLoad = (ms) => loads.find((l) => l >= ms)
const shiftEnd = (s, day) => pht(day, SHIFT_T[s][1])

// Load per person (open now) for the hand-out, tracked as tickets open and close.
const openBy = new Map(ROSTER.map((p) => [p.soeid, []]))
const openCount = (s, at) => openBy.get(s).filter((x) => x > at).length
const strikeTasks = [] // { t, day, strike }

for (const t of tickets) {
  t.load = nextLoad(t.created)
  if (!t.load) continue
  const day = dayOf(t.load)
  const on = working(day)
  if (!on.length) { t.load = null; continue }
  const pool = on.filter((p) => !(t.eers) || p.duty === 'PROCI_BACKUP')
  const list = pool.length ? pool : on
  const who = list.slice().sort((a, b) => openCount(a.soeid, t.load) - openCount(b.soeid, t.load) || rnd() - 0.5)[0]
  t.to = who.soeid; t.assignedAt = t.load + between(40, 150) * 1000
  t.reason = t.eers && who.duty === 'PROCI_BACKUP' ? `EERS ("EERS" in the short description) → Proci Backup, who had ${openCount(who.soeid, t.load)} open` : `Fewest open tickets (${openCount(who.soeid, t.load)}) of ${list.length} on shift`
  t.openedAt = t.assignedAt + between(3, 35) * M
  // Time with the analyst: log-normal around 2 h, scaled by the week's pace and priority.
  const pace = weekPace[Math.min(WEEKS - 1, weekIdx(day))] * (t.p <= 2 ? 0.7 : 1)
  let res = Math.exp(Math.log(1.6) + 0.62 * gauss()) * pace * H
  let close = t.assignedAt + Math.max(12 * M, res)
  // Past the analyst's shift end, the rest carries to their next working morning.
  const endOf = shiftEnd(who.shift, day)
  // Most analysts finish what they started before the shift ends; the rest carries over.
  if (close > endOf && rnd() < 0.88 && endOf - between(5, 45) * M > t.assignedAt + 15 * M) close = endOf - between(5, 45) * M
  if (close > endOf) {
    let next = addDays(day, 1); let guard = 0
    while (guard++ < 10 && !working(next).some((p) => p.soeid === who.soeid)) next = addDays(next, 1)
    close = pht(next, SHIFT_T[SHIFT[who.soeid]][0], 20) + (close - endOf) * 0.6
  }
  // The demo morning starts with an empty queue: nothing carries over into today.
  const t0 = pht(dayOf(Date.now()), 0)
  if (close >= t0 && t.assignedAt < t0) close = Math.min(t0 - between(30, 240) * M, t.assignedAt + between(20, 90) * M)
  t.outcome = weighted([['Resolved', 72], ['Transferred', 14], ['On Hold', 14]])
  t.closeAt = close
  t.touch = t.openedAt + (close - t.openedAt) * between(0.2, 0.5) // the analyst's first update in ServiceNow
  openBy.get(who.soeid).push(close)
  if (t.outcome === 'On Hold') {
    t.region = weighted([['strike-nam', 40], ['strike-apac-xin', 35], ['strike-apac', 25]])
    let d = addDays(dayOf(close), 1); while (wd(d) >= 5) d = addDays(d, 1)
    strikeTasks.push({ t, day: d, strike: 1 })
  }
}

// Row as Scope stores it after normalising the export.
const row = (t, at, state) => ({
  n: t.n, opened: t.created, created: t.created, updated: Math.max(t.created, t.touch && t.touch <= at ? t.touch : t.created),
  short: t.short, priority: t.priority, p: t.p, state: state || (t.touch && t.touch <= at ? 'In Progress' : 'New'),
  group: t.group, sn: t.touch && t.touch <= at ? (ROSTER.find((p) => p.soeid === t.to) || {}).name : '', createdBy: 'svc-portal', location: '',
  eers: t.eers ? '"EERS" in the short description' : '',
})

// INC loads, each with the open queue at that moment (On Hold ones have left it).
for (const at of loads) {
  const open = tickets.filter((t) => t.load && t.created <= at && t.load <= at && !(t.closeAt <= at))
  if (!open.length) continue
  const on = working(dayOf(at))
  const by = (on[0] || { soeid: LEAD.soeid }).soeid
  const importId = uid('imp')
  const rows = open.map((t) => row(t, at))
  for (let k = 0, parts = Math.ceil(rows.length / 150); k < parts; k++) ev(at + k, by, { type: 'ticketsImported', importId, queue: 'inc', file: `incident_${dayOf(at).replace(/-/g, '')}.csv`, total: rows.length, part: k + 1, parts, rows: rows.slice(k * 150, (k + 1) * 150) })
  const fresh = open.filter((t) => t.load === at)
  if (fresh.length) ev(at + 90e3, by, { type: 'ticketsAssigned', importId, list: fresh.map((t) => ({ n: t.n, to: t.to, reason: t.reason })) })
}
for (const t of tickets) {
  if (!t.load) continue
  ev(t.openedAt, t.to, { type: 'ticketOpened', n: t.n })
  if (t.outcome === 'Resolved') {
    const [code, cause, sub, title, runbook, category] = t.code
    ev(t.closeAt, t.to, { type: 'ticketTag', n: t.n, tag: 'Resolved', res: { code, cause, sub, title, runbook, isNew: false, category, symptom: t.short, impact: 'Single user', diagNote: '', fix: title, validated: true, validNote: 'User confirmed', fcr: rnd() < 0.7, transfers: 0, escalatedTo: '', breachCode: '', closeNote: '' } })
  } else ev(t.closeAt, t.to, { type: 'ticketTag', n: t.n, tag: t.outcome })
}

// ---------- 3-Strike ----------
const WIN = { 'strike-nam': [6, 0, 8, 0], 'strike-apac-xin': [8, 0, 11, 30], 'strike-apac': [11, 30, 16, 0] }
const sToday = new Map() // day -> soeid -> 3-Strike given that day
const queueDays = new Map()
for (let i = 0; i < strikeTasks.length; i++) {
  const s = strikeTasks[i]
  if (s.day > end) continue
  const key = `${s.day}|${s.t.region}`
  if (!queueDays.has(key)) queueDays.set(key, [])
  queueDays.get(key).push(s)
}
const keys = [...queueDays.keys()].sort()
for (let ki = 0; ki < keys.length; ki++) {
  const key = keys[ki]
  const [day, q] = key.split('|')
  const list = queueDays.get(key)
  const on = working(day)
  if (!on.length) continue
  const [h0, m0, h1, m1] = WIN[q]
  const open = pht(day, h0, m0) + between(2, 6) * M
  const close = pht(day, h1, m1)
  const by = on[0].soeid
  ev(open, by, { type: 'ticketsImported', importId: uid('simp'), queue: q, file: `${q}_${day.replace(/-/g, '')}.csv`, total: list.length, part: 1, parts: 1, rows: list.map((s) => row(s.t, open, 'On Hold')) })
  if (!sToday.has(day)) sToday.set(day, new Map())
  const given = sToday.get(day)
  const assigns = []
  for (const s of list) {
    const p = on.slice().sort((a, b) => (given.get(a.soeid) || 0) - (given.get(b.soeid) || 0) || rnd() - 0.5)[0]
    given.set(p.soeid, (given.get(p.soeid) || 0) + 1)
    assigns.push({ s, to: p.soeid })
  }
  ev(open + 60e3, by, { type: 'strikeAssign', day, queue: q, list: assigns.map((a) => ({ n: a.s.t.n, to: a.to, reason: `Window open: fewest tickets today of ${on.length} scheduled` })) })
  for (const a of assigns) {
    const s = a.s
    if (rnd() < 0.12) { // not finished in the window: tried again the next working day
      let d = addDays(day, 1); while (wd(d) >= 5) d = addDays(d, 1)
      strikeTasks.push({ t: s.t, day: d, strike: s.strike }); insertKey(`${d}|${s.t.region}`, { t: s.t, day: d, strike: s.strike })
      continue
    }
    const at = open + between(0.1, 0.85) * (close - open)
    const reached = rnd() < 0.35
    ev(at, a.to, { type: 'strikeLog', n: s.t.n, key, reached })
    if (reached) {
      const doneAt = at + between(30, 150) * M
      const owner = on.some((p) => p.soeid === s.t.to) ? s.t.to : LEAD.soeid
      const [code, cause, sub, title, runbook, category] = s.t.code
      ev(doneAt, owner, { type: 'ticketTag', n: s.t.n, tag: 'Resolved', res: { code, cause, sub, title, runbook, isNew: false, category, symptom: s.t.short, impact: 'Single user', diagNote: '', fix: title, validated: true, validNote: 'User confirmed after callback', fcr: false, transfers: 0, escalatedTo: '', breachCode: '', closeNote: '' } })
    } else if (s.strike < 3) {
      let d = addDays(day, 1); while (wd(d) >= 5) d = addDays(d, 1)
      insertKey(`${d}|${s.t.region}`, { t: s.t, day: d, strike: s.strike + 1 })
    }
  }
}
function insertKey(key, task) {
  if (task.day > end) return
  if (!queueDays.has(key)) { queueDays.set(key, []); keys.push(key); keys.sort() }
  queueDays.get(key).push(task)
}

// ---------- Sign-ins and manual entries ----------
for (const day of days) {
  for (const p of working(day)) {
    const [h] = SHIFT_T[p.shift]
    ev(pht(day, h, 0) - between(2, 14) * M, p.soeid, { type: 'shiftStart', day, duty: p.duty, shift: p.shift, auto: true })
  }
  if (wd(day) === 2 && rnd() < 0.8) {
    const on = working(day).filter((p) => p.soeid !== LEAD.soeid)
    if (!on.length) continue
    const who = pick(on).soeid
    const id = uid('mi')
    const handled = pht(day, 10, Math.floor(between(0, 50)))
    ev(handled + 20 * M, who, { type: 'manualIncAdd', id, inc: `INC00${++incNo}`, handledAt: handled, actions: pick(['Reset password and confirmed login by phone', 'Unlocked account from walk-up request', 'Granted shared mailbox access on manager approval']), reason: pick(['Ticket was in another group\'s queue', 'Raised by phone, ticket created afterwards']), group: 'IAM Access Operations' })
    ev(pht(addDays(day, 1), 9, 30), LEAD.soeid, { type: 'manualIncDecide', id, decision: 'Verified', note: '' })
  }
}

// ---------- Write ----------
events.sort((a, b) => a.at - b.at)
if (!INTO) {
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(`${OUT}/ops.template.jsonl`, events.map((x, i) => JSON.stringify({ seq: i + 1, at: x.at, by: x.by, e: x.e })).join('\n') + '\n')
  fs.writeFileSync(`${OUT}/roster.json`, JSON.stringify(ROSTER, null, 2) + '\n')
  fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify({ anchorMonday, from: start, to: end, generated: new Date().toISOString(), events: events.length, tickets: tickets.filter((t) => t.load).length }, null, 2) + '\n')
  console.log(`Wrote ${events.length} events (${tickets.filter((t) => t.load).length} tickets, ${start} to ${end}) to ${OUT}/`)
  process.exit(0)
}

// --into: history up to yesterday, and this morning's sign-ins only (minus whoever is late).
const NOW = Date.now()
const today = dayOf(NOW)
const t0 = pht(today, 0)
const late = ROSTER.find((p) => LATE.test(p.name))
const keep = events.filter((x) => x.at <= NOW && (x.at < t0 || (x.e.type === 'shiftStart' && !(late && x.by === late.soeid))))
// Sign-ins today happen at shift start; if it's still earlier than that, sign them in now.
for (const x of keep) if (x.e.type === 'shiftStart' && x.e.day === today && x.at > NOW) x.at = NOW - 60e3
const todayIn = working(today).filter((p) => !(late && p.soeid === late.soeid) && !keep.some((x) => x.e.type === 'shiftStart' && x.e.day === today && x.by === p.soeid))
for (const p of todayIn) keep.push({ at: Math.min(NOW - 120e3, pht(today, SHIFT_T[p.shift][0]) - 5 * M), by: p.soeid, e: { type: 'shiftStart', day: today, duty: p.duty, shift: p.shift, auto: true } })
keep.sort((a, b) => a.at - b.at)
const ops = `${INTO}/ops.jsonl`
if (fs.existsSync(ops) && fs.statSync(ops).size) {
  const bk = `${INTO}/backup/before-test-data-${new Date().toISOString().replace(/[:.]/g, '-')}`
  fs.mkdirSync(bk, { recursive: true }); fs.copyFileSync(ops, `${bk}/ops.jsonl`)
  console.log(`Backed up the old log to ${bk}/ops.jsonl`)
}
fs.writeFileSync(ops, keep.map((x, i) => JSON.stringify({ seq: i + 1, at: x.at, by: x.by, e: x.e })).join('\n') + '\n')

// The two exports to load live. Same columns, order and date format as ServiceNow's.
const pool = working(today) // everyone working today, the late person included once switched on
const per = 4
const N = Math.max(per, pool.length * per)
const ts = (ms) => { const x = new Date(ms); const p2 = (n) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())} ${p2(x.getHours())}:${p2(x.getMinutes())}:${p2(x.getSeconds())}` }
const q = (v) => `"${String(v).replace(/"/g, '""')}"`
const HEAD = ['number', 'opened_at', 'priority', 'sys_updated_on', 'short_description', 'description', 'caller_id', 'caller_id.user_name', 'state', 'assignment_group', 'assigned_to', 'sys_created_by', 'location']
const FIRST = ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Faye', 'Gio', 'Hana', 'Ivan', 'Joy', 'Kai', 'Lia', 'Marco', 'Nina', 'Omar', 'Pia']
const LAST = ['Cruz', 'Lim', 'Tan', 'Reyes', 'Santos', 'Ong', 'Diaz', 'Ramos', 'Lopez', 'Chua']
const SITES = ['Manila | PH', 'Singapore | SG', 'New York | US', 'London | UK', 'Mumbai | IN', 'Tokyo | JP']
const rowCsv = (n, opened, updated, prio, short, desc, state) => { const f = pick(FIRST); const l = pick(LAST); return [n, ts(opened), prio, ts(updated), short, desc, `${f} ${l}`, `${f[0]}${l}`.toUpperCase() + Math.floor(rnd() * 90 + 10), state, weighted(GROUPS), '', 'svc-portal', pick(SITES)].map(q).join(',') }
const inc = []
for (let i = 0; i < N; i++) {
  const eers = i < 2 // EERS first, as P2: they go to the Proci Backup before the rest is shared, so it all evens out
  const c = weighted(CODES.map((x) => [x, x[6]]))
  const app = pick(APPS)
  const short = eers ? `EERS - entitlement review for ${app}` : pick(SHORTS[c[0]]).replace('{a}', app)
  const desc = eers ? `Quarterly entitlement review request #EERS for ${app}. Please validate access for the listed users.` : `User reports: ${short}. Please assist.`
  const opened = NOW - (eers ? between(14.5, 15) : rnd() < 0.3 ? between(10, 14) : between(0.2, 9)) * H // some overnight = backlog this morning
  inc.push({ opened, line: rowCsv(`INC00${++incNo}`, opened, opened + between(1, 8) * M, eers ? '2 - High' : weighted(PRIO.filter((p) => !p[0].startsWith('1'))), short, desc, 'New') })
}
const strike = Array.from({ length: 8 }, (_, i) => {
  const c = weighted(CODES.map((x) => [x, x[6]]))
  const opened = NOW - between(2, 5) * DAY
  const att = i % 3
  return rowCsv(`INC00${++incNo}`, opened, NOW - between(16, 26) * H, weighted(PRIO.filter((p) => !p[0].startsWith('1'))), `${pick(SHORTS[c[0]]).replace('{a}', pick(APPS))}${att ? ` - Contact attempt${att}` : ''}`, 'Waiting on the user to confirm the fix.', 'On Hold')
})
const dir = `${INTO}/demo-exports`
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(`${dir}/incident-export.csv`, [HEAD.map(q).join(','), ...inc.sort((a, b) => a.opened - b.opened).map((x) => x.line)].join('\r\n') + '\r\n')
fs.writeFileSync(`${dir}/3strike-export.csv`, [HEAD.map(q).join(','), ...strike].join('\r\n') + '\r\n')
console.log(`Wrote ${keep.length} events for ${ROSTER.length} people (${start} to yesterday + today's sign-ins) to ${ops}`)
console.log(`Today ${pool.length} people work${late ? `; ${late.name} is late (not signed in)` : ''}. Exports in ${dir}/: incident-export.csv (${N} tickets, 2 EERS = ${per} each), 3strike-export.csv (8 On Hold).`)
