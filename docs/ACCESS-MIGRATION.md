# Moving Scope Lite's data store to Microsoft Access

Status: **plan, not started.** Decided by the team lead on 2026-11-12. Stage A runs on a Mac with no Access installed. Stages B to D run on the Windows work laptop.

## Why this needs a plan

Today `server.ps1` keeps the team's shared state in append-only files. `data/ops.jsonl` holds the operational events, `data/suggestions.jsonl` holds the Suggestions board, and `data/roster.json` holds the team. The browser folds the event log into state, so all the business rules live in one place: the JS reducer. The lead wants that data in an Access database instead.

The concerns that originally ruled Access out still apply, so the plan has to handle them, not ignore them:

| Concern | How the plan handles it |
|---|---|
| Access files corrupt or lock when several machines open them over a network share | **Only `server.ps1` opens the database.** Browsers keep talking to the HTTP API and never open the file. One process holds one connection. |
| PowerShell 5.1 needs an OLE DB provider to read `.accdb`, and nothing can be installed | Stage B checks which provider the work laptop already has. Office ships the ACE provider. Windows ships Jet 4.0 (`.mdb` only, 32-bit PowerShell only). |
| PowerShell and the provider must have the same bitness | The probe reports both. `run.bat` / `share.bat` start the matching `powershell.exe` (`System32` for 64-bit, `SysWOW64` for 32-bit). |
| A damaged `.accdb` can lose everything | **The JSONL log stays on as a journal.** Every event is written to both. The database can always be rebuilt from the journal, and rolling back is a single switch. |
| Business rules would split between PowerShell and JS | The database **stores** events and **receives** read tables built by the JS fold. PowerShell never decides anything. |

## The idea in one picture

```
browser ──HTTP──> server.ps1 ──> Store (one interface)
                                  ├─ jsonl   today's files (default, and the journal)
                                  ├─ mock    Access-shaped JSON tables (Stage A, any OS)
                                  └─ access  .accdb through System.Data.OleDb (Stages C–D, Windows)
```

The browser API does not change: `GET/POST /api/ops`, `GET/POST /api/events` and `GET /api/roster`. One new endpoint is added for read tables (see Stage A). The store is chosen with `server.ps1 -Store jsonl|mock|access` and is printed in the start-up banner.

## Target schema

The schema lives in one file, `tools/access/schema.json`, with tables, columns, Access types, sizes and keys. The `mock` store checks against it, and the `access` store creates the `.accdb` from it. That way the Mac test catches the same mistakes the real database would, such as text over 255 characters, a missing key or a duplicate `eid`.

### Source of truth (written by the server)

