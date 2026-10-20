// Ported from the React prototype: data.js
(function () {
// Mock data for the prototype. Everything is generated relative to page load
// so ages, SLA timers and schedules always look current.

const HOUR = 3600e3
const DAY = 24 * HOUR
const NOW = Date.now()

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20261014)
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const between = (a, b) => a + rand() * (b - a)

// ---------- People ----------
const ANALYSTS = [
  { id: 'a1', name: 'Andrea Santos', soeid: 'AS40211', role: 'Manager', group: 'Service Desk L2', location: 'Onsite', shift: 'Early', status: 'online', skills: ['Escalations', 'Major incidents'] },
  { id: 'a2', name: 'Paolo Reyes', soeid: 'PR38817', role: 'Analyst', group: 'Service Desk L2', location: 'WFH', shift: 'Early', status: 'online', skills: ['Network', 'VPN'] },
  { id: 'a3', name: 'Bea Mendoza', soeid: 'BM51024', role: 'Analyst', group: 'Service Desk L2', location: 'Onsite', shift: 'Early', status: 'online', skills: ['Identity', 'Okta'] },
  { id: 'a4', name: 'Carlo Dizon', soeid: 'CD27390', role: 'Analyst', group: 'Apps Support', location: 'WFH', shift: 'Mid', status: 'online', skills: ['SAP', 'Payments'] },
  { id: 'a5', name: 'Joanna Lim', soeid: 'JL60092', role: 'Analyst', group: 'Apps Support', location: 'Onsite', shift: 'Mid', status: 'online', skills: ['Salesforce', 'Integrations'] },
  { id: 'a6', name: 'Miguel Tan', soeid: 'MT44718', role: 'Analyst', group: 'Infra Ops', location: 'WFH', shift: 'Early', status: 'online', skills: ['Windows', 'M365'] },
  { id: 'a7', name: 'Rhea Castillo', soeid: 'RC33509', role: 'Analyst', group: 'Infra Ops', location: 'Onsite', shift: 'Late', status: 'offline', skills: ['Linux', 'Storage'] },
  { id: 'a8', name: 'Nico Bautista', soeid: 'NB29961', role: 'Analyst', group: 'Service Desk L2', location: 'WFH', shift: 'Late', status: 'offline', skills: ['Hardware', 'Printers'] },
  { id: 'a9', name: 'Trisha Aquino', soeid: 'TA57702', role: 'Analyst', group: 'Apps Support', location: 'Onsite', shift: 'Early', status: 'leave', skills: ['Workday'] },
  { id: 'a10', name: 'Diego Ramos', soeid: 'DR41186', role: 'Analyst', group: 'Infra Ops', location: 'WFH', shift: 'Late', status: 'leave', skills: ['Citrix', 'VDI'] },
]
const byId = Object.fromEntries(ANALYSTS.map((a) => [a.id, a]))
const initials = (name) => name.split(' ').map((p) => p[0]).slice(0, 2).join('')

const ASSIGNMENT_GROUPS = ['Service Desk L2', 'Apps Support', 'Infra Ops']
const PRODUCT_GROUPS = ['End User Computing', 'Network & Access', 'Business Applications', 'Collaboration', 'Infrastructure']
const CHANNELS = ['Phone', 'Chat', 'Email', 'Self-service portal', 'Monitoring alert']
const BUSINESS_APPS = ['Payments Hub', 'Salesforce CRM', 'SAP Finance', 'Workday', 'Outlook / M365', 'GlobalConnect VPN', 'Citrix Workspace', 'Okta SSO']

// ---------- SLA ----------
const PRIORITIES = {
  P1: { label: 'P1 · Critical', slaH: 4, weight: 3 },
  P2: { label: 'P2 · High', slaH: 8, weight: 2 },
  P3: { label: 'P3 · Moderate', slaH: 24, weight: 1 },
  P4: { label: 'P4 · Low', slaH: 72, weight: 1 },
}
const STATES = ['New', 'In Progress', 'Awaiting Customer', 'On Hold', 'Resolved']
const RES_GOAL_H = 4

function slaInfo(t, now = NOW) {
  const total = PRIORITIES[t.priority].slaH * HOUR
  const remaining = t.openedAt + total - now
  const pct = Math.max(0, Math.min(1, remaining / total))
  let status = 'On track'
  if (remaining <= 0) status = 'Breached'
  else if (pct < 0.25) status = 'At risk'
  return { remaining, pct, status, due: t.openedAt + total }
}

// ---------- Resolution codes ----------
// Code format: <CATEGORY>-<SUBCATEGORY>-<seq>. Minted from the root cause the
// analyst picks in the resolution journey.
const ROOT_CAUSES = {
  NET: { label: 'Network', subs: { DNS: 'DNS resolution', VPN: 'VPN tunnel / client', WIFI: 'Wireless access' } },
  IAM: { label: 'Identity & access', subs: { LOCK: 'Account lockout', MFA: 'MFA enrolment', ROLE: 'Missing role / entitlement' } },
  APP: { label: 'Application', subs: { CFG: 'Misconfiguration', BUG: 'Known defect', INT: 'Integration failure' } },
  EUC: { label: 'End-user device', subs: { OS: 'OS / patch', HW: 'Hardware fault', PRF: 'Profile corruption' } },
  INF: { label: 'Infrastructure', subs: { CAP: 'Capacity', SVC: 'Service down / restart', CRT: 'Certificate expiry' } },
  USR: { label: 'User / how-to', subs: { HOW: 'How-to guidance', DUP: 'Duplicate / no fault' } },
}

const RESOLUTION_CODES = [
  { code: 'NET-VPN-01', cause: 'NET', sub: 'VPN', title: 'Reset VPN client profile and reissue certificate', runbook: 'RB-112 VPN client recovery', automatable: true, fix: 'Push VPN profile reset via Intune' },
  { code: 'NET-DNS-01', cause: 'NET', sub: 'DNS', title: 'Flush resolver cache, correct stale DNS record', runbook: 'RB-108 DNS stale record', automatable: true, fix: 'Run DNS record reconcile job' },
  { code: 'IAM-LOCK-01', cause: 'IAM', sub: 'LOCK', title: 'Unlock AD account, clear cached credentials', runbook: 'RB-201 Account lockout', automatable: true, fix: 'Unlock account + revoke stale sessions' },
  { code: 'IAM-MFA-01', cause: 'IAM', sub: 'MFA', title: 'Re-enrol MFA factor after device change', runbook: 'RB-204 MFA re-enrolment', automatable: false },
  { code: 'IAM-ROLE-01', cause: 'IAM', sub: 'ROLE', title: 'Grant missing role through access request', runbook: 'RB-210 Entitlement gaps', automatable: false },
  { code: 'APP-CFG-01', cause: 'APP', sub: 'CFG', title: 'Correct application config and restart app pool', runbook: 'RB-305 App config drift', automatable: true, fix: 'Restore last known-good config' },
  { code: 'APP-BUG-01', cause: 'APP', sub: 'BUG', title: 'Apply vendor workaround for known defect', runbook: 'RB-311 Known error database', automatable: false },
  { code: 'APP-INT-01', cause: 'APP', sub: 'INT', title: 'Replay failed integration messages', runbook: 'RB-320 Integration replay', automatable: true, fix: 'Replay dead-letter queue for the affected interface' },
  { code: 'EUC-OS-01', cause: 'EUC', sub: 'OS', title: 'Roll back faulty patch and reboot', runbook: 'RB-402 Patch rollback', automatable: true, fix: 'Trigger patch rollback via SCCM' },
  { code: 'EUC-PRF-01', cause: 'EUC', sub: 'PRF', title: 'Rebuild corrupted user profile', runbook: 'RB-410 Profile rebuild', automatable: false },
  { code: 'EUC-HW-01', cause: 'EUC', sub: 'HW', title: 'Replace faulty hardware via depot swap', runbook: 'RB-415 Hardware swap', automatable: false },
  { code: 'INF-SVC-01', cause: 'INF', sub: 'SVC', title: 'Restart failed service and confirm health checks', runbook: 'RB-501 Service restart', automatable: true, fix: 'Restart service with health-check gate' },
  { code: 'INF-CRT-01', cause: 'INF', sub: 'CRT', title: 'Renew and bind expired certificate', runbook: 'RB-520 Certificate renewal', automatable: false },
  { code: 'USR-HOW-01', cause: 'USR', sub: 'HOW', title: 'Walk user through steps; share KB article', runbook: 'KB-0091 How-to library', automatable: false },
]
const codeInfo = (code) => RESOLUTION_CODES.find((c) => c.code === code)

const ISSUE_TEMPLATES = [
  { d: 'VPN disconnects every few minutes for remote users in {app}', cause: 'NET-VPN-01', pg: 'Network & Access', app: 'GlobalConnect VPN' },
  { d: 'Users cannot resolve internal hostname for {app}', cause: 'NET-DNS-01', pg: 'Network & Access', app: 'Payments Hub' },
  { d: 'Account locked after password change, cannot sign in to {app}', cause: 'IAM-LOCK-01', pg: 'Network & Access', app: 'Okta SSO' },
  { d: 'MFA prompt loops after phone replacement on {app}', cause: 'IAM-MFA-01', pg: 'Network & Access', app: 'Okta SSO' },
  { d: 'Missing approver role in {app} blocks invoice release', cause: 'IAM-ROLE-01', pg: 'Business Applications', app: 'SAP Finance' },
  { d: '{app} returns 500 on opportunity save', cause: 'APP-CFG-01', pg: 'Business Applications', app: 'Salesforce CRM' },
  { d: 'Payment batch stuck in pending in {app}', cause: 'APP-INT-01', pg: 'Business Applications', app: 'Payments Hub' },
  { d: '{app} timesheet page freezes on submit', cause: 'APP-BUG-01', pg: 'Business Applications', app: 'Workday' },
  { d: 'Outlook crashes on launch after Patch Tuesday ({app})', cause: 'EUC-OS-01', pg: 'End User Computing', app: 'Outlook / M365' },
  { d: 'Desktop profile resets on every login to {app}', cause: 'EUC-PRF-01', pg: 'End User Computing', app: 'Citrix Workspace' },
  { d: 'Laptop docking station not detecting monitors', cause: 'EUC-HW-01', pg: 'End User Computing', app: 'Outlook / M365' },
  { d: '{app} sessions failing to launch, broker service down', cause: 'INF-SVC-01', pg: 'Infrastructure', app: 'Citrix Workspace' },
  { d: 'Certificate warning on {app} login page', cause: 'INF-CRT-01', pg: 'Infrastructure', app: 'Payments Hub' },
  { d: 'How to share calendar with delegate in {app}', cause: 'USR-HOW-01', pg: 'Collaboration', app: 'Outlook / M365' },
  { d: 'Teams meetings drop audio for whole floor', cause: 'NET-DNS-01', pg: 'Collaboration', app: 'Outlook / M365' },
]

let incSeq = 104211
const nextInc = () => `INC0${incSeq++}`

// ---------- Live queue ----------
const RUNBOOK_STEPS = {
  default: ['Confirm impact and affected users', 'Check monitoring and recent changes', 'Apply runbook fix', 'Validate with customer', 'Document and close'],
}

function makeQueueTicket(opts = {}) {
  const tpl = opts.tpl || pick(ISSUE_TEMPLATES)
  const priority = opts.priority || pick(['P1', 'P2', 'P2', 'P3', 'P3', 'P3', 'P4'])
  const openedAt = opts.openedAt ?? NOW - between(0.2, PRIORITIES[priority].slaH * 1.15) * HOUR
  const queuedAt = openedAt + between(2, 25) * 60e3
  return {
    id: nextInc(),
    desc: tpl.d.replace('{app}', tpl.app),
    priority,
    state: opts.state || pick(['New', 'In Progress', 'In Progress', 'Awaiting Customer', 'On Hold']),
    openedAt,
    queuedAt: Math.min(queuedAt, NOW),
    assignedAt: null,
    assignedTo: null,
    assignReason: '',
    productGroup: tpl.pg,
    businessApp: tpl.app,
    channel: pick(CHANNELS),
    caller: pick(['R. Navarro', 'J. Uy', 'K. Soriano', 'M. Fernandez', 'L. Ocampo', 'T. Villanueva', 'S. Garcia']),
    hintCode: tpl.cause,
    steps: RUNBOOK_STEPS.default.map((s, i) => ({ label: s, done: i === 0 && rand() > 0.4 })),
    contacts: rand() > 0.4 ? [{ at: openedAt + 20 * 60e3, channel: 'Phone', by: 'Service Desk', note: 'Initial triage call, captured impact and screenshots.' }] : [],
  }
}

// ---------- Fair assignment ----------
// Rule: only online analysts are eligible. Pick the lowest weighted active load
// (P1 = 3 pts, P2 = 2, P3/P4 = 1). Ties go to the analyst with fewer tickets
// assigned today, then to whoever has waited longest since their last assignment.
const MAX_LOAD_POINTS = 12

function loadOf(analystId, tickets) {
  return tickets
    .filter((t) => t.assignedTo === analystId && t.state !== 'Resolved')
    .reduce((s, t) => s + PRIORITIES[t.priority].weight, 0)
}

function pickAssignee(tickets, analysts, stats) {
  const online = analysts.filter((a) => a.status === 'online')
  if (!online.length) return null
  const ranked = online
    .map((a) => ({
      a,
      load: loadOf(a.id, tickets),
      today: stats[a.id]?.today || 0,
      last: stats[a.id]?.lastAt || 0,
    }))
    .filter((r) => r.load < MAX_LOAD_POINTS)
    .sort((x, y) => x.load - y.load || x.today - y.today || x.last - y.last)
  if (!ranked.length) return null
  const top = ranked[0]
  const runner = ranked[1]
  let reason = `Lowest load (${top.load} pts) of ${online.length} online`
  if (runner && runner.load === top.load) {
    reason = top.today < runner.today ? `Tied on load; fewest assigned today (${top.today})` : 'Tied on load and count; longest since last assignment'
  }
  return { id: top.a.id, reason }
}

function seedQueue() {
  const tickets = []
  const stats = {}
  ANALYSTS.forEach((a) => (stats[a.id] = { today: Math.floor(between(2, 6)), lastAt: NOW - between(5, 90) * 60e3 }))
  const fixed = [
    { priority: 'P1', state: 'In Progress', tpl: ISSUE_TEMPLATES[6], openedAt: NOW - 3.3 * HOUR },
    { priority: 'P1', state: 'New', tpl: ISSUE_TEMPLATES[11], openedAt: NOW - 1.1 * HOUR },
    { priority: 'P2', state: 'In Progress', tpl: ISSUE_TEMPLATES[0], openedAt: NOW - 8.6 * HOUR },
  ]
  const all = [...fixed.map((f) => makeQueueTicket(f)), ...Array.from({ length: 19 }, () => makeQueueTicket())]
  all.sort((a, b) => a.queuedAt - b.queuedAt)
  for (const t of all) {
    const pickd = pickAssignee(tickets, ANALYSTS, stats)
    if (pickd) {
      t.assignedTo = pickd.id
      t.assignReason = pickd.reason
      t.assignedAt = t.queuedAt + between(1, 4) * 60e3
      stats[pickd.id].today += 1
      stats[pickd.id].lastAt = t.assignedAt
    }
    tickets.push(t)
  }
  return { tickets, stats }
}

// ---------- Resolved history (Ticket Explorer) ----------
// ---------- Resolution details (Ticket Explorer) ----------
// Why a ticket missed its SLA. Recorded when a breached ticket is resolved.
const BREACH_REASONS = {
  'BR-01': 'Awaiting customer response',
  'BR-02': 'Misrouted / transferred between groups',
  'BR-03': 'Queue backlog / capacity',
  'BR-04': 'Third-party or vendor dependency',
  'BR-05': 'Complex diagnosis',
  'BR-06': 'Change window or approval wait',
}
// Where a transferred ticket was escalated, by root-cause family.
const ESCALATION_TARGETS = {
  NET: 'Network Engineering L3',
  IAM: 'Identity & Access Management',
  APP: 'Application Support L3',
  EUC: 'Desktop Engineering',
  INF: 'Infrastructure Operations',
  USR: 'Service Desk L2',
}
const problemCategory = (code) => {
  const [cause, sub] = code.split('-')
  const rc = ROOT_CAUSES[cause]
  return rc ? `${rc.label} › ${rc.subs[sub] || sub}` : 'Other'
}
// Low-hanging fruit: low-priority tickets with a known, simple or self-service
// fix that the Solution Center could have closed at first contact.
const DEFLECT_BY_CODE = {
  USR: 'How-to guidance: answer from a knowledge article',
  'IAM-LOCK': 'Account unlock: self-service reset',
  'IAM-MFA': 'MFA re-enrolment: guided self-service',
  'NET-VPN': 'VPN profile reset: scripted fix',
  'NET-DNS': 'DNS cache flush: scripted fix',
  'EUC-PRF': 'Profile rebuild: runbook at first contact',
}
function deflection(h) {
  if (!['P3', 'P4'].includes(h.priority) || h.resH > 3) return null
  const [cause, sub] = h.code.split('-')
  return DEFLECT_BY_CODE[`${cause}-${sub}`] || DEFLECT_BY_CODE[cause] || null
}
// Fill in the resolution details for a resolved-ticket row (seeded or live).
function resolutionDetails(h, i = 0) {
  const cause = h.code.split('-')[0]
  const slaH = PRIORITIES[h.priority].slaH
  const overH = Math.max(0, h.ezeH - slaH)
  const diag = h.journey.find((j) => j.stage === 'Diagnosis')
  const fix = h.journey.find((j) => j.stage === 'Fix applied')
  const breachCode = h.slaMet ? null : h.breachCode || (h.transfers > 0 ? 'BR-02' : h.lostH > h.resH ? 'BR-03' : ['BR-01', 'BR-04', 'BR-05', 'BR-06'][i % 4])
  return {
    category: problemCategory(h.code),
    diagNote: h.diagNote || diag?.note || '',
    fixNote: h.fixNote || fix?.note || '',
    breachCode,
    overH: h.slaMet ? 0 : overH,
    // An analyst can confirm or override the rule when resolving.
    deflect: h.deflectFlag === false ? null : h.deflectFlag === true ? deflection(h) || 'Flagged by the resolving analyst' : deflection(h),
    escalatedTo: h.transfers > 0 ? h.escalatedTo || ESCALATION_TARGETS[cause] || 'Service Desk L2' : null,
  }
}

// rnd, from/to (days ago), id and slow (a resH multiplier by openedAt) let
// seedArchive reuse the same rules without touching the main random sequence.
function historyRows(n, { rnd = rand, from = 0.5, to = 90, id: idOf = (i) => `INC00${(98000 + i * 7) % 100000}`, slow = () => 1 } = {}) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
  const between = (a, b) => a + rnd() * (b - a)
  const rows = []
  for (let i = 0; i < n; i++) {
    const tpl = pick(ISSUE_TEMPLATES)
    const priority = pick(['P1', 'P2', 'P2', 'P3', 'P3', 'P3', 'P4'])
    const openedAt = NOW - between(from, to) * DAY
    const queueWait = between(0.05, 1.6) * HOUR
    const resH = Math.max(0.3, (priority === 'P1' ? between(0.8, 4.5) : between(0.6, 7.5)) * (rnd() > 0.85 ? 2 : 1) * slow(openedAt))
    const lost = queueWait + (rnd() > 0.6 ? between(0.2, 6) * HOUR : between(0, 0.4) * HOUR)
    const eze = resH * HOUR + lost
    const analyst = pick(ANALYSTS.filter((a) => a.role === 'Analyst'))
    const transfers = rnd() > 0.72 ? (rnd() > 0.7 ? 2 : 1) : 0
    const fcr = transfers === 0 && tpl.cause !== 'EUC-HW-01' && rnd() > 0.35
    const code = rnd() > 0.9 ? pick(RESOLUTION_CODES).code : tpl.cause
    const slaMet = eze <= PRIORITIES[priority].slaH * HOUR
    const resolvedAt = openedAt + eze
    const id = idOf(i)
    rows.push({
      id,
      desc: tpl.d.replace('{app}', tpl.app),
      priority,
      productGroup: tpl.pg,
      channel: pick(CHANNELS),
      businessApp: tpl.app,
      assignmentGroup: analyst.group,
      analyst: analyst.id,
      openedAt,
      resolvedAt,
      ezeH: eze / HOUR,
      resH,
      lostH: lost / HOUR,
      fcr,
      transfers,
      slaMet,
      code,
      qa: {
        documentation: rnd() > 0.2,
        contactLogged: rnd() > 0.15,
        correctCode: code === tpl.cause,
        validated: rnd() > 0.12,
      },
      journey: buildJourney(openedAt, queueWait, resH, lost, code, transfers, analyst.name),
    })
  }
  return rows.map((h, i) => ({ ...h, ...resolutionDetails(h, i) })).sort((a, b) => b.resolvedAt - a.resolvedAt)
}
const seedHistory = (n = 220) => historyRows(n)

// Older resolved tickets, from 90 days ago back to January two years ago, so
// Reports → Compare & generate can compare years, quarters and months. Kept
// apart from history so the rest of Scope still works on the last 90 days.
// Its own seed keeps every other seeded number unchanged. Older tickets ran a
// little slower, so year-over-year comparisons show a trend.
function seedArchive() {
  const start = new Date(NOW); start.setFullYear(start.getFullYear() - 2, 0, 1); start.setHours(0, 0, 0, 0)
  const to = (NOW - start.getTime()) / DAY
  const n = Math.round((to - 90) * 1.3)
  return historyRows(n, { rnd: mulberry32(20240101), from: 90, to, id: (i) => `INC0${String(40000 + i * 3).padStart(6, '0')}`, slow: (at) => 1 + ((NOW - at) / DAY / 365) * 0.18 })
}

const DIAG_DETAIL = {
  NET: 'Reproduced from the user session; client logs showed repeated tunnel or lookup failures.',
  IAM: 'Directory audit log showed the account state; entitlements checked against the role catalogue.',
  APP: 'Matched the error to application logs and the known-error database.',
  EUC: 'Remote session on the device; event viewer and health check confirmed the fault.',
  INF: 'Monitoring dashboards showed the affected service; checked recent changes and capacity.',
  USR: 'Walked through the steps with the user; no system fault found.',
}

