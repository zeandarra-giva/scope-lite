// Onboarding tour, ported from src/components/Tour.jsx. app.js calls S.Tour()
// while S.state.tour is true. Each step spotlights an element tagged with data-tour.
// Steps that used to be Home quick actions carry a "Try it" action.
;(function () {
  const { html, cls, style, icon } = S

  function steps(lead, first) {
    return [
      { id: 'welcome', title: `Welcome to Scope, ${first}`, body: lead
        ? 'A quick tour of how you run the incident queue: live intake, fair assignment, approvals and handovers. Takes about a minute.'
        : 'A quick tour of how you work the queue: your prioritised tickets, resolution steps and handovers. Takes about a minute.' },
      { target: 'snow', title: 'Live from ServiceNow', body: 'Incidents sync from ServiceNow every 30 seconds. The chips show what is open, how many P1s there are and how many tickets are still waiting for an analyst. Click it for sync details.' },
      { target: 'kpis', title: 'Queue health at a glance', body: 'Active incidents, queue risk, SLA health and staffing. Every card has an i button in the top-right corner that explains how the number is calculated.' },
      { target: 'assign', title: 'Fair-share assignment', body: 'Tickets are assigned automatically to the online analyst with the lowest weighted load. This card shows how evenly work is spread right now.' },
      ...(lead ? [{ target: 'rebalance', title: 'Rebalance the queue', body: 'When someone goes offline, rebalance hands their open tickets to the rest of the shift using the same fair-share rule.', action: 'Rebalance now' }] : []),
      { target: 'tab-mine', title: 'Your prioritised work queue', body: 'Your tickets, ordered by priority and SLA urgency. Open one to work through resolution steps, log customer contact and get suggested fixes.', action: 'Open my work queue' },
      ...(lead ? [{ target: 'tab-approvals', title: 'Review fix approvals', body: 'Analysts can propose automated fixes from a resolution code. Nothing runs until you approve it here.', action: 'Open approvals' }] : []),
      { target: 'tab-handover', title: 'Start a shift handover', body: 'Summarises what was resolved, which critical incidents are still open and next week\'s coverage, ready for the next shift to acknowledge.', action: 'Open handover' },
      { target: 'notif', title: 'Notifications', body: 'Split into Needs action and Updates: SLA risk, new P1s, approvals, handovers, leave and password expiry reminders.' },
      { target: 'rail', title: 'Everything else', body: 'Ticket Explorer for how incidents were solved, Reports for performance and coaching, Team Management for schedules and your password vault, the Knowledge Base for runbooks and policies, and Copilot for help resolving tickets.' },
      { target: 'profile', title: 'Your account', body: 'Open your account profile or log out from here. That\'s the tour.' },
    ]
  }

  const PAD = 8

  // Tour state. It is reset when the tour ends, so every start begins at step 1.
  const t = { i: 0, rect: null, active: false, stepKey: null, timer: null }
  const list = () => {
    const me = S.currentUser(S.state)
    return steps(S.state.role === 'lead', me.name.split(' ')[0])
  }
  const current = () => { const l = list(); return l[Math.min(t.i, l.length - 1)] }
  const end = () => S.dispatch({ type: 'tourEnd' })

  // Measure the target after the DOM is patched; re-render only when the
  // spotlight moved by half a pixel or more, so measuring can't loop.
  function measure() {
    if (!S.state.tour) return
    const step = current()
    let next = null
    const el = step.target && document.querySelector(`[data-tour="${step.target}"]`)
    if (el) {
      const r = el.getBoundingClientRect()
      next = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
    }
    const prev = t.rect
    const same = prev && next ? ['top', 'left', 'width', 'height'].every((k) => Math.abs(prev[k] - next[k]) < 0.5) : prev === next
    if (!same) { t.rect = next; S.render() }
  }

  const onKey = (e) => {
    if (e.key === 'Escape') end()
    if (e.key === 'ArrowRight') { t.i = Math.min(list().length - 1, t.i + 1); S.render() }
    if (e.key === 'ArrowLeft') { t.i = Math.max(0, t.i - 1); S.render() }
  }

  S.after(() => {
    if (!S.state.tour) {
      if (t.active) {
        t.active = false
        Object.assign(t, { i: 0, rect: null, stepKey: null })
        clearTimeout(t.timer)
        window.removeEventListener('keydown', onKey)
        window.removeEventListener('resize', measure)
        window.removeEventListener('scroll', measure, true)
      }
      return
    }
    if (!t.active) {
      t.active = true
      window.addEventListener('keydown', onKey)
      window.addEventListener('resize', measure)
      window.addEventListener('scroll', measure, true)
      // The tour walks through Home, so start there.
      if (S.route.page !== 'home') { S.nav('home'); return }
    }
    // On a new step (or page), scroll the target into view and measure again a
    // moment later, once layout has settled.
    const key = `${t.i}:${S.route.page}:${S.route.key}`
    if (key !== t.stepKey) {
      t.stepKey = key
      const step = current()
      const el = step.target && document.querySelector(`[data-tour="${step.target}"]`)
      if (el) {
        const r = el.getBoundingClientRect()
        if (r.top < 80 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: 'center' })
      }
      clearTimeout(t.timer)
      t.timer = setTimeout(measure, 120)
    }
    measure()
  })

  S.Tour = function Tour() {
    const l = list()
    if (t.i > l.length - 1) t.i = l.length - 1
    const i = t.i
    const step = l[i]
    const rect = t.rect
    const last = i === l.length - 1

    // Place the card below the spotlight when there is room, otherwise above,
    // otherwise beside it; centred when there is no target.
    const W = Math.min(360, window.innerWidth - 32)
    let pos = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    if (rect) {
      const below = rect.top + rect.height + 12
      const roomBelow = window.innerHeight - below > 230
      const roomAbove = rect.top > 250
      const left = Math.max(16, Math.min(window.innerWidth - W - 16, rect.left))
      if (roomBelow) pos = { top: below, left }
      else if (roomAbove) pos = { top: rect.top - 12, left, transform: 'translateY(-100%)' }
      else pos = { top: Math.max(16, Math.min(window.innerHeight - 260, rect.top)), left: Math.min(window.innerWidth - W - 16, rect.left + rect.width + 12) }
    }

    return html`<div class="tour" role="dialog" aria-modal="true" aria-label="Onboarding tour">
      ${rect ? html`<div class="tour-spot" style="${style(rect)}"></div>` : html`<div class="tour-dim"></div>`}
      <div class="tour-card" style="${style({ ...pos, width: W })}">
        <div class="row">
          <span class="tour-step">${i + 1} / ${l.length}</span>
          <span class="spacer"></span>
          <button class="btn ghost sm" data-click="tour.end">Skip tour</button>
        </div>
        <h3>${step.title}</h3>
        <p>${step.body}</p>
        <div class="tour-dots" aria-hidden="true">${l.map((_, j) => html`<i class="${cls(j === i ? 'on' : j < i ? 'done' : '')}"></i>`)}</div>
        <div class="row">
          ${step.action && html`<button class="btn sm" data-click="tour.try">${icon('arrowR', 14)}${step.action}</button>`}
          <span class="spacer"></span>
          ${i > 0 && html`<button class="btn sm" data-click="tour.back">Back</button>`}
          <button class="btn primary sm" data-click="${last ? 'tour.end' : 'tour.next'}">${i === 0 ? 'Start tour' : last ? 'Finish' : 'Next'}</button>
        </div>
      </div>
    </div>`
  }

  S.on({
    'tour.end': end,
    'tour.next': () => { t.i = Math.min(list().length - 1, t.i + 1); S.render() },
    'tour.back': () => { t.i = Math.max(0, t.i - 1); S.render() },
    'tour.try': () => { const s = current(); const el = s.target && document.querySelector(`[data-tour="${s.target}"]`); if (el) el.click() },
  })
})()
