// Writes a mock ServiceNow incident export that looks like the real one, for trying the
// Queue Management import without real data (e.g. away from the company device):
//   node tools/make-mock-export.mjs [out.csv]    (default: samples/incident-mock-export.csv)
//
// Same shape as the real export: 13 columns in the same order, every field quoted, dates
// as "YYYY-MM-DD HH:MM", priorities like "3 - Moderate", <br> line breaks, escaped pipes
// (\|), HTML entities, broken characters (�), the team's ticket templates (contact form,
// SOEID form, virtual-assistant form, marketplace status), Spanish tickets, mostly empty
// assigned_to, a few old tickets still open, entitlement (EERS) tickets and On Hold
// tickets on 3-Strike ("Contact attempt1/2").
//
// Everything is invented: people, IDs, phone numbers, groups, sites, order numbers and
// links (example.com). "Sample Analyst" and "Sample Lead" match data/roster.example.json,
// so tickets already assigned in ServiceNow are matched to the roster.
// Dates are relative to when you run it, so the file always looks like a fresh export.
import fs from 'fs'
import path from 'path'

const out = process.argv[2] || 'samples/incident-mock-export.csv'
const NOW = Date.now()
const H = 3600e3
const pad = (n) => String(n).padStart(2, '0')
const when = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` }
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, '.000Z')

// Deterministic "random", so the file only changes by its dates.
let seed = 20261112
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = (a) => a[Math.floor(rnd() * a.length)]

const GROUP = 'SC IAM OPS SUPPORT'
const GROUP2 = 'SC SECOPS TRIAGE AND DISPATCH SUPPORT'
const VA = 'VAGENT' // the virtual assistant's account in sys_created_by
const FIRST = ['Alex', 'Maria', 'Jonas', 'Priya', 'Tomas', 'Lena', 'Rafael', 'Mei', 'Omar', 'Sofia', 'Daniel', 'Aisha', 'Lucas', 'Hana', 'Diego', 'Nora', 'Ivan', 'Grace', 'Mateo', 'Yuki', 'Carmen', 'Felix', 'Anika', 'Pablo']
const LAST = ['Rivera', 'Kowal', 'Lindqvist', 'Nair', 'Okafor', 'Duarte', 'Fischer', 'Tan', 'Haddad', 'Moreno', 'Brandt', 'Ito', 'Castro', 'Novak', 'Reyes', 'Sato', 'Mendes', 'Varga', 'Quinn', 'Ortega']
const SITES = ['TEST TOWER 2', 'SAMPLE BUSINESS PARK B', 'Telecommuter Springfield', 'DEMO CAMPUS (BLDG A)', 'EXAMPLE PLAZA', 'SUC. CENTRO DEMO', 'Remote Worker Riverside', 'MOCK HQ CORNER', 'Remote Worker Lakeside', 'FICTION CENTRE 12B']
const TZS = ['Europe/Warsaw', 'Europe/London', 'US/Eastern', 'Asia/Singapore', 'IST', 'CST', 'Mexico', 'System (GMT)']
const person = () => { const f = pick(FIRST); const l = pick(LAST); return { name: `${f} ${l}`, soeid: `${f[0]}${l[0]}${String(10000 + Math.floor(rnd() * 89999))}`.toUpperCase() } }
const phone = () => `+1 555 01${pad(Math.floor(rnd() * 99))} ${String(1000 + Math.floor(rnd() * 8999))}`
const ws = () => `WS1496${String(10000 + Math.floor(rnd() * 89999))}`
const ITSM = 'https://itsm.example.com/sp?id=index'
const MKT = (o) => `https://marketplace.example.com/orders/detail/${o}-00001`

