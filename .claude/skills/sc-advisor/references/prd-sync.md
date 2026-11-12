# Promoting vault knowledge into `docs/PRD.md`

`docs/PRD.md` is the repo's single source of truth for the business: what Scope is, how the Solution Center works, and the rules Scope must follow. It travels with the code through git, so the skill still works on the company device, where the vault isn't available. It changes only through this procedure, and only with the user's approval.

## Structure of `docs/PRD.md`

Follow the section numbers of the vault's `Scope PRD v1.md`, so the two stay easy to diff. Write real content, not the outline's Purpose/Include scaffolding. Keep the status tag of any section that is still incomplete.

```
# Scope: Product Requirements (Solution Center)
<status table: version, updated, source = SC Lakehouse vault, approved by>
Planning scenarios ([CSI]/[NO-CSI] × [AI]/[RULES]) and which one is current
1. Executive summary & context
2. Project overview (goals, scope, assumptions)
3. MVP definition (pillars, releases, delivery scenarios)
4. Current state: 4.1 how the team works today  ← Team Operating Model §1–§5
5. User personas & roles matrix                   ← + weekly roles (Main Proci, Backup, Weekend)
6. Data model                                     ← Prototype Data Model + Team Operating Model §9
7. Ticket lifecycle (INC / CMP / EERS, SLAs)
8–9. Requirements & functional specs (only modules with real content)
10. Business rules                                ← rota/rotation rules, cover rules, coverage, SLA, fair-share
11. Non-functional requirements
13. Success metrics
14. Architecture (current: [NO-CSI] × [RULES])     ← Implementation Plan + plan notes (decisions D1–D7)
17. Implementation plan & roadmap                 ← Delivery Roadmap phases + acceptance criteria
19. Open questions & decision log                 ← all open questions, with their status
Appendix: glossary · change history
```

Leave out sections that have nothing approved yet. Don't pad the PRD with TODO scaffolding; the vault outline already tracks that.

## Procedure

1. **Gather.** Read `docs/PRD.md` (if it exists) and the vault notes that changed. The `updated:` frontmatter dates help, as does what you edited in this session.
2. **Diff by meaning, not by text.** For each PRD section, list:
   - **Add / Change:** the fact, the vault source (note §), and the proposed wording.
   - **Hold back:** anything still ⚠️ or ⏳ in the vault. Open questions go to §19 as open, never into §10 as rules.
   - **Scrub:** internal specifics you'll generalise (see below).
3. **Propose.** Show the list grouped by section, kept short. Ask which items to approve.
4. **Write** only the approved items. Then:
   - update the status table (`updated`, version, `approved by: <lead>`, date);
   - append to **Change history**: `YYYY-MM-DD · §x, §y · <one-line summary> · source: <vault notes>`.
5. **Check.** Run `bash .claude/skills/sc-advisor/scripts/check-public.sh docs/PRD.md` and fix every hit, or explain why it's acceptable.
6. **Stop there.** Don't commit or push unless the user asks. If they ask, use a message like `docs(prd): <summary>`.

When the vault and the PRD disagree and the PRD side wasn't changed through this procedure, treat the vault as newer, but still propose the change; don't overwrite silently.

## Scrub rules (when the repo is public)

`gh repo view --json visibility` tells you. When it's `PUBLIC`, or unknown, keep these out of `docs/PRD.md`:

| Keep out | Write instead |
|---|---|
| IP addresses, hostnames, ports of internal machines, UNC/share paths, drive letters | "the team share", "the existing queue tool's host" |
| Real people's names, SOEIDs, emails | role names ("the team lead", "Main Proci") |
| Partner-site names and contact details | "the partner site (overseas handover)" |
| Internal system names that identify the firm | Generic ones, e.g. "the ticketing tool for CMP tickets". Ask the user once which system names are fine to publish, and record the answer here |
| CSI application field answers, costs, approvers | "see the vault" |

If the repo is private, only people's personal data (names, SOEIDs, emails) needs scrubbing.

### Names the user has cleared for publishing
_(none recorded yet; ask before the first sync)_
