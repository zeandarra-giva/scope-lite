// Shift calendar, ported from src/pages/ShiftCalendar.jsx.
// S.shiftCalendar(initial) is the Day / Week / Month calendar embedded in Team
// (Schedule & coverage); S.weekPreview({ onOpen }) is the read-only week on Home.
// S.MIN and S.coverage are the coverage rules both use.
;(function () {
  const { html, cls, style, icon, seg, SHIFT_CODES, addDays, codeAt, dayIndex, dayKey, initials, locationOn, startOfDay, weekStart } = S

  const MIN = { weekday: { total: 5, E: 2, L: 1 }, weekend: { W: 2 }, holiday: { total: 3 } }
  const EVENTS = ['PL', 'SL', 'W']
  const ORDER = ['E', 'M', 'L', 'W', 'PL', 'SL', 'H', 'OFF']
  const MAX_LANES = 3
  const H0 = 6, H1 = 23
  const isWeekend = (ts) => [0, 6].includes(new Date(ts).getDay())
  const first = (name) => name.split(' ')[0]
  const span = (time) => time.split('–').map((s) => { const [h, m] = s.split(':').map(Number); return h + m / 60 })
  const sameDay = (a, b) => dayKey(a) === dayKey(b)

  function coverage(codes, weekend) {
    const n = (c) => codes.filter((x) => x === c).length
    if (weekend) return { ok: n('W') >= MIN.weekend.W, label: `${n('W')} W`, title: `Minimum ${MIN.weekend.W} on weekend duty` }
    const tot = n('E') + n('M') + n('L')
    const label = `${n('E')}E ${n('M')}M ${n('L')}L`
    if (n('H') > codes.length / 2) return { ok: tot >= MIN.holiday.total, label, title: `Public holiday: skeleton crew of ${MIN.holiday.total}` }
    return { ok: tot >= MIN.weekday.total && n('E') >= MIN.weekday.E && n('L') >= MIN.weekday.L, label, title: `Minimum ${MIN.weekday.total} on shift, ${MIN.weekday.E} early, ${MIN.weekday.L} late` }
  }

  const avatar = (name) => html`<span class="ev-av" aria-hidden="true">${initials(name)}</span>`

  // Calendar state lives under a "p:" key, so it resets on navigation like the
  // React component (which remounts with the page). Team also resets it when
  // you switch tabs, because the React calendar unmounts with its tab.
  const KEY = 'p:cal'
  const cal = (initial = {}) => S.ui(KEY, () => ({
    view: initial.view || 'month',
    cursor: initial.date ? startOfDay(+initial.date) : startOfDay(S.state.now),
    edit: null,
    pick: null,
  }))

  function shiftCalendar(initial = {}) {
    const state = S.state
    const u = cal(initial)
    const lead = state.role === 'lead'
    const me = S.currentUser(state)
    const people = state.analysts
    const today = startOfDay(state.now)
    const { view, cursor, edit } = u
    const code = (aid, ts) => codeAt(state.schedule, people, aid, ts)
    const covOn = (ts) => coverage(people.map((a) => code(a.id, ts)), isWeekend(ts))

    // Visible range, used for the title and the coverage status.
    let range
    if (view === 'day') range = [cursor]
    else if (view === 'week') { const s = weekStart(cursor); range = Array.from({ length: 7 }, (_, i) => addDays(s, i)) }
    else {
      const d = new Date(cursor); d.setDate(1)
      const s = weekStart(d.getTime())
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime()
      const weeks = Math.ceil((Math.round((last - s) / 86400000) + 1) / 7)
      range = Array.from({ length: weeks * 7 }, (_, i) => addDays(s, i))
    }
    const month = new Date(cursor).getMonth()
    const inScope = view === 'month' ? range.filter((d) => new Date(d).getMonth() === month) : range
    const short = inScope.filter((d) => !covOn(d).ok).length

    const title = view === 'month'
      ? new Date(cursor).toLocaleDateString([], { month: 'long', year: 'numeric' })
      : view === 'week'
        ? `${new Date(range[0]).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(range[6]).toLocaleDateString([], { month: new Date(range[0]).getMonth() === new Date(range[6]).getMonth() ? undefined : 'short', day: 'numeric' })}, ${new Date(range[6]).getFullYear()}`
        : new Date(cursor).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })

    const ctx = { people, me, lead, today, code, covOn }
    return html`<section class="card cal">
      <div class="cal-top">
        ${seg([{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }], view, 'cal.view')}
        <span class="spacer"></span>
        <div class="cal-status ${short ? 'low' : 'ok'}" role="status">
          <span class="cal-status-ic">${icon(short ? 'alert' : 'check', 15, { stroke: 2.4 })}</span>
          <div class="stack" style="gap:0">
            <b>${short ? 'Coverage gaps' : 'Fully covered'}</b>
            <span class="small muted">${short ? `${short} day${short > 1 ? 's' : ''} below minimum` : `Every ${view === 'day' ? 'shift' : 'day'} meets minimums`}</span>
          </div>
        </div>
      </div>
      <div class="cal-head">
        <h2>${title}</h2>
        <span class="spacer"></span>
        ${!range.some((d) => sameDay(d, today)) || (view === 'month' && month !== new Date(today).getMonth())
          ? html`<button class="btn sm" data-click="cal.today">Today</button>` : null}
        <button class="cal-nav" data-click="cal.step" data-v="-1" aria-label="Previous ${view}">${icon('chevL', 16)}</button>
        <button class="cal-nav" data-click="cal.step" data-v="1" aria-label="Next ${view}">${icon('chevR', 16)}</button>
      </div>
      <div class="cal-legend">
        ${Object.entries(SHIFT_CODES).filter(([k]) => k !== 'OFF').map(([k, v]) => html`<span><i class="ev-sw ${k}"></i>${v.label}${v.time && html`<span class="muted"> ${v.time}</span>`}</span>`)}
      </div>
      ${view === 'month' && monthView({ days: range, month, ...ctx })}
      ${view === 'week' && weekView({ days: range, ...ctx })}
      ${view === 'day' && dayView({ day: cursor, ...ctx })}
      <div class="small muted cal-foot">
        ${lead
          ? view === 'month' ? 'Month shows leave, weekend duty and holidays; regular shifts are summarised as coverage. Click a bar to change it, or a date to open that day.' : 'Click anyone to change their shift, leave or weekend duty. Coverage turns red when a day drops below minimums.'
          : 'Read-only for analysts. Ask your team lead to swap shifts.'}
      </div>
      ${edit && shiftEditor(edit, u, code)}
    </section>`
  }

  // ---------- Month ----------
  function weekBars(days, people, code) {
    const bars = []
    people.forEach((a) => {
      let i = 0
      while (i < 7) {
        const c = code(a.id, days[i])
        if (!EVENTS.includes(c)) { i++; continue }
        let j = i
        while (j + 1 < 7 && code(a.id, days[j + 1]) === c) j++
        bars.push({ key: `${a.id}-${i}`, aid: a.id, name: a.name, code: c, start: i, span: j - i + 1 })
        i = j + 1
      }
    })
    // Holidays are one bar for the whole team rather than one per person.
    const off = days.map((d) => people.filter((a) => code(a.id, d) === 'H').length)
    for (let i = 0; i < 7; i++) {
      if (!off[i]) continue
      let j = i
      while (j + 1 < 7 && off[j + 1]) j++
      bars.push({ key: `h-${i}`, code: 'H', start: i, span: j - i + 1, count: Math.max(...off.slice(i, j + 1)) })
      i = j
    }
    // Holidays first, then longer bars, then by start; greedy lane packing.
    bars.sort((a, b) => (a.code === 'H' ? -1 : 0) - (b.code === 'H' ? -1 : 0) || a.start - b.start || b.span - a.span)
    const lanes = []
    bars.forEach((b) => {
      let l = lanes.findIndex((end) => end < b.start)
      if (l === -1) { l = lanes.length; lanes.push(-1) }
      lanes[l] = b.start + b.span - 1
      b.lane = l
    })
    return bars
  }

  function monthView({ days, month, people, me, lead, today, code, covOn }) {
    const weeks = Array.from({ length: days.length / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7))
    return html`<div class="cal-month" role="grid" aria-label="Month">
      <div class="cal-dow" role="row">${weeks[0].map((d) => html`<span role="columnheader">${new Date(d).toLocaleDateString([], { weekday: 'short' }).slice(0, 2)}</span>`)}</div>
      ${weeks.map((wd) => {
        const bars = weekBars(wd, people, code)
        const shown = bars.filter((b) => b.lane < MAX_LANES)
        const lanes = Math.min(MAX_LANES, Math.max(0, ...bars.map((b) => b.lane + 1)))
        const hidden = wd.map((_, i) => bars.filter((b) => b.lane >= MAX_LANES && i >= b.start && i < b.start + b.span).length)
        return html`<div class="cal-week" role="row" data-key="w${wd[0]}" style="${style({ gridTemplateRows: `34px repeat(${lanes}, 32px) minmax(30px, 1fr)` })}">
          ${wd.map((d, i) => {
            const cov = covOn(d)
            const out = new Date(d).getMonth() !== month
            return html`<button class="${cls('cal-day', out && 'out', isWeekend(d) && 'we')}" data-key="d${d}" style="grid-column:${i + 1};grid-row:1 / -1"
              data-click="cal.openDay" data-v="${d}" aria-label="${new Date(d).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}, coverage ${cov.label}${cov.ok ? '' : ', below minimum'}">
              <span class="${cls('cal-num', sameDay(d, today) && 'today')}">${new Date(d).getDate()}</span>
              <span class="cal-cell-foot">
                ${hidden[i] > 0 && html`<span class="cal-more">+${hidden[i]} more</span>`}
                <span class="cov ${cov.ok ? 'ok' : 'low'}" title="${cov.title}">${cov.label}${!cov.ok && ' ⚠'}</span>
              </span>
            </button>`
          })}
          ${shown.map((b) => {
            const label = b.code === 'H' ? `Public holiday · ${b.count} off` : `${first(b.name)} · ${SHIFT_CODES[b.code].label}`
            const body = html`${b.code === 'H' ? html`<span class="ev-av">${icon('flag', 13)}</span>` : avatar(b.name)}<span class="ev-t">${label}</span>`
            const st = `grid-column:${b.start + 1} / span ${b.span};grid-row:${b.lane + 2}`
            const c = cls('ev', b.code, b.aid === me.id && 'mine')
            return lead && b.code !== 'H'
              ? html`<button class="${c}" data-key="b${b.key}" style="${st}" title="${label}" data-click="cal.edit" data-arg="${JSON.stringify({ aid: b.aid, from: wd[b.start], days: b.span })}">${body}</button>`
              : html`<button class="${c}" data-key="b${b.key}" style="${st}" title="${label}" data-click="cal.openDay" data-v="${wd[b.start]}">${body}</button>`
          })}
        </div>`
      })}
    </div>`
  }

  // ---------- Week ----------
  function chip({ a, c, ts, me, lead, sub }) {
    const label = `${a.name} · ${SHIFT_CODES[c].label}`
    const inner = html`${avatar(a.name)}<span class="ev-t">${first(a.name)}${a.id === me.id && ' (you)'}</span><span class="ev-c">${sub != null ? sub : c}</span>`
    const c2 = cls('ev', c, a.id === me.id && 'mine')
    return lead
      ? html`<button class="${c2}" data-key="c${a.id}" title="${label}" data-click="cal.edit" data-arg="${JSON.stringify({ aid: a.id, from: ts, days: 1 })}">${inner}</button>`
      : html`<div class="${c2}" data-key="c${a.id}" title="${label}">${inner}</div>`
  }

  function weekView({ days, people, me, lead, today, code, covOn }) {
    return html`<div class="cal-wk">
      ${days.map((d) => {
        const list = people.map((a) => ({ a, c: code(a.id, d) })).sort((x, y) => ORDER.indexOf(x.c) - ORDER.indexOf(y.c))
        const on = list.filter((x) => x.c !== 'OFF')
        const rest = list.length - on.length
        const cov = covOn(d)
        return html`<div class="${cls('cal-wk-col', isWeekend(d) && 'we')}" data-key="wk${d}">
          <button class="cal-wk-h" data-click="cal.openDay" data-v="${d}">
            <span class="muted small">${new Date(d).toLocaleDateString([], { weekday: 'short' })}</span>
            <span class="${cls('cal-num', sameDay(d, today) && 'today')}">${new Date(d).getDate()}</span>
          </button>
          <div class="stack" style="gap:6px">
            ${on.map(({ a, c }) => chip({ a, c, ts: d, me, lead }))}
            ${rest > 0 && html`<span class="small muted" style="padding:2px 4px">${rest} on rest day</span>`}
          </div>
          <span class="cov ${cov.ok ? 'ok' : 'low'}" title="${cov.title}" style="margin-top:auto">${cov.label}${!cov.ok && ' ⚠'}</span>
        </div>`
      })}
    </div>`
  }

  // ---------- Day ----------
  function dayView({ day, people, me, lead, today, code, covOn }) {
    const list = people.map((a) => ({ a, c: code(a.id, day) })).sort((x, y) => ORDER.indexOf(x.c) - ORDER.indexOf(y.c))
    const on = list.filter((x) => SHIFT_CODES[x.c].kind === 'shift')
    const off = list.filter((x) => SHIFT_CODES[x.c].kind !== 'shift')
    const cov = covOn(day)
    const pct = (h) => `${((h - H0) / (H1 - H0)) * 100}%`
    const nowH = new Date().getHours() + new Date().getMinutes() / 60
    const isToday = sameDay(day, today)
    // locationOn uses the rota day index; the pattern only depends on weekday.
    const loc = (a) => locationOn(a, (new Date(day).getDay() + 6) % 7)
    return html`<div class="stack lg">
      <div class="row">
        <span class="cov ${cov.ok ? 'ok' : 'low'}" title="${cov.title}">Coverage ${cov.label}${!cov.ok && ' ⚠ below minimum'}</span>
        <span class="small muted">${on.length} on shift · ${off.length} off</span>
      </div>
      <div class="cal-day-tl">
        <div class="cal-tl-axis">
          <span></span>
          <div class="cal-tl-track">
            ${Array.from({ length: H1 - H0 + 1 }, (_, i) => H0 + i).filter((h) => h % 2 === 0).map((h) => html`<span style="left:${pct(h)}">${String(h).padStart(2, '0')}:00</span>`)}
          </div>
        </div>
        ${on.length === 0 && html`<div class="muted small" style="padding:12px">Nobody is scheduled on shift.</div>`}
        ${on.map(({ a, c }) => {
          const [s, e] = span(SHIFT_CODES[c].time)
          const inner = html`${avatar(a.name)}<span class="ev-t">${SHIFT_CODES[c].label} ${SHIFT_CODES[c].time}</span><span class="ev-c">${loc(a)}</span>`
          const st = `left:${pct(s)};width:calc(${pct(e)} - ${pct(s)})`
          const c2 = cls('ev', c, a.id === me.id && 'mine')
          return html`<div class="cal-tl-row" data-key="r${a.id}">
            <span class="cal-tl-name">${a.name}${a.id === me.id && html`<span class="muted"> (you)</span>`}</span>
            <div class="cal-tl-track">
              ${isToday && nowH >= H0 && nowH <= H1 && html`<i class="cal-now" style="left:${pct(nowH)}"></i>`}
              ${lead
                ? html`<button class="${c2}" style="${st}" data-click="cal.edit" data-arg="${JSON.stringify({ aid: a.id, from: day, days: 1 })}">${inner}</button>`
                : html`<div class="${c2}" style="${st}">${inner}</div>`}
            </div>
          </div>`
        })}
      </div>
      ${off.length > 0 && html`<div class="stack">
        <span class="section-title">Not on shift</span>
        <div class="row">${off.map(({ a, c }) => chip({ a, c, ts: day, me, lead, sub: SHIFT_CODES[c].label }))}</div>
      </div>`}
    </div>`
  }

  // ---------- Editor ----------
  function shiftEditor(edit, u, code) {
    const state = S.state
    const a = state.analysts.find((x) => x.id === edit.aid)
    const days = Array.from({ length: edit.days }, (_, i) => addDays(edit.from, i))
    const pick = u.pick
    const fmt = (ts) => new Date(ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
    const seeded = dayIndex(state.schedule, edit.from)
    return S.modal({
      title: a.name,
      sub: days.length > 1 ? `${fmt(days[0])} – ${fmt(days[days.length - 1])} · ${days.length} days` : fmt(edit.from),
      onClose: 'cal.close',
      footer: html`<button class="btn" data-click="cal.close">Cancel</button><button class="btn primary" data-click="cal.save">Save</button>`,
      body: html`
        <div class="code-grid" role="radiogroup" aria-label="Shift">
          ${Object.entries(SHIFT_CODES).map(([k, v]) => html`
            <button role="radio" aria-checked="${pick === k}" class="${cls('code-opt', pick === k && 'on')}" data-click="cal.pick" data-v="${k}">
              <i class="ev-sw ${k}"></i>
              <span class="stack" style="gap:0"><b>${v.label}</b><span class="small muted">${v.time || (v.kind === 'off' ? 'Not working' : 'Full day')}</span></span>
            </button>`)}
        </div>
        ${seeded < 0 || seeded > 13
          ? html`<span class="small muted">Outside the published two-week rota, so this saves as a planned change.</span>`
          : html`<span class="small muted">Updates the published rota, Home schedule and coverage straight away.</span>`}`,
    })
  }

  // ---------- Home preview ----------
  // A read-only, one-week slice of the calendar. Clicking a day or bar opens
  // the full calendar on that day.
  const PREVIEW_LANES = 2

  // Who is working today, collapsed to one line. Opens a dropdown with names.
  // Uses the shared popover (S.pop), so a click outside or Escape closes it.
  function todayDropdown(groups, detail) {
    const open = S.pop === 'cal-today'
    return html`<div class="today-dd" data-pop-anchor="cal-today">
      <button class="today-btn" aria-expanded="${open}" aria-haspopup="true" data-click="cal.todayPop">
        <b>Today</b>
        ${groups.map(([l, list, tone]) => html`<span class="today-chip"><i class="ev-sw ${tone}"></i>${l} <b class="num">${list.length}</b></span>`)}
        <span class="spacer"></span>
        ${icon(open ? 'chevUp' : 'chevDown', 16)}
      </button>
      ${open && html`<div class="today-pop" role="dialog" aria-label="Who is working today">
        ${groups.map(([l, list, tone]) => html`
          <div class="today-g">
            <span class="eyebrow"><i class="ev-sw ${tone}"></i>${l} · ${list.length}</span>
            ${list.length ? list.map((a) => html`
              <div class="today-row"><span class="ev-av">${initials(a.name)}</span><span class="ev-t">${a.name}</span><span class="small muted">${detail(a)}</span></div>`) : html`<span class="small muted">Nobody</span>`}
          </div>`)}
      </div>`}
    </div>`
  }

  // onOpen: action name. "Open schedule" calls it with no data-arg; a day or a
  // bar calls it with data-arg {"view":"day","date":<ts>}, so the handler is
  // (el) => S.nav('team', { tab: 'schedule', ...(S.arg(el) || {}) })
  function weekPreview({ onOpen }) {
    const state = S.state
    const me = S.currentUser(state)
    const people = state.analysts
    const today = startOfDay(state.now)
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(today), i))
    const code = (aid, ts) => codeAt(state.schedule, people, aid, ts)
    const covOn = (ts) => coverage(people.map((a) => code(a.id, ts)), isWeekend(ts))
    const short = days.filter((d) => !covOn(d).ok).length
    const dow = (new Date(today).getDay() + 6) % 7
    const onShift = (a) => SHIFT_CODES[code(a.id, today)].kind === 'shift'
    const groups = [
      ['Online now', people.filter((a) => a.status === 'online'), 'E'],
      ['Onsite', people.filter((a) => onShift(a) && locationOn(a, dow) === 'Onsite'), 'M'],
      ['WFH', people.filter((a) => onShift(a) && locationOn(a, dow) === 'WFH'), 'ice'],
      ['On leave', people.filter((a) => ['PL', 'SL'].includes(code(a.id, today))), 'PL'],
    ]
    const bars = weekBars(days, people, code)
    const lanes = Math.min(PREVIEW_LANES, Math.max(0, ...bars.map((b) => b.lane + 1)))
    const hidden = days.map((_, i) => bars.filter((b) => b.lane >= PREVIEW_LANES && i >= b.start && i < b.start + b.span).length)
    return html`<div class="card cal cal-preview" data-tour="schedule">
      <div class="cal-head">
        <div class="stack" style="gap:2px">
          <h2>Schedule this week</h2>
          <span class="muted small">${new Date(days[0]).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(days[6]).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
        </div>
        <span class="spacer"></span>
        <span class="pill ${short ? 'crit' : 'good'}">${icon(short ? 'alert' : 'check', 12, { stroke: 2.4 })}${short ? `${short} day${short > 1 ? 's' : ''} short` : 'Fully covered'}</span>
        <button class="btn ghost sm" data-click="${onOpen}">Open schedule ${icon('arrowR', 14)}</button>
      </div>
      ${todayDropdown(groups, (a) => {
        const c = code(a.id, today)
        return SHIFT_CODES[c].kind === 'shift' ? `${SHIFT_CODES[c].label} · ${locationOn(a, dow)}` : SHIFT_CODES[c].label
      })}
      <div class="cal-month">
        <div class="cal-dow">${days.map((d) => html`<span>${new Date(d).toLocaleDateString([], { weekday: 'short' }).slice(0, 2)}</span>`)}</div>
        <div class="cal-week" style="${style({ gridTemplateRows: `32px repeat(${lanes}, 30px) minmax(44px, 1fr)` })}">
          ${days.map((d, i) => {
            const cov = covOn(d)
            const working = people.filter((a) => SHIFT_CODES[code(a.id, d)].kind === 'shift').length
            return html`<button class="${cls('cal-day', isWeekend(d) && 'we')}" data-key="d${d}" style="grid-column:${i + 1};grid-row:1 / -1" data-click="${onOpen}" data-arg="${JSON.stringify({ view: 'day', date: d })}"
              aria-label="${new Date(d).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}: ${working} working, coverage ${cov.label}${cov.ok ? '' : ', below minimum'}">
              <span class="${cls('cal-num', sameDay(d, today) && 'today')}">${new Date(d).getDate()}</span>
              <span class="cal-cell-foot">
                ${hidden[i] > 0 && html`<span class="cal-more">+${hidden[i]}</span>`}
                <span class="cal-working"><b class="num">${working}</b> on</span>
                <span class="cov ${cov.ok ? 'ok' : 'low'}" title="${cov.title}">${cov.label}${!cov.ok && ' ⚠'}</span>
              </span>
            </button>`
          })}
          ${bars.filter((b) => b.lane < PREVIEW_LANES).map((b) => {
            const label = b.code === 'H' ? `Holiday · ${b.count} off` : `${first(b.name)} · ${b.code}`
            return html`<button class="${cls('ev', b.code, b.aid === me.id && 'mine')}" data-key="b${b.key}" style="grid-column:${b.start + 1} / span ${b.span};grid-row:${b.lane + 2}"
              title="${b.code === 'H' ? label : `${b.name} · ${SHIFT_CODES[b.code].label}`}" data-click="${onOpen}" data-arg="${JSON.stringify({ view: 'day', date: days[b.start] })}">
              ${b.code === 'H' ? html`<span class="ev-av">${icon('flag', 12)}</span>` : avatar(b.name)}
              <span class="ev-t">${label}</span>
            </button>`
          })}
        </div>
      </div>
    </div>`
  }

  // ---------- Handlers ----------
  const u = () => S.ui(KEY)
  S.on({
    'cal.view': (el) => S.set(u(), { view: el.dataset.v }),
    'cal.today': () => S.set(u(), { cursor: startOfDay(S.state.now) }),
    'cal.step': (el) => {
      const c = u()
      const dir = Number(el.dataset.v)
      const d = new Date(c.cursor)
      if (c.view === 'month') { d.setDate(1); d.setMonth(d.getMonth() + dir) }
      else d.setDate(d.getDate() + dir * (c.view === 'week' ? 7 : 1))
      S.set(c, { cursor: startOfDay(d.getTime()) })
    },
    'cal.openDay': (el) => S.set(u(), { cursor: Number(el.dataset.v), view: 'day' }),
    'cal.edit': (el) => {
      const edit = S.arg(el)
      S.set(u(), { edit, pick: codeAt(S.state.schedule, S.state.analysts, edit.aid, edit.from) })
    },
    'cal.pick': (el) => S.set(u(), { pick: el.dataset.v }),
    'cal.close': () => S.set(u(), { edit: null }),
    'cal.save': () => {
      const { edit, pick } = u()
      const a = S.state.analysts.find((x) => x.id === edit.aid)
      const days = Array.from({ length: edit.days }, (_, i) => addDays(edit.from, i))
      const fmt = (ts) => new Date(ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
      S.dispatch({ type: 'setShift', items: days.map((ts) => ({ aid: a.id, ts, code: pick })) })
      S.dispatch({ type: 'toast', text: `${first(a.name)}: ${SHIFT_CODES[pick].label} on ${days.length > 1 ? `${days.length} days` : fmt(edit.from)}` })
      S.set(u(), { edit: null })
    },
    'cal.todayPop': () => S.togglePop('cal-today'),
  })

  Object.assign(S, { MIN, coverage, shiftCalendar, weekPreview })
})()