function buildJourney(openedAt, queueWait, resH, lost, code, transfers, who) {
  const info = codeInfo(code)
  const t0 = openedAt
  const steps = [
    { stage: 'Detection', at: t0, note: 'Ticket opened in ServiceNow and triaged by Service Desk L1.' },
    { stage: 'Queued', at: t0 + queueWait, note: `Auto-assigned to ${who} by the fair-share rule.` },
  ]
  let t = t0 + queueWait
  if (transfers) {
    t += 0.5 * HOUR
    steps.push({ stage: 'Transfer', at: t, note: `Transferred ${transfers}× before reaching the right resolver group.` })
  }
  t += resH * 0.4 * HOUR
  steps.push({ stage: 'Diagnosis', at: t, note: `Root cause identified: ${ROOT_CAUSES[info.cause].subs[info.sub]}. ${DIAG_DETAIL[info.cause] || ''}`.trim() })
  t += resH * 0.45 * HOUR
  steps.push({ stage: 'Fix applied', at: t, note: `${info.title} (${info.runbook}).` })
  t += resH * 0.15 * HOUR
  steps.push({ stage: 'Validated', at: t, note: 'Customer confirmed service restored.' })
  return steps
}

// ---------- Handover log ----------
function seedHandovers() {
  const shifts = []
  for (let d = 1; d <= 9; d++) {
    const at = NOW - d * DAY + (d % 2 ? -2 : 6) * HOUR
    shifts.push({
      id: `HO-${String(240 - d).padStart(4, '0')}`,
      at,
      shift: d % 2 ? 'Early → Late' : 'Late → Early',
      by: d % 2 ? 'Andrea Santos' : 'Rhea Castillo',
      to: d % 2 ? 'Rhea Castillo' : 'Andrea Santos',
      resolved: Math.floor(between(9, 24)),
      openCritical: Math.floor(between(0, 3)),
      notes: pick([
        'Payments Hub batch backlog cleared after DLQ replay. Monitor overnight run.',
        'VPN cert rollout caused 6 lockouts; runbook RB-112 applied. Two users still pending callback.',
        'Citrix broker restarted at 13:40. Vendor case open for root cause.',
        'Quiet shift. Patch rollback completed for 14 devices.',
        'SAP Finance approver role gap affecting month-end; access request raised.',
      ]),
      acknowledged: d > 1,
    })
  }
  return shifts
}