// The ticket templates seen in the real export.
const T = {
  contactForm: (who, tz, product, text) => `Classification: ${product}<br>Contact Number - Primary: ${phone()}<br>What is the best time to reach you?: ${pick(['8am to 12pm', '12pm to 4pm', '9am to 5pm'])}<br>Timezone: ${tz}<br>${text}`,
  soeidForm: (who, tz, issue, error, steps) => `SOEID: ${who.soeid}<br>Name: ${who.name}<br>Phone: ${phone()}<br>Domain: ${pick(['NAM', 'EMEA', 'APAC', 'LAC'])}<br>BTTC (Best time to Contact): ${pick(['9-6pm', '9:00 AM-5:00 PM', 'any time'])}<br>Work Schedule: Monday to Friday<br>Time Zone: ${tz}<br>Employee Type (Direct or Vendor): ${pick(['Direct', 'Vendor'])}<br>Hostname: H0${String(Math.floor(rnd() * 1e6)).padStart(6, '0')}TEST<br>Location (Remote or Office): ${pick(['Office', 'Remote'])}<br>Existing Ticket (Y/N): N<br>Last Time Working: NA<br>Issue: ${issue}<br>Error: ${error}<br>Troubleshooting:<br>>> ${steps.join('<br>>> ')}`,
  assistant: (intent, details, traits, app) => `Original Intent: ${intent}<br><br>Additional Details: ${details}<br><br>SCGeneral Data Form<br>Description: ${intent}<br>App Server System: ${pick(['System', 'Application', 'Server'])}<br>CSI: <br>Server System Info: <br>Model ID: ${person().soeid.toLowerCase()}<br>Region: ${pick(['NAM', 'Canada', 'Philippines', 'EMEA'])}<br>Link: <br><br><br>Application: ${app}<br>Any related reference numbers: N/A<br><br>#IamAssistant<br>#DomainNotIdentified<br>#Traits: ${traits}<br>#defaultRouting<br>#IntendedSnowGroup: ${GROUP}`,
  marketplace: (order, product, status, intent) => `Original Intent: ${intent}<br><br>Additional Details: ${order}-00001<br><br>Related request provided: Yes<br><br>Request Details Captured from the marketplace for ${order}-00001:<br>Product: ${product}<br>Last Active Step Name: ${product}<br>Last Active Step Status: ${status}<br>Assigned Team: N/A<br>Assigned Date: N/A<br>Due Date: ${iso(NOW + 3 * 24 * H)}<br>Is Automated: 1<br><br>#IamAssistant<br>#DomainNotIdentified<br>#Traits: #${status} #Access #Request #CMP<br>#defaultRouting<br>#IntendedSnowGroup: ${GROUP}`,
}

const rows = []
let n = 28837700
// add(): ageH = hours since opened, touchedH = hours since last update
function add({ ageH, touchedH, prio, short, desc, caller = person(), state = 'New', group = GROUP, assigned = '', createdBy, site }) {
  const opened = NOW - ageH * H
  const updated = Math.max(opened, NOW - touchedH * H)
  n += 1 + Math.floor(rnd() * 9000)
  rows.push([`INC00${n}`, when(opened), prio, when(updated), short, desc, caller.name, caller.soeid, state, group, assigned, createdBy || caller.soeid, site || pick(SITES)])
}
const P = { 2: '2 - High', 3: '3 - Moderate', 4: '4 - Low' }

// --- Contact-form tickets ---
for (const [tz, product, text, p] of [
  ['Europe/Warsaw', 'Marketplace Product(CMP Product)', 'I have opened a cmp to register a new device for the authenticator but time has expired and when i tried again it wont allow me to submit a new one saying "no devices registered"', 4],
  ['Europe/London', 'Identity and Access Management', '- Full name of the application - Sample Certificate Portal<br>- Related region/country EMEA/UK/London<br>- Link you are using (if web-based) ' + 'https://idp.example.com/authorize?scope=openid&amp;state=abc123', 3],
  ['US/Eastern', 'Marketplace Product(CMP Product)', 'Two users are missing a function in the disputes tool. Please escalate and send this ticket to the tool team as this is a job critical function causing client impact.', 4],
  ['Asia/Singapore', 'Provided Desktop/Laptop/Cloud Desktop', 'Hi, I am opening a ticket on behalf of a colleague. The SSO test URL redirects to the vendor application but returns an error page. Other coworkers are not experiencing this issue.', 4],
  ['System (GMT)', 'Marketplace Product(CMP Product)', 'SIN FACULTAD PARA COTIZAR Y REALIZAR SEGUROS.', 4],
]) {
  const who = person()
  add({ ageH: 2 + rnd() * 20, touchedH: rnd() * 4, prio: P[p], short: `\\| ${tz}`, desc: T.contactForm(who, tz, product, text), caller: who })
}

