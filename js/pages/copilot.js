// Copilot page, ported from src/pages/Copilot.jsx: Ask (chat with threads and
// ticket context), Insights and Configure. Also the shared pieces other pages use:
//   S.canUseCopilot(state)                 can the signed-in role use Copilot
//   S.copilotAsk(threadId, text, ctx)      ask in a thread (was useCopilotAsk)
//   S.copilotChat({ threadId, onNeedThread, onAsk, scope })   the chat panel
//   S.insightCard(ins, { onAsk })          onAsk: action name, gets the insight id in el.dataset.v
//   S.insightsPanel()                      Reports' insight strip with its Copilot drawer
//   S.copilotDrawer({ insight, ticketId, onClose })   onClose: action name
;(function () {
  const { html, cls, attrs, icon, byId, fmtDateTime, fmtTime, slaInfo,
    GUARDRAILS, INSIGHT_TYPES, MODELS, SUGGESTIONS, TOOLS, answer, computeInsights, toneRank } = S

  let seq = 0
  const newId = (p) => `${p}-${Date.now().toString(36)}-${++seq}`
  // Route-driven conversations (a ticket or insight handed over from another
  // page) start once, even when a page renders more than once.
  const started = new Set()

  const modelLabel = (id) => (MODELS.find((m) => m.id === id) || {}).label || id
  const canUseCopilot = (state) => state.role === 'lead' || state.copilot.config.access.analysts
  const threadById = (id) => S.state.copilot.threads.find((t) => t.id === id)
  // Answers link to knowledge base pages with { page: id }; that would replace
  // the route's own page id, so it travels as kbPage (read by knowledge-base.js).
  const nav = (page, opts = {}) => {
    const { page: kbPage, ...rest } = opts
    S.nav(page, kbPage ? { ...rest, kbPage } : rest)
  }

  // Ask a question in a thread. The answer is computed now and revealed after
  // its tool calls have "run", so the steps show as they happen.
  function copilotAsk(threadId, text, ctx) {
    const st = S.state
    let c = ctx || (threadById(threadId) || {}).ctx || {}
    // Naming an open ticket makes it the conversation's context for follow-ups.
    const named = (text.toUpperCase().match(/INC\d{6,}/) || [])[0]
    if (named && named !== c.ticketId && st.tickets.some((t) => t.id === named)) {
      c = { ticketId: named }
      S.dispatch({ type: 'copilotCtx', id: threadId, ctx: c })
    }
    const ans = answer(S.state, text, c)
    const mid = newId('m')
    S.dispatch({ type: 'copilotAsk', id: threadId, mid, text, answer: ans, title: c.insight && c.insight.title })
    setTimeout(() => S.dispatch({ type: 'copilotDone', id: threadId, mid, q: text }), 450 + ans.steps.length * 260)
  }

  // Creates a thread for a ticket or an insight and asks its first question.
  function startThread(id, { ticketId, insight }) {
    if (started.has(id)) return
    started.add(id)
    const ctx = ticketId ? { ticketId } : { insight }
    S.dispatch({ type: 'copilotThread', thread: { id, title: insight ? insight.title : ticketId, ctx, at: Date.now() } })
    copilotAsk(id, insight ? insight.prompt : `How do I resolve ${ticketId}?`, ctx)
  }

  // Page state, set up from the route the first time (links from other pages
  // carry { ticket }, { insight }, { thread } or { tab }).
  const page = () => S.ui('p:copilot', () => {
    const route = S.route
    const u = { tab: route.tab || 'ask', side: 'chats', active: route.thread || (S.state.copilot.threads[0] || {}).id || null }
    if (route.ticket || route.insight) {
      const id = 'th-' + route.key
      startThread(id, { ticketId: route.ticket, insight: route.insight })
      Object.assign(u, { active: id, tab: 'ask' })
    } else if (route.thread) Object.assign(u, { active: route.thread, tab: 'ask' })
    return u
  })
  const newThread = (ctx = {}) => {
    const id = newId('th')
    S.dispatch({ type: 'copilotThread', thread: { id, title: 'New conversation', ctx, at: Date.now() } })
    S.set(page(), { active: id })
    return id
  }
  const askInsight = (ins) => {
    const id = newId('th')
    startThread(id, { insight: ins })
    S.set(page(), { active: id, tab: 'ask' })
  }
  const sortedInsights = (insights) => [...insights].sort((a, b) => toneRank[a.tone] - toneRank[b.tone])

  S.pages.copilot = function Copilot() {
    const state = S.state
    const cfg = state.copilot.config
    const u = page()
    const { tab, active } = u
    const insights = computeInsights(state)

    if (!canUseCopilot(state)) {
      return html`<div class="callout warn">${icon('lock', 16)}<span><b>Copilot is turned off for analysts.</b> Your manager controls this in Copilot settings.</span></div>`
    }

    return html`
      ${S.tabs([
        { id: 'ask', label: 'Ask', icon: 'spark' },
        { id: 'insights', label: 'Insights', icon: 'bolt', count: cfg.insights.enabled ? insights.length : null },
        { id: 'settings', label: 'Configure', icon: 'gear' },
      ], tab, 'cp.tab')}
      ${tab === 'ask' && html`
        <section class="card cp-shell">
          <aside class="cp-side" aria-label="Copilot side panel">
            <div class="cp-side-h">
              ${S.tabs([
                { id: 'chats', label: 'Chats', icon: 'msg' },
                { id: 'templates', label: 'Templates', icon: 'chart' },
              ], u.side, 'cp.side')}
              <button class="btn sm cp-new" data-click="cp.new" title="Start a new conversation">${icon('plus', 14)}New chat</button>
            </div>
            <div class="cp-side-b" id="cp-side-b">
              ${u.side === 'chats' && threadList(active)}
              ${u.side === 'templates' && templatesList()}
            </div>
          </aside>
          <div class="cp-main">
            <div class="cp-main-h">
              <h3>${cfg.name}</h3>
              <span class="pill accent">${icon('spark', 12)}${modelLabel(cfg.model)}</span>
              <span class="spacer"></span>
              ${howItWorks()}
            </div>
            ${copilotChat({ threadId: active, onNeedThread: () => newThread(), scope: 'page' })}
          </div>
        </section>`}
      ${tab === 'insights' && insightsTab(insights)}
      ${tab === 'settings' && configure()}`
  }

  // ---------- Chat ----------
  // scope keys the chat's own state (what's typed), one per place it's shown.
  // onNeedThread: function returning a new thread id, or an action name whose
  // handler creates the thread (the newest thread is then used).
  // onAsk: function (threadId, text), an action name (gets data-thread and data-v), or omitted for S.copilotAsk.
  const chatUi = (scope) => S.ui('p:cp:chat:' + scope, { text: '' })

  function copilotChat({ threadId, onNeedThread, onAsk, scope = 'page' }) {
    const state = S.state
    const cfg = state.copilot.config
    const c = chatUi(scope)
    Object.assign(c, { threadId, onNeedThread, onAsk })
    const thread = threadById(threadId)
    const n = thread ? thread.messages.length : 0
    const busy = !!thread && thread.messages.some((m) => m.pending)
    const ctx = (thread && thread.ctx) || {}
    const ticket = ctx.ticketId && (state.tickets.find((t) => t.id === ctx.ticketId) || state.history.find((h) => h.id === ctx.ticketId))
    const suggestions = ctx.ticketId ? [
      { icon: 'wrench', text: `How do I resolve ${ctx.ticketId}?` },
      { icon: 'edit', text: 'Draft a customer update' },
      { icon: 'alert', text: 'What if the fix doesn\'t work?' },
      { icon: 'search', text: 'Show similar incidents' },
    ] : SUGGESTIONS[state.role]
    const qid = `cp-q-${threadId || 'new'}`

    return html`
      <div class="cp-wrap">
        <div class="cp-log" aria-live="polite" data-cplog="${scope}" data-sig="${n}-${busy}-${threadId}">
          ${!n && html`
            <div class="cp-empty">
              <span class="cp-av lg">${icon('spark', 22)}</span>
              <h3>What are you working on?</h3>
              <p class="muted small">Ask about a ticket, a runbook, the queue or a report. Answers come from published knowledge base pages and live Scope data, with sources.</p>
              <div class="cp-starters">
                ${suggestions.map((s) => html`<button class="cp-starter" data-click="cp.suggest" data-scope="${scope}" data-v="${s.text}">${icon(s.icon, 15)}<span>${s.text}</span></button>`)}
              </div>
              ${scope === 'page' && !ctx.ticketId && html`
                <button class="btn ghost sm cp-follow" data-click="cp.tplFocus">${icon('chart', 14)}Need numbers? Use a prompt template</button>`}
            </div>`}
          ${thread && thread.messages.map((m) => m.role === 'user'
            ? html`<div class="cp-user" data-key="${m.id}">${m.text}</div>`
            : answerView(m, scope, threadId, m.id === thread.messages[thread.messages.length - 1].id))}
        </div>
        <form class="cp-compose" data-submit="cp.send" data-scope="${scope}">
          ${(ticket || ctx.insight) && html`
            <div class="row tight">
              <span class="pill plain">
                ${icon(ticket ? 'clip' : 'bolt', 12)}
                ${ticket ? `${ticket.id} · ${ticket.desc.slice(0, 40)}${ticket.desc.length > 40 ? '…' : ''}` : ctx.insight.title}
                <button type="button" class="pill-x" aria-label="Remove context" data-click="cp.rmCtx" data-v="${threadId}">${icon('x', 11)}</button>
              </span>
            </div>`}
          <div class="cp-input">
            ${scope === 'page' && !ticket && !ctx.insight && ticketPicker(threadId)}
            <label class="sr-only" for="${qid}">Ask Copilot</label>
            <textarea id="${qid}" class="in" rows="1" placeholder="${ticket ? `Ask about ${ticket.id}…` : 'Ask about a ticket, runbook, the queue or a metric…'}"
              data-input="cp.text" data-keydown="cp.key" data-scope="${scope}">${c.text}</textarea>
            <button class="icon-btn cp-send" type="submit" ${attrs({ disabled: !c.text.trim() || busy })} aria-label="Send">${icon('send', 17)}</button>
          </div>
          <span class="muted small cp-meta">${modelLabel(cfg.model)} · searches ${cfg.kbIds.length} knowledge base${cfg.kbIds.length === 1 ? '' : 's'} · proposes, never acts. Prototype: answers are composed in your browser.</span>
        </form>
      </div>`
  }

  // Keep each chat log scrolled to the newest message when messages arrive,
  // an answer finishes or the thread changes.
  S.after(() => {
    document.querySelectorAll('[data-cplog]').forEach((el) => {
      if (el._sig === el.dataset.sig) return
      el._sig = el.dataset.sig
      el.scrollTo({ top: el.scrollHeight })
    })
  })

  function send(scope, q) {
    const c = chatUi(scope)
    const thread = threadById(c.threadId)
    const v = (q != null ? q : c.text).trim()
    const busy = !!thread && thread.messages.some((m) => m.pending)
    if (!v || busy) return
    let id = c.threadId && thread ? c.threadId : null
    if (!id) {
      if (typeof c.onNeedThread === 'function') id = c.onNeedThread()
      else if (c.onNeedThread) { S.call(c.onNeedThread, { dataset: {} }); id = (S.state.copilot.threads[0] || {}).id }
    }
    if (!id) return
    if (typeof c.onAsk === 'function') c.onAsk(id, v)
    else if (c.onAsk) S.call(c.onAsk, { dataset: { thread: id, v } })
    else copilotAsk(id, v)
    S.set(c, { text: '' })
  }

  // Reveals one more tool call every 260 ms while an answer is pending.
  let ticking = false
  function pendingSteps(msg) {
    const steps = msg.answer.steps
    const k = Math.min(steps.length, Math.floor((Date.now() - msg.at) / 260))
    if (!ticking && k < steps.length) { ticking = true; setTimeout(() => { ticking = false; S.render() }, 260) }
    return html`
      <div class="stack" style="gap:6px">
        <span class="row tight muted small"><span class="dot live" style="background:var(--accent)"></span>Working…</span>
        ${steps.slice(0, k + 1).map((s) => html`<span class="cp-step"><span class="mono">${s.tool}</span> <span class="muted">${s.args}</span></span>`)}
      </div>`
  }

  const SRC_ICON = { kb: 'doc', data: 'table', ticket: 'clip', metric: 'chart', queue: 'refresh' }
  function answerView(msg, scope, threadId, last) {
    const done = S.ui('p:cp:done:' + msg.id)
    const open = !!S.ui('p:cp:steps')[msg.id]
    const a = msg.answer
    const ref = (extra) => S.json({ s: scope, t: threadId, m: msg.id, ...extra })
    return html`
      <div class="cp-msg" data-key="${msg.id}">
        <span class="cp-av">${icon('spark', 15)}</span>
        <div class="cp-body">
          ${msg.pending ? pendingSteps(msg) : html`
            ${a.parts.map((p) => part(p))}
            ${a.sources.length > 0 && html`
              <div class="row tight">
                <span class="muted small" style="margin-right:4px">Sources</span>
                ${a.sources.map((s) => html`
                  <button class="cp-src" data-click="cp.source" data-arg="${S.json(s)}" title="${s.sub}">
                    ${icon(SRC_ICON[s.kind], 12)}${s.label}<span class="muted">· ${s.sub}</span>
                  </button>`)}
              </div>`}
            ${a.actions.length > 0 && html`
              <div class="row">
                ${a.actions.map((x, i) => html`
                  <button class="${cls('btn sm', x.primary && 'primary')}" ${attrs({ disabled: !!done[i] })} data-click="cp.run" data-arg="${ref({ i })}">
                    ${icon(done[i] ? 'check' : x.icon, 14)}${done[i] ? 'Sent for approval' : x.label}
                  </button>`)}
              </div>`}
            <details class="cp-steps" ${attrs({ open })}>
              <summary data-click="cp.steps" data-v="${msg.id}">${a.steps.length} tool call${a.steps.length === 1 ? '' : 's'} · ${modelLabel(a.model)} · ${fmtTime(a.at)}</summary>
              <div class="stack" style="gap:4px;margin-top:6px">
                ${a.steps.map((s) => html`
                  <span class="cp-step">
                    ${icon(s.ok ? 'check' : 'alert', 12)}
                    <span><span class="mono">${s.tool}</span>(<span class="muted">${s.args}</span>) → <span ${attrs({ style: s.ok ? null : 'color:var(--crit)' })}>${s.result}</span></span>
                  </span>`)}
              </div>
            </details>
            ${last && a.followups.length > 0 && html`
              <div class="row">${a.followups.map((f) => html`<button class="btn ghost sm cp-follow" data-click="cp.suggest" data-scope="${scope}" data-v="${f}">${icon('arrowR', 13)}${f}</button>`)}</div>`}`}
        </div>
      </div>`
  }

  function part(p) {
    const inline = S.inline
    if (p.t === 'p') return html`<p>${inline(p.text)}</p>`
    if (p.t === 'h') return html`<h4>${p.text}</h4>`
    if (p.t === 'ul') return html`<ul>${p.items.map((x) => html`<li>${inline(x)}</li>`)}</ul>`
    if (p.t === 'ol') return html`<ol>${p.items.map((x) => html`<li>${inline(x)}</li>`)}</ol>`
    if (p.t === 'note') return html`<div class="callout small ${p.tone}">${icon(p.tone === 'crit' ? 'alert' : p.tone === 'good' ? 'check' : 'info', 15)}<span>${inline(p.text)}</span></div>`
    if (p.t === 'quote') return html`<div class="cp-quote"><span class="cp-quote-h">${icon('doc', 12)}${p.title} › ${p.heading}</span>${S.docText(p.text)}</div>`
    if (p.t === 'draft') return html`<pre class="cp-draft">${p.text}</pre>`
    if (p.t === 'table') return html`
      <div class="tbl-wrap cp-table">
        <table class="tbl"><thead><tr>${p.head.map((h) => html`<th>${h}</th>`)}</tr></thead>
          <tbody>${p.rows.map((r) => html`<tr>${r.map((c, j) => html`<td class="${j === 0 ? 'nowrap' : ''}">${/^(INC|[A-Z]{3}-[A-Z]{2,4}-\d{2}$)/.test(c) ? html`<span class="mono">${c}</span>` : c}</td>`)}</tr>`)}</tbody>
        </table>
      </div>`
    return null
  }

  function howItWorks() {
    const cfg = S.state.copilot.config
    return S.infoTip('cp-how', 'How Copilot answers', html`
      <span>Copilot looks things up; it isn't trained on your data.</span>
      <ol style="margin:0;padding-left:18px" class="stack">
        <li><b>Scope gathers the context:</b> your role, the ticket you attached, and the settings on the Configure tab.</li>
        <li><b>The model</b> (${modelLabel(cfg.model)}, through the approved AI gateway) reads the question and decides which tools to call: <span class="mono">search_knowledge_base</span>, <span class="mono">query_data</span>, <span class="mono">get_queue</span>, <span class="mono">get_metrics</span>.</li>
        <li><b>Every tool call goes through Scope's API</b> with your permissions. Copilot never writes to ServiceNow. Fixes go to a manager and drafts are copied by you.</li>
        <li><b>Search is retrieval:</b> when a page is published it's split into chunks and indexed. Only the matching passages from linked, published pages reach the model.</li>
        <li><b>Before the answer is shown,</b> Scope applies the guardrails: sources attached, failed lookups reported as failures, numbers taken from live tools.</li>
      </ol>
      <div class="callout small">${icon('shield', 16)}<span><b>Prototype:</b> answers are composed in your browser by rules that follow the same steps. No data leaves the machine.</span></div>`)
  }

  // Attach a ticket from the composer. Once attached it shows as the context
  // pill above the input instead.
  function ticketPicker(threadId) {
    const state = S.state
    const me = S.currentUser(state)
    const open = state.tickets.filter((t) => t.state !== 'Resolved')
    const mine = open.filter((t) => t.assignedTo === me.id)
    const others = open.filter((t) => t.assignedTo !== me.id)
    const opt = (x) => html`<option value="${x.id}">${x.id} · ${x.priority} · ${x.desc.slice(0, 38)}</option>`
    return html`
      <label class="cp-attach" title="Attach a ticket: Copilot reads its SLA, history and runbook for every question">
        ${icon('clip', 16)}<span class="cp-attach-t">Ticket</span>
        <select id="cp-ctx" data-change="cp.ctx" data-v="${threadId || ''}" aria-label="Attach a ticket to this conversation">
          <option value="" selected>Attach a ticket</option>
          ${mine.length > 0 && html`<optgroup label="My work queue">${mine.map(opt)}</optgroup>`}
          ${state.role === 'lead' && html`<optgroup label="Team queue">${others.map(opt)}</optgroup>`}
        </select>
      </label>`
  }

  function threadList(active) {
    const threads = S.state.copilot.threads
    return html`
      <div class="stack" style="gap:2px">
          ${!threads.length && html`<span class="muted small cp-side-empty">Your conversations appear here.</span>`}
          ${threads.slice(0, 8).map((t) => html`
            <button class="cp-thread" data-key="${t.id}" ${attrs({ 'aria-current': t.id === active ? 'true' : null })} data-click="cp.pick" data-v="${t.id}">
              ${icon(t.ctx && t.ctx.ticketId ? 'clip' : t.ctx && t.ctx.insight ? 'bolt' : 'spark', 14)}
              <span class="stack" style="gap:0;min-width:0;flex:1">
                <span class="cp-thread-t">${t.title}</span>
                <span class="muted small">${t.messages.filter((m) => m.role === 'user').length} questions · ${fmtTime(t.at)}</span>
              </span>
            </button>`)}
      </div>`
  }

  // ---------- Prompt templates ----------
  // Template Search: fill-in-the-blank questions on the fixed query templates
  // (TEMPLATES in analytics.js). Each one composes plain words that parseQuery
  // reads back, so the same choices always give the same numbers.
  const T_WINDOWS = ['this week', 'last 2 weeks', 'last 30 days', 'this quarter']
  const T_PRIOS = ['all priorities', 'P1', 'P2', 'P3', 'P4']
  const T_MEASURES = ['volume', 'MTTR', 'EZE MTTR', 'lost time', 'SLA attainment', 'FCR', 'transfer rate']
  const T_RANK_DIMS = ['root causes', 'business apps', 'resolution codes', 'assignment groups', 'analysts', 'channels', 'product groups']
  const T_DIMS = ['root cause', 'business app', 'resolution code', 'assignment group', 'analyst', 'channel', 'product group', 'priority']
  const PROMPT_TEMPLATES = [
    { id: 'rank', code: 'T-02', name: 'Top ranking', init: { n: 5, dim: 'root causes', measure: 'volume', window: 'this quarter' },
      parts: ['Top ', { k: 'n', label: 'How many' }, ' ', { k: 'dim', label: 'Ranked by', opts: T_RANK_DIMS }, ' by ', { k: 'measure', label: 'Measure', opts: T_MEASURES }, ' ', { k: 'window', label: 'Window', opts: T_WINDOWS }] },
    { id: 'trend', code: 'T-01', name: 'Trend over time', init: { measure: 'SLA attainment', prio: 'P1', window: 'this quarter' },
      parts: [{ k: 'measure', label: 'Measure', opts: T_MEASURES }, ' trend for ', { k: 'prio', label: 'Priority', opts: T_PRIOS }, ' ', { k: 'window', label: 'Window', opts: T_WINDOWS }] },
    { id: 'breakdown', code: 'T-03', name: 'Breakdown', init: { measure: 'FCR', dim: 'channel', window: 'last 30 days' },
      parts: [{ k: 'measure', label: 'Measure', opts: T_MEASURES }, ' by ', { k: 'dim', label: 'Broken down by', opts: T_DIMS }, ' ', { k: 'window', label: 'Window', opts: T_WINDOWS }] },
  ]
  // Not page-local, so the values someone picked are still there next visit.
  const tplUi = () => S.ui('cp:tpl', () => Object.fromEntries(PROMPT_TEMPLATES.map((t) => [t.id, { ...t.init }])))
  const tplById = (id) => PROMPT_TEMPLATES.find((t) => t.id === id)
  const topN = (v) => Math.max(1, Math.min(20, parseInt(v, 10) || 5))
  const composeTpl = (t) => {
    const v = tplUi()[t.id]
    return t.parts.map((p) => (typeof p === 'string' ? p : p.k === 'n' ? topN(v.n) : v[p.k])).join('')
  }

  function templatesList() {
    const u = tplUi()
    const slot = (t, p) => {
      if (typeof p === 'string') return p
      const v = u[t.id][p.k]
      const a = { 'aria-label': p.label, 'data-t': t.id, 'data-k': p.k }
      if (!p.opts) return html`<input class="in cp-tpl-n" type="number" min="1" max="20" value="${v}" ${attrs(a)} data-input="cp.tplSet">`
      return html`<select class="in sm" ${attrs(a)} data-change="cp.tplSet">${p.opts.map((o) => html`<option ${attrs({ selected: o === v })}>${o}</option>`)}</select>`
    }
    return html`
      <div class="stack" id="cp-templates">
          <p class="muted small" style="margin:0">Change the values, then <b>Ask</b>. Each template is a fixed query, so the same choices always give the same numbers. <b>Edit in chat</b> lets you reword it first.</p>
          ${PROMPT_TEMPLATES.map((t) => html`
            <div class="cp-tpl" data-key="${t.id}">
              <div class="row tight"><span class="code-chip">${t.code}</span><span class="small ink2">${t.name}</span></div>
              <p class="cp-tpl-q">${t.parts.map((p) => slot(t, p))}</p>
              <div class="row tight">
                <button class="btn primary sm" data-click="cp.tplAsk" data-v="${t.id}">${icon('send', 13)}Ask</button>
                <button class="btn ghost sm" data-click="cp.tplEdit" data-v="${t.id}">${icon('edit', 13)}Edit in chat</button>
              </div>
            </div>`)}
      </div>`
  }

  // ---------- Insights ----------
  const TONE_LABEL = { crit: 'Act now', warn: 'Watch', good: 'On track', accent: 'Info' }

  function insightCard(ins, { onAsk } = {}) {
    return html`
      <div class="ins" data-key="${ins.id}">
        <div class="row" style="flex-wrap:nowrap;align-items:flex-start">
          <span class="ins-ic ${ins.tone}">${icon(ins.icon, 16)}</span>
          <span class="stack" style="gap:2px;flex:1;min-width:0">
            <span class="row tight"><span class="pill ${ins.tone === 'accent' ? 'accent' : ins.tone}">${TONE_LABEL[ins.tone]}</span><span class="muted small">${ins.source}</span></span>
            <h4>${ins.title}</h4>
          </span>
          <span class="ins-stat num" title="${ins.statLabel}">${ins.stat}<small>${ins.statLabel}</small></span>
        </div>
        <p class="small ink2">${ins.detail}</p>
        ${onAsk && html`
          <div class="ins-foot">
            <button class="btn sm" data-click="${onAsk}" data-v="${ins.id}">${icon('spark', 14)}Ask Copilot</button>
            <span class="muted small ins-q">“${ins.prompt}”</span>
          </div>`}
      </div>`
  }

  function insightsTab(insights) {
    const state = S.state
    const cfg = state.copilot.config
    const misses = state.copilot.misses
    if (!cfg.insights.enabled) return html`<div class="callout">${icon('info', 16)}<span>Automated insights are turned off. A manager can turn them on in the Configure tab.</span></div>`
    return html`
      <section class="card">
        <div class="card-h"><h3>Automated insights</h3><span class="muted small">from ticket history, the live queue and the knowledge base · refreshed every sync</span></div>
        <div class="card-b">
          <div class="ins-grid">${sortedInsights(insights).map((ins) => insightCard(ins, { onAsk: 'cp.askInsight' }))}</div>
          ${!insights.length && html`<div class="empty">No insights right now.</div>`}
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h3>Questions Copilot couldn't answer</h3><span class="muted small">nothing in the knowledge base matched</span></div>
        <div class="card-b">
          ${!misses.length && html`<div class="muted small">None yet. When a search finds nothing, the question lands here so someone can write the missing page.</div>`}
          ${misses.map((m) => html`
            <div class="list-row small" data-key="${m.q}">
              ${icon('search', 14)}
              <span style="flex:1;min-width:0">${m.q}</span>
              <span class="muted nowrap">${fmtDateTime(m.at)}</span>
              <button class="btn sm" data-click="cp.writePage" data-v="${m.q}">${icon('plus', 13)}Write a page</button>
              <button class="btn ghost sm" data-click="cp.missClear" data-v="${m.q}">Dismiss</button>
            </div>`)}
        </div>
      </section>`
  }

  // Reports: the insight strip, with "Ask Copilot" opening a side panel.
  function insightsPanel() {
    const state = S.state
    const u = S.ui('p:cp:panel', { open: null })
    const cfg = state.copilot.config
    if (!cfg.insights.enabled) return ''
    const insights = sortedInsights(computeInsights(state))
    const can = canUseCopilot(state)
    return html`
      <section class="card">
        <div class="card-h">
          <h3>Insights</h3>
          <span class="muted small">generated from your data · ask Copilot to explain any of them</span>
          <span class="spacer"></span>
          ${state.role === 'lead' && html`<button class="btn ghost sm" data-click="cp.go" data-v="copilot" data-tab="settings">${icon('gear', 14)}Configure</button>`}
        </div>
        <div class="card-b"><div class="ins-grid">${insights.map((ins) => insightCard(ins, { onAsk: can ? 'cp.panelAsk' : null }))}</div></div>
        ${u.open && copilotDrawer({ insight: u.open, onClose: 'cp.panelClose' })}
      </section>`
  }

  // A side panel with its own conversation about an insight or a ticket. The
  // thread starts the first time it's shown; closing it ends this panel.
  function copilotDrawer({ insight, ticketId, onClose }) {
    const d = S.ui('p:cp:drawer', {})
    const sig = insight ? 'i:' + insight.id : 't:' + ticketId
    if (d.sig !== sig || !d.id) { d.sig = sig; d.id = newId('th') }
    d.onClose = onClose
    const id = d.id
    startThread(id, { insight, ticketId })
    S.drawer({
      className: 'copilot-drawer', onClose: 'cp.drawerClose',
      title: html`<span class="eyebrow row tight">${icon('spark', 14)}Copilot</span><h2 class="drawer-title">${insight ? insight.title : ticketId}</h2>`,
      actions: html`<button class="btn sm" data-click="cp.go" data-v="copilot" data-thread="${id}">Open in Copilot</button>`,
      body: copilotChat({ threadId: id, onNeedThread: () => id, scope: 'drawer' }),
    })
    return ''
  }

  // ---------- Configure ----------
  function configure() {
    const state = S.state
    const cfg = state.copilot.config
    const lead = state.role === 'lead'
    const model = MODELS.find((m) => m.id === cfg.model)
    const check = (on, action, v, extra = {}) => html`<input type="checkbox" ${attrs({ checked: !!on, ...extra })} data-change="${action}" data-v="${v}">`
    return html`
      ${!lead && html`<div class="callout">${icon('lock', 16)}<span>Only managers can change Copilot settings. You can see how it's set up.</span></div>`}
      ${lead && html`<div class="callout small">${icon('check', 16)}<span>Changes save as you make them and apply to the next answer.</span></div>`}
      <fieldset class="grid g-2 cfg" ${attrs({ disabled: !lead })}>
        <div class="card">
          <div class="card-h"><h3>Assistant</h3></div>
          <div class="card-b stack lg">
            <label class="field"><span>Name</span><input id="cfg-name" class="in" value="${cfg.name}" data-input="cp.cfg" data-f="name"></label>
            <label class="field"><span>Model <span class="hint">(through the approved AI gateway)</span></span>
              <select id="cfg-model" class="in" data-change="cp.cfg" data-f="model">${MODELS.map((m) => html`<option value="${m.id}" ${attrs({ selected: m.id === cfg.model })}>${m.label}</option>`)}</select>
              <span class="muted small">${model && model.note}</span>
            </label>
            <label class="field"><span>Instructions <span class="hint">(followed on every answer)</span></span>
              <textarea id="cfg-instr" class="in" rows="5" data-input="cp.cfg" data-f="instructions">${cfg.instructions}</textarea>
            </label>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Knowledge</h3><span class="spacer"></span><button type="button" class="btn ghost sm" data-click="cp.go" data-v="kb">Open knowledge base</button></div>
          <div class="card-b stack lg">
            <span class="small ink2">Copilot searches every linked knowledge base at once. It reads published, indexed pages only, and data tables live.</span>
            ${state.kb.kbs.map((k) => {
              const pages = state.kb.pages.filter((p) => p.kbId === k.id)
              const on = cfg.kbIds.includes(k.id)
              const drafts = pages.filter((p) => !p.live).length
              return html`
                <label class="check" data-key="${k.id}">
                  ${check(on, 'cp.kbLink', k.id)}
                  <span class="stack" style="gap:0"><b>${k.name}</b><span class="muted small">${pages.filter((p) => p.live).length} published pages · ${pages.filter((p) => p.data).length} data tables · ${drafts} draft${drafts === 1 ? '' : 's'} not visible</span></span>
                </label>`
            })}
            ${!cfg.kbIds.length && html`<div class="callout warn small">${icon('alert', 15)}No knowledge base is linked. Copilot will report every search as a failed lookup.</div>`}
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Tools</h3><span class="muted small">what Copilot may look up or propose</span></div>
          <div class="card-b stack lg">
            ${TOOLS.map((t) => html`
              <label class="check">
                ${check(cfg.tools[t.id], 'cp.flip', t.id, { 'data-group': 'tools' })}
                <span class="stack" style="gap:0"><b>${t.label} <span class="mono muted">${t.fn}</span></b><span class="muted small">${t.desc}</span></span>
              </label>`)}
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Guardrails</h3></div>
          <div class="card-b stack lg">
            ${GUARDRAILS.map((g) => html`
              <label class="check">
                ${check(g.locked || cfg.guardrails[g.id], 'cp.flip', g.id, { 'data-group': 'guardrails', disabled: !!g.locked })}
                <span class="stack" style="gap:0"><b>${g.label}</b><span class="muted small">${g.desc}</span></span>
              </label>`)}
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Automated insights</h3></div>
          <div class="card-b stack lg">
            <label class="check">${check(cfg.insights.enabled, 'cp.insightsOn', '')}
              <span class="stack" style="gap:0"><b>Generate insights</b><span class="muted small">Shown on Reports › Performance and Copilot › Insights. Recomputed on every ServiceNow sync.</span></span>
            </label>
            <div class="form-grid">
              ${INSIGHT_TYPES.map((t) => html`
                <label class="check small">${check(cfg.insights.types[t.id], 'cp.insightType', t.id, { disabled: !cfg.insights.enabled })}${t.label}</label>`)}
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Access</h3></div>
          <div class="card-b stack lg">
            <label class="check">${check(cfg.access.analysts, 'cp.access', '')}
              <span class="stack" style="gap:0"><b>Analysts can use Copilot</b><span class="muted small">Managers always can. Only managers change these settings.</span></span>
            </label>
            <span class="small ink2">Copilot sees what the person asking can see: analysts get their own queue, managers the whole team.</span>
          </div>
        </div>
      </fieldset>`
  }

  // ---------- Handlers ----------
  const cfg = () => S.state.copilot.config
  const setCfg = (patch) => S.dispatch({ type: 'copilotConfig', patch })
  const insightById = (id) => computeInsights(S.state).find((x) => x.id === id)

  S.on({
    'cp.tab': (el) => S.set(page(), { tab: el.dataset.v }),
    'cp.new': () => { newThread(); S.set(page(), { side: 'chats' }) },
    'cp.side': (el) => S.set(page(), { side: el.dataset.v }),
    'cp.pick': (el) => S.set(page(), { active: el.dataset.v }),
    'cp.askInsight': (el) => { const ins = insightById(el.dataset.v); if (ins) askInsight(ins) },
    'cp.ctx': (el) => {
      const tid = threadById(el.dataset.v) ? el.dataset.v : newThread()
      S.dispatch({ type: 'copilotCtx', id: tid, ctx: el.value ? { ticketId: el.value } : {} })
    },
    // Chat
    'cp.text': (el) => { const c = chatUi(el.dataset.scope); const was = !!c.text.trim(); c.text = el.value; if (was !== !!el.value.trim()) S.render() },
    'cp.key': (el, ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); chatUi(el.dataset.scope).text = el.value; send(el.dataset.scope) } },
    'cp.send': (el) => send(el.dataset.scope),
    'cp.suggest': (el) => send(el.dataset.scope, el.dataset.v),
    // Prompt templates
    'cp.tplSet': (el) => { const u = tplUi(); u[el.dataset.t] = { ...u[el.dataset.t], [el.dataset.k]: el.value }; if (el.tagName === 'SELECT') S.render() },
    'cp.tplAsk': (el) => send('page', composeTpl(tplById(el.dataset.v))),
    'cp.tplEdit': (el) => {
      const text = composeTpl(tplById(el.dataset.v))
      S.set(chatUi('page'), { text })
      // The morph leaves a textarea's live value alone, so set it here.
      const box = document.querySelector('.cp-compose[data-scope="page"] textarea')
      if (box) { box.value = text; box.focus(); box.setSelectionRange(text.length, text.length) }
    },
    'cp.tplFocus': () => {
      S.set(page(), { side: 'templates' })
      requestAnimationFrame(() => requestAnimationFrame(() => {
      const first = document.querySelector('#cp-templates .cp-tpl-q input, #cp-templates .cp-tpl-q select')
      if (first) { first.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); first.focus({ preventScroll: true }) }
      }))
    },
    'cp.rmCtx': (el) => S.dispatch({ type: 'copilotCtx', id: el.dataset.v, ctx: {} }),
    'cp.steps': (el, ev) => { ev.preventDefault(); const s = S.ui('p:cp:steps'); S.set(s, { [el.dataset.v]: !s[el.dataset.v] }) },
    'cp.source': (el) => {
      const s = S.arg(el)
      if (s.kind === 'kb' || s.kind === 'data') nav('kb', { page: s.id })
      else if (s.kind === 'ticket') S.state.tickets.some((t) => t.id === s.id) ? nav('home', { ticket: s.id }) : nav('explorer')
      else if (s.kind === 'metric') nav('reports')
      else nav('home')
    },
    'cp.run': (el) => {
      const r = S.arg(el)
      const t = threadById(r.t)
      const m = t && t.messages.find((x) => x.id === r.m)
      const x = m && m.answer.actions[r.i]
      if (!x) return
      if (x.kind === 'nav') nav(x.page, x.opts || {})
      else if (x.kind === 'copy') S.copyText(x.text)
      else if (x.kind === 'ask') send(r.s, x.text)
      else { S.dispatch(x.action); S.set(S.ui('p:cp:done:' + m.id), { [r.i]: true }) }
    },
    // Insights
    'cp.writePage': (el) => S.nav('kb', { create: el.dataset.v }),
    'cp.missClear': (el) => S.dispatch({ type: 'copilotMissClear', q: el.dataset.v }),
    'cp.panelAsk': (el) => { const ins = insightById(el.dataset.v); if (ins) S.set(S.ui('p:cp:panel'), { open: ins }) },
    'cp.panelClose': () => S.set(S.ui('p:cp:panel'), { open: null }),
    'cp.drawerClose': (el, ev) => {
      const d = S.ui('p:cp:drawer')
      const close = d.onClose
      S.resetUi('p:cp:drawer')
      S.resetUi('p:cp:chat:drawer')
      if (close) S.call(close, el, ev)
      else S.render()
    },
    'cp.go': (el) => S.nav(el.dataset.v, el.dataset.thread ? { thread: el.dataset.thread } : el.dataset.tab ? { tab: el.dataset.tab } : {}),
    // Configure
    'cp.cfg': (el) => setCfg({ [el.dataset.f]: el.value }),
    'cp.kbLink': (el) => { const c = cfg(); const k = el.dataset.v; setCfg({ kbIds: c.kbIds.includes(k) ? c.kbIds.filter((x) => x !== k) : [...c.kbIds, k] }) },
    'cp.flip': (el) => { const g = el.dataset.group; const c = cfg(); setCfg({ [g]: { ...c[g], [el.dataset.v]: !c[g][el.dataset.v] } }) },
    'cp.insightsOn': () => { const c = cfg(); setCfg({ insights: { ...c.insights, enabled: !c.insights.enabled } }) },
    'cp.insightType': (el) => { const c = cfg(); const id = el.dataset.v; setCfg({ insights: { ...c.insights, types: { ...c.insights.types, [id]: !c.insights.types[id] } } }) },
    'cp.access': () => { const c = cfg(); setCfg({ access: { ...c.access, analysts: !c.access.analysts } }) },
  })

  Object.assign(S, { canUseCopilot, copilotAsk, copilotChat, insightCard, insightsPanel, copilotDrawer })
})()
