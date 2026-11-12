// Writes a made-up ServiceNow incident export for testing the Queue Management import.
//   node tools/make-sample-incidents.mjs [outDir]     (default: data/inbox)
// Same 13 columns and quirks as the real export (<br> line breaks, escaped pipes,
// HTML entities, empty fields, repeated rows, a non-INC row, an accented name), but
// every person, group and ticket is invented. Dates are relative to now, so the
// health flags (SLO, SLA, backlog) show up. Two files: UTF-8 and Windows-1252.
import fs from 'fs'
import path from 'path'

const out = process.argv[2] || 'data/inbox'
fs.mkdirSync(out, { recursive: true })
const now = Date.now()
const H = 3600e3
const pad = (n) => String(n).padStart(2, '0')
const when = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` }
const A = 'SC TEAM QUEUE A'
const B = 'SC TEAM QUEUE B'
const head = ['number', 'opened_at', 'priority', 'sys_updated_on', 'short_description', 'description', 'caller_id', 'caller_id.user_name', 'state', 'assignment_group', 'assigned_to', 'sys_created_by', 'location']
const rows = [
  ['INC0090000001', when(now - 3 * H), '3 - Moderate', when(now - 0.5 * H), 'User cannot log in to the portal', 'Contact Number - Primary: 555 0100<br>Timezone: Asia/Manila<br>Error: access denied', 'Test Caller One', 'TC00001', 'New', A, '', 'VAGENT', 'Test Site 1'],
  ['INC0090000002', when(now - 2 * H), '4 - Low', when(now - 2 * H), 'Entitlement Hub shows an empty page', 'User sees nothing after login', 'Test Caller Two', 'TC00002', 'New', A, '', 'TC00002', 'Test Site 2'],
  ['INC0090000003', when(now - 1 * H), '3 - Moderate', when(now - 1 * H), 'Access request for a reporting tool', 'Original Intent: need access<br>#Traits: #EERS #Access', 'Test Caller Three', 'TC00003', 'New', B, '', 'VAGENT', 'Test Site 3'],
  ['INC0090000004', when(now - 5 * H), '4 - Low', when(now - 5 * H), 'EEMS dashboard is blank', 'EEMS is a different system', 'Test Caller Four', 'TC00004', 'New', A, '', 'TC00004', ''],
  ['INC0090000005', when(now - 4 * H), '4 - Low', when(now - 4 * H), 'My peers cannot see the shared folder', 'peers and engineers both affected', 'Test Caller Five', 'TC00005', 'New', A, '', 'VAGENT', 'Test Site 1'],
  ['INC0090000006', when(now - 6 * H), '3 - Moderate', when(now - 1.5 * H), 'Token not working', 'Being worked already', 'Test Caller Six', 'TC00006', 'In Progress', A, 'Bea Example', 'TC00006', 'Test Site 4'],
  ['INC0090000007', when(now - 7 * H), '3 - Moderate', when(now - 3 * H), 'Password reset loop', 'Assigned to someone outside the team', 'Test Caller Seven', 'TC00007', 'In Progress', B, 'Someone Elsewhere', 'TC00007', ''],
  ['INC0090000008', when(now - 0.7 * H), '4 - Low', when(now - 0.7 * H), '', '', 'Test Caller Eight', 'TC00008', 'New', A, '', 'VAGENT', ''],
  ['INC0090000009', when(now - 1.2 * H), '3 - Moderate', when(now - 1.2 * H), 'Host \\| access \\| locked --&gt; need "admin" rights', 'Original Intent: unlock<br><br>Any related reference numbers: N/A', 'Test Caller Nine', 'TC00009', 'New', B, '', 'VAGENT', 'Test Site 5'],
  ['REQ0000001', when(now - 1 * H), '4 - Low', when(now - 1 * H), 'A request, not an incident', '', 'Test Caller Ten', 'TC00010', 'New', A, '', 'TC00010', ''],
  ['INC0090000001', when(now - 3 * H), '3 - Moderate', when(now - 2.5 * H), 'User cannot log in to the portal (older copy)', '', 'Test Caller One', 'TC00001', 'New', A, '', 'VAGENT', 'Test Site 1'],
  ['INC0090000012', when(now - 30 * H), '2 - High', when(now - 26 * H), 'VPN drops every few minutes', 'Untouched since yesterday', 'Test Caller Twelve', 'TC00012', 'New', A, '', 'TC00012', 'Test Site 6'],
  ['INC0090000013', when(now - 0.2 * H), '1 - Critical', when(now - 0.2 * H), 'Whole site cannot sign in', 'Severity case', 'Test Caller Thirteen', 'TC00013', 'New', A, '', 'TC00013', 'Test Site 1'],
  ['INC0090000014', when(now - 2.2 * H), '3 - Moderate', when(now - 2.2 * H), 'Cannot open the app', 'User is missing entitlements for the role<br>Region: Test', 'Test Caller Fourteen', 'TC00014', 'New', B, '', 'VAGENT', ''],
  ['INC0090000015', when(now - 1.1 * H), '4 - Low', when(now - 1.1 * H), 'José from México cannot print', 'Contraseña temporal no funciona', 'José Prueba', 'TC00015', 'New', A, '', 'TC00015', 'Sitio Prueba'],
]
const cell = (v) => `"${String(v).replace(/"/g, '""')}"`
const csv = [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
fs.writeFileSync(path.join(out, 'incident-sample.csv'), csv, 'utf8')
fs.writeFileSync(path.join(out, 'incident-sample-cp1252.csv'), Buffer.from(csv, 'latin1')) // é, ñ fit in Windows-1252
console.log(`Wrote ${rows.length} rows to ${out}/incident-sample.csv and incident-sample-cp1252.csv`)
