// Headless-Chrome check for Scope Lite (dev only, needs Node 22+ and Chrome):
//   Chrome --headless=new --remote-debugging-port=9333 --user-data-dir=<tmp>
//   node tools/check.mjs <url> <script.js> [shot.png] [width]
// Opens a fresh tab, runs script.js in the page (await allowed, `return` a value),
// prints the result plus any errors, optionally saves a screenshot, closes the tab.
import fs from 'fs'
const [url, scriptPath, shot, width = '1440'] = process.argv.slice(2)
const tab = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json()
const ws = new WebSocket(tab.webSocketDebuggerUrl)
let id = 0; const pending = {}; const logs = []
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id] }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text))
  if (d.method === 'Runtime.consoleAPICalled' && ['error','warning'].includes(d.params.type)) logs.push(d.params.type + ' ' + d.params.args.map(a => a.value ?? a.description).join(' ')) }
await new Promise((r) => (ws.onopen = r))
const send = (method, params = {}) => new Promise((r) => { pending[++id] = r; ws.send(JSON.stringify({ id, method, params })) })
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: +width, height: 900, deviceScaleFactor: 1, mobile: false })
{ await send('Page.navigate', { url }); await new Promise((r) => setTimeout(r, 1500)) }
const code = fs.readFileSync(scriptPath, 'utf8')
const res = await send('Runtime.evaluate', { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true })
console.log(JSON.stringify(res.result?.result?.value ?? res.result?.exceptionDetails?.exception?.description ?? res, null, 1))
if (shot) { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(shot, Buffer.from(s.result.data, 'base64')) }
if (logs.length) console.log('LOGS:\n' + logs.join('\n'))
ws.close()
await fetch('http://127.0.0.1:9333/json/close/' + tab.id)