// ---------- Schedule ----------
// Codes: E early 06–15, M mid 10–19, L late 14–23, W weekend duty, PL personal
// leave, SL sick leave, H holiday, OFF rest day.
const SHIFT_CODES = {
  E: { label: 'Early', time: '06:00–15:00', kind: 'shift' },
  M: { label: 'Mid', time: '10:00–19:00', kind: 'shift' },
  L: { label: 'Late', time: '14:00–23:00', kind: 'shift' },
  W: { label: 'Weekend duty', time: '08:00–17:00', kind: 'shift' },
  PL: { label: 'Personal leave', time: '', kind: 'leave' },
  SL: { label: 'Sick leave', time: '', kind: 'leave' },
  H: { label: 'Holiday', time: '', kind: 'holiday' },
  OFF: { label: 'Rest day', time: '', kind: 'off' },
}

function weekStart(ts = NOW) {
  const d = new Date(ts)
  const day = (d.getDay() + 6) % 7
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - day)
  return d.getTime()
}

function seedSchedule() {
  const start = weekStart()
  const days = Array.from({ length: 14 }, (_, i) => start + i * DAY)
  const sched = {}
  ANALYSTS.forEach((a, ai) => {
    sched[a.id] = days.map((d, di) => {
      const dow = di % 7
      const base = a.shift === 'Early' ? 'E' : a.shift === 'Late' ? 'L' : 'M'
      if (dow >= 5) return (ai + di) % 5 === 0 ? 'W' : 'OFF'
      if (a.id === 'a9' && di < 5) return 'PL'
      if (a.id === 'a10' && (di === 2 || di === 3)) return 'SL'
      if (a.id === 'a5' && di === 8) return 'PL'
      if (a.id === 'a2' && di === 9) return 'PL'
      return base
    })
  })
  // A public holiday next week, nobody on shift except a skeleton crew.
  ANALYSTS.forEach((a, ai) => {
    if (ai > 2) sched[a.id][11] = 'H'
  })
  return { days, sched }
}

