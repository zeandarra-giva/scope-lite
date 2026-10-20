// Ported from the React prototype: copilot.js
(function () {
  const { MEASURES, aggregate, inWindow, parseQuery, DIMENSIONS, ASSIGNMENT_GROUPS, BREACH_REASONS, DAY, HOUR, PRIORITIES, ROOT_CAUSES, byId, computeAssist, fmtDur, fmtH, fmtTime, loadOf, pct, slaInfo, startOfDay, appNamed, appRow, chunksOf, findConflicts, findGaps, onCallFor, pageForCode, queryData, rowObj, searchKb } = S
// Copilot: an assistant for resolving tickets and reading the operation.
// It answers only from what Scope can look up: published knowledge base pages,
// live data tables, the queue and ticket history. Every answer lists the
// tool calls it made and the sources it used. It proposes, never acts:
// fixes go to a manager for approval and drafts are copied by a person.
//
// Prototype: the answer is composed in the browser by the rules below, in
// the shape a model behind the approved AI gateway would return.



const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Balanced speed and depth. Recommended.' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Deepest reasoning for complex incidents. Slower.' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest. Best for short lookups.' },
  { id: 'rules', label: 'Rules only (no model)', note: 'Search and templates only. Works without the AI gateway.' },
]

const TOOLS = [
  { id: 'kb', fn: 'search_knowledge_base', label: 'Search the knowledge base', desc: 'Finds passages in published, indexed pages of the linked knowledge bases.' },
  { id: 'data', fn: 'query_data', label: 'Query data tables', desc: 'Exact lookups in live tables such as the application directory and the on-call rota.' },
  { id: 'queue', fn: 'get_queue', label: 'Read the live queue', desc: 'Open tickets, SLA timers, assignees and who is online, from ServiceNow.' },
  { id: 'history', fn: 'get_metrics', label: 'Read ticket history and metrics', desc: 'Resolved tickets, MTTR, SLA attainment, FCR and transfers.' },
  { id: 'fixes', fn: 'request_fix', label: 'Propose automated fixes', desc: 'Sends a fix to a manager for approval. Copilot never runs it.' },
  { id: 'drafts', fn: 'draft_text', label: 'Draft customer updates and handovers', desc: 'Writes text for you to check and copy. Copilot never sends it.' },
]

const GUARDRAILS = [
  { id: 'alwaysSearch', label: 'Search the knowledge base before every answer', desc: 'Copilot looks things up on every question instead of deciding when to.' },
  { id: 'liveNumbers', label: 'Live tools for numbers, knowledge base for policy', desc: 'SLA timers, counts and metrics come from the queue and history, never from page text.' },
  { id: 'flagErrors', label: 'Say when a lookup fails', desc: 'A failed search is reported as a failure, not as "nothing found".' },
  { id: 'cite', label: 'Show sources on every answer', desc: 'Each answer lists the pages, tickets and data it used.' },
  { id: 'approval', label: 'A person approves every action', desc: 'Always on. Fixes need a manager; drafts are copied, never sent.', locked: true },
]

const INSIGHT_TYPES = [
  { id: 'atrisk', label: 'Live SLA risk' },
  { id: 'sla', label: 'SLA attainment trend' },
  { id: 'app', label: 'Slow business apps' },
  { id: 'recurring', label: 'Recurring fixes' },
  { id: 'transfers', label: 'Transfer hotspots' },
  { id: 'lost', label: 'Lost time' },
  { id: 'kbgap', label: 'Knowledge gaps and conflicts' },
]

const defaultCopilot = () => ({
  name: 'Scope Copilot',
  model: 'claude-sonnet-5-5',
  instructions: 'You help Solution Center analysts and managers resolve incidents. Lead with the next action, then the context. Use published runbooks and resolution codes. Quote SLA times from the live queue. Never promise a customer a time we cannot meet.',
  kbIds: ['kb1', 'kb2'],
  tools: Object.fromEntries(TOOLS.map((t) => [t.id, true])),
  guardrails: Object.fromEntries(GUARDRAILS.map((g) => [g.id, true])),
  insights: { enabled: true, types: Object.fromEntries(INSIGHT_TYPES.map((t) => [t.id, true])) },
  access: { analysts: true },
})

const SUGGESTIONS = {
  lead: ['Which tickets are at risk right now?', 'Why is Payments Hub slow to resolve?', 'Draft my shift handover', 'Who is online and how loaded are they?', 'What is the P2 SLA?', 'Top 5 root causes this quarter'],
  analyst: ['Which of my tickets are at risk?', 'How do I fix VPN disconnects?', 'Who do I escalate Payments Hub issues to?', 'What is the P2 SLA?', 'How do I share a calendar with a delegate?', 'Draft my shift handover'],
}

// ---------- Answer builder ----------
function builder() {
  const r = { parts: [], sources: [], steps: [], actions: [], followups: [], miss: false }
  return {
    r,
    p: (text) => r.parts.push({ t: 'p', text }),
    h: (text) => r.parts.push({ t: 'h', text }),
    ul: (items) => items.length && r.parts.push({ t: 'ul', items }),
    ol: (items) => items.length && r.parts.push({ t: 'ol', items }),
    table: (head, rows) => r.parts.push({ t: 'table', head, rows }),
    note: (tone, text) => r.parts.push({ t: 'note', tone, text }),
    quote: (title, heading, text) => r.parts.push({ t: 'quote', title, heading, text }),
    draft: (text) => r.parts.push({ t: 'draft', text }),
    src: (s) => { if (!r.sources.some((x) => x.kind === s.kind && x.id === s.id)) r.sources.push(s) },
    step: (tool, args, result, ok = true) => r.steps.push({ tool, args, result, ok }),
    act: (a) => r.actions.push(a),
    follow: (...q) => r.followups.push(...q),
  }
}

const kbName = (state, id) => state.kb.kbs.find((k) => k.id === id)?.name || 'Knowledge base'
const kbSrc = (state, p) => ({ kind: 'kb', id: p.id, label: p.live.title, sub: `${kbName(state, p.kbId)} · v${p.live.version}` })
const clip = (s, n = 48) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// Runs search_knowledge_base and records the step. Returns the result set.
function kbSearch(c, R, query, limit) {
  if (!c.cfg.tools.kb) { R.step('search_knowledge_base', `"${clip(query)}"`, 'skipped: tool turned off in settings', false); return { ok: false, off: true, results: [] } }
  if (!c.kbIds.length) { R.step('search_knowledge_base', `"${clip(query)}"`, 'error: no knowledge base is linked to Copilot', false); return { ok: false, error: 'No knowledge base is linked to Copilot', results: [] } }
  const res = searchKb(c.state.kb, c.kbIds, query, limit)
  if (!res.ok) R.step('search_knowledge_base', `"${clip(query)}"`, `error: ${res.error}`, false)
  else {
    const pages = new Set(res.results.map((x) => x.pageId)).size
    R.step('search_knowledge_base', `"${clip(query)}"`, res.results.length ? `${res.results.length} passage${res.results.length > 1 ? 's' : ''} from ${pages} page${pages > 1 ? 's' : ''}` : `no match in ${res.searched} indexed pages`)
  }
  return res
}
function kbFailure(c, R, res) {
  if (res.off) return R.note('warn', 'Knowledge base search is turned off in Copilot settings, so this answer has no runbook or policy behind it.')
  if (c.cfg.guardrails.flagErrors) R.note('crit', `I couldn't search the knowledge base: ${res.error}. This is a failed lookup, not an empty result.`)
}
// "Always search" guardrail: every answer gets a KB lookup, shown as related reading.
function related(c, R, query, skipIds = []) {
  if (!c.cfg.guardrails.alwaysSearch) return
  const res = kbSearch(c, R, query, 3)
  if (!res.ok) return res.off ? null : kbFailure(c, R, res)
  const skip = new Set([...skipIds, ...R.r.sources.map((x) => x.id)])
  const pages = [...new Map(res.results.filter((x) => !skip.has(x.pageId)).map((x) => [x.pageId, x])).values()]
  if (!pages.length) return
  R.h('Related in the knowledge base')
  R.ul(pages.slice(0, 2).map((x) => `**${x.page.live.title}** › ${x.heading}`))
  pages.slice(0, 2).forEach((x) => R.src(kbSrc(c.state, x.page)))
}

// ---------- Intents ----------
function answer(state, question, ctx = {}, now = Date.now()) {
  const cfg = state.copilot.config
  const me = byId[state.role === 'lead' ? 'a1' : 'a2']
  const c = { state, cfg, me, lead: state.role === 'lead', kbIds: cfg.kbIds.filter((id) => state.kb.kbs.some((k) => k.id === id)), now }
  const R = builder()
  const q = question.trim()
  const s = q.toLowerCase()
  const incId = q.toUpperCase().match(/INC\d{6,}/)?.[0]
  const ticketId = incId || ctx.ticketId
  const open = ticketId && state.tickets.find((t) => t.id === ticketId)
  const past = ticketId && !open && state.history.find((h) => h.id === ticketId)

  if (ctx.insight && q === ctx.insight.prompt) insightAnswer(c, R, ctx.insight)
  else if (/handover/.test(s)) handoverAnswer(c, R)
  else if (open && /draft|update|message|email|tell the (customer|user|caller)|write/.test(s)) customerUpdate(c, R, open)
  else if (open && /doesn.?t work|didn.?t work|not work|fail|escalat|still|next|stuck/.test(s)) escalationAnswer(c, R, open)
  else if (open && /similar/.test(s)) similarAnswer(c, R, open)
  else if (open && (incId || /resolve|fix|how|what|help|start|do i|\?$/.test(s))) ticketAnswer(c, R, open)
  else if (past) pastTicketAnswer(c, R, past)
  else if (/\bsla\b|resolution target|resolve within/.test(s) && /\bp[1-4]\b|target|policy|what is|what's/.test(s) && !/attainment|trend|driv|breach rate/.test(s)) slaPolicyAnswer(c, R, q)
  else if (/at risk|breach(ed|ing)?\b(?! rate)|right now|unassigned|waiting|backlog|queue/.test(s) && !/trend|month|week|attainment/.test(s)) queueAnswer(c, R, s)
  else if (/who.*(online|available|on shift|working)|how loaded|workload|capacity|staff/.test(s)) staffAnswer(c, R)
  else if (/escalat|owner|owns|vendor|support hours|on.?call|bridge|contact for|status of/.test(s)) dataAnswer(c, R, q)
  else if (appNamed(q) && /why|slow|wrong|explain|happening|problem/.test(s)) appDeepDive(c, R, appNamed(q))
  else if (/mttr|transfer|fcr|first contact|volume|trend|lost time|slowest|fastest|attainment|root cause|how many|most used|top \d|worst|best/.test(s)) metricsAnswer(c, R, q)
  else kbAnswer(c, R, q)

  if (!cfg.guardrails.cite) R.r.sources = []
  return { ...R.r, model: cfg.model, at: now }
}

function ticketAnswer(c, R, t) {
  const { state, cfg, now } = c
  if (!cfg.tools.queue) { R.step('get_ticket', t.id, 'skipped: queue access is off', false); R.note('warn', 'Queue access is turned off in Copilot settings, so I can\'t read this ticket.'); return }
  const sla = slaInfo(t, now)
  const who = t.assignedTo ? byId[t.assignedTo].name : 'nobody yet'
  R.step('get_ticket', t.id, `${t.priority} · ${t.state} · ${sla.status}`)
  R.src({ kind: 'ticket', id: t.id, label: t.id, sub: 'Live queue' })
  R.p(`**${t.id}** · ${t.desc}. ${t.priority}, ${t.state.toLowerCase()}, assigned to ${who}. ${sla.remaining > 0 ? `**${fmtDur(sla.remaining)}** of SLA left.` : `SLA breached **${fmtDur(-sla.remaining)}** ago.`}`)
  if (sla.status === 'Breached') R.note('crit', 'This ticket has breached its SLA. Resolve it first, and record a breach reason code when you close it.')
  else if (sla.status === 'At risk') R.note('warn', 'Less than 25% of the SLA is left. Work this one before anything else in your queue.')

  const a = computeAssist(state.history, state.codes, t.desc, t.hintCode, t.id)
  if (cfg.tools.history) R.step('find_similar_incidents', `"${clip(t.desc, 40)}"`, `${a.sample} similar resolved incidents`)
  if (!a.top) { R.p('I found no similar resolved incidents. Start with the scope check: who else is affected, and is there a parent major incident?'); related(c, R, t.desc); return }
  const info = a.top.info
  R.p(`Likely fix: **${info.code}** ${info.title}. ${Math.round(a.top.conf * 100)}% of ${a.sample} similar incidents used it; they typically took ${fmtH(a.typicalRes)}.`)

  R.step('search_knowledge_base', `"${info.code}"`, '…')
  const step = R.r.steps[R.r.steps.length - 1]
  const pg = cfg.tools.kb ? pageForCode(state.kb, c.kbIds, info.code) : null
  if (pg) {
    step.result = `runbook found: ${pg.live.title}`
    const chunk = chunksOf(pg).find((x) => /steps|workaround/i.test(x.heading)) || chunksOf(pg)[0]
    R.quote(pg.live.title, chunk.heading, chunk.text)
    R.src(kbSrc(state, pg))
    if (pg.index === 'failed') R.note('warn', `The latest edit to this page failed to index, so this is the last good version (v${pg.live.version}).`)
    else if (pg.index === 'indexing') R.note('accent', `A new version is indexing. This is v${pg.live.version} until it finishes.`)
  } else {
    const draft = pageForCode(state.kb, c.kbIds, info.code, { published: false })
    step.result = cfg.tools.kb ? (draft ? 'draft only, not indexed' : 'no runbook covers this code') : 'skipped: tool turned off'
    step.ok = !!cfg.tools.kb
    if (draft) R.note('warn', `**${draft.draft.title}** exists only as a draft, so I can't use it yet. A manager needs to publish it.`)
    else R.note('warn', `No published runbook covers ${info.code}. The steps below are the standard ones, not a runbook.`)
    R.ol([`Confirm scope: is anyone else on **${t.businessApp}** affected?`, `Follow ${info.runbook}.`, `${info.title}.`, `Ask ${t.caller} to confirm service is restored, then log the contact.`])
    R.act({ label: draft ? 'Open the draft' : 'Write the runbook', icon: 'doc', kind: 'nav', page: 'kb', opts: draft ? { page: draft.id } : { create: info.runbook, code: info.code } })
  }

  const app = cfg.tools.data ? appRow(state.kb, c.kbIds, t.businessApp) : null
  if (app) {
    R.step('query_data', `${app.page.draft.title}, Application = "${t.businessApp}"`, `1 row · status ${app.row.Status}`)
    R.src({ kind: 'data', id: app.page.id, label: app.page.draft.title, sub: 'Live data' })
    if (app.row.Status !== 'Operational') R.note('warn', `${t.businessApp} is marked **${app.row.Status}** in the application directory. Check for a parent major incident before you work this alone.`)
  }
  if (t.priority === 'P1') {
    const mim = cfg.tools.kb && searchKb(state.kb, c.kbIds, 'major incident process bridge', 1).results[0]
    if (mim) { R.p(`This is a P1: the **${mim.page.live.title}** applies. Open the bridge within 15 minutes and post updates every 30 minutes.`); R.src(kbSrc(state, mim.page)) }
  }

  if (a.similar.length) {
    R.h('Similar incidents')
    R.ul(a.similar.slice(0, 3).map((h) => `\`${h.id}\` ${clip(h.desc, 60)} · \`${h.code}\` · ${fmtH(h.resH)}`))
  }
  fixAction(c, R, t, info)
  R.act({ label: 'Open ticket', icon: 'arrowR', kind: 'nav', page: 'home', opts: { ticket: t.id } })
  R.follow('Draft a customer update', 'What if the fix doesn\'t work?', 'Show similar incidents')
}

function fixAction(c, R, t, info) {
  if (!info.automatable) return
  const pending = c.state.approvals.find((x) => x.ticket === t.id)
  if (pending) return R.note(pending.status === 'Rejected' ? 'crit' : 'accent', `Automated fix ${pending.id} for this ticket is **${pending.status.toLowerCase()}**.`)
  if (!c.cfg.tools.fixes) return
  R.p(`An automated fix is available: ${info.fix}. It runs only after a manager approves it.`)
  R.act({ label: c.lead ? 'Propose automated fix' : 'Request fix approval', icon: 'bolt', kind: 'dispatch', primary: true, action: { type: 'requestFix', ticket: t.id, code: info.code, fix: info.fix, by: c.me.name } })
}

function escalationAnswer(c, R, t) {
  const { state, cfg } = c
  R.src({ kind: 'ticket', id: t.id, label: t.id, sub: 'Live queue' })
  const res = kbSearch(c, R, 'escalation transfer when to escalate')
  const pol = res.ok && res.results.find((x) => /escalat/i.test(x.page.live.title))
  if (pol) { R.quote(pol.page.live.title, pol.heading, pol.text); R.src(kbSrc(state, pol.page)) } else if (!res.ok) kbFailure(c, R, res)
  const app = cfg.tools.data && appRow(state.kb, c.kbIds, t.businessApp)
  if (app) {
    R.step('query_data', `${app.page.draft.title}, Application = "${t.businessApp}"`, '1 row')
    R.src({ kind: 'data', id: app.page.id, label: app.page.draft.title, sub: 'Live data' })
    R.p(`For **${t.businessApp}**, escalate to **${app.row['Escalation resolver']}**. Owner group ${app.row['Owner group']}, vendor ${app.row.Vendor}, support hours ${app.row['Support hours']}.`)
    const oc = onCallFor(state.kb, c.kbIds, app.row['Escalation resolver'])
    if (oc) {
      R.step('query_data', `${oc.page.draft.title}, Resolver group = "${app.row['Escalation resolver']}"`, '1 row')
      R.src({ kind: 'data', id: oc.page.id, label: oc.page.draft.title, sub: 'Live data' })
      R.p(`On call this week: **${oc.row['Primary on-call']}**, ${oc.row['Bridge / phone']}, until ${oc.row.Until}.`)
    }
  } else R.p('I couldn\'t find this application in a data table. Check the owner in ServiceNow before you transfer.')
  R.p('Before you transfer: write a work note with the symptoms, what you tried and the result, so the resolver group does not start again.')
  R.follow('Draft a customer update', 'Show similar incidents')
}

function similarAnswer(c, R, t) {
  const a = computeAssist(c.state.history, c.state.codes, t.desc, t.hintCode, t.id)
  R.step('find_similar_incidents', `"${clip(t.desc, 40)}"`, `${a.sample} similar resolved incidents`)
  if (!a.similar.length) return R.p('No similar resolved incidents.')
  R.p(`The closest resolved incidents to **${t.id}**:`)
  R.table(['Ticket', 'Code', 'RES MTTR', 'FCR', 'Match'], a.similar.map((h) => [h.id, h.code, fmtH(h.resH), h.fcr ? 'Yes' : 'No', `${Math.round(h.score * 100)}%`]))
  R.src({ kind: 'metric', id: 'history', label: 'Ticket history', sub: `${a.sample} matches` })
  R.act({ label: 'Open Ticket Explorer', icon: 'search', kind: 'nav', page: 'explorer' })
}

function customerUpdate(c, R, t) {
  const { state, cfg, me, now } = c
  if (!cfg.tools.drafts) { R.step('draft_text', 'customer_update', 'skipped: drafting is off', false); return R.note('warn', 'Drafting is turned off in Copilot settings.') }
  const res = kbSearch(c, R, 'customer update template interval')
  const tpl = res.ok && res.results.find((x) => /template/i.test(x.page.live.title))
  if (tpl) R.src(kbSrc(state, tpl.page))
  const every = t.priority === 'P1' ? 30 * 60e3 : t.priority === 'P2' ? HOUR : 4 * HOUR
  const a = computeAssist(state.history, state.codes, t.desc, t.hintCode, t.id)
  const cause = a.top ? ROOT_CAUSES[a.top.info.cause].subs[a.top.info.sub].toLowerCase() : 'the cause'
  const status = t.state === 'Awaiting Customer' ? 'We need one thing from you to continue: please reply with a screenshot of the error'
    : a.top ? `We've traced it to ${cause} and are now working on the fix (${a.top.info.title.toLowerCase()})` : 'We are investigating and have ruled out the most common causes'
  R.step('draft_text', 'customer_update', `${t.priority} interval: every ${fmtDur(every)}`)
  R.p(`Draft update for ${t.caller}${tpl ? `, following **${tpl.page.live.title}**` : ''}. Check it before you send it.`)
  const text = `Hi ${t.caller}, this is ${me.name.split(' ')[0]} from the Solution Center about ${t.id} (${t.desc}). ${status}. Next update by ${fmtTime(now + every)}.`
  R.draft(text)
  R.act({ label: 'Copy draft', icon: 'copy', kind: 'copy', text, primary: true })
  R.act({ label: 'Log as contact', icon: 'phone', kind: 'dispatch', action: { type: 'addContact', id: t.id, entry: { channel: 'Email', note: text, by: me.name } } })
}

function pastTicketAnswer(c, R, h) {
  R.step('get_ticket', h.id, `resolved · ${h.code}`)
  R.src({ kind: 'ticket', id: h.id, label: h.id, sub: 'Ticket history' })
  R.p(`**${h.id}** · ${h.desc}. Resolved by ${byId[h.analyst]?.name || 'an analyst'} with \`${h.code}\` in ${fmtH(h.resH)} RES (${fmtH(h.ezeH)} end to end). ${h.slaMet ? 'Within SLA.' : `Missed SLA: ${h.breachCode} ${BREACH_REASONS[h.breachCode] || ''}.`}`)
  R.ul([h.diagNote && `Diagnosis: ${h.diagNote}`, h.fixNote && `Fix: ${h.fixNote}`, h.escalatedTo && `Escalated to ${h.escalatedTo}`].filter(Boolean))
  const pg = pageForCode(c.state.kb, c.kbIds, h.code)
  if (pg) { R.p(`Runbook: **${pg.live.title}**.`); R.src(kbSrc(c.state, pg)) }
  R.act({ label: 'Open in Ticket Explorer', icon: 'search', kind: 'nav', page: 'explorer' })
}

function slaPolicyAnswer(c, R, q) {
  const { state, cfg } = c
  const p = q.toUpperCase().match(/\bP([1-4])\b/)?.[0]
  const list = p ? [p] : Object.keys(PRIORITIES)
  if (cfg.guardrails.liveNumbers) {
    R.step('get_sla_rules', p || 'all', 'from the queue\'s SLA engine')
    R.p(`The SLA rule the queue runs on: ${list.map((k) => `**${k}** ${PRIORITIES[k].slaH}h`).join(', ')}. A ticket is at risk when less than 25% of its SLA is left.`)
    R.src({ kind: 'queue', id: 'sla', label: 'SLA rules', sub: 'Live queue' })
  }
  const res = kbSearch(c, R, `${p || ''} sla resolution targets priority`)
  if (!res.ok) kbFailure(c, R, res)
  else {
    const hit = res.results.find((x) => /sla/i.test(x.page.live.title)) || res.results[0]
    if (hit) { R.quote(hit.page.live.title, hit.heading, hit.text); R.src(kbSrc(state, hit.page)) }
  }
  const cf = findConflicts(state.kb).filter((x) => !p || x.prio === p)
  cf.forEach((x) => x.off.forEach((o) => {
    R.note('warn', `Conflict: **${o.page.live.title}** says ${x.prio} is ${o.hours}h, but the live rule is ${x.rule}h. Fix or retire that page.`)
    R.act({ label: `Open ${clip(o.page.live.title, 28)}`, icon: 'doc', kind: 'nav', page: 'kb', opts: { page: o.page.id } })
  }))
}

function queueAnswer(c, R, s) {
  const { state, cfg, me, lead, now } = c
  if (!cfg.tools.queue) { R.step('get_queue', '', 'skipped: queue access is off', false); return R.note('warn', 'Queue access is turned off in Copilot settings.') }
  const mine = !lead || /\bmy\b|\bmine\b/.test(s)
  const open = state.tickets.filter((t) => t.state !== 'Resolved' && (!mine || t.assignedTo === me.id))
  const rows = open.map((t) => ({ t, s: slaInfo(t, now) }))
  const br = rows.filter((x) => x.s.status === 'Breached').sort((a, b) => a.s.remaining - b.s.remaining)
  const ar = rows.filter((x) => x.s.status === 'At risk').sort((a, b) => a.s.remaining - b.s.remaining)
  const un = open.filter((t) => !t.assignedTo)
  R.step('get_queue', mine ? `assignee = ${me.name}` : 'team', `${open.length} open · ${br.length} breached · ${ar.length} at risk`)
  R.src({ kind: 'queue', id: 'queue', label: 'Live queue', sub: `ServiceNow · synced ${fmtTime(state.snow.lastSync)}` })
  R.p(`${mine ? 'In your queue' : 'In the team queue'}: **${open.length}** open, **${br.length}** breached, **${ar.length}** at risk${mine ? '' : `, **${un.length}** waiting for an analyst`}.`)
  const top = [...br, ...ar].slice(0, 6)
  if (top.length) {
    R.table(['Ticket', 'Priority', 'SLA', 'Assignee', 'Issue'], top.map(({ t, s: x }) => [t.id, t.priority, x.remaining > 0 ? `${fmtDur(x.remaining)} left` : `over ${fmtDur(-x.remaining)}`, t.assignedTo ? byId[t.assignedTo].name : 'Unassigned', clip(t.desc, 44)]))
    const first = top[0].t
    R.p(`Start with **${first.id}**${first.priority === 'P1' ? ', a P1' : ''}: it has the least SLA left${first.assignedTo ? '' : ' and nobody owns it'}.`)
    R.act({ label: `Work ${first.id} with Copilot`, icon: 'spark', kind: 'ask', text: `How do I resolve ${first.id}?`, primary: true })
  } else R.note('good', 'Nothing is breached or at risk right now.')
  if (lead && un.length) R.act({ label: 'Rebalance queue', icon: 'swap', kind: 'dispatch', action: { type: 'rebalance' } })
  R.act({ label: 'Open queue', icon: 'arrowR', kind: 'nav', page: 'home' })
}

function staffAnswer(c, R) {
  const { state, cfg } = c
  if (!cfg.tools.queue) return R.note('warn', 'Queue access is turned off in Copilot settings.')
  const on = state.analysts.filter((a) => a.status === 'online').map((a) => ({ a, load: loadOf(a.id, state.tickets) })).sort((x, y) => y.load - x.load)
  R.step('get_queue', 'analysts', `${on.length} online of ${state.analysts.length}`)
  R.src({ kind: 'queue', id: 'staff', label: 'Analyst status', sub: 'Live queue' })
  R.p(`**${on.length}** analysts are online. Load is weighted P1 = 3, P2 = 2, P3/P4 = 1, with a 12-point cap.`)
  R.table(['Analyst', 'Group', 'Load', 'Open'], on.map(({ a, load }) => [a.name, a.group, `${load} pts`, String(state.tickets.filter((t) => t.assignedTo === a.id).length)]))
  const away = state.analysts.filter((a) => a.status !== 'online')
  if (away.length) R.p(`Not available: ${away.map((a) => `${a.name} (${a.status})`).join(', ')}.`)
  if (on.length && on[0].load - on[on.length - 1].load > 3) R.note('warn', `Load is uneven: ${on[0].a.name} has ${on[0].load} pts and ${on[on.length - 1].a.name} has ${on[on.length - 1].load}. Consider a rebalance.`)
}

function dataAnswer(c, R, q) {
  const { state, cfg } = c
  if (!cfg.tools.data) { R.step('query_data', `"${clip(q)}"`, 'skipped: tool turned off', false); return kbAnswer(c, R, q) }
  const hits = queryData(state.kb, c.kbIds, q)
  R.step('query_data', `"${clip(q)}"`, `${hits.length} matching row${hits.length === 1 ? '' : 's'}`)
  if (!hits.length) return kbAnswer(c, R, q)
  const byPage = new Map()
  hits.forEach((h) => byPage.set(h.page, [...(byPage.get(h.page) || []), h.row]))
  byPage.forEach((rows, p) => {
    R.p(`From **${p.draft.title}** (live data${p.data.source !== 'Manual' ? `, synced from ${p.data.source} at ${fmtTime(p.data.syncedAt)}` : ''}):`)
    R.table(p.data.columns, rows.map((r) => r.cells))
    R.src({ kind: 'data', id: p.id, label: p.draft.title, sub: 'Live data' })
  })
  const app = hits.find((h) => h.page.data.columns[0] === 'Application')
  if (app) {
    const row = rowObj(app.page, app.row)
    const oc = onCallFor(state.kb, c.kbIds, row['Escalation resolver'])
    if (oc) {
      R.step('query_data', `${oc.page.draft.title}, Resolver group = "${row['Escalation resolver']}"`, '1 row')
      R.p(`On call for ${row['Escalation resolver']} this week: **${oc.row['Primary on-call']}**, ${oc.row['Bridge / phone']}.`)
      R.src({ kind: 'data', id: oc.page.id, label: oc.page.draft.title, sub: 'Live data' })
    }
  }
  related(c, R, q)
}

function kbAnswer(c, R, q) {
  const { state } = c
  const res = kbSearch(c, R, q)
  if (!res.ok) {
    if (res.off) return R.note('warn', 'Knowledge base search is turned off in Copilot settings.')
    kbFailure(c, R, res)
    if (!c.cfg.guardrails.flagErrors) R.p('I couldn\'t find anything about that.')
    return
  }
  if (!res.results.length) {
    R.r.miss = true
    R.p(`I searched ${res.searched} published pages in ${c.kbIds.map((id) => kbName(state, id)).join(' and ')} and found nothing that answers this. I won't guess.`)
    R.p('If this comes up again, it belongs in the knowledge base.')
    R.act({ label: 'Create a page for this', icon: 'plus', kind: 'nav', page: 'kb', opts: { create: q } })
    return
  }
  const per = {}
  const top = res.results.filter((x) => (per[x.pageId] = (per[x.pageId] || 0) + 1) <= 2).slice(0, 3)
  const first = top[0]
  R.p(`Here's what **${first.page.live.title}** says${top.some((x) => x.pageId !== first.pageId) ? ', with related passages' : ''}:`)
  const seen = new Set()
  top.forEach((x) => {
    if (seen.has(x.key)) return
    seen.add(x.key)
    R.quote(x.page.live.title, x.heading, x.text)
    R.src(kbSrc(state, x.page))
  })
  const codes = [...new Set(top.flatMap((x) => x.page.codes))]
  if (codes.length) R.p(`Resolution code${codes.length > 1 ? 's' : ''}: ${codes.map((x) => `\`${x}\``).join(', ')}.`)
  if (first.page.index === 'failed') R.note('warn', `The latest edit to ${first.page.live.title} failed to index. This is the last good version (v${first.page.live.version}).`)
  R.act({ label: 'Open page', icon: 'doc', kind: 'nav', page: 'kb', opts: { page: first.pageId } })
}

function metricsAnswer(c, R, q) {
  const { state, cfg, now } = c
  if (!cfg.tools.history) { R.step('get_metrics', '', 'skipped: history access is off', false); return R.note('warn', 'History and metrics access is turned off in Copilot settings.') }
  const p = parseQuery(q)
  const rows = inWindow(state.history, now, p.days, p.prio)
  let data = aggregate(rows, p.dim, p.measure)
  if (p.tpl === 'rank') data = (p.asc ? data.slice().reverse() : data).slice(0, p.topN || 5)
  const M = MEASURES[p.measure]
  R.step('get_metrics', `${p.measure}, by ${p.dim}, ${p.days}d${p.prio !== 'All' ? `, ${p.prio}` : ''}`, `${rows.length} resolved tickets`)
  R.src({ kind: 'metric', id: 'history', label: 'Ticket history', sub: `${p.days} days · ${rows.length} tickets` })
  if (!rows.length) return R.p('No resolved tickets match that window.')
  const dimL = DIMENSIONS[p.dim].label.toLowerCase()
  if (p.dim === 'week') R.p(`${M.label} by week, last ${p.days} days. Overall: **${M.fmt(M.fn(rows))}**.`)
  else R.p(`${M.label} by ${dimL}, last ${p.days} days. ${data[0] ? `**${data[0].label}** is ${p.tpl === 'rank' && p.asc ? 'lowest' : 'highest'} at **${M.fmt(data[0].value)}**` : ''}; the team overall is ${M.fmt(M.fn(rows))}.`)
  R.table([DIMENSIONS[p.dim].label, M.label, 'Tickets'], data.slice(0, 8).map((d) => [d.label, String(M.fmt(d.value)), String(d.n)]))
  R.act({ label: 'Open Reports', icon: 'chart', kind: 'nav', page: 'reports' })
  if (p.dim === 'businessApp' && data[0]) R.follow(`Why is ${data[0].label} slow to resolve?`)
}

// ---------- Deep dives (used by insights and "why" questions) ----------
const window30 = (state, now) => state.history.filter((h) => h.resolvedAt >= now - 30 * DAY)
function topBreach(rows) {
  const counts = {}
  rows.filter((h) => !h.slaMet && h.breachCode).forEach((h) => (counts[h.breachCode] = (counts[h.breachCode] || 0) + 1))
  const top = Object.entries(counts).sort((x, y) => y[1] - x[1])[0]
  return top ? { code: top[0], n: top[1], label: BREACH_REASONS[top[0]] } : null
}

function appDeepDive(c, R, app) {
  const { state, cfg, now } = c
  if (!cfg.tools.history) return R.note('warn', 'History and metrics access is turned off in Copilot settings.')
  const rows = window30(state, now)
  const mine = rows.filter((h) => h.businessApp === app)
  R.step('get_metrics', `res, lost, transfers, by businessApp = "${app}", 30d`, `${mine.length} of ${rows.length} tickets`)
  R.src({ kind: 'metric', id: 'history', label: 'Ticket history', sub: `30 days · ${rows.length} tickets` })
  if (!mine.length) return R.p(`No ${app} tickets were resolved in the last 30 days.`)
  const f = (m, r) => MEASURES[m].fn(r)
  const ratio = f('res', mine) / f('res', rows)
  R.p(`**${app}** averaged **${fmtH(f('res', mine))}** RES MTTR over ${mine.length} tickets in the last 30 days, against ${fmtH(f('res', rows))} for the team (${ratio.toFixed(1)}×).${ratio < 1.05 ? ' So the fixes themselves are not slower here; look at the waiting and the transfers below.' : ''}`)
  const codes = aggregate(mine, 'code', 'count').slice(0, 3)
  const br = topBreach(mine)
  R.table(['Measure', app, 'Team'], [
    ['RES MTTR', fmtH(f('res', mine)), fmtH(f('res', rows))],
    ['Lost time', fmtH(f('lost', mine)), fmtH(f('lost', rows))],
    ['Transfer rate', pct(f('transfers', mine)), pct(f('transfers', rows))],
    ['SLA attainment', pct(f('sla', mine)), pct(f('sla', rows))],
    ['FCR', pct(f('fcr', mine)), pct(f('fcr', rows))],
  ])
  R.ul([
    codes.length && `Most common fixes: ${codes.map((x) => `\`${x.label}\` (${x.value})`).join(', ')}`,
    br && `Most common breach reason: ${br.code} ${br.label} (${br.n})`,
  ].filter(Boolean))
  const tr = f('transfers', mine) - f('transfers', rows), lost = f('lost', mine) - f('lost', rows)
  if (tr > 0.08) R.p(`The biggest driver is **transfers**: ${pct(f('transfers', mine))} of ${app} tickets move between groups. Make sure the runbook names the escalation resolver so tickets go to the right place first time.`)
  else if (lost > 0.75) R.p(`The biggest driver is **waiting**: tickets sit ${fmtH(lost)} longer before anyone works them. Look at intake routing and staffing for ${app}.`)
  else if (ratio >= 1.05) R.p('The fixes themselves take longer here. A clearer runbook, or automating the most common fix, would help most.')
  else R.p(`${app} is in line with the team on transfers and waiting too. Nothing stands out in the last 30 days.`)
  const app_ = cfg.tools.data && appRow(state.kb, c.kbIds, app)
  if (app_) {
    R.step('query_data', `${app_.page.draft.title}, Application = "${app}"`, `status ${app_.row.Status}`)
    R.src({ kind: 'data', id: app_.page.id, label: app_.page.draft.title, sub: 'Live data' })
    if (app_.row.Status !== 'Operational') R.note('warn', `${app} is currently marked **${app_.row.Status}** in the application directory.`)
  }
  if (codes[0]) {
    const pg = pageForCode(state.kb, c.kbIds, codes[0].label)
    if (pg) { R.p(`Runbook for the top fix: **${pg.live.title}**.`); R.src(kbSrc(state, pg)) } else R.note('warn', `No published runbook covers \`${codes[0].label}\`, the most common ${app} fix.`)
  }
  R.act({ label: 'Open Reports', icon: 'chart', kind: 'nav', page: 'reports' })
  R.follow(`Who do I escalate ${app} issues to?`, 'Top 5 root causes this quarter')
}