// --- SOEID-form tickets ---
for (const [short, issue, error, steps, tz, p] of [
  ['LAC/VDI/Unable to access with Travel ID', 'User needs assistance for logging using Travel ID for the security card', 'Access Denied', ['User is given the instructions', 'User tries to login one more time', 'User is not able to access with the Travel ID'], 'Mexico', 4],
  ['Unable to login- Account locked', 'User reports she is not able to access teams or outlook<br>*teams messages do not get sent', 'teams error ** authentication failed', ['Change domain password', 'closed vdi', 'Reopen vdi authentication failed'], 'Eastern', 2],
  ['Proxy installation', 'I would like the proxy client on my vdi so I can access certain webpages', '', ['Checked policy', 'Escalated'], 'Eastern TIME ZONE', 4],
  ['MX-BNMX- TRACKING NUMER WS149661181', 'Tracking number for the security card', 'Fault: Tracking number missing', ['Perimeter \\\\ #BNMX'], 'Mexico', 3],
  ['MX-BNMX- TRACKING NUMER WS149679833', 'Tracking number for the security card', 'Fault: Tracking number missing', ['Perimeter \\\\ #BNMX'], 'Mexico', 3],
  ['CMP overdue / NGT 176028', 'the user have a marketplace stuck on approved team 2.<br>But its over due date.', '', ['>WS148887740-00001', '>Ordered Date: 10/10/2026 08:49 / Due Date: 10/13/2026 15:00', '>Escalate CMP overdue'], 'NY', 4],
]) {
  const who = person()
  add({ ageH: 1 + rnd() * 30, touchedH: rnd() * 6, prio: P[p], short, desc: T.soeidForm(who, tz, issue, error, steps), caller: who })
}

// --- Virtual-assistant tickets (sys_created_by = the assistant) ---
for (const [short, intent, details, traits, app, p] of [
  ['This is on my VDI \\|\\| Error, Login, Access', 'My copilot access is not working', 'error message', '#Error #Login #Access', 'This is on my VDI', 3],
  ['I am having host --&gt;host01.nam.example.net \\|\\| Host, Raise, Access', 'I need help in raising access to server host01.nam.example.net', 'I need a live assistant', '#Host #Raise #Access', 'host01', 3],
  ['sso \\|\\| SSO, Password', 'tengo problemas para ingresar mi sso, d�nde lo reporto?', 'SSO no reconoce la clave temporal, as� que no tengo sso para los procesos', '#SSO #Password', 'sso', 3],
  ['WAIS \\|\\| Site, Access, Account, Locked', 'my account is locked CODE1014 USER ACCOUNT LOCKED. UNABLE TO PERFORM ACTION', 'the screenshot uploaded', '#Site #Access #Account #Locked', 'WAIS', 3],
  ['User is having problems with GLOBAL IDENTITY AND ACCESS MANAGEMENT', 'Unable to locate the account', 'CAN YOU PLEASE GIVE ME A LIVE AGENT FOR MY ISSUE?', '#Agent #Issue', 'Identity Manager', 3],
]) add({ ageH: 0.5 + rnd() * 12, touchedH: rnd() * 2, prio: P[p], short, desc: T.assistant(intent, details, traits, app), createdBy: VA })

// --- Marketplace status tickets ---
for (const [product, status, intent, p] of [
  ['Desktop Software Request', 'Completed', 'Need to raise an INC with tech team since we have an issue in the reporting application', 3],
  ['AD Management - Group Membership', 'Completed', "how long after the cmp for 'AD Management - Group Membership' will the change be completed? I still only have 'view' access instead of 'edit'.", 3],
  ['eSALES - Account Management (Automation)', 'Cancelled', 'I raised a CMP ticket but it got cancelled. Can you check why?', 3],
  ['FORCE - Modify ID', 'Completed', 'the ticket is completed and I do not see approval function in prod', 3],
]) {
  const o = ws()
  add({ ageH: 1 + rnd() * 18, touchedH: rnd() * 3, prio: P[p], short: `${pick(['IAM SubDomain: Wintel', 'IAM SubDomain: ICG 2', ''])}${' \\|\\| '}${o} \\|\\| Status: ${status} \\|\\| ${product}`, desc: T.marketplace(o, product, status, intent) + `<br>Link: ${MKT(o)}`, createdBy: VA })
}

