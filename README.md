# Scope Lite

Scope Lite is the Scope prototype (Solution Center Hub) rebuilt with only **HTML, CSS and JavaScript**. There's nothing to install: no Node, no npm, no build step. It runs on a standard Windows work laptop by double-clicking a `.bat` file.

It has every page of the main prototype (queue command, ticket explorer, reports, team management, knowledge base, Copilot, account profile) plus a **Suggestions** board where the team files ideas, bugs and workarounds.

All data is generated sample data. ServiceNow and SSO are simulated. The source of truth for the product is still the React prototype ([goated-sc-project](https://github.com/zeandarra-giva/goated-sc-project)). This repo is the workaround version for machines that can't run it.

## Start it

1. Download or clone this folder anywhere (Desktop is fine).
2. Double-click **`run.bat`**.
3. Your browser opens at `http://127.0.0.1:8080`. Pick **Solution Center**. Then go through **Dev Login**: pick your name from the team roster, your role this week (Main Proci, Proci Backup, Weekend Support or Analyst) and today's shift. Leads get the Manager view. Without a roster, or with **Use a sample user instead**, Dev Login signs in as a sample Analyst or Manager.

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

## Queue Management (real team data)

**Queue Management** is the first page that runs on real data, not sample data. It replaces the team's QueueManager tool: load the ServiceNow export, tickets are handed out fairly the moment they load, everyone tracks their own, and anyone can log tickets they handled outside their queue for credit.

1. **Sign in** with your name from the team roster (Dev Login). If Team Management already has your role (Proci rota) and shift (Schedule & coverage) for today, Scope fills them in and you just confirm; otherwise you pick them. Signing in puts you on shift: only people signed in today, and before their cutoff, get tickets. Once signed in you can still **change today's role or shift** from the profile menu, with a reason that the team sees.
2. **Team queue → load the export.** Export the incident list from ServiceNow as CSV and drop it on the page (anyone can; the team does it about every 45 minutes, and the page says when the data is getting old). You see a preview first: new, updated, EERS, and tickets that left the queue. **Load and hand out** then assigns every unassigned ticket:
   - **EERS** tickets (the EERS keywords, by default "EERS", "entitlement", "entitlements") go to today's **Proci Backup**;
   - every other ticket goes to whoever has **handled the fewest tickets today** (tickets that became theirs today plus verified manual entries), highest priority and oldest first;
   - tickets already assigned in ServiceNow are skipped and count for that person;
   - each assignment shows **why** it went to that person. A lead can move a ticket. **Undo this load** takes a load back.
3. **My tickets** is your working view: tag each ticket **Assigned, On Hold, Transferred** (still counts as handled) or **Resolved**, and add notes. Each ticket shows how long it has been untouched against the SLO and SLA.
4. **Log a manual entry** for an INC you handled that wasn't assigned to you: INC number, date and time handled, actions taken, reason. A lead **verifies** it (credited) or **rejects** it with a note; until then you can withdraw it. Leads get **To verify** and **All manual entries** (credit per person, **Export for Excel**). A lead can't verify their own.

**Proci rota** (Team Management → Proci rota): a lead sets who is the Proci each week, and Scope works out every day's Main Proci, Proci Backup, Weekend Support and rest days from it (Monday and Friday Backup = next week's Proci, Tuesday–Thursday = last week's, Friday Main = last week's). Anyone adds their own leave; if the Main Proci is on leave, the Backup moves up and the Proci two weeks ahead becomes Backup. Sign-in preselects your role from the rota, and assignment follows it: EERS goes to the day's Backup, and people on leave get nothing.

**Schedule & coverage** and **Attendance** (Team Management) use the real roster: a lead sets each person's shift (Early or Late) per week, a blank week keeps the last one, and roles come from the Proci rota; coverage per day flags missing shifts and rota gaps. Leave is entered here. Attendance shows today's sign-ins against the schedule (minutes after the shift start are shown, not judged), any role or shift changes with their reasons, and the last 30 days.

**Home** on real data shows the live queue: open incidents (P1, P2, EERS), queue health (share within SLO, past SLO / SLA, backlog), tickets waiting for someone with the import health, who is on shift, today's roles and shifts, tickets per person today, the team queue, a handover summary drafted from the live tickets, and **To verify** for leads. **Roster & access** shows the real roster (edit `data\roster.json` on the host to change it). The **Password vault** tab is hidden on real data: Scope doesn't store secrets.

The header's **ServiceNow import** pill shows the health of the loaded export: Healthy while it's younger than the upload reminder (45 min), Due up to twice that, then Stale, plus open, P1 and waiting counts. Its **Load an export** button opens the Team queue.

**Team settings** (Team Management → Team settings) hold what the whole team follows: SLA/SLO targets for regular INC and EERS, the backlog time, shift times and the cutoff, EERS keywords, whether the Main Proci and the Proci Backup also get regular tickets, the upload reminder and the time zone of the export's dates. Everyone can read them; only a lead can change them, and every change is listed with who and when.

**Privacy:** the import reads the description only to look for EERS keywords and never stores it. Caller names and IDs aren't stored either.

**Setup (once, on the host):** copy `data\roster.example.json` to `data\roster.json` and list the team. For each person give their SOEID, name (as it appears in ServiceNow's *assigned to*), `accessRole` (`Lead` or `Analyst`) and `active` (set it to `false` when someone leaves; their history stays). Queue Management needs the server, so it doesn't work when `index.html` is opened directly.

Everything is saved in `data\ops.jsonl`, the team's shared operations log. Back it up together with `suggestions.jsonl`. Real data never goes into git: `roster.json`, `ops.jsonl` and anything in `data\inbox\` are ignored, because this repository is public. To try the import without real data, `node tools/make-sample-incidents.mjs` writes a made-up export to `data/inbox/`.

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
js/pages/               one file per page (home-live.js: Home on real team data)
js/suggest.js           Suggestions board
js/qm.js                Queue Management page, ops log, sign-in identity, manual INC entries
js/queue.js             ServiceNow import, automatic assignment, My tickets, team settings
js/rota.js              Proci rota: weekly Proci list → daily roles, leave and succession
js/schedule.js          real Schedule & coverage, Attendance, sign-in auto-fill, guarded role/shift change
tools/                  check.mjs (headless-Chrome check), make-sample-incidents.mjs (fake export)
js/app.js               shell: workspace picker, sign-in, sidebar, header, notifications
data/                   suggestions.jsonl, ops.jsonl, roster.json (real data, never committed)
```

To change something, edit the file and reload the browser. [docs/CONVENTIONS.md](docs/CONVENTIONS.md) explains the patterns: templates, state, events, overlays. [docs/PORTING.md](docs/PORTING.md) maps each prototype file to its Scope Lite file. [docs/ACCESS-MIGRATION.md](docs/ACCESS-MIGRATION.md) is the plan for moving the data store to Microsoft Access.

On a Mac or Linux machine with PowerShell 7 installed, run `pwsh server.ps1`. Or open `index.html` directly to run in browser-only mode.

### Suggestions API

`server.ps1` serves the folder and two endpoints:

| | |
|---|---|
| `GET /api/events` | every suggestion event, as a JSON array of `{ at, e }` |
| `POST /api/events` | append one event: `create`, `vote`, `status` or `comment` |
| `GET /api/roster` | the team roster from `data/roster.json` |
| `GET /api/ops` | every operations event, as `{ seq, at, by, e }` |
| `POST /api/ops` | append one event: `shiftStart`, `ticketsImported`, `ticketsAssigned`, `ticketTag`, `ticketNote`, `importUndo`, `leaveAdd`, `leaveCancel`, `rotaSet` and `shiftPlanSet` (leads only), `manualIncAdd`, `manualIncWithdraw`, `manualIncDecide` (leads only) or `settingsSet` (leads only). The sender (`by`) must be on the active roster; the server adds `seq` and `at` |

Events are only ever appended. The board's current state is computed from them in the browser (`js/suggest.js`), so the file doubles as a full history.