function codeDeepDive(c, R, code) {
  const { state, now } = c
  const rows = window30(state, now)
  const mine = rows.filter((h) => h.code === code)
  const info = state.codes.find((x) => x.code === code)
  R.step('get_metrics', `count, res, by code = "${code}", 30d`, `${mine.length} tickets`)
  R.src({ kind: 'metric', id: 'history', label: 'Ticket history', sub: `30 days · ${rows.length} tickets` })
  R.p(`\`${code}\` (${info?.title || 'unknown fix'}) closed **${mine.length}** tickets in the last 30 days, ${pct(mine.length / Math.max(1, rows.length))} of all resolved volume, at ${fmtH(MEASURES.res.fn(mine))} average RES MTTR.`)
  const apps = aggregate(mine, 'businessApp', 'count').slice(0, 3)
  R.ul([`Apps affected: ${apps.map((a) => `${a.label} (${a.value})`).join(', ')}`, `First contact resolution: ${pct(MEASURES.fcr.fn(mine))}`])
  if (info?.automatable) R.p(`It's automatable (${info.fix}). Each use still needs an approval; if the fix is safe, ask for a standard change so it can run with less wait.`)
  R.p('The same fix this often points to an underlying cause. Raise a problem record so the resolver group can remove it, and link these tickets to it.')
  const pg = pageForCode(state.kb, c.kbIds, code)
  if (pg) { R.p(`Runbook: **${pg.live.title}**.`); R.src(kbSrc(state, pg)) } else R.note('warn', `No published runbook covers \`${code}\`.`)
  R.act({ label: 'Open resolution codes', icon: 'book', kind: 'nav', page: 'explorer', opts: { tab: 'codes' } })
}

