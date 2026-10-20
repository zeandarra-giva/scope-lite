# How Scope Lite code is written

Scope Lite is the React prototype (`goated-sc-project`) rebuilt with plain HTML, CSS and JavaScript. It has no build step, no npm and no framework. Edit a file, then reload the browser.

## Files and load order

`index.html` loads classic `<script>` files in order (not ES modules, so it also opens straight from disk). Every file is an IIFE that reads what it needs from the global `S` and adds its exports back onto `S`.

```
js/lib/core.js          S.html, morph/render loop, events, S.ui state, overlays, widths
js/data/*.js            sample data and rules, ported 1:1 (data, workspaces, analytics, kb, copilot)
js/store.js             S.state, S.dispatch (same reducer as src/store.jsx), S.currentUser, S.buildNotifications
js/components/ui.js     S.icon, S.modal, S.drawer, S.tabs, S.seg, S.infoTip, S.kpi, S.kpiShell, S.slaPill,
                        S.prio, S.ring, S.lineChart, S.barChart, S.hBars, S.copyText, S.docText, S.inline
js/components/*.js      bigger shared pieces (workspace.js, tour.js)
js/pages/*.js           one file per page; each sets S.pages.<id> = (route) => markup
js/suggest.js           Suggestions board + "Suggest" modal
js/app.js               shell: workspace picker, sign-in, sidebar, header, notifications, dev controls, S.nav
```

## Rendering

Components are plain functions that return markup from the `S.html` tagged template:

```js
const { html, cls, attrs, icon } = S

function analystChip(a, selected) {
  return html`<button class="${cls('chip', selected && 'on')}" data-click="team.pick" data-v="${a.id}">
    ${icon('user', 14)}${a.name}
    ${a.status === 'online' && html`<span class="dot live"></span>`}
  </button>`
}
```

- Interpolated strings are **escaped**. Nested `html` results, `S.raw(...)` and arrays of them pass through. Never build markup with plain string concatenation from user text.
- Like JSX: `null`, `undefined` and `false` render nothing, so `cond && html\`…\`` works. `true` renders `"true"`, so `aria-pressed="${on}"` works. Numbers render as numbers (`0` renders "0", same as JSX, so prefer `n > 0 &&`).
- Conditional attributes: `${attrs({ disabled: busy, 'aria-current': on ? 'page' : null, checked: done })}` (true → bare attribute, null or false → left out).
- Inline styles: `style="${S.style({ width: 120, opacity: 0.5 })}"` or a literal `style="width:120px"`. React's `style={{ ... }}` becomes CSS text: camelCase → kebab-case, numbers → px.
- `className` → `class`, `htmlFor` → `for`, `strokeWidth` → `stroke-width` (SVG attributes use their real names), `onClick` → `data-click`, etc.
- Lists: React `key` → `data-key="${id}"` on the repeated element when items can be reordered, added or removed (it keeps focus and scroll on the right element).

Every change re-renders the whole app (`S.render()`, batched to one per frame). The result is patched into the live DOM (morph), so typing, focus and scroll survive. Rendering is cheap; don't optimise.

## State

| React | Scope Lite |
|---|---|
| `const { state, dispatch } = useStore()` | `S.state`, `S.dispatch(action)` (same action names as `src/store.jsx`) |
| `const [x, setX] = useState(init)` in a page | `const u = S.ui('p:home', { tab: 'queue', sel: null })` then `S.set(u, { tab: 'x' })` |
| `useState` in a component used once | `S.ui('p:home:drawer', {...})`: any unique key |
| `useState` in a component shown many times | key it by id: `S.ui('p:explorer:row:' + t.id, {...})` |
| `useMemo` | just compute it during render |
| `useEffect` on mount / change | do it in the handler that causes the change, or `S.after(fn)` (runs after every render; guard it yourself) |
| `setInterval`/`setTimeout` | plain timers that call `S.dispatch` or `S.set` |
| `useNav()` → `nav(page, opts)` | `S.nav(page, opts)`; current route is `S.route` (`{ page, tab, ticket, approval, … }`) |
| `currentUser(state)` | `S.currentUser(S.state)` |

`S.ui` keys that start with `p:` are page-local: they reset when you navigate (React remounts pages on navigation). Initialise page state from the route the first time: `S.ui('p:team', () => ({ tab: S.route.tab || 'roster' }))`.

Typing in an input: handle `data-input`, store the value, and only call `S.render()` (or `S.set`) if something else on screen depends on it. The input keeps its own value; the morph won't overwrite what the user is typing.

## Events

Markup names an action; a handler is registered once per file with `S.on`:

```js
S.on({
  'team.pick': (el) => S.set(S.ui('p:team'), { sel: el.dataset.v }),
  'team.search': (el) => S.set(S.ui('p:team'), { q: el.value }),
  'team.save': (el, ev) => { /* data-submit already called preventDefault */ },
})
```

- Attributes: `data-click`, `data-dblclick`, `data-input`, `data-change`, `data-submit` (on `<form>`), `data-keydown`, `data-mousedown`, `data-pointerdown`, `data-mousemove`, `data-mouseleave`, `data-dragstart`, `data-dragover`, `data-drop`, `data-dragend`, `data-focusin`.
- **Name actions `<file>.<what>`** (`home.rebalance`, `kb.publish`) so files never clash.
- Pass values with `data-v="${id}"` (read `el.dataset.v`), other `data-*` attributes, or `data-arg="${S.json(obj)}"` read back with `S.arg(el)`.
- The **closest** element with `data-click` wins, so a button inside a clickable row does not also trigger the row (no `stopPropagation` needed).
- Handlers can be async.

## Overlays, popovers, Escape

- `S.modal({ title, sub, body, footer, wide, onClose: 'home.closeResolve' })` and `S.drawer({ title, sub, body, actions, className, onClose })` register an overlay and return `''`. Call them during render when the thing is open. `onClose` is an action name; Escape and clicking the scrim call it.
- Any element with `data-esc="action"` closes on Escape (the last one in the page wins).
- Popovers: wrap the anchor and its panel in `<div data-pop-anchor="name">`, toggle with `S.togglePop('name')`, check `S.pop === 'name'`. A click outside or Escape closes it.
- `data-autofocus` focuses an element the first time it appears (`data-autofocus="select"` also selects its text).

## Charts

`S.lineChart(id, {...})`, `S.barChart(id, {...})`: same props as the React versions plus a unique `id` (it keys the measured width and the hover state). `S.hBars({ rows, …, onClick: 'reports.drill' })` puts the row label in `el.dataset.v`.

## Copy the React file faithfully

- Keep the copy, behaviour, class names, `data-tour` attributes and the order of things exactly as in the React file. `css/styles.css` is copied unchanged, so the same classes give the same look.
- Keep the source's comments (adjusted where they mention React).
- Shared exports are listed in the table in `docs/PORTING.md`. Use those names so files can call each other.
- New CSS goes at the end of `css/lite.css`, only if the React version used inline styles that can't be expressed inline here.
