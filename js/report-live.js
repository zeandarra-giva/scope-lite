// Monthly transparency report on real team data (QM build order #10) and the import of
// QueueManager's end-of-day history (#11). Shown on Reports once you're signed in from the
// roster; the prototype's Reports stay for sample data.
//
// The goal is transparency, not forced equality: daily volumes differ.
// Definitions (also in the page's "i" panels):
//   Received   tickets that became the person's in the month (Scope assigned them, or
//              ServiceNow already named them when the export first loaded). A ticket moved
//              to someone else counts for its current owner.
//   Handled    Resolved + Transferred in the month + verified manual entries
//              (lead, 2026-11-19, answering Q8: a verified manual entry counts as handled).
//   Per day worked   (received + verified manual) ÷ days worked; leave and rest days excluded.
// QueueManager history (tbl_EODReports) fills the days before Scope's first export:
//   received = total_assigned, handled = total_done. Several sessions on one day are added
//   up (each EOD row counts its own session's tickets; to confirm with the team).
;(function () {
  const { html, cls, attrs, icon } = S
  const Q = () => S.queue
  const R = () => S.rota
  const qm = () => S.qm

  // ---------- QueueManager history (from the ops log) ----------
  // eodHistoryImported { id, files, rows: [{ day, soeid, name, assigned, done, pending, backlog, slo, sla }] }
  // eodHistoryUndo { id }. Lead only. The newest import wins for any (day, person).
  let hmemo = { events: null }
  function history() {
    const evs = qm().events || []
    if (hmemo.events === evs) return hmemo.v
    const imports = []
    const undone = new Set()
    for (const ev of evs) {
      const e = ev.e || {}
      if (e.type === 'eodHistoryImported' && Array.isArray(e.rows)) imports.push({ id: e.id, at: ev.at, by: ev.by, files: e.files || [], rows: e.rows })
      else if (e.type === 'eodHistoryUndo') undone.add(e.id)
    }
    const live = imports.filter((x) => !undone.has(x.id))
    const byKey = new Map()
    for (const imp of live) for (const r of imp.rows) if (r && /^\d{4}-\d{2}-\d{2}$/.test(r.day)) byKey.set(`${r.day}|${r.soeid || r.name}`, r)
    hmemo = { events: evs, v: { imports: live, rows: [...byKey.values()] } }
    return hmemo.v
  }

  // ---------- The month ----------
  const pad = (n) => String(n).padStart(2, '0')
  const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  const monthStart = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).getTime() }
  const monthEnd = (k) => { const [y, m] = k.split('-').map(Number); return new Date(y, m, 1).getTime() }
  const monthLabel = (k) => new Date(monthStart(k)).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const daysOf = (k) => { const out = []; const end = monthEnd(k); for (let t = monthStart(k); t < end; t += 864e5) { const d = new Date(t); out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`) } return [...new Set(out)] }

  function months() {
    const v = Q().view()
    const set = new Set([monthKey(new Date())])
    for (const t of v.tickets) set.add(monthKey(new Date(t.to ? t.assignedAt : t.firstSeen)))
    for (const r of history().rows) set.add(r.day.slice(0, 7))
    return [...set].sort().reverse()
  }

  function build(k) {
    const v = Q().view()
    const from = monthStart(k)
    const to = monthEnd(k)
    const today = R().today()
    const days = daysOf(k).filter((d) => d <= today)
    const inM = (ms) => ms >= from && ms < to
    // Scope's own data starts with its first export; QueueManager history covers the days before.
    const firstImport = v.imports.length ? Q().dayOf(Math.min(...v.imports.map((x) => x.at))) : null
    const hist = history().rows.filter((r) => r.day.slice(0, 7) === k && (!firstImport || r.day < firstImport))
    const people = new Map()
    const row = (soeid, name) => {
      const key = soeid || `name:${name}`
      if (!people.has(key)) people.set(key, { soeid, name: soeid ? Q().nameOf(soeid) : name, onRoster: !!soeid, received: 0, resolved: 0, transferred: 0, manual: 0, eers: 0, strikes: 0, strikeMissed: 0, hist: 0, histDone: 0, worked: 0, main: 0, backup: 0, weekend: 0 })
      return people.get(key)
    }
    qm().roster.filter((p) => p.active !== false).forEach((p) => row(p.soeid))

    // Received per day (team) and per person.
    const perDay = new Map(days.map((d) => [d, 0]))
    for (const t of v.tickets) {
      const o = Q().owner(t)
      const when = t.to ? t.assignedAt : t.firstSeen
      if (!o || !inM(when)) continue
      const r = row(o)
      r.received++
      if (t.eers) r.eers++
    }
    // The team's daily volume: tickets by the day they first came into the queue.
    for (const t of v.tickets) if (t.incSeen && inM(t.incSeen)) { const d = Q().dayOf(t.incSeen); if (perDay.has(d)) perDay.set(d, perDay.get(d) + 1) }
    // Resolved / Transferred in the month, for the ticket's owner.
    for (const t of v.tickets) {
      const o = Q().owner(t)
      if (!o || !t.tagAt || !inM(t.tagAt)) continue
      if (t.tag === 'Resolved') row(o).resolved++
      else if (t.tag === 'Transferred') row(o).transferred++
    }
    // 3-Strike: tickets finished (an attempt logged) and not finished in their window, for
    // whoever they were handed to (senior's review, 2026-11-24).
    const sdays = [...new Set(v.tickets.flatMap((t) => t.sk.map((w) => w.day)))].filter((d) => d.slice(0, 7) === k)
    for (const d of sdays) for (const [soeid, qs] of S.strike.dayCounts(d)) for (const c of Object.values(qs)) { const r = row(soeid); r.strikes += c.done; r.strikeMissed += c.missed }
    // Verified manual entries, by the day they were handled.
    for (const x of qm().entries || []) if (x.status === 'Verified' && inM(x.handledAt)) row(x.by).manual++
    // QueueManager history.
    for (const h of hist) {
      const p = h.soeid ? row(h.soeid) : row(null, h.name)
      p.hist += h.assigned || 0
      p.histDone += h.done || 0
      p.received += h.assigned || 0
      if (perDay.has(h.day)) perDay.set(h.day, perDay.get(h.day) + (h.assigned || 0))
    }
    // Days worked and weekly roles, from the rota and schedule (Scope days only); history days
    // count as worked when the person has an EOD row that day.
    const histDays = new Map()
    for (const h of hist) { const key = h.soeid || `name:${h.name}`; if (!histDays.has(key)) histDays.set(key, new Set()); histDays.get(key).add(h.day) }
    for (const [key, p] of people) {
      if (histDays.has(key)) p.worked += histDays.get(key).size
      if (!p.soeid) continue
      for (const d of days) {
        // Before Scope's first export there's no real schedule or rota to go on (the rota
        // counted backwards is a projection), so those days only count from QueueManager history.
        if (firstImport && d < firstImport) continue
        const pl = S.schedule.planFor(p.soeid, d)
        if (pl.ready) p.worked++
        const r = R().dayRoles(d)
        if (r.main === p.soeid) p.main++
        if (r.backup === p.soeid) p.backup++
        if (r.weekend === p.soeid) p.weekend++
      }
    }
    const list = [...people.values()].map((p) => {
      const handled = p.resolved + p.transferred + p.manual + p.histDone
      const credit = p.received + p.manual + p.strikes // Base INC + 3-Strike finished
      return { ...p, handled, credit, perDay: p.worked ? credit / p.worked : null }
    }).filter((p) => p.onRoster && (qm().roster.find((x) => x.soeid === p.soeid) || {}).active !== false) // only the active team (lead, 2026-11-19)
      .sort((a, b) => b.credit - a.credit || a.name.localeCompare(b.name))
    // The team's total: INC received (and QueueManager history) per day, plus 3-Strike finished.
    const total = [...perDay.values()].reduce((a, b) => a + b, 0) + list.reduce((a, p) => a + p.strikes, 0)
    const activeDays = [...perDay.values()].filter((n) => n > 0).length
    const sharing = list.filter((p) => p.credit > 0)
    const shares = sharing.map((p) => p.credit)
    return {
      k, days, perDay, list, total, activeDays, avg: activeDays ? total / activeDays : 0,
      n: sharing.length, min: shares.length ? Math.min(...shares) : 0, max: shares.length ? Math.max(...shares) : 0,
      fair: sharing.length ? total / sharing.length : 0, hist: hist.length, firstImport,
    }
  }

  // ---------- Page ----------
  const ui = () => S.ui('p:reports:month', () => ({ k: monthKey(new Date()) }))
  const n1 = (x) => (x == null ? '—' : x >= 10 ? Math.round(x) : Math.round(x * 10) / 10)

  function page() {
    const me = qm().me()
    const lead = me && me.accessRole === 'Lead'
    const u = ui()
    const ms = months()
    if (!ms.includes(u.k)) u.k = ms[0]
    const m = build(u.k)
    const d = m.days.map((x) => m.perDay.get(x))
    return html`<div class="stack" style="gap:16px">
      <div class="row">
        <h2 class="mr-title">Monthly report</h2>
        <select class="in" aria-label="Month" data-change="mr.month">${ms.map((k) => html`<option value="${k}" ${attrs({ selected: k === u.k })}>${monthLabel(k)}</option>`)}</select>
        <span class="spacer"></span>
        <details class="dd">
          <summary class="btn sm">${icon('download', 14)}Export ${icon('chevDown', 12)}</summary>
          <div class="dd-menu" role="menu">
            <button role="menuitem" data-click="mr.csv">${icon('table', 15)}<span><b>Excel</b><span class="muted small">Per person and per day, as a CSV that opens in Excel</span></span></button>
            <button role="menuitem" data-click="mr.html">${icon('chart', 15)}<span><b>Charts report (HTML)</b><span class="muted small">The whole report with its charts, as one page: open in any browser or print to PDF</span></span></button>
          </div>
        </details>
      </div>
      <div class="callout accent small">${icon('info', 15)}<span><b>For transparency, not forced equality:</b> daily volumes differ, so look at the spread and tickets per day worked, not just totals. Everyone on the team can see this page.</span></div>
      ${S.reportAnalytics ? S.reportAnalytics(m.k) : ''}
      <section class="grid g-kpi" aria-label="Month at a glance">
        ${S.kpi({ label: 'Tickets received', icon: 'doc', tone: 'sky', value: m.total, foot: `${monthLabel(m.k)}${m.hist ? ' · includes QueueManager history' : ''}`, info: html`<span>Tickets that came into the queue in the month, by the day Scope first saw them in an export (plus QueueManager's assigned totals for the days before Scope). Verified manual entries are not included here.</span>` })}
        ${S.kpi({ label: 'Average per day', icon: 'chart', tone: 'navy', value: n1(m.avg), foot: `Over ${m.activeDays} day${m.activeDays === 1 ? '' : 's'} with tickets`, info: html`<span>Tickets received ÷ days in the month that had at least one ticket. Days without tickets (weekends, holidays) don't pull the average down.</span>` })}
        ${S.kpi({ label: 'Spread across', icon: 'team', tone: 'ice', value: m.n, unit: m.n === 1 ? ' analyst' : ' analysts', foot: m.n ? `Fewest ${m.min} · most ${m.max} · even share ${n1(m.fair)}` : 'Nobody yet', info: html`<span>People who received tickets or had manual entries verified. The even share is the total ÷ that number; a gap from it is normal when people had leave, rest days or Proci weeks.</span>` })}
      </section>
      <div class="card">
        <div class="card-h"><h2>Received per day</h2><span class="muted small">${monthLabel(m.k)}</span><span class="spacer"></span>${(() => { const top = m.days.map((x) => [x, m.perDay.get(x) || 0]).sort((a, b) => b[1] - a[1])[0]; return S.infoTip('mr-daily', 'Received per day', html`<span>Tickets that came into the queue each day of the month, by the day Scope first saw them in an export (plus QueueManager's totals for days before Scope).</span>${top && top[1] ? html`<span><b>Insights</b></span><span>• Busiest day: ${new Date(`${top[0]}T00:00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })} with ${top[1]} tickets.</span><span>• Average ${n1(m.avg)} on days with tickets; weekends are usually quiet.</span>` : ''}`) })()}</div>
        <div class="card-b">${m.total ? S.barChart('mr-daily', { labels: m.days.map((x) => String(Number(x.slice(8)))), values: d, fmt: (x) => `${Math.round(x)} tickets` }) : html`<div class="empty">No tickets received this month yet.</div>`}</div>
      </div>
      <div class="card">
        <div class="card-h"><h2>Per person</h2><span class="spacer"></span>${S.infoTip('mr-person', 'Per person', html`
          <span><b>Received:</b> tickets that became theirs this month (a moved ticket counts for its current owner).</span>
          <span><b>Handled:</b> Resolved + Transferred this month + verified manual entries (Q8, lead 2026-11-19). Transferred is shown separately too.</span>
          <span><b>Manual:</b> verified manual entries, by the day they were handled.</span>
          <span><b>3-Strike:</b> 3-Strike tickets they finished (a contact attempt logged in the window); these count toward the equal share. <b>Not finished</b>: handed out, no attempt by the end of the window.</span>
          <span><b>Per day worked:</b> (received + manual) ÷ days worked. Days worked come from Schedule & coverage; leave and rest days don't count.</span>
          <span><b>Main / Backup / Weekend:</b> days in that role from the Proci rota.</span>
          ${m.hist > 0 && html`<span><b>QueueManager history:</b> days before Scope's first export use QueueManager's end-of-day totals: assigned counts as received, done as handled.</span>`}`)}</div>
        <div class="tbl-wrap"><table class="tbl mr-tbl">
          <thead><tr><th>Analyst</th><th class="num">Received</th><th class="num">Handled</th><th class="num">Transferred</th><th class="num">EERS</th><th class="num">Manual</th><th class="num">3-Strike</th><th class="num">3-Strike not finished</th><th class="num">Days worked</th><th class="num">Per day worked</th><th class="num">Main / Backup / Weekend</th></tr></thead>
          <tbody>${m.list.map((p) => html`<tr data-key="${p.soeid || p.name}">
            <td>${p.name}</td>
            <td class="num">${p.received}</td><td class="num"><b>${p.handled}</b></td><td class="num">${p.transferred}</td><td class="num">${p.eers}</td>
            <td class="num">${p.manual}</td><td class="num">${p.strikes}</td><td class="num">${p.strikeMissed || ''}</td><td class="num">${p.worked}</td><td class="num">${n1(p.perDay)}</td>
            <td class="num nowrap">${p.main} / ${p.backup} / ${p.weekend}</td>
          </tr>`)}</tbody>
        </table></div>
      </div>
      ${historyCard(lead)}
    </div>`
  }

  // ---------- QueueManager history import (#11) ----------
  function historyCard(lead) {
    const h = history()
    const u = S.ui('p:reports:eod', { preview: null, error: null, files: {} })
    const span = h.rows.length ? [h.rows.reduce((a, r) => (r.day < a ? r.day : a), '9999'), h.rows.reduce((a, r) => (r.day > a ? r.day : a), '0000')] : null
    return html`<div class="card">
      <div class="card-h"><h2>QueueManager history</h2><span class="muted small">${span ? `${h.rows.length} person-days, ${span[0]} to ${span[1]}` : 'Not imported yet'}</span><span class="spacer"></span>${S.infoTip('mr-hist', 'QueueManager history', html`<span>The team's end-of-day totals from QueueManager, the tool before Scope, so the months before Scope's first export aren't empty. A lead imports three tables exported from its Access file as CSV.</span><span>${span ? `Covers ${new Set(h.rows.map((r) => r.soeid || r.name)).size} people from ${span[0]} to ${span[1]}. Days from Scope's first export onward use Scope's own data.` : 'Not imported yet: months before Scope will show only what Scope has seen.'}</span>`)}</div>
      <div class="card-b stack" style="gap:12px">
        <span class="small ink2">Brings QueueManager's end-of-day totals per person into this report, so the months before Scope aren't empty. Export three tables from the QueueManager Access file as CSV: <b>tbl_EODReports</b>, <b>tbl_DaySessions</b> and <b>tbl_Members</b>.</span>
        ${lead ? html`
          <label class="btn sm"><input type="file" accept=".csv" multiple hidden data-change="mr.eodFiles">${icon('upload', 14)}Choose the 3 CSV files</label>
          <div class="row tight small">${['eod', 'sessions', 'members'].map((k) => html`<span class="${cls('pill', u.files[k] ? 'good' : '')}">${{ eod: 'tbl_EODReports', sessions: 'tbl_DaySessions', members: 'tbl_Members' }[k]}${u.files[k] ? ` · ${u.files[k].rows.length} rows` : ''}</span>`)}</div>
          ${u.error && html`<div class="callout warn small">${icon('alert', 15)}<span>${u.error}</span></div>`}
          ${u.preview && html`<div class="callout small">${icon('info', 15)}<span><b>${u.preview.rows.length} person-days</b> from ${u.preview.from} to ${u.preview.to}, ${u.preview.people} people${u.preview.unmatched.length ? `. ${u.preview.unmatched.length} ${u.preview.unmatched.length > 1 ? 'people' : 'person'} not on the active team left out` : ''}${u.preview.skipped ? `. ${u.preview.skipped} rows skipped (no session date)` : ''}.</span>
            <span class="spacer"></span><button class="btn primary sm" data-click="mr.eodImport">Import</button><button class="btn ghost sm" data-click="mr.eodCancel">Cancel</button></div>`}
          ${h.imports.length > 0 && html`<div class="small muted">${h.imports.map((x) => html`<div class="row tight">Imported ${new Date(x.at).toLocaleString()} by ${Q().nameOf(x.by)} · ${x.rows.length} rows <button class="btn ghost sm" data-click="mr.eodUndo" data-v="${x.id}">Undo</button></div>`)}</div>`}`
        : html`<span class="small muted">A lead imports it.</span>`}
      </div>
    </div>`
  }

  // Header lookup that tolerates Access's cut-off or renamed columns ("total_assigne…").
  const col = (head, ...names) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)))
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s.]+/g, ' ').trim()
  const toDay = (s) => {
    const t = String(s || '').trim()
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t) // Access on US settings: M/D/YYYY
    return m ? `${m[3]}-${pad(m[1])}-${pad(m[2])}` : null
  }

  async function readEod(fileList) {
    const u = S.ui('p:reports:eod')
    const files = { ...u.files }
    for (const f of [...(fileList || [])]) {
      const { text } = await Q().readText(f)
      const rows = Q().parseCsv(text).filter((r) => r.some((c) => String(c).trim()))
      if (!rows.length) continue
      const head = rows[0].map((h) => String(h).trim().toLowerCase())
      const kind = col(head, 'total_done', 'total_assign') >= 0 ? 'eod' : col(head, 'session_date') >= 0 ? 'sessions' : col(head, 'soeid', 'name', 'full_name', 'member_name') >= 0 ? 'members' : null
      if (!kind) { S.set(u, { error: `${f.name}: couldn't tell which table this is. Export tbl_EODReports, tbl_DaySessions or tbl_Members with the column names.` }); return }
      files[kind] = { name: f.name, head, rows: rows.slice(1) }
    }
    S.set(u, { files, error: null, preview: files.eod && files.sessions && files.members ? previewEod(files) : null })
  }

  function previewEod({ eod, sessions, members }) {
    const sId = col(sessions.head, 'id'); const sDay = col(sessions.head, 'session_date')
    const day = new Map(sessions.rows.map((r) => [String(r[sId]).trim(), toDay(r[sDay])]))
    const mId = col(members.head, 'id'); const mSoeid = col(members.head, 'soeid'); const mName = col(members.head, 'full_name', 'member_name', 'name')
    const roster = qm().roster
    const who = new Map(members.rows.map((r) => {
      const soeid = mSoeid >= 0 ? String(r[mSoeid]).trim().toUpperCase() : ''
      const name = mName >= 0 ? String(r[mName]).trim() : ''
      const p = roster.find((x) => x.active !== false && ((soeid && x.soeid.toUpperCase() === soeid) || (name && norm(x.name) === norm(name))))
      return [String(r[mId]).trim(), { soeid: p ? p.soeid : null, name: p ? p.name : name || soeid || `Member ${r[mId]}` }]
    }))
    const h = eod.head
    const c = { s: col(h, 'session_id'), m: col(h, 'member_id'), a: col(h, 'total_assign'), d: col(h, 'total_done'), p: col(h, 'total_pendin', 'total_pending'), b: col(h, 'total_backlo', 'total_backlog'), slo: col(h, 'total_slo'), sla: col(h, 'total_sla') }
    if (c.s < 0 || c.m < 0 || c.a < 0) return { rows: [], from: '-', to: '-', people: 0, unmatched: [], skipped: eod.rows.length, error: true }
    const num = (r, i) => (i >= 0 ? Number(String(r[i]).replace(/[^\d.-]/g, '')) || 0 : 0)
    const acc = new Map()
    let skipped = 0
    for (const r of eod.rows) {
      const d = day.get(String(r[c.s]).trim())
      const w = who.get(String(r[c.m]).trim()) || { soeid: null, name: `Member ${r[c.m]}` }
      if (!d) { skipped++; continue }
      const key = `${d}|${w.soeid || w.name}`
      const x = acc.get(key) || { day: d, soeid: w.soeid, name: w.name, assigned: 0, done: 0, pending: 0, backlog: 0, slo: 0, sla: 0 }
      // Several sessions on one day: add them up (each session's EOD row counts its own tickets).
      x.assigned += num(r, c.a); x.done += num(r, c.d); x.pending += num(r, c.p); x.backlog += num(r, c.b); x.slo += num(r, c.slo); x.sla += num(r, c.sla)
      acc.set(key, x)
    }
    const all = [...acc.values()].sort((a, b) => a.day.localeCompare(b.day))
    const rows = all.filter((r) => r.soeid) // only people on the roster
    return { rows, from: rows.length ? rows[0].day : '-', to: rows.length ? rows[rows.length - 1].day : '-', people: new Set(rows.map((r) => r.soeid || r.name)).size, unmatched: [...new Set(all.filter((r) => !r.soeid).map((r) => r.name))], skipped }
  }

  function exportCsv() {
    const m = build(ui().k)
    const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`
    const head = ['Month', 'Analyst', 'SOEID', 'Received', 'Handled', 'Resolved', 'Transferred', 'EERS', 'Verified manual entries', '3-Strike finished', '3-Strike not finished', 'QueueManager assigned', 'QueueManager done', 'Days worked', 'Per day worked', 'Days as Main Proci', 'Days as Proci Backup', 'Days as Weekend Support']
    const rows = m.list.map((p) => [monthLabel(m.k), p.name, p.soeid || '', p.received, p.handled, p.resolved, p.transferred, p.eers, p.manual, p.strikes, p.strikeMissed, p.hist, p.histDone, p.worked, p.perDay == null ? '' : Math.round(p.perDay * 10) / 10, p.main, p.backup, p.weekend])
    const daily = [[], ['Day', 'Received'], ...m.days.map((d) => [d, m.perDay.get(d)])]
    S.download(`scope-monthly-${m.k}.csv`, '﻿' + [head, ...rows, ...daily].map((r) => r.map(cell).join(',')).join('\r\n'), 'text/csv')
  }

  // The whole monthly report as one standalone page (opens in any browser, prints to PDF).
  function exportHtml() {
    const m = build(ui().k)
    const esc = S.reportEsc; const sec = S.reportSection
    const max = Math.max(1, ...m.days.map((d) => m.perDay.get(d) || 0))
    const kpi = (l, v, f) => `<div class="sheet kpi"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div><div class="sub">${esc(f)}</div></div>`
    const body = [
      `<div class="note">For transparency, not forced equality: daily volumes differ, so look at the spread and tickets per day worked, not just totals.</div>`,
      `<div class="kpis">${kpi('Tickets received', m.total, monthLabel(m.k) + (m.hist ? ' · includes QueueManager history' : ''))}${kpi('Average per day', n1(m.avg), `Over ${m.activeDays} day${m.activeDays === 1 ? '' : 's'} with tickets`)}${kpi('Spread across', `${m.n} analyst${m.n === 1 ? '' : 's'}`, m.n ? `Fewest ${m.min} · most ${m.max} · even share ${n1(m.fair)}` : 'Nobody yet')}</div>`,
      S.reportAnalyticsHtml ? S.reportAnalyticsHtml(m.k) : '',
      sec('Per person', `<table><thead><tr><th>Analyst</th><th class="r">Received</th><th class="r">Handled</th><th class="r">Transferred</th><th class="r">EERS</th><th class="r">Manual</th><th class="r">3-Strike</th><th class="r">3-Strike not finished</th><th class="r">Days worked</th><th class="r">Per day worked</th><th class="r">Main / Backup / Weekend</th></tr></thead><tbody>${m.list.map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${p.received}</td><td class="r"><b>${p.handled}</b></td><td class="r">${p.transferred}</td><td class="r">${p.eers}</td><td class="r">${p.manual}</td><td class="r">${p.strikes}</td><td class="r">${p.strikeMissed || ''}</td><td class="r">${p.worked}</td><td class="r">${n1(p.perDay)}</td><td class="r">${p.main} / ${p.backup} / ${p.weekend}</td></tr>`).join('')}</tbody></table>`),
      sec('Received per day', `<table><thead><tr><th>Day</th><th></th><th class="r">Received</th></tr></thead><tbody>${m.days.map((d) => { const n = m.perDay.get(d) || 0; return `<tr><td>${esc(new Date(`${d}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}</td><td style="width:60%"><div class="bar"><i style="width:${(n / max) * 100}%;background:var(--a)"></i></div></td><td class="r">${n}</td></tr>` }).join('')}</tbody></table>`),
      `<div class="note"><b>Received:</b> tickets that became theirs this month. <b>Handled:</b> Resolved + Transferred + verified manual entries. <b>3-Strike:</b> finished in the window (counts toward the equal share); not finished = handed out, no attempt by the window's end. <b>Per day worked:</b> (received + manual) ÷ days worked.</div>`,
    ].join('')
    S.download(`scope-monthly-${m.k}.html`, S.reportPageHtml({ title: `Monthly report · ${monthLabel(m.k)}`, sub: `Scope · Reports · generated ${new Date().toLocaleString()}`, body }), 'text/html')
    S.dispatch({ type: 'toast', text: 'Monthly report downloaded' })
  }

  S.reportLive = page
  S.on({
    'mr.month': (el) => S.set(ui(), { k: el.value }),
    'mr.csv': (el) => { const d = el.closest('details'); if (d) d.open = false; exportCsv() },
    'mr.html': (el) => { const d = el.closest('details'); if (d) d.open = false; exportHtml() },
    'mr.eodFiles': (el) => { const f = el.files; readEod(f).then(() => { el.value = '' }) },
    'mr.eodCancel': () => S.set(S.ui('p:reports:eod'), { preview: null, files: {}, error: null }),
    'mr.eodImport': async () => {
      const u = S.ui('p:reports:eod')
      if (!u.preview || !u.preview.rows.length) return
      const files = Object.values(u.files).map((f) => f.name)
      if (await qm().send({ type: 'eodHistoryImported', id: `eod${Date.now().toString(36)}`, files, rows: u.preview.rows })) {
        S.dispatch({ type: 'toast', text: `QueueManager history imported: ${u.preview.rows.length} person-days` })
        S.set(u, { preview: null, files: {}, error: null })
      }
    },
    'mr.eodUndo': async (el) => { if (await qm().send({ type: 'eodHistoryUndo', id: el.dataset.v })) S.dispatch({ type: 'toast', text: 'History import undone' }) },
  })
})()
