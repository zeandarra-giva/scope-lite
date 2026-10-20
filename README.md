# Scope Lite

Scope Lite is the Scope prototype (Solution Center Hub) rebuilt with only **HTML, CSS and JavaScript**. There's nothing to install: no Node, no npm, no build step. It runs on a standard Windows work laptop by double-clicking a `.bat` file.

It has every page of the main prototype (queue command, ticket explorer, reports, team management, knowledge base, Copilot, account profile) plus a **Suggestions** board where the team files ideas, bugs and workarounds.

All data is generated sample data. ServiceNow and SSO are simulated. The source of truth for the product is still the React prototype ([goated-sc-project](https://github.com/zeandarra-giva/goated-sc-project)). This repo is the workaround version for machines that can't run it.

## Start it

1. Download or clone this folder anywhere (Desktop is fine).
2. Double-click **`run.bat`**.
3. Your browser opens at `http://127.0.0.1:8080`. Pick **Solution Center**, choose a role, then **Dev Login**.

### Roles

- **Analyst:** their own queue and tools. Analysts can send suggestions with the **Suggest** button but don't see the Suggestions board.
- **Manager:** everything an analyst has, plus the whole-team view, the **Suggestions** board and the **Dev** prototype controls.

To switch roles, log out from the profile menu and sign in again.

Keep the black window open while you use Scope. Closing it stops Scope.

### Share one Suggestions board with the team

One person (say, the manager) double-clicks **`share.bat`** instead. The window prints a team link like `http://10.20.30.40:8080/`. Send that link to the team: everyone who opens it files into the same list, and it refreshes every 15 seconds.

- All suggestions are saved on the host's computer in `data\suggestions.jsonl`. Copy that file to back them up.
- If teammates can't open the link, Windows Firewall is blocking the port. Ask IT to allow it, or use the export and import option below.

### If the .bat file won't start

Some laptops block PowerShell scripts. When that happens, `run.bat` opens `index.html` directly instead. Everything still works, but suggestions are saved **in that browser only**. Use **Export backup** on the Suggestions page and send the file to whoever hosts the shared board. They then use **Import backup**, and duplicates are skipped.

## Filing a suggestion

Click **Suggest** (in the sidebar, on every page). Managers can also go to **Suggestions** in the sidebar.

1. Pick what it is:
   - **Idea:** something Scope should do or do better
   - **Bug:** something that looks or works wrong
   - **Workaround:** a fix or trick that got a ticket resolved; you can tag the business app and the ticket or resolution code
2. Write a one-line title. Details are optional.
3. Press **Send suggestion** (or <kbd>Ctrl</kbd> + <kbd>Enter</kbd>).

The page you were on is filled in automatically. Your name is remembered on that computer; leave it empty to post as Anonymous.

Managers can vote, comment, move a suggestion through **New → Reviewing → Planned → Done** (or **Won't do**), filter and search, and use **Export for Excel** to bring the list to a meeting.

## Prototype controls

Managers get the **Dev** button (bottom right, or <kbd>Shift</kbd> + <kbd>Alt</kbd> + <kbd>D</kbd>). It starts the onboarding tour, simulates ServiceNow intake and resets the sample data. These controls are not part of the product.

## For developers

```
run.bat / share.bat     start server.ps1 (local only / office network)
server.ps1              tiny web server in built-in Windows PowerShell; stores suggestions
index.html              loads the scripts below in order
css/                    styles.css (copied unchanged from the prototype), lite.css (additions), fonts.css
fonts/                  Geist and Geist Mono, bundled so no internet is needed
js/lib/core.js          render loop, html templates, events, local UI state
js/data/                sample data and business rules, ported 1:1 from the prototype
js/store.js             app state and actions (same reducer as the prototype)
js/components/          shared UI: icons, modals, drawers, charts, ticket workspace, tour
js/pages/               one file per page
js/suggest.js           Suggestions board
js/app.js               shell: workspace picker, sign-in, sidebar, header, notifications
data/                   suggestions.jsonl (created on first run, not committed)
```

To change something, edit the file and reload the browser. [docs/CONVENTIONS.md](docs/CONVENTIONS.md) explains the patterns: templates, state, events, overlays. [docs/PORTING.md](docs/PORTING.md) maps each prototype file to its Scope Lite file.

On a Mac or Linux machine with PowerShell 7 installed, run `pwsh server.ps1`. Or open `index.html` directly to run in browser-only mode.

### Suggestions API

`server.ps1` serves the folder and two endpoints:

| | |
|---|---|
| `GET /api/events` | every suggestion event, as a JSON array of `{ at, e }` |
| `POST /api/events` | append one event: `create`, `vote`, `status` or `comment` |

Events are only ever appended. The board's current state is computed from them in the browser (`js/suggest.js`), so the file doubles as a full history.