// ---------- Calendar ----------
// The 14 seeded days live in schedule.sched. Any other date is generated from
// the same rota pattern, plus edits a manager made in the calendar.
const mod = (n, m) => ((n % m) + m) % m
const PH_HOLIDAYS = ['2026-11-02', '2026-11-30', '2026-12-08', '2026-12-24', '2026-12-25', '2026-12-30', '2026-12-31', '2027-01-01']
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime() }
const addDays = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return startOfDay(d.getTime()) }
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const dayIndex = (schedule, ts) => Math.round((startOfDay(ts) - schedule.days[0]) / DAY)

function codeAt(schedule, analysts, aid, ts) {
  const idx = dayIndex(schedule, ts)
  if (idx >= 0 && idx < schedule.days.length) return schedule.sched[aid]?.[idx] || 'OFF'
  const edit = schedule.edits?.[aid]?.[dayKey(ts)]
  if (edit) return edit
  const ai = analysts.findIndex((a) => a.id === aid)
  const a = analysts[ai]
  if (!a) return 'OFF'
  const n = analysts.length
  const dow = mod(idx, 7)
  const wk = Math.floor(idx / 7)
  if (dow >= 5) return mod(ai + idx, 5) === 0 ? 'W' : 'OFF'
  if (ai > 2 && PH_HOLIDAYS.includes(dayKey(ts))) return 'H'
  // Planned leave: someone takes Mon–Wed off every other week, plus an occasional sick day.
  if (mod(wk, 2) === 0 && mod(wk * 3 + 5, n) === ai && dow < 3) return 'PL'
  if (mod(wk * 7 + 2, n) === ai && dow === mod(wk, 5)) return 'SL'
  return a.shift === 'Early' ? 'E' : a.shift === 'Late' ? 'L' : 'M'
}

