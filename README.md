# Scope Lite

Scope Lite is the Scope prototype (Solution Center Hub) rebuilt with only **HTML, CSS and JavaScript**. There's nothing to install: no Node, no npm, no build step. It runs on a standard Windows work laptop by double-clicking a `.bat` file.

It has every page of the main prototype (queue command, ticket explorer, reports, team management, knowledge base, Copilot, account profile) plus a **Suggestions** board where the team files ideas, bugs and workarounds.

All data is generated sample data. ServiceNow and SSO are simulated. The source of truth for the product is still the React prototype ([goated-sc-project](https://github.com/zeandarra-giva/goated-sc-project)). This repo is the workaround version for machines that can't run it.

## Start it

1. Download or clone this folder anywhere (Desktop is fine).
2. Double-click **`run.bat`**.
3. Your browser opens at `http://127.0.0.1:8080`. Scope opens straight into **Solution Center** (the workspace picker is off for now). Select your name from the team roster and sign in. Your role (Proci rota) and shift (Schedule & coverage) come from Team Management, so there's nothing to pick. Leads get the Manager view. Without the server or a roster, Scope can't sign anyone in.

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

**Queue Management** is the first page that runs on real data, not sample data. It replaces the team's QueueManager tool: load the ServiceNow export, tickets are handed out fairly the moment they load, everyone tracks their own, and anyone can log tickets they handled outside their queue for credit. **Home** is the team's view: queue health, loading the export (**Load ServiceNow export**, top right), tickets per person, the week's schedule, and the team tabs (Team queue, Shift handover, and for leads To verify and All manual entries). **Queue Management** is your own work (My tickets, and My manual entries with a **Log a manual entry** button that opens the form from the right), with who is on shift shown as circles beside the title.

1. **Sign in** with your name from the team roster. Today's role and shift come from Team Management (the Proci rota and Schedule & coverage); signing in puts you on shift, and only people on shift today, before their cutoff, get tickets. If Team Management has no shift for you today (or it's your rest day or leave), you're signed in but not on shift; use **Start today's shift** in the profile menu if you're working anyway. Once on shift you can still **change today's role or shift** from the profile menu, with a reason that the team sees.
2. **Home → load the export.** Export the incident list from ServiceNow as CSV and drop it in Home's **Load ServiceNow export** (top right) or on the header's ServiceNow import pill (anyone can; the team does it about every 45 minutes, and the page says when the data is getting old). You see a preview first: new, updated, EERS, and tickets that left the queue. **Load and hand out** then assigns every unassigned ticket:
   - **EERS** tickets (the EERS keywords, by default "EERS" and "#EERS") go to today's **Proci Backup**;
   - every other ticket goes to whoever has **handled the fewest tickets today** (tickets that became theirs today plus verified manual entries), highest priority and oldest first;
   - ServiceNow's *assigned to* doesn't decide anything: every ticket in the export is shared out (the analyst reassigns it in ServiceNow to match);
   - each assignment shows **why** it went to that person. Anyone can move a ticket to someone else from the owner dropdown in Home → Team queue (or the ticket drawer); every move is logged with who did it. **Undo this load** takes a load back.
3. **My tickets** (Queue Management) is your working view: the tickets still Assigned to you, longest untouched first. Set each one's **status** from the dropdown: **On Hold** (waiting on the user) moves it to the **3-Strike** queue, **Transferred** takes it off your list (still counts as handled), and **Resolved** opens the resolution journey first. Home's **Team queue** lists everyone's, and **Shift handover** drafts a summary to copy.
   - **3-Strike:** Home → 3-Strike lists every On Hold ticket with its strike (read from Scope's log and "Contact attempt1/2/3" in the short description). Each day Scope suggests who makes each due attempt, spread evenly over everyone on shift; the **Proci Backup** (Weekend Support at the weekend, or a lead) adjusts it and clicks **Approve distribution**. Each analyst then works their attempts in Queue Management → **3-Strike**: **Reached** sends the ticket back to its owner, **Not reached** logs the strike, and Strike 3 not reached tags it Resolved (set it Resolved in ServiceNow too). Until the team confirms Q19, the first attempt is due the day after the ticket goes On Hold and nothing is due at the weekend.
4. **Log a manual entry** (Queue Management → My manual entries) for an INC you handled that wasn't assigned to you: INC number, date and time handled, actions taken, reason. A lead **verifies** it (credited) or **rejects** it with a note; until then you can withdraw it. Leads get **To verify** and **All manual entries** on Home (credit per person, **Export for Excel**). A lead can't verify their own.

**Proci rota** (Team Management → Schedule & coverage): the rows of the shift grid are the **Proci queue** (round robin). Out of the box it is the active roster in `roster.json` order, starting the week of 9 Nov 2026 and counted backwards too (so last week's Proci is known); a lead drags the rows into another order and saves it from a chosen week; every week then takes the next person in the row.

**Shifts** need no setup: each weekday Scope plans everyone working as Early, with one person rotating onto Late each day, so the minimums in Team settings (**at least 2 on Early, 1 on Late**) are met. A lead can set someone's shift for a week (it carries forward). **Anyone can change their own shift for any day** in the shift grid (pick Early or Late, click your day); Scope refuses a change that would leave the day under the minimums, and a lead can override. Days below the minimums show as short and go to the bell. A single week can be swapped with the next (e.g. when that week's Proci is on leave all week) or set on the month calendar without shifting anyone else, and Scope works out every day's Main Proci, Proci Backup, Weekend Support and rest days from it (Monday and Friday Backup = next week's Proci, Tuesday–Thursday = last week's, Friday Main = last week's). Anyone adds their own leave by picking themselves and clicking the first and last day; if the Main Proci is on leave, the Backup moves up and the Proci two weeks ahead becomes Backup. Sign-in preselects your role from the rota, and assignment follows it: EERS goes to the day's Backup, and people on leave get nothing.

**Schedule calendar** (top of Schedule & coverage): the month view of every day's roles (Main, Backup, Weekend Support), who is on leave and how many are on Early and Late. Leads set a week's Proci or add leave in one click; click a week's Proci bar to see its Backups and swap it with the next week. **Rota gaps, missing shifts, a Proci's leave in their week, and schedule changes by others go to the bell**, not onto the page.

**Equal distribution** (Home → Tickets per person today): new tickets go out automatically to whoever has handled the fewest today, among **everyone scheduled to work today** (a shift in Team Management, not on leave or a rest day), signed in or not (EERS to the Proci Backup), as soon as they load (Team settings → "Hand out new tickets automatically"). Scope **evens things out by itself**: when someone has 2 or more tickets more than someone else today, untouched tickets (still Assigned, not updated in ServiceNow since Scope gave them out) move to whoever has the fewest. The **Rebalance** button (anyone) does the same on demand; every move records its reason.

**Resolution journey** (any ticket drawer → Resolve with code): the five-step journey gives the ticket a resolution code (CAUSE-SUB-NN) saved with the Resolved tag, and copies the notes for ServiceNow. The code library grows from the team's own resolutions; the root-cause categories and breach reasons are still the prototype's.

**Schedule & coverage** and **Attendance** (Team Management) use the real roster. Every person × day is a cell. Click a day to change it: a small menu offers Early, Late, On leave or Back to the week's shift (a day changed on its own is marked with a dot); a lead's menu also sets a whole week (a blank week keeps the last one). Roles come from the Proci rota; coverage per day flags missing shifts and rota gaps. Attendance shows today's sign-ins against the schedule (minutes after the shift start are shown, not judged), any role or shift changes with their reasons, and the last 30 days.

**Home** on real data is for watching the queue: open incidents (P1, P2, EERS), queue health (share within SLO, past SLO / SLA, backlog), tickets waiting for someone, who is on shift, loading the ServiceNow export (with how old the data is), and, under the cards, two columns: the team tabs on the left (Team queue, Shift handover, To verify, All manual entries) and, stacked on the right, **Today's schedule** (every member, signed in or not, with today's role and shift as tags) and **Tickets per person today** (per person: assigned today, how many of those are done, everything still open on them, with **Rebalance**). **Roster & access** shows the real roster (edit `data\roster.json` on the host to change it). The **Password vault** tab is hidden on real data: Scope doesn't store secrets.

