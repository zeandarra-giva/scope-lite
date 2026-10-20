// Team Management, ported from src/pages/Team.jsx: roster and access, the
// shift calendar with leave and holidays, attendance, and the password vault.
;(function () {
  const { html, cls, style, attrs, icon, seg, DAY, NOW, SHIFT_CODES, TEAM_VAULT_SUMMARY, byId, fmtDate, fmtDay, initials, locationOn, weekStart } = S

  // Each tab's state lives under its own "p:team:" key. Switching tabs drops it,
  // like the React tab components unmounting (the calendar's "p:cal" too).
  S.pages.team = function Team(route) {
    const state = S.state
    const u = S.ui('p:team', () => ({ tab: route.tab || 'roster' }))
    const tab = u.tab
    const expiring = state.vault.filter((v) => v.expiresAt != null && v.expiresAt - state.now <= v.reminderDays * DAY).length
    return html`
      ${S.tabs([
        { id: 'roster', label: 'Roster & access', icon: 'team', count: state.analysts.length },
        { id: 'schedule', label: 'Schedule & coverage', icon: 'cal' },
        { id: 'attendance', label: 'Attendance', icon: 'clock' },
        { id: 'vault', label: 'Password vault', icon: 'key', count: expiring || undefined },
      ], tab, 'team.tab')}
      ${tab === 'roster' && roster()}
      ${tab === 'schedule' && schedule(route)}
      ${tab === 'attendance' && attendance()}
      ${tab === 'vault' && vault()}`
  }

  const ACCESS = {
    Manager: ['Everything analysts have', 'Whole-queue view', 'Rebalance & set analyst status', 'Approve automated fixes', 'Edit schedule, approve leave', 'Team vault compliance (counts only)', 'Coaching scorecards', 'Suggestions board & prototype controls'],
    Analyst: ['Own work queue + team queue (read)', 'Resolve & document tickets', 'Request automated fixes', 'Own schedule & leave requests', 'Own password vault', 'Send suggestions'],
  }

  // ---------- Roster ----------
  const rosterUi = () => S.ui('p:team:roster', () => ({ adding: false, m: { name: '', soeid: '', role: 'Analyst', group: 'Service Desk L2', shift: 'Early', location: 'WFH', status: 'offline', skills: [] } }))
  const opt = (v, cur, label = v) => html`<option ${attrs({ value: v, selected: String(cur) === String(v) })}>${label}</option>`

  function roster() {
    const state = S.state
    const lead = state.role === 'lead'
    const { adding, m } = rosterUi()
    return html`
      <section>
        <div class="card">
          <div class="card-h"><h3>Team roster</h3><span class="spacer"></span>${lead && html`<button class="btn primary sm" data-click="team.addOpen">${icon('plus', 14)}Add member</button>`}</div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Name</th><th>SOEID</th><th>Access role</th><th>Assignment group</th><th>Default shift</th><th>Base location</th><th>Today</th><th>Skills</th></tr></thead>
              <tbody>
                ${state.analysts.map((a) => html`
                  <tr data-key="${a.id}">
                    <td class="nowrap"><span class="row tight"><span class="avatar sm">${initials(a.name)}</span><b>${a.name}</b></span></td>
                    <td class="mono">${a.soeid}</td>
                    <td><span class="pill ${a.role === 'Manager' ? 'accent' : 'plain'}">${a.role}</span></td>
                    <td class="nowrap">${a.group}</td>
                    <td>${a.shift}</td>
                    <td>${a.location}</td>
                    <td><span class="pill ${a.status === 'online' ? 'good' : a.status === 'leave' ? 'warn' : 'plain'}">${a.status === 'leave' ? 'On leave' : a.status === 'online' ? 'Online' : 'Off shift'}</span></td>
                    <td class="small ink2">${a.skills.join(', ')}</td>
                  </tr>`)}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      ${adding && S.modal({
        title: 'Add team member',
        onClose: 'team.addClose',
        footer: html`
          <button class="btn" data-click="team.addClose">Cancel</button>
          <button class="btn primary" ${attrs({ disabled: !m.name.trim() || !/^[A-Z]{2}\d{5}$/.test(m.soeid) })} data-click="team.addSave">Add member</button>`,
        body: html`<div class="form-grid">
          <label class="field"><span>Full name</span><input id="nm-name" class="in" value="${m.name}" data-input="team.m" data-f="name"></label>
          <label class="field"><span>SOEID <span class="hint">2 letters + 5 digits</span></span><input id="nm-soeid" class="in mono" value="${m.soeid}" data-input="team.m" data-f="soeid" placeholder="AB12345"></label>
          <label class="field"><span>Access role</span><select id="nm-role" class="in" data-change="team.m" data-f="role">${['Analyst', 'Manager'].map((g) => opt(g, m.role))}</select></label>
          <label class="field"><span>Assignment group</span><select id="nm-group" class="in" data-change="team.m" data-f="group">${['Service Desk L2', 'Apps Support', 'Infra Ops'].map((g) => opt(g, m.group))}</select></label>
          <label class="field"><span>Default shift</span><select id="nm-shift" class="in" data-change="team.m" data-f="shift">${['Early', 'Mid', 'Late'].map((g) => opt(g, m.shift))}</select></label>
          <label class="field"><span>Base location</span><select id="nm-loc" class="in" data-change="team.m" data-f="location">${['WFH', 'Onsite'].map((g) => opt(g, m.location))}</select></label>
        </div>`,
      })}`
  }

  // ---------- Schedule ----------
  const schedUi = () => S.ui('p:team:sched', () => ({
    leaves: [
      { id: 'LV-2291', who: 'a9', type: 'Personal leave', from: NOW + 19 * DAY, days: 3, status: 'Pending' },
      { id: 'LV-2302', who: 'a4', type: 'Personal leave', from: NOW + 9 * DAY, days: 1, status: 'Pending' },
      { id: 'LV-2288', who: 'a10', type: 'Sick leave', from: NOW - 1 * DAY, days: 2, status: 'Approved' },
    ],
  }))

  function schedule(route) {
    const state = S.state
    const lead = state.role === 'lead'
    const { leaves } = schedUi()
    const people = state.analysts
    return html`
      ${S.shiftCalendar(route)}
      <section class="grid g-2">
        <div class="card">
          <div class="card-h"><h3>Leave requests</h3></div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>ID</th><th>Analyst</th><th>Type</th><th>From</th><th class="r">Days</th><th>Status</th></tr></thead>
              <tbody>
                ${leaves.map((l) => html`
                  <tr data-key="${l.id}">
                    <td class="mono">${l.id}</td><td class="nowrap">${byId[l.who].name}</td><td>${l.type}</td><td class="nowrap">${fmtDate(l.from)}</td><td class="r">${l.days}</td>
                    <td class="nowrap">${l.status === 'Pending' && lead ? html`
                      <span class="row tight">
                        <button class="btn primary sm" data-click="team.leave" data-v="${l.id}" data-status="Approved">Approve</button>
                        <button class="btn sm" data-click="team.leave" data-v="${l.id}" data-status="Rejected">Reject</button>
                      </span>` : html`<span class="pill ${l.status === 'Approved' ? 'good' : l.status === 'Rejected' ? 'crit' : 'warn'}">${l.status}</span>`}</td>
                  </tr>`)}
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Holidays & weekend rota</h3></div>
          <div class="card-b stack">
            ${[
              [state.schedule.days[11], 'Public holiday', 'Skeleton crew: Andrea, Paolo, Bea'],
              [state.schedule.days[5], 'Weekend duty', people.filter((a) => state.schedule.sched[a.id]?.[5] === 'W').map((a) => a.name).join(', ') || 'Nobody assigned'],
              [state.schedule.days[6], 'Weekend duty', people.filter((a) => state.schedule.sched[a.id]?.[6] === 'W').map((a) => a.name).join(', ') || 'Nobody assigned'],
              [state.schedule.days[12], 'Weekend duty', people.filter((a) => state.schedule.sched[a.id]?.[12] === 'W').map((a) => a.name).join(', ') || 'Nobody assigned'],
            ].map(([d, t, who]) => html`
              <div class="list-row small"><b style="width:70px">${fmtDay(d)}</b><span class="pill ${t === 'Public holiday' ? 'warn' : 'plain'}">${t}</span><span class="ink2">${who}</span></div>`)}
          </div>
        </div>
      </section>`
  }

  // ---------- Attendance ----------
  function attendance() {
    const state = S.state
    const todayIdx = Math.floor((state.now - weekStart(state.now)) / DAY)
    const rows = state.analysts.map((a, i) => {
      const code = state.schedule.sched[a.id]?.[todayIdx] || 'OFF'
      const shift = SHIFT_CODES[code]
      let status = 'Not yet due', tone = 'plain', inAt = '—'
      if (shift.kind === 'leave') { status = shift.label; tone = 'warn' }
      else if (shift.kind !== 'shift') { status = shift.label }
      else if (a.status === 'online') {
        const late = [3, 6].includes(i) ? 12 + i : 0
        const [h, mm] = shift.time.split('–')[0].split(':').map(Number)
        const d = new Date(state.now); d.setHours(h, mm + late - (late ? 0 : 4), 0, 0)
        inAt = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        status = late ? `Late ${late}m` : 'On time'; tone = late ? 'warn' : 'good'
      }
      return { a, code, shift, status, tone, inAt, loc: shift.kind === 'shift' ? locationOn(a, todayIdx) : '—' }
    })
    const month = state.analysts.map((a, i) => ({ a, onTime: 0.86 + ((i * 7) % 12) / 100, lates: (i * 3) % 5, absences: i % 4 === 3 ? 1 : 0, leave: (i * 2) % 4 }))
    return html`
      <section class="grid g-kpi">
        ${S.kpi({ label: 'Clocked in today', icon: 'clock', value: rows.filter((r) => r.inAt !== '—').length, unit: `/ ${rows.filter((r) => r.shift.kind === 'shift').length} scheduled` })}
        ${S.kpi({ label: 'Late arrivals', icon: 'alert', value: rows.filter((r) => r.status.startsWith('Late')).length, state: 'warn' })}
        ${S.kpi({ label: 'On leave', icon: 'cal', tone: 'azure', value: rows.filter((r) => r.shift.kind === 'leave').length })}
        ${S.kpi({ label: 'Team on-time rate (30d)', icon: 'check', tone: 'navy', value: `${Math.round(month.reduce((s, m) => s + m.onTime, 0) / month.length * 100)}%` })}
      </section>
      <section class="grid g-2">
        <div class="card">
          <div class="card-h"><h3>Today</h3></div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Analyst</th><th>Shift</th><th>Clock-in</th><th>Location</th><th>Status</th></tr></thead>
              <tbody>${rows.map((r) => html`
                <tr data-key="${r.a.id}"><td class="nowrap">${r.a.name}</td><td class="nowrap">${r.shift.label}<span class="muted small"> ${r.shift.time}</span></td><td class="mono">${r.inAt}</td><td>${r.loc}</td><td><span class="pill ${r.tone}">${r.status}</span></td></tr>`)}</tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Last 30 days</h3></div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Analyst</th><th class="r">On time</th><th class="r">Lates</th><th class="r">Absences</th><th class="r">Leave days</th></tr></thead>
              <tbody>${month.map((m) => html`
                <tr data-key="${m.a.id}"><td class="nowrap">${m.a.name}</td><td class="r">${Math.round(m.onTime * 100)}%</td><td class="r">${m.lates}</td><td class="r" style="${style({ color: m.absences ? 'var(--crit)' : undefined })}">${m.absences}</td><td class="r">${m.leave}</td></tr>`)}</tbody>
            </table>
          </div>
        </div>
      </section>`
  }

  // ---------- Password vault ----------
  const POLICY_DAYS = 90
  const genPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*?'
    const a = new Uint32Array(18); crypto.getRandomValues(a)
    return Array.from(a, (x) => chars[x % chars.length]).join('')
  }
  const strengthOf = (p) => {
    let s = 0
    if (p.length >= 12) s++
    if (p.length >= 16) s++
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++
    if (/\d/.test(p)) s++
    if (/[^A-Za-z0-9]/.test(p)) s++
    return s >= 5 ? 'Strong' : s >= 3 ? 'Fair' : 'Weak'
  }
  const vaultStatus = (v, now) => {
    if (v.expiresAt == null) return { label: 'No expiry set', tone: 'plain', days: null }
    const days = Math.ceil((v.expiresAt - now) / DAY)
    if (days <= 0) return { label: 'Expired', tone: 'crit', days }
    if (days <= v.reminderDays) return { label: `Expires in ${days}d`, tone: 'warn', days }
    return { label: 'Healthy', tone: 'good', days }
  }

  const FLOW = [
    ['plus', 'Add', 'App, username, password'],
    ['cal', 'Set expiry', '30 / 60 / 90 days or a date'],
    ['bell', 'Get reminded', 'Bell + banner at your lead time'],
    ['refresh', 'Rotate', 'Generate, update the app, confirm'],
    ['check', 'Age resets', 'New expiry, audit entry'],
  ]

  // edit: the item being edited (the original), with its form copy in "f".
  // rotate: the item being rotated, with its form in "r".
  const vaultUi = () => S.ui('p:team:vault', { edit: null, f: null, show: false, rotate: null, r: null, unlocked: false, unlock: false, shown: {}, del: null })
  const openRotate = (v) => S.set(vaultUi(), { rotate: v, r: { secret: genPassword(), cycle: 90, done: false } })
  const openEdit = (item) => S.set(vaultUi(), { edit: item, f: { ...item }, show: false })

  function vault() {
    const state = S.state
    const me = S.currentUser(state)
    const lead = state.role === 'lead'
    const u = vaultUi()
    const { edit, rotate, unlocked, unlock, shown, del } = u
    const items = state.vault.map((v) => ({ v, s: vaultStatus(v, state.now), age: Math.floor((state.now - v.changedAt) / DAY) }))
      .sort((a, b) => (a.s.days ?? 999) - (b.s.days ?? 999))
    const due = items.filter((i) => i.s.tone === 'crit' || i.s.tone === 'warn')
    return html`
      <section class="card">
        <div class="card-h"><h3>How the vault works</h3><span class="muted small">Each analyst sees only their own credentials for third-party apps.</span></div>
        <div class="card-b">
          <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));gap:8px">
            ${FLOW.map(([ic, t, s], i) => html`
              <div class="row" style="flex-wrap:nowrap;align-items:flex-start">
                <span class="qa-ic">${icon(ic, 16)}</span>
                <div class="stack" style="gap:0"><b class="small">${i + 1}. ${t}</b><span class="small muted">${s}</span></div>
              </div>`)}
          </div>
        </div>
      </section>

      ${due.length > 0 && html`
        <div class="callout ${due.some((d) => d.s.tone === 'crit') ? 'crit' : 'warn'}" style="align-items:center;flex-wrap:wrap">
          ${icon('key')}
          <span style="flex:1;min-width:200px"><b>${due.length} password${due.length > 1 ? 's' : ''} need${due.length > 1 ? '' : 's'} rotating:</b> ${due.map((d) => `${d.v.app} (${d.s.label.toLowerCase()})`).join(', ')}</span>
          <button class="btn sm" data-click="vault.rotate" data-v="${due[0].v.id}">Rotate ${due[0].v.app}</button>
        </div>`}

      <section class="card">
        <div class="card-h">
          <h3>My credentials</h3><span class="muted small">${me.name} · ${me.soeid}</span>
          <span class="spacer"></span>
          ${unlocked ? html`<span class="pill good">${icon('lock', 11)}Unlocked for this session</span>` : html`<button class="btn sm" data-click="vault.unlockOpen">${icon('lock', 14)}Unlock to reveal</button>`}
          <button class="btn primary sm" data-click="vault.add">${icon('plus', 14)}Add credential</button>
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>App</th><th>Username</th><th>Password</th><th>Password age</th><th>Expires</th><th>Reminder</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${items.map(({ v, s, age }) => html`
                <tr data-key="${v.id}">
                  <td><b>${v.app}</b><div class="small muted">Strength: ${v.strength}</div></td>
                  <td class="mono">${v.user}</td>
                  <td class="nowrap">
                    <span class="mono">${unlocked && shown[v.id] ? v.secret : '••••••••••••'}</span>
                    <button class="btn ghost sm" aria-label="Show password" data-click="vault.show" data-v="${v.id}">${icon('eye', 14)}</button>
                    <button class="btn ghost sm" aria-label="Copy password" data-click="vault.copy" data-v="${v.id}">${icon('copy', 14)}</button>
                  </td>
                  <td style="min-width:130px">
                    <div class="row tight"><b class="num">${age}d</b><span class="muted small">/ ${POLICY_DAYS}d policy</span></div>
                    <div class="meter" style="height:5px"><i style="${style({ width: `${Math.min(100, (age / POLICY_DAYS) * 100)}%`, background: age >= POLICY_DAYS ? 'var(--crit)' : age >= POLICY_DAYS * 0.8 ? 'var(--warn)' : 'var(--good)' })}"></i></div>
                  </td>
                  <td class="nowrap small">${v.expiresAt ? fmtDate(v.expiresAt) : html`<span class="muted">Not set</span>`}</td>
                  <td class="nowrap small">${v.expiresAt ? `${v.reminderDays} days before` : '—'}</td>
                  <td><span class="pill ${s.tone}">${s.label}</span></td>
                  <td class="nowrap">
                    ${del === v.id ? html`
                      <span class="row tight"><span class="small">Remove?</span><button class="btn danger sm" data-click="vault.delete" data-v="${v.id}">Remove</button><button class="btn sm" data-click="vault.del" data-v="">Keep</button></span>` : html`
                      <span class="row tight">
                        <button class="btn sm" data-click="vault.rotate" data-v="${v.id}">${icon('refresh', 13)}Rotate</button>
                        <button class="btn ghost sm" data-click="vault.edit" data-v="${v.id}">Edit</button>
                        <button class="btn ghost sm" data-click="vault.del" data-v="${v.id}" aria-label="Remove">${icon('x', 13)}</button>
                      </span>`}
                  </td>
                </tr>`)}
            </tbody>
          </table>
          ${!items.length && html`<div class="empty">Your vault is empty. Add the first third-party app credential.</div>`}
        </div>
        <div class="small muted" style="padding:12px">Prototype only: values are generated samples. In production, secrets are encrypted client-side and the server never sees them in plain text.</div>
      </section>

      ${lead && html`
        <section class="card">
          <div class="card-h"><h3>Team vault compliance</h3><span class="muted small">Counts only. Managers never see analysts' passwords.</span></div>
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Analyst</th><th class="r">Credentials</th><th class="r">Expiring soon</th><th class="r">Expired</th><th class="r">Weak</th><th></th></tr></thead>
              <tbody>${TEAM_VAULT_SUMMARY.map((t) => html`
                <tr data-key="${t.id}">
                  <td class="nowrap">${byId[t.id].name}</td><td class="r">${t.total}</td>
                  <td class="r" style="${style({ color: t.expiring ? 'var(--warn)' : undefined })}">${t.expiring}</td>
                  <td class="r" style="${style({ color: t.expired ? 'var(--crit)' : undefined })}">${t.expired}</td>
                  <td class="r">${t.weak}</td>
                  <td>${t.expired || t.expiring ? html`<button class="btn sm" data-click="vault.remind" data-v="${t.id}">Send reminder</button>` : html`<span class="pill good">Compliant</span>`}</td>
                </tr>`)}</tbody>
            </table>
          </div>
        </section>`}

      ${unlock && S.modal({
        title: "Confirm it's you",
        sub: 'Revealing or copying passwords needs a fresh sign-in check.',
        onClose: 'vault.unlockClose',
        footer: html`
          <button class="btn" data-click="vault.unlockClose">Cancel</button>
          <button class="btn primary" data-click="vault.verify">Verify</button>`,
        body: html`
          <label class="field"><span>SSO PIN or authenticator code</span><input id="vault-pin" class="in mono" inputmode="numeric" placeholder="Any 6 digits in this prototype" maxlength="6"></label>
          <div class="small muted">The vault locks again after 10 minutes or when you leave the page.</div>`,
      })}
      ${edit && vaultForm(edit, u)}
      ${rotate && rotateForm(rotate, u)}`
  }

  function vaultForm(item, u) {
    const f = u.f
    const show = u.show
    const st = strengthOf(f.secret || '')
    const expiresAt = f.expiry === 'none' ? null : f.expiry === 'date' ? (f.date ? new Date(f.date + 'T23:59').getTime() : null) : Date.now() + Number(f.expiry) * DAY
    return S.modal({
      title: item.id ? `Edit ${item.app}` : 'Add credential',
      onClose: 'vault.editClose',
      footer: html`
        <button class="btn" data-click="vault.editClose">Cancel</button>
        <button class="btn primary" ${attrs({ disabled: !f.app.trim() || !f.user.trim() || !f.secret || (f.expiry === 'date' && !f.date) })} data-click="vault.save">${item.id ? 'Save changes' : 'Add to vault'}</button>`,
      body: html`
        <div class="form-grid">
          <label class="field"><span>Third-party app</span><input id="v-app" class="in" value="${f.app}" data-input="vault.f" data-f="app" placeholder="e.g. Jira Service Management"></label>
          <label class="field"><span>Username</span><input id="v-user" class="in mono" value="${f.user}" data-input="vault.f" data-f="user"></label>
        </div>
        <label class="field"><span>Password</span>
          <div class="row" style="flex-wrap:nowrap">
            <input id="v-secret" class="in mono" style="flex:1" type="${show ? 'text' : 'password'}" value="${f.secret}" data-input="vault.f" data-f="secret">
            <button class="btn sm" type="button" data-click="vault.toggleShow">${icon('eye', 14)}</button>
            <button class="btn sm" type="button" data-click="vault.gen">${icon('refresh', 14)}Generate</button>
          </div>
          <span class="small" style="color:${st === 'Strong' ? 'var(--good)' : st === 'Fair' ? 'var(--warn)' : 'var(--crit)'}">Strength: ${st}</span>
        </label>
        <div class="form-grid">
          <label class="field"><span>Expiry</span>
            <select id="v-expiry" class="in" data-change="vault.f" data-f="expiry">
              ${opt('none', f.expiry, 'No expiry')}${opt('30', f.expiry, '30 days from today')}${opt('60', f.expiry, '60 days from today')}${opt('90', f.expiry, '90 days from today')}${opt('date', f.expiry, 'Pick a date…')}
            </select>
          </label>
          ${f.expiry === 'date' && html`<label class="field"><span>Expiry date</span><input id="v-date" type="date" class="in" value="${f.date || ''}" data-input="vault.f" data-f="date"></label>`}
          <label class="field"><span>Remind me</span>
            <select id="v-remind" class="in" ${attrs({ disabled: f.expiry === 'none' })} data-change="vault.f" data-f="reminderDays">
              ${opt('1', f.reminderDays, '1 day before')}${opt('7', f.reminderDays, '7 days before')}${opt('14', f.reminderDays, '14 days before')}${opt('30', f.reminderDays, '30 days before')}
            </select>
          </label>
        </div>
        ${expiresAt && html`<div class="callout accent small">${icon('bell', 16)}Expires ${fmtDate(expiresAt)}. You'll get a bell notification and a vault banner from ${fmtDate(expiresAt - Number(f.reminderDays) * DAY)}, repeating daily until you rotate it.</div>`}
        ${f.expiry === 'none' && html`<div class="callout warn small">${icon('alert', 16)}Without an expiry you won't get reminders. Team policy is rotation every ${POLICY_DAYS} days.</div>`}`,
    })
  }

  function rotateForm(item, u) {
    const { secret, cycle, done } = u.r
    return S.modal({
      title: `Rotate ${item.app} password`,
      sub: `Current password is ${Math.floor((Date.now() - item.changedAt) / DAY)} days old`,
      onClose: 'vault.rotateClose',
      footer: html`
        <button class="btn" data-click="vault.rotateClose">Cancel</button>
        <button class="btn primary" ${attrs({ disabled: !done })} data-click="vault.rotateSave">Save new password</button>`,
      body: html`
        <div class="stack">
          <span class="section-title">1. New password</span>
          <div class="row" style="flex-wrap:nowrap">
            <input id="rot-secret" class="in mono" style="flex:1" value="${secret}" data-input="vault.r">
            <button class="btn sm" data-click="vault.regen">${icon('refresh', 14)}Regenerate</button>
            <button class="btn sm" data-click="vault.rotCopy">${icon('copy', 14)}Copy</button>
          </div>
          <span class="small muted">Strength: ${strengthOf(secret)}</span>
        </div>
        <div class="stack">
          <span class="section-title">2. Change it in ${item.app}</span>
          <label class="check small"><input id="rot-done" type="checkbox" ${attrs({ checked: done })} data-change="vault.rotDone">I've updated the password in ${item.app} and signed in successfully</label>
        </div>
        <div class="stack">
          <span class="section-title">3. Next expiry</span>
          ${seg([{ id: 30, label: '30 days' }, { id: 60, label: '60 days' }, { id: 90, label: '90 days' }], cycle, 'vault.cycle')}
          ${item.expiresAt == null && html`<span class="small muted">This credential has no expiry, so the cycle is ignored. Edit it to add one.</span>`}
        </div>`,
    })
  }

  // ---------- Handlers ----------
  const vaultItem = (id) => S.state.vault.find((v) => v.id === id)
  S.on({
    'team.tab': (el) => {
      const u = S.ui('p:team')
      if (u.tab === el.dataset.v) return
      S.resetUi('p:team:')
      S.resetUi('p:cal')
      S.set(u, { tab: el.dataset.v })
    },
    // Roster
    'team.addOpen': () => S.set(rosterUi(), { adding: true }),
    'team.addClose': () => S.set(rosterUi(), { adding: false }),
    'team.m': (el) => {
      const r = rosterUi()
      const v = el.dataset.f === 'soeid' ? el.value.toUpperCase() : el.value
      // Re-render: the Add button's disabled state (and the upper-cased SOEID) depend on it.
      S.set(r, { m: { ...r.m, [el.dataset.f]: v } })
    },
    'team.addSave': () => {
      const r = rosterUi()
      S.dispatch({ type: 'addMember', member: r.m })
      S.set(r, { adding: false })
    },
    // Schedule
    'team.leave': (el) => {
      const s = schedUi()
      S.set(s, { leaves: s.leaves.map((x) => (x.id === el.dataset.v ? { ...x, status: el.dataset.status } : x)) })
    },
    // Vault
    'vault.rotate': (el) => openRotate(vaultItem(el.dataset.v)),
    'vault.unlockOpen': () => S.set(vaultUi(), { unlock: true }),
    'vault.unlockClose': () => S.set(vaultUi(), { unlock: false }),
    'vault.verify': () => S.set(vaultUi(), { unlocked: true, unlock: false }),
    'vault.add': () => {
      const me = S.currentUser(S.state)
      openEdit({ id: null, app: '', user: me.soeid.toLowerCase(), secret: genPassword(), expiry: '90', reminderDays: 7 })
    },
    'vault.show': (el) => {
      const u = vaultUi()
      if (u.unlocked) S.set(u, { shown: { ...u.shown, [el.dataset.v]: !u.shown[el.dataset.v] } })
      else S.set(u, { unlock: true })
    },
    'vault.copy': (el) => {
      const u = vaultUi()
      if (u.unlocked) S.copyText(vaultItem(el.dataset.v).secret)
      else S.set(u, { unlock: true })
    },
    'vault.edit': (el) => {
      const v = vaultItem(el.dataset.v)
      openEdit({ ...v, expiry: v.expiresAt ? 'date' : 'none', date: v.expiresAt ? new Date(v.expiresAt).toISOString().slice(0, 10) : '' })
    },
    'vault.del': (el) => S.set(vaultUi(), { del: el.dataset.v || null }),
    'vault.delete': (el) => {
      S.dispatch({ type: 'vaultDelete', id: el.dataset.v })
      S.set(vaultUi(), { del: null })
    },
    'vault.remind': (el) => S.dispatch({ type: 'toast', text: `Reminder sent to ${byId[el.dataset.v].name}` }),
    // Add / edit form
    'vault.editClose': () => S.set(vaultUi(), { edit: null, f: null }),
    'vault.f': (el) => { const u = vaultUi(); S.set(u, { f: { ...u.f, [el.dataset.f]: el.value } }) },
    'vault.toggleShow': () => { const u = vaultUi(); S.set(u, { show: !u.show }) },
    'vault.gen': () => { const u = vaultUi(); S.set(u, { f: { ...u.f, secret: genPassword() } }) },
    'vault.save': () => {
      const u = vaultUi()
      const item = u.edit, f = u.f
      const st = strengthOf(f.secret || '')
      const expiresAt = f.expiry === 'none' ? null : f.expiry === 'date' ? (f.date ? new Date(f.date + 'T23:59').getTime() : null) : Date.now() + Number(f.expiry) * DAY
      S.dispatch({ type: 'vaultSave', item: { id: f.id || Math.random().toString(36).slice(2, 9), app: f.app.trim(), user: f.user.trim(), secret: f.secret, changedAt: item.id && item.secret === f.secret ? item.changedAt : Date.now(), expiresAt, reminderDays: Number(f.reminderDays), strength: st } })
      S.set(u, { edit: null, f: null })
    },
    // Rotate form
    'vault.rotateClose': () => S.set(vaultUi(), { rotate: null, r: null }),
    'vault.r': (el) => { const u = vaultUi(); S.set(u, { r: { ...u.r, secret: el.value } }) },
    'vault.regen': () => { const u = vaultUi(); S.set(u, { r: { ...u.r, secret: genPassword() } }) },
    'vault.rotCopy': () => S.copyText(vaultUi().r.secret),
    'vault.rotDone': (el) => { const u = vaultUi(); S.set(u, { r: { ...u.r, done: el.checked } }) },
    'vault.cycle': (el) => { const u = vaultUi(); S.set(u, { r: { ...u.r, cycle: Number(el.dataset.v) } }) },
    'vault.rotateSave': () => {
      const u = vaultUi()
      S.dispatch({ type: 'vaultRotate', id: u.rotate.id, secret: u.r.secret, cycleDays: u.r.cycle })
      S.set(u, { rotate: null, r: null })
    },
  })

  S.ACCESS = ACCESS
})()
