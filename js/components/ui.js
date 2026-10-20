// Shared UI pieces, ported from src/components/ui.jsx and src/components/Doc.jsx.
// Each returns markup (S.html). Interactive ones take an action name: the
// handler registered with S.on(name, (el, ev) => …) reads the value from el.dataset.v.
;(function () {
  const { html, raw, cls, style, attrs } = S

const PATHS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm9 16l-4.3-4.3',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  team: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 10a7 7 0 0 1 14 0m1-10a3 3 0 1 0 0-6m3 16a6 6 0 0 0-4-5.6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.3-1.3L14.4 3h-4l-.4 2.4a7 7 0 0 0-2.2 1.3l-2.3-.9-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-.9c.7.6 1.4 1 2.2 1.3l.4 2.4h4l.4-2.4c.8-.3 1.6-.7 2.3-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9m4.3 13a2 2 0 0 0 3.4 0',
  plus: 'M12 5v14M5 12h14',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  swap: 'M7 4L3 8l4 4M3 8h14m0 12l4-4-4-4m4 4H7',
  clip: 'M9 4h6v3H9zM7 5H5v16h14V5h-2',
  pause: 'M8 5v14m8-14v14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-11',
  alert: 'M12 3l10 18H2zm0 7v5m0 3v.5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2',
  key: 'M15 7a4 4 0 1 1-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0 1 15 7z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0',
  spark: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6',
  book: 'M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zm16 0h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  refresh: 'M20 11a8 8 0 0 0-14.7-4M4 4v4h4m-4 5a8 8 0 0 0 14.7 4M20 20v-4h-4',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v5m8-5v5',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7m-7 4h5',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  arrowR: 'M5 12h14m-6-6l6 6-6 6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  lock: 'M6 11h12v10H6zm2 0V8a4 4 0 0 1 8 0v3',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-6v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  chevUp: 'M6 15l6-6 6 6',
  chevDown: 'M6 9l6 6 6-6',
  chevL: 'M15 6l-6 6 6 6',
  chevR: 'M9 6l6 6-6 6',
  logout: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h11',
  code: 'M8 6l-6 6 6 6M16 6l6 6-6 6',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 8v5m0-8.5v.5',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
  send: 'M4 12L20 4l-5 16-3-7zm8 1l8-9',
  upload: 'M12 15V4m-5 5l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  edit: 'M4 20h4L19 9l-4-4L4 16zm9-13l4 4',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  trash: 'M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13',
  external: 'M14 4h6v6m0-6l-9 9m7 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  grid: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  bulb: 'M9 18h6m-5 3h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  bug: 'M8 10h8v5a4 4 0 0 1-8 0zm1-1V7a3 3 0 0 1 6 0v2M4 13h4m8 0h4M5 8l3 2m11-2l-3 2M5 19l3-2m11 2l-3-2',
  wrench: 'M15 4a5 5 0 0 0-4.6 6.9L4 17.3V20h2.7l6.4-6.4A5 5 0 0 0 20 9l-3 3-2.5-.5L14 9l3-3a5 5 0 0 0-2-2z',
  up: 'M12 19V5m-6 6l6-6 6 6',
  msg: 'M4 5h16v11H9l-5 4z',
  folderOpen: 'M3 7V5.5A1.5 1.5 0 0 1 4.5 4H9l2 2h7.5A1.5 1.5 0 0 1 20 7.5V9M3 7v11h15l3-9H6z',
}

// Solid versions for decorative use (KPI card backgrounds). Cut-outs use evenodd.
const FILLED = {
  alert: 'M12 2.2L23.2 21.6H.8zM10.8 9h2.4v6.2h-2.4zM10.8 16.8h2.4v2.4h-2.4z',
  bolt: 'M13.5 1L3 14h7.2L9 23l12-13.6h-7.4z',
  clock: 'M12 1a11 11 0 1 1 0 22 11 11 0 0 1 0-22zM10.8 5h2.4v6.4l4.2 2.5-1.2 2-5.4-3.2z',
  team: 'M9 2.5a4.3 4.3 0 1 1 0 8.6 4.3 4.3 0 0 1 0-8.6zM.8 21.5a8.2 8.2 0 0 1 16.4 0zM17.2 3.6a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2zM17.6 13.2a6.6 6.6 0 0 1 5.6 8.3h-4.4a10 10 0 0 0-2.9-7.6z',
  doc: 'M5 1h10.5L20 5.5V23H5zM8 11h9v2.2H8zM8 15.5h6.5v2.2H8z',
  pause: 'M4.5 2.5h5.5v19H4.5zM14 2.5h5.5v19H14z',
  check: 'M12 1a11 11 0 1 1 0 22 11 11 0 0 1 0-22zM6.3 12.4l1.7-1.7 2.7 2.7 5.4-5.4 1.7 1.7-7.1 7.1z',
  shield: 'M12 1l9.5 3.6v7c0 6.2-4.2 10.2-9.5 11.6C6.7 21.8 2.5 17.8 2.5 11.6v-7z',
  swap: 'M7.5 1.5L1 8l6.5 6.5V10H21V6H7.5zM16.5 9.5L23 16l-6.5 6.5V18H3v-4h13.5z',
  clip: 'M8 1h8v4H8zM4.5 3H7v3.5h10V3h2.5A1.5 1.5 0 0 1 21 4.5v17a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 21.5v-17A1.5 1.5 0 0 1 4.5 3z',
  cal: 'M6 1h3v3H6zM15 1h3v3h-3zM2.5 4h19v18.5h-19zM5 9v11h14V9zM7 11h3.2v3.2H7zM11.4 11h3.2v3.2h-3.2zM7 15.4h3.2v3.2H7z',
  user: 'M12 1.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM2.5 22.5a9.5 9.5 0 0 1 19 0z',
  bell: 'M12 1a7 7 0 0 1 7 7c0 7 3.5 9.5 3.5 9.5h-21S5 15 5 8a7 7 0 0 1 7-7zM8.8 19.5h6.4a3.2 3.2 0 0 1-6.4 0z',
  book: 'M1.5 3.5H9a3.5 3.5 0 0 1 3 1.7 3.5 3.5 0 0 1 3-1.7h7.5V19H15a2.5 2.5 0 0 0-2 1h-2a2.5 2.5 0 0 0-2-1H1.5z',
  table: 'M2.5 3.5h19v17h-19zM5 9.5v3.2h4V9.5zM11 9.5v3.2h8V9.5zM5 14.8V18h4v-3.2zM11 14.8V18h8v-3.2z',
}


  function icon(name, size = 18, { stroke = 1.8, filled = false } = {}) {
    if (filled && FILLED[name]) {
      return raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${FILLED[name]}" fill-rule="evenodd"/></svg>`)
    }
    return raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name] || ''}"/></svg>`)
  }

  // Modal. onClose is an action name; Escape and a click on the scrim call it too.
  function modal({ title, sub, body, footer, wide, onClose }) {
    return S.overlay(html`
      <div class="scrim" data-mousedown="ui.scrim" data-close="${onClose}" data-esc="${onClose}">
        <div class="${cls('modal', wide && 'wide')}" role="dialog" aria-modal="true" aria-label="${title}">
          <div class="modal-h">
            <div class="stack" style="gap:2px;flex:1">
              <h2>${title}</h2>
              ${sub && html`<div class="muted small">${sub}</div>`}
            </div>
            <button class="icon-btn" data-click="${onClose}" aria-label="Close">${icon('x', 16)}</button>
          </div>
          <div class="modal-b">${body}</div>
          ${footer && html`<div class="modal-f">${footer}</div>`}
        </div>
      </div>`)
  }

  // Side panel. Its width can be dragged from the left edge (or changed with
  // the arrow keys on the handle); each kind of drawer remembers its width.
  const DRAWER_MIN = 360
  const clampDrawer = (w) => Math.max(DRAWER_MIN, Math.min(window.innerWidth - 24, w))
  const drawerKey = (className) => `scope-drawer-w:${className || 'default'}`
  const drawerW = {}
  const getDrawerW = (k) => (k in drawerW ? drawerW[k] : (drawerW[k] = +S.storage.get(k) || null))
  function drawer({ title, sub, body, actions, className = '', onClose }) {
    const k = drawerKey(className)
    const w = getDrawerW(k)
    return S.overlay(html`
      <div class="drawer-scrim" data-click="${onClose}"></div>
      <aside class="${cls('drawer', className)}" ${attrs({ style: w ? `width:${clampDrawer(w)}px` : null })} role="dialog" aria-modal="true" data-esc="${onClose}" data-key="drawer-${className || 'default'}">
        <div class="drawer-resize" role="separator" aria-orientation="vertical" aria-label="Resize panel" title="Drag to resize · double-click to reset" tabindex="0"
          data-pointerdown="ui.drawerDrag" data-keydown="ui.drawerNudge" data-dblclick="ui.drawerReset" data-dk="${k}"></div>
        <div class="drawer-h">
          <div class="stack" style="gap:4px;flex:1;min-width:0">${title}${sub}</div>
          ${actions}
          <button class="icon-btn" data-click="${onClose}" aria-label="Close">${icon('x', 16)}</button>
        </div>
        <div class="drawer-b">${body}</div>
      </aside>`)
  }

  function tabs(list, value, action) {
    return html`<div class="tabs" role="tablist">${list.map((t) => html`
      <button class="tab" role="tab" data-tour="tab-${t.id}" aria-selected="${String(value === t.id)}" data-click="${action}" data-v="${t.id}">
        ${t.icon && icon(t.icon, 15)}${t.label}${t.count != null && html`<span class="ct">${t.count}</span>`}
      </button>`)}</div>`
  }

  function seg(options, value, action) {
    return html`<div class="seg" role="group">${options.map((o) => html`
      <button aria-pressed="${String(value === o.id)}" data-click="${action}" data-v="${o.id}">${o.label}</button>`)}</div>`
  }

  // The "i" button in a card's top-right corner. Opens a side panel that
  // explains how the card's number is calculated. id must be unique on the page.
  function infoTip(id, title, body) {
    const open = S.ui('p:info').id === id
    if (open) drawer({ className: 'info-drawer', onClose: 'ui.infoClose', title: html`<span class="eyebrow">How it's calculated</span><h2>${title}</h2>`, body: html`<div class="stack ink2" style="gap:12px">${body}</div>` })
    return html`<span class="info"><button class="info-btn" aria-label="How ${title} works" aria-haspopup="dialog" aria-expanded="${open}" data-click="ui.info" data-v="${id}">${icon('info', 16)}</button></span>`
  }

  // KPI card: a tinted card with its icon, filled and oversized, as a decorative
  // shape in the top-right corner. A semantic state (good / warn / crit) overrides the tone.
  // extra: more attributes for the card, e.g. { 'data-click': 'home.kpi', 'data-v': 'sla' }
  function kpiShell({ label, icon: ic, tone = 'sky', state, info, infoId, className = '', extra = {} }, inner) {
    return html`<div class="${cls('card kpi', 'k-' + (state || tone), state && 'state-' + state, className)}" ${attrs(extra)}>
      ${ic && html`<span class="kpi-art" aria-hidden="true">${icon(ic, 132, { filled: true })}</span>`}
      ${info && infoTip(infoId || 'kpi-' + label, label, info)}
      <div class="kpi-label">${label}</div>
      ${inner}
    </div>`
  }
  function kpi({ value, unit, foot, side, ...shell }) {
    return kpiShell(shell, html`
      <div class="row" style="align-items:flex-end;justify-content:space-between;flex-wrap:nowrap">
        <div class="kpi-v">${value}${unit && html`<small>${unit}</small>`}</div>
        ${side}
      </div>
      ${foot && html`<div class="kpi-foot">${foot}</div>`}`)
  }

  const slaPill = (status) => html`<span class="pill ${status === 'Breached' ? 'crit' : status === 'At risk' ? 'warn' : 'good'}">${status}</span>`
  const prio = (p) => html`<span class="prio ${p}">${p}</span>`

  function toasts() {
    return html`<div class="toasts" aria-live="polite">${S.state.toasts.map((t) => html`<div class="toast" data-key="t${t.id}">${icon('check', 16)}${t.text}</div>`)}</div>`
  }

  function ring(value, tone = 'good', label = '') {
    const r = 38, c = 2 * Math.PI * r
    const color = tone === 'crit' ? 'var(--crit)' : tone === 'warn' ? 'var(--butter)' : 'var(--sage)'
    return html`<div class="ring" aria-label="${label}">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="10"/>
        <circle cx="44" cy="44" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${c * value} ${c}"/>
      </svg>
      <b>${Math.round(value * 100)}</b>
    </div>`
  }

  // ---------- Charts ----------
  // Each chart takes a unique id: it keys the measured width and the hover state.
  const niceMax = (v) => {
    if (v <= 0) return 1
    const p = Math.pow(10, Math.floor(Math.log10(v)))
    const n = v / p
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p
  }
  const fmtTick = (v) => (Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(1))
  const geo = {}
  const hover = () => S.ui('chartHover')

  // Line chart: up to 3 series, one y-axis, crosshair tooltip, optional goal line.
  function lineChart(id, { labels, series, height = 220, goal, unit = '', fmt = (v) => fmtTick(v) + unit }) {
    const w = S.width(id)
    const h = hover()[id]
    const pad = { l: 40, r: 16, t: 14, b: 26 }
    const iw = Math.max(50, w - pad.l - pad.r), ih = height - pad.t - pad.b
    const max = niceMax(Math.max(...series.flatMap((s) => s.values.filter((v) => v != null)), goal || 0) * 1.05)
    const x = (i) => pad.l + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw)
    const y = (v) => pad.t + ih - (v / max) * ih
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
    const every = Math.ceil(labels.length / Math.max(2, Math.floor(iw / 70)))
    geo[id] = { kind: 'line', l: pad.l, iw, n: labels.length }
    return html`<div data-w="${id}" style="position:relative">
      <svg class="chart" width="${w}" height="${height}" role="img" aria-label="${series.map((s) => s.name).join(', ')}" data-mousemove="ui.chartMove" data-mouseleave="ui.chartLeave" data-chart="${id}">
        ${ticks.map((t) => html`<g><line class="grid-l" x1="${pad.l}" x2="${pad.l + iw}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmtTick(t)}</text></g>`)}
        ${labels.map((l, i) => i % every === 0 && html`<text x="${x(i)}" y="${height - 6}" text-anchor="middle">${l}</text>`)}
        ${goal != null && html`<g>
          <line x1="${pad.l}" x2="${pad.l + iw}" y1="${y(goal)}" y2="${y(goal)}" stroke="var(--crit)" stroke-dasharray="4 4" stroke-width="1.5"/>
          <text x="${pad.l + iw}" y="${y(goal) - 5}" text-anchor="end" style="fill:var(--crit)">Goal ${fmt(goal)}</text></g>`}
        ${series.map((s, si) => {
          const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean)
          if (!pts.length) return ''
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('')
          const last = pts[pts.length - 1]
          return html`<g>
            ${si === 0 && series.length === 1 && html`<path d="${d}L${last[0]},${y(0)}L${pts[0][0]},${y(0)}Z" fill="${s.color}" opacity=".1"/>`}
            <path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>
            <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/></g>`
        })}
        ${h != null && html`<g>
          <line x1="${x(h)}" x2="${x(h)}" y1="${pad.t}" y2="${pad.t + ih}" stroke="var(--line-strong)"/>
          ${series.map((s) => s.values[h] != null && html`<circle cx="${x(h)}" cy="${y(s.values[h])}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`)}</g>`}
      </svg>
      ${h != null && html`<div class="chart-tip" style="left:${Math.min(x(h) + 10, w - 150)}px;top:8px">
        <b>${labels[h]}</b>
        ${series.map((s) => html`<div class="row tight"><i style="width:8px;height:8px;border-radius:2px;background:${s.color};display:inline-block"></i> ${s.name}: <b class="num">${s.values[h] == null ? '—' : fmt(s.values[h])}</b></div>`)}
      </div>`}
      ${series.length > 1 && html`<div class="legend" style="margin-top:4px">${series.map((s) => html`<span><i style="background:${s.color}"></i>${s.name}</span>`)}</div>`}
    </div>`
  }

  // Vertical bars, single series, per-bar hover.
  function barChart(id, { labels, values, height = 200, color = 'var(--s2)', fmt = fmtTick, highlight }) {
    const w = S.width(id)
    const h = hover()[id]
    const pad = { l: 36, r: 8, t: 12, b: 26 }
    const iw = Math.max(50, w - pad.l - pad.r), ih = height - pad.t - pad.b
    const max = niceMax(Math.max(...values, 0) * 1.05)
    const bw = iw / labels.length
    const gap = Math.min(8, bw * 0.25)
    const y = (v) => pad.t + ih - (v / max) * ih
    const every = Math.ceil(labels.length / Math.max(2, Math.floor(iw / 56)))
    geo[id] = { kind: 'bar', l: pad.l, bw, n: labels.length }
    return html`<div data-w="${id}" style="position:relative">
      <svg class="chart" width="${w}" height="${height}" role="img" data-mousemove="ui.chartMove" data-mouseleave="ui.chartLeave" data-chart="${id}">
        ${[0, 0.5, 1].map((f) => html`<g><line class="grid-l" x1="${pad.l}" x2="${pad.l + iw}" y1="${y(f * max)}" y2="${y(f * max)}"/><text x="${pad.l - 6}" y="${y(f * max) + 4}" text-anchor="end">${fmtTick(f * max)}</text></g>`)}
        ${values.map((v, i) => {
          const bx = pad.l + i * bw + gap / 2, bh = Math.max(0, (v / max) * ih)
          const r = Math.min(4, bh, (bw - gap) / 2)
          const top = y(v), bot = pad.t + ih, x2 = bx + bw - gap
          const d = `M${bx},${bot}V${top + r}Q${bx},${top} ${bx + r},${top}H${x2 - r}Q${x2},${top} ${x2},${top + r}V${bot}Z`
          return html`<path d="${d}" fill="${highlight === i ? 'var(--s1)' : color}" opacity="${h == null || h === i ? 1 : 0.55}"/>`
        })}
        ${labels.map((l, i) => i % every === 0 && html`<text x="${pad.l + i * bw + bw / 2}" y="${height - 6}" text-anchor="middle">${l}</text>`)}
      </svg>
      ${h != null && html`<div class="chart-tip" style="left:${Math.min(pad.l + h * bw + bw / 2, w - 120)}px;top:${Math.max(0, y(values[h]) - 40)}px"><b>${labels[h]}</b>: <span class="num">${fmt(values[h])}</span></div>`}
    </div>`
  }

  // Ranked horizontal bars rendered in HTML; optional target marker.
  // onClick: action name; the handler gets the row label in el.dataset.v.
  function hBars({ rows, max, fmt = (v) => v, color = 'var(--s7)', target, onClick }) {
    const m = max || Math.max(...rows.map((r) => r.value), target || 0, 1)
    return html`<div class="stack" style="gap:8px">${rows.map((r) => html`
      <div class="hbar" title="${r.label}: ${fmt(r.value)}" ${attrs({ style: onClick ? 'cursor:pointer' : null, 'data-click': onClick || null, 'data-v': onClick ? r.label : null })}>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.label}</span>
        <div class="hbar-track">
          <div class="hbar-fill" style="width:${(r.value / m) * 100}%;background:${r.color || color}"></div>
          ${target != null && html`<div class="hbar-mark" style="left:${(target / m) * 100}%"></div>`}
        </div>
        <b class="num" style="text-align:right">${fmt(r.value)}</b>
      </div>`)}</div>`
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text)
      S.dispatch({ type: 'toast', text: 'Copied to clipboard' })
    } catch {
      S.dispatch({ type: 'toast', text: 'Copy is blocked here. Select the text and copy it manually.' })
    }
  }

  // ---------- Doc text (src/components/Doc.jsx) ----------
  // Renders the light markup used in knowledge base pages and Copilot answers:
  // "## " headings, "- " bullets, "1. " steps, blank-line paragraphs,
  // **bold** and `code` inline.
  function inline(text) {
    const out = []
    const re = /\*\*([^*]+)\*\*|`([^`]+)`/g
    let last = 0, m
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index))
      out.push(m[1] ? html`<b>${m[1]}</b>` : html`<span class="code-chip">${m[2]}</span>`)
      last = m.index + m[0].length
    }
    if (last < text.length) out.push(text.slice(last))
    return html`${out}`
  }
  function docText(text, className = '') {
    const blocks = []
    let list = null
    const flush = () => { if (list) blocks.push(list); list = null }
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trimEnd()
      if (line.startsWith('## ')) { flush(); blocks.push({ t: 'h', text: line.slice(3) }) }
      else if (/^[-*] /.test(line)) { if (list?.t !== 'ul') { flush(); list = { t: 'ul', items: [] } } list.items.push(line.slice(2)) }
      else if (/^\d+\. /.test(line)) { if (list?.t !== 'ol') { flush(); list = { t: 'ol', items: [] } } list.items.push(line.replace(/^\d+\. /, '')) }
      else if (!line.trim()) flush()
      else { flush(); const prev = blocks[blocks.length - 1]; if (prev?.t === 'p' && !prev.end) prev.text += ' ' + line; else blocks.push({ t: 'p', text: line }) }
      if (!line.trim() && blocks.length && blocks[blocks.length - 1].t === 'p') blocks[blocks.length - 1].end = true
    }
    flush()
    return html`<div class="${cls('doc', className)}">${blocks.map((b) => b.t === 'h' ? html`<h4>${b.text}</h4>`
      : b.t === 'p' ? html`<p>${inline(b.text)}</p>`
      : b.t === 'ul' ? html`<ul>${b.items.map((x) => html`<li>${inline(x)}</li>`)}</ul>`
      : html`<ol>${b.items.map((x) => html`<li>${inline(x)}</li>`)}</ol>`)}</div>`
  }

  // ---------- Shared handlers ----------
  S.on({
    'ui.scrim': (el, ev) => { if (ev.target === el) S.call(el.dataset.close, el, ev) },
    'ui.info': (el) => S.set(S.ui('p:info'), { id: el.dataset.v }),
    'ui.infoClose': () => S.set(S.ui('p:info'), { id: null }),
    'ui.chartMove': (el, ev) => {
      const g = geo[el.dataset.chart]
      if (!g) return
      const px = ev.clientX - el.getBoundingClientRect().left - g.l
      const i = g.kind === 'line' ? Math.round((px / g.iw) * (g.n - 1)) : Math.floor(px / g.bw)
      const v = Math.max(0, Math.min(g.n - 1, i))
      const hv = hover()
      if (hv[el.dataset.chart] !== v) S.set(hv, { [el.dataset.chart]: v })
    },
    'ui.chartLeave': (el) => S.set(hover(), { [el.dataset.chart]: null }),
    'ui.drawerDrag': (el, ev) => {
      ev.preventDefault()
      const k = el.dataset.dk
      el.setPointerCapture && el.setPointerCapture(ev.pointerId)
      document.body.classList.add('resizing')
      const move = (e) => { drawerW[k] = clampDrawer(window.innerWidth - 12 - e.clientX); S.render() }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        document.body.classList.remove('resizing')
        if (drawerW[k]) S.storage.set(k, String(Math.round(drawerW[k])))
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    'ui.drawerNudge': (el, ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return
      ev.preventDefault()
      const k = el.dataset.dk
      const base = drawerW[k] || el.parentElement.getBoundingClientRect().width || DRAWER_MIN
      drawerW[k] = clampDrawer(base + (ev.key === 'ArrowLeft' ? 40 : -40))
      S.storage.set(k, String(Math.round(drawerW[k])))
      S.render()
    },
    'ui.drawerReset': (el) => { drawerW[el.dataset.dk] = null; S.storage.set(el.dataset.dk, null); S.render() },
  })

  Object.assign(S, { icon, modal, drawer, tabs, seg, infoTip, kpiShell, kpi, slaPill, prio, toasts, ring, lineChart, barChart, hBars, copyText, inline, docText, niceMax, fmtTick })
})()