The header's **ServiceNow import** pill shows the health of the loaded export: Healthy while it's younger than the upload reminder (45 min), Due up to twice that, then Stale, plus open, P1 and waiting counts. Drop a CSV on it to load it on Home; **Open Team queue** goes to Home's Team queue.

**Monthly report** (Reports, on real data): tickets received per day, the average per day and how they were spread across the team; per person received, handled (Resolved + Transferred + verified manual entries), transferred, EERS, manual entries, 3-Strike attempts, days worked, tickets per day worked and days as Main / Backup / Weekend Support. **Export for Excel**. A lead can import QueueManager's end-of-day history (CSV exports of `tbl_EODReports`, `tbl_DaySessions` and `tbl_Members`) so earlier months aren't empty.

**Upload reminder:** once the loaded export is older than the reminder in Team settings, the bell tells today's Proci Backup (Weekend Support at the weekend) and the leads; once it's twice that (Stale), everyone.

**Team settings** (Team Management → Team settings) hold what the whole team follows: SLA/SLO targets for regular INC and EERS, the backlog time, shift times and the cutoff, EERS keywords, whether the Main Proci and the Proci Backup also get regular tickets, the upload reminder and the time zone of the export's dates. Everyone can read them; only a lead can change them, and every change is listed with who and when.