function slaDeepDive(c, R) {
  const { state, now } = c
  const r30 = window30(state, now)
  const p30 = state.history.filter((h) => h.resolvedAt < now - 30 * DAY && h.resolvedAt >= now - 60 * DAY)
  R.step('get_metrics', 'sla, by priority and group, 30d vs prior 30d', `${r30.length} vs ${p30.length} tickets`)
  R.src({ kind: 'metric', id: 'history', label: 'Ticket history', sub: '60 days' })
  const a = MEASURES.sla.fn(r30), b = MEASURES.sla.fn(p30)
  const d = Math.round((a - b) * 100)
  R.p(`SLA attainment is **${pct(a)}** for the last 30 days, ${d ? `${d > 0 ? 'up' : 'down'} ${Math.abs(d)} pts from` : 'unchanged from'} ${pct(b)} in the 30 days before.`)
  R.table(['Priority', 'Last 30d', 'Prior 30d', 'Breaches'], ['P1', 'P2', 'P3', 'P4'].map((p) => {
    const x = r30.filter((h) => h.priority === p), y = p30.filter((h) => h.priority === p)
    return [p, pct(MEASURES.sla.fn(x)), pct(MEASURES.sla.fn(y)), String(x.filter((h) => !h.slaMet).length)]
  }))
  const br = topBreach(r30)
  if (br) R.p(`The most common breach reason is **${br.code} ${br.label}** (${br.n} of ${r30.filter((h) => !h.slaMet).length} breaches).`)
  const g = ASSIGNMENT_GROUPS.map((x) => ({ g: x, v: MEASURES.sla.fn(r30.filter((h) => h.assignmentGroup === x)) })).sort((x, y) => x.v - y.v)[0]
  R.p(`${g.g} has the lowest attainment at ${pct(g.v)}.`)
  R.act({ label: 'Open Reports', icon: 'chart', kind: 'nav', page: 'reports' })
}

