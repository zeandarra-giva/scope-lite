// Scope Lite core: a small render loop in plain JavaScript, no build step.
//
// Pages and components are functions that return markup built with S.html``.
// Any change (S.dispatch, S.set) calls S.render(), which rebuilds the markup
// and patches the live DOM in place (morph), so focus, caret and scroll survive.
// Events are delegated: markup says data-click="name" and S.on registers name.
// See docs/CONVENTIONS.md for the full pattern.
window.S = window.S || {}
S.pages = S.pages || {}
;(function () {
  // ---------- Markup ----------
  class Raw { constructor(s) { this.s = s } toString() { return this.s } }
  const raw = (s) => new Raw(s == null ? '' : String(s))
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c])
  // null, undefined and false render nothing (so `cond && html\`…\`` works like JSX);
  // true renders "true" (for aria-pressed="${on}"); arrays are joined; plain
  // strings are escaped; S.html results and S.raw values pass through.
  const val = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : esc(v))
  function html(strings, ...vals) {
    let out = strings[0]
    for (let i = 0; i < vals.length; i++) out += val(vals[i]) + strings[i + 1]
    return new Raw(out)
  }
  // Class list from strings and falsy values: S.cls('btn', active && 'on')
  const cls = (...xs) => xs.filter(Boolean).join(' ')
  // Inline style from an object. Numbers get px, except unitless properties.
  const UNITLESS = new Set(['opacity', 'flex', 'flexGrow', 'flexShrink', 'zIndex', 'fontWeight', 'lineHeight', 'order'])
  const style = (o) => Object.entries(o)
    .filter(([, v]) => v != null && v !== false && v !== '')
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}:${typeof v === 'number' && !UNITLESS.has(k) ? v + 'px' : v}`)
    .join(';')
  // Attributes from an object: true → bare attribute, null/false → left out.
  const attrs = (o) => raw(Object.entries(o)
    .filter(([, v]) => v != null && v !== false)
    .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`))
    .join(' '))
  // JSON for a data attribute, read back with S.arg(el)
  const json = (v) => raw(esc(JSON.stringify(v)))
  const arg = (el) => { try { return JSON.parse(el.dataset.arg) } catch { return null } }

  // ---------- Local UI state ----------
  // S.ui(key, init) is the plain-JS useState: one object per key, created once.
  // Keys starting with "p:" belong to the current page and reset on navigation.
  const uiStore = {}
  function ui(key, init = {}) {
    if (!uiStore[key]) uiStore[key] = typeof init === 'function' ? init() : { ...init }
    return uiStore[key]
  }
  const set = (obj, patch) => { Object.assign(obj, typeof patch === 'function' ? patch(obj) : patch); render() }
  const resetUi = (prefix) => { for (const k of Object.keys(uiStore)) if (k.startsWith(prefix)) delete uiStore[k] }

  // ---------- Events ----------
  const handlers = {}
  function on(name, fn) {
    if (typeof name === 'object') { for (const k in name) handlers[k] = name[k]; return }
    handlers[name] = fn
  }
  const call = (name, el, ev) => {
    const fn = handlers[name]
    if (!fn) { console.warn('[scope] no handler for', name); return }
    fn(el, ev)
  }
  // Bubbling events look up the closest element carrying data-<type>.
  const BUBBLING = ['click', 'dblclick', 'input', 'change', 'submit', 'keydown', 'mousemove', 'mousedown', 'pointerdown', 'dragstart', 'dragover', 'dragleave', 'drop', 'dragend', 'focusin']
  BUBBLING.forEach((type) => document.addEventListener(type, (ev) => {
    const el = ev.target.closest && ev.target.closest(`[data-${type}]`)
    if (!el) return
    if (type === 'submit') ev.preventDefault()
    call(el.dataset[type], el, ev)
  }))
  // mouseleave doesn't bubble, so listen in the capture phase on the element itself.
  document.addEventListener('mouseleave', (ev) => {
    const el = ev.target
    if (el.dataset && el.dataset.mouseleave) call(el.dataset.mouseleave, el, ev)
  }, true)

  // Popovers: one open at a time, closed by clicking outside its anchor or Escape.
  // Anchor markup: <div data-pop-anchor="notif"> … </div>; open check: S.pop === 'notif'.
  S.pop = null
  const togglePop = (name) => { S.pop = S.pop === name ? null : name; render() }
  const closePop = () => { if (S.pop) { S.pop = null; render() } }
  document.addEventListener('mousedown', (ev) => {
    if (S.pop && !(ev.target.closest && ev.target.closest(`[data-pop-anchor="${S.pop}"]`))) closePop()
  })
  // Escape closes the open popover, else the top-most overlay that has data-esc.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return
    if (S.pop) { closePop(); return }
    const all = document.querySelectorAll('[data-esc]')
    const top = all[all.length - 1]
    if (top) call(top.dataset.esc, top, ev)
  })

  // ---------- Overlays (the plain-JS portal) ----------
  // Modals and drawers are collected during a render and placed in one layer
  // at the end of the app, so no card or scroll container can clip them.
  let overlays = []
  const overlay = (markup) => { overlays.push(val(markup)); return '' }
  const takeOverlays = () => { const o = overlays.join(''); overlays = []; return raw(o) }

  // ---------- Measured widths (for SVG charts) ----------
  // Markup: <div data-w="chartId">; read: S.width('chartId', 600).
  const widths = {}
  const width = (key, fallback = 600) => widths[key] || fallback
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => {
    let changed = false
    for (const e of entries) {
      const k = e.target.dataset.w
      const w = Math.round(e.contentRect.width)
      if (k && w && widths[k] !== w) { widths[k] = w; changed = true }
    }
    if (changed) render()
  }) : null
  const observed = new WeakSet()

  // ---------- DOM morph ----------
  const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') || n.id || null : null)
  const same = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && (a.tagName !== 'INPUT' || a.type === b.type)))

  function syncAttrs(from, to) {
    for (const a of Array.from(from.attributes)) if (!to.hasAttribute(a.name)) from.removeAttribute(a.name)
    for (const a of Array.from(to.attributes)) if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value)
  }
  // Form values: only write when the rendered value changed since the last
  // render, so typing ahead of a re-render is never overwritten.
  function syncValue(from, rendered) {
    if (from._rv !== rendered) { from._rv = rendered; if (from.value !== rendered) from.value = rendered }
  }
  function morphEl(from, to) {
    syncAttrs(from, to)
    const tag = from.tagName
    if (tag === 'INPUT') {
      if (from.type === 'checkbox' || from.type === 'radio') from.checked = to.hasAttribute('checked')
      else if (from.type !== 'file') syncValue(from, to.getAttribute('value') || '')
      return
    }
    if (tag === 'TEXTAREA') { syncValue(from, to.value); return }
    morphChildren(from, to)
    if (tag === 'SELECT') {
      const opt = Array.from(to.options).find((o) => o.hasAttribute('selected')) || to.options[0]
      syncValue(from, opt ? opt.value : '')
    }
  }
  function update(from, to) {
    if (from.nodeType === 1) morphEl(from, to)
    else if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue
  }
  function morphChildren(fromParent, toParent) {
    const keyed = new Map()
    for (let c = fromParent.firstChild; c; c = c.nextSibling) { const k = keyOf(c); if (k) keyed.set(k, c) }
    const newKeys = new Set()
    for (let c = toParent.firstChild; c; c = c.nextSibling) { const k = keyOf(c); if (k) newKeys.add(k) }
    let cur = fromParent.firstChild
    let next = toParent.firstChild
    while (next) {
      const after = next.nextSibling
      // Drop old keyed nodes that no longer exist, so position matching can continue.
      while (cur && keyOf(cur) && !newKeys.has(keyOf(cur))) { const n = cur.nextSibling; fromParent.removeChild(cur); cur = n }
      const k = keyOf(next)
      let match = null
      if (k) { const m = keyed.get(k); if (m && same(m, next)) { match = m; keyed.delete(k) } }
      else if (cur && !keyOf(cur) && same(cur, next)) match = cur
      if (match) {
        if (match === cur) cur = cur.nextSibling
        else fromParent.insertBefore(match, cur)
        update(match, next)
      } else {
        fromParent.insertBefore(next, cur)
      }
      next = after
    }
    while (cur) { const n = cur.nextSibling; fromParent.removeChild(cur); cur = n }
  }

  // ---------- Render loop ----------
  let queued = false
  let rootEl = null
  function render() {
    if (queued) return
    queued = true
    requestAnimationFrame(flush)
  }
  function flush() {
    queued = false
    if (!rootEl) rootEl = document.getElementById('root')
    overlays = []
    let markup
    try { markup = val(S.App()) } catch (err) {
      console.error(err)
      markup = `<div class="callout crit" style="margin:24px"><b>Something broke while drawing this page.</b> ${esc(err.message)}. Reload the page; if it keeps happening, file it as a bug.</div>`
    }
    const tmp = document.createElement('div')
    tmp.innerHTML = markup
    morphChildren(rootEl, tmp)
    afterRender()
  }
  function afterRender() {
    if (ro) rootEl.querySelectorAll('[data-w]').forEach((el) => {
      if (observed.has(el)) return
      observed.add(el)
      ro.observe(el)
      const w = Math.round(el.getBoundingClientRect().width)
      if (w && widths[el.dataset.w] !== w) { widths[el.dataset.w] = w; render() }
    })
    // data-autofocus focuses an element once, the first time it appears.
    const af = rootEl.querySelector('[data-autofocus]')
    if (af && !af._af) { af._af = true; af.focus(); if (af.select && af.dataset.autofocus === 'select') af.select() }
    afterHooks.forEach((fn) => fn())
  }
  // Code that must run after the DOM is patched (scroll a list, measure, etc.)
  const afterHooks = []
  const after = (fn) => afterHooks.push(fn)

  // ---------- Small helpers ----------
  const storage = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v } catch { return d } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* storage blocked */ } },
  }
  let seq = 0
  const uid = (p = 'id') => `${p}${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`

  Object.assign(S, {
    html, raw, esc, cls, style, attrs, json, arg,
    ui, set, resetUi, on, call, togglePop, closePop,
    overlay, takeOverlays, width, render, flush, after, storage, uid,
    isRaw: (v) => v instanceof Raw,
  })
})()
