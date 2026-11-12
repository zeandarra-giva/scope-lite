// Queue Management (QM): the first part of Scope that runs on real team data.
//
// Manual INC entries: analysts log INC tickets they handled that weren't assigned
// to them or their application/queue, so the work is tracked and credited. A lead
// verifies each entry before it counts. Scope can't look the INC up in ServiceNow
// yet ([NO-CSI]: no API access), so a person checks it.
//
// Storage is the shared ops log: the host server appends every event to
// data/ops.jsonl with a seq, the time and who sent it (/api/ops). Every browser
// folds the same log into the same list. Who you are comes from the real roster,
// data/roster.json (/api/roster). Nothing here is sample data, so QM needs the
// server: opened straight from index.html it explains how to start it.
;(function () {
  const { html, cls, attrs, icon, storage, uid } = S

  const ME_KEY = 'scope-lite-me'
  const TODAY_KEY = 'scope-lite-today'
  const INC_RE = /^INC\d{7,}$/ // ServiceNow default numbering; confirm against a real export
  const STATUS_TONE = { Pending: 'warn', Verified: 'good', Rejected: 'crit', Withdrawn: '' }
  const STATUSES = ['Pending', 'Verified', 'Rejected', 'Withdrawn']

  // ---------- Store ----------
  const qm = { online: null, error: null, roster: [], entries: [], events: null, loadedAt: null }
  S.qm = qm

  // Weekly roles and shifts the sign-in asks for (Team Operating Model §2–§3).
  // Shift times follow the team-wide shift mode; the weekend uses Early hours.
  S.DUTIES = [
    { id: 'MAIN_PROCI', label: 'Main Proci', desc: 'Severity Line and the handover, in and out. Not on the Support Line.' },
    { id: 'PROCI_BACKUP', label: 'Proci Backup', desc: "QM, EERS tickets and the Support Line. Covers the Main Proci's breaks." },
    { id: 'WEEKEND_SUPPORT', label: 'Weekend Support', desc: 'All BAUs on Saturday and Sunday, at Early hours.' },
    { id: 'ANALYST', label: 'Analyst', desc: 'INC and CMP tickets and the Support Line.' },
  ]
  S.SHIFTS = [
    { id: 'EARLY', label: 'Early', times: 'Mode 1 05:00–14:00 · Mode 2 06:00–15:00' },
    { id: 'LATE', label: 'Late', times: 'Mode 1 06:00–15:00 · Mode 2 07:00–16:00' },
    { id: 'WEEKEND', label: 'Weekend', times: 'Saturday–Sunday, Early hours of the current mode' },
  ]
  S.dutyLabel = (id) => (S.DUTIES.find((d) => d.id === id) || {}).label || id
  S.shiftLabel = (id) => (S.SHIFTS.find((d) => d.id === id) || {}).label || id

  const person = (soeid) => qm.roster.find((p) => p.soeid === soeid)
  const nameOf = (soeid) => (person(soeid) || {}).name || soeid
  const me = () => {
    const p = person(storage.get(ME_KEY))
    return p && p.active !== false ? p : null
  }
  // Role and shift are for today only; tomorrow's sign-in asks again.
  const dayKey = () => new Date().toDateString()
  const today = () => {
    try { const t = JSON.parse(storage.get(TODAY_KEY) || 'null'); return t && t.day === dayKey() ? t : null } catch { return null }
  }
  qm.me = () => (qm.roster.length ? me() : null)
  qm.today = today
  // Signing in also tells the team you're on shift today, in this role (queue.js hands out tickets by it).
  const isoDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  qm.signIn = (soeid, duty, shift, { auto = false } = {}) => {
    storage.set(ME_KEY, soeid); storage.set(TODAY_KEY, JSON.stringify({ duty, shift, day: dayKey() }))
    send({ type: 'shiftStart', day: isoDay(), duty, shift, auto })
  }
  // Guardrail (schedule.js): changing today's role or shift after signing in needs a
  // reason, and is recorded like any other event, so the team can see it.
  qm.changeToday = async (duty, shift, reason) => {
    const ok = await send({ type: 'shiftStart', day: isoDay(), duty, shift, edited: true, reason })
    if (ok) storage.set(TODAY_KEY, JSON.stringify({ duty, shift, day: dayKey() }))
    return ok
  }
  qm.signOut = () => { storage.set(ME_KEY, null); storage.set(TODAY_KEY, null) }
  const isLead = () => (me() || {}).accessRole === 'Lead'
  // Entries a lead can act on: pending, and not their own.
  const toVerify = () => qm.entries.filter((x) => x.status === 'Pending' && x.by !== (me() || {}).soeid)
  qm.badge = () => (isLead() ? toVerify().length : 0)

  // Fold the ops log into entries. The rules live here; the server only checks
  // the shape of an event and that its sender is on the roster (and a lead, to decide).
  //  - An entry starts Pending. Only its author can withdraw it, and only while Pending.
  //  - A lead verifies or rejects it. A reject needs a note so the analyst knows why.
  //    A lead can change a decision later, but never decides on their own entry.
  function fold(events) {
    const byId = new Map()
    for (const ev of events) {
      const e = ev.e || {}
      if (e.type === 'manualIncAdd') {
        if (!byId.has(e.id)) byId.set(e.id, { id: e.id, inc: e.inc, handledAt: e.handledAt, actions: e.actions, reason: e.reason, group: e.group || '', duty: e.duty || '', shift: e.shift || '', by: ev.by, at: ev.at, status: 'Pending', history: [] })
        continue
      }
      const x = byId.get(e.id)
      if (!x) continue
      if (e.type === 'manualIncWithdraw' && ev.by === x.by && x.status === 'Pending') {
        x.status = 'Withdrawn'
        x.history.push({ to: 'Withdrawn', by: ev.by, at: ev.at, note: '' })
      } else if (e.type === 'manualIncDecide' && ev.by !== x.by && x.status !== 'Withdrawn'
        && (e.decision === 'Verified' || (e.decision === 'Rejected' && String(e.note || '').trim()))) {
        x.status = e.decision
        x.history.push({ to: e.decision, by: ev.by, at: ev.at, note: e.note || '' })
      }
    }
    return [...byId.values()].sort((a, b) => b.handledAt - a.handledAt || b.at - a.at)
  }
  const decision = (x) => x.history.filter((h) => h.to === 'Verified' || h.to === 'Rejected').pop()

  async function load() {
    if (location.protocol === 'file:') { qm.online = false; S.render(); return }
    try {
      const [r1, r2] = await Promise.all([fetch('api/roster', { cache: 'no-store' }), fetch('api/ops', { cache: 'no-store' })])
      for (const r of [r1, r2]) if (!r.ok) throw new Error(r.status === 404 ? 'this server is an older version. Restart it with run.bat or share.bat' : (await r.text()) || `server answered ${r.status}`)
      qm.roster = await r1.json()
      qm.events = await r2.json()
      qm.entries = fold(qm.events)
      Object.assign(qm, { online: true, error: null, loadedAt: Date.now() })
    } catch (err) {
      qm.error = qm.online ? 'Lost the connection to the Scope Lite server. Check that its window is still open.' : `Couldn't load Queue Management: ${err.message}`
      if (qm.online === null) qm.online = false
    }
    S.render()
  }

  async function send(e) {
    const m = me()
    if (!m) { S.dispatch({ type: 'toast', text: 'Pick who you are first' }); return false }
    try {
      const t = today()
      const r = await fetch('api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, eid: uid('e'), by: m.soeid, ...(t && { duty: t.duty, shift: t.shift }), ...e }) })
      if (!r.ok) throw new Error((await r.text()) || `server answered ${r.status}`)
      await load()
      return true
    } catch (err) {
      S.dispatch({ type: 'toast', text: `Couldn't save: ${err.message}` })
      return false
    }
  }

  qm.send = send

  // Pick up the rest of the team's entries every 15 seconds and on focus.
  setInterval(() => { if (qm.online && !document.hidden) load() }, 15e3)
  window.addEventListener('focus', () => { if (qm.online) load() })
  load()

  // ---------- Helpers ----------
  const fmtWhen = (ms) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  // <input type="datetime-local"> wants local time as YYYY-MM-DDTHH:MM.
  const toLocalInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60e3); return d.toISOString().slice(0, 16) }
  const statusPill = (s) => html`<span class="${cls('pill', STATUS_TONE[s])}">${s}</span>`
  const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime() }
  const verifiedAt = (x) => (x.status === 'Verified' ? decision(x).at : null)

  // ---------- Log form ----------
  const blankForm = () => ({ inc: '', when: toLocalInput(Date.now()), actions: '', reason: '', group: '', tried: false, sending: false })
  const form = () => S.ui('qm:form', blankForm)
  function check(f) {
    const inc = f.inc.trim().toUpperCase()
    const when = f.when ? new Date(f.when).getTime() : NaN
    const errors = {
      inc: !inc ? 'Enter the INC number.' : !INC_RE.test(inc) ? 'It should look like INC0012345.' : null,
      when: !f.when || isNaN(when) ? 'Add the date and time you handled it.' : when > Date.now() + 5 * 60e3 ? "That's in the future." : null,
      actions: !f.actions.trim() ? 'Describe the actions you took.' : null,
      reason: !f.reason.trim() ? 'Say why this needs a manual entry.' : null,
    }
    return { inc, when, errors, ok: !Object.values(errors).some(Boolean) }
  }

  function logForm() {
    const f = form()
    const { inc, errors } = check(f)
    const err = (k) => f.tried && errors[k] && html`<span class="qm-err" role="alert">${errors[k]}</span>`
    const dups = INC_RE.test(inc) ? qm.entries.filter((x) => x.inc === inc && x.status !== 'Withdrawn') : []
    return html`<div class="card"><div class="card-b">
      <form class="stack" style="gap:14px" data-submit="qm.submit" id="qm-form">
        <div class="form-grid qm-form-top">
          <label class="field"><span>INC number</span>
            <input class="in mono" name="inc" maxlength="20" autocomplete="off" spellcheck="false" value="${f.inc}" placeholder="INC0012345" data-input="qm.field" data-autofocus>
            ${err('inc')}</label>
          <label class="field"><span>Date and time handled</span>
            <input class="in" type="datetime-local" name="when" value="${f.when}" max="${toLocalInput(Date.now())}" data-input="qm.field" data-change="qm.field">
            ${err('when')}</label>
          <label class="field"><span>Assigned group or application <span class="hint">optional, if you know it</span></span>
            <input class="in" name="group" maxlength="80" value="${f.group}" placeholder="Where the ticket was assigned" data-input="qm.field"></label>
        </div>
        ${dups.length > 0 && html`<div class="callout warn">${icon('alert', 16)}<span><b>${inc} is already logged</b> by ${dups.map((x, i) => html`${i > 0 && ', '}${nameOf(x.by)} (${x.status.toLowerCase()}, ${fmtWhen(x.handledAt)})`)}. If you worked on it too, log it anyway. The lead will decide.</span></div>`}
        <label class="field"><span>Actions taken</span>
          <textarea class="in" name="actions" rows="4" maxlength="4000" placeholder="What you did on the ticket, in order" data-input="qm.field" data-keydown="qm.keys">${f.actions}</textarea>
          ${err('actions')}</label>
        <label class="field"><span>Reason for manual entry</span>
          <textarea class="in" name="reason" rows="2" maxlength="1000" placeholder="Why this ticket isn't assigned to you or your queue" data-input="qm.field" data-keydown="qm.keys">${f.reason}</textarea>
          ${err('reason')}</label>
        <div class="row">
          <span class="small muted">${icon('shield', 14)} Don't paste passwords or customers' personal details. <span class="kbd">Ctrl</span> + <span class="kbd">Enter</span> logs it.</span>
          <span class="spacer"></span>
          <button class="btn ghost" type="button" data-click="qm.clear">Clear</button>
          <button class="btn primary" type="submit" ${attrs({ disabled: f.sending })}>${icon('plus', 15)}${f.sending ? 'Logging…' : 'Log ticket'}</button>
        </div>
      </form>
    </div></div>`
  }

  async function submit() {
    const f = form()
    const { inc, when, ok } = check(f)
    if (!ok) { S.set(f, { tried: true }); return }
    S.set(f, { sending: true })
    const sent = await send({ type: 'manualIncAdd', id: uid('mi'), inc, handledAt: when, actions: f.actions.trim(), reason: f.reason.trim(), group: f.group.trim() })
    if (!sent) { S.set(f, { sending: false }); return }
    S.set(f, blankForm())
    S.dispatch({ type: 'toast', text: `${inc} logged. A lead will verify it.` })
  }

  // ---------- Lists ----------
  function table(list, { who = false, empty }) {
    if (!list.length) return html`<div class="empty">${empty}</div>`
    return html`<div class="tbl-wrap tbl-scroll"><table class="tbl qm-tbl">
      <thead><tr><th>INC</th><th>Handled</th>${who && html`<th>Analyst</th>`}<th>Reason</th><th>Status</th></tr></thead>
      <tbody>${list.map((x) => html`<tr data-key="${x.id}" class="${cls(S.ui('p:qm').sel === x.id && 'sel')}">
        <td><button class="btn ghost sm mono" data-click="qm.select" data-v="${x.id}">${x.inc}</button></td>
        <td class="nowrap">${fmtWhen(x.handledAt)}</td>
        ${who && html`<td>${nameOf(x.by)}</td>`}
        <td class="qm-clip" title="${x.reason}">${x.reason}</td>
        <td>${statusPill(x.status)}</td>
      </tr>`)}</tbody></table></div>`
  }

  // Credit per person this month: only verified entries count.
  function creditTable() {
    const from = startOfMonth()
    const rows = qm.roster.filter((p) => p.active !== false || qm.entries.some((x) => x.by === p.soeid)).map((p) => {
      const mine = qm.entries.filter((x) => x.by === p.soeid)
      return { p, verified: mine.filter((x) => verifiedAt(x) >= from).length, pending: mine.filter((x) => x.status === 'Pending').length, rejected: mine.filter((x) => x.status === 'Rejected').length }
    }).filter((r) => r.verified + r.pending + r.rejected > 0).sort((a, b) => b.verified - a.verified || a.p.name.localeCompare(b.p.name))
    return html`<div class="card"><div class="card-h"><b>Credit this month</b><span class="muted small">Verified entries count; pending ones don't yet</span></div>
      ${rows.length ? html`<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Analyst</th><th class="num">Verified this month</th><th class="num">Waiting</th><th class="num">Rejected</th></tr></thead>
        <tbody>${rows.map((r) => html`<tr data-key="${r.p.soeid}"><td>${r.p.name} <span class="muted small mono">${r.p.soeid}</span></td><td class="num">${r.verified}</td><td class="num">${r.pending}</td><td class="num">${r.rejected}</td></tr>`)}</tbody>
      </table></div>` : html`<div class="card-b empty">No entries yet.</div>`}
    </div>`
  }

  function allEntries(u) {
    const q = u.q.trim().toLowerCase()
    const list = qm.entries
      .filter((x) => u.status === 'all' || x.status === u.status)
      .filter((x) => u.who === 'all' || x.by === u.who)
      .filter((x) => !q || [x.inc, x.actions, x.reason, x.group, nameOf(x.by), x.by].join(' ').toLowerCase().includes(q))
    const people = [...new Set(qm.entries.map((x) => x.by))].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
    return html`<div class="stack" style="gap:16px">
      ${creditTable()}
      <div class="card">
        <div class="card-h qm-toolbar">
          <div class="kb-search">${icon('search', 16)}<input type="search" placeholder="Search INC, actions, reasons, names" value="${u.q}" data-input="qm.q" aria-label="Search entries"></div>
          <select class="in" aria-label="Status" data-change="qm.filter" data-f="status">
            <option value="all" ${attrs({ selected: u.status === 'all' })}>Any status</option>
            ${STATUSES.map((s) => html`<option ${attrs({ selected: u.status === s })}>${s}</option>`)}
          </select>
          <select class="in" aria-label="Analyst" data-change="qm.filter" data-f="who">
            <option value="all" ${attrs({ selected: u.who === 'all' })}>Everyone</option>
            ${people.map((s) => html`<option value="${s}" ${attrs({ selected: u.who === s })}>${nameOf(s)}</option>`)}
          </select>
          <span class="spacer"></span>
          <button class="btn ghost sm" data-click="qm.csv" ${attrs({ disabled: !list.length })}>${icon('table', 14)}Export for Excel</button>
        </div>
        ${table(list, { who: true, empty: qm.entries.length ? 'Nothing matches these filters.' : 'No entries yet.' })}
      </div>
    </div>`
  }

  function exportCsv() {
    const u = S.ui('p:qm')
    const q = u.q.trim().toLowerCase()
    const list = qm.entries
      .filter((x) => u.status === 'all' || x.status === u.status)
      .filter((x) => u.who === 'all' || x.by === u.who)
      .filter((x) => !q || [x.inc, x.actions, x.reason, x.group, nameOf(x.by), x.by].join(' ').toLowerCase().includes(q))
    const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`
    const head = ['INC number', 'Date/time handled', 'Analyst', 'SOEID', 'Assigned group or application', 'Role that day', 'Shift', 'Actions taken', 'Reason for manual entry', 'Status', 'Decided by', 'Decided at', 'Decision note', 'Logged at', 'Entry ID']
    const rows = list.map((x) => { const d = decision(x); return [x.inc, fmtWhen(x.handledAt), nameOf(x.by), x.by, x.group, x.duty ? S.dutyLabel(x.duty) : '', x.shift ? S.shiftLabel(x.shift) : '', x.actions, x.reason, x.status, d ? nameOf(d.by) : '', d ? fmtWhen(d.at) : '', d ? d.note : '', fmtWhen(x.at), x.id] })
    // BOM so Excel opens accented names correctly.
    S.download(`scope-manual-inc-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n'), 'text/csv')
  }

  // ---------- Entry drawer ----------
  function entryDrawer(x, u) {
    const m = me()
    const mine = m && x.by === m.soeid
    const canDecide = isLead() && !mine && x.status !== 'Withdrawn'
    const timeline = [{ to: 'Logged', by: x.by, at: x.at, note: '' }, ...x.history]
    S.drawer({
      className: 'qm-drawer',
      onClose: 'qm.deselect',
      title: html`<span class="row tight">${statusPill(x.status)}</span><h2 class="drawer-title mono">${x.inc}</h2>`,
      sub: html`<span class="muted small">${nameOf(x.by)} · handled ${fmtWhen(x.handledAt)}</span>`,
      body: html`<div class="stack" style="gap:16px">
        <dl class="qm-dl">
          <dt>Analyst</dt><dd>${nameOf(x.by)} <span class="muted small mono">${x.by}</span></dd>
          <dt>Handled</dt><dd>${fmtWhen(x.handledAt)}</dd>
          ${x.duty && html`<dt>Role and shift</dt><dd>${S.dutyLabel(x.duty)} · ${S.shiftLabel(x.shift)}</dd>`}
          <dt>Assigned group or app</dt><dd>${x.group || html`<span class="muted">Not given</span>`}</dd>
          <dt>Actions taken</dt><dd class="qm-pre">${x.actions}</dd>
          <dt>Reason for manual entry</dt><dd class="qm-pre">${x.reason}</dd>
        </dl>
        <div class="stack" style="gap:8px">
          <span class="eyebrow">History</span>
          ${timeline.map((h) => html`<div class="small"><b>${nameOf(h.by)}</b> ${h.to === 'Logged' ? 'logged it' : h.to === 'Withdrawn' ? 'withdrew it' : html`marked it <b>${h.to.toLowerCase()}</b>`} · <span class="muted">${fmtWhen(h.at)}</span>${h.note && html`<div class="qm-pre ink2">“${h.note}”</div>`}</div>`)}
        </div>
        ${canDecide && html`<div class="stack qm-decide" style="gap:8px">
          <span class="eyebrow">${x.status === 'Pending' ? 'Verify this entry' : 'Change the decision'}</span>
          <span class="small muted">Check the INC in ServiceNow: did ${nameOf(x.by)} work on it, as described?</span>
          <label class="field"><span>Note <span class="hint">needed to reject</span></span>
            <textarea class="in" rows="2" maxlength="1000" placeholder="e.g. what's missing, or why it doesn't count" data-input="qm.note">${u.note}</textarea></label>
          ${u.noteTried && !u.note.trim() && html`<span class="qm-err" role="alert">Add a note so ${nameOf(x.by)} knows why it was rejected.</span>`}
          <div class="row">
            <span class="spacer"></span>
            ${x.status !== 'Rejected' && html`<button class="btn" data-click="qm.decide" data-v="${x.id}" data-d="Rejected">${icon('x', 14)}Reject</button>`}
            ${x.status !== 'Verified' && html`<button class="btn primary" data-click="qm.decide" data-v="${x.id}" data-d="Verified">${icon('check', 14)}Verify and credit</button>`}
          </div>
        </div>`}
        ${mine && x.status === 'Pending' && html`<div class="row"><span class="small muted">Logged it by mistake? You can withdraw it until a lead decides.</span><span class="spacer"></span><button class="btn sm" data-click="qm.withdraw" data-v="${x.id}">Withdraw</button></div>`}
      </div>`,
    })
  }

  // ---------- Page ----------
  function notice(tone, ic, body, action) {
    return html`<div class="callout ${tone}">${icon(ic, 16)}<span>${body}</span>${action && html`<span class="spacer"></span>${action}`}</div>`
  }

  S.pages.qm = function qmPage() {
    const u = S.ui('p:qm', { tab: 'tickets', sel: null, tsel: null, tnote: '', moveTo: '', q: '', status: 'all', who: 'all', note: '', noteTried: false })
    if (location.protocol === 'file:') return notice('warn', 'info', html`<b>Queue Management works on real team data, so it needs the Scope Lite server.</b> Close this tab and start Scope with <span class="code-chip">run.bat</span> (or <span class="code-chip">share.bat</span> for the team).`)
    if (qm.online === null) return html`<div class="card"><div class="card-b empty">Loading…</div></div>`
    if (!qm.loadedAt) return notice('crit', 'alert', qm.error, html`<button class="btn sm" data-click="qm.reload">${icon('refresh', 14)}Retry</button>`)
    if (!qm.roster.length) return notice('warn', 'team', html`<b>No team roster yet.</b> The lead copies <span class="code-chip">data\\roster.example.json</span> to <span class="code-chip">data\\roster.json</span> on the host, fills in the team (SOEID, name, Lead or Analyst), then reloads this page.`)
    const m = me()
    if (!m) return notice('warn', 'user', html`<b>Queue Management needs your name from the team roster.</b> You're signed in as a sample user. Log out, then sign in with <b>Dev Login</b> and pick your name.`, html`<button class="btn sm" data-click="app.profile" data-v="logout">${icon('logout', 14)}Log out</button>`)
    const t = today()

    const lead = m.accessRole === 'Lead'
    const tab = !lead && (u.tab === 'verify' || u.tab === 'all') ? 'tickets' : u.tab
    const mine = qm.entries.filter((x) => x.by === m.soeid)
    const from = startOfMonth()
    const sel = u.sel && qm.entries.find((x) => x.id === u.sel)
    if (sel) entryDrawer(sel, u)
    const Q = S.queue
    const tsel = u.tsel && Q.view().tickets.find((t) => t.n === u.tsel)
    if (tsel && !sel) Q.ticketDrawer(tsel, m)
    const myOpen = Q.view().tickets.filter((t) => Q.owner(t) === m.soeid && Q.isOpen(t)).length
    const handled = Q.loadToday(m.soeid)

    return html`
      ${qm.error && notice('crit', 'alert', qm.error, html`<button class="btn sm" data-click="qm.reload">${icon('refresh', 14)}Retry</button>`)}
      <div class="callout accent qm-live">${icon('team', 16)}<span><b>Live team data.</b> Signed in as <b>${m.name}</b> <span class="mono">${m.soeid}</span>${lead && ' (Lead)'}${t && html` · ${S.dutyLabel(t.duty)}, ${S.shiftLabel(t.shift)} shift`}. Everyone on this server sees the same tickets and entries. The rest of Scope still shows sample data.</span></div>
      <div class="grid g-kpi">
        ${S.kpi({ label: 'Handled today', icon: 'check', tone: 'good', value: handled.total, foot: `${handled.tickets} tickets · ${handled.manual} verified manual` })}
        ${S.kpi({ label: 'Still open on me', icon: 'clock', tone: 'sky', value: myOpen, foot: 'Assigned or On Hold', extra: { 'data-click': 'qm.tab', 'data-v': 'tickets', style: 'cursor:pointer' } })}
        ${S.kpi({ label: 'Manual entries verified', icon: 'shield', tone: 'navy', value: mine.filter((x) => verifiedAt(x) >= from).length, foot: `This month · ${mine.filter((x) => x.status === 'Pending').length} waiting for a lead` })}
        ${lead && S.kpi({ label: 'To verify', icon: 'shield', tone: 'warn', value: toVerify().length, foot: 'Team entries waiting for you', extra: { 'data-click': 'qm.tab', 'data-v': 'verify', style: 'cursor:pointer' } })}
      </div>
      ${S.tabs([
        { id: 'tickets', label: 'My tickets', icon: 'user', count: myOpen },
        { id: 'queue', label: 'Team queue', icon: 'list' },
        { id: 'log', label: 'Log a manual entry', icon: 'plus' },
        { id: 'mine', label: 'My manual entries', icon: 'doc', count: mine.length },
        ...(lead ? [{ id: 'verify', label: 'To verify', icon: 'shield', count: toVerify().length }, { id: 'all', label: 'All manual entries', icon: 'table' }] : []),
      ], tab, 'qm.tab')}
      ${tab === 'tickets' && Q.myTickets(m)}
      ${tab === 'queue' && Q.teamQueue(m)}
      ${tab === 'log' && logForm()}
      ${tab === 'mine' && html`<div class="card">${table(mine, { empty: 'You haven\'t logged any tickets yet.' })}</div>`}
      ${tab === 'verify' && html`<div class="card">${table(toVerify().slice().sort((a, b) => a.at - b.at), { who: true, empty: 'Nothing to verify. All caught up.' })}</div>`}
      ${tab === 'all' && allEntries(u)}
      <div class="muted small">${qm.loadedAt && html`Updated ${S.fmtTime(qm.loadedAt)} · refreshes every 15 seconds`}</div>`
  }

  // ---------- Handlers ----------
  const page = () => S.ui('p:qm')
  S.on({
    'qm.tab': (el) => S.set(page(), { tab: el.dataset.v, sel: null, tsel: null }),
    'qm.field': (el) => { const f = form(); f[el.name] = el.value; if (el.name === 'inc' || f.tried) S.render() },
    'qm.keys': (el, ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); submit() } },
    'qm.submit': () => submit(),
    'qm.clear': () => S.set(form(), blankForm()),
    'qm.select': (el) => S.set(page(), { sel: el.dataset.v, note: '', noteTried: false }),
    'qm.deselect': () => S.set(page(), { sel: null }),
    'qm.note': (el) => { const p = page(); const was = !!p.note.trim(); p.note = el.value; if (was !== !!el.value.trim()) S.render() },
    'qm.withdraw': async (el) => { if (await send({ type: 'manualIncWithdraw', id: el.dataset.v })) S.dispatch({ type: 'toast', text: 'Entry withdrawn' }) },
    'qm.decide': async (el) => {
      const p = page()
      const d = el.dataset.d
      if (d === 'Rejected' && !p.note.trim()) { S.set(p, { noteTried: true }); return }
      const x = qm.entries.find((i) => i.id === el.dataset.v)
      if (await send({ type: 'manualIncDecide', id: el.dataset.v, decision: d, note: p.note.trim() })) {
        S.set(p, { sel: null, note: '', noteTried: false })
        S.dispatch({ type: 'toast', text: `${x ? x.inc : 'Entry'} ${d === 'Verified' ? 'verified and credited' : 'rejected'}` })
      }
    },
    'qm.q': (el) => S.set(page(), { q: el.value }),
    'qm.filter': (el) => S.set(page(), { [el.dataset.f]: el.value }),
    'qm.csv': exportCsv,
    'qm.reload': () => { qm.error = null; load() },
  })
})()