function transferDeepDive(c, R, group) {
  const { state, now } = c
  const rows = window30(state, now).filter((h) => h.assignmentGroup === group)
  const moved = rows.filter((h) => h.transfers > 0)
  R.step('get_metrics', `transfers, by escalatedTo, group = "${group}", 30d`, `${moved.length} of ${rows.length} transferred`)
  R.src({ kind: 'metric', id: 'history', label: 'Ticket history', sub: '30 days' })
  R.p(`**${group}** transferred ${moved.length} of ${rows.length} tickets (${pct(moved.length / Math.max(1, rows.length))}) in the last 30 days.`)
  const to = {}
  moved.forEach((h) => (to[h.escalatedTo] = (to[h.escalatedTo] || 0) + 1))
  R.table(['Escalated to', 'Tickets'], Object.entries(to).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, String(v)]))
  const extra = MEASURES.lost.fn(moved) - MEASURES.lost.fn(rows.filter((h) => !h.transfers))
  if (extra > 0) R.p(`Transferred tickets lose **${fmtH(extra)}** more than the ones solved in place.`)
  const codes = aggregate(moved, 'code', 'count').slice(0, 3)
  R.p(`The codes that get transferred most: ${codes.map((x) => `\`${x.label}\``).join(', ')}. If the Solution Center can't resolve them, route them straight to the resolver; if it can, the runbooks need the missing steps.`)
  const res = kbSearch(c, R, 'escalation transfer policy')
  const pol = res.ok && res.results[0]
  if (pol) R.src(kbSrc(state, pol.page))
}

