// 3-Strike: the On Hold follow-up BAU (vault: 3-Strike Process, Team Operating Model Q18).
//
// An analyst sets a ticket On Hold in My tickets; it leaves their list and joins the
// team's 3-Strike queue on Home. Each day Scope suggests who makes the next contact
// attempt on each ticket, spread evenly over everyone on shift (Q18). The day's Proci
// Backup (QM duty), Weekend Support at the weekend, or a lead approves it. Each analyst
// then works their share in Queue Management → 3-Strike: reached (the ticket goes back
// to its owner) or not reached (next strike; Strike 3 not reached = Resolved).
// The events and the rules live in queue.js (strikeAssign, strikeLog).
//
// Assumptions until the team confirms Q19: a ticket's first attempt is due the day after
// it goes On Hold, one attempt per day, and nothing is due on Saturday or Sunday.
;(function () {
  const { html, cls, attrs, icon } = S
  const qm = S.qm
  const Q = () => S.queue
  const nameOf = (s) => (s ? Q().nameOf(s) : '')
  const first = (s) => nameOf(s).split(' ')[0]
  const today = () => Q().dayOf(Date.now())
  const weekend = (day) => [0, 6].includes(new Date(`${day}T12:00:00`).getDay())

  // Every ticket in the 3-Strike queue, with what's due today.
  function rows(v = Q().view()) {
    const day = today()
    return v.tickets.filter((t) => t.inLatest && t.tag === 'On Hold' && t.strike).map((t) => {
      const done = Q().strikeCount(t)
      const last = t.strike.logs[t.strike.logs.length - 1]
      const triedToday = !!last && last.day === day
      const heldToday = Q().dayOf(t.tagAt || 0) === day
      const due = !triedToday && !heldToday && !weekend(day) && done < 3
      const mineToday = t.strike.day === day ? t.strike.to : null
      return { t, done, next: Math.min(done + 1, 3), last, triedToday, heldToday, due, to: mineToday }
    }).sort((a, b) => b.done - a.done || (a.t.p || 9) - (b.t.p || 9) || (a.t.tagAt || 0) - (b.t.tagAt || 0))
  }

  // Who can take attempts now: signed in today and before their cutoff (Q18).
  const pool = () => { const now = Date.now(); return Q().onShift(now).filter((p) => now < p.w.cutoff) }

  // Even spread of today's unassigned due tickets; ties go to the ticket's owner, then
  // whoever has fewer. A pick made in the UI (draft) overrides the suggestion.
  function suggestion(list, draft = {}) {
    const people = pool().map((p) => p.soeid)
    if (!people.length) return []
    const load = new Map(people.map((s) => [s, list.filter((x) => x.to === s).length]))
    return list.filter((x) => x.due && !x.to).map((x) => {
      const own = Q().owner(x.t)
      const pick = draft[x.t.n] && people.includes(draft[x.t.n]) ? draft[x.t.n]
        : people.slice().sort((a, b) => load.get(a) - load.get(b) || (b === own) - (a === own) || nameOf(a).localeCompare(nameOf(b)))[0]
      load.set(pick, load.get(pick) + 1)
      return { n: x.t.n, to: pick, x }
    })
  }

  const strikePill = (x) => html`<span class="${cls('pill strike-pill', x.done >= 2 ? 'crit' : x.done === 1 ? 'warn' : '')}" title="${x.done} of 3 contact attempts done">Strike ${x.next}/3</span>`
  const lastText = (x) => x.last ? `${x.last.reached ? 'Reached' : 'Not reached'} · ${first(x.last.by)} · ${new Date(x.last.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : `On Hold since ${new Date(x.t.tagAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`

  // ---------- Home → 3-Strike (team view, approval) ----------
  function homeTab(me) {
    const day = today()
    const list = rows()
    const u = S.ui('p:home:strike', { draft: {} })
    const sug = suggestion(list, u.draft)
    const approver = Q().canApproveStrikes(me.soeid, day)
    const r = S.rota.dayRoles(day)
    const who = r.wd >= 5 ? r.weekend : r.backup
    const people = pool()
    const dueCount = list.filter((x) => x.due).length
    return html`<div class="card-b stack" style="gap:14px;padding-top:16px">
      <div class="row tight small muted strike-sum">
        <span><b class="num">${list.length}</b> On Hold</span><span>·</span>
        <span><b class="num">${dueCount}</b> due today</span><span>·</span>
        <span><b class="num">${list.filter((x) => x.to).length}</b> given out today</span>
        <span class="spacer"></span>
        ${S.infoTip('strike-rules', '3-Strike', html`
          <span>A ticket set <b>On Hold</b> (waiting on the user) joins this queue. Each attempt is a contact by Teams or phone; add <b>Contact attempt1/2/3</b> to the ServiceNow short description as usual.</span>
          <span><b>Reached:</b> the ticket goes back to its owner's My tickets. <b>Not reached:</b> the next strike is due the next day. <b>Strike 3 not reached:</b> Resolved; set it Resolved in ServiceNow too.</span>
          <span>Every day Scope suggests who takes each due attempt, spread evenly over everyone on shift. The <b>Proci Backup</b> (Weekend Support at the weekend, or a lead) approves it.</span>
          <span><b>Assumed until the team confirms (Q19):</b> the first attempt is due the day after the ticket goes On Hold, and nothing is due at the weekend.</span>`)}
      </div>
      ${weekend(day) && list.length > 0 && html`<div class="callout small">${icon('info', 15)}<span>Weekend: no attempts are due today. They resume on Monday.</span></div>`}
      ${sug.length > 0 && html`<div class="strike-plan stack" style="gap:10px">
        <div class="row"><b>Suggested for today</b><span class="muted small">${sug.length} attempt${sug.length > 1 ? 's' : ''} over ${people.length} on shift</span><span class="spacer"></span>
          ${approver ? html`<button class="btn primary sm" data-click="strike.approve">${icon('check', 14)}Approve distribution</button>`
            : html`<span class="small muted">Waiting for ${who ? `${nameOf(who)} (${r.wd >= 5 ? 'Weekend Support' : 'Proci Backup'})` : 'a lead'} to approve</span>`}</div>
        <div class="tbl-wrap"><table class="tbl qm-compact"><thead><tr><th>Ticket</th><th>Strike</th><th>Owner</th><th>Goes to</th></tr></thead>
          <tbody>${sug.map((g) => html`<tr data-key="s${g.n}">
            <td class="qm-tcell"><button class="btn ghost sm mono" data-click="queue.open" data-v="${g.n}">${g.n}</button><div class="small ink2 qm-tdesc" title="${g.x.t.short}">${g.x.t.short}</div></td>
            <td>${strikePill(g.x)}</td>
            <td class="small">${nameOf(Q().owner(g.x.t)) || '—'}</td>
            <td>${approver ? html`<select class="in sm" aria-label="Who takes ${g.n}" data-change="strike.pick" data-v="${g.n}">${people.map((p) => html`<option value="${p.soeid}" ${attrs({ selected: p.soeid === g.to })}>${p.person.name}</option>`)}</select>` : html`<span class="small">${nameOf(g.to)}</span>`}</td>
          </tr>`)}</tbody></table></div>
      </div>`}
      ${dueCount > 0 && !people.length && html`<div class="callout warn small">${icon('user', 15)}<span>Nobody is on shift before their cutoff, so there's nobody to give today's attempts to yet.</span></div>`}
      ${list.length ? html`<div class="tbl-wrap"><table class="tbl qm-compact">
        <thead><tr><th>Ticket</th><th>Strike</th><th>Owner</th><th>Today</th><th>Last</th></tr></thead>
        <tbody>${list.map((x) => html`<tr data-key="${x.t.n}">
          <td class="qm-tcell"><div class="row tight nowrap"><button class="btn ghost sm mono" data-click="queue.open" data-v="${x.t.n}">${x.t.n}</button>${Q().eersPill(x.t)}</div><div class="small ink2 qm-tdesc" title="${x.t.short}">${x.t.short}</div></td>
          <td>${strikePill(x)}</td>
          <td class="small">${nameOf(Q().owner(x.t)) || '—'}</td>
          <td class="small">${x.triedToday ? html`<span class="pill good">Done</span>` : x.to ? nameOf(x.to) : x.due ? html`<span class="pill warn">Not given out</span>` : html`<span class="muted">${x.heldToday ? 'Starts tomorrow' : 'Not due'}</span>`}</td>
          <td class="small muted">${lastText(x)}</td>
        </tr>`)}</tbody></table></div>`
        : html`<div class="empty">Nothing On Hold. Tickets set On Hold in My tickets appear here.</div>`}
    </div>`
  }

  // ---------- Queue Management → 3-Strike (my attempts today) ----------
  const mine = (me) => rows().filter((x) => x.to === me.soeid)
  function analystTab(me) {
    const list = mine(me)
    if (!list.length) return html`<div class="empty">No 3-Strike attempts for you today. They appear here once the Proci Backup approves today's distribution on Home.</div>`
    return html`<div class="tbl-wrap"><table class="tbl qm-tbl">
      <thead><tr><th>INC</th><th>Short description</th><th>Strike</th><th>Owner</th><th>Last</th><th></th></tr></thead>
      <tbody>${list.map((x) => html`<tr data-key="${x.t.n}" class="${cls(x.triedToday && 'muted')}">
        <td class="nowrap"><button class="btn ghost sm mono" data-click="queue.open" data-v="${x.t.n}">${x.t.n}</button></td>
        <td class="qm-clip" title="${x.t.short}">${x.t.short}</td>
        <td>${strikePill(x)}</td>
        <td class="small">${nameOf(Q().owner(x.t))}</td>
        <td class="small muted">${lastText(x)}</td>
        <td class="nowrap">${x.triedToday ? html`<span class="pill good">${icon('check', 12)}Done today</span>` : html`<div class="row tight">
          <button class="btn sm" data-click="strike.log" data-v="${x.t.n}" data-r="1">${icon('check', 13)}Reached</button>
          <button class="${cls('btn sm', x.next === 3 ? 'danger' : '')}" data-click="strike.log" data-v="${x.t.n}" data-r="0" title="${x.next === 3 ? 'Strike 3: the ticket is Resolved. Set it Resolved in ServiceNow too.' : `Strike ${x.next} done; the next one is due tomorrow`}">${x.next === 3 ? 'Not reached · Resolve' : 'Not reached'}</button></div>`}</td>
      </tr>`)}</tbody></table></div>`
  }

  S.strike = { rows, homeTab, analystTab, pendingFor: (me) => mine(me).filter((x) => !x.triedToday).length, dueCount: () => rows().filter((x) => x.due && !x.to).length }
  S.on({
    'strike.pick': (el) => { const u = S.ui('p:home:strike'); u.draft = { ...u.draft, [el.dataset.v]: el.value }; S.render() },
    'strike.approve': async () => {
      const u = S.ui('p:home:strike')
      const list = suggestion(rows(), u.draft).map((g) => ({ n: g.n, to: g.to }))
      if (!list.length) return
      if (await qm.send({ type: 'strikeAssign', day: today(), list })) {
        S.set(u, { draft: {} })
        S.dispatch({ type: 'toast', text: `3-Strike: ${list.length} attempt${list.length > 1 ? 's' : ''} given out for today` })
      }
    },
    'strike.log': async (el) => {
      const n = el.dataset.v
      const reached = el.dataset.r === '1'
      const x = rows().find((r) => r.t.n === n)
      if (!x) return
      if (!reached && x.next === 3 && !confirm(`${n}: Strike 3 and the user wasn't reached. Scope tags it Resolved; set it Resolved in ServiceNow too. Continue?`)) return
      if (await qm.send({ type: 'strikeLog', n, strike: x.next, reached })) {
        S.dispatch({ type: 'toast', text: reached ? `${n} is back with ${first(Q().owner(x.t))}` : x.next === 3 ? `${n} Resolved after Strike 3` : `${n}: Strike ${x.next} logged; next one tomorrow` })
      }
    },
  })
})()