function locationOn(analyst, dayIdx) {
  // Hybrid pattern: onsite Tue/Thu for WFH-based staff, WFH Fri for onsite staff.
  const dow = dayIdx % 7
  if (analyst.location === 'WFH') return dow === 1 || dow === 3 ? 'Onsite' : 'WFH'
  return dow === 4 ? 'WFH' : 'Onsite'
}

// ---------- Password vault ----------
function seedVault() {
  const mk = (app, user, ageDays, expiresInDays, reminder = 7, strength = 'Strong') => ({
    id: Math.random().toString(36).slice(2, 9),
    app,
    user,
    secret: 'demo-' + Math.random().toString(36).slice(2, 12),
    changedAt: NOW - ageDays * DAY,
    expiresAt: expiresInDays == null ? null : NOW + expiresInDays * DAY,
    reminderDays: reminder,
    strength,
  })
  return [
    mk('ServiceNow', 'asantos', 74, 16, 14),
    mk('Okta Admin Console', 'asantos.adm', 85, 5, 7),
    mk('SAP GUI (FIN-PRD)', 'ASANTOS01', 92, -2, 7, 'Fair'),
    mk('Citrix Director', 'asantos', 30, 60, 7),
    mk('AWS Console (read-only)', 'andrea.santos', 12, 78, 14),
    mk('Vendor portal · Palo Alto', 'asantos@corp', 140, null, 7, 'Weak'),
  ]
}