function lostDeepDive(c, R) {
  const { state, now } = c
  const rows = window30(state, now)
  R.step('get_metrics', 'lost, by group and app, 30d', `${rows.length} tickets`)
  R.src({ kind: 'metric', id: 'history', label: 'Ticket history', sub: '30 days' })
  R.p(`Average lost time (EZE minus RES: waiting before or between work) is **${fmtH(MEASURES.lost.fn(rows))}** over ${rows.length} tickets.`)
  R.table(['Business app', 'Avg lost time', 'Tickets'], aggregate(rows, 'businessApp', 'lost').slice(0, 5).map((d) => [d.label, fmtH(d.value), String(d.n)]))
  const backlog = rows.filter((h) => h.breachCode === 'BR-03').length
  if (backlog) R.p(`${backlog} ticket${backlog > 1 ? 's' : ''} breached because of queue backlog (BR-03). Check the shift rota for gaps at the busiest hours.`)
  R.act({ label: 'Open shift schedule', icon: 'cal', kind: 'nav', page: 'team', opts: { tab: 'schedule' } })
}

function gapAnswer(c, R) {
  const { state, now } = c
  const gaps = findGaps(state.kb, state.history, now)
  const cf = findConflicts(state.kb)
  R.step('check_knowledge_base', 'coverage, conflicts', `${gaps.length} codes without a runbook · ${cf.length} conflicts`)
  if (gaps.length) {
    R.p(`**${gaps.length}** resolution codes have no published runbook, so Copilot can't guide analysts on them:`)
    R.table(['Code', 'Fix', 'Uses (30d)', 'Page'], gaps.map((g) => [g.code.code, clip(g.code.title, 40), String(g.uses), g.draft ? 'Draft only' : 'None']))
  }
  cf.forEach((x) => x.off.forEach((o) => R.note('warn', `**${o.page.live.title}** says ${x.prio} is ${o.hours}h; the live SLA rule and **${x.claims.find((k) => k.hours === x.rule)?.page.live.title || 'the queue'}** say ${x.rule}h.`)))
  R.act({ label: 'Open knowledge base health', icon: 'doc', kind: 'nav', page: 'kb', opts: { tab: 'health' }, primary: true })
}

