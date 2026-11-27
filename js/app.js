// App shell, ported from src/App.jsx, src/pages/SignIn.jsx and src/components/DevTools.jsx:
// workspace picker → sign in → sidebar, header and the current page.
; (function () {
  const { html, cls, attrs, icon, seg, storage, byId, initials, fmtTime, slaInfo, workspaceById, WORKSPACES } = S

  // Account profile is reached from the profile menu at the bottom of the sidebar.
  // managerOnly pages are hidden from analysts and fall back to Home if opened by link.
  const PAGES = [
    { id: 'home', label: 'Home', icon: 'home', title: 'Queue command', desc: 'Live incident queue, queue health and today\'s staffing.', noHead: () => !!(S.homeLive && S.schedule && S.schedule.real() && S.qm.me()) },
    { id: 'qm', label: 'My queue', icon: 'clip', title: 'My queue', desc: 'Work your tickets and log the ones you handled outside your queue.', aside: () => S.queue && S.queue.onShiftStack() },
    { id: 'explorer', label: 'Ticket Explorer', icon: 'search', title: 'Ticket Explorer', desc: 'How every incident was solved: resolution journeys, codes and handover history.' },
    { id: 'reports', label: 'Reports', icon: 'chart', title: 'Reports', desc: 'Performance, quality and coaching, plus self-serve questions answered in your browser.', aside: () => S.reportsAside && S.reportsAside() },
    { id: 'team', label: 'Team Management', icon: 'team', title: 'Team Management', desc: 'Roster, access, shift coverage, and attendance.' },
    { id: 'kb', label: 'Knowledge Base', icon: 'book', title: 'Knowledge Base', desc: 'Runbooks, policies and live reference data. Publish a page and Copilot can use it.' },
    { id: 'copilot', label: 'Copilot', icon: 'spark', title: 'Copilot', bare: true, desc: 'Help resolving tickets and reading the operation, grounded in your knowledge base and live data.' },
    { id: 'suggestions', label: 'Suggestions', icon: 'bulb', title: 'Suggestions', managerOnly: true, desc: 'Ideas, bugs and workarounds from the team. File one in a few seconds; everyone sees the same list.' },
    { id: 'settings', label: 'Account profile', icon: 'user', title: 'Account profile', desc: 'Your profile, access, attendance history, shifts and leave.' },
  ]
  // The Suggestions board (Team feedback) and the sidebar's Suggest button are hidden for now
  // (lead, 2026-11-19). Saved suggestions stay in data/suggestions.jsonl; set this to true to bring them back.
  const FEEDBACK_ON = false
  const NAV_GROUPS = [['General', ['home', 'qm']], ['Reports', ['explorer', 'reports']], ['Tools', ['team', 'kb', 'copilot']], ...(FEEDBACK_ON ? [['Team feedback', ['suggestions']]] : [])]

  // Pages register themselves here: S.pages.home = (route) => markup
  S.pages = S.pages || {}
  S.PAGES = PAGES

  // Two sign-in roles. 'lead' is the Manager role's id in state and saved sessions.
  const isManager = (st) => st.role === 'lead'
  S.isManager = isManager
  const canOpen = (p) => (p.id !== 'suggestions' || FEEDBACK_ON) && (!p.managerOnly || isManager(S.state))

  // ---------- Routing ----------
  const hashPage = () => { const h = location.hash.replace('#', ''); return PAGES.some((p) => p.id === h) ? h : 'home' }
  S.route = { page: hashPage(), key: 0 }
  // nav(page, opts): opts carry deep links such as { tab, ticket, approval }.
  S.nav = (page, opts = {}) => {
    S.resetUi('p:')
    S.pop = null
    S.route = { ...opts, page, key: Date.now() }
    try { history.replaceState(null, '', '#' + page) } catch { /* sandboxed frame */ }
    window.scrollTo(0, 0)
    S.render()
  }

  // ---------- Session ----------
  // The signed-in role and workspace are remembered per browser so a reload doesn't sign you out.
  const SESSION_KEY = 'scope-session'
  const WS_KEY = 'scope-workspace'
  const app = {
    session: storage.get(SESSION_KEY),
    signedOut: false,
    // The workspace picker is off for now (lead, 2026-11-19): Scope opens straight into the
    // Solution Center. workspacePicker() stays for when the other workspaces come back.
    wsId: 'sc',
    // Sidebar collapsed to icons (remembered in this browser).
    railCollapsed: storage.get('scope-rail') === 'collapsed',
  }
  if (app.session && app.session !== S.state.role) S.state = { ...S.state, role: app.session }
  const pickWs = (id) => { storage.set(WS_KEY, id); app.wsId = id; S.render() }
  const signIn = (role) => {
    S.dispatch({ type: 'role', role })
    storage.set(SESSION_KEY, role)
    Object.assign(app, { session: role, signedOut: false })
    S.nav('home')
  }
  const signOut = () => { S.qm.signOut(); storage.set(SESSION_KEY, null); Object.assign(app, { session: null, signedOut: true }); S.render() }
  // Each workspace is its own sign-in, so switching signs you out and returns to the picker.
  const switchWs = () => { S.qm.signOut(); storage.set(SESSION_KEY, null); Object.assign(app, { session: null, signedOut: false }); pickWs(null) }

  // ---------- Theme ----------
  const readTheme = () => storage.get('scope-theme') || storage.get('serviceops-theme') || 'light'
  const applyTheme = (t) => { document.documentElement.setAttribute('data-app-theme', t); storage.set('scope-theme', t) }
  applyTheme(readTheme())

  // ---------- Shell ----------
  S.App = function App() {
    const ws = workspaceById(app.wsId)
    if (!ws) return html`${workspacePicker()}${S.toasts()}${S.takeOverlays()}`
    // One UI (lead, 2026-11-27): when the server has a team roster, Scope always runs on the
    // team's real data. A browser that isn't signed in as someone on the roster (an old
    // sample sign-in, for example) goes to the roster sign-in instead of the prototype's
    // sample screens. The sample screens only remain when Scope opens without the server.
    if (app.session && S.qm.loadedAt && S.qm.roster.length && !S.qm.me()) { storage.set(SESSION_KEY, null); app.session = null }
    if (!app.session) return html`${signInPage(ws)}${S.toasts()}${S.takeOverlays()}`
    if (!canOpen(PAGES.find((p) => p.id === S.route.page))) {
      S.route = { page: 'home', key: Date.now() }
      try { history.replaceState(null, '', '#home') } catch { /* sandboxed frame */ }
    }
    const route = S.route
    const page = PAGES.find((p) => p.id === route.page)
    // Home's badge: tickets past SLA (real export on live data, sample tickets otherwise).
    const breached = S.schedule && S.schedule.real() && S.qm.me() ? S.queue.view().tickets.filter((t) => S.queue.isOpen(t) && S.queue.health(t, S.queue.view().settings).slaBreached).length : S.state.tickets.filter((t) => slaInfo(t, S.state.now).status === 'Breached').length
    // Render the page first: its modals and drawers land in the overlay layer below.
    const body = S.pages[page.id] ? S.pages[page.id](route) : notPorted(page)
    return html`
      <div class="${cls('app', app.railCollapsed && 'rail-collapsed')}">
        <nav class="rail" aria-label="Main" data-tour="rail">
          <div class="brand">
            <div class="brand-mark ws-${ws.tone}" title="${app.railCollapsed ? `scope · ${ws.name}${ws.home ? ' Hub' : ''}` : ''}">${ws.short}</div>
            <div class="brand-text">
              <div class="brand-name">scope</div>
              <div class="brand-sub">${ws.name}${ws.home ? ' Hub' : ''}</div>
            </div>
            <button class="rail-toggle" data-click="app.rail" aria-label="${app.railCollapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}" aria-expanded="${!app.railCollapsed}" title="${app.railCollapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}">${icon(app.railCollapsed ? 'chevR' : 'chevL', 16)}</button>
          </div>
          <div class="rail-nav">
            ${NAV_GROUPS.filter(([, ids]) => PAGES.some((p) => ids.includes(p.id) && canOpen(p))).map(([group, ids]) => html`<div style="display:contents">
              <div class="rail-group">${group}</div>
              ${PAGES.filter((p) => ids.includes(p.id) && canOpen(p)).map((p) => html`
                <button class="nav-btn" ${attrs({ 'aria-current': route.page === p.id ? 'page' : null, title: app.railCollapsed ? p.label : null, 'aria-label': app.railCollapsed ? p.label : null })} data-click="app.nav" data-v="${p.id}">
                  ${icon(p.icon)}<span class="nav-label">${p.label}</span>
                  ${p.id === 'home' && breached > 0 && html`<span class="nav-count" title="Tickets past SLA">${breached}</span>`}
                  ${p.id === 'qm' && S.qm && S.qm.badge() > 0 && html`<span class="nav-count sugg-count" title="Manual INC entries waiting for you to verify">${S.qm.badge()}</span>`}
                  ${p.id === 'suggestions' && S.sugg && S.sugg.openCount() > 0 && html`<span class="nav-count sugg-count" title="Open suggestions">${S.sugg.openCount()}</span>`}
                </button>`)}
            </div>`)}
          </div>
          <div class="rail-foot"></div>
          ${FEEDBACK_ON && html`<button class="rail-suggest" data-click="sugg.open" title="Suggest an idea, report a bug or share a workaround">
            <span class="rail-suggest-ic">${icon('bulb', 16)}</span>
            <span class="stack" style="gap:0;min-width:0"><b>Suggest</b><span>Idea, bug or workaround</span></span>
          </button>`}
          ${profileMenu(ws, route.page === 'settings')}
        </nav>
        <div class="main">
          ${header(page, ws)}
          <main class="page" data-key="page-${route.page}-${route.key}">
            ${!page.bare && !(page.noHead && page.noHead()) && html`<div class="page-head">
              <div class="page-head-t"><h1>${page.title}</h1><p>${page.desc}</p></div>
              ${page.aside && page.aside()}
            </div>`}
            ${!ws.home && html`<div class="callout accent ws-demo">${icon('info', 16)}<span><b>${ws.name} workspace (demo).</b> It runs the same modules as Solution Center for ${ws.groups.join(', ')}. This prototype only has Solution Center sample data, so that's what you see here.</span></div>`}
            ${body}
          </main>
        </div>
      </div>
      ${S.toasts()}
      ${isManager(S.state) ? devTools() : ''}
      ${S.state.tour && S.Tour ? S.Tour() : ''}
      ${S.suggestModal ? S.suggestModal() : ''}
      <div class="overlay-layer">${S.takeOverlays()}</div>`
  }

  const notPorted = (page) => html`<div class="card"><div class="card-b empty">
    ${icon('code', 20)}<p><b>${page.label}</b> isn't in this build yet.</p>
    <button class="btn sm" data-click="sugg.open" data-v="idea">${icon('bulb', 14)}Suggest what it should do</button>
  </div></div>`

  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    const day = t.getUTCDay() || 7
    t.setUTCDate(t.getUTCDate() + 4 - day)
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
    return Math.ceil(((t - y0) / 864e5 + 1) / 7)
  }

  function header(page, ws) {
    const now = new Date(S.state.now)
    const dark = readTheme() === 'dark'
    // The breadcrumb only shows once the trail is 3+ levels deep; pages add levels via S.nav(page, { crumbs: [...] }).
    const trail = [ws.name, page.label, ...(S.route.crumbs || [])]
    const sep = html`<span class="crumb-sep">${icon('arrowR', 14)}</span>`
    return html`<header class="header">
      ${trail.length >= 3 ? html`<nav class="crumb" aria-label="Breadcrumb"><span class="crumb-back" aria-hidden="true">${icon(page.icon, 16)}</span>${trail.slice(0, -1).map((c) => html`<span class="crumb-root">${c}</span>${sep}`)}<b>${trail[trail.length - 1]}</b></nav>` : html`<div></div>`}
      <div class="header-center">${snowStatus()}</div>
      <div class="header-right">
        <div class="date-chip" title="Local time">
          <b>${now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</b>
          <span class="muted small">${fmtTime(S.state.now)} · Week ${isoWeek(now)}</span>
        </div>
        <button class="icon-btn theme-btn" data-click="app.theme" aria-pressed="${dark}" aria-label="${dark ? 'Switch to light mode' : 'Switch to dark mode'}" title="${dark ? 'Switch to light mode' : 'Switch to dark mode'}">${icon(dark ? 'sun' : 'moon', 18)}</button>
        ${notifications()}
      </div>
    </header>`
  }

  function snowStatus() {
    // On real team data, the header shows the ServiceNow export's import health instead (queue.js).
    if (S.schedule && S.schedule.real() && S.qm.me()) return S.queue.importPill()
    const st = S.state
    const open = S.pop === 'snow'
    const ago = Math.max(0, Math.round((Date.now() - st.snow.lastSync) / 1000))
    const open_ = st.tickets.length
    const p1 = st.tickets.filter((t) => t.priority === 'P1').length
    const unassigned = st.tickets.filter((t) => !t.assignedTo).length
    return html`<div class="pop-anchor" data-pop-anchor="snow" data-tour="snow">
      <button class="snow-pill" data-click="app.pop" data-v="snow" aria-expanded="${open}">
        <span class="snow-ic">${icon('refresh', 15)}</span>
        <b>ServiceNow</b>
        <span class="row tight muted snow-live"><span class="dot live"></span>Live · ${ago < 60 ? `${ago}s` : `${Math.round(ago / 60)}m`} ago</span>
        <span class="muted small snow-in">In:</span>
        <span class="dash-chip">${open_} open</span>
        <span class="dash-chip">P1 ${p1}</span>
        <span class="dash-chip">${unassigned} waiting</span>
      </button>
      ${open && html`<div class="popover popover-center" style="width:320px">
        <div class="card-h"><h3>ServiceNow sync</h3><span class="spacer"></span><span class="pill good">Healthy</span></div>
        <div class="card-b stack">
          ${[
          ['Instance', 'corp.service-now.com (simulated)'],
          ['Last sync', `${fmtTime(st.snow.lastSync)} · every 30s`],
          ['API latency', `${st.snow.latencyMs} ms`],
          ['Open incidents in queue', open_],
          ['P1 open', p1],
          ['Waiting for an analyst', unassigned],
          ['Pulled in the last hour', st.snow.intakeLastHour],
        ].map(([k, v]) => html`<div class="row" style="justify-content:space-between"><span class="muted">${k}</span><b class="num">${v}</b></div>`)}
          <div class="row" style="margin-top:6px">
            <button class="btn sm" data-click="app.sync">${icon('refresh', 14)}Sync now</button>
          </div>
        </div>
      </div>`}
    </div>`
  }

  const NOTIF_ICON = { rota: 'swap', shift: 'cal', sla: 'clock', approval: 'bolt', handover: 'clip', leave: 'cal', coverage: 'team', info: 'book', password: 'key', p1: 'alert', assign: 'user' }
  let notifList = []

  function notifications() {
    const st = S.state
    const u = S.ui('notif', { tab: 'action' })
    const open = S.pop === 'notif'
    const all = S.buildNotifications(st)
    notifList = all
    const unread = all.filter((n) => !st.read[n.id])
    const list = all.filter((n) => n.group === u.tab)
    return html`<div class="pop-anchor" data-pop-anchor="notif" data-tour="notif">
      <button class="icon-btn" data-click="app.pop" data-v="notif" aria-label="Notifications, ${unread.length} unread" aria-expanded="${open}">
        ${icon('bell')}
        ${unread.length > 0 && html`<span class="badge">${unread.length > 99 ? '99+' : unread.length}</span>`}
      </button>
      ${open && html`<div class="popover">
        <div class="card-h" style="padding-bottom:6px">
          <h3>Notifications</h3>
          <span class="spacer"></span>
          <button class="btn ghost sm" data-click="app.readAll">Mark all read</button>
        </div>
        <div style="padding:0 8px">
          <div class="tabs">
            ${[['action', 'Needs action'], ['update', 'Updates']].map(([id, l]) => html`
              <button class="tab" aria-selected="${u.tab === id}" data-click="app.notifTab" data-v="${id}">
                ${l}<span class="ct">${all.filter((n) => n.group === id && !st.read[n.id]).length}</span>
              </button>`)}
          </div>
        </div>
        <div style="max-height:420px;overflow-y:auto">
          ${list.length === 0 && html`<div class="empty">Nothing here. You're caught up.</div>`}
          ${list.map((n) => html`
            <button class="${cls('notif', !st.read[n.id] && 'unread')}" data-click="app.notif" data-v="${n.id}" data-key="n-${n.id}">
              <span class="notif-ic ${n.tone}">${icon(NOTIF_ICON[n.kind] || 'bell', 15)}</span>
              <span class="stack" style="gap:2px;min-width:0">
                <b style="font-size:13px">${n.title}</b>
                ${n.sub && html`<span class="muted small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.sub}</span>`}
                <span class="muted small">${fmtTime(n.at)}</span>
              </span>
            </button>`)}
        </div>
        <div class="muted small" style="padding:8px 14px;border-top:1px solid var(--line)">
          ${S.qm.me() && S.schedule && S.schedule.real() ? 'Rota gaps, leave clashes and schedule changes, plus tickets waiting or past SLA.' : st.role === 'lead' ? 'Manager view: SLA risk across the whole queue, fix approvals, handovers, leave and coverage.' : 'Analyst view: your SLA risk, new assignments, fix decisions and password reminders.'}
        </div>
      </div>`}
    </div>`
  }

  function profileMenu(ws, active) {
    // Signed in from the team roster: show the real person and today's duty. Otherwise
    // the sample user that the rest of the prototype's data is built around.
    const real = S.qm.me()
    const today = S.qm.today()
    const me = real ? { name: real.name, soeid: real.soeid, role: today ? `${S.dutyLabel(today.duty)} · ${S.shiftLabel(today.shift)}` : real.accessRole } : S.currentUser(S.state)
    const open = S.pop === 'profile'
    if (S.schedule) S.schedule.editModal() // the guarded "change today's role or shift" dialog
    return html`<div class="profile-wrap" data-pop-anchor="profile" data-tour="profile">
      ${open && html`<div class="profile-menu" role="menu" aria-label="Account">
        <div class="profile-menu-head">
          <span class="avatar">${initials(me.name)}</span>
          <div class="stack" style="gap:0;min-width:0">
            <b class="small">${me.name}</b>
            <span class="muted small mono">${me.soeid} · ${me.role}</span>
          </div>
        </div>
        ${real && html`<button role="menuitem" class="menu-item" data-click="sched.editOpen">${icon('edit', 16)}${today ? "Change today's role or shift" : "Start today's shift"}</button>`}
        ${real && S.queue && html`<button role="menuitemcheckbox" aria-checked="${S.queue.soundOn()}" class="menu-item" data-click="app.sound">${icon('bell', 16)}Sound for new tickets<span class="spacer"></span><span class="muted small">${S.queue.soundOn() ? 'On' : 'Off'}</span></button>`}
        <button role="menuitem" class="menu-item" data-click="app.profile" data-v="settings">${icon('user', 16)}Account profile</button>
        <button role="menuitem" class="menu-item danger" data-click="app.profile" data-v="logout">${icon('logout', 16)}Log out</button>
      </div>`}
      <button class="${cls('profile-btn', active && 'active')}" data-click="app.pop" data-v="profile" aria-haspopup="menu" aria-expanded="${open}" ${attrs({ title: app.railCollapsed ? `${me.name} · ${me.role}` : null })}>
        <span class="avatar sm">${initials(me.name)}</span>
        <span class="profile-text"><b>${me.name}</b><span>${me.role}</span></span>
        ${icon(open ? 'chevDown' : 'chevUp', 15)}
      </button>
    </div>`
  }

  // ---------- Sign in ----------
  // Sign in from the team roster (data/roster.json). No password yet (the honour system
  // until company SSO is connected), but the person is real, so Queue Management puts
  // their SOEID on everything they log. Role and shift are never picked here: they come
  // from Team Management (Proci rota and Schedule & coverage). A Lead gets the Manager view.
  const hasRoster = () => !!(S.qm && S.qm.roster.some((p) => p.active !== false))
  // What Team Management says for this person today, in words.
  function planLine(pl) {
    if (pl.role === 'LEAVE') return { tone: 'warn', text: html`<b>On leave today.</b> You can still sign in; you won't get tickets.` }
    if (pl.role === 'REST') return { tone: 'warn', text: html`<b>Rest day today.</b> You can still sign in; you won't get tickets.` }
    if (pl.off) return { tone: 'warn', text: html`<b>Not scheduled today.</b> You can still sign in; you won't get tickets.` }
    if (!pl.role || !pl.shift) {
      const missing = [!pl.role && 'role (the Proci rota)', !pl.shift && 'shift'].filter(Boolean).join(' and ')
      return { tone: 'warn', text: html`<b>Today's ${missing} isn't set in Team Management yet.</b> You can sign in, but you won't get tickets until a lead sets it or you start your shift from the profile menu.` }
    }
    return { tone: 'accent', text: html`Today: <b>${S.dutyLabel(pl.role)} · ${S.shiftLabel(pl.shift)} shift</b> <span class="muted">(${(S.SHIFTS.find((x) => x.id === pl.shift) || {}).times})</span>` }
  }
  function rosterLogin(u) {
    const people = S.qm.roster.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name))
    const q = u.q.trim().toLowerCase()
    const list = people.filter((p) => !q || `${p.name} ${p.soeid}`.toLowerCase().includes(q))
    const who = people.find((p) => p.soeid === u.who)
    const pl = who && S.schedule ? S.schedule.planFor(who.soeid) : null
    const line = pl && planLine(pl)
    return html`<section class="stack roster-login" aria-label="Pick your name">
      <div class="kb-search roster-search">${icon('search', 16)}<input type="search" placeholder="Search name or SOEID" value="${u.q}" data-input="app.rosterQ" aria-label="Search the team roster" data-autofocus></div>
      <div class="roster-list" role="listbox" aria-label="Team roster">
        ${list.map((p) => html`<button class="${cls('roster-row', u.who === p.soeid && 'on')}" role="option" aria-selected="${u.who === p.soeid}" data-key="${p.soeid}" data-click="app.who" data-dblclick="app.rosterLogin" data-v="${p.soeid}">
          <span class="avatar sm">${initials(p.name)}</span>
          <span class="stack" style="gap:0;min-width:0"><b>${p.name}</b><span class="small muted mono">${p.soeid}</span></span>
          <span class="spacer"></span>
          <span class="${cls('pill', p.accessRole === 'Lead' ? 'accent' : '')}">${p.accessRole === 'Lead' ? 'Lead' : 'Analyst'}</span>
        </button>`)}
        ${!list.length && html`<div class="empty small">No one matches “${u.q}”.</div>`}
      </div>
      ${line && html`<div class="${cls('callout', line.tone)}" aria-live="polite">${icon(line.tone === 'accent' ? 'cal' : 'alert', 16)}<span>${line.text}</span></div>`}
      <button class="btn primary" data-click="app.rosterLogin" ${attrs({ disabled: !who })}>${icon('logout', 15)}${who ? `Sign in as ${who.name.split(' ')[0]}` : 'Sign in'}</button>
    </section>`
  }

  function signInPage(ws) {
    const u = S.ui('signin', { q: '', who: null })
    const loading = S.qm && S.qm.online === null
    return html`<div class="signin">
      <main class="signin-main">
        <div class="signin-brand">
          <div class="brand-mark ws-${ws.tone}">${ws.short}</div>
          <div>
            <div class="brand-name">scope</div>
            <div class="brand-sub">${ws.name}${ws.home ? ' Hub' : ''}</div>
          </div>
        </div>
        <div class="card signin-card">
          <div class="ws-chosen">
            <span class="ws-mark ${ws.tone}">${ws.short}</span>
            <span class="stack" style="gap:0;min-width:0">
              <span class="small muted">Workspace</span>
              <b>${ws.name}</b>
            </span>
            <span class="spacer"></span>
          </div>
          <h1>Sign in</h1>
          ${hasRoster() ? rosterLogin(u)
        : loading ? html`<div class="muted small">Loading the team roster…</div>`
          : html`<div class="callout warn">${icon('alert', 16)}<span>${location.protocol === 'file:'
            ? html`<b>Scope needs its server to sign you in.</b> Close this tab and start Scope with <span class="code-chip">run.bat</span> (or <span class="code-chip">share.bat</span> for the team).`
            : html`<b>No team roster on this server.</b> The lead copies <span class="code-chip">data\\roster.example.json</span> to <span class="code-chip">data\\roster.json</span> on the host, fills in the team, then reloads this page.`}</span></div>`}
        </div>
        <span class="small muted">Internal tool · authorised users only</span>
      </main>
    </div>`
  }

  // First screen: pick the team workspace, then sign in to it. Each one is the same app,
  // configured with that team's queues, roster, codes and knowledge base.
  function workspacePicker() {
    const u = S.ui('wsPicker', { newNote: false })
    return html`<div class="signin">
      <main class="signin-main ws-main">
        <div class="signin-brand">
          <div class="brand-mark">SC</div>
          <div>
            <div class="brand-name">scope</div>
            <div class="brand-sub">Operations hub for resolver teams</div>
          </div>
        </div>
        <div class="ws-head">
          <h1>Choose a workspace</h1>
          <p>Pick your team, then sign in. Each team gets the same queue, explorer, reports, knowledge base and Copilot, set up for its own work.</p>
        </div>
        <div class="ws-grid">
          ${WORKSPACES.map((w) => html`
            <button class="ws-card" data-ws="${w.id}" data-click="app.pickWs" data-v="${w.id}">
              <span class="row" style="flex-wrap:nowrap;gap:10px">
                <span class="ws-mark ${w.tone}">${w.short}</span>
                <span class="stack" style="gap:0;min-width:0">
                  <b class="ws-name">${w.name}</b>
                  <span class="small muted">${w.groups.length} assignment group${w.groups.length > 1 ? 's' : ''}</span>
                </span>
                <span class="spacer"></span>
                ${icon('arrowR', 16)}
              </span>
              <span class="small ink2 ws-desc">${w.desc}</span>
              <span class="ws-stats">
                <span><b class="num">${w.home ? S.state.tickets.length : w.open}</b> open</span>
                <span><b class="num">${w.members}</b> people</span>
                <span><b class="num">${w.kbPages}</b> KB pages</span>
              </span>
              <span class="ws-groups">${w.groups.map((g) => html`<span class="dash-chip">${g}</span>`)}</span>
              <span class="small muted">Codes: <span class="mono">${w.codes.join(' · ')}</span></span>
            </button>`)}
          <button class="ws-card ws-new" data-click="app.wsNew" aria-expanded="${u.newNote}">
            <span class="row" style="gap:10px">
              <span class="ws-mark">${icon('plus', 16)}</span>
              <b class="ws-name">New workspace</b>
            </span>
            ${u.newNote ? html`<span class="small ink2 ws-desc">A platform admin sets up a team in four steps, with no code changes:
                <ol>
                  <li>Link its ServiceNow assignment groups</li>
                  <li>Add the roster and shift pattern</li>
                  <li>Choose a resolution code prefix</li>
                  <li>Create or link a knowledge base</li>
                </ol>
              </span>` : html`<span class="small muted ws-desc">Onboard another resolver team, such as Network, Cloud or Identity.</span>`}
          </button>
        </div>
        <span class="small ws-foot">Internal tool · authorised users only</span>
      </main>
    </div>`
  }

  // ---------- Prototype controls ----------
  // Everything here simulates the outside world (ServiceNow intake, who is
  // signed in) and is not part of the product UI.
  function devTools() {
    const open = S.pop === 'dev'
    const st = S.state
    return html`<div class="dev" data-pop-anchor="dev">
      ${open && html`<div class="dev-panel" role="dialog" aria-label="Prototype controls">
        <div class="row">
          <b>Prototype controls</b>
          <span class="spacer"></span>
          <span class="dash-chip">Dev only</span>
        </div>
        <p class="small muted" style="margin:0">Simulates ServiceNow and the knowledge base. Managers only; these controls won't ship in the product.</p>
        <div class="stack">
          <span class="eyebrow">Onboarding</span>
          <button class="btn sm primary" style="align-self:flex-start" data-click="dev.tour">${icon('flag', 14)}Start onboarding tour</button>
        </div>
        <div class="stack">
          <span class="eyebrow">ServiceNow intake</span>
          <div class="dev-actions">
            <button class="btn sm" data-click="dev.intake">${icon('plus', 14)}Pull incident</button>
            <button class="btn sm" data-click="dev.intake" data-v="P1">${icon('alert', 14)}Pull P1</button>
            <button class="btn sm" data-click="dev.burst">${icon('bolt', 14)}Burst of 5</button>
            <button class="btn sm" data-click="app.sync">${icon('refresh', 14)}Force sync</button>
          </div>
        </div>
        <div class="stack">
          <span class="eyebrow">Knowledge base</span>
          <label class="check small"><input type="checkbox" ${attrs({ checked: st.devFailIndex })} data-change="dev.failIndex">Fail the next publish (indexing timeout)</label>
        </div>
        <div class="stack">
          <span class="eyebrow">Data</span>
          <div class="dev-actions">
            <button class="btn sm danger" data-click="dev.reset">${icon('refresh', 14)}Reset sample data</button>
          </div>
        </div>
        <span class="small muted">Shortcut: <span class="kbd">Shift</span> + <span class="kbd">Alt</span> + <span class="kbd">D</span></span>
      </div>`}
      <button class="dev-fab" data-click="app.pop" data-v="dev" aria-expanded="${open}" aria-label="Prototype controls" title="Prototype controls">
        ${icon(open ? 'x' : 'code', 18)}<span>Dev</span>
      </button>
    </div>`
  }
  window.addEventListener('keydown', (e) => { if (e.shiftKey && e.altKey && e.code === 'KeyD' && app.session && isManager(S.state)) S.togglePop('dev') })

  // ---------- Handlers ----------
  S.on({
    'app.nav': (el) => S.nav(el.dataset.v),
    'app.pop': (el) => S.togglePop(el.dataset.v),
    'app.sync': () => S.dispatch({ type: 'sync' }),
    'app.theme': () => { applyTheme(readTheme() === 'dark' ? 'light' : 'dark'); S.render() },
    'app.readAll': () => S.dispatch({ type: 'readAll', ids: notifList.map((n) => n.id) }),
    'app.notifTab': (el) => S.set(S.ui('notif'), { tab: el.dataset.v }),
    'app.notif': (el) => {
      const n = notifList.find((x) => x.id === el.dataset.v)
      if (!n) return
      S.dispatch({ type: 'read', id: n.id })
      S.nav(n.page, { tab: n.tab, ticket: n.ticket, approval: n.approval })
    },
    'app.sound': () => { const on = !S.queue.soundOn(); storage.set(S.queue.SOUND_KEY, on ? null : 'off'); if (on) S.queue.chime(); S.render() },
    'app.rail': () => { app.railCollapsed = !app.railCollapsed; storage.set('scope-rail', app.railCollapsed ? 'collapsed' : null); S.pop = null; S.render() },
    'app.profile': (el) => {
      S.pop = null
      const v = el.dataset.v
      if (v === 'settings') S.nav('settings')
      else if (v === 'switch') switchWs()
      else signOut()
    },
    'app.pickWs': (el) => pickWs(el.dataset.v),
    'app.wsNew': () => { const u = S.ui('wsPicker'); S.set(u, { newNote: !u.newNote }) },
    'app.changeWs': () => { app.signedOut = false; pickWs(null) },
    'app.rosterQ': (el) => S.set(S.ui('signin'), { q: el.value }),
    'app.who': (el) => S.set(S.ui('signin'), { who: el.dataset.v }),
    // Sign in with today's role and shift from Team Management. When it has none (not
    // set, rest day, leave), sign in without going on shift: no tickets until it's set.
    'app.rosterLogin': (el) => {
      const u = S.ui('signin')
      const p = S.qm.roster.find((x) => x.soeid === (el.dataset.v || u.who))
      if (!p) return
      const pl = S.schedule ? S.schedule.planFor(p.soeid) : { ready: false }
      if (pl.ready) S.qm.signIn(p.soeid, pl.role, pl.shift, { auto: true })
      else S.qm.signInOnly(p.soeid)
      Object.assign(u, { q: '', who: null })
      signIn(p.accessRole === 'Lead' ? 'lead' : 'analyst')
    },
    'dev.tour': () => { S.pop = null; S.dispatch({ type: 'tourStart' }) },
    'dev.intake': (el) => S.dispatch({ type: 'intake', priority: el.dataset.v }),
    'dev.burst': () => { for (let i = 0; i < 5; i++) S.dispatch({ type: 'intake' }) },
    'dev.failIndex': (el) => S.dispatch({ type: 'devFailIndex', on: el.checked }),
    'dev.reset': () => S.dispatch({ type: 'reset' }),
  })

  // On phones the nav is a horizontal strip; keep the current page's button in view.
  let lastStripPage = null
  S.after(() => {
    if (lastStripPage === S.route.page) return
    lastStripPage = S.route.page
    const strip = document.querySelector('.rail-nav')
    const cur = strip && strip.querySelector('[aria-current="page"]')
    if (strip && cur && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = cur.offsetLeft - strip.offsetLeft - 12
  })

  window.addEventListener('DOMContentLoaded', () => S.render())
})()