const TEAM_VAULT_SUMMARY = [
  { id: 'a2', total: 7, expiring: 1, expired: 0, weak: 0 },
  { id: 'a3', total: 5, expiring: 0, expired: 1, weak: 1 },
  { id: 'a4', total: 9, expiring: 2, expired: 0, weak: 0 },
  { id: 'a5', total: 6, expiring: 0, expired: 0, weak: 0 },
  { id: 'a6', total: 8, expiring: 1, expired: 2, weak: 1 },
  { id: 'a7', total: 4, expiring: 0, expired: 0, weak: 0 },
  { id: 'a8', total: 6, expiring: 3, expired: 0, weak: 2 },
]

// ---------- Personal activity (Settings heatmap) ----------
function seedActivity(analyst) {
  const r = mulberry32(analyst.soeid.length * 991 + analyst.name.charCodeAt(0))
  const end = new Date(NOW); end.setHours(0, 0, 0, 0)
  const days = []
  for (let i = 364; i >= 0; i--) {
    const ts = end.getTime() - i * DAY
    const dow = new Date(ts).getDay()
    let kind
    if (dow === 0 || dow === 6) kind = r() > 0.88 ? 'weekend' : 'none'
    else {
      const x = r()
      if (x < 0.035) kind = 'holiday'
      else if (x < 0.075) kind = 'leave'
      else if (x < 0.095) kind = 'sick'
      else if (x < 0.115) kind = 'late'
      else kind = r() > 0.45 ? 'onsite' : 'wfh'
    }
    // Shift worked that day: the person's default, swapped now and then
    // (Early <-> Late) to cover the rota. Late-shift cells are one-off late covers.
    const base = analyst.shift === 'Late' ? 'L' : analyst.shift === 'Mid' ? 'M' : 'E'
    const swap = (i * 7 + 3) % 11 === 0
    const shift = kind === 'late' ? 'L' : kind === 'weekend' ? 'W' : ['onsite', 'wfh'].includes(kind) ? (swap ? (base === 'L' ? 'E' : 'L') : base) : null
    const loc = kind === 'wfh' ? 'WFH' : kind === 'onsite' || kind === 'weekend' ? 'Onsite' : kind === 'late' ? (i % 2 ? 'Onsite' : 'WFH') : null
    days.push({ ts, kind, shift, loc })
  }
  return days
}