function insightAnswer(c, R, ins) {
  ({
    atrisk: () => queueAnswer(c, R, ''),
    sla: () => slaDeepDive(c, R),
    app: () => appDeepDive(c, R, ins.data.app),
    recurring: () => codeDeepDive(c, R, ins.data.code),
    transfers: () => transferDeepDive(c, R, ins.data.group),
    lost: () => lostDeepDive(c, R),
    kbgap: () => gapAnswer(c, R),
  }[ins.kind] || (() => kbAnswer(c, R, ins.prompt)))()
}

function handoverAnswer(c, R) {
  const { state, cfg, me, lead, now } = c
  if (!cfg.tools.drafts) return R.note('warn', 'Drafting is turned off in Copilot settings.')
  const open = state.tickets.filter((t) => t.state !== 'Resolved' && (lead || t.assignedTo === me.id))
  const crit = open.filter((t) => t.priority === 'P1' || t.priority === 'P2')
  const waiting = open.filter((t) => t.state === 'Awaiting Customer' || t.state === 'On Hold')
  const solved = state.history.filter((h) => h.resolvedAt >= startOfDay(now) && (lead || h.analyst === me.id))
  const fixes = state.approvals.filter((x) => x.status === 'Pending')
  R.step('get_queue', lead ? 'team' : `assignee = ${me.name}`, `${open.length} open · ${crit.length} P1/P2`)
  R.step('draft_text', 'shift_handover', 'following the shift handover standard')
  const res = kbSearch(c, R, 'shift handover standard includes')
  const std = res.ok && res.results.find((x) => /handover/i.test(x.page.live.title))
  if (std) R.src(kbSrc(state, std.page))
  R.src({ kind: 'queue', id: 'queue', label: 'Live queue', sub: `synced ${fmtTime(state.snow.lastSync)}` })
  const lines = [
    `Shift handover · ${me.name} · ${fmtTime(now)}`,
    `Resolved this shift: ${solved.length}. Still open: ${open.length}.`,
    '',
    `Open P1/P2 (${crit.length}):`,
    ...crit.slice(0, 8).map((t) => `- ${t.id} ${t.priority} ${clip(t.desc, 60)} · ${t.assignedTo ? byId[t.assignedTo].name : 'unassigned'} · ${slaInfo(t, now).status}`),
    '',
    `Waiting on customer or vendor (${waiting.length}):`,
    ...waiting.slice(0, 6).map((t) => `- ${t.id} ${clip(t.desc, 60)} · ${t.state}`),
    ...(lead ? ['', `Automated fixes waiting for approval: ${fixes.length ? fixes.map((x) => `${x.id} (${x.ticket})`).join(', ') : 'none'}`] : []),
    '',
    'Unusual: ',
  ]
  const text = lines.join('\n')
  R.p(`Here's a draft${std ? ` that follows **${std.page.live.title}**` : ''}. Add anything unusual at the end before you submit it.`)
  R.draft(text)
  R.act({ label: 'Copy draft', icon: 'copy', kind: 'copy', text, primary: true })
  R.act({ label: 'Open shift handover', icon: 'clip', kind: 'nav', page: 'home', opts: { tab: 'handover' } })
}

