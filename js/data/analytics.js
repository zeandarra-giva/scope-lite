// Ported from the React prototype: analytics.js
(function () {
  const { DAY, RES_GOAL_H, ROOT_CAUSES, avg, byId, fmtDate, fmtH } = S
// Deterministic analytics over resolved-ticket history. Shared by Reports
// (charts, Explorer) and Copilot (metric answers, insights, prompt templates).

const DIMENSIONS = {
  channel: { label: 'Channel', get: (h) => h.channel },
  businessApp: { label: 'Business app', get: (h) => h.businessApp },
  productGroup: { label: 'Product group', get: (h) => h.productGroup },
  assignmentGroup: { label: 'Assignment group', get: (h) => h.assignmentGroup },
  analyst: { label: 'Analyst', get: (h) => byId[h.analyst]?.name || '—' },
  cause: { label: 'Root cause', get: (h) => ROOT_CAUSES[h.code.split('-')[0]]?.label || 'Other' },
  code: { label: 'Resolution code', get: (h) => h.code },
  priority: { label: 'Priority', get: (h) => h.priority },
  week: { label: 'Week', get: (h) => fmtDate(weekOf(h.resolvedAt)), order: (h) => weekOf(h.resolvedAt) },
}
const MEASURES = {
  count: { label: 'Ticket volume', fn: (r) => r.length, fmt: (v) => Math.round(v), better: 'none' },
  res: { label: 'Avg RES MTTR', fn: (r) => avg(r.map((x) => x.resH)), fmt: fmtH, better: 'low' },
  eze: { label: 'Avg EZE MTTR', fn: (r) => avg(r.map((x) => x.ezeH)), fmt: fmtH, better: 'low' },
  lost: { label: 'Avg lost time', fn: (r) => avg(r.map((x) => x.lostH)), fmt: fmtH, better: 'low' },
  sla: { label: 'SLA attainment', fn: (r) => r.filter((x) => x.slaMet).length / Math.max(1, r.length), fmt: (v) => `${Math.round(v * 100)}%`, better: 'high' },
  fcr: { label: 'FCR rate', fn: (r) => r.filter((x) => x.fcr).length / Math.max(1, r.length), fmt: (v) => `${Math.round(v * 100)}%`, better: 'high' },
  transfers: { label: 'Transfer rate', fn: (r) => r.filter((x) => x.transfers > 0).length / Math.max(1, r.length), fmt: (v) => `${Math.round(v * 100)}%`, better: 'low' },
  goal: { label: `Resolved < ${RES_GOAL_H}h`, fn: (r) => r.filter((x) => x.resH < RES_GOAL_H).length / Math.max(1, r.length), fmt: (v) => `${Math.round(v * 100)}%`, better: 'high' },
}
function weekOf(ts) {
  const d = new Date(ts); const day = (d.getDay() + 6) % 7
  d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day); return d.getTime()
}
function aggregate(rows, dim, measure) {
  const groups = {}
  const order = {}
  rows.forEach((r) => {
    const k = DIMENSIONS[dim].get(r)
    ;(groups[k] = groups[k] || []).push(r)
    if (DIMENSIONS[dim].order) order[k] = DIMENSIONS[dim].order(r)
  })
  const out = Object.entries(groups).map(([label, rs]) => ({ label, value: MEASURES[measure].fn(rs), n: rs.length }))
  return DIMENSIONS[dim].order ? out.sort((a, b) => order[a.label] - order[b.label]) : out.sort((a, b) => b.value - a.value)
}
const inWindow = (rows, now, days, prio) => rows.filter((h) => h.resolvedAt >= now - days * DAY && (!prio || prio === 'All' || h.priority === prio))
const qaScore = (h) => (['documentation', 'contactLogged', 'correctCode', 'validated'].filter((k) => h.qa[k]).length + (h.slaMet ? 1 : 0)) * 20

// ---------- Periods (Compare & generate) ----------
// A period is a kind plus an id: window '30' or 'p30' (the 30 days before
// that), year '2026', quarter '2026-Q4', month '2026-10'. Ranges are
// [from, to) in ms; a period still running ends at now and is marked partial.
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PERIOD_KINDS = [{ id: 'window', label: 'Window' }, { id: 'year', label: 'Year' }, { id: 'quarter', label: 'Quarter' }, { id: 'month', label: 'Month' }]
const WINDOWS = [['7', 'Last 7 days'], ['p7', 'Prior 7 days'], ['30', 'Last 30 days'], ['p30', 'Prior 30 days'], ['90', 'Last 90 days'], ['p90', 'Prior 90 days'], ['365', 'Last 12 months'], ['p365', 'Prior 12 months'], ['all', 'All time']]
// first: the oldest record's timestamp, so the lists stop where the data does.
function periodOptions(kind, now, first) {
  if (kind === 'window') return WINDOWS.map(([id, label]) => ({ id, label }))
  const out = []
  const end = new Date(now), d = new Date(first)
  if (kind === 'year') for (let y = end.getFullYear(); y >= d.getFullYear(); y--) out.push({ id: String(y), label: String(y) })
  if (kind === 'quarter') {
    for (let y = end.getFullYear(), q = Math.floor(end.getMonth() / 3); y > d.getFullYear() || (y === d.getFullYear() && q >= Math.floor(d.getMonth() / 3)); q--) {
      if (q < 0) { q = 3; y-- }
      out.push({ id: `${y}-Q${q + 1}`, label: `Q${q + 1} ${y}` })
    }
  }
  if (kind === 'month') {
    for (let y = end.getFullYear(), m = end.getMonth(); y > d.getFullYear() || (y === d.getFullYear() && m >= d.getMonth()); m--) {
      if (m < 0) { m = 11; y-- }
      out.push({ id: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTH_NAMES[m]} ${y}` })
    }
  }
  return out
}
function periodRange(kind, id, now, first) {
  let from, to, label
  if (kind === 'window') {
    const days = id === 'all' ? null : Number(id.replace('p', ''))
    label = (WINDOWS.find((w) => w[0] === id) || [])[1] || id
    if (days == null) { from = first; to = now }
    else if (id[0] === 'p') { from = now - 2 * days * DAY; to = now - days * DAY }
    else { from = now - days * DAY; to = now }
    return { from, to, label, partial: null }
  }
  const [y, rest] = id.split('-')
  if (kind === 'year') { from = new Date(+y, 0, 1); to = new Date(+y + 1, 0, 1); label = y }
  if (kind === 'quarter') { const q = +rest.slice(1) - 1; from = new Date(+y, q * 3, 1); to = new Date(+y, q * 3 + 3, 1); label = `Q${q + 1} ${y}` }
  if (kind === 'month') { const m = +rest - 1; from = new Date(+y, m, 1); to = new Date(+y, m + 1, 1); label = `${MONTH_NAMES[m]} ${y}` }
  from = from.getTime(); to = to.getTime()
  // How much of a running period has passed, so volume comparisons can be read fairly.
  const partial = now < to && now > from ? (now - from) / (to - from) : null
  return { from, to: Math.min(to, now), label: partial ? `${label} (to date)` : label, partial }
}

// ---------- Template Search (Copilot prompt templates): keyword → deterministic query template ----------
const DIM_WORDS = [
  [/channel|phone|chat|email|portal/, 'channel'], [/\bapps?\b|application|system/, 'businessApp'], [/product/, 'productGroup'],
  [/group|team|queue/, 'assignmentGroup'], [/analyst|who|person|people|agent/, 'analyst'], [/root cause|cause|why/, 'cause'],
  [/code|fix|resolution/, 'code'], [/priority|severity/, 'priority'], [/trend|week|over time|weekly/, 'week'],
]
const MEASURE_WORDS = [
  [/lost|waiting|wait/, 'lost'], [/eze|end.to.end/, 'eze'], [/mttr|slow|fast|resolution time|time to resolve|duration/, 'res'],
  [/fcr|first contact/, 'fcr'], [/sla|breach|attainment/, 'sla'], [/transfer|bounce|reassign/, 'transfers'],
  [/goal|under 4|<\s*4/, 'goal'], [/volume|count|how many|most|number/, 'count'],
]
const TEMPLATES = {
  trend: { id: 'T-01', name: 'Trend over time', test: /trend|over time|weekly|by week/ },
  rank: { id: 'T-02', name: 'Top / bottom ranking', test: /top|worst|slowest|best|highest|lowest|most|least/ },
  breakdown: { id: 'T-03', name: 'Breakdown by dimension', test: /./ },
}
function parseQuery(text) {
  const s = text.toLowerCase()
  const tpl = Object.entries(TEMPLATES).find(([, t]) => t.test.test(s))[0]
  let measure = MEASURE_WORDS.find(([re]) => re.test(s))?.[1] || 'count'
  let dim = DIM_WORDS.find(([re, d]) => re.test(s) && !(d === 'code' && /resolution time/.test(s)))?.[1] || 'businessApp'
  if (tpl === 'trend') dim = 'week'
  const nDays = s.match(/last (\d+) ?(day|week|month)/)
  let days = 30
  if (nDays) days = Number(nDays[1]) * (nDays[2] === 'week' ? 7 : nDays[2] === 'month' ? 30 : 1)
  else if (/this week|past week|7 ?d/.test(s)) days = 7
  else if (/quarter|90/.test(s)) days = 90
  const prio = s.match(/\bp([1-4])\b/)?.[1]
  const topN = Number(s.match(/top (\d+)/)?.[1] || (tpl === 'rank' ? 5 : 0))
  const asc = /\b(best|fastest|lowest|least)\b/.test(s) && MEASURES[measure].better !== 'high'
  return { tpl, measure, dim, days: Math.min(90, days), prio: prio ? `P${prio}` : 'All', topN, asc }
}

  Object.assign(S, { DIMENSIONS, MEASURES, aggregate, inWindow, qaScore, MONTH_NAMES, PERIOD_KINDS, periodOptions, periodRange, TEMPLATES, parseQuery })
})()