// --- Entitlement tickets (EERS) ---
for (const [short, desc, p] of [
  ['NAM \\| EEMS Entitlement Hub', "AFFECTED USER's DETAILS<br>Issue detailed description : User's CMP# WS4566410 to access the Entitlement Hub is completed but still when user accesses it only sees an empty page.", 3],
  ['Cannot open the app', 'User is missing entitlements for the role<br>Region: Test', 3],
  ['Entitlement review request \\| quarterly access review', 'Please re-certify the entitlements listed in the attached file.', 4],
]) add({ ageH: 1 + rnd() * 10, touchedH: rnd() * 3, prio: P[p], short, desc })

// --- Spanish tickets with broken characters ---
for (const [short, desc] of [
  ['[MTG0912]Mx - Desktop - Problemas con el WiFi', 'Nombre/Name: Prueba Ejemplo<br>Ubicaci�n/Location/SIRH: Casa<br>Horario/Schedule: 09 - 19<br>Ticket: Nuevo<br>Usuario comenta que tiene problemas con el WiFi, no puede hacer conexi�n a su red dom�stica.'],
  ['Sin acceso a Jira ni Confluence', 'Inicialmente se levantaron 3 Cmps:<br><br>-- Employee External Internet SaaS Access<br>Despu�s de reiniciar el equipo, me mostr� una pantalla de error y no pude ingresar a Confluence ni a Jira.'],
  ['LAC / CMP / PROYECT TRACKING SYSTEM ERROR EN DATOS', 'Usuario intenta solicitar el CMP Project Tracking System sin embargo el sistema no le permite seleccionar el rol.<br>Error: NO ROL DISPONIBLE'],
]) add({ ageH: 2 + rnd() * 20, touchedH: rnd() * 5, prio: P[pick([3, 4])], short, desc, group: pick([GROUP, GROUP2]), site: pick(['SUC. CENTRO DEMO', 'EDIF. EJEMPLO 8', 'SUC. PLAZA PRUEBA']) })

// --- Second group, already assigned in ServiceNow, old tickets still open ---
add({ ageH: 7 * 24, touchedH: 0.5, prio: P[4], short: 'User is unable to access the UAT SSO URL', desc: 'This SSO URL redirects to the vendor application. The user can reach the vendor URL but gets errors in Edge and Chrome.', group: GROUP2 })
add({ ageH: 24 * 24, touchedH: 1, prio: P[4], short: 'CBNA / CMP overdue / NGT 176028', desc: 'the user have a marketplace stuck on approved team 2.<br>But its over due date.', group: GROUP2 })
add({ ageH: 5, touchedH: 1.5, prio: P[3], short: 'Token not working', desc: 'Being worked already', state: 'In Progress', assigned: 'Sample Analyst' })
add({ ageH: 8, touchedH: 3, prio: P[3], short: 'Password reset loop', desc: 'Assigned to someone outside the team', state: 'In Progress', assigned: 'Someone Elsewhere', group: GROUP2 })
add({ ageH: 26, touchedH: 25, prio: P[2], short: 'VPN drops every few minutes', desc: 'Untouched since yesterday' })
add({ ageH: 0.3, touchedH: 0.3, prio: '1 - Critical', short: 'Whole site cannot sign in', desc: 'Severity case' })

// --- On Hold, waiting on the end user (3-Strike) ---
add({ ageH: 30, touchedH: 20, prio: P[3], short: 'Contact attempt1 - Unable to access shared mailbox', desc: 'Details requested from the user using the further information template.', state: 'On Hold', assigned: 'Sample Analyst' })
add({ ageH: 55, touchedH: 22, prio: P[4], short: 'Contact attempt2 - Printer mapping missing', desc: 'Possible fix provided; asked the user to confirm if the issue is resolved.', state: 'On Hold' })

const head = ['number', 'opened_at', 'priority', 'sys_updated_on', 'short_description', 'description', 'caller_id', 'caller_id.user_name', 'state', 'assignment_group', 'assigned_to', 'sys_created_by', 'location']
const cell = (v) => `"${String(v).replace(/"/g, '""')}"`
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n', 'utf8')
console.log(`Wrote ${rows.length} mock incidents to ${out}`)
