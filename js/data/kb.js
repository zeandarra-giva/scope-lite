// Ported from the React prototype: kb.js
(function () {
  const { BUSINESS_APPS, DAY, HOUR, NOW, PRIORITIES, RESOLUTION_CODES, tokens } = S
// Knowledge base: what the Solution Center knows, written down so analysts
// and Copilot can look it up. KB → folders (one level) → pages.
// Editing changes a page's draft only. Publishing re-indexes it, and until
// indexing succeeds Copilot keeps reading the last good published version.

const PAGE_KINDS = ['Runbook', 'Policy', 'Known error', 'How-to', 'Reference']
const ATTACH_TYPES = '.pdf,.doc,.docx,.txt,.csv,.png,.jpg,.jpeg'
const DATA_SOURCES = ['Manual', 'ServiceNow CMDB']
// Pages untouched for this long are flagged for review.
const REVIEW_AFTER_DAYS = 180

const lead = 'Andrea Santos'
const pub = (daysAgo, version = 1, by = lead) => ({ version, at: NOW - daysAgo * DAY, by })

function page(p) {
  const draft = { title: p.title, body: p.body.trim(), attachments: p.attachments || [] }
  const live = p.draftOnly ? null : { ...(p.liveOverride || draft), ...pub(p.daysAgo ?? 30, p.version ?? 1, p.by) }
  return {
    id: p.id, kbId: p.kbId || 'kb1', folderId: p.folderId, kind: p.kind, codes: p.codes || [],
    draft: p.draftEdit ? { ...draft, body: p.draftEdit.trim() } : draft,
    live,
    index: p.draftOnly ? 'draft' : p.failed ? 'failed' : 'indexed',
    indexError: p.failed || null,
    data: p.data || null,
    note: p.note || '',
    updatedAt: NOW - (p.editedAgo ?? p.daysAgo ?? 30) * DAY,
    updatedBy: p.editedBy || p.by || lead,
    review: p.review || null,
  }
}

function seedKb() {
  const kbs = [
    { id: 'kb1', name: 'Solution Center KB', desc: 'Runbooks, policies and reference data for every Solution Center shift.', isDefault: true },
    { id: 'kb2', name: 'Apps Support playbooks', desc: 'Application-specific playbooks owned by Apps Support.' },
  ]
  const folders = [
    { id: 'f-run', kbId: 'kb1', name: 'Runbooks' },
    { id: 'f-pol', kbId: 'kb1', name: 'Policies & SLAs' },
    { id: 'f-ke', kbId: 'kb1', name: 'Known errors' },
    { id: 'f-how', kbId: 'kb1', name: 'How-to guides' },
    { id: 'f-ref', kbId: 'kb1', name: 'Reference data' },
    { id: 'f-pay', kbId: 'kb2', name: 'Payments Hub' },
    { id: 'f-erp', kbId: 'kb2', name: 'Salesforce & SAP' },
  ]
  const pages = [
    page({
      id: 'p-rb112', folderId: 'f-run', kind: 'Runbook', codes: ['NET-VPN-01'], title: 'RB-112 VPN client recovery', version: 3, daysAgo: 12,
      body: `
GlobalConnect VPN drops or loops on reconnect, usually after a certificate rotation or a client update.

## Symptoms
- VPN disconnects every few minutes for remote users
- Client shows error 809 or "certificate not valid"
- Only users on client 5.2 or older are affected

## Steps
1. Confirm scope in monitoring: one user, a site, or everyone on GlobalConnect VPN.
2. If more than 20 users are affected, open a P1 and follow the Major incident process.
3. Push the VPN profile reset via Intune (automated fix NET-VPN-01, needs team lead approval).
4. Reissue the user certificate from the PKI portal if the reset alone does not hold.
5. Ask the user to reconnect and stay connected for 10 minutes before you close.

## Escalation
Escalate to Network Engineering L3 if the tunnel still drops after the certificate is reissued.`,
      attachments: [{ id: 'att-1', name: 'vpn-client-error-codes.csv', type: 'CSV', size: '4 KB', text: 'Error 809: tunnel blocked by firewall or stale profile. Reset profile.\nError 812: certificate not valid. Reissue certificate.\nError 720: client older than 5.2. Upgrade client first.' }],
      note: 'Intune profile reset job sometimes queues for 15 min during patch weekends. Tell the user before you start.',
    }),
    page({
      id: 'p-rb108', folderId: 'f-run', kind: 'Runbook', codes: ['NET-DNS-01'], title: 'RB-108 DNS stale record', version: 2, daysAgo: 40,
      body: `
Internal hostnames fail to resolve, or resolve to an old address after a migration.

## Steps
1. Run nslookup against both site resolvers and compare the answers.
2. Flush the resolver cache on the affected client (ipconfig /flushdns).
3. If the record is stale on the resolver, run the DNS record reconcile job (automated fix NET-DNS-01).
4. Confirm the hostname resolves for the caller and one other user on the same site.

## Notes
Teams audio dropping for a whole floor is often the same stale record on the floor resolver.`,
    }),
    page({
      id: 'p-rb201', folderId: 'f-run', kind: 'Runbook', codes: ['IAM-LOCK-01'], title: 'RB-201 Account lockout', version: 4, daysAgo: 8, editedAgo: 0.2, editedBy: 'Bea Mendoza',
      body: `
Account locked after a password change. Usually caused by a device still using the old password.

## Steps
1. Verify the caller's identity with two of: SOEID, manager name, last login site.
2. Unlock the AD account and clear cached credentials (automated fix IAM-LOCK-01).
3. Ask the user to sign out of mobile mail and Okta Verify, then sign in with the new password.
4. Check the lockout source in the directory audit log if it locks again within an hour.`,
      draftEdit: `
Account locked after a password change. Usually caused by a device still using the old password.

## Steps
1. Verify the caller's identity with two of: SOEID, manager name, last login site.
2. Unlock the AD account and clear cached credentials (automated fix IAM-LOCK-01).
3. Ask the user to sign out of mobile mail, Okta Verify and any mapped drives, then sign in with the new password.
4. Check the lockout source in the directory audit log if it locks again within an hour.
5. If the source is a service account, hand over to Identity & Access Management.`,
      review: { by: 'Bea Mendoza', at: NOW - 0.2 * DAY },
    }),
    page({
      id: 'p-rb204', folderId: 'f-run', kind: 'Runbook', codes: ['IAM-MFA-01'], title: 'RB-204 MFA re-enrolment', daysAgo: 64,
      body: `
MFA prompt loops after a phone replacement because the old device is still registered.

## Steps
1. Verify identity with a video call or the manager callback process.
2. Remove the old factor in the Okta admin console.
3. Send the user the self-service enrolment link and stay on the call while they enrol.
4. Confirm a successful sign-in to Okta SSO before closing.`,
    }),
    page({
      id: 'p-rb305', folderId: 'f-run', kind: 'Runbook', codes: ['APP-CFG-01'], title: 'RB-305 App config drift', version: 2, daysAgo: 21,
      body: `
An application returns errors after an unplanned config change, for example Salesforce CRM returning 500 on save.

## Steps
1. Compare the running config with the last known-good snapshot.
2. Restore the last known-good config (automated fix APP-CFG-01, needs approval).
3. Restart the app pool and run the smoke test.
4. Raise a change record for whoever made the unplanned change.`,
    }),
    page({
      id: 'p-rb501', folderId: 'f-run', kind: 'Runbook', codes: ['INF-SVC-01'], title: 'RB-501 Service restart', daysAgo: 90,
      body: `
A backend service is down, for example the Citrix Workspace broker, and sessions fail to launch.

## Steps
1. Check the service health dashboard and confirm which nodes are down.
2. Restart the failed service with the health-check gate (automated fix INF-SVC-01).
3. Wait for two green health checks in a row.
4. Launch a test session yourself before you tell users it is fixed.

## Escalation
Two failed restarts in an hour go to Infrastructure Operations.`,
    }),
    page({
      id: 'p-rb520', folderId: 'f-run', kind: 'Runbook', codes: ['INF-CRT-01'], title: 'RB-520 Certificate renewal', daysAgo: 150, failed: 'Attachment cert-renewal-checklist.pdf could not be read. Re-upload it or replace the text.',
      body: `
A certificate warning appears on a login page because the certificate expired or is about to.

## Steps
1. Check the expiry date and which hosts present the certificate.
2. Request the renewal from the PKI team (standard change, 2 hour lead time).
3. Bind the new certificate on every host in the pool.
4. Clear the CDN cache and confirm the warning is gone.`,
    }),
    page({
      id: 'p-rb402', folderId: 'f-run', kind: 'Runbook', codes: ['EUC-OS-01'], title: 'RB-402 Patch rollback', draftOnly: true, daysAgo: 2, by: 'Miguel Tan',
      body: `
Outlook or another app crashes on launch right after Patch Tuesday.

## Steps
1. Confirm the KB number of the patch installed last night.
2. Trigger the patch rollback via SCCM (automated fix EUC-OS-01).
3. Reboot and confirm Outlook launches.
4. Add the device to the deferral ring until the vendor fix ships.`,
    }),
    page({
      id: 'p-sla', folderId: 'f-pol', kind: 'Policy', title: 'Priority & SLA matrix', version: 5, daysAgo: 30,
      body: `
Priority is set from impact and urgency. The SLA clock starts when the incident is opened.

## Resolution targets
- P1 Critical: resolve within 4 hours
- P2 High: resolve within 8 hours
- P3 Moderate: resolve within 24 hours
- P4 Low: resolve within 72 hours

## At risk
A ticket is at risk when less than 25% of its SLA is left. At-risk P1 and P2 tickets go to the top of the queue.

## Breaches
Every breached ticket needs a breach reason code (BR-01 to BR-06) when it is resolved.`,
    }),
    page({
      id: 'p-mim', folderId: 'f-pol', kind: 'Policy', title: 'Major incident process', version: 3, daysAgo: 45,
      body: `
Use this for any P1, or when one cause affects 20 or more users.

## Steps
1. The team lead opens the major incident bridge within 15 minutes.
2. Link every related ticket to one parent incident.
3. Post a stakeholder update every 30 minutes, even when nothing has changed.
4. After service is restored, the resolver group writes a problem record within 2 working days.`,
    }),
    page({
      id: 'p-esc', folderId: 'f-pol', kind: 'Policy', title: 'Escalation & transfer policy', version: 2, daysAgo: 60,
      body: `
Transfers cost time. Escalate once, to the right group, with a complete work note.

## When to escalate
- The runbook is finished and the fault is still there
- The fix needs access the Solution Center does not have
- A vendor or third party has to act

## How
1. Check the Business application directory for the escalation resolver.
2. Write a work note with symptoms, what you tried and the result.
3. Record the escalation target when you resolve or transfer the ticket.`,
    }),
    page({
      id: 'p-ho', folderId: 'f-pol', kind: 'Policy', title: 'Shift handover standard', daysAgo: 75,
      body: `
Every shift ends with a written handover. The next team lead acknowledges it within 30 minutes.

## A handover includes
- Open P1 and P2 tickets, with the owner and next step
- Tickets waiting on a customer or vendor
- Automated fixes waiting for approval
- Anything unusual: outages, changes, staffing gaps`,
    }),
    page({
      id: 'p-qref', folderId: 'f-pol', kind: 'Policy', title: 'Service Desk quick reference (2025)', daysAgo: 410, by: 'Rhea Castillo',
      body: `
One-page summary for new joiners.

## Targets
- P1 incidents must be resolved within 4 hours
- P2 incidents must be resolved within 6 hours
- Answer chats within 60 seconds

## Useful links
- Runbook library: Ticket Explorer, Resolution codes tab
- Shift rota: Team Management`,
    }),
    page({
      id: 'p-ke412', folderId: 'f-ke', kind: 'Known error', codes: ['APP-BUG-01'], title: 'KE-0412 Workday timesheet freezes on submit', daysAgo: 18,
      body: `
Known defect in the Workday timesheet page. The vendor fix is planned for the next release.

## Workaround
1. Ask the user to clear the browser cache or use a private window.
2. Submit the timesheet from the Workday mobile app instead.
3. Link the ticket to problem PRB0031 so it closes with the vendor fix.`,
    }),
    page({
      id: 'p-how91', folderId: 'f-how', kind: 'How-to', codes: ['USR-HOW-01'], title: 'KB-0091 Share a calendar with a delegate', daysAgo: 120,
      body: `
## Steps
1. In Outlook, open Calendar and choose Share calendar.
2. Add the delegate and pick "Can edit" or "Delegate".
3. The delegate accepts the invitation from their inbox.

Send the user this article and close as How-to guidance (USR-HOW-01).`,
    }),
    page({
      id: 'p-tpl', folderId: 'f-how', kind: 'How-to', title: 'Customer update templates', daysAgo: 33,
      body: `
Keep updates short. Say what happened, what we are doing and when the next update comes.

## Update intervals
- P1: every 30 minutes
- P2: every hour
- P3 and P4: when the status changes

## Template
Hi {caller}, this is {analyst} from the Solution Center about {ticket}. {status}. Next update by {time}.`,
    }),
    page({
      id: 'p-apps', folderId: 'f-ref', kind: 'Reference', title: 'Business application directory', daysAgo: 5,
      body: 'Who owns each business application and where to escalate. Synced from the ServiceNow CMDB; status is updated live by the owning group.',
      data: {
        columns: ['Application', 'Owner group', 'Escalation resolver', 'Vendor', 'Support hours', 'Status'],
        source: 'ServiceNow CMDB', syncedAt: NOW - 0.4 * HOUR,
        rows: [
          ['Payments Hub', 'Apps Support', 'Application Support L3', 'In-house', '24x7', 'Degraded'],
          ['Salesforce CRM', 'Apps Support', 'Application Support L3', 'Salesforce', '24x7', 'Operational'],
          ['SAP Finance', 'Apps Support', 'Application Support L3', 'SAP', '06:00–22:00', 'Operational'],
          ['Workday', 'Apps Support', 'Application Support L3', 'Workday', '08:00–20:00', 'Known error'],
          ['Outlook / M365', 'Infra Ops', 'Desktop Engineering', 'Microsoft', '24x7', 'Operational'],
          ['GlobalConnect VPN', 'Service Desk L2', 'Network Engineering L3', 'In-house', '24x7', 'Operational'],
          ['Citrix Workspace', 'Infra Ops', 'Infrastructure Operations', 'Citrix', '24x7', 'Operational'],
          ['Okta SSO', 'Service Desk L2', 'Identity & Access Management', 'Okta', '24x7', 'Operational'],
        ].map((cells, i) => ({ id: 'r' + i, cells })),
      },
    }),
    page({
      id: 'p-oncall', folderId: 'f-ref', kind: 'Reference', title: 'Resolver on-call this week', daysAgo: 1,
      body: 'Primary on-call for each L3 resolver group. Team leads update this at the start of each week.',
      data: {
        columns: ['Resolver group', 'Primary on-call', 'Bridge / phone', 'Until'],
        source: 'Manual', syncedAt: NOW - 1 * DAY,
        rows: [
          ['Application Support L3', 'J. dela Cruz', 'Bridge 4471', 'Sunday 23:00'],
          ['Network Engineering L3', 'R. Salazar', '+63 2 8555 0142', 'Sunday 23:00'],
          ['Identity & Access Management', 'K. Uy', 'Bridge 4480', 'Friday 18:00'],
          ['Infrastructure Operations', 'M. Ilagan', 'Bridge 4492', 'Sunday 23:00'],
          ['Desktop Engineering', 'P. Lopez', '+63 2 8555 0177', 'Friday 18:00'],
        ].map((cells, i) => ({ id: 'o' + i, cells })),
      },
      note: 'Escalate to the L3 team lead if on-call does not answer within 15 minutes.',
    }),
    page({
      id: 'p-rb320', kbId: 'kb2', folderId: 'f-pay', kind: 'Runbook', codes: ['APP-INT-01'], title: 'RB-320 Integration replay', version: 2, daysAgo: 26,
      body: `
Payment batches stuck in pending usually mean the interface to the clearing system dropped messages.

## Steps
1. Check the dead-letter queue for the affected interface in the integration console.
2. Confirm with Payments operations that no batch was released manually.
3. Replay the dead-letter queue (automated fix APP-INT-01, needs team lead approval).
4. Watch the batch move from pending to released, then confirm with the caller.

## Cut-off times
Batches must be released before the 11:00, 15:00 and 19:30 cut-offs. If a replay will miss a cut-off, tell Payments operations straight away.`,
    }),
    page({
      id: 'p-sap', kbId: 'kb2', folderId: 'f-erp', kind: 'Runbook', codes: ['IAM-ROLE-01'], title: 'RB-210 SAP Finance approver roles', daysAgo: 55,
      body: `
A missing approver role in SAP Finance blocks invoice release.

## Steps
1. Check the user's roles against the finance role catalogue.
2. Raise an access request for the missing role; the cost-centre manager approves it.
3. Ask the user to sign out and back in once the request is fulfilled.`,
    }),
  ]
  return { kbs, folders, pages }
}

// ---------- Page state ----------
const isDirty = (p) => !p.live || p.live.title !== p.draft.title || p.live.body !== p.draft.body ||
  JSON.stringify(p.live.attachments) !== JSON.stringify(p.draft.attachments)
function pageStatus(p) {
  if (p.index === 'indexing') return { id: 'indexing', label: 'Indexing', tone: 'accent' }
  if (!p.live) return { id: 'draft', label: 'Draft only', tone: 'plain' }
  if (p.index === 'failed') return { id: 'failed', label: 'Index failed', tone: 'crit' }
  return { id: 'indexed', label: 'Indexed', tone: 'good' }
}
const reviewDue = (p, now) => p.live && now - p.live.at > REVIEW_AFTER_DAYS * DAY

// Publishing validates the draft the way the indexer would.
function indexProblem(p) {
  if (p.draft.body.trim().length < 40) return 'The page is too short to index. Add at least a sentence or two.'
  const unread = p.draft.attachments.find((a) => !a.text.trim())
  if (unread) return `No text could be read from ${unread.name}. Add the text by hand or remove the file.`
  return null
}

// ---------- Search (what Copilot's search_knowledge_base tool does) ----------
const stem = (w) => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w)
const terms = (s) => tokens(s).map(stem)

// Published content only, split into chunks by heading. Internal notes are never indexed.
function chunksOf(p) {
  if (!p.live) return []
  const out = []
  let cur = { heading: 'Overview', lines: [] }
  for (const line of p.live.body.split('\n')) {
    if (line.startsWith('## ')) { if (cur.lines.join('').trim()) out.push(cur); cur = { heading: line.slice(3).trim(), lines: [] } } else cur.lines.push(line)
  }
  if (cur.lines.join('').trim()) out.push(cur)
  p.live.attachments.forEach((a) => out.push({ heading: `Attachment · ${a.name}`, lines: a.text.split('\n') }))
  return out.map((c, i) => ({ pageId: p.id, key: `${p.id}#${i}`, heading: c.heading, text: c.lines.join('\n').trim() }))
}

function searchKb(kb, kbIds, query, limit = 4) {
  const pages = kb.pages.filter((p) => kbIds.includes(p.kbId) && p.live)
  if (!pages.length) return { ok: false, error: 'No indexed pages in the linked knowledge bases', results: [], searched: 0 }
  const q = [...new Set(terms(query))]
  const codeHits = (query.toUpperCase().match(/[A-Z]{3}-[A-Z]{2,4}-\d{2}|RB-\d{3}|KE-\d{4}|KB-\d{4}/g) || [])
  const scored = []
  pages.forEach((p) => {
    const titleT = new Set(terms(p.live.title))
    chunksOf(p).forEach((c) => {
      const T = new Set(terms(c.heading + ' ' + c.text))
      let s = 0
      q.forEach((w) => { if (T.has(w)) s += 1; if (titleT.has(w)) s += 1.5 })
      if (codeHits.some((code) => p.codes.includes(code) || p.live.title.toUpperCase().includes(code))) s += 4
      if (/^steps|workaround|resolution targets/i.test(c.heading)) s += 0.3
      if (s > 0) scored.push({ ...c, score: s / Math.max(2, q.length), page: p })
    })
  })
  scored.sort((a, b) => b.score - a.score)
  const results = scored.filter((r) => r.score >= 0.34).slice(0, limit)
  return { ok: true, results, searched: pages.length }
}

// Exact lookups in data tables. Tables are live: edits apply without publishing.
function queryData(kb, kbIds, query) {
  const q = new Set(terms(query))
  const out = []
  kb.pages.filter((p) => kbIds.includes(p.kbId) && p.data).forEach((p) => {
    p.data.rows.forEach((r) => {
      const hit = r.cells.some((c) => { const t = terms(String(c)); return t.length && t.every((w) => q.has(w)) })
      if (hit) out.push({ page: p, row: r })
    })
  })
  return out
}
const rowObj = (page, row) => Object.fromEntries(page.data.columns.map((c, i) => [c, row.cells[i]]))
function appRow(kb, kbIds, app) {
  for (const p of kb.pages.filter((x) => kbIds.includes(x.kbId) && x.data && x.data.columns[0] === 'Application')) {
    const r = p.data.rows.find((x) => x.cells[0] === app)
    if (r) return { page: p, row: rowObj(p, r) }
  }
  return null
}
function onCallFor(kb, kbIds, group) {
  for (const p of kb.pages.filter((x) => kbIds.includes(x.kbId) && x.data && x.data.columns[0] === 'Resolver group')) {
    const r = p.data.rows.find((x) => x.cells[0] === group)
    if (r) return { page: p, row: rowObj(p, r) }
  }
  return null
}

// The published page that documents a resolution code, if any.
const pageForCode = (kb, kbIds, code, { published = true } = {}) =>
  kb.pages.find((p) => kbIds.includes(p.kbId) && p.codes.includes(code) && (!published || p.live))

// ---------- Health: conflicts, gaps, stale pages ----------
// Resolution targets stated in published pages, checked against each other
// and against the SLA rule the queue actually runs on.
function findConflicts(kb) {
  const claims = {}
  kb.pages.filter((p) => p.live).forEach((p) => {
    p.live.body.split('\n').forEach((line) => {
      const m = line.match(/\bP([1-4])\b.*?resol\w*.*?(\d+(?:\.\d+)?)\s*(?:h\b|hours?)/i)
      if (m) (claims['P' + m[1]] = claims['P' + m[1]] || []).push({ page: p, hours: +m[2], line: line.replace(/^[-\d.\s]+/, '').trim() })
    })
  })
  return Object.entries(claims).flatMap(([prio, list]) => {
    const rule = PRIORITIES[prio].slaH
    const off = list.filter((c) => c.hours !== rule)
    if (!off.length) return []
    return [{ id: 'cf-' + prio, prio, rule, claims: list, off }]
  })
}

function findGaps(kb, history, now) {
  const recent = history.filter((h) => h.resolvedAt >= now - 30 * DAY)
  return RESOLUTION_CODES.map((c) => {
    const any = kb.pages.find((p) => p.codes.includes(c.code))
    const live = kb.pages.find((p) => p.codes.includes(c.code) && p.live)
    return { code: c, uses: recent.filter((h) => h.code === c.code).length, draft: !live && any ? any : null, covered: !!live }
  }).filter((g) => !g.covered).sort((a, b) => b.uses - a.uses)
}

const appNamed = (text) => {
  const s = text.toLowerCase()
  return BUSINESS_APPS.find((a) => s.includes(a.toLowerCase()) || s.includes(a.toLowerCase().split(/[ /]/)[0]))
}

  Object.assign(S, { PAGE_KINDS, ATTACH_TYPES, DATA_SOURCES, REVIEW_AFTER_DAYS, seedKb, isDirty, pageStatus, reviewDue, indexProblem, terms, chunksOf, searchKb, queryData, rowObj, appRow, onCallFor, pageForCode, findConflicts, findGaps, appNamed })
})()