const LEAVE_REQUESTS = [
  { id: 'LV-2291', type: 'Personal leave', from: NOW + 19 * DAY, to: NOW + 21 * DAY, days: 3, status: 'Pending', approver: 'Service Ops Manager' },
  { id: 'LV-2240', type: 'Personal leave', from: NOW - 33 * DAY, to: NOW - 31 * DAY, days: 3, status: 'Approved', approver: 'Service Ops Manager' },
  { id: 'LV-2198', type: 'Sick leave', from: NOW - 58 * DAY, to: NOW - 58 * DAY, days: 1, status: 'Approved', approver: 'Auto-approved' },
  { id: 'LV-2150', type: 'Personal leave', from: NOW - 80 * DAY, to: NOW - 76 * DAY, days: 5, status: 'Rejected', approver: 'Service Ops Manager', note: 'Overlaps quarter-end freeze' },
]

// ---------- Formatting ----------
function fmtDur(ms) {
  const neg = ms < 0
  ms = Math.abs(ms)
  const m = Math.round(ms / 60e3)
  let s
  if (m < 60) s = `${m}m`
  else if (m < 60 * 48) s = `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
  else s = `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
  return neg ? `-${s}` : s
}
const fmtH = (h) => (h == null || isNaN(h) ? '—' : `${h.toFixed(1)}h`)
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const fmtDate = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
const fmtDateTime = (ts) => `${fmtDate(ts)}, ${fmtTime(ts)}`
const fmtDay = (ts) => new Date(ts).toLocaleDateString([], { weekday: 'short', day: 'numeric' })
const pct = (x) => `${Math.round(x * 100)}%`
const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : NaN)

// Keyword overlap similarity for the rules-based Resolution Assist.
const STOP = new Set(['the', 'to', 'in', 'on', 'for', 'a', 'of', 'and', 'after', 'with', 'every', 'cannot', 'is'])
const tokens = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
function similarity(a, b) {
  const A = new Set(tokens(a)); const B = new Set(tokens(b))
  let inter = 0
  A.forEach((w) => B.has(w) && inter++)
  return inter / Math.max(1, Math.min(A.size, B.size))
}

// Resolution Assist: keyword overlap against resolved history picks similar
// incidents; the resolution codes they used vote for the likely fix.
function computeAssist(history, codes, desc, hintCode, excludeId) {
  const sims = history
    .filter((h) => h.id !== excludeId)
    .map((h) => ({ h, s: similarity(desc, h.desc) }))
    .filter((x) => x.s > 0.25)
    .sort((a, b) => b.s - a.s || b.h.resolvedAt - a.h.resolvedAt)
  const votes = {}
  sims.slice(0, 25).forEach(({ h, s }) => (votes[h.code] = (votes[h.code] || 0) + s))
  if (hintCode && !Object.keys(votes).length) votes[hintCode] = 1
  const total = Object.values(votes).reduce((a, b) => a + b, 0) || 1
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]).map(([code, v]) => ({ code, conf: v / total, info: codes.find((c) => c.code === code) })).filter((r) => r.info)
  const top = ranked[0]
  const sameCode = top ? sims.filter((x) => x.h.code === top.code).map((x) => x.h) : []
  return {
    similar: sims.slice(0, 5).map((x) => ({ ...x.h, score: x.s })),
    ranked: ranked.slice(0, 3),
    top,
    typicalRes: sameCode.length ? sameCode.reduce((s, h) => s + h.resH, 0) / sameCode.length : null,
    fcrRate: sameCode.length ? sameCode.filter((h) => h.fcr).length / sameCode.length : null,
    sample: sims.length,
  }
}

  Object.assign(S, { HOUR, DAY, NOW, ANALYSTS, byId, initials, ASSIGNMENT_GROUPS, PRODUCT_GROUPS, CHANNELS, BUSINESS_APPS, PRIORITIES, STATES, RES_GOAL_H, slaInfo, ROOT_CAUSES, RESOLUTION_CODES, codeInfo, RUNBOOK_STEPS, makeQueueTicket, MAX_LOAD_POINTS, loadOf, pickAssignee, seedQueue, BREACH_REASONS, ESCALATION_TARGETS, problemCategory, deflection, resolutionDetails, seedHistory, seedArchive, seedHandovers, SHIFT_CODES, weekStart, seedSchedule, startOfDay, addDays, dayKey, dayIndex, codeAt, locationOn, seedVault, TEAM_VAULT_SUMMARY, seedActivity, LEAVE_REQUESTS, fmtDur, fmtH, fmtTime, fmtDate, fmtDateTime, fmtDay, pct, avg, tokens, similarity, computeAssist })
})()
