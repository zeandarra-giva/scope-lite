// Account profile, ported from src/pages/Settings.jsx: profile and extra
// fields, role-based access, a year-at-a-glance heatmap, leave balances,
// this week's shifts and leave requests.
;(function () {
  const { html, cls, style, icon, DAY, LEAVE_REQUESTS, SHIFT_CODES, fmtDate, initials, seedActivity, weekStart } = S

  const KINDS = [
    ['onsite', 'Worked onsite', 'var(--s7)'],
    ['wfh', 'Worked from home', 'color-mix(in srgb, var(--s7) 45%, var(--card))'],
    ['late', 'Late shift', 'var(--pink)'],
    ['weekend', 'Weekend duty', 'var(--s3)'],
    ['leave', 'Personal leave', 'var(--s4)'],
    ['sick', 'Sick leave', 'var(--s8)'],
    ['holiday', 'Holiday', 'var(--s1)'],
    ['none', 'Rest day', 'var(--heat-0)'],
  ]

  const kindLabel = (k) => KINDS.find((x) => x[0] === k)[1]
  // Hover text for a heatmap day. Worked days also say which shift it was.
  function describe(c) {
    const sh = c.shift && SHIFT_CODES[c.shift]
    const shift = sh && `${sh.label === 'Weekend duty' ? 'Weekend duty' : sh.label + ' shift'} (${sh.time})`
    if (c.kind === 'onsite' || c.kind === 'wfh') return `${kindLabel(c.kind)} · ${shift}`
    if (c.kind === 'late' || c.kind === 'weekend') return `${shift} · ${c.loc === 'WFH' ? 'from home' : 'onsite'}`
    return kindLabel(c.kind)
  }

  // seedActivity is deterministic per person; keep one copy per user (the useMemo).
  const activityCache = {}
  const activityOf = (me) => activityCache[me.id] || (activityCache[me.id] = seedActivity(me))

  const ui = () => {
    const me = S.currentUser(S.state)
    return S.ui('p:settings', () => ({
      fields: [['Timezone', 'Asia/Manila (UTC+8)'], ['Phone', '+63 917 555 0142'], ['Desk', 'Tower 2 · 14F · D-21']],
      nf: { k: '', v: '' },
      profile: { email: `${me.name.toLowerCase().replace(' ', '.')}@corp.example`, manager: me.role === 'Team Lead' ? 'Service Ops Manager' : 'Andrea Santos' },
      hover: null,
      reqs: LEAVE_REQUESTS,
      newLeave: { type: 'Personal leave', from: '', days: 1 },
    }))
  }

  S.pages.settings = function Settings() {
    const state = S.state
    const me = S.currentUser(state)
    const activity = activityOf(me)
    const { fields, nf, profile, hover, reqs, newLeave } = ui()

    const counts = Object.fromEntries(KINDS.map(([k]) => [k, activity.filter((d) => d.kind === k).length]))
    // Pad so the first column starts on Sunday, like a contribution graph.
    const pad = new Date(activity[0].ts).getDay()
    const cells = [...Array(pad).fill(null), ...activity]
    const months = []
    cells.forEach((c, i) => {
      if (!c) return
      const d = new Date(c.ts)
      if (d.getDate() === 1) months.push({ col: Math.floor(i / 7), label: d.toLocaleDateString([], { month: 'short' }) })
    })
    // Heatmap squares scale with the card: fit all week columns into the width
    // (measured by the core's data-w observer).
    const heatW = S.width('settings-heat', 0)
    const cols = Math.ceil(cells.length / 7)
    const avail = heatW - 28 - 4
    const gap = avail / cols >= 18 ? 4 : 3
    const cell = heatW ? Math.max(8, Math.min(28, Math.floor((avail + gap) / cols) - gap)) : 12
    const weekIdx = Math.floor((state.now - weekStart(state.now)) / DAY)
    const myWeek = state.schedule.days.slice(0, 7).map((d, i) => [d, state.schedule.sched[me.id]?.[i]])

    return html`
      <section class="grid g-1-2">
        <div class="stack lg" style="align-self:start">
        <div class="card">
          <div class="card-b stack lg" style="padding-top:18px">
            <div class="row" style="flex-wrap:nowrap;gap:14px">
              <span class="avatar lg">${initials(me.name)}</span>
              <div class="stack" style="gap:2px">
                <h2 style="font:600 20px/1.2 var(--f-cond)">${me.name}</h2>
                <span class="mono ink2">${me.soeid}</span>
                <span class="pill ${me.role === 'Team Lead' ? 'accent' : 'plain'}" style="align-self:flex-start">${me.role}</span>
              </div>
            </div>
            <div class="stack">
              ${[['Assignment group', me.group], ['Default shift', `${me.shift} · ${SHIFT_CODES[me.shift[0]]?.time || ''}`], ['Base location', me.location], ['Skills', me.skills.join(', ')]].map(([k, v]) => html`
                <div class="list-row small"><span class="muted" style="width:120px">${k}</span><b>${v}</b></div>`)}
            </div>
            <label class="field"><span>Work email</span><input id="pf-email" class="in" value="${profile.email}" data-input="settings.profile" data-f="email"></label>
            <label class="field"><span>Reports to</span><input id="pf-mgr" class="in" value="${profile.manager}" data-input="settings.profile" data-f="manager"></label>
            <div class="stack">
              <span class="section-title">More details</span>
              ${fields.map(([k, v], i) => html`
                <div class="row" style="flex-wrap:nowrap">
                  <span class="small muted" style="width:90px;flex:none">${k}</span>
                  <input class="in" style="flex:1" value="${v}" aria-label="${k}" data-input="settings.field" data-i="${i}">
                  <button class="btn ghost sm" aria-label="Remove ${k}" data-click="settings.fieldRemove" data-i="${i}">${icon('x', 13)}</button>
                </div>`)}
              <form class="row" style="flex-wrap:nowrap" data-submit="settings.fieldAdd">
                <input id="pf-newk" class="in" style="width:110px" placeholder="Field" value="${nf.k}" data-input="settings.nf" data-f="k">
                <input id="pf-newv" class="in" style="flex:1;min-width:0" placeholder="Value" value="${nf.v}" data-input="settings.nf" data-f="v">
                <button class="btn sm" type="submit">${icon('plus', 14)}Add</button>
              </form>
            </div>
            <button class="btn primary" style="align-self:flex-start" data-click="settings.save">Save profile</button>
          </div>
        </div>

          <div class="card">
            <div class="card-h"><h3>Role-based access</h3><span class="spacer"></span><span class="pill accent">You: ${me.role}</span></div>
            <div class="card-b stack lg">
              ${Object.entries(S.ACCESS).map(([r, list]) => {
                const mine = r === me.role
                return html`<div class="stack" style="gap:6px;opacity:${mine ? 1 : 0.55}">
                  <div class="row"><span class="${cls('pill', mine && 'accent')}">${r}</span>${mine && html`<span class="small muted">your access</span>`}</div>
                  <ul style="margin:0;padding-left:18px" class="small ink2 stack">${list.map((x) => html`<li>${x}</li>`)}</ul>
                </div>`
              })}
              <span class="small muted">Access is assigned by your team lead in Team Management.</span>
            </div>
          </div>
        </div>

        <div class="stack lg">
          <div class="card">
            <div class="card-h"><h3>Your year at a glance</h3><span class="muted small">${activity.length} days · attendance, shifts and leave</span></div>
            <div class="card-b stack lg">
              <div class="tbl-wrap" data-w="settings-heat" style="padding-bottom:4px">
                <div class="heat-wrap" style="--cell:${cell}px;--gap:${gap}px">
                  <span></span>
                  <div style="position:relative;height:14px">
                    ${months.map((m) => html`<span class="small muted" style="position:absolute;left:${m.col * (cell + gap)}px;font-size:11px">${m.label}</span>`)}
                  </div>
                  <div class="heat-days muted">
                    ${['', 'Mon', '', 'Wed', '', 'Fri', ''].map((d) => html`<span>${d}</span>`)}
                  </div>
                  <div class="heat" data-mouseleave="settings.hoverOut">
                    ${cells.map((c, i) => c ? html`<i data-k="${c.kind}" class="${i === cells.length - 1 ? 'today' : ''}" data-mousemove="settings.hover" data-i="${i}"
                        title="${fmtDate(c.ts)}: ${describe(c)}"></i>` : html`<i style="visibility:hidden"></i>`)}
                  </div>
                </div>
              </div>
              <div class="small ink2" style="min-height:20px">${hover ? html`<b>${new Date(hover.ts).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</b> · ${describe(hover)}` : 'Hover a square to see the day.'}</div>
              <div class="legend">
                ${KINDS.map(([k, l, c]) => html`<span><i style="background:${c}"></i>${l} <b class="num">${counts[k]}</b></span>`)}
              </div>
            </div>
          </div>

          <section class="grid g-kpi">
            ${S.kpi({ label: 'Personal leave left', icon: 'cal', value: 15 - counts.leave > 0 ? 15 - Math.min(15, counts.leave) : 0, unit: '/ 15 days' })}
            ${S.kpi({ label: 'Sick leave left', icon: 'user', tone: 'azure', value: Math.max(0, 10 - counts.sick), unit: '/ 10 days' })}
            ${S.kpi({ label: 'Attendance rate', icon: 'check', tone: 'ice', value: `${Math.round(((counts.onsite + counts.wfh + counts.late) / Math.max(1, counts.onsite + counts.wfh + counts.late + counts.sick)) * 100)}%`, foot: 'Worked days vs. unplanned absence' })}
          </section>

          <div class="card">
            <div class="card-h"><h3>This week's shifts</h3></div>
            <div class="card-b">
              <div class="grid" style="grid-template-columns:repeat(7, minmax(0, 1fr));gap:6px">
                ${myWeek.map(([d, c], i) => html`
                  <div class="stack" style="gap:4px;align-items:center">
                    <span class="small" style="${style({ fontWeight: i === weekIdx ? 700 : 400, color: i === weekIdx ? 'var(--accent)' : 'var(--muted)' })}">${new Date(d).toLocaleDateString([], { weekday: 'short' })}</span>
                    <div class="cell ${c}" title="${SHIFT_CODES[c]?.label}">${c}</div>
                  </div>`)}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-h"><h3>Leave requests</h3></div>
            <div class="card-b stack lg">
              <form class="row" data-submit="settings.leave">
                <select id="lv-type" class="in" data-change="settings.newLeave" data-f="type">${['Personal leave', 'Sick leave'].map((t) => html`<option ${S.attrs({ selected: newLeave.type === t })}>${t}</option>`)}</select>
                <input id="lv-from" type="date" class="in" value="${newLeave.from}" data-input="settings.newLeave" data-f="from" aria-label="Start date">
                <input id="lv-days" type="number" min="1" max="15" class="in" style="width:72px" value="${newLeave.days}" data-input="settings.newLeave" data-f="days" aria-label="Days">
                <button class="btn primary sm" type="submit">Request leave</button>
              </form>
              <div class="tbl-wrap">
                <table class="tbl">
                  <thead><tr><th>ID</th><th>Type</th><th>Dates</th><th class="r">Days</th><th>Approver</th><th>Status</th></tr></thead>
                  <tbody>${reqs.map((r) => html`
                    <tr data-key="${r.id}">
                      <td class="mono">${r.id}</td><td>${r.type}</td><td class="nowrap">${fmtDate(r.from)}${r.days > 1 && ` – ${fmtDate(r.to)}`}</td><td class="r">${r.days}</td><td class="small">${r.approver}</td>
                      <td><span class="pill ${r.status === 'Approved' ? 'good' : r.status === 'Rejected' ? 'crit' : 'warn'}" ${S.attrs({ title: r.note })}>${r.status}</span></td>
                    </tr>`)}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>`
  }

  // ---------- Handlers ----------
  // Text inputs only store their value; nothing else on screen depends on them
  // (the "new field" inputs re-render so they can be cleared after Add).
  S.on({
    'settings.profile': (el) => { const u = ui(); u.profile = { ...u.profile, [el.dataset.f]: el.value } },
    'settings.field': (el) => {
      const u = ui(); const i = Number(el.dataset.i)
      u.fields = u.fields.map((f, j) => (j === i ? [f[0], el.value] : f))
    },
    'settings.fieldRemove': (el) => { const u = ui(); const i = Number(el.dataset.i); S.set(u, { fields: u.fields.filter((_, j) => j !== i) }) },
    'settings.nf': (el) => { const u = ui(); S.set(u, { nf: { ...u.nf, [el.dataset.f]: el.value } }) },
    'settings.fieldAdd': () => {
      const u = ui()
      if (u.nf.k.trim()) S.set(u, { fields: [...u.fields, [u.nf.k.trim(), u.nf.v]], nf: { k: '', v: '' } })
    },
    'settings.save': () => S.dispatch({ type: 'toast', text: 'Profile saved' }),
    'settings.hover': (el) => {
      const u = ui()
      const me = S.currentUser(S.state)
      const activity = activityOf(me)
      const pad = new Date(activity[0].ts).getDay()
      const c = activity[Number(el.dataset.i) - pad]
      if (c && u.hover !== c) S.set(u, { hover: c })
    },
    'settings.hoverOut': () => { const u = ui(); if (u.hover) S.set(u, { hover: null }) },
    'settings.newLeave': (el) => { const u = ui(); u.newLeave = { ...u.newLeave, [el.dataset.f]: el.value } },
    'settings.leave': () => {
      const u = ui()
      const me = S.currentUser(S.state)
      const { newLeave, reqs } = u
      if (!newLeave.from) return
      const from = new Date(newLeave.from + 'T09:00').getTime()
      S.set(u, { reqs: [{ id: `LV-${2300 + reqs.length}`, type: newLeave.type, from, to: from + (newLeave.days - 1) * DAY, days: Number(newLeave.days), status: 'Pending', approver: me.role === 'Team Lead' ? 'Service Ops Manager' : 'Andrea Santos' }, ...reqs] })
      S.dispatch({ type: 'toast', text: 'Leave request sent for approval' })
    },
  })
})()
