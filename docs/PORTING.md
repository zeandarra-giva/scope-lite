# Port map: React prototype → Scope Lite

Source: `../goated-sc-project/src` (read-only reference). Target: this repo.

| React source | Scope Lite file | Registers |
|---|---|---|
| `pages/Home.jsx` | `js/pages/home.js` | `S.pages.home`, `S.queueMetrics` |
| `components/Workspace.jsx` | `js/components/workspace.js` | `S.assist(desc, hintCode, excludeId)` (was `useAssist`), `S.resolutionAssist(ticket, { compact })`, `S.ticketWorkspace(ticket, { onResolve })`, `S.resolveModal(ticket, { onClose })` |
| `pages/ShiftCalendar.jsx` | `js/pages/shift-calendar.js` | `S.shiftCalendar(initial)`, `S.weekPreview({ onOpen })`, `S.MIN`, `S.coverage` |
| `pages/Team.jsx` | `js/pages/team.js` | `S.pages.team`, `S.ACCESS` |
| `pages/Settings.jsx` | `js/pages/settings.js` | `S.pages.settings` |
| `components/Tour.jsx` | `js/components/tour.js` | `S.Tour()` (called by app.js while `S.state.tour` is true) |
| `pages/Explorer.jsx` | `js/pages/explorer.js` | `S.pages.explorer` |
| `pages/Reports.jsx` | `js/pages/reports.js` | `S.pages.reports` |
| `pages/KnowledgeBase.jsx` | `js/pages/knowledge-base.js` | `S.pages.kb` |
| `pages/Copilot.jsx` | `js/pages/copilot.js` | `S.pages.copilot`, `S.canUseCopilot(state)`, `S.copilotAsk` (was `useCopilotAsk`), `S.copilotChat(...)`, `S.insightCard(ins, { onAsk })`, `S.insightsPanel()`, `S.copilotDrawer({ insight, ticketId, onClose })` |

Callbacks that were props (`onOpen`, `onResolve`, `onClose`, `onAsk`) become **action names** (strings) registered with `S.on`, plus any `data-*` values the callee puts on the element.

Already done: `App.jsx` and `SignIn.jsx` and `DevTools.jsx` → `js/app.js`; `ui.jsx` and `Doc.jsx` → `js/components/ui.js`; `store.jsx` → `js/store.js`; `data.js`, `kb.js`, `analytics.js`, `copilot.js`, `workspaces.js` → `js/data/