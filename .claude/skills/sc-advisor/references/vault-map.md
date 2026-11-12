# SC Lakehouse vault map

Folder: `$SC_VAULT_DIR`, or by default `$HOME/Desktop/Study-Materials/The Vault/Projects/SC Lakehouse`.

Layout: `Index.md`, `Scope PRD v1.md` and `ServiceOps Console Product Design.md` at the root; **`Business Operation/`** holds how the team runs (Team Operating Model, 3-Strike Process, QueueManager Mechanics); **`Development Plan/`** holds the Scope Lite build and ship plans (Implementation Plan and its sub-plans, Prototype Data Model, Claude resume session). New business-process notes go in `Business Operation/`, new dev notes in `Development Plan/`.

Read `Index.md` first. Then open only the notes the question needs. Section numbers are stable, so you can cite them.

| Note | Holds | Read it when |
|---|---|---|
| `Index.md` | Current state, the canon list, the **Next** to-dos | Always first; "what's next?" |
| `Scope PRD v1.md` | The v1.0 PRD **outline**: §1–19 with a status per section (TODO / MIGRATE / DECIDE / DRAFT / DONE), the `[CSI]`/`[NO-CSI]` × `[AI]`/`[RULES]` scenario grid, the CSI ID pack (§16), and the open questions and decision log (§19) | Scope, requirements, personas, NFRs, the CSI application, PRD structure |
| `ServiceOps Console Product Design.md` | The older v0.2 product design. Problem, goals and non-goals, users and roles (§3), pages (§5), flows (§6), notifications (§7), **business rules with the prototype's values** (§8), data model (§9), integrations (§10), **MVP cut** v1 / v1.1 / v1.2 (§11), open questions (§12), metrics (§13) | Page behaviour, business-rule formulas, the MVP cut. Content is being migrated into the PRD outline |
| `Development Plan/Implementation Plan.md` | The `[NO-CSI]` × `[RULES]` delivery plan: architecture, **decisions taken (D1–D7)**, **decisions still open (Q1–Q6)**, phases | Any architecture or "is this allowed" question |
| `Business Operation/Team Operating Model.md` | **How the team really runs**: BAUs (§1), shifts and shift modes (§2), weekly roles and rotation rules (§3), the partner-site handover (§4), a weekday (§5), an example rotation (§6), **open questions** (§7), prototype vs reality (§8), draft schema and derived rules (§9) | The rota, roles, shifts, handover, coverage, anything about people |
| `Development Plan/Prototype Data Model.md` | The data model as built: ERD, data dictionary, derived values, write paths, what real data sources must provide, findings | Data model and schema work |
| `Development Plan/Frontend and UX Plan.md` | App modes, identity without SSO, changes per page, concurrency UX, empty/loading/error states, the accessibility bar | UI and UX design |
| `Development Plan/Backend Plan.md` | `server.ps1` runtime, the **event model**, making the reducer deterministic, event types, the API, the path to `[CSI]` | Server, API, shared-state work |
| `Development Plan/Database Plan.md` | Append-only JSONL on the share, file layout, integrity rules, retention, backup and restore, migration paths | Storage and data-integrity work |
| `Development Plan/Hosting and Operations Plan.md` | Host model, the Phase 0 test, startup sequence, runbooks, **releases without git on the VDI**, monitoring, the honest security posture | Shipping, releases, operations |
| `Development Plan/Delivery Roadmap.md` | Phases 0–5 with tasks, **acceptance criteria** and risks | "Which phase is this in?", done-ness |
| `Development Plan/Access Migration Plan.md` | D21: moving Scope's store to Access. Store seam, Access-shaped mock (Mac), probe, parallel run, cut-over; open questions A1–A6. Repo copy: `docs/ACCESS-MIGRATION.md` | Anything about Access, storage changes, the probe |
| `Business Operation/3-Strike Process.md` | The On Hold follow-up BAU: 3 contact attempts over 3 days, then Resolved, with templates | On Hold handling, follow-up features |
| `Business Operation/QueueManager Mechanics.md` | How the team's previous queue tool works: CSV ingest, health SLO/SLA, fairness, end-of-day clear, its Access database | QM, queue health, ticket distribution |

## How the notes are written

- YAML frontmatter: `tags`, `created`, `updated`, `status` (e.g. `draft v0.4, …`). Bump `updated` and the version whenever you edit.
- Links use `[[Note name]]` or `[[Note|label]]`. Each note ends with a `## Related` section and `#tags`.
- Callouts: `> [!todo]` for pending, `> [!success]` for answered, `> [!quote]` for raw team input, plus `> [!note]`, `> [!important]` and `> [!summary]`.
- Status markers in tables: ✅ answered, ⏳ pending, ⚠️ unclear or conflicting.
- Facts carry their source: *(team, YYYY-MM-DD)* or *(lead, YYYY-MM-DD)*.
- Diagrams are mermaid (`flowchart`, `gantt`, `erDiagram`).
- Plain, direct English. Use tables for rules and open questions.

## Where new knowledge usually goes

| Kind of fact | Note and section |
|---|---|
| Roles, duties, rotation, rest days, cover | Team Operating Model §1, §3 (rules), §6 (example), §7 (questions), §9 (`Role`, `RoleDuty`, `WeeklyRole`, `ProciCover`, derived rules) |
| Shift times, shift modes | Team Operating Model §2, §9 `ShiftMode` |
| Handover content or process | Team Operating Model §4 |
| An architecture or hosting decision | Implementation Plan "Decisions taken"; the matching plan note |
| Requirement, persona, metric | Scope PRD v1, matching section |
| Something nobody knows yet | The open-questions table of the closest note |
