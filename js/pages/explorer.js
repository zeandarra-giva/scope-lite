// Ticket Explorer, ported from src/pages/Explorer.jsx.
;(function () {
  const { html, cls, attrs, style, icon, kpi, kpiShell, infoTip, prio } = S
  const { BREACH_REASONS, BUSINESS_APPS, CHANNELS, DAY, PRIORITIES, initials, PRODUCT_GROUPS, RES_GOAL_H, ROOT_CAUSES, avg, byId, fmtDate, fmtDateTime, fmtH, fmtTime } = S

  // Ticket Explorer works like a browser: the first tab is the explorer itself
  // (resolved tickets, codes, handovers) and is always there. Tickets and
  // resolution codes open in their own closable tabs beside it, and stay open
  // while you move around Scope.
  const tabKey = { ticket: (id) => 'tk:' + id, code: (c) => 'cd:' + c }

  // <option> with the selected attribute (the morph reads it to set the value).
  const opt = (cur, value, label = value) => html`<option value="${value}" ${attrs({ selected: String(cur) === String(value) })}>${label}</option>`

  // Page state. A deep link can carry { tab }, and also { ticket } or { code }
  // to open that resolved ticket or resolution code in its own tab.
  const pageUi = () => S.ui('p:explorer', () => {
    const r = S.route
    let active = 'home'
    if (r.ticket && S.state.history.some((h) => h.id === r.ticket)) active = tabKey.ticket(r.ticket)
    else if (r.code && S.state.codes.some((c) => c.code === r.code)) active = tabKey.code(r.code)
    if (active !== 'home') S.dispatch({ type: 'explorerTabOpen', id: active })
    return { section: r.tab || 'tickets', active }
  })

  // The open tabs, in the order they were opened.
  function openTabs(state) {
    return state.explorerTabs.map((k) => {
      if (k.startsWith('tk:')) { const h = state.history.find((x) => x.id === k.slice(3)); return h && { key: k, kind: 'ticket', h, label: h.desc, id: h.id } }
      const c = state.codes.find((x) => x.code === k.slice(3)); return c && { key: k, kind: 'code', c, label: c.title, id: c.code }
    }).filter(Boolean)
  }

  // Moving between the explorer sections or tabs drops the section's own state
  // (filters, the open drawer), as the React page did when it remounted them.
  const resetSections = () => S.resetUi('p:explorer:')
  const setActive = (key) => {
    const u = pageUi()
    if (u.active !== key) resetSections()
    S.set(u, { active: key })
  }
  const open = (key) => { S.dispatch({ type: 'explorerTabOpen', id: key }); setActive(key) }
  const openTicket = (id) => open(tabKey.ticket(id))
  const openCode = (code) => open(tabKey.code(code))
  const close = (key) => {
    const u = pageUi()
    const tabs = openTabs(S.state)
    const i = tabs.findIndex((t) => t.key === key)
    S.dispatch({ type: 'explorerTabClose', id: key })
    if (u.active === key) { const rest = tabs.filter((t) => t.key !== key); setActive(rest.length ? rest[Math.min(i, rest.length - 1)].key : 'home') }
  }

  S.pages.explorer = function Explorer() {
    const u = pageUi()
    const state = S.state
    const unacked = state.handovers.filter((h) => !h.acknowledged).length
    const tabs = openTabs(state)
    const cur = tabs.find((t) => t.key === u.active)
    return html`
      <div class="tabstrip" role="tablist" aria-label="Open tabs">
        <div class="${cls('btab pinned', !cur && 'on')}" role="tab" aria-selected="${!cur}">
          <button class="btab-open" data-click="explorer.tab" data-v="home">${icon('search', 15)}<span class="btab-t">Ticket Explorer</span></button>
        </div>
        ${tabs.map((t) => html`
          <div class="${cls('btab', u.active === t.key && 'on')}" role="tab" aria-selected="${u.active === t.key}" title="${t.id} · ${t.label}" data-key="${t.key}">
            <button class="btab-open" data-click="explorer.tab" data-v="${t.key}">
              ${icon(t.kind === 'code' ? 'book' : 'doc', 15)}<span class="btab-t"><span class="mono">${t.id}</span> ${t.label}</span>
            </button>
            <button class="btab-x" aria-label="Close ${t.id}" data-click="explorer.close" data-v="${t.key}">${icon('x', 13)}</button>
          </div>`)}
      </div>
      ${!cur && html`
        ${S.tabs([
          { id: 'tickets', label: 'Resolved tickets', count: state.history.length, icon: 'doc' },
          { id: 'codes', label: 'Resolution codes', count: state.codes.length, icon: 'book' },
          { id: 'handover', label: 'Handover log', count: unacked || null, icon: 'clip' },
        ], u.section, 'explorer.section')}
        ${u.section === 'tickets' && tickets()}
        ${u.section === 'codes' && codes()}
        ${u.section === 'handover' && handoverLog()}`}
      ${cur && cur.kind === 'ticket' && ticketPage(cur)}
      ${cur && cur.kind === 'code' && codePage(cur)}`
  }

  function ticketHead(h) {
    return html`<div class="row"><span class="mono">${h.id}</span>${prio(h.priority)}<span class="pill ${h.slaMet ? 'good' : 'crit'}">${h.slaMet ? 'SLA met' : 'SLA breached'}</span></div><h3 style="font:600 17px/1.3 var(--f-cond)">${h.desc}</h3>`
  }
  const ticketSub = (h) => html`<span class="small ink2">${h.businessApp} · ${h.productGroup} · ${h.channel} · ${byId[h.analyst]?.name} (${h.assignmentGroup})</span>`

  // A popped-out ticket: the same journey as the drawer, as a full page.
  function ticketPage(t) {
    const h = t.h
    return html`<section class="card ticket-page" data-key="${t.key}">
      <div class="card-h" style="align-items:flex-start">
        <div class="stack" style="gap:4px;flex:1;min-width:0">${ticketHead(h)}${ticketSub(h)}</div>
        <button class="btn sm" data-click="explorer.close" data-v="${t.key}">${icon('x', 14)}Close tab</button>
      </div>
      <div class="card-b stack lg">${journeyBody(h, { onOpen: 'explorer.openTicket', onCode: 'explorer.openCode' })}</div>
    </section>`
  }

  function tickets() {
    const state = S.state
    const f = S.ui('p:explorer:tickets', { q: '', pg: 'All', ch: 'All', app: 'All', fcr: 'All', flag: 'All', range: '30', open: null })
    const rows = state.history.filter((h) =>
      (f.range === 'all' || h.resolvedAt >= state.now - Number(f.range) * DAY) &&
      (f.pg === 'All' || h.productGroup === f.pg) && (f.ch === 'All' || h.channel === f.ch) && (f.app === 'All' || h.businessApp === f.app) &&
      (f.fcr === 'All' || (f.fcr === 'Yes') === h.fcr) &&
      (f.flag === 'All' || (f.flag === 'breached' && h.breachCode) || (f.flag === 'deflect' && h.deflect) || (f.flag === 'escalated' && h.escalatedTo)) &&
      (!f.q || `${h.id} ${h.desc} ${h.code} ${h.category} ${byId[h.analyst]?.name || ''} ${h.diagNote} ${h.fixNote}`.toLowerCase().includes(f.q.toLowerCase())))
    const count = (fn) => rows.filter(fn).length
    const k = {
      eze: avg(rows.map((r) => r.ezeH)), res: avg(rows.map((r) => r.resH)), lost: avg(rows.map((r) => r.lostH)),
      goal: rows.length ? rows.filter((r) => r.resH < RES_GOAL_H).length / rows.length : 0,
    }
    const cur = state.history.find((h) => h.id === f.open)
    return html`
      <section class="grid g-kpi">
        ${kpi({ label: 'Total records', icon: 'doc', value: rows.length.toLocaleString(), foot: `${f.range === 'all' ? 'All time' : `Last ${f.range} days`}` })}
        ${kpi({ label: 'Avg EZE MTTR', icon: 'clock', tone: 'azure', value: fmtH(k.eze), info: html`<span><b>End-to-end MTTR</b>: from the moment the ticket is opened in ServiceNow to the moment it is resolved.</span><span>Average of (resolved − opened) across the filtered tickets.</span>` })}
        ${kpi({ label: 'Avg RES MTTR', icon: 'bolt', tone: 'ice', value: fmtH(k.res), info: html`<span><b>Resolver MTTR</b>: from assignment to an analyst until resolution. This is the time the resolver actually owned the ticket.</span><span>Average of (resolved − assigned).</span>` })}
        ${kpi({ label: 'Avg lost time', icon: 'pause', tone: 'navy', value: fmtH(k.lost), info: html`<span><b>Lost time</b> = EZE MTTR − RES MTTR.</span><span>Time a ticket spent waiting in the queue or bouncing between groups before the right resolver had it. Turns amber above 2h.</span>`, state: k.lost > 2 ? 'warn' : undefined })}
        ${kpiShell({ label: `Goal: ≤${RES_GOAL_H} hours`, icon: 'check', state: k.goal >= 0.8 ? 'good' : k.goal >= 0.65 ? 'warn' : 'crit', info: html`
          <span>Share of filtered tickets whose RES MTTR is under ${RES_GOAL_H} hours.</span>
          <span>Team target is 80%. The marker on the bar shows the target; the card turns amber below 80% and red below 65%.</span>` }, html`
          <div class="kpi-v">${Math.round(k.goal * 100)}<small>% met</small></div>
          <div class="hbar-track" style="height:8px">
            <div class="hbar-fill" style="${style({ width: `${k.goal * 100}%`, background: k.goal >= 0.8 ? 'var(--good)' : 'var(--warn)' })}"></div>
            <div class="hbar-mark" style="left:80%" title="Target 80%"></div>
          </div>`)}
      </section>

      <section class="card">
        <div class="row" style="padding:12px">
          <input id="ex-q" class="in" placeholder="Search ticket, description or code" value="${f.q}" data-input="explorer.f" data-k="q" style="flex:1;min-width:200px;max-width:320px">
          <select id="ex-range" class="in" data-change="explorer.f" data-k="range" aria-label="Date range">${opt(f.range, '7', 'Last 7 days')}${opt(f.range, '30', 'Last 30 days')}${opt(f.range, '90', 'Last 90 days')}${opt(f.range, 'all', 'All time')}</select>
          <select id="ex-pg" class="in" data-change="explorer.f" data-k="pg" aria-label="Product group">${opt(f.pg, 'All')}${PRODUCT_GROUPS.map((x) => opt(f.pg, x))}</select>
          <select id="ex-ch" class="in" data-change="explorer.f" data-k="ch" aria-label="Channel">${opt(f.ch, 'All')}${CHANNELS.map((x) => opt(f.ch, x))}</select>
          <select id="ex-app" class="in" data-change="explorer.f" data-k="app" aria-label="Business app">${opt(f.app, 'All')}${BUSINESS_APPS.map((x) => opt(f.app, x))}</select>
          <select id="ex-fcr" class="in" data-change="explorer.f" data-k="fcr" aria-label="First contact resolution">${opt(f.fcr, 'All', 'FCR: all')}${opt(f.fcr, 'Yes')}${opt(f.fcr, 'No')}</select>
          <select id="ex-flag" class="in" data-change="explorer.f" data-k="flag" aria-label="Flags">
            ${opt(f.flag, 'All', 'All tickets')}${opt(f.flag, 'breached', 'SLA breached')}${opt(f.flag, 'deflect', 'Deflection candidates')}${opt(f.flag, 'escalated', 'Escalated')}
          </select>
          <span class="spacer"></span>
          <span class="row tight small ink2">
            <span class="pill crit">${count((h) => h.breachCode)} breached</span>
            <span class="pill accent">${count((h) => h.deflect)} deflectable</span>
            <span class="pill warn">${count((h) => h.escalatedTo)} escalated</span>
          </span>
        </div>
        <div class="tbl-wrap tbl-scroll">
          <table class="tbl">
            <thead><tr>
              <th>Ticket</th><th>Solved by</th><th>Problem category</th><th>Business app</th><th>Diagnosis note</th><th>Remedy / fix note</th><th>Code</th>
              <th>Date opened</th><th>Date resolved</th><th class="r">EZE MTTR</th><th class="r">RES MTTR</th><th class="r">Lost time</th><th>FCR</th>
              <th>Breach reason</th><th>Deflection</th><th>Escalated to</th>
            </tr></thead>
            <tbody>
              ${rows.slice(0, 200).map((h) => html`
                <tr class="click" data-click="explorer.row" data-v="${h.id}" data-key="${h.id}">
                  <td class="nowrap"><span class="mono">${h.id}</span>${h.fresh && html`<span class="pill accent plain" style="margin-left:6px">New</span>`}<div class="small muted" style="max-width:260px;overflow:hidden;text-overflow:ellipsis">${h.desc}</div></td>
                  <td class="nowrap"><span class="row tight"><span class="avatar sm">${initials(byId[h.analyst]?.name || '?')}</span>${byId[h.analyst]?.name || '—'}</span></td>
                  <td class="nowrap small">${h.category}</td>
                  <td class="nowrap">${h.businessApp}</td>
                  <td><div class="note-clip small ink2" ${attrs({ title: h.diagNote })}>${h.diagNote || '—'}</div></td>
                  <td><div class="note-clip small ink2" ${attrs({ title: h.fixNote })}>${h.fixNote || '—'}</div></td>
                  <td><span class="code-chip">${h.code}</span></td>
                  <td class="nowrap small">${fmtDateTime(h.openedAt)}</td>
                  <td class="nowrap small">${fmtDateTime(h.resolvedAt)}</td>
                  <td class="r">${fmtH(h.ezeH)}</td>
                  <td class="r" ${attrs({ style: h.resH >= RES_GOAL_H ? 'color:var(--crit)' : null })}>${fmtH(h.resH)}</td>
                  <td class="r">${fmtH(h.lostH)}</td>
                  <td><span class="pill ${h.fcr ? 'good' : 'plain'}">${h.fcr ? 'Yes' : 'No'}</span></td>
                  <td class="nowrap">${h.breachCode ? html`<span class="pill crit" title="${BREACH_REASONS[h.breachCode]} · ${fmtH(h.overH)} over the ${PRIORITIES[h.priority].slaH}h SLA">${h.breachCode} · +${fmtH(h.overH)}</span>` : html`<span class="muted">—</span>`}</td>
                  <td class="nowrap">${h.deflect ? html`<span class="pill accent" title="${h.deflect}">${icon('spark', 11)}Candidate</span>` : html`<span class="muted">—</span>`}</td>
                  <td class="nowrap small">${h.escalatedTo ? html`<span class="row tight">${icon('arrowR', 12)}${h.escalatedTo}</span>` : html`<span class="muted">—</span>`}</td>
                </tr>`)}
            </tbody>
          </table>
          ${!rows.length && html`<div class="empty">No resolved tickets match these filters.</div>`}
        </div>
        ${rows.length > 200 && html`<div class="small muted" style="padding:10px">Showing the 200 most recent of ${rows.length}. Narrow the filters to see more.</div>`}
      </section>
      ${cur && ticketJourney(cur)}`
  }

  function ticketJourney(h) {
    return S.drawer({
      onClose: 'explorer.drawerClose',
      title: ticketHead(h),
      sub: ticketSub(h),
      actions: html`<button class="icon-btn" data-click="explorer.popOut" data-v="${h.id}" aria-label="Open in a new tab" title="Open in a new tab">${icon('external', 16)}</button>`,
      body: journeyBody(h, { onOpen: 'explorer.drawerOpen' }),
    })
  }

  // onOpen and onCode are action names; the handler gets the ticket id or code in data-v.
  function journeyBody(h, { onOpen, onCode }) {
    const state = S.state
    const info = state.codes.find((c) => c.code === h.code)
    const a = (S.assist ? S.assist(h.desc, h.code, h.id) : null) || { similar: [] }
    const qaItems = [['Documentation complete', h.qa.documentation], ['Customer contact logged', h.qa.contactLogged], ['Correct resolution code', h.qa.correctCode], ['Fix validated with customer', h.qa.validated], ['SLA met', h.slaMet]]
    const score = Math.round((qaItems.filter((x) => x[1]).length / qaItems.length) * 100)
    return html`
      <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(110px, 1fr));gap:10px">
        ${[['EZE MTTR', fmtH(h.ezeH)], ['RES MTTR', fmtH(h.resH)], ['Lost time', fmtH(h.lostH)], ['FCR', h.fcr ? 'Yes' : 'No'], ['Transfers', h.transfers]].map(([k, v]) => html`
          <div class="stack" style="gap:2px"><span class="eyebrow">${k}</span><b class="num" style="font-size:18px;font-family:var(--f-cond)">${v}</b></div>`)}
      </div>
      <div class="callout accent" style="flex-direction:column;gap:4px">
        <div class="row"><span class="eyebrow">Resolution code</span><span class="code-chip" style="font-size:14px">${h.code}</span>${onCode && html`<button class="btn ghost sm" data-click="${onCode}" data-v="${h.code}">${icon('book', 13)}Open code</button>`}${info?.automatable && html`<span class="pill plain">${icon('bolt', 11)}Automatable</span>`}</div>
        <b>${info?.title}</b>
        ${info && html`<span class="small ink2">${ROOT_CAUSES[info.cause].label} · ${ROOT_CAUSES[info.cause].subs[info.sub]} · ${info.runbook}</span>`}
      </div>
      <div class="stack">
        <div class="section-title">Resolution details</div>
        <dl class="details">
          <dt>Solved by</dt><dd><span class="row tight"><span class="avatar sm">${initials(byId[h.analyst]?.name || '?')}</span>${byId[h.analyst]?.name} · ${h.assignmentGroup}</span></dd>
          <dt>Problem category</dt><dd>${h.category}</dd>
          <dt>Business application</dt><dd>${h.businessApp}</dd>
          <dt>Diagnosis note</dt><dd>${h.diagNote || '—'}</dd>
          <dt>Remedy / fix note</dt><dd>${h.fixNote || '—'}</dd>
          <dt>Breach reason</dt><dd>${h.breachCode ? html`<span class="pill crit">${h.breachCode}</span> ${BREACH_REASONS[h.breachCode]} · ${fmtH(h.overH)} over the ${PRIORITIES[h.priority].slaH}h SLA` : html`<span class="muted">SLA met</span>`}</dd>
          <dt>Deflection candidate</dt><dd>${h.deflect ? html`<span class="pill accent">Yes</span> ${h.deflect}` : html`<span class="muted">No</span>`}</dd>
          <dt>Escalation target</dt><dd>${h.escalatedTo ? `${h.escalatedTo} (${h.transfers} transfer${h.transfers > 1 ? 's' : ''})` : html`<span class="muted">Not escalated</span>`}</dd>
        </dl>
      </div>
      <div class="stack">
        <div class="section-title">Resolution journey</div>
        <ol class="timeline">
          ${h.journey.map((j) => html`
            <li>
              <span class="t">${fmtDate(j.at)}<br>${fmtTime(j.at)}</span>
              <span class="rail-l ${j.stage === 'Transfer' ? 'warn' : j.stage === 'Validated' ? 'good' : ''}"></span>
              <div class="c"><b>${j.stage}</b><span class="small ink2">${j.note}</span></div>
            </li>`)}
        </ol>
      </div>
      <div class="stack">
        <div class="row"><div class="section-title">QA score</div><span class="spacer"></span><span class="pill ${score >= 80 ? 'good' : score >= 60 ? 'warn' : 'crit'}">${score}/100</span></div>
        ${qaItems.map(([l, ok]) => html`<div class="row small"><span style="color:${ok ? 'var(--good)' : 'var(--crit)'}">${icon(ok ? 'check' : 'x', 15)}</span>${l}</div>`)}
      </div>
      <div class="stack">
        <div class="row"><div class="section-title">Similar incidents</div><span class="muted small">keyword match, no AI</span></div>
        ${a.similar.map((s) => html`
          <button class="list-row small" style="background:none;border:0;border-bottom:1px solid var(--line);cursor:pointer;text-align:left" data-click="${onOpen}" data-v="${s.id}" data-key="sim-${s.id}">
            <span class="mono">${s.id}</span>
            <span class="ink2" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.desc}</span>
            <span class="code-chip">${s.code}</span><span class="num muted">${fmtH(s.resH)}</span>
          </button>`)}
        ${!a.similar.length && html`<span class="muted small">No close matches.</span>`}
      </div>`
  }

  function codes() {
    const state = S.state
    const u = S.ui('p:explorer:codes', { cat: 'All' })
    const stats = state.codes.map((c) => {
      const used = state.history.filter((h) => h.code === c.code)
      return { ...c, n: used.length, res: avg(used.map((x) => x.resH)), fcr: used.length ? used.filter((x) => x.fcr).length / used.length : NaN, last: Math.max(0, ...used.map((x) => x.resolvedAt)) }
    }).filter((c) => u.cat === 'All' || c.cause === u.cat).sort((a, b) => b.n - a.n)
    return html`<section class="card">
      <div class="row" style="padding:12px">
        <select id="code-cat" class="in" data-change="explorer.cat" aria-label="Category">${opt(u.cat, 'All', 'All categories')}${Object.entries(ROOT_CAUSES).map(([k, v]) => opt(u.cat, k, v.label))}</select>
        <span class="spacer"></span>
        ${infoTip('explorer-codes', 'Resolution codes', html`
          <span>Format <span class="mono">CATEGORY-SUBCATEGORY-NN</span>, e.g. NET-VPN-01. The category and subcategory come from the root cause picked in the resolution journey.</span>
          <span>A new code is minted when an analyst marks a fix as new. <b>Auto-fix</b> codes can be proposed as automated fixes that a team lead approves.</span>`)}
      </div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Code</th><th>Resolution</th><th>Root cause</th><th>Runbook</th><th class="r">Uses</th><th class="r">Avg RES MTTR</th><th class="r">FCR rate</th><th>Last used</th><th>Automation</th></tr></thead>
          <tbody>
            ${stats.map((c) => html`
              <tr class="click" data-click="explorer.openCode" data-v="${c.code}" title="Open in a new tab" data-key="${c.code}">
                <td class="nowrap"><span class="code-chip">${c.code}</span> ${icon('external', 12)}</td>
                <td style="min-width:220px">${c.title}</td>
                <td class="nowrap small">${ROOT_CAUSES[c.cause].label} · ${ROOT_CAUSES[c.cause].subs[c.sub]}</td>
                <td class="nowrap small">${c.runbook}</td>
                <td class="r">${c.n}</td>
                <td class="r" ${attrs({ style: c.res >= RES_GOAL_H ? 'color:var(--crit)' : null })}>${fmtH(c.res)}</td>
                <td class="r">${isNaN(c.fcr) ? '—' : Math.round(c.fcr * 100) + '%'}</td>
                <td class="nowrap small">${c.last ? fmtDate(c.last) : '—'}</td>
                <td>${c.automatable ? html`<span class="pill accent" ${attrs({ title: c.fix })}>Auto-fix</span>` : html`<span class="pill plain">Manual</span>`}</td>
              </tr>`)}
          </tbody>
        </table>
      </div>
    </section>`
  }

  function handoverLog() {
    const state = S.state
    return html`<section class="card">
      <div class="card-h"><h2>Shift handover history</h2><span class="muted small">Submitted from Home → Shift handover. The next shift acknowledges each one.</span></div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>ID</th><th>When</th><th>Shift</th><th>From → To</th><th class="r">Resolved</th><th class="r">Open critical</th><th>Notes</th><th>Status</th></tr></thead>
          <tbody>
            ${state.handovers.map((h) => html`
              <tr data-key="${h.id}">
                <td class="mono">${h.id}</td>
                <td class="nowrap small">${fmtDateTime(h.at)}</td>
                <td class="nowrap">${h.shift}</td>
                <td class="nowrap">${h.by} → ${h.to}</td>
                <td class="r">${h.resolved}</td>
                <td class="r" ${attrs({ style: h.openCritical ? 'color:var(--crit)' : null })}>${h.openCritical}</td>
                <td style="min-width:260px" class="small">${h.notes}</td>
                <td class="nowrap">${h.acknowledged ? html`<span class="pill good">Acknowledged</span>` : html`<button class="btn sm" data-click="explorer.ack" data-v="${h.id}">Acknowledge</button>`}</td>
              </tr>`)}
          </tbody>
        </table>
      </div>
    </section>`
  }

  // A resolution code opened in its own tab: its runbook, how it performs and
  // the tickets it closed.
  function codePage(t) {
    const c = t.c
    const state = S.state
    const used = state.history.filter((h) => h.code === c.code)
    const recent = used.filter((h) => h.resolvedAt >= state.now - 30 * DAY)
    const live = S.pageForCode(state.kb, state.kb.kbs.map((k) => k.id), c.code)
    const draft = !live && S.pageForCode(state.kb, state.kb.kbs.map((k) => k.id), c.code, { published: false })
    const steps = live && (S.chunksOf(live).find((x) => /steps|workaround/i.test(x.heading)) || S.chunksOf(live)[0])
    const apps = Object.entries(used.reduce((m, h) => ({ ...m, [h.businessApp]: (m[h.businessApp] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])
    const fcr = used.length ? used.filter((x) => x.fcr).length / used.length : NaN
    const kbPage = live || draft
    return html`<div style="display:contents" data-key="${t.key}">
      <section class="card">
        <div class="card-h" style="align-items:flex-start">
          <div class="stack" style="gap:6px;flex:1;min-width:0">
            <div class="row"><span class="code-chip" style="font-size:14px">${c.code}</span>${c.automatable ? html`<span class="pill accent">${icon('bolt', 11)}Auto-fix</span>` : html`<span class="pill plain">Manual</span>`}</div>
            <h2>${c.title}</h2>
            <span class="small ink2">${ROOT_CAUSES[c.cause].label} › ${ROOT_CAUSES[c.cause].subs[c.sub]} · ${c.runbook}${c.automatable ? ` · ${c.fix}` : ''}</span>
          </div>
          <button class="btn sm" data-click="explorer.close" data-v="${t.key}">${icon('x', 14)}Close tab</button>
        </div>
        <div class="card-b grid" style="grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px">
          ${[['Uses', used.length], ['Last 30 days', recent.length], ['Avg RES MTTR', fmtH(avg(used.map((x) => x.resH)))], ['FCR rate', isNaN(fcr) ? '—' : Math.round(fcr * 100) + '%'], ['Last used', used.length ? fmtDate(Math.max(...used.map((x) => x.resolvedAt))) : '—']].map(([k, v]) => html`
            <div class="stack" style="gap:2px"><span class="eyebrow">${k}</span><b class="num" style="font-size:18px">${v}</b></div>`)}
        </div>
      </section>
      <section class="grid g-3-1">
        <div class="card">
          <div class="card-h"><h3>Runbook</h3>${live && html`<span class="muted small">${live.live.title} · v${live.live.version}</span>`}<span class="spacer"></span>
            ${kbPage && html`<button class="btn ghost sm" data-click="explorer.kbOpen" data-v="${kbPage.id}">${icon('book', 14)}Open in Knowledge Base</button>`}
          </div>
          <div class="card-b">
            ${steps ? S.docText(steps.text)
              : draft ? html`<div class="callout warn small">${icon('alert', 15)}<span><b>${draft.draft.title}</b> is a draft only. Copilot and analysts can't rely on it until it's published.</span></div>`
              : html`<div class="callout warn small">${icon('alert', 15)}<span>No knowledge base page covers this code yet.</span><span class="spacer"></span><button class="btn sm" data-click="explorer.kbWrite" data-v="${c.code}" data-runbook="${c.runbook}">${icon('plus', 13)}Write it</button></div>`}
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Business apps</h3></div>
          <div class="card-b stack">
            ${apps.map(([a, n]) => html`<div class="row small"><span style="flex:1">${a}</span><b class="num">${n}</b></div>`)}
            ${!apps.length && html`<span class="muted small">Not used yet.</span>`}
          </div>
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h3>Tickets closed with this code</h3><span class="muted small">most recent first · click to open in a tab</span></div>
        <div class="tbl-wrap tbl-scroll">
          <table class="tbl">
            <thead><tr><th>Ticket</th><th>Solved by</th><th>Business app</th><th>Resolved</th><th class="r">RES MTTR</th><th>SLA</th></tr></thead>
            <tbody>
              ${used.slice(0, 50).map((h) => html`
                <tr class="click" data-click="explorer.openTicket" data-v="${h.id}" data-key="${h.id}">
                  <td class="nowrap"><span class="mono">${h.id}</span><div class="small muted" style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${h.desc}</div></td>
                  <td class="nowrap">${byId[h.analyst]?.name || '—'}</td>
                  <td class="nowrap">${h.businessApp}</td>
                  <td class="nowrap small">${fmtDateTime(h.resolvedAt)}</td>
                  <td class="r">${fmtH(h.resH)}</td>
                  <td><span class="pill ${h.slaMet ? 'good' : 'crit'}">${h.slaMet ? 'Met' : 'Breached'}</span></td>
                </tr>`)}
            </tbody>
          </table>
          ${!used.length && html`<div class="empty">No tickets have used this code yet.</div>`}
        </div>
      </section>
    </div>`
  }

  // ---------- Handlers ----------
  S.on({
    'explorer.tab': (el) => setActive(el.dataset.v),
    'explorer.close': (el) => close(el.dataset.v),
    'explorer.section': (el) => {
      const u = pageUi()
      if (u.section !== el.dataset.v) resetSections()
      S.set(u, { section: el.dataset.v })
    },
    'explorer.openTicket': (el) => openTicket(el.dataset.v),
    'explorer.openCode': (el) => openCode(el.dataset.v),
    // Resolved tickets: filters and the journey drawer.
    'explorer.f': (el) => S.set(S.ui('p:explorer:tickets'), { [el.dataset.k]: el.value }),
    'explorer.row': (el) => S.set(S.ui('p:explorer:tickets'), { open: el.dataset.v }),
    'explorer.drawerOpen': (el) => S.set(S.ui('p:explorer:tickets'), { open: el.dataset.v }),
    'explorer.drawerClose': () => S.set(S.ui('p:explorer:tickets'), { open: null }),
    'explorer.popOut': (el) => { S.ui('p:explorer:tickets').open = null; openTicket(el.dataset.v) },
    'explorer.cat': (el) => S.set(S.ui('p:explorer:codes'), { cat: el.value }),
    'explorer.ack': (el) => S.dispatch({ type: 'ackHandover', id: el.dataset.v }),
    'explorer.kbOpen': (el) => S.nav('kb', { kbPage: el.dataset.v }),
    'explorer.kbWrite': (el) => S.nav('kb', { create: el.dataset.runbook, code: el.dataset.v }),
  })
})()
