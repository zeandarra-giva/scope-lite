// Suggestions: ideas, bugs and workarounds filed by the team.
//
// Storage is an append-only list of events ({ type: 'create' | 'vote' | 'status' |
// 'comment', … }). With run.bat the local server keeps them in
// data/suggestions.jsonl, so everyone on the same server sees the same list.
// Opened straight from index.html (no server), they stay in this browser and
// can be exported, then imported on the server.
;(function () {
  const { html, cls, attrs, icon, seg, storage, uid, fmtDate, fmtTime, BUSINESS_APPS } = S

  const KINDS = [
    { id: 'idea', label: 'Idea', icon: 'bulb', tone: 'blue', help: 'Something Scope should do or do better', title: 'e.g. Let me filter the queue by business app', details: 'What would it help you do? Who needs it?' },
    { id: 'bug', label: 'Bug', icon: 'bug', tone: 'red', help: 'Something that looks or works wrong', title: 'e.g. Rebalance button does nothing on the analyst view', details: 'What did you do, what happened, and what did you expect?' },
    { id: 'workaround', label: 'Workaround', icon: 'wrench', tone: 'green', help: 'A fix or trick that got a ticket resolved', title: 'e.g. VPN drops after sleep: reset the adapter first', details: 'Steps that worked, in order. Mention anything to avoid.' },
  ]
  const kindOf = (id) => KINDS.find((k) => k.id === id) || KINDS[0]
  const STATUSES = ['New', 'Reviewing', 'Planned', 'Done', "Won't do"]
  const OPEN = new Set(['New', 'Reviewing', 'Planned'])
  const STATUS_TONE = { New: 'accent', Reviewing: 'warn', Planned: 'accent', Done: 'good', "Won't do": '' }

  const LOCAL_KEY = 'scope-lite-suggestions'
  const NAME_KEY = 'scope-lite-name'
  const VOTER_KEY = 'scope-lite-voter'
  const voter = storage.get(VOTER_KEY) || (() => { const v = uid('v'); storage.set(VOTER_KEY, v); return v })()

  // ---------- Store ----------
  const sugg = {
    online: null, // null = checking, true = shared server, false = this browser only
    events: [],
    items: [],
    loadedAt: null,
    error: null,
    openCount: () => sugg.items.filter((x) => OPEN.has(x.status)).length,
  }
  S.sugg = sugg

  // Fold the event log into the current list. Duplicate events (same eid) count once.
  function fold(events) {
    const seen = new Set()
    const byId = new Map()
    for (const { at, e } of events) {
      if (!e || seen.has(e.eid)) continue
      seen.add(e.eid)
      if (e.type === 'create') {
        byId.set(e.id, { id: e.id, kind: e.kind, title: e.title, details: e.details || '', page: e.page || '', app: e.app || '', ref: e.ref || '', by: e.by || 'Anonymous', at, status: 'New', votes: new Set(), comments: [], history: [], updatedAt: at })
        continue
      }
      const it = byId.get(e.id)
      if (!it) continue
      it.updatedAt = at
      if (e.type === 'vote') e.on ? it.votes.add(e.voter) : it.votes.delete(e.voter)
      else if (e.type === 'status') { it.history.push({ from: it.status, to: e.status, by: e.by, at }); it.status = e.status }
      else if (e.type === 'comment') it.comments.push({ by: e.by || 'Anonymous', text: e.text, at })
    }
    return [...byId.values()]
  }
  const readLocal = () => { try { return JSON.parse(storage.get(LOCAL_KEY, '[]')) } catch { return [] } }
  const setEvents = (events) => {
    sugg.events = events.slice().sort((a, b) => a.at - b.at)
    sugg.items = fold(sugg.events)
    sugg.loadedAt = Date.now()
  }

  async function load() {
    if (location.protocol === 'file:') { sugg.online = false; setEvents(readLocal()); S.render(); return }
    try {
      const r = await fetch('api/events', { cache: 'no-store' })
      if (!r.ok) throw new Error(`server answered ${r.status}`)
      setEvents(await r.json())
      sugg.online = true
      sugg.error = null
    } catch (err) {
      // Server stopped or unreachable: keep what we have and fall back to this browser.
      if (sugg.online) sugg.error = 'Lost the connection to the Scope Lite server. Check that its window is still open.'
      else { sugg.online = false; setEvents(readLocal()) }
    }
    S.render()
  }

  async function send(e) {
    const event = { ...e, eid: uid('e'), clientAt: Date.now() }
    if (sugg.online) {
      try {
        const r = await fetch('api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) })
        if (!r.ok) throw new Error((await r.text()) || `server answered ${r.status}`)
        await load()
        return true
      } catch (err) {
        S.dispatch({ type: 'toast', text: `Couldn't save: ${err.message}` })
        return false
      }
    }
    const local = readLocal()
    local.push({ at: Date.now(), e: event })
    storage.set(LOCAL_KEY, JSON.stringify(local))
    setEvents(local)
    S.render()
    return true
  }

  // Shared list: pick up other people's changes every 15 seconds and on focus.
  setInterval(() => { if (sugg.online && !document.hidden) load() }, 15e3)
  window.addEventListener('focus', () => { if (sugg.online) load() })
  load()

  // ---------- Export / import ----------
  function download(name, text, type) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type }))
    a.download = name
    document.body.appendChild(a)
    a.click()
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 500)
  }
  const stamp = () => new Date().toISOString().slice(0, 10)
  const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`
  function exportCsv() {
    const head = ['ID', 'Type', 'Title', 'Details', 'Page', 'Business app', 'Ticket / code', 'Filed by', 'Filed on', 'Status', 'Votes', 'Comments']
    const rows = sugg.items.map((x) => [x.id, kindOf(x.kind).label, x.title, x.details, pageLabel(x.page), x.app, x.ref, x.by, new Date(x.at).toLocaleString(), x.status, x.votes.size, x.comments.map((c) => `${c.by}: ${c.text}`).join(' | ')])
    // BOM so Excel opens accented names correctly.
    download(`scope-suggestions-${stamp()}.csv`, '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'), 'text/csv')
  }
  const exportJson = () => download(`scope-suggestions-${stamp()}.json`, JSON.stringify(sugg.events, null, 1), 'application/json')
  async function importJson(file) {
    let events
    try { events = JSON.parse(await file.text()) } catch { S.dispatch({ type: 'toast', text: "That file isn't a suggestions export (.json)" }); return }
    if (!Array.isArray(events)) { S.dispatch({ type: 'toast', text: "That file isn't a suggestions export (.json)" }); return }
    const have = new Set(sugg.events.map((x) => x.e && x.e.eid))
    const fresh = events.filter((x) => x && x.e && x.e.eid && !have.has(x.e.eid))
    if (sugg.online) {
      for (const x of fresh) {
        await fetch('api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...x.e, importedAt: x.at }) })
      }
      await load()
    } else {
      const local = readLocal().concat(fresh)
      storage.set(LOCAL_KEY, JSON.stringify(local))
      setEvents(local)
    }
    S.dispatch({ type: 'toast', text: fresh.length ? `Imported ${fresh.length} change${fresh.length > 1 ? 's' : ''}` : 'Nothing new in that file' })
  }

  // ---------- Helpers ----------
  const pageLabel = (id) => (S.PAGES.find((p) => p.id === id) || {}).label || (id === 'general' ? 'General' : id || 'General')
  const myName = () => storage.get(NAME_KEY, '')
  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60e3)
    if (m < 1) return 'just now'
    if (m < 60) return `${m} min ago`
    const h = Math.round(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.round(h / 24)
    return d < 7 ? `${d}d ago` : fmtDate(ts)
  }
  const kindPill = (k) => { const x = kindOf(k); return html`<span class="tag ${x.tone} sugg-kind">${icon(x.icon, 13)}${x.label}</span>` }
  const statusPill = (s) => html`<span class="${cls('pill', STATUS_TONE[s])}">${s}</span>`

  // ---------- Quick "Suggest" modal (open from anywhere) ----------
  const form = () => S.ui('suggForm', { open: false })
  function openForm(kind) {
    const page = S.route && S.route.page !== 'suggestions' ? S.route.page : 'general'
    S.set(form(), { open: true, kind: kind || '', title: '', details: '', page, app: '', ref: '', name: myName(), tried: false })
  }
  S.openSuggest = openForm

  S.suggestModal = function suggestModal() {
    const f = form()
    if (!f.open) return ''
    const k = f.kind ? kindOf(f.kind) : null
    const missing = !f.kind ? 'Pick what kind of suggestion this is.' : !f.title.trim() ? 'Give it a short title.' : null
    S.modal({
      title: 'Make a suggestion',
      sub: sugg.online ? (S.isManager(S.state) ? 'Everyone on this Scope Lite server will see it.' : 'Your manager will see it on the Suggestions board.')
        : S.isManager(S.state) ? 'Saved in this browser. Export it from the Suggestions page to share.' : 'The Scope Lite server isn\'t running, so this is saved in this browser only.',
      onClose: 'sugg.close',
      body: html`<form class="stack sugg-form" style="gap:14px" data-submit="sugg.submit" id="sugg-form">
        <div class="stack" style="gap:6px">
          <span class="field-label">1. What is it?</span>
          <div class="sugg-kinds" role="radiogroup" aria-label="Kind of suggestion">
            ${KINDS.map((x) => html`<button type="button" role="radio" aria-checked="${f.kind === x.id}" class="${cls('sugg-kind-btn', x.tone, f.kind === x.id && 'on')}" data-click="sugg.kind" data-v="${x.id}">
              <span class="sugg-kind-ic">${icon(x.icon, 20)}</span>
              <b>${x.label}</b>
              <span class="small muted">${x.help}</span>
            </button>`)}
          </div>
        </div>
        <label class="field"><span>2. Short title</span>
          <input class="in" name="title" maxlength="140" autocomplete="off" value="${f.title}" placeholder="${k ? k.title : 'One line that says what it is'}" data-input="sugg.field" ${attrs({ 'data-autofocus': f.kind ? true : null })}></label>
        <label class="field"><span>3. Details <span class="hint">optional</span></span>
          <textarea class="in" name="details" rows="4" maxlength="4000" placeholder="${k ? k.details : 'Anything that helps someone act on it'}" data-input="sugg.field" data-keydown="sugg.keys">${f.details}</textarea></label>
        <div class="form-grid sugg-meta">
          <label class="field"><span>Where in Scope</span>
            <select class="in" name="page" data-change="sugg.field">
              <option value="general" ${attrs({ selected: f.page === 'general' })}>General / everywhere</option>
              ${S.PAGES.filter((p) => p.id !== 'suggestions').map((p) => html`<option value="${p.id}" ${attrs({ selected: f.page === p.id })}>${p.label}</option>`)}
            </select></label>
          ${f.kind === 'workaround' && html`<label class="field"><span>Business app <span class="hint">optional</span></span>
            <select class="in" name="app" data-change="sugg.field">
              <option value="" ${attrs({ selected: !f.app })}>Not app-specific</option>
              ${BUSINESS_APPS.map((a) => html`<option ${attrs({ selected: f.app === a })}>${a}</option>`)}
            </select></label>
          <label class="field"><span>Ticket or resolution code <span class="hint">optional</span></span>
            <input class="in mono" name="ref" maxlength="40" value="${f.ref}" placeholder="e.g. INC0012345 or NET-VPN-01" data-input="sugg.field"></label>`}
          <label class="field"><span>Your name <span class="hint">remembered on this computer</span></span>
            <input class="in" name="name" maxlength="60" value="${f.name}" placeholder="Leave empty to post as Anonymous" data-input="sugg.field" autocomplete="name"></label>
        </div>
        ${f.tried && missing && html`<div class="callout warn" role="alert">${icon('alert', 16)}<span>${missing}</span></div>`}
      </form>`,
      footer: html`<span class="small muted">Tip: <span class="kbd">Ctrl</span> + <span class="kbd">Enter</span> sends</span><span class="spacer"></span>
        <button class="btn ghost" data-click="sugg.close">Cancel</button>
        <button class="btn primary" type="submit" form="sugg-form" ${attrs({ disabled: f.sending })}>${icon('send', 15)}${f.sending ? 'Sending…' : 'Send suggestion'}</button>`,
    })
    return ''
  }

  async function submit() {
    const f = form()
    if (!f.kind || !f.title.trim()) { S.set(f, { tried: true }); return }
    storage.set(NAME_KEY, f.name.trim())
    S.set(f, { sending: true })
    const ok = await send({ type: 'create', id: uid('s'), kind: f.kind, title: f.title.trim(), details: f.details.trim(), page: f.page, app: f.kind === 'workaround' ? f.app : '', ref: f.kind === 'workaround' ? f.ref.trim() : '', by: f.name.trim() || 'Anonymous' })
    if (!ok) { S.set(f, { sending: false }); return }
    S.set(f, { open: false, sending: false })
    S.dispatch({ type: 'toast', text: 'Thanks! Your suggestion is on the board' })
  }

  // ---------- Dashboard page ----------
  S.pages.suggestions = function suggestionsPage() {
    const u = S.ui('p:sugg', { q: '', kind: 'all', status: 'open', page: 'all', sort: 'top', sel: null, comment: '' })
    const all = sugg.items
    const q = u.q.trim().toLowerCase()
    const list = all
      .filter((x) => u.kind === 'all' || x.kind === u.kind)
      .filter((x) => u.status === 'all' || (u.status === 'open' ? OPEN.has(x.status) : x.status === u.status))
      .filter((x) => u.page === 'all' || x.page === u.page)
      .filter((x) => !q || [x.title, x.details, x.by, x.app, x.ref, x.id].join(' ').toLowerCase().includes(q))
      .sort(u.sort === 'new' ? (a, b) => b.at - a.at : u.sort === 'active' ? (a, b) => b.updatedAt - a.updatedAt : (a, b) => b.votes.size - a.votes.size || b.at - a.at)
    const count = (fn) => all.filter(fn).length
    const weekAgo = Date.now() - 7 * 864e5
    const sel = u.sel && all.find((x) => x.id === u.sel)
    if (sel) detailDrawer(sel, u)

    return html`
      ${connectionBanner()}
      <div class="grid g-kpi sugg-kpis">
        ${S.kpi({ label: 'Open', icon: 'flag', tone: 'sky', value: count((x) => OPEN.has(x.status)), foot: `${count((x) => x.at > weekAgo)} filed in the last 7 days`, extra: { 'data-click': 'sugg.quick', 'data-v': 'open', style: 'cursor:pointer' } })}
        ${S.kpi({ label: 'Ideas', icon: 'bolt', tone: 'azure', value: count((x) => x.kind === 'idea'), foot: `${count((x) => x.kind === 'idea' && x.status === 'Planned')} planned`, extra: { 'data-click': 'sugg.quick', 'data-v': 'idea', style: 'cursor:pointer' } })}
        ${S.kpi({ label: 'Bugs', icon: 'alert', tone: 'navy', value: count((x) => x.kind === 'bug'), foot: `${count((x) => x.kind === 'bug' && OPEN.has(x.status))} still open`, extra: { 'data-click': 'sugg.quick', 'data-v': 'bug', style: 'cursor:pointer' } })}
        ${S.kpi({ label: 'Workarounds', icon: 'book', tone: 'ice', value: count((x) => x.kind === 'workaround'), foot: `${count((x) => x.kind === 'workaround' && x.status === 'Done')} confirmed`, extra: { 'data-click': 'sugg.quick', 'data-v': 'workaround', style: 'cursor:pointer' } })}
      </div>

      <div class="card">
        <div class="card-h sugg-toolbar">
          <div class="kb-search sugg-search">${icon('search', 16)}<input type="search" placeholder="Search titles, details, names, tickets" value="${u.q}" data-input="sugg.q" aria-label="Search suggestions"></div>
          ${seg([{ id: 'all', label: 'All' }, ...KINDS.map((k) => ({ id: k.id, label: k.label + 's' }))], u.kind, 'sugg.filterKind')}
          <select class="in sugg-select" aria-label="Status" data-change="sugg.filter" data-f="status">
            ${[['open', 'Open'], ['all', 'Any status'], ...STATUSES.map((s) => [s, s])].map(([v, l]) => html`<option value="${v}" ${attrs({ selected: u.status === v })}>${l}</option>`)}
          </select>
          <select class="in sugg-select" aria-label="Page" data-change="sugg.filter" data-f="page">
            <option value="all" ${attrs({ selected: u.page === 'all' })}>Any page</option>
            <option value="general" ${attrs({ selected: u.page === 'general' })}>General</option>
            ${S.PAGES.filter((p) => p.id !== 'suggestions').map((p) => html`<option value="${p.id}" ${attrs({ selected: u.page === p.id })}>${p.label}</option>`)}
          </select>
          <select class="in sugg-select" aria-label="Sort" data-change="sugg.filter" data-f="sort">
            ${[['top', 'Most votes'], ['new', 'Newest'], ['active', 'Recently active']].map(([v, l]) => html`<option value="${v}" ${attrs({ selected: u.sort === v })}>${l}</option>`)}
          </select>
          <span class="spacer"></span>
          <button class="btn primary" data-click="sugg.open">${icon('plus', 15)}New suggestion</button>
        </div>
        <div class="sugg-list">
          ${sugg.online === null && html`<div class="empty">Loading suggestions…</div>`}
          ${sugg.online !== null && all.length === 0 && html`<div class="empty sugg-empty">
            <span class="sugg-empty-ic">${icon('bulb', 28)}</span>
            <b>No suggestions yet</b>
            <span class="muted">Spotted a bug, have an idea, or found a workaround that saved a ticket? Share it here.</span>
            <div class="row" style="justify-content:center">${KINDS.map((k) => html`<button class="btn sm" data-click="sugg.open" data-v="${k.id}">${icon(k.icon, 14)}${k.label}</button>`)}</div>
          </div>`}
          ${all.length > 0 && list.length === 0 && html`<div class="empty">Nothing matches these filters. <button class="btn ghost sm" data-click="sugg.clear">Clear filters</button></div>`}
          ${list.map((x) => row(x))}
        </div>
        <div class="card-f sugg-foot">
          <span class="muted small">${list.length} of ${all.length} shown${sugg.loadedAt ? html` · updated ${fmtTime(sugg.loadedAt)}` : ''}</span>
          <span class="spacer"></span>
          <button class="btn ghost sm" data-click="sugg.csv" ${attrs({ disabled: !all.length })}>${icon('table', 14)}Export for Excel</button>
          <button class="btn ghost sm" data-click="sugg.json" ${attrs({ disabled: !sugg.events.length })}>${icon('upload', 14)}Export backup</button>
          <label class="btn ghost sm file-btn">${icon('folderOpen', 14)}Import backup<input type="file" accept=".json,application/json" data-change="sugg.import" hidden></label>
        </div>
      </div>`
  }

  function connectionBanner() {
    if (sugg.error) return html`<div class="callout crit sugg-conn">${icon('alert', 16)}<span>${sugg.error}</span><span class="spacer"></span><button class="btn sm" data-click="sugg.reload">${icon('refresh', 14)}Retry</button></div>`
    if (sugg.online === false) return html`<div class="callout warn sugg-conn">${icon('info', 16)}<span><b>Only on this computer.</b> Scope Lite was opened without its server, so suggestions are saved in this browser. To share with the team, start it with <span class="code-chip">run.bat</span>, or use <b>Export backup</b> below and send the file to whoever hosts it.</span></div>`
    if (sugg.online) return html`<div class="callout accent sugg-conn">${icon('team', 16)}<span><b>Shared board.</b> Everyone using this Scope Lite server sees the same suggestions. It refreshes every 15 seconds.</span></div>`
    return ''
  }

  function row(x) {
    const voted = x.votes.has(voter)
    return html`<div class="${cls('sugg-row', S.ui('p:sugg').sel === x.id && 'sel')}" data-key="${x.id}">
      <button class="${cls('sugg-vote', voted && 'on')}" data-click="sugg.vote" data-v="${x.id}" aria-pressed="${voted}" title="${voted ? 'Remove your vote' : 'Vote for this'}">
        ${icon('up', 16)}<b class="num">${x.votes.size}</b>
      </button>
      <button class="sugg-main" data-click="sugg.select" data-v="${x.id}">
        <span class="row tight">${kindPill(x.kind)}${statusPill(x.status)}${x.app && html`<span class="dash-chip">${x.app}</span>`}${x.ref && html`<span class="dash-chip mono">${x.ref}</span>`}</span>
        <b class="sugg-title">${x.title}</b>
        ${x.details && html`<span class="sugg-snip ink2">${x.details}</span>`}
        <span class="muted small">${x.by} · ${pageLabel(x.page)} · ${ago(x.at)}${x.comments.length > 0 && html` · ${icon('msg', 12)} ${x.comments.length}`}</span>
      </button>
    </div>`
  }

  function detailDrawer(x, u) {
    const voted = x.votes.has(voter)
    const timeline = [
      { at: x.at, by: x.by, text: html`filed this ${kindOf(x.kind).label.toLowerCase()}` },
      ...x.history.map((h) => ({ at: h.at, by: h.by, text: html`moved it from <b>${h.from}</b> to <b>${h.to}</b>` })),
      ...x.comments.map((c) => ({ at: c.at, by: c.by, text: html`<span class="sugg-comment">${c.text}</span>`, comment: true })),
    ].sort((a, b) => a.at - b.at)
    S.drawer({
      className: 'sugg-drawer',
      onClose: 'sugg.deselect',
      title: html`<span class="row tight">${kindPill(x.kind)}<span class="muted small mono">${x.id.slice(0, 9)}</span></span><h2 class="drawer-title">${x.title}</h2>`,
      sub: html`<span class="muted small">${x.by} · ${pageLabel(x.page)} · ${new Date(x.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>`,
      body: html`<div class="stack" style="gap:16px">
        <div class="row">
          <button class="${cls('btn sm', voted && 'primary')}" data-click="sugg.vote" data-v="${x.id}">${icon('up', 14)}${voted ? 'Voted' : 'Vote'} · ${x.votes.size}</button>
          <span class="spacer"></span>
          <label class="row tight small"><span class="muted">Status</span>
            <select class="in sugg-select" data-change="sugg.status" data-v="${x.id}" aria-label="Status">
              ${STATUSES.map((s) => html`<option ${attrs({ selected: x.status === s })}>${s}</option>`)}
            </select></label>
        </div>
        ${(x.app || x.ref) && html`<div class="row tight">${x.app && html`<span class="dash-chip">${x.app}</span>`}${x.ref && html`<span class="dash-chip mono">${x.ref}</span>`}</div>`}
        ${x.details ? html`<div class="sugg-details">${x.details}</div>` : html`<div class="muted small">No details were added.</div>`}
        <div class="stack" style="gap:8px">
          <span class="eyebrow">Activity</span>
          <div class="sugg-timeline">
            ${timeline.map((t) => html`<div class="${cls('sugg-ev', t.comment && 'is-comment')}">
              <span class="avatar sm">${S.initials(t.by || 'A')}</span>
              <div class="stack" style="gap:2px;min-width:0"><span class="small"><b>${t.by}</b> ${t.text}</span><span class="muted small">${ago(t.at)}</span></div>
            </div>`)}
          </div>
        </div>
        <form class="stack" style="gap:8px" data-submit="sugg.comment" data-v="${x.id}">
          <label class="field"><span>Add a comment</span>
            <textarea class="in" rows="3" maxlength="2000" placeholder="${x.kind === 'bug' ? 'Can you reproduce it? Any extra detail?' : x.kind === 'workaround' ? 'Did it work for you too? Any caveats?' : 'What do you think?'}" data-input="sugg.commentText">${u.comment}</textarea></label>
          <div class="row"><span class="small muted">Posting as ${myName() || 'Anonymous'}</span><span class="spacer"></span><button class="btn sm primary" type="submit" ${attrs({ disabled: !u.comment.trim() })}>${icon('send', 14)}Comment</button></div>
        </form>
      </div>`,
    })
  }

  // ---------- Handlers ----------
  const page = () => S.ui('p:sugg')
  S.on({
    'sugg.open': (el) => openForm(el.dataset.v),
    'sugg.close': () => S.set(form(), { open: false }),
    'sugg.kind': (el) => S.set(form(), { kind: el.dataset.v }),
    'sugg.field': (el) => { form()[el.name] = el.value; if (el.tagName === 'SELECT' || form().tried) S.render() },
    'sugg.keys': (el, ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); submit() } },
    'sugg.submit': () => submit(),
    'sugg.q': (el) => S.set(page(), { q: el.value }),
    'sugg.filterKind': (el) => S.set(page(), { kind: el.dataset.v }),
    'sugg.filter': (el) => S.set(page(), { [el.dataset.f]: el.value }),
    'sugg.quick': (el) => {
      const v = el.dataset.v
      S.set(page(), v === 'open' ? { kind: 'all', status: 'open' } : { kind: v, status: 'all' })
    },
    'sugg.clear': () => S.set(page(), { q: '', kind: 'all', status: 'all', page: 'all' }),
    'sugg.select': (el) => S.set(page(), { sel: el.dataset.v, comment: '' }),
    'sugg.deselect': () => S.set(page(), { sel: null }),
    'sugg.vote': (el) => {
      const x = sugg.items.find((i) => i.id === el.dataset.v)
      if (x) send({ type: 'vote', id: x.id, voter, on: !x.votes.has(voter) })
    },
    'sugg.status': (el) => send({ type: 'status', id: el.dataset.v, status: el.value, by: myName() || 'Anonymous' }),
    'sugg.commentText': (el) => { const p = page(); const was = !!p.comment.trim(); p.comment = el.value; if (was !== !!el.value.trim()) S.render() },
    'sugg.comment': async (el) => {
      const p = page()
      if (!p.comment.trim()) return
      const ok = await send({ type: 'comment', id: el.dataset.v, text: p.comment.trim(), by: myName() || 'Anonymous' })
      if (ok) S.set(p, { comment: '' })
    },
    'sugg.csv': exportCsv,
    'sugg.json': exportJson,
    'sugg.import': (el) => { const f = el.files && el.files[0]; el.value = ''; if (f) importJson(f) },
    'sugg.reload': () => { sugg.error = null; load() },
  })
})()
