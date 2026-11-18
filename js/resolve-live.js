// Resolution journey on real tickets: the five-step form from the prototype (workspace.js),
// working on the ServiceNow export instead of sample tickets.
//
// Resolving a ticket in the live drawer opens this instead of tagging it straight away.
// It ends with a resolution code CAUSE-SUB-NN and saves it in the same event as the
// Resolved tag (ticketTag + res), so the tag and the code can't drift apart.
// Scope doesn't write to ServiceNow (D6): the analyst copies the code and notes across.
//
// The code library is built only from real resolutions in the ops log (queue.js fold),
// so it starts empty and grows. The root-cause categories, breach reasons and the
// "Close" fields are the prototype's (data.js): placeholders until the team agrees its own.
;(function () {
  const { html, cls, attrs, icon, ROOT_CAUSES, BREACH_REASONS } = S
  const qm = S.qm
  const Q = () => S.queue
  const STEPS = [
    { label: 'Detection', hint: 'What was reported' },
    { label: 'Diagnosis', hint: 'Root cause' },
    { label: 'Fix applied', hint: 'What you changed' },
    { label: 'Validation', hint: 'User confirmed' },
    { label: 'Close', hint: 'Code & copy' },
  ]
  const options = (items, cur) => items.map(([v, l]) => html`<option value="${v}" ${attrs({ selected: String(v) === String(cur) })}>${l}</option>`)
  const words = (s) => new Set(String(s || '').toLowerCase().match(/[a-z0-9]{4,}/g) || [])
  const ui = () => S.ui('lres', { n: null, step: 0, f: null })
  const ticket = () => { const n = ui().n; return n && Q().view().tickets.find((t) => t.n === n) }

  // Resolution Assist, rules only: resolved tickets whose short description shares words
  // with this one vote for their code.
  function suggest(t, v) {
    const mine = words(t.short)
    if (!mine.size) return null
    const votes = new Map()
    let sample = 0
    for (const x of v.tickets) {
      if (!x.res || x.n === t.n) continue
      const w = words(x.short)
      const both = [...mine].filter((k) => w.has(k)).length
      const sim = both / (mine.size + w.size - both || 1)
      if (sim < 0.25) continue
      sample++
      votes.set(x.res.code, (votes.get(x.res.code) || 0) + sim)
    }
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
    const c = top && v.codes.find((k) => k.code === top[0])
    return c ? { code: c, sample } : null
  }

  function start(n) {
    const t = Q().view().tickets.find((x) => x.n === n)
    if (!t) return
    const sg = suggest(t, Q().view())
    const cause = sg ? sg.code.cause : Object.keys(ROOT_CAUSES)[0]
    S.set(ui(), {
      n, step: 0,
      f: {
        symptom: t.short || '', impact: 'Single user',
        cause, sub: sg ? sg.code.sub : Object.keys(ROOT_CAUSES[cause].subs)[0], diagNote: '',
        pick: sg ? sg.code.code : '', fix: '', runbook: '',
        validated: true, validNote: '', fcr: false, transfers: 0, escalatedTo: '', breachCode: '', closeNote: '',
      },
    })
  }

  function derive(t, f, v) {
    const prefix = `${f.cause}-${f.sub}-`
    const same = v.codes.filter((c) => c.code.startsWith(prefix))
    const picked = f.pick && same.find((c) => c.code === f.pick)
    const next = String(Math.max(0, ...same.map((c) => Number(c.code.slice(prefix.length)) || 0)) + 1).padStart(2, '0')
    const code = picked ? { ...picked, isNew: false } : { code: prefix + next, cause: f.cause, sub: f.sub, title: f.fix.trim(), runbook: f.runbook.trim(), isNew: true }
    const breached = t.inLatest && Q().health(t, v.settings).slaBreached
    const escalated = Number(f.transfers) > 0
    const category = `${ROOT_CAUSES[f.cause].label} › ${ROOT_CAUSES[f.cause].subs[f.sub]}`
    const valid = [!!f.symptom.trim(), !!(f.cause && f.sub), picked ? true : !!f.fix.trim(), f.validated || !!f.validNote.trim(), (!breached || !!f.breachCode) && (!escalated || !!f.escalatedTo.trim())]
    return { same, code, breached, escalated, category, valid, canFinish: valid.every(Boolean) }
  }

  // What the analyst pastes into ServiceNow's resolution fields.
  function snText(t, r) {
    return [
      `Resolution code: ${r.code} – ${r.title}`,
      `Root cause: ${r.category}`,
      r.symptom && `Symptom: ${r.symptom}${r.impact ? ` (impact: ${r.impact})` : ''}`,
      r.diagNote && `Diagnosis: ${r.diagNote}`,
      `Fix: ${r.fix || r.title}${r.runbook ? ` (runbook: ${r.runbook})` : ''}`,
      `Validated: ${r.validated ? 'yes' : 'no'}${r.validNote ? ` – ${r.validNote}` : ''}`,
      r.transfers > 0 && `Transfers: ${r.transfers}${r.escalatedTo ? `, escalated to ${r.escalatedTo}` : ''}`,
      r.breachCode && `SLA breach reason: ${r.breachCode} ${BREACH_REASONS[r.breachCode] || ''}`,
      r.closeNote && `Close notes: ${r.closeNote}`,
    ].filter(Boolean).join('\n')
  }
  const copy = (text, ok) => (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => S.dispatch({ type: 'toast', text: ok }), () => S.dispatch({ type: 'toast', text: "Couldn't copy; open the ticket and select the text instead" }))

  function modal() {
    const u = ui()
    const t = ticket()
    if (!t || !u.f) return ''
    const v = Q().view()
    const { step, f } = u
    const { same, code, breached, escalated, category, valid, canFinish } = derive(t, f, v)
    const sg = suggest(t, v)
    const k = (name) => html`data-k="${name}"`
    const owner = Q().owner(t)
    const footer = html`
      <span class="muted small" style="margin-right:auto;align-self:center">The code goes into Scope's library; copy it into ServiceNow when you resolve the ticket there.</span>
      <button class="btn" data-click="lres.close">Cancel</button>
      ${step > 0 && html`<button class="btn" data-click="lres.go" data-v="${step - 1}">Back</button>`}
      ${step < STEPS.length - 1
        ? html`<button class="btn primary" ${attrs({ disabled: !valid[step] })} data-click="lres.go" data-v="${step + 1}">Next: ${STEPS[step + 1].label}</button>`
        : html`<button class="btn primary" ${attrs({ disabled: !canFinish })} data-click="lres.finish">${icon('check', 16)}Resolve with ${code.code}</button>`}`
    const body = html`
      <div class="stepper">${STEPS.map((s, i) => html`<button class="${i < step ? 'done' : i === step ? 'cur' : ''}" data-click="lres.go" data-v="${i}" ${attrs({ disabled: i > step && !valid.slice(0, i).every(Boolean) })}><b>${i + 1}. ${s.label}</b>${s.hint}</button>`)}</div>
      <div class="rj-context">
        <span><span class="eyebrow">Owner</span>${owner ? Q().nameOf(owner) : 'Unassigned'}</span>
        <span><span class="eyebrow">Priority</span>${t.priority || '—'}</span>
        <span><span class="eyebrow">Problem category</span>${category}</span>
        <span><span class="eyebrow">Health</span>${breached ? html`<span class="pill crit">Past SLA</span>` : html`<span class="pill good">Within SLA</span>`}</span>
      </div>
      ${step === 0 && html`<div class="stack lg">
        <label class="field"><span>Symptom as reported and verified</span><textarea class="in" data-input="lres.f" ${k('symptom')}>${f.symptom}</textarea></label>
        <label class="field" style="max-width:280px"><span>Business impact</span><select class="in" data-change="lres.f" ${k('impact')}>${options(['Single user', 'Team', 'Site', 'Enterprise-wide'].map((x) => [x, x]), f.impact)}</select></label>
        <div class="small muted">${t.group} · ServiceNow state ${t.state} · opened ${new Date(t.opened).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>
      </div>`}
      ${step === 1 && html`<div class="stack lg">
        <div class="form-grid">
          <label class="field"><span>Root cause category</span><select class="in" data-change="lres.cause">${options(Object.entries(ROOT_CAUSES).map(([c, x]) => [c, x.label]), f.cause)}</select></label>
          <label class="field"><span>Subcategory</span><select class="in" data-change="lres.sub">${options(Object.entries(ROOT_CAUSES[f.cause].subs), f.sub)}</select></label>
        </div>
        <label class="field"><span>Diagnosis note <span class="hint">(optional)</span></span><textarea class="in" data-input="lres.f" ${k('diagNote')} placeholder="What you checked, what ruled other causes out">${f.diagNote}</textarea></label>
        ${sg ? html`<div class="callout accent small">${icon('spark', 16)}<span>Resolution Assist: <b>${sg.code.code}</b> (${sg.code.title}) was used on ${sg.sample} similar ticket${sg.sample > 1 ? 's' : ''}.</span></div>`
          : html`<div class="muted small">${v.codes.length ? 'No similar resolved tickets yet.' : 'No resolution codes yet: the library grows from the team\'s own resolutions.'}</div>`}
      </div>`}
      ${step === 2 && html`<div class="stack lg">
        ${same.length > 0 && html`<label class="field"><span>Resolution code</span><select class="in" data-change="lres.f" ${k('pick')}>
          ${options([['', `New code (${code.isNew ? code.code : `${f.cause}-${f.sub}-…`})`], ...same.map((c) => [c.code, `${c.code} · ${c.title} (used ${c.uses}×)`])], f.pick)}</select></label>`}
        ${code.isNew ? html`
          <label class="field"><span>Fix applied <span class="hint">(becomes the code's title)</span></span><textarea class="in" data-input="lres.f" ${k('fix')} placeholder="e.g. Reset the user's VPN profile and reissued the certificate">${f.fix}</textarea></label>
          <label class="field" style="max-width:360px"><span>Runbook or KB followed <span class="hint">(optional)</span></span><input class="in" value="${f.runbook}" data-input="lres.f" ${k('runbook')}></label>`
          : html`<div class="callout good small">${icon('check', 16)}<span><b>${code.code}</b> · ${code.title}${code.runbook && html` · runbook ${code.runbook}`}</span></div>
          <label class="field"><span>What you did on this ticket <span class="hint">(optional)</span></span><textarea class="in" data-input="lres.f" ${k('fix')}>${f.fix}</textarea></label>`}
      </div>`}
      ${step === 3 && html`<div class="stack lg">
        <label class="check"><input type="checkbox" ${attrs({ checked: f.validated })} data-change="lres.f" ${k('validated')}>The user confirmed the service is restored</label>
        <label class="field"><span>${f.validated ? 'Validation note (optional)' : 'Why was it not confirmed? (required)'}</span><textarea class="in" data-input="lres.f" ${k('validNote')}>${f.validNote}</textarea></label>
      </div>`}
      ${step === 4 && html`<div class="stack lg">
        <div class="form-grid">
          <label class="field"><span>First contact resolution</span><select class="in" data-change="lres.f" ${k('fcr')}>${options([['true', 'Yes'], ['false', 'No']], String(f.fcr))}</select></label>
          <label class="field"><span>Transfers before reaching you</span><input type="number" min="0" max="9" class="in" value="${f.transfers}" data-input="lres.f" ${k('transfers')}></label>
          <label class="field"><span>Escalated to <span class="hint">${escalated ? '(required: it was transferred)' : '(only when transferred)'}</span></span><input class="in" value="${f.escalatedTo}" data-input="lres.f" ${k('escalatedTo')} ${attrs({ disabled: !escalated })} placeholder="Resolver group"></label>
          <label class="field"><span>SLA breach reason <span class="hint">${breached ? '(required: past SLA)' : '(only when past SLA)'}</span></span><select class="in" data-change="lres.f" ${k('breachCode')} ${attrs({ disabled: !breached })}>
            ${options([['', breached ? 'Why did it miss the SLA?' : 'Not needed'], ...Object.entries(BREACH_REASONS).map(([c, l]) => [c, `${c} · ${l}`])], breached ? f.breachCode : '')}</select></label>
        </div>
        <label class="field"><span>Close notes <span class="hint">(optional)</span></span><textarea class="in" data-input="lres.f" ${k('closeNote')}>${f.closeNote}</textarea></label>
        <div class="callout good" style="align-items:center">${icon('check')}
          <div class="stack" style="gap:2px;flex:1">
            <div class="row"><span class="eyebrow">Resolution code</span><span class="code-chip" style="font-size:14px">${code.code}</span>${code.isNew && html`<span class="pill warn">New code</span>`}</div>
            <span class="small">${category} — ${code.title || html`<span class="muted">add the fix on step 3</span>`}</span>
          </div>
        </div>
      </div>`}`
    return S.modal({ title: 'Resolution journey', sub: `${t.n} · ${t.short}`, onClose: 'lres.close', wide: true, footer, body })
  }

  async function finish() {
    const u = ui()
    const t = ticket()
    if (!t) return
    const v = Q().view()
    const f = u.f
    const d = derive(t, f, v)
    if (!d.canFinish) return
    const res = {
      code: d.code.code, cause: f.cause, sub: f.sub, title: d.code.title, runbook: d.code.runbook || '', isNew: d.code.isNew, category: d.category,
      symptom: f.symptom.trim(), impact: f.impact, diagNote: f.diagNote.trim(), fix: f.fix.trim(),
      validated: !!f.validated, validNote: f.validNote.trim(), fcr: !!f.fcr, transfers: Number(f.transfers) || 0,
      escalatedTo: d.escalated ? f.escalatedTo.trim() : '', breachCode: d.breached ? f.breachCode : '', closeNote: f.closeNote.trim(),
    }
    if (!(await qm.send({ type: 'ticketTag', n: t.n, tag: 'Resolved', res }))) return
    S.set(u, { n: null, f: null, step: 0 })
    copy(snText(t, res), `${t.n} resolved with ${res.code}. Notes copied for ServiceNow`)
  }

  S.liveResolve = { modal, start, snText }
  S.on({
    'lres.open': (el) => start(el.dataset.v),
    'lres.close': () => S.set(ui(), { n: null, f: null, step: 0 }),
    'lres.go': (el) => S.set(ui(), { step: Number(el.dataset.v) }),
    'lres.f': (el) => {
      const u = ui()
      const val = el.type === 'checkbox' ? el.checked : el.dataset.k === 'fcr' ? el.value === 'true' : el.value
      u.f = { ...u.f, [el.dataset.k]: val }
      S.render()
    },
    'lres.cause': (el) => { const u = ui(); S.set(u, { f: { ...u.f, cause: el.value, sub: Object.keys(ROOT_CAUSES[el.value].subs)[0], pick: '' } }) },
    'lres.sub': (el) => { const u = ui(); S.set(u, { f: { ...u.f, sub: el.value, pick: '' } }) },
    'lres.finish': () => finish(),
    'lres.copy': (el) => { const t = Q().view().tickets.find((x) => x.n === el.dataset.v); if (t && t.res) copy(snText(t, t.res), 'Resolution copied for ServiceNow') },
  })
})()