| Table | Columns (Access type) | Replaces |
|---|---|---|
| `tbl_Events` | `seq` LONG PK, `at_ms` DOUBLE, `at` DATETIME, `by_soeid` TEXT(16), `type` TEXT(40), `eid` TEXT(64) unique, `payload` LONG TEXT (the event's JSON) | `data/ops.jsonl` |
| `tbl_SuggestionEvents` | same shape | `data/suggestions.jsonl` |
| `tbl_Members` | `soeid` TEXT(16) PK, `fullname` TEXT(120), `access_role` TEXT(16), `active` YES/NO, plus any other roster fields | `data/roster.json` |

`GET /api/ops` returns `tbl_Events` ordered by `seq`, in exactly the same JSON shape as today. The reducer cannot tell the difference.

### Read tables (built by the browser's fold, optional)

These are for people who open the database in Access to look at data or build reports. They are **derived**, can be thrown away and are always rebuildable from `tbl_Events`.

| Table | One row per |
|---|---|
| `tbl_Tickets` | INC ticket: number, short description, priority, state, group, opened / updated, owner, assigned at, reason, tag, EERS flag, health flags |
| `tbl_TicketHistory` | assignment, move or tag change |
| `tbl_TicketNotes` | note on a ticket |
| `tbl_ManualEntries` | manual INC entry, with its status and verifier |
| `tbl_Imports` | CSV import: file, rows, new / updated / left, undone |
| `tbl_ShiftSignins` | person × day: role and shift chosen at sign-in |
| `tbl_Settings` | team setting: current value, changed by, changed at |

Who writes them: the **host's own browser** (`localhost` only) posts a snapshot of the folded state to `POST /api/projection` after a change, at most once every 30 seconds. The server replaces those tables inside one transaction. PowerShell only copies rows.

## Stage A: test on the Mac (now)

Goal: see how the data lands in Access-shaped tables and how it flows back into the UI, before touching a real database.

1. **Store seam in `server.ps1`.** Move file access behind six functions: `Store-Init`, `Store-ReadOps`, `Store-AppendOp`, `Store-ReadSuggestions`, `Store-AppendSuggestion` and `Store-ReadRoster`. The `jsonl` store is today's code moved, not rewritten.
2. **`tools/access/schema.json`** as described above.
3. **`mock` store.** Writes `data/access-mock/<table>.json` and checks every row against the schema (type, size, required fields, unique keys). It also writes the JSONL journal.
4. **`POST /api/projection`** plus the browser side that sends the snapshot.
5. **A "Data" tab under Team Management, for leads only.** It lists each table with its row count, the last 50 rows and the columns as Access types. Selecting a row in `tbl_Events` shows the read-table rows it produced, so you can follow import → assign → tag → note end to end.
6. **Walkthrough.** `node tools/make-sample-incidents.mjs` → start with `-Store mock` → sign in as two roster people → import → check `tbl_Events`, `tbl_Tickets`, `tbl_TicketHistory` → tag, add a note, undo the import → check again → restart the server and confirm the UI is unchanged.

**Done when:** the walkthrough passes; the UI with `-Store mock` and with `-Store jsonl` gives the same state (compared with a hash of the fold); and a schema violation is refused with a clear message, not stored.

## Stage B: probe the work laptop (15 minutes, no installs)

`tools/access/probe.ps1` runs in Windows PowerShell 5.1 and only prints. It reports:

- the PowerShell bitness and the Office bitness;
- the OLE DB providers present: `Microsoft.ACE.OLEDB.16.0`, `.12.0`, `Microsoft.Jet.OLEDB.4.0`;
- whether ADOX can create a test database (`.accdb` with ACE, `.mdb` with Jet) in the user's temp folder **and** in the team folder;
- the time to insert and read back 1,000 event rows in each place;
- what happens when a second process opens the same file.

| Result | Then |
|---|---|
| ACE present in a bitness PowerShell can run | Go, with `.accdb` |
| Only Jet 4.0 | Go, with `.mdb` and 32-bit PowerShell |
| No provider, or Office's provider isn't visible outside Office | **Stop.** Stay on JSONL and offer an Access **export** instead. Getting the provider installed is an IT request |
| Writing to the team folder is slow or fails | Keep the database on the host's own disk, with a nightly copy to the team folder |

## Stage C: real Access store, running in parallel

1. **`access` store** using `System.Data.OleDb`. One connection is opened at start-up. Each append is one parameterised `INSERT` inside a transaction, and `seq` is checked at start just as the JSONL loader checks it now.
2. **`tools/access/create-db.ps1`** creates the database from `schema.json`.
3. **`tools/access/migrate.ps1`** replays `ops.jsonl`, `suggestions.jsonl` and `roster.json` into the database. It checks row counts, the `seq` range, unique `eid`s and a hash of the replayed log. It can be re-run and refuses to load into a non-empty database.
4. **Parallel run** for one week with the journal still written. Each day, `tools/access/parity.ps1` compares `GET /api/ops` from the database with the journal.

**Done when:** a week passes with no parity differences, no lock or corruption errors, and start-up under 5 seconds.

## Stage D: cut over and run it

- `-Store access` becomes the default on the host. The journal stays on.
- **Backups:** each night the server pauses writes for a moment, closes the connection, copies the file to `data/backup/YYYY-MM-DD/`, and reopens. The journal is copied too.
- **Compact and repair** weekly, using the same pause and copy steps.
- **Size:** Access stops at 2 GB. Events are a few MB a year, so the server only warns at 1 GB.
- **Rollback:** restart with `-Store jsonl`. The journal is complete, so nothing is lost.
- **Opening the database by hand** (in Access) is read-only while the server runs. The roster is edited through Scope, or with the server stopped.

## Open questions

| # | Question | Blocks |
|---|---|---|
| A1 | Which provider and bitness does the work laptop have? | Stage B outcome |
| A2 | Where does the database live, given that the host can change: the team folder or the host's disk? | Stage C |
| A3 | What is Access for: reporting in Access, other tools reading it, IT acceptance, or familiarity? This decides whether the read tables are needed | Read tables |
| A4 | Who edits the roster, and where: a Scope screen, or Access with the server stopped? | `tbl_Members` |
| A5 | Does ticket text in the database change how it must be classified or stored? | Stage C, on real data |