// ---------- Automated insights ----------
// Computed from history, the live queue and the knowledge base on every
// render, so they refresh with each ServiceNow sync.
function computeInsights(state, now = state.now) {
  const types = state.copilot.config.insights.types
  const H = state.history
  const r30 = H.filter((h) => h.resolvedAt >= now - 30 * DAY)
  const p30 = H.filter((h) => h.resolvedAt < now - 30 * DAY && h.resolvedAt >= now - 60 * DAY)
  const out = []

  const live = state.tickets.filter((t) => t.state !== 'Resolved').map((t) => ({ t, s: slaInfo(t, now) }))
  const br = live.filter((x) => x.s.status === 'Breached'), ar = live.filter((x) => x.s.status === 'At risk')
  if (br.length + ar.length) out.push({
    id: 'atrisk', kind: 'atrisk', tone: br.some((x) => x.t.priority === 'P1' || x.t.priority === 'P2') ? 'crit' : 'warn', icon: 'clock', source: 'Live queue',
    stat: String(br.length + ar.length), statLabel: 'tickets',
    title: `${br.length} breached and ${ar.length} at risk right now`,
    detail: [
      `${br.filter((x) => x.t.priority === 'P1' || x.t.priority === 'P2').length + ar.filter((x) => x.t.priority === 'P1' || x.t.priority === 'P2').length} of them are P1 or P2.`,
      live.some((x) => !x.t.assignedTo) ? `${live.filter((x) => !x.t.assignedTo).length} open tickets have no analyst.` : 'Every open ticket has an analyst.',
    ].join(' '),
    prompt: 'Which tickets are at risk right now, and what should we do first?',
  })

  const a = MEASURES.sla.fn(r30), b = MEASURES.sla.fn(p30), d = a - b
  out.push({
    id: 'sla', kind: 'sla', tone: d <= -0.03 ? 'warn' : d >= 0.03 ? 'good' : 'accent', icon: 'shield', source: 'Ticket history · 60 days',
    stat: pct(a), statLabel: 'SLA met',
    title: d <= -0.03 ? `SLA attainment fell ${Math.round(-d * 100)} pts this month` : d >= 0.03 ? `SLA attainment rose ${Math.round(d * 100)} pts this month` : 'SLA attainment is holding steady',
    detail: `${pct(a)} in the last 30 days against ${pct(b)} in the 30 days before.`,
    prompt: 'What is driving our SLA attainment this month?',
  })

  const team = MEASURES.res.fn(r30)
  const slow = aggregate(r30, 'businessApp', 'res').filter((x) => x.n >= 5)[0]
  if (slow) {
    const ratio = slow.value / team
    out.push({
      id: 'app', kind: 'app', tone: ratio >= 1.3 ? 'warn' : 'accent', icon: 'bolt', source: 'Ticket history · 30 days', data: { app: slow.label },
      stat: fmtH(slow.value), statLabel: 'RES MTTR',
      title: `${slow.label} is the slowest app to resolve`,
      detail: `${ratio.toFixed(1)}× the team average of ${fmtH(team)}, across ${slow.n} tickets.`,
      prompt: `Why is ${slow.label} slower to resolve than the rest of the team?`,
    })
  }

  const top = aggregate(r30, 'code', 'count')[0]
  if (top) {
    const info = state.codes.find((x) => x.code === top.label)
    out.push({
      id: 'recurring', kind: 'recurring', tone: 'accent', icon: 'refresh', source: 'Ticket history · 30 days', data: { code: top.label },
      stat: String(top.value), statLabel: 'times',
      title: `${top.label} keeps coming back`,
      detail: `${pct(top.value / Math.max(1, r30.length))} of resolved volume. ${info?.automatable ? 'It can be automated, with approval.' : 'A problem record could remove the cause.'}`,
      prompt: `${top.label} keeps coming back. Should we raise a problem record or automate it?`,
    })
  }

  const groups = ASSIGNMENT_GROUPS.map((g) => ({ g, v: MEASURES.transfers.fn(r30.filter((h) => h.assignmentGroup === g)) })).sort((x, y) => y.v - x.v)
  const teamTr = MEASURES.transfers.fn(r30)
  out.push({
    id: 'transfers', kind: 'transfers', tone: groups[0].v > 0.3 ? 'warn' : 'accent', icon: 'swap', source: 'Ticket history · 30 days', data: { group: groups[0].g },
    stat: pct(groups[0].v), statLabel: 'transferred',
    title: `${groups[0].g} transfers the most tickets`,
    detail: `The team average is ${pct(teamTr)}. Every transfer adds queue time.`,
    prompt: `Why does ${groups[0].g} transfer so many tickets, and where do they go?`,
  })

  const lost = MEASURES.lost.fn(r30)
  out.push({
    id: 'lost', kind: 'lost', tone: lost > 2 ? 'warn' : 'good', icon: 'pause', source: 'Ticket history · 30 days',
    stat: fmtH(lost), statLabel: 'avg lost',
    title: lost > 2 ? 'Lost time is above the 2h threshold' : 'Lost time is within the 2h threshold',
    detail: 'Lost time is EZE minus RES: how long tickets wait before or between work.',
    prompt: 'Where are we losing the most time before tickets are worked?',
  })

  const gaps = findGaps(state.kb, H, now).filter((g) => g.uses > 0)
  const cf = findConflicts(state.kb)
  if (gaps.length || cf.length) out.push({
    id: 'kbgap', kind: 'kbgap', tone: 'warn', icon: 'doc', source: 'Knowledge base',
    stat: String(gaps.length + cf.length), statLabel: 'issues',
    title: gaps.length ? `${gaps.length} busy resolution codes have no runbook` : 'The knowledge base contradicts the SLA rule',
    detail: [gaps.length && `${gaps.reduce((s, g) => s + g.uses, 0)} tickets used them in 30 days.`, cf.length && `${cf.length} conflicting SLA target${cf.length > 1 ? 's' : ''}.`].filter(Boolean).join(' '),
    prompt: 'Which resolution codes are missing a published runbook, and what conflicts?',
  })

  return out.filter((x) => types[x.kind] !== false)
}

const toneRank = { crit: 0, warn: 1, accent: 2, good: 3 }

  Object.assign(S, { MODELS, TOOLS, GUARDRAILS, INSIGHT_TYPES, defaultCopilot, SUGGESTIONS, answer, computeInsights, toneRank })
})()
