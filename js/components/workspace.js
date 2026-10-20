// Ticket workspace pieces, ported from src/components/Workspace.jsx:
// Resolution Assist, the ticket workspace (steps, contact log, assist) and the
// resolution journey modal.
//
// Callbacks that were props are action names here. The caller's onResolve
// action gets the ticket id in el.dataset.v; onClose is called with no data.
;(function () {
  const { html, attrs, icon, prio, slaPill } = S
  const { BREACH_REASONS, ESCALATION_TARGETS, HOUR, PRIORITIES, ROOT_CAUSES, computeAssist, deflection, initials, byId, codeInfo, fmtDateTime, fmtDur, fmtH, fmtTime, slaInfo } = S

  // <option> list for a select. items: strings, or [value, label] pairs.
  const options = (items, cur) => items.map((x) => {
    const [v, l] = Array.isArray(x) ? x : [x, x]
    return html`<option value="${v}" ${attrs({ selected: v === cur })}>${l}</option>`
  })
  const STATES = ['New', 'In Progress', 'Awaiting Customer', 'On Hold', 'Resolved']

  // ---------- Resolution Assist ----------
  // Deterministic: keyword overlap against resolved history picks similar
  // incidents; the resolution codes they used vote for the likely fix.
  // (Was the useAssist hook; it's a plain function of the current state.)
  function assist(desc, hintCode, excludeId) {
    const st = S.state
    return computeAssist(st.history, st.codes, desc, hintCode, excludeId)
  }

  function resolutionAssist(ticket, { compact } = {}) {
    const state = S.state
    const a = assist(ticket.desc, ticket.hintCode, ticket.id)
    const pending = state.approvals.find((x) => x.ticket === ticket.id)
    if (!a.top) return html`<div class="callout">No similar resolved incidents yet. Use the runbook library in Ticket Explorer.</div>`
    const info = a.top.info
    const fixArg = JSON.stringify({ ticket: ticket.id, code: info.code, fix: info.fix })
    return html`<div class="stack lg">
      <div class="row">
        <span class="pill accent plain">${icon('spark', 12)}Resolution Assist</span>
        <span class="muted small">Rules-based match on ${a.sample} similar resolved incidents. No AI, runs in your browser.</span>
      </div>
      <div class="callout accent" style="flex-direction:column;gap:6px">
        <div class="row"><span class="eyebrow">Likely fix</span><span class="code-chip">${info.code}</span><span class="muted small">${Math.round(a.top.conf * 100)}% of matches</span></div>
        <b>${info.title}</b>
        <div class="small ink2">Typical resolution ${fmtH(a.typicalRes)} · first-contact resolution ${a.fcrRate == null ? '—' : Math.round(a.fcrRate * 100) + '%'}</div>
      </div>
      <div class="stack">
        <div class="section-title">Suggested next actions</div>
        <ol style="margin:0;padding-left:18px" class="stack small">
          <li>Confirm scope: is anyone else on <b>${ticket.businessApp}</b> affected? Check for a parent major incident.</li>
          <li>Follow <b>${info.runbook}</b> for ${ROOT_CAUSES[info.cause].subs[info.sub].toLowerCase()}.</li>
          <li>${info.title}.</li>
          <li>Ask ${ticket.caller} to confirm service is restored, then log the contact.</li>
        </ol>
      </div>
      ${!compact && a.ranked.length > 1 && html`
        <div class="stack">
          <div class="section-title">Other candidate codes</div>
          ${a.ranked.slice(1).map((r) => html`
            <div class="row small" data-key="${r.code}"><span class="code-chip">${r.code}</span><span class="ink2">${r.info.title}</span><span class="spacer"></span><span class="muted">${Math.round(r.conf * 100)}%</span></div>`)}
        </div>`}
      <div class="stack">
        <div class="section-title">Similar incidents</div>
        ${a.similar.slice(0, compact ? 3 : 5).map((h) => html`
          <div class="list-row small" data-key="${h.id}">
            <span class="mono">${h.id}</span>
            <span class="ink2" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.desc}</span>
            <span class="code-chip">${h.code}</span>
            <span class="num muted">${fmtH(h.resH)}</span>
          </div>`)}
      </div>
      <div class="stack">
        <div class="section-title">Runbooks</div>
        <div class="row">
          <span class="pill plain">${icon('book', 12)}${info.runbook}</span>
          ${a.ranked.slice(1).map((r) => html`<span class="pill plain" data-key="${r.code}">${icon('book', 12)}${r.info.runbook}</span>`)}
        </div>
      </div>
      ${info.automatable && html`
        <div class="callout" style="align-items:center;flex-wrap:wrap">
          ${icon('bolt')}
          <div class="stack" style="gap:2px;flex:1;min-width:180px">
            <b>Automated fix available</b>
            <span class="small ink2">${info.fix}. Runs only after a team lead approves it.</span>
          </div>
          ${pending
            ? html`<span class="pill ${pending.status === 'Approved' ? 'good' : pending.status === 'Rejected' ? 'crit' : 'warn'}">${pending.id} · ${pending.status}</span>`
            : state.role === 'lead'
              ? html`<button class="btn primary sm" data-click="ws.requestFix" data-arg="${fixArg}">Propose fix</button>`
              : html`<button class="btn primary sm" data-click="ws.requestFix" data-arg="${fixArg}">Request approval</button>`}
        </div>`}
    </div>`
  }

  // ---------- Ticket workspace (resolution steps, contact log, assist) ----------
  // onResolve: action name, called with the ticket id in el.dataset.v.
  function ticketWorkspace(ticket, { onResolve } = {}) {
    const state = S.state
    // Contact form state, one per ticket (a fresh form like a new mount).
    const entry = S.ui('p:ws:entry:' + ticket.id, { channel: 'Phone', note: '' })
    const sla = slaInfo(ticket, state.now)
    const done = ticket.steps.filter((s) => s.done).length
    const canCopilot = S.canUseCopilot ? S.canUseCopilot(state) : state.role === 'lead' || state.copilot.config.access.analysts
    return html`<div class="stack lg">
      <div class="stack" style="gap:6px">
        <div class="row"><span class="mono">${ticket.id}</span>${prio(ticket.priority)}${slaPill(sla.status)}<span class="pill plain">${ticket.state}</span></div>
        <h3 style="font:600 17px/1.3 var(--f-cond)">${ticket.desc}</h3>
        <div class="small ink2">${ticket.businessApp} · ${ticket.productGroup} · via ${ticket.channel} · caller ${ticket.caller}</div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));gap:10px">
        ${[
          ['SLA remaining', sla.remaining > 0 ? fmtDur(sla.remaining) : `Over by ${fmtDur(-sla.remaining)}`],
          ['Total age', fmtDur(state.now - ticket.openedAt)],
          ['In queue', fmtDur(state.now - ticket.queuedAt)],
          ['Assigned to', ticket.assignedTo ? byId[ticket.assignedTo].name : 'Unassigned'],
        ].map(([k, v]) => html`<div class="stack" style="gap:2px"><span class="eyebrow">${k}</span><b class="num">${v}</b></div>`)}
      </div>
      ${ticket.assignReason && html`<div class="small muted">Auto-assigned ${ticket.assignedAt ? fmtTime(ticket.assignedAt) : ''} · ${ticket.assignReason}</div>`}

      <div class="stack">
        <div class="row"><div class="section-title">Resolution steps</div><span class="muted small">${done}/${ticket.steps.length} done</span></div>
        <div class="meter"><i style="width:${(done / ticket.steps.length) * 100}%;background:var(--good)"></i></div>
        ${ticket.steps.map((s, i) => html`
          <label class="check small"><input type="checkbox" ${attrs({ checked: s.done })} data-change="ws.step" data-v="${ticket.id}" data-i="${i}">${s.label}</label>`)}
      </div>

      <div class="stack">
        <div class="section-title">Customer contact log</div>
        ${ticket.contacts.length === 0 && html`<div class="muted small">No contact logged yet. QA scoring expects at least one.</div>`}
        ${ticket.contacts.map((c) => html`
          <div class="list-row small" style="align-items:flex-start">
            <span class="pill plain">${icon('phone', 11)}${c.channel}</span>
            <span style="flex:1">${c.note}</span>
            <span class="muted nowrap">${fmtDateTime(c.at)}</span>
          </div>`)}
        <form class="row" data-submit="ws.contact" data-v="${ticket.id}">
          <select id="ch-${ticket.id}" class="in sm" aria-label="Contact channel" data-change="ws.entry" data-k="channel" data-v="${ticket.id}">
            ${options(['Phone', 'Chat', 'Email', 'Teams call'], entry.channel)}
          </select>
          <input id="note-${ticket.id}" class="in" style="flex:1;min-width:160px" placeholder="What did you tell the customer?" value="${entry.note}" data-input="ws.entry" data-k="note" data-v="${ticket.id}">
          <button class="btn sm" type="submit">Log contact</button>
        </form>
      </div>

      ${canCopilot && html`
        <div class="callout accent" style="align-items:center;flex-wrap:wrap">
          ${icon('spark')}
          <div class="stack" style="gap:2px;flex:1;min-width:180px">
            <b>Work this ticket with Copilot</b>
            <span class="small ink2">Steps from the published runbook, escalation contacts, similar incidents and a customer update draft.</span>
          </div>
          <button class="btn primary sm" data-click="ws.copilot" data-v="${ticket.id}">Ask Copilot</button>
        </div>`}
      <hr class="sep">
      ${resolutionAssist(ticket, { compact: true })}
      <hr class="sep">
      <div class="row">
        <select class="in" aria-label="Ticket state" data-change="ws.state" data-v="${ticket.id}" ${attrs({ 'data-onresolve': onResolve })}>
          ${options(STATES, ticket.state)}
        </select>
        <span class="spacer"></span>
        <button class="btn primary" ${attrs({ 'data-click': onResolve })} data-v="${ticket.id}">${icon('check', 16)}Document & resolve</button>
      </div>
    </div>`
  }

  // ---------- Resolution journey modal ----------
  const STEPS = [
    { id: 'detect', label: 'Detection', hint: 'What was reported' },
    { id: 'diag', label: 'Diagnosis', hint: 'Root cause' },
    { id: 'fix', label: 'Fix applied', hint: 'What you changed' },
    { id: 'valid', label: 'Validation', hint: 'Customer confirmed' },
    { id: 'close', label: 'Close', hint: 'Contact & code' },
  ]

  // The open modal's ticket and the caller's onClose action (set while rendering).
  let rj = { ticket: null, onClose: null }
  const rjKey = (ticket) => 'p:rj:' + ticket.id
  const rjState = (ticket) => S.ui(rjKey(ticket), () => {
    const a = assist(ticket.desc, ticket.hintCode, ticket.id)
    const guess = (a.top && a.top.info) || codeInfo(ticket.hintCode)
    return {
      step: 0,
      f: {
        symptom: ticket.desc,
        impact: 'Single user',
        cause: guess.cause,
        sub: guess.sub,
        diagNote: '',
        fix: guess.title,
        runbook: guess.runbook,
        newFix: false,
        validated: true,
        validNote: `${ticket.caller} confirmed service restored.`,
        fcr: ticket.channel === 'Phone' || ticket.channel === 'Chat',
        transfers: 0,
        escalatedTo: '',
        breachCode: '',
        deflectFlag: null,
        closeNote: '',
      },
    }
  })

  // Everything the modal derives from the form (was useMemo + inline consts).
  function derive(ticket, f) {
    const prefix = `${f.cause}-${f.sub}-`
    const same = S.state.codes.filter((c) => c.code.startsWith(prefix))
    let code
    if (same.length && !f.newFix) {
      const exact = same.find((c) => c.title === f.fix) || same[0]
      code = { ...exact, isNew: false }
    } else {
      const seq = String(same.length + 1).padStart(2, '0')
      code = { code: prefix + seq, cause: f.cause, sub: f.sub, title: f.fix, runbook: f.runbook || 'Runbook pending', automatable: false, isNew: true }
    }
    const breached = slaInfo(ticket, Date.now()).status === 'Breached'
    const escalated = Number(f.transfers) > 0
    const solver = byId[ticket.assignedTo]
    const category = `${ROOT_CAUSES[f.cause].label} › ${ROOT_CAUSES[f.cause].subs[f.sub]}`
    const ageH = (Date.now() - ticket.openedAt) / HOUR
    const overH = Math.max(0, ageH - PRIORITIES[ticket.priority].slaH)
    const resNowH = (Date.now() - (ticket.assignedAt || ticket.queuedAt)) / HOUR
    // Deflection: the rule suggests, the analyst confirms (null = follow the rule).
    const autoDeflect = deflection({ priority: ticket.priority, resH: resNowH, code: `${f.cause}-${f.sub}-01` })
    const isDeflect = f.deflectFlag === null ? !!autoDeflect : f.deflectFlag
    const deflectReason = isDeflect ? autoDeflect || 'Flagged by the resolving analyst' : null
    const valid = [f.symptom.trim(), f.cause && f.sub, f.fix.trim(), !f.validated ? f.validNote.trim() : true, (!breached || f.breachCode) && (!escalated || f.escalatedTo)]
    const canFinish = valid.every(Boolean)
    return { code, breached, escalated, solver, category, overH, autoDeflect, isDeflect, deflectReason, valid, canFinish }
  }

  function finish() {
    const ticket = rj.ticket
    const f = rjState(ticket).f
    const { code, category, breached, escalated } = derive(ticket, f)
    const start = ticket.assignedAt || ticket.queuedAt
    const now = Date.now()
    const span = Math.max(now - start, 10 * 60e3)
    const journey = [
      { stage: 'Detection', at: ticket.openedAt, note: `${f.symptom} Impact: ${f.impact}.` },
      { stage: 'Queued', at: ticket.queuedAt, note: `Auto-assigned to ${byId[ticket.assignedTo]?.name || 'analyst'}. ${ticket.assignReason}` },
      ...(Number(f.transfers) > 0 ? [{ stage: 'Transfer', at: start + span * 0.15, note: `Transferred ${f.transfers}× before resolution.` }] : []),
      { stage: 'Diagnosis', at: start + span * 0.4, note: `${ROOT_CAUSES[f.cause].label}: ${ROOT_CAUSES[f.cause].subs[f.sub]}. ${f.diagNote}`.trim() },
      { stage: 'Fix applied', at: start + span * 0.85, note: `${f.fix} (${f.runbook || 'no runbook'}).` },
      { stage: 'Validated', at: now, note: f.validated ? f.validNote : `Not confirmed by customer: ${f.validNote}` },
    ]
    S.dispatch({ type: 'resolve', id: ticket.id, code: { code: code.code, cause: code.cause, sub: code.sub, title: code.title, runbook: code.runbook, automatable: code.automatable }, journey, fcr: f.fcr, transfers: Number(f.transfers), validated: f.validated,
      diagNote: `${category}. ${f.diagNote}`.trim(),
      fixNote: `${f.fix} (${f.runbook || 'no runbook'}).`,
      breachCode: breached ? f.breachCode : null, escalatedTo: escalated ? f.escalatedTo : null, deflectFlag: f.deflectFlag })
    close()
  }

  // Closing forgets the form (React unmounted it) and tells the caller.
  function close(el, ev) {
    const onClose = rj.onClose
    if (rj.ticket) S.resetUi(rjKey(rj.ticket))
    rj = { ticket: null, onClose: null }
    if (onClose) S.call(onClose, el, ev)
    S.render()
  }

  // onClose: action name, called when the modal closes (cancel, Escape, scrim or resolved).
  function resolveModal(ticket, { onClose } = {}) {
    rj = { ticket, onClose }
    const u = rjState(ticket)
    const { step, f } = u
    const a = assist(ticket.desc, ticket.hintCode, ticket.id)
    const { code, breached, escalated, solver, category, overH, autoDeflect, isDeflect, deflectReason, valid, canFinish } = derive(ticket, f)
    // Text and select fields: data-k names the field in the form.
    const field = (k) => html`data-k="${k}"`

    const footer = html`
      <span class="muted small" style="margin-right:auto;align-self:center">Every resolved ticket gets a resolution code. It feeds Ticket Explorer, QA scoring and Resolution Assist.</span>
      <button class="btn" data-click="ws.rjClose">Cancel</button>
      ${step > 0 && html`<button class="btn" data-click="ws.rjGo" data-v="${step - 1}">Back</button>`}
      ${step < STEPS.length - 1
        ? html`<button class="btn primary" ${attrs({ disabled: !valid[step] })} data-click="ws.rjGo" data-v="${step + 1}">Next: ${STEPS[step + 1].label}</button>`
        : html`<button class="btn primary" ${attrs({ disabled: !canFinish })} data-click="ws.rjFinish">${icon('check', 16)}Resolve with ${code.code}</button>`}`

    const body = html`
      <div class="stepper">
        ${STEPS.map((s, i) => html`
          <button class="${i < step ? 'done' : i === step ? 'cur' : ''}" data-click="ws.rjStep" data-v="${i}">
            <b>${i + 1}. ${s.label}</b>${s.hint}
          </button>`)}
      </div>
      <div class="rj-context">
        <span><span class="eyebrow">Solved by</span><span class="row tight"><span class="avatar sm">${initials(solver?.name || '?')}</span>${solver?.name || 'Unassigned'}</span></span>
        <span><span class="eyebrow">Business application</span>${ticket.businessApp}</span>
        <span><span class="eyebrow">Problem category</span>${category}</span>
        <span><span class="eyebrow">SLA</span>${breached ? html`<span class="pill crit">Breached · +${fmtH(overH)}</span>` : html`<span class="pill good">Within SLA</span>`}</span>
      </div>

      ${step === 0 && html`
        <div class="stack lg">
          <label class="field"><span>Symptom as reported and verified</span><textarea id="rj-symptom" class="in" data-input="ws.rjField" ${field('symptom')}>${f.symptom}</textarea></label>
          <label class="field" style="max-width:280px"><span>Business impact</span>
            <select id="rj-impact" class="in" data-change="ws.rjField" ${field('impact')}>${options(['Single user', 'Team', 'Site', 'Enterprise-wide'], f.impact)}</select>
          </label>
          <div class="small muted">Opened ${fmtDateTime(ticket.openedAt)} via ${ticket.channel}. Total age ${fmtDur(Date.now() - ticket.openedAt)}.</div>
        </div>`}
      ${step === 1 && html`
        <div class="stack lg">
          <div class="form-grid">
            <label class="field"><span>Root cause category</span>
              <select id="rj-cause" class="in" data-change="ws.rjCause">
                ${options(Object.entries(ROOT_CAUSES).map(([k, v]) => [k, v.label]), f.cause)}
              </select>
            </label>
            <label class="field"><span>Subcategory</span>
              <select id="rj-sub" class="in" data-change="ws.rjField" ${field('sub')}>
                ${options(Object.entries(ROOT_CAUSES[f.cause].subs), f.sub)}
              </select>
            </label>
          </div>
          <label class="field"><span>Diagnosis note <span class="hint">(optional)</span></span><textarea id="rj-diag" class="in" data-input="ws.rjField" ${field('diagNote')} placeholder="Logs checked, recent changes, what ruled other causes out">${f.diagNote}</textarea></label>
          ${a.top && html`<div class="callout accent small">${icon('spark', 16)}Resolution Assist suggests <b>${ROOT_CAUSES[a.top.info.cause].label} · ${ROOT_CAUSES[a.top.info.cause].subs[a.top.info.sub]}</b> based on ${a.sample} similar incidents.</div>`}
        </div>`}
      ${step === 2 && html`
        <div class="stack lg">
          <label class="field"><span>Remedy / fix note <span class="hint">(action taken)</span></span><textarea id="rj-fix" class="in" data-input="ws.rjField" ${field('fix')}>${f.fix}</textarea></label>
          <label class="field" style="max-width:360px"><span>Runbook followed</span><input id="rj-runbook" class="in" value="${f.runbook}" data-input="ws.rjField" ${field('runbook')}></label>
          <label class="check small"><input id="rj-new" type="checkbox" ${attrs({ checked: f.newFix })} data-change="ws.rjField" ${field('newFix')}>This is a new fix that no existing resolution code covers. Mint a new code.</label>
        </div>`}
      ${step === 3 && html`
        <div class="stack lg">
          <label class="check"><input id="rj-valid" type="checkbox" ${attrs({ checked: f.validated })} data-change="ws.rjField" ${field('validated')}>Customer confirmed the service is restored</label>
          <label class="field"><span>${f.validated ? 'Validation note' : 'Why was it not confirmed? (required)'}</span><textarea id="rj-validnote" class="in" data-input="ws.rjField" ${field('validNote')}>${f.validNote}</textarea></label>
        </div>`}
      ${step === 4 && html`
        <div class="stack lg">
          <div class="form-grid">
            <label class="field"><span>First contact resolution</span>
              <select id="rj-fcr" class="in" data-change="ws.rjFcr">${options([['yes', 'Yes, solved on first contact'], ['no', 'No']], f.fcr ? 'yes' : 'no')}</select>
            </label>
            <label class="field"><span>Transfers before reaching you</span><input id="rj-transfers" type="number" min="0" max="9" class="in" value="${f.transfers}" data-input="ws.rjField" ${field('transfers')}></label>
            <label class="field"><span>Escalation target resolver <span class="hint">${escalated ? '(required: ticket was transferred)' : '(only when transferred)'}</span></span>
              <select id="rj-esc" class="in" data-change="ws.rjField" ${field('escalatedTo')} ${attrs({ disabled: !escalated })}>
                ${options([['', escalated ? 'Choose a resolver group…' : 'Not escalated'], ...[...new Set(Object.values(ESCALATION_TARGETS))]], escalated ? f.escalatedTo : '')}
              </select>
            </label>
            <label class="field"><span>Breach reason code <span class="hint">${breached ? `(required: ${fmtH(overH)} over the ${PRIORITIES[ticket.priority].slaH}h SLA)` : '(only when the SLA is breached)'}</span></span>
              <select id="rj-breach" class="in" data-change="ws.rjField" ${field('breachCode')} ${attrs({ disabled: !breached })}>
                ${options([['', breached ? 'Why did it miss the SLA?' : 'SLA met: not needed'], ...Object.entries(BREACH_REASONS).map(([k, v]) => [k, `${k} · ${v}`])], breached ? f.breachCode : '')}
              </select>
            </label>
            <label class="field"><span>Deflection candidate <span class="hint">(could the Solution Center have resolved it at first contact?)</span></span>
              <select id="rj-deflect" class="in" data-change="ws.rjDeflect">
                ${options([['auto', `Suggested: ${autoDeflect ? 'Yes' : 'No'}`], ['yes', 'Yes, flag as deflection candidate'], ['no', 'No']], f.deflectFlag === null ? 'auto' : f.deflectFlag ? 'yes' : 'no')}
              </select>
            </label>
          </div>
          <label class="field"><span>Close notes for the customer <span class="hint">(optional)</span></span><textarea id="rj-close" class="in" data-input="ws.rjField" ${field('closeNote')}>${f.closeNote}</textarea></label>
          <div class="stack">
            <div class="row"><span class="section-title">Resolution details</span><span class="muted small">saved to Ticket Explorer</span></div>
            <dl class="details">
              <dt>Solved by</dt><dd>${solver?.name || 'Unassigned'} · ${solver?.group || 'Service Desk L2'}</dd>
              <dt>Problem category</dt><dd>${category}</dd>
              <dt>Business application</dt><dd>${ticket.businessApp}</dd>
              <dt>Diagnosis note</dt><dd>${`${category}. ${f.diagNote}`.trim()}</dd>
              <dt>Remedy / fix note</dt><dd>${f.fix} (${f.runbook || 'no runbook'})</dd>
              <dt>Breach reason</dt><dd>${breached ? (f.breachCode ? html`<span class="pill crit">${f.breachCode}</span> ${BREACH_REASONS[f.breachCode]} · +${fmtH(overH)}` : html`<span style="color:var(--crit)">Required: choose a breach reason</span>`) : html`<span class="muted">SLA met</span>`}</dd>
              <dt>Deflection candidate</dt><dd>${isDeflect ? html`<span class="pill accent">Yes</span> ${deflectReason}` : html`<span class="muted">No</span>`}</dd>
              <dt>Escalation target</dt><dd>${escalated ? (f.escalatedTo ? `${f.escalatedTo} (${f.transfers} transfer${Number(f.transfers) > 1 ? 's' : ''})` : html`<span style="color:var(--crit)">Required: choose a resolver group</span>`) : html`<span class="muted">Not escalated</span>`}</dd>
            </dl>
          </div>
          <div class="callout good" style="align-items:center">
            ${icon('check')}
            <div class="stack" style="gap:2px;flex:1">
              <div class="row"><span class="eyebrow">Resolution code</span><span class="code-chip" style="font-size:14px">${code.code}</span>${code.isNew && html`<span class="pill warn">New code</span>`}</div>
              <span class="small">${ROOT_CAUSES[f.cause].label} · ${ROOT_CAUSES[f.cause].subs[f.sub]} — ${code.title}</span>
            </div>
          </div>
          <div class="small muted">RES MTTR will be ${fmtH((Date.now() - (ticket.assignedAt || ticket.queuedAt)) / HOUR)}, EZE MTTR ${fmtH((Date.now() - ticket.openedAt) / HOUR)}.</div>
        </div>`}`

    return S.modal({ title: 'Resolution journey', sub: `${ticket.id} · ${ticket.desc}`, onClose: 'ws.rjClose', wide: true, footer, body })
  }

  // ---------- Handlers ----------
  const ticketOf = (id) => S.state.tickets.find((t) => t.id === id)
  const setF = (patch) => { const u = rjState(rj.ticket); S.set(u, { f: { ...u.f, ...patch } }) }
  S.on({
    'ws.requestFix': (el) => {
      const { ticket, code, fix } = S.arg(el)
      S.dispatch({ type: 'requestFix', ticket, code, fix, by: S.currentUser(S.state).name })
    },
    'ws.step': (el) => S.dispatch({ type: 'toggleStep', id: el.dataset.v, i: +el.dataset.i }),
    'ws.entry': (el) => {
      const entry = S.ui('p:ws:entry:' + el.dataset.v)
      S.set(entry, { [el.dataset.k]: el.value })
    },
    'ws.contact': (el) => {
      const id = el.dataset.v
      const entry = S.ui('p:ws:entry:' + id, { channel: 'Phone', note: '' })
      if (!entry.note.trim()) return
      S.dispatch({ type: 'addContact', id, entry: { ...entry, by: S.currentUser(S.state).name } })
      S.set(entry, { note: '' })
    },
    'ws.copilot': (el) => S.nav('copilot', { ticket: el.dataset.v }),
    'ws.state': (el, ev) => {
      const t = ticketOf(el.dataset.v)
      if (!t) return
      if (el.value === 'Resolved') {
        // The select stays on the ticket's real state until the journey is done.
        el.value = t.state
        if (el.dataset.onresolve) S.call(el.dataset.onresolve, el, ev)
      } else S.dispatch({ type: 'setState', id: t.id, state: el.value })
    },
    'ws.rjClose': (el, ev) => close(el, ev),
    'ws.rjFinish': () => finish(),
    'ws.rjGo': (el) => S.set(rjState(rj.ticket), { step: +el.dataset.v }),
    'ws.rjStep': (el) => {
      const i = +el.dataset.v
      const u = rjState(rj.ticket)
      const { valid } = derive(rj.ticket, u.f)
      if (i <= u.step || valid.slice(0, i).every(Boolean)) S.set(u, { step: i })
    },
    'ws.rjField': (el) => setF({ [el.dataset.k]: el.type === 'checkbox' ? el.checked : el.value }),
    'ws.rjCause': (el) => setF({ cause: el.value, sub: Object.keys(ROOT_CAUSES[el.value].subs)[0] }),
    'ws.rjFcr': (el) => setF({ fcr: el.value === 'yes' }),
    'ws.rjDeflect': (el) => setF({ deflectFlag: el.value === 'auto' ? null : el.value === 'yes' }),
  })

  Object.assign(S, { assist, resolutionAssist, ticketWorkspace, resolveModal })
})()