**Privacy:** the import reads the description only to look for EERS keywords and never stores it. Caller names and IDs aren't stored either.

**Setup (once, on the host):** copy `data\roster.example.json` to `data\roster.json` and list the team. For each person give their SOEID, name (as it appears in ServiceNow's *assigned to*), `accessRole` (`Lead` or `Analyst`) and `active` (set it to `false` when someone leaves; their history stays). Queue Management needs the server, so it doesn't work when `index.html` is opened directly.

Everything is saved in `data\ops.jsonl`, the team's shared operations log. Back it up together with `suggestions.jsonl`. Real data never goes into git: `roster.json`, `ops.jsonl` and anything in `data\inbox\` are ignored, because this repository is public. **To try the import without real data**, drop `samples/incident-mock-export.csv` on Home. It's a mock ServiceNow incident export shaped exactly like the real one (same columns, templates, `<br>` breaks, escaped pipes, Spanish tickets, EERS and On Hold tickets), but every person, ID, group, site and link is invented. Run `node tools/make-mock-export.mjs` to regenerate it with fresh dates. `node tools/make-sample-incidents.mjs` writes a smaller edge-case file to `data/inbox/` for testing. For UI/UX testing, `node tools/make-inbox-mock.mjs` writes a fuller mock to `data/inbox/`, modelled row by row on a real export: `incident-inbox-1.csv` (the queue an hour ago) and `incident-inbox-2.csv` (now, with some tickets closed, updated and new) to try a re-import. Tickets already assigned in ServiceNow use the names in your local `roster.json`.

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
js/strike.js            3-Strike: the On Hold follow-up queue, daily distribution and attempts
js/report-live.js       monthly transparency report and the QueueManager history import
js/rota.js              Proci rota: weekly Proci list → daily roles, leave and succession
js/schedule.js          real Schedule & coverage, Attendance, sign-in auto-fill, guarded role/shift change
tools/                  check.mjs (headless-Chrome check), make-mock-export.mjs, make-sample-incidents.mjs (fake exports)
samples/                incident-mock-export.csv: a mock ServiceNow export to try the import
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
| `POST /api/ops` | append one event: `shiftStart`, `ticketsImported`, `ticketsAssigned`, `ticketTag`, `ticketNote`, `importUndo`, `leaveAdd`, `leaveCancel`, `rotaSet`, `rotaOrderSet`, `shiftPlanSet` and `shiftDaySet` (leads only), `manualIncAdd`, `manualIncWithdraw`, `manualIncDecide` (leads only) or `settingsSet` (leads only). The sender (`by`) must be on the active roster; the server adds `seq` and `at` |

Events are only ever appended. The board's current state is computed from them in the browser (`js/suggest.js`), so the file doubles as a full history.
