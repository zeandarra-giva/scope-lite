// Reports → Monthly report → Analytics (lead, 2026-11-27): the prototype's KPIs and charts
// (E2E/RES MTTR, SLA attainment, volume, transfer rate, MTTR and volume by week, root causes,
// resolution codes) brought back on REAL tickets, plus more charts.
//
// Definitions (lead, 2026-11-24; MTTR is still to be settled, so these are what the
// ServiceNow exports allow today):
//   E2E MTTR  created in ServiceNow → tagged Resolved in Scope (the customer's clock)
//   RES MTTR  handed to the analyst by Scope → tagged Resolved (time with the analyst;
//             the exports can't show "active" handling time). Goal: within the INC SLA
//             target in Team settings (4 h). North star: 90% of tickets within it.
//   Lost time E2E − RES: before our queue and waiting for an owner.
//   SLA attainment = share of resolved tickets with RES ≤ the goal.
// S.reportAnalytics(k) renders the section in the app; S.reportAnalyticsHtml(k) returns
// the same charts as static SVG/HTML for the downloadable report.
;(function () {
  const { html, cls, icon } = S
  const Q = () => S.queue
  const DAY = 864e5; const HOUR = 36e5
  const NORTH_STAR = 0.9

  const monthFrom = (k) => new Date(`${k}-01T00:00:00`).getTime()
  const monthTo = (k) => { const d = new Date(monthFrom(k)); return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() }
  const prevKey = (k) => { const d = new Date(monthFrom(k)); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
  const monday = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime() }
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN)
  const goalH = () => Number(Q().view().settings['inc.slaHours']) || 4
  const fmtH = (h) => (h == null || isNaN(h) ? '—' : h >= 48 ? `${(h / 24).toFixed(1)}d` : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)}h`)
  const pct = (x) => (x == null || isNaN(x) ? '—' : `${Math.round(x * 100)}%`)

  // Per resolved/transferred ticket: when it closed and its clocks (hours).
  function closedRows() {
    return Q().view().tickets.filter((t) => t.incSeen && t.tagAt && (t.tag === 'Resolved' || t.tag === 'Transferred')).map((t) => {
      const created = Q().createdAt(t); const queued = Q().queuedAt(t)
      const eze = created ? (t.tagAt - created) / HOUR : null
      // On Hold time is the user's clock, not the analyst's (senior's review, 2026-11-24): RES
      // runs until the ticket went On Hold, then again from when the user was reached.
      const hold = (t.history || []).find((h) => h.what === 'tagged On Hold')
      const reached = (t.sk || []).map((w) => w.log).filter((l) => l && l.reached).sort((x, y) => y.at - x.at)[0]
      const res = !t.assignedAt ? null : hold && hold.at < t.tagAt
        ? (Math.max(0, hold.at - t.assignedAt) + (reached && reached.at < t.tagAt ? t.tagAt - reached.at : 0)) / HOUR
        : Math.max(0, t.tagAt - t.assignedAt) / HOUR
      return { t, at: t.tagAt, resolved: t.tag === 'Resolved', eze, res,
        before: created && queued ? Math.max(0, queued - created) / HOUR : null,
        wait: queued && t.assignedAt ? Math.max(0, t.assignedAt - queued) / HOUR : null }
    })
  }
  function stats(rows) {
    const res = rows.filter((r) => r.resolved)
    const ezes = res.map((r) => r.eze).filter((x) => x != null)
    const ress = res.map((r) => r.res).filter((x) => x != null)
    return {
      n: res.length, closed: rows.length, transferred: rows.length - res.length,
      eze: avg(ezes), res: avg(ress), lost: avg(ezes) - avg(ress),
      sla: ress.length ? ress.filter((x) => x <= goalH()).length / ress.length : NaN,
      tr: rows.length ? (rows.length - res.length) / rows.length : NaN,
    }
  }
  function model(k) {
    const all = closedRows()
    const from = monthFrom(k); const to = monthTo(k)
    const inM = all.filter((r) => r.at >= from && r.at < to)
    const pf = monthFrom(prevKey(k))
    const prev = all.filter((r) => r.at >= pf && r.at < from)
    const res = inM.filter((r) => r.resolved)
    // 12 weeks ending with the month (or today).
    const end = Math.min(to, Date.now() + DAY)
    const w0 = monday(end - 1) - 11 * 7 * DAY
    const weeks = Array.from({ length: 12 }, (_, i) => w0 + i * 7 * DAY)
    const wk = weeks.map((w) => { const r = all.filter((x) => x.resolved && x.at >= w && x.at < w + 7 * DAY); const s = stats(r); return { label: new Date(w).toLocaleDateString([], { month: 'short', day: 'numeric' }), n: r.length, eze: r.length ? s.eze : null, res: r.length && !isNaN(s.res) ? s.res : null } })
    const count = (list, key) => { const m = new Map(); for (const x of list) { const k2 = key(x); if (k2) m.set(k2, (m.get(k2) || 0) + 1) } return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value) }
    const causes = count(res, (r) => r.t.res && r.t.res.cause && ((S.ROOT_CAUSES && S.ROOT_CAUSES[r.t.res.cause]) ? S.ROOT_CAUSES[r.t.res.cause].label : r.t.res.cause))
    const codes = count(res, (r) => r.t.res && r.t.res.code).slice(0, 8)
    const BUCKETS = [['< 1h', 0, 1], ['1–2h', 1, 2], ['2–4h', 2, 4], ['4–8h', 4, 8], ['8–24h', 8, 24], ['1–3d', 24, 72], ['> 3d', 72, Infinity]]
    const dist = BUCKETS.map(([label, a, b]) => ({ label, value: res.filter((r) => r.res != null && r.res >= a && r.res < b).length, over: a >= goalH() }))
    const byAnalyst = count(res, (r) => Q().owner(r.t)).map((x) => ({ label: Q().nameOf(x.label), value: avg(res.filter((r) => Q().owner(r.t) === x.label && r.res != null).map((r) => r.res)), n: x.value })).filter((x) => !isNaN(x.value)).sort((a, b) => b.value - a.value)
    // Received in the month: arrival heatmap and priority mix.
    const recv = Q().view().tickets.filter((t) => t.incSeen && Q().createdAt(t) >= from && Q().createdAt(t) < to)
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0))
    for (const t of recv) { const d = new Date(Q().createdAt(t)); heat[(d.getDay() + 6) % 7][d.getHours()]++ }
    const prio = count(recv, (t) => t.priority || '—').sort((a, b) => a.label.localeCompare(b.label))
    // Where the time goes, on resolved tickets with all three clocks.
    const full = res.filter((r) => r.before != null && r.wait != null && r.res != null)
    const split = { before: avg(full.map((r) => r.before)), wait: avg(full.map((r) => r.wait)), res: avg(full.map((r) => r.res)), n: full.length }
    // 3-Strike per region in the month.
    const strike = S.strike.strikeQueues().map((q) => ({ name: q.name, done: 0, missed: 0 }))
    for (let d = from; d < Math.min(to, Date.now() + DAY); d += DAY) {
      const day = Q().dayOf(d)
      for (const [, qs] of S.strike.dayCounts(day)) for (const [qid, c] of Object.entries(qs)) {
        const q = S.strike.strikeQueues().findIndex((x) => x.id === qid)
        if (q >= 0) { strike[q].done += c.done; strike[q].missed += c.missed }
      }
    }
    return { k, s: stats(inM), p: stats(prev), hasPrev: prev.length > 0, wk, causes, codes, dist, byAnalyst, heat, prio, split, strike, recv: recv.length }
  }

  // "-0.4h vs prior month", green when it moved the right way.
  function delta(cur, prev, kind, betterLow, has = true) {
    if (!has || isNaN(cur) || isNaN(prev)) return { text: 'No prior month to compare', tone: '' }
    const d = cur - prev
    const text = kind === 'pct' ? `${d > 0 ? '+' : ''}${Math.round(d * 100)} pts` : kind === 'h' ? `${d > 0 ? '+' : ''}${d.toFixed(1)}h` : `${d > 0 ? '+' : ''}${Math.round(d)}`
    const tone = Math.abs(d) < 1e-9 || betterLow == null ? '' : (betterLow ? d < 0 : d > 0) ? 'good' : 'crit'
    return { text: `${text} vs prior month`, tone }
  }
  const kpiDefs = (m) => {
    const g = goalH()
    return [
      { label: 'Avg E2E MTTR', icon: 'clock', tone: 'sky', value: fmtH(m.s.eze), d: delta(m.s.eze, m.p.eze, 'h', true, m.hasPrev), info: 'Created in ServiceNow → tagged Resolved in Scope, averaged over tickets resolved this month: the full calendar clock, On Hold included. The customer\'s lived experience.' },
      { label: 'Avg RES MTTR', icon: 'bolt', tone: 'azure', value: fmtH(m.s.res), d: delta(m.s.res, m.p.res, 'h', true, m.hasPrev), info: `Handed to the analyst by Scope → tagged Resolved: time with the analyst, leaving out any time On Hold (that's the user's clock). The goal metric (≤ ${g} h). The exports can't show "active" handling time, so this is the closest measure until the team settles MTTR.` },
      { label: 'SLA attainment', icon: 'shield', tone: !isNaN(m.s.sla) && m.s.sla < NORTH_STAR ? 'warn' : 'good', state: !isNaN(m.s.sla) && m.s.sla < NORTH_STAR ? 'warn' : undefined, value: pct(m.s.sla), d: delta(m.s.sla, m.p.sla, 'pct', false, m.hasPrev), info: `Share of tickets resolved this month with RES MTTR within ${g} h. North star: ${Math.round(NORTH_STAR * 100)}%.` },
      { label: 'Ticket volume', icon: 'doc', tone: 'ice', value: m.s.n, d: delta(m.s.n, m.p.n, 'n', null, m.hasPrev), info: 'INC tickets tagged Resolved this month (Transferred not included).' },
      { label: 'Transfer rate', icon: 'swap', tone: 'navy', value: pct(m.s.tr), d: delta(m.s.tr, m.p.tr, 'pct', true, m.hasPrev), info: 'Transferred ÷ (Resolved + Transferred) this month.' },
    ]
  }

  // ---------- In the app ----------
  function heatGrid(heat) {
    const max = Math.max(1, ...heat.flat())
    const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    return html`<div class="ra-heat" role="img" aria-label="Tickets created by weekday and hour">
      <span></span>${Array.from({ length: 24 }, (_, h) => html`<span class="ra-hh">${h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>`)}
      ${heat.map((row, i) => html`<span class="ra-hd">${DOW[i]}</span>${row.map((n, h) => html`<span class="ra-hc" style="--a:${n ? 0.15 + 0.85 * (n / max) : 0}" title="${DOW[i]} ${String(h).padStart(2, '0')}:00 · ${n} ticket${n === 1 ? '' : 's'}"></span>`)}`)}
    </div>`
  }
  function splitBar(sp) {
    const parts = [['Before our queue', sp.before, 'var(--s5)'], ['Waiting for an owner', sp.wait, 'var(--s4)'], ['With the analyst (RES)', sp.res, 'var(--s2)']]
    const tot = parts.reduce((a, p) => a + (isNaN(p[1]) ? 0 : p[1]), 0)
    if (!sp.n || !tot) return html`<div class="empty small">No resolved tickets with all three times yet.</div>`
    return html`<div class="stack" style="gap:12px">
      <div class="ra-split">${parts.map(([l, v, c]) => html`<span style="width:${(v / tot) * 100}%;background:${c}" title="${l}: ${fmtH(v)}"></span>`)}</div>
      <div class="ra-legend">${parts.map(([l, v, c]) => html`<div class="row tight"><span class="cmp-dot" style="background:${c}"></span><span class="small">${l}</span><b class="num">${fmtH(v)}</b><span class="muted small">${Math.round((v / tot) * 100)}%</span></div>`)}</div>
      <div class="small muted">Average over ${sp.n} resolved ticket${sp.n === 1 ? '' : 's'}. <b>Lost time</b> (E2E − RES) = the first two: ${fmtH(sp.before + sp.wait)}.</div>
    </div>`
  }
  // ---------- Insights: a few computed sentences per card ----------
  const DOWL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  function insights(m) {
    const g = goalH(); const s = m.s
    const wkRes = m.wk.filter((w) => w.res != null)
    const best = wkRes.slice().sort((a, b) => a.res - b.res)[0]; const worst = wkRes.slice().sort((a, b) => b.res - a.res)[0]
    const over = wkRes.filter((w) => w.res > g).length
    const wkN = m.wk.filter((w) => w.n); const avgWk = avg(wkN.map((w) => w.n)); const busiest = wkN.slice().sort((a, b) => b.n - a.n)[0]
    const resolvedN = m.causes.reduce((a, x) => a + x.value, 0)
    const top3 = m.codes.slice(0, 3).reduce((a, x) => a + x.value, 0); const codedN = m.codes.reduce((a, x) => a + x.value, 0)
    const sp = m.split; const tot = (sp.before || 0) + (sp.wait || 0) + (sp.res || 0)
    const within = m.dist.filter((x) => !x.over).reduce((a, x) => a + x.value, 0); const distN = m.dist.reduce((a, x) => a + x.value, 0)
    const overDay = m.dist.filter((x) => x.label === '1–3d' || x.label === '> 3d').reduce((a, x) => a + x.value, 0)
    let peak = { n: 0 }; let early = 0; let heatN = 0
    m.heat.forEach((row, d) => row.forEach((n, h) => { heatN += n; if (h < 6) early += n; if (n > peak.n) peak = { n, d, h } }))
    const dayTot = m.heat.map((row) => row.reduce((a, x) => a + x, 0)); const busyDay = dayTot.indexOf(Math.max(...dayTot))
    const slow = m.byAnalyst.filter((x) => x.value > g)
    const hi = m.prio.filter((x) => /^[12]/.test(x.label)).reduce((a, x) => a + x.value, 0); const prioN = m.prio.reduce((a, x) => a + x.value, 0)
    const sk = m.strike.map((x) => ({ ...x, rate: x.done + x.missed ? x.done / (x.done + x.missed) : NaN })).filter((x) => !isNaN(x.rate))
    const skWorst = sk.slice().sort((a, b) => a.rate - b.rate)[0]
    const gapN = !isNaN(s.sla) && s.sla < NORTH_STAR ? Math.ceil((NORTH_STAR - s.sla) * (s.n || 0)) : 0
    const P = (x) => `${Math.round(x * 100)}%`
    return {
      eze: [!isNaN(s.lost) && !isNaN(s.eze) && s.eze > 0 && `Lost time (E2E − RES) is ${fmtH(s.lost)}, ${P(Math.max(0, s.lost) / s.eze)} of what the customer waits.`],
      res: [slow.length ? `${slow.length} of ${m.byAnalyst.length} analysts average above the ${g} h goal.` : m.byAnalyst.length && `Every analyst averages within the ${g} h goal.`, best && worst && best !== worst && `Best week: ${best.label} (${fmtH(best.res)}). Slowest: ${worst.label} (${fmtH(worst.res)}).`],
      sla: [isNaN(s.sla) ? null : s.sla >= NORTH_STAR ? `At or above the ${P(NORTH_STAR)} north star.` : `${Math.round((NORTH_STAR - s.sla) * 100)} pts below the ${P(NORTH_STAR)} north star: about ${gapN} more ticket${gapN === 1 ? '' : 's'} within ${g} h would close the gap.`],
      vol: [busyDay >= 0 && heatN && `Busiest weekday for new tickets: ${DOWL[busyDay]}.`, !isNaN(avgWk) && `About ${Math.round(avgWk)} tickets resolved a week over the last 12 weeks.`],
      tr: [s.closed && `${s.transferred} of ${s.closed} closed tickets were transferred to another team.`],
      mttr: [wkRes.length && `RES MTTR was above the ${g} h goal in ${over} of ${wkRes.length} weeks.`, best && `Best week ${best.label} at ${fmtH(best.res)}${worst && worst !== best ? `; slowest ${worst.label} at ${fmtH(worst.res)}` : ''}.`],
      volwk: [busiest && `Busiest week: ${busiest.label} with ${busiest.n} resolved.`, !isNaN(avgWk) && `Average ${Math.round(avgWk)} a week.`],
      causes: [m.causes[0] && resolvedN && `${m.causes[0].label} drives ${P(m.causes[0].value / resolvedN)} of resolved tickets.`, m.causes[1] && `Next: ${m.causes[1].label} (${m.causes[1].value}).`],
      codes: [codedN && m.codes.length >= 3 && `The top 3 codes cover ${P(top3 / codedN)} of resolutions: good candidates for a runbook, a KB article or automation.`],
      split: [tot && `${P(((sp.before || 0) + (sp.wait || 0)) / tot)} of a ticket's life is lost time (before our queue and waiting for an owner).`, tot && sp.wait > sp.before && 'Waiting for an owner is the bigger part: loading the export more often or earlier hand-out shortens it.'],
      dist: [distN && `${P(within / distN)} resolved within ${g} h.`, overDay && `${overDay} took more than a day: check them for On Hold or waiting on another team.`],
      heat: [peak.n && `Peak: ${DOWL[peak.d]} around ${String(peak.h).padStart(2, '0')}:00 (${peak.n} tickets).`, heatN && `${P(early / heatN)} are created before 06:00, so they are waiting as backlog when the Early shift starts.`],
      analyst: [m.byAnalyst.length > 1 && `Fastest ${m.byAnalyst[m.byAnalyst.length - 1].label} (${fmtH(m.byAnalyst[m.byAnalyst.length - 1].value)}), slowest ${m.byAnalyst[0].label} (${fmtH(m.byAnalyst[0].value)}). Ticket mix differs, so use it to coach, not to rank.`],
      prio: [prioN && `${P(hi / prioN)} are P1/P2.`],
      strike: [skWorst && `${skWorst.name} has the most not finished in its window (${P(1 - skWorst.rate)}).`, sk.length && 'A ticket not finished is tried again the next working day.'],
    }
  }
  const tip = (id, title, what, list) => S.infoTip(id, title, html`<span>${what}</span>${(list || []).filter(Boolean).length ? html`<span><b>Insights</b></span>${list.filter(Boolean).map((x) => html`<span>• ${x}</span>`)}` : html`<span class="muted">Insights appear once there is data for this month.</span>`}`)

  function section(k) {
    const m = model(k)
    const g = goalH()
    const I = insights(m)
    const card = (id, title, sub, body, what) => html`<div class="card" data-key="${id}"><div class="card-h"><h2>${title}</h2>${sub && html`<span class="muted small">${sub}</span>`}<span class="spacer"></span>${tip(id, title, what, I[id.replace('ra-', '')])}</div><div class="card-b">${body}</div></div>`
    const empty = (t) => html`<div class="empty small">${t}</div>`
    const KI = { 'Avg E2E MTTR': 'eze', 'Avg RES MTTR': 'res', 'SLA attainment': 'sla', 'Ticket volume': 'vol', 'Transfer rate': 'tr' }
    return html`<div class="stack" style="gap:16px">
      <section class="grid ra-kpis" aria-label="MTTR and SLA">
        ${kpiDefs(m).map((x) => S.kpi({ label: x.label, icon: x.icon, tone: x.tone, state: x.state, value: x.value, foot: html`<span class="${cls(x.d.tone && `ra-${x.d.tone}`)}">${x.d.text}</span>`,
          info: html`<span>${x.info}</span>${(I[KI[x.label]] || []).filter(Boolean).length > 0 && html`<span><b>Insights</b></span>${I[KI[x.label]].filter(Boolean).map((t) => html`<span>• ${t}</span>`)}`}` }))}
      </section>
      <section class="grid g-2">
        ${card('ra-mttr', 'MTTR by week', 'hours, one axis', m.wk.some((w) => w.eze != null) ? S.lineChart('ra-mttr', { labels: m.wk.map((w) => w.label), goal: g, unit: 'h', fmt: (v) => `${v.toFixed(1)}h`,
          series: [{ name: 'E2E MTTR', color: 'var(--s2)', values: m.wk.map((w) => w.eze) }, { name: 'RES MTTR', color: 'var(--s1)', values: m.wk.map((w) => w.res) }] }) : empty('No resolved tickets in these 12 weeks yet.'),
          `Average E2E MTTR (created → Resolved) and RES MTTR (handed out → Resolved) of the tickets resolved each week, over the 12 weeks up to this month. The dashed line is the ${g} h goal.`)}
        ${card('ra-volwk', 'Ticket volume by week', 'resolved tickets', S.barChart('ra-vol', { labels: m.wk.map((w) => w.label), values: m.wk.map((w) => w.n), fmt: (v) => `${Math.round(v)}` }),
          'INC tickets tagged Resolved each week, over the same 12 weeks.')}
      </section>
      <section class="grid g-2">
        ${card('ra-causes', 'Root causes', 'from resolution codes', m.causes.length ? S.hBars({ rows: m.causes.slice(0, 8), color: 'var(--s7)' }) : empty('No resolution codes recorded this month. They come from the resolution journey when a ticket is tagged Resolved.'),
          'Resolved tickets this month by the root-cause category of their resolution code (chosen in the resolution journey).')}
        ${card('ra-codes', 'Most used resolution codes', 'top 8', m.codes.length ? S.hBars({ rows: m.codes, color: 'var(--s3)' }) : empty('No resolution codes recorded this month.'),
          'The resolution codes used most often this month.')}
      </section>
      <section class="grid g-2">
        ${card('ra-split', 'Where the time goes', 'created → resolved, on average', splitBar(m.split),
          'Before our queue: created in ServiceNow → first seen in our INC export. Waiting for an owner: → Scope handed it out. With the analyst: → tagged Resolved (RES MTTR). The first two together are the lost time.')}
        ${card('ra-dist', 'Time to resolve', `RES MTTR spread · goal ${g} h`, m.dist.some((x) => x.value) ? S.hBars({ rows: m.dist.map((x) => ({ label: x.label, value: x.value, color: x.over ? 'var(--crit)' : 'var(--good)' })) }) : empty('No resolved tickets this month yet.'),
          `How many tickets resolved this month took each length of time with the analyst. Green is within the ${g} h goal, red is past it.`)}
      </section>
      <section class="grid g-2">
        ${card('ra-heat', 'When tickets arrive', `created time · ${m.recv} tickets`, m.recv ? heatGrid(m.heat) : empty('No tickets created this month yet.'),
          'Tickets created this month by weekday and hour (Philippine time). Darker = more tickets.')}
        ${card('ra-analyst', 'RES MTTR by analyst', `goal ${g} h`, m.byAnalyst.length ? S.hBars({ rows: m.byAnalyst.map((x) => ({ ...x, color: x.value > g ? 'var(--crit)' : 'var(--s2)' })), fmt: fmtH, target: g }) : empty('No resolved tickets this month yet.'),
          `Each analyst's average time with the ticket (handed out → Resolved) this month. The mark is the ${g} h goal; red bars are above it.`)}
      </section>
      <section class="grid g-2">
        ${card('ra-prio', 'Priority mix', 'tickets created this month', m.prio.length ? S.hBars({ rows: m.prio, color: 'var(--s5)' }) : empty('No tickets yet.'),
          'Tickets created this month by ServiceNow priority.')}
        ${card('ra-strike', '3-Strike by region', 'finished · not finished in window', m.strike.some((x) => x.done || x.missed) ? html`<div class="stack" style="gap:10px">${m.strike.map((x) => { const t = Math.max(1, x.done + x.missed); return html`<div class="ra-strike" data-key="${x.name}"><span class="small">${x.name}</span><div class="ra-split sm"><span style="width:${(x.done / t) * 100}%;background:var(--good)"></span><span style="width:${(x.missed / t) * 100}%;background:var(--crit)"></span></div><b class="num">${x.done}</b><span class="num crit-ink">${x.missed}</span></div>` })}</div>` : empty('No 3-Strike tickets handed out this month.'),
          '3-Strike tickets handed out this month per region: finished (a contact attempt logged in the window, green) and not finished in the window (red).')}
      </section>
    </div>`
  }

  // ---------- Static version for the downloaded report ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p }
  function svgLine(labels, series, goal) {
    const W = 520, H = 220, l = 38, r = 10, t = 12, b = 26, iw = W - l - r, ih = H - t - b
    const max = niceMax(Math.max(goal || 0, ...series.flatMap((s) => s.values.filter((v) => v != null))) * 1.08)
    const x = (i) => l + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw); const y = (v) => t + ih - (v / max) * ih
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`
    ;[0, 0.25, 0.5, 0.75, 1].forEach((f) => { s += `<line x1="${l}" x2="${l + iw}" y1="${y(f * max)}" y2="${y(f * max)}" stroke="var(--line)" stroke-dasharray="3 3"/><text x="${l - 5}" y="${y(f * max) + 4}" text-anchor="end">${+(f * max).toFixed(1)}</text>` })
    labels.forEach((lb, i) => { if (i % 2 === 0) s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(lb)}</text>` })
    if (goal) s += `<line x1="${l}" x2="${l + iw}" y1="${y(goal)}" y2="${y(goal)}" stroke="var(--crit)" stroke-dasharray="5 4" stroke-width="1.4"/><text x="${l + iw}" y="${y(goal) - 4}" text-anchor="end" fill="var(--crit)">Goal ${goal}h</text>`
    series.forEach((sr) => { const pts = sr.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean); if (!pts.length) return; s += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('')}" fill="none" stroke="${sr.color}" stroke-width="2"/>` + pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="${sr.color}"/>`).join('') })
    return s + `</svg><div class="legend sub">${series.map((sr) => `<span><i class="sw" style="background:${sr.color}"></i>${esc(sr.name)}</span>`).join('')}</div>`
  }
  function svgBars(labels, values, color) {
    const W = 520, H = 200, l = 30, r = 6, t = 12, b = 26, iw = W - l - r, ih = H - t - b
    const max = niceMax(Math.max(1, ...values)); const bw = iw / labels.length
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`
    ;[0, 0.5, 1].forEach((f) => { const yy = t + ih - f * ih; s += `<line x1="${l}" x2="${l + iw}" y1="${yy}" y2="${yy}" stroke="var(--line)" stroke-dasharray="3 3"/><text x="${l - 5}" y="${yy + 4}" text-anchor="end">${+(f * max).toFixed(1)}</text>` })
    values.forEach((v, i) => { const h = (v / max) * ih; s += `<rect x="${l + i * bw + bw * 0.14}" y="${t + ih - h}" width="${bw * 0.72}" height="${h}" rx="3" fill="${color}"><title>${esc(labels[i])}: ${v}</title></rect>`; if (i % 2 === 0) s += `<text x="${l + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(labels[i])}</text>` })
    return s + '</svg>'
  }
  const hbarsHtml = (rows, fmt = (v) => v, color = 'var(--a)') => { const max = Math.max(1e-9, ...rows.map((r) => r.value)); return `<table>${rows.map((r) => `<tr><td style="width:34%">${esc(r.label)}</td><td><div class="bar"><i style="width:${(r.value / max) * 100}%;background:${r.color || color}"></i></div></td><td class="r" style="width:70px">${esc(fmt(r.value))}</td></tr>`).join('')}</table>` }
  function staticHtml(k) {
    const m = model(k); const g = goalH(); const sec = S.reportSection
    const kp = kpiDefs(m).map((x) => `<div class="sheet kpi"><div class="l">${esc(x.label)}</div><div class="v">${esc(x.value)}</div><div class="sub ${x.d.tone}">${esc(x.d.text)}</div></div>`).join('')
    const max = Math.max(1, ...m.heat.flat()); const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const heat = `<table class="heat"><tr><th></th>${Array.from({ length: 24 }, (_, h) => `<th>${h % 3 === 0 ? h : ''}</th>`).join('')}</tr>${m.heat.map((row, i) => `<tr><th>${DOW[i]}</th>${row.map((n) => `<td title="${n}" style="background:color-mix(in srgb, var(--a) ${n ? 15 + 85 * (n / max) : 0}%, var(--line))"></td>`).join('')}</tr>`).join('')}</table>`
    const sp = m.split; const tot = (sp.before || 0) + (sp.wait || 0) + (sp.res || 0)
    const split = sp.n && tot ? `<div class="split">${[[sp.before, 'var(--s5c)'], [sp.wait, 'var(--b)'], [sp.res, 'var(--a)']].map(([v, c]) => `<i style="width:${(v / tot) * 100}%;background:${c}"></i>`).join('')}</div><p class="sub">Before our queue ${fmtH(sp.before)} · Waiting for an owner ${fmtH(sp.wait)} · With the analyst ${fmtH(sp.res)} (${sp.n} tickets). Lost time ${fmtH(sp.before + sp.wait)}.</p>` : '<p class="sub">No resolved tickets with all three times yet.</p>'
    const none = '<p class="sub">Nothing this month yet.</p>'
    return [
      `<h2 class="h">Analytics</h2><div class="kpis">${kp}</div>`,
      `<div class="grid2">${sec('MTTR by week · hours', svgLine(m.wk.map((w) => w.label), [{ name: 'E2E MTTR', color: 'var(--a)', values: m.wk.map((w) => w.eze) }, { name: 'RES MTTR', color: 'var(--ink)', values: m.wk.map((w) => w.res) }], g))}${sec('Ticket volume by week · resolved', svgBars(m.wk.map((w) => w.label), m.wk.map((w) => w.n), 'var(--a)'))}</div>`,
      `<div class="grid2">${sec('Root causes', m.causes.length ? hbarsHtml(m.causes.slice(0, 8)) : none)}${sec('Most used resolution codes', m.codes.length ? hbarsHtml(m.codes, undefined, 'var(--g)') : none)}</div>`,
      `<div class="grid2">${sec('Where the time goes', split)}${sec(`Time to resolve · goal ${g} h`, m.dist.some((x) => x.value) ? hbarsHtml(m.dist.map((x) => ({ ...x, color: x.over ? 'var(--crit)' : 'var(--good)' }))) : none)}</div>`,
      `<div class="grid2">${sec('When tickets arrive · created time', m.recv ? heat : none)}${sec(`RES MTTR by analyst · goal ${g} h`, m.byAnalyst.length ? hbarsHtml(m.byAnalyst, fmtH) : none)}</div>`,
      `<div class="grid2">${sec('Priority mix', m.prio.length ? hbarsHtml(m.prio) : none)}${sec('3-Strike by region · finished / not finished', `<table>${m.strike.map((x) => `<tr><td>${esc(x.name)}</td><td class="r">${x.done}</td><td class="r" style="color:var(--crit)">${x.missed}</td></tr>`).join('')}</table>`)}</div>`,
      `<p class="note">E2E MTTR: created → Resolved. RES MTTR: handed to the analyst → Resolved, On Hold time left out (the exports can't show active handling time). SLA attainment: share resolved with RES within ${g} h; north star ${Math.round(NORTH_STAR * 100)}%.</p>`,
    ].join('')
  }

  // Shared with Compare: a ticket's time On Hold in ms (the user's clock, left out of RES).
  S.reportHoldMs = (t) => {
    const hold = (t.history || []).find((h) => h.what === 'tagged On Hold')
    if (!hold || !t.tagAt || hold.at >= t.tagAt) return 0
    const reached = (t.sk || []).map((w) => w.log).filter((l) => l && l.reached).sort((x, y) => y.at - x.at)[0]
    return (reached && reached.at < t.tagAt ? reached.at : t.tagAt) - hold.at
  }
  S.reportAnalytics = section
  S.reportAnalyticsHtml = staticHtml
})()
