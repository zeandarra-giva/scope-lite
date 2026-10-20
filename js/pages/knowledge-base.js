// Knowledge Base page, ported from src/pages/KnowledgeBase.jsx.
// Library (grid or list of page cards, folders, one page open at a time) and
// Health (conflicts, gaps, index problems, review). Publishing indexes a page
// after a short delay (kbIndexed); until then Copilot keeps the last good version.
//
// Deep links: S.nav('kb', { kbPage: id }) opens a page, { create: title, code }
// opens "New page" pre-filled, { tab: 'health' } picks a tab. (The React prototype
// passed { page: id }, which collides with the route's own page id.)
;(function () {
  const { html, cls, attrs, icon, storage, DAY, fmtDate, fmtDateTime, fmtTime,
    ATTACH_TYPES, DATA_SOURCES, PAGE_KINDS, REVIEW_AFTER_DAYS, findConflicts, findGaps, isDirty, pageStatus, reviewDue } = S

  let seq = 0
  const newId = (p) => `${p}-${Date.now().toString(36)}${++seq}`
  const INDEX_MS = 1400

  // Reads an attached file into an editable text block. TXT and CSV are read
  // for real; PDF, Word and image text extraction (OCR) is simulated here.
  function readFile(file) {
    const ext = file.name.split('.').pop().toLowerCase()
    const type = { pdf: 'PDF', doc: 'DOC', docx: 'DOCX', txt: 'TXT', csv: 'CSV', png: 'Image', jpg: 'Image', jpeg: 'Image' }[ext] || ext.toUpperCase()
    const size = file.size < 1024 ? `${file.size} B` : file.size < 1048576 ? `${Math.round(file.size / 1024)} KB` : `${(file.size / 1048576).toFixed(1)} MB`
    const base = { id: newId('att'), name: file.name, type, size }
    return new Promise((resolve) => {
      if (ext === 'txt' || ext === 'csv') {
        const r = new FileReader()
        r.onload = () => resolve({ ...base, text: String(r.result).slice(0, 6000) })
        r.onerror = () => resolve({ ...base, text: '' })
        r.readAsText(file)
      } else if (!file.size) resolve({ ...base, text: '' })
      else resolve({ ...base, text: type === 'Image' ? `Text read from ${file.name} with OCR (simulated in the prototype). Replace this with what the image shows.` : `Text extracted from ${file.name} (simulated in the prototype). Replace this with the document's content.` })
    })
  }

  const me = () => S.currentUser(S.state)
  const pageById = (id) => S.state.kb.pages.find((p) => p.id === id)
  // The route's page to open (route.kbPage).
  const routePage = (route) => route.kbPage && S.state.kb.pages.find((p) => p.id === route.kbPage)
  const seedFromRoute = (route) => (route.create ? { title: route.create, codes: route.code ? [route.code] : [] } : null)

  // Page state. Everything under 'p:kb:lib' belongs to the Library tab and
  // resets when it unmounts (switching to Health), like the React component.
  const top = () => S.ui('p:kb', () => {
    const kb = S.state.kb
    const first = routePage(S.route)
    return {
      tab: S.route.tab || 'library',
      kbId: (first && first.kbId) || (kb.kbs.find((k) => k.isDefault) || kb.kbs[0]).id,
      pageId: (first && first.id) || null,
      creating: seedFromRoute(S.route),
    }
  })
  const LIB = 'p:kb:lib'
  const lib = () => S.ui(LIB, () => ({ q: '', chip: 'all', folderId: null, view: storage.get(VIEW_KEY) || 'grid', modal: null }))
  const pv = (id) => S.ui(`${LIB}:pv:${id}`, () => { const p = pageById(id); return { editing: !!p && !p.live && !p.draft.body, view: 'draft', confirmDel: false } })
  const dt = (id) => S.ui(`${LIB}:dt:${id}`, { edit: false })

  const open = (p) => {
    const t = top()
    if (t.tab !== 'library') S.resetUi(LIB)
    S.set(t, { kbId: p.kbId, pageId: p.id, tab: 'library' })
  }

  S.pages.kb = function KnowledgeBase() {
    const state = S.state
    const kb = state.kb
    const t = top()

    const conflicts = findConflicts(kb)
    const gaps = findGaps(kb, state.history, state.now).filter((g) => g.uses > 0)
    const stale = kb.pages.filter((p) => reviewDue(p, state.now))
    const failed = kb.pages.filter((p) => p.index === 'failed')
    const live = kb.pages.filter((p) => p.live)
    const dirty = kb.pages.filter((p) => p.live && isDirty(p))
    const issues = conflicts.length + gaps.length + stale.length + failed.length

    return html`
      <section class="grid g-kpi">
        ${S.kpi({ label: 'Published pages', icon: 'doc', value: live.length, unit: `of ${kb.pages.length}`, foot: `${kb.pages.length - live.length} draft only · ${kb.kbs.length} knowledge bases`,
          info: html`<span>Pages with at least one published, indexed version. Copilot searches only these.</span><span>A draft-only page is invisible to Copilot until a team lead publishes it.</span>` })}
        ${S.kpi({ label: 'Index health', icon: 'check', tone: 'azure', state: failed.length ? 'warn' : undefined, value: kb.pages.filter((p) => p.index === 'indexed').length, unit: 'indexed',
          foot: failed.length ? `${failed.length} failed · Copilot keeps the last good version` : 'Every published page is indexed',
          info: html`<span>Publishing splits a page into passages and indexes them for search.</span><span>If indexing fails, the page shows <b>Index failed</b> and Copilot keeps using the last version that indexed, so a bad edit can't break answers.</span>` })}
        ${S.kpi({ label: 'Unpublished changes', icon: 'clip', tone: 'ice', value: dirty.length, foot: `${kb.pages.filter((p) => p.review).length} waiting for review`,
          info: html`<span>Published pages with draft edits Copilot can't see yet. Analysts request a review; a team lead publishes.</span>` })}
        ${S.kpi({ label: 'Needs attention', icon: 'alert', tone: 'navy', state: issues ? 'warn' : 'good', value: issues, foot: `${conflicts.length} conflicts · ${gaps.length} gaps · ${stale.length} review due`,
          info: html`<span>Sum of: conflicting SLA targets, resolution codes used in the last 30 days without a published runbook, pages not reviewed for ${REVIEW_AFTER_DAYS} days, and failed indexes.</span>` })}
      </section>
      ${S.tabs([
        { id: 'library', label: 'Library', icon: 'book', count: kb.pages.length },
        { id: 'health', label: 'Health', icon: 'shield', count: issues },
      ], t.tab, 'kb.tab')}
      ${t.tab === 'library' && library(t)}
      ${t.tab === 'health' && health({ conflicts, gaps, stale, failed })}
      ${t.creating && newPage(t.creating, t.kbId)}`
  }

  // ---------- Library ----------
  // A grid of page cards (or a list), filtered by chips and search. Opening a
  // card shows the page; "Library" goes back to the grid.
  const VIEW_KEY = 'scope-kb-view'
  const CHIPS = [['all', 'All'], ['recent', 'Recent'], ['folders', 'Folders'], ['data', 'Data tables'], ['attention', 'Needs attention']]
  // First lines of a page with the markup stripped, for card previews.
  const preview = (body) => body.split('\n').filter((l) => l.trim() && !l.startsWith('## ')).map((l) => l.replace(/^([-*]|\d+\.)\s+/, '').replace(/\*\*|`/g, '')).join(' · ')

  function library(t) {
    const state = S.state
    const kb = state.kb
    const leadRole = state.role === 'lead'
    const u = lib()
    const { kbId, pageId } = t
    const { q, chip, folderId, view } = u
    const menu = S.pop === 'kb-new'

    const cur = kb.kbs.find((k) => k.id === kbId)
    const folders = kb.folders.filter((f) => f.kbId === kbId)
    const linked = state.copilot.config.kbIds.includes(kbId)
    const conflictIds = new Set(findConflicts(kb).flatMap((c) => c.off.map((o) => o.page.id)))
    const attention = (p) => p.index === 'failed' || !p.live || isDirty(p) || reviewDue(p, state.now) || conflictIds.has(p.id)
    const all = kb.pages.filter((p) => p.kbId === kbId)
    let pages = all.filter((p) => !q || `${p.draft.title} ${p.codes.join(' ')} ${p.kind} ${p.draft.body}`.toLowerCase().includes(q.toLowerCase()))
    if (folderId) pages = pages.filter((p) => p.folderId === folderId)
    if (chip === 'data') pages = pages.filter((p) => p.data)
    if (chip === 'attention') pages = pages.filter(attention)
    pages = chip === 'recent' ? [...pages].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12) : [...pages].sort((a, b) => a.draft.title.localeCompare(b.draft.title))
    const folder = folders.find((f) => f.id === folderId)
    const page = kb.pages.find((p) => p.id === pageId)
    const showFolders = chip === 'folders' && !folderId && !q
    const newSeed = S.json({ title: '', folderId: folderId || undefined })

    if (page) {
      return html`
        <div class="row">
          <button class="btn ghost sm" data-click="kb.back">${icon('chevL', 14)}Library</button>
          <span class="muted small">${(kb.kbs.find((k) => k.id === page.kbId) || {}).name} / ${(kb.folders.find((f) => f.id === page.folderId) || {}).name}</span>
        </div>
        ${pageView(page)}`
    }
    if (u.modal === 'kb') newKb()
    if (u.modal === 'folder') newFolder(kbId)
    return html`
      <div class="kb-toolbar">
        <select id="kb-pick" class="in kb-select" data-change="kb.pickKb" aria-label="Knowledge base">
          ${kb.kbs.map((k) => html`<option value="${k.id}" ${attrs({ selected: k.id === kbId })}>${k.name}</option>`)}
        </select>
        <div class="kb-chips" role="group" aria-label="Show">
          ${CHIPS.map(([id, label]) => html`<button aria-pressed="${chip === id}" data-click="kb.chip" data-v="${id}">${label}</button>`)}
        </div>
        <div class="kb-tools">
        <div class="view-toggle" role="group" aria-label="Layout">
          <button aria-pressed="${view === 'grid'}" aria-label="Grid view" title="Grid view" data-click="kb.view" data-v="grid">${icon('grid', 16)}</button>
          <button aria-pressed="${view === 'list'}" aria-label="List view" title="List view" data-click="kb.view" data-v="list">${icon('list', 16)}</button>
        </div>
        <label class="kb-search">${icon('search', 16)}<input id="kb-filter" placeholder="Search library" value="${q}" data-input="kb.q" aria-label="Search library"></label>
        <div class="pop-anchor" data-pop-anchor="kb-new">
          <button class="btn primary" data-click="kb.menu" aria-haspopup="menu" aria-expanded="${menu}">${icon('plus', 15)}New${icon('chevDown', 14)}</button>
          ${menu && html`
            <div class="popover new-menu" role="menu">
              <button role="menuitem" class="menu-item" data-click="kb.create" data-arg="${newSeed}">${icon('doc', 16)}Page</button>
              ${leadRole && html`<button role="menuitem" class="menu-item" data-click="kb.modal" data-v="folder">${icon('folder', 16)}Folder</button>`}
              ${leadRole && html`<button role="menuitem" class="menu-item" data-click="kb.modal" data-v="kb">${icon('book', 16)}Knowledge base</button>`}
            </div>`}
        </div>
        </div>
      </div>
      <div class="row small">
        ${folder
          ? html`<button class="btn ghost sm" data-click="kb.folder" data-v="">${icon('chevL', 14)}Folders</button><b>${folder.name}</b><span class="muted">${pages.length} pages</span>`
          : html`<span class="ink2">${cur.desc}</span>`}
        <span class="spacer"></span>
        <span class="pill ${linked ? 'accent' : 'plain'}">${icon('spark', 12)}${linked ? 'Linked to Copilot' : 'Not linked to Copilot'}</span>
      </div>

      ${showFolders ? html`
        <div class="kb-grid">
          ${folders.map((f) => {
            const fp = all.filter((p) => p.folderId === f.id)
            const att = fp.filter(attention).length
            return html`
              <button class="kb-card" data-key="f-${f.id}" data-click="kb.folder" data-v="${f.id}">
                <div class="kb-card-h">${icon('folder', 16)}<span class="t">${f.name}</span></div>
                <div class="kb-card-b kb-card-folder">
                  ${icon('folderOpen', 44, { stroke: 1.4 })}
                  <ul>${fp.slice(0, 3).map((p) => html`<li>${p.draft.title}</li>`)}</ul>
                </div>
                <div class="kb-card-f"><span class="muted">${fp.length} page${fp.length === 1 ? '' : 's'}</span><span class="spacer"></span>${att > 0 && html`<span class="pill warn xs">${att} need attention</span>`}</div>
              </button>`
          })}
          ${leadRole && html`<button class="kb-card kb-card-new" data-key="new-folder" data-click="kb.modal" data-v="folder">${icon('plus', 22)}New folder</button>`}
        </div>`
      : view === 'grid' ? html`
        <div class="kb-grid">
          ${pages.map((p) => pageCard(p, folders.find((f) => f.id === p.folderId), conflictIds.has(p.id)))}
          ${!q && chip === 'all' && html`<button class="kb-card kb-card-new" data-key="new-page" data-click="kb.create" data-arg="${newSeed}">${icon('plus', 22)}New page</button>`}
        </div>`
      : html`
        <section class="card">
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Page</th><th>Folder</th><th>Type</th><th>Status</th><th>Copilot reads</th><th>Last edited</th></tr></thead>
              <tbody>
                ${pages.map((p) => {
                  const st = pageStatus(p)
                  return html`
                    <tr class="click" data-key="${p.id}" data-click="kb.openId" data-v="${p.id}">
                      <td><span class="row tight" style="flex-wrap:nowrap">${icon(p.data ? 'table' : 'doc', 14)}<b>${p.draft.title}</b></span></td>
                      <td class="nowrap small">${(folders.find((f) => f.id === p.folderId) || {}).name}</td>
                      <td class="nowrap small">${p.kind}</td>
                      <td class="nowrap"><span class="pill ${st.tone}">${st.label}</span>${p.live && isDirty(p) && st.id !== 'indexing' && html`<span class="pill plain" style="margin-left:4px">Edited</span>`}</td>
                      <td class="nowrap small">${p.live ? `v${p.live.version} · ${fmtDate(p.live.at)}` : html`<span class="muted">Nothing yet</span>`}</td>
                      <td class="nowrap small">${fmtDate(p.updatedAt)} · ${p.updatedBy}</td>
                    </tr>`
                })}
              </tbody>
            </table>
          </div>
        </section>`}
      ${!showFolders && !pages.length && html`<div class="empty">${q ? `Nothing in ${cur.name} matches “${q}”.` : 'No pages here yet.'}</div>`}`
  }

  function pageCard(p, folder, conflict) {
    const st = pageStatus(p)
    return html`
      <button class="kb-card" data-key="${p.id}" data-click="kb.openId" data-v="${p.id}">
        <div class="kb-card-h">${icon(p.data ? 'table' : 'doc', 16)}<span class="t">${p.draft.title}</span></div>
        <div class="kb-card-b">
          ${p.data ? html`
            <div class="kb-card-table">
              ${p.data.rows.slice(0, 4).map((r) => html`<div><span>${r.cells[0]}</span><span class="muted">${r.cells[1]}</span></div>`)}
              ${p.data.rows.length > 4 && html`<span class="muted">+${p.data.rows.length - 4} more rows</span>`}
            </div>` : html`<p class="kb-card-prev">${preview(p.draft.body) || 'Empty page'}</p>`}
          ${p.codes.length > 0 && html`<div class="row tight">${p.codes.map((c) => html`<span class="code-chip">${c}</span>`)}</div>`}
        </div>
        <div class="kb-card-f">
          <span class="pill ${st.tone} xs">${st.id === 'indexing' && html`<span class="dot live" style="background:var(--accent)"></span>`}${st.label}</span>
          ${p.live && isDirty(p) && st.id !== 'indexing' && html`<span class="pill plain xs">Edited</span>`}
          ${p.data && html`<span class="pill good xs">Live data</span>`}
          ${(conflict || reviewDue(p, S.state.now)) && html`<span class="pill warn xs">${conflict ? 'Conflict' : 'Review due'}</span>`}
          <span class="spacer"></span>
          <span class="muted nowrap">${folder && folder.name}${p.live ? ` · v${p.live.version}` : ''}</span>
        </div>
      </button>`
  }

  function pageView(page) {
    const state = S.state
    const leadRole = state.role === 'lead'
    const u = pv(page.id)
    const { editing, view, confirmDel } = u
    const st = pageStatus(page)
    const dirty = isDirty(page)
    const folders = state.kb.folders.filter((f) => f.kbId === page.kbId)
    const linked = state.copilot.config.kbIds.includes(page.kbId)
    const shown = view === 'live' && page.live ? page.live : page.draft
    const id = page.id

    return html`
      <div class="card kb-page" data-key="kbp-${id}">
        <div class="card-h" style="align-items:flex-start">
          <div class="stack" style="gap:6px;flex:1;min-width:220px">
            <div class="row tight">
              <span class="pill ${st.tone}">${st.id === 'indexing' && html`<span class="dot live" style="background:var(--accent)"></span>`}${st.label}</span>
              ${page.live && dirty && st.id !== 'indexing' && html`<span class="pill accent">Unpublished changes</span>`}
              ${page.review && html`<span class="pill warn">Review requested by ${page.review.by}</span>`}
              ${reviewDue(page, state.now) && html`<span class="pill warn">Review due</span>`}
              <span class="pill plain">${page.kind}</span>
            </div>
            ${editing ? html`<input id="kb-title" class="in kb-title-in" value="${page.draft.title}" data-input="kb.title" data-v="${id}" aria-label="Page title">`
              : html`<h2>${shown.title}</h2>`}
          </div>
          <div class="row">
            ${page.live && dirty && !editing && segView(view, id)}
            <button class="btn sm" data-click="kb.edit" data-v="${id}">${icon(editing ? 'check' : 'edit', 14)}${editing ? 'Done' : 'Edit'}</button>
            ${leadRole
              ? html`<button class="btn sm primary" ${attrs({ disabled: st.id === 'indexing' || (!dirty && st.id !== 'failed') })} data-click="kb.publish" data-v="${id}">${icon('upload', 14)}${st.id === 'failed' ? 'Retry publish' : 'Publish'}</button>`
              : html`<button class="btn sm primary" ${attrs({ disabled: !dirty || !!page.review })} data-click="kb.review" data-v="${id}">${icon('send', 14)}${page.review ? 'Review requested' : 'Request review'}</button>`}
          </div>
        </div>
        <div class="card-b stack lg">
          <div class="small ink2">
            ${page.live
              ? html`Copilot reads <b>v${page.live.version}</b>, published ${fmtDate(page.live.at)} by ${page.live.by}${linked ? '' : ', but this knowledge base is not linked to Copilot'}. Last edited ${fmtDateTime(page.updatedAt)} by ${page.updatedBy}.`
              : html`Copilot can't see this page until it's published. Last edited ${fmtDateTime(page.updatedAt)} by ${page.updatedBy}.`}
          </div>
          ${st.id === 'indexing' && html`<div class="callout accent small">${icon('refresh', 15)}<span>Indexing… ${page.live ? `Copilot keeps using v${page.live.version} until this finishes.` : 'The page becomes searchable when this finishes.'}</span></div>`}
          ${st.id === 'failed' && html`<div class="callout crit small">${icon('alert', 15)}<span><b>Index failed:</b> ${page.indexError} ${page.live && `Copilot keeps using v${page.live.version}, the last version that indexed.`}</span></div>`}
          ${page.review && leadRole && dirty && html`<div class="callout warn small">${icon('user', 15)}<span>${page.review.by} asked you to review these changes. Compare the draft with the published version, then publish.</span></div>`}

          ${editing && html`
            <div class="form-grid">
              <label class="field"><span>Type</span><select id="kb-kind" class="in" data-change="kb.meta" data-f="kind" data-v="${id}">${PAGE_KINDS.map((k) => html`<option ${attrs({ selected: page.kind === k })}>${k}</option>`)}</select></label>
              <label class="field"><span>Folder</span><select id="kb-folder" class="in" data-change="kb.meta" data-f="folderId" data-v="${id}">${folders.map((f) => html`<option value="${f.id}" ${attrs({ selected: page.folderId === f.id })}>${f.name}</option>`)}</select></label>
              <label class="field"><span>Add a resolution code</span>
                <select id="kb-code" class="in" data-change="kb.addCode" data-v="${id}">
                  <option value="" selected>Choose a code…</option>
                  ${state.codes.filter((c) => !page.codes.includes(c.code)).map((c) => html`<option value="${c.code}">${c.code} · ${c.title}</option>`)}
                </select>
              </label>
            </div>`}
          ${page.codes.length > 0 && html`
            <div class="row tight">
              <span class="muted small">Resolution codes</span>
              ${page.codes.map((c) => html`<span class="code-chip" data-key="code-${c}">${c}${editing && html`<button class="pill-x" aria-label="Remove ${c}" data-click="kb.rmCode" data-v="${id}" data-code="${c}">${icon('x', 10)}</button>`}</span>`)}
            </div>`}

          ${editing ? html`
            <label class="field"><span>Content <span class="hint">## heading · - bullet · 1. step · **bold**</span></span>
              <textarea id="kb-body" class="in kb-body-in" data-input="kb.body" data-v="${id}" placeholder="What happens, how to fix it, when to escalate.">${page.draft.body}</textarea>
            </label>` : S.docText(shown.body || 'This page is empty.', 'kb-doc')}

          <div class="stack">
            <div class="row"><span class="section-title">Files</span><span class="muted small">PDF, Word, TXT, CSV or images. The text read from a file is what Copilot searches, so check it.</span><span class="spacer"></span>
              <label class="btn sm file-btn">${icon('upload', 14)}Attach file<input type="file" accept="${ATTACH_TYPES}" multiple data-change="kb.attach" data-v="${id}"></label>
            </div>
            ${!shown.attachments.length && html`<span class="muted small">No files attached.</span>`}
            ${shown.attachments.map((a) => html`
              <div class="kb-attach" data-key="${a.id}">
                <div class="row tight">${icon('doc', 14)}<b class="small">${a.name}</b><span class="muted small">${a.type} · ${a.size}</span>
                  ${!a.text.trim() && html`<span class="pill crit">No text read</span>`}
                  <span class="spacer"></span>
                  ${editing && view === 'draft' && html`<button class="btn ghost sm" data-click="kb.rmAtt" data-v="${id}" data-att="${a.id}">${icon('trash', 13)}Remove</button>`}
                </div>
                ${editing && view === 'draft'
                  ? html`<textarea class="in" aria-label="Text from ${a.name}" data-input="kb.attText" data-v="${id}" data-att="${a.id}" placeholder="No text could be read from this file. Type the content here.">${a.text}</textarea>`
                  : html`<pre class="kb-extract">${a.text || 'No text could be read from this file.'}</pre>`}
              </div>`)}
          </div>

          ${page.data ? dataTable(page) : editing && html`
            <button class="btn sm" style="align-self:flex-start" data-click="kb.addData" data-v="${id}">
              ${icon('table', 14)}Add a data table
            </button>`}

          <div class="stack">
            <div class="row"><span class="section-title">Internal notes</span><span class="pill plain">${icon('lock', 11)}Never shown to Copilot or indexed</span></div>
            <textarea id="kb-note" class="in" placeholder="Context for the team: why a step exists, who to ask, history." data-input="kb.note" data-v="${id}">${page.note}</textarea>
          </div>

          <hr class="sep">
          <div class="row small">
            ${page.codes.length > 0 && html`<button class="btn ghost sm" data-click="kb.go" data-v="explorer" data-tab="codes">${icon('book', 14)}Resolution codes</button>`}
            <button class="btn ghost sm" data-click="kb.go" data-v="copilot">${icon('spark', 14)}Ask Copilot</button>
            <span class="spacer"></span>
            ${page.live && dirty && leadRole && html`<button class="btn ghost sm" data-click="kb.discard" data-v="${id}">Discard draft</button>`}
            ${leadRole && !page.live && (confirmDel
              ? html`<span class="muted">Delete this draft?</span><button class="btn sm danger" data-click="kb.delete" data-v="${id}">Delete</button><button class="btn ghost sm" data-click="kb.confirmDel" data-v="${id}" data-on="">Keep</button>`
              : html`<button class="btn ghost sm danger" data-click="kb.confirmDel" data-v="${id}" data-on="1">${icon('trash', 13)}Delete draft</button>`)}
          </div>
        </div>
      </div>`
  }

  function segView(view, id) {
    return html`
      <div class="seg" role="group" aria-label="Version">
        <button aria-pressed="${view === 'draft'}" data-click="kb.version" data-v="${id}" data-ver="draft">Draft</button>
        <button aria-pressed="${view === 'live'}" data-click="kb.version" data-v="${id}" data-ver="live">Published</button>
      </div>`
  }

  // Structured, exact data (owners, on-call, contacts). Copilot queries it
  // with query_data instead of text search, and edits apply immediately.
  function dataTable(page) {
    const { edit } = dt(page.id)
    const d = page.data
    const id = page.id
    return html`
      <div class="stack">
        <div class="row">
          <span class="section-title">Data table</span>
          <span class="pill good"><span class="dot live"></span>Live</span>
          <span class="muted small">Copilot reads current values with <span class="mono">query_data</span>. No publish needed.</span>
          <span class="spacer"></span>
          <select class="in sm" aria-label="Data source" data-change="kb.dataSource" data-v="${id}">${DATA_SOURCES.map((s) => html`<option ${attrs({ selected: d.source === s })}>${s}</option>`)}</select>
          ${d.source !== 'Manual' && html`<button class="btn sm" data-click="kb.dataSync" data-v="${id}">${icon('refresh', 14)}Sync now</button>`}
          <button class="btn sm" data-click="kb.dataEdit" data-v="${id}">${icon(edit ? 'check' : 'edit', 14)}${edit ? 'Done' : 'Edit rows'}</button>
        </div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr>
              ${d.columns.map((c, i) => html`<th>${edit ? html`<input class="cell-in th" aria-label="Column ${i + 1} name" value="${c}" data-input="kb.dataCol" data-v="${id}" data-i="${i}">` : c}</th>`)}
              ${edit && html`<th></th>`}
            </tr></thead>
            <tbody>
              ${d.rows.map((r) => html`
                <tr data-key="${r.id}">
                  ${r.cells.map((c, i) => html`<td class="${i === 0 ? 'nowrap' : ''}">${edit ? html`<input class="cell-in" aria-label="${d.columns[i]}" value="${c}" data-input="kb.dataCell" data-v="${id}" data-row="${r.id}" data-i="${i}">` : c === 'Degraded' || c === 'Known error' ? html`<span class="pill warn">${c}</span>` : c === 'Operational' ? html`<span class="pill good">${c}</span>` : c}</td>`)}
                  ${edit && html`<td><button class="icon-mini" aria-label="Delete row" data-click="kb.dataRmRow" data-v="${id}" data-row="${r.id}">${icon('trash', 13)}</button></td>`}
                </tr>`)}
            </tbody>
          </table>
        </div>
        <div class="row small muted">
          ${edit && html`<button class="btn sm" data-click="kb.dataAddRow" data-v="${id}">${icon('plus', 14)}Add row</button>`}
          ${edit && html`<button class="btn sm" data-click="kb.dataAddCol" data-v="${id}">${icon('plus', 14)}Add column</button>`}
          <span>${d.rows.length} rows · ${d.source === 'Manual' ? 'entered by hand' : `synced from ${d.source} at ${fmtTime(d.syncedAt)}`}</span>
        </div>
      </div>`
  }

  // ---------- Health ----------
  function health({ conflicts, gaps, stale, failed }) {
    const state = S.state
    const review = state.kb.pages.filter((p) => p.review && isDirty(p))
    const misses = state.copilot.misses
    const Open = (p, label = 'Open') => html`<button class="btn sm" data-click="kb.openId" data-v="${p.id}">${label}</button>`
    return html`
      <section class="card">
        <div class="card-h"><h3>Conflicting information</h3><span class="muted small">SLA targets in published pages, checked against each other and the live SLA rule</span></div>
        <div class="card-b stack">
          ${!conflicts.length && html`<div class="muted small">No conflicts found.</div>`}
          ${conflicts.map((c) => html`
            <div class="stack" data-key="${c.id}">
              <div class="callout warn small">${icon('alert', 15)}<span><b>${c.prio} resolution target.</b> The queue runs on ${c.rule}h, but ${c.off.map((o) => `${o.page.live.title} says ${o.hours}h`).join('; ')}.</span></div>
              ${c.claims.map((x) => html`
                <div class="list-row small">
                  <span class="pill ${x.hours === c.rule ? 'good' : 'crit'}">${x.hours}h</span>
                  <b>${x.page.live.title}</b><span class="muted" style="flex:1;min-width:0">“${x.line}”</span>
                  ${Open(x.page)}
                </div>`)}
            </div>`)}
        </div>
      </section>
      <section class="card">
        <div class="card-h"><h3>Resolution codes without a published runbook</h3><span class="muted small">used in the last 30 days · Copilot can't guide analysts on these</span></div>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Code</th><th>Fix</th><th class="r">Uses (30d)</th><th>Runbook</th><th></th></tr></thead>
            <tbody>
              ${gaps.map((g) => html`
                <tr data-key="${g.code.code}">
                  <td><span class="code-chip">${g.code.code}</span></td>
                  <td>${g.code.title}</td>
                  <td class="r">${g.uses}</td>
                  <td class="nowrap">${g.draft ? html`<span class="pill plain">Draft only</span>` : html`<span class="muted">${g.code.runbook}</span>`}</td>
                  <td class="r">${g.draft ? Open(g.draft, 'Open draft') : html`<button class="btn sm" data-click="kb.create" data-arg="${S.json({ title: g.code.runbook, codes: [g.code.code], kind: 'Runbook' })}">${icon('plus', 13)}Write it</button>`}</td>
                </tr>`)}
              ${!gaps.length && html`<tr><td colspan="5" class="muted">Every code in use has a published runbook.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      <section class="grid g-2">
        <div class="card">
          <div class="card-h"><h3>Index problems</h3></div>
          <div class="card-b">
            ${!failed.length && html`<div class="muted small">Every published page indexed.</div>`}
            ${failed.map((p) => html`<div class="list-row small" data-key="${p.id}"><span class="pill crit">Index failed</span><span style="flex:1;min-width:0"><b>${p.draft.title}</b><br><span class="muted">${p.indexError}</span></span>${Open(p)}</div>`)}
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Review due</h3><span class="muted small">not published for ${REVIEW_AFTER_DAYS} days</span></div>
          <div class="card-b">
            ${!stale.length && html`<div class="muted small">Nothing is overdue.</div>`}
            ${stale.map((p) => html`<div class="list-row small" data-key="${p.id}"><span style="flex:1;min-width:0"><b>${p.live.title}</b><br><span class="muted">v${p.live.version} · ${Math.round((state.now - p.live.at) / DAY)} days old · ${p.live.by}</span></span>${Open(p)}</div>`)}
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Waiting for review</h3></div>
          <div class="card-b">
            ${!review.length && html`<div class="muted small">No review requests.</div>`}
            ${review.map((p) => html`<div class="list-row small" data-key="${p.id}"><span style="flex:1;min-width:0"><b>${p.draft.title}</b><br><span class="muted">${p.review.by} · ${fmtDateTime(p.review.at)}</span></span>${Open(p, 'Review')}</div>`)}
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>Questions Copilot couldn't answer</h3><span class="spacer"></span><button class="btn ghost sm" data-click="kb.go" data-v="copilot" data-tab="insights">Copilot</button></div>
          <div class="card-b">
            ${!misses.length && html`<div class="muted small">None yet. Searches that find nothing show up here.</div>`}
            ${misses.slice(0, 6).map((m) => html`<div class="list-row small" data-key="${m.q}">${icon('search', 14)}<span style="flex:1;min-width:0">${m.q}</span><button class="btn sm" data-click="kb.create" data-arg="${S.json({ title: m.q })}">${icon('plus', 13)}Write a page</button></div>`)}
          </div>
        </div>
      </section>`
  }

  // ---------- Create ----------
  const NP = 'p:kb:new'
  function newPage(seed, kbId) {
    const state = S.state
    const folders = state.kb.folders
    const f = S.ui(NP, () => {
      const def = seed.folderId ? folders.find((x) => x.id === seed.folderId) : folders.find((x) => x.kbId === kbId && /runbook/i.test(x.name)) || folders.find((x) => x.kbId === kbId)
      return { title: seed.title || '', kind: seed.kind || (seed.codes && seed.codes.length ? 'Runbook' : 'How-to'), folderId: (def || folders[0]).id }
    })
    S.modal({
      title: 'New page', sub: 'It starts as a draft. Copilot can see it once a team lead publishes it.', onClose: 'kb.createClose',
      footer: html`<button class="btn" data-click="kb.createClose">Cancel</button><button class="btn primary" ${attrs({ disabled: !f.title.trim() })} data-click="kb.createDo">${icon('plus', 15)}Create draft</button>`,
      body: html`
        <label class="field"><span>Title</span><input id="np-title" class="in" value="${f.title}" data-input="kb.npField" data-f="title" placeholder="e.g. RB-410 Profile rebuild" data-autofocus></label>
        <div class="form-grid">
          <label class="field"><span>Type</span><select id="np-kind" class="in" data-change="kb.npField" data-f="kind">${PAGE_KINDS.map((k) => html`<option ${attrs({ selected: f.kind === k })}>${k}</option>`)}</select></label>
          <label class="field"><span>Folder</span><select id="np-folder" class="in" data-change="kb.npField" data-f="folderId">
            ${state.kb.kbs.map((k) => html`<optgroup label="${k.name}">${folders.filter((x) => x.kbId === k.id).map((x) => html`<option value="${x.id}" ${attrs({ selected: f.folderId === x.id })}>${x.name}</option>`)}</optgroup>`)}
          </select></label>
        </div>
        ${seed.codes && seed.codes.length > 0 && html`<div class="row tight small"><span class="muted">Linked code</span>${seed.codes.map((c) => html`<span class="code-chip">${c}</span>`)}</div>`}`,
    })
    return ''
  }

  const NF = `${LIB}:folder`
  function newFolder() {
    const f = S.ui(NF, { name: '' })
    S.modal({
      title: 'New folder', sub: "Folders hold pages. There's one level of folders.", onClose: 'kb.modalClose',
      footer: html`<button class="btn" data-click="kb.modalClose">Cancel</button><button class="btn primary" ${attrs({ disabled: !f.name.trim() })} data-click="kb.folderDo">Create folder</button>`,
      body: html`<label class="field"><span>Name</span><input id="nf-name" class="in" value="${f.name}" data-input="kb.nfName" data-autofocus></label>`,
    })
  }

  const NK = `${LIB}:newkb`
  function newKb() {
    const f = S.ui(NK, { name: '', desc: '', link: true })
    S.modal({
      title: 'New knowledge base', sub: 'For a group or service with its own content. It starts with one folder.', onClose: 'kb.modalClose',
      footer: html`<button class="btn" data-click="kb.modalClose">Cancel</button><button class="btn primary" ${attrs({ disabled: !f.name.trim() })} data-click="kb.kbDo">Create</button>`,
      body: html`
        <label class="field"><span>Name</span><input id="nkb-name" class="in" value="${f.name}" data-input="kb.nkField" data-f="name" placeholder="e.g. Infra Ops runbooks" data-autofocus></label>
        <label class="field"><span>Description</span><input id="nkb-desc" class="in" value="${f.desc}" data-input="kb.nkField" data-f="desc"></label>
        <label class="check small"><input type="checkbox" ${attrs({ checked: f.link })} data-change="kb.nkLink">Link it to Copilot so its published pages are searched</label>`,
    })
  }

  // ---------- Handlers ----------
  const draft = (id, patch) => S.dispatch({ type: 'kbDraft', id, patch, by: me().name })
  const saveData = (id, patch) => { const p = pageById(id); S.dispatch({ type: 'kbData', id, by: me().name, data: { ...p.data, ...patch } }) }
  const closeModal = () => { S.resetUi(NF); S.resetUi(NK); S.set(lib(), { modal: null }) }
  const setKbId = (id) => { S.set(top(), { kbId: id, pageId: null }) }

  S.on({
    'kb.tab': (el) => { const t = top(); if (el.dataset.v !== t.tab) S.resetUi(LIB); S.set(t, { tab: el.dataset.v }) },
    // Library
    'kb.pickKb': (el) => { lib().folderId = null; setKbId(el.value) },
    'kb.chip': (el) => S.set(lib(), { chip: el.dataset.v, folderId: null }),
    'kb.view': (el) => { storage.set(VIEW_KEY, el.dataset.v); S.set(lib(), { view: el.dataset.v }) },
    'kb.q': (el) => S.set(lib(), { q: el.value }),
    'kb.menu': () => S.togglePop('kb-new'),
    'kb.folder': (el) => S.set(lib(), { folderId: el.dataset.v || null }),
    'kb.openId': (el) => { const p = pageById(el.dataset.v); if (p) open(p) },
    'kb.back': () => { S.resetUi(`${LIB}:pv:`); S.resetUi(`${LIB}:dt:`); S.set(top(), { pageId: null }) },
    'kb.modal': (el) => { S.pop = null; S.set(lib(), { modal: el.dataset.v }) },
    'kb.modalClose': closeModal,
    'kb.nfName': (el) => { const f = S.ui(NF); const was = !!f.name.trim(); f.name = el.value; if (was !== !!el.value.trim()) S.render() },
    'kb.folderDo': () => {
      const name = S.ui(NF).name.trim()
      if (!name) return
      S.dispatch({ type: 'kbFolderAdd', folder: { id: newId('f'), kbId: top().kbId, name } })
      closeModal()
    },
    'kb.nkField': (el) => { const f = S.ui(NK); f[el.dataset.f] = el.value; S.render() },
    'kb.nkLink': (el) => S.set(S.ui(NK), { link: el.checked }),
    'kb.kbDo': () => {
      const f = S.ui(NK)
      if (!f.name.trim()) return
      const id = newId('kb')
      S.dispatch({ type: 'kbAdd', kb: { id, name: f.name.trim(), desc: f.desc.trim() || 'No description yet.' } })
      S.dispatch({ type: 'kbFolderAdd', folder: { id: newId('f'), kbId: id, name: 'General' } })
      if (f.link) S.dispatch({ type: 'copilotConfig', patch: { kbIds: [...S.state.copilot.config.kbIds, id] } })
      closeModal()
      setKbId(id)
    },
    // New page
    'kb.create': (el) => { S.pop = null; S.resetUi(NP); S.set(top(), { creating: S.arg(el) || { title: '' } }) },
    'kb.createClose': () => { S.resetUi(NP); S.set(top(), { creating: null }) },
    'kb.npField': (el) => { const f = S.ui(NP); f[el.dataset.f] = el.value; S.render() },
    'kb.createDo': () => {
      const t = top()
      const seed = t.creating
      const f = S.ui(NP)
      if (!seed || !f.title.trim()) return
      const folder = S.state.kb.folders.find((x) => x.id === f.folderId)
      const page = {
        id: newId('p'), kbId: folder.kbId, folderId: folder.id, kind: f.kind, codes: seed.codes || [],
        draft: { title: f.title.trim(), body: '', attachments: [] }, live: null, index: 'draft', indexError: null,
        data: null, note: '', updatedAt: Date.now(), updatedBy: me().name, review: null,
      }
      S.dispatch({ type: 'kbPageAdd', page })
      S.resetUi(NP)
      t.creating = null
      open(page)
    },
    // Page view
    'kb.edit': (el) => { const u = pv(el.dataset.v); S.set(u, { editing: !u.editing, view: 'draft' }) },
    'kb.version': (el) => S.set(pv(el.dataset.v), { view: el.dataset.ver }),
    'kb.title': (el) => draft(el.dataset.v, { title: el.value }),
    'kb.body': (el) => draft(el.dataset.v, { body: el.value }),
    'kb.meta': (el) => S.dispatch({ type: 'kbMeta', id: el.dataset.v, patch: { [el.dataset.f]: el.value } }),
    'kb.addCode': (el) => {
      const v = el.value
      el.value = ''
      const p = pageById(el.dataset.v)
      if (v && p) S.dispatch({ type: 'kbMeta', id: p.id, patch: { codes: [...p.codes, v] } })
    },
    'kb.rmCode': (el) => { const p = pageById(el.dataset.v); S.dispatch({ type: 'kbMeta', id: p.id, patch: { codes: p.codes.filter((x) => x !== el.dataset.code) } }) },
    'kb.publish': (el) => {
      const id = el.dataset.v
      S.dispatch({ type: 'kbPublish', id, by: me().name })
      S.set(pv(id), { editing: false, view: 'draft' })
      setTimeout(() => S.dispatch({ type: 'kbIndexed', id }), INDEX_MS)
    },
    'kb.review': (el) => S.dispatch({ type: 'kbReview', id: el.dataset.v, by: me().name }),
    'kb.attach': async (el) => {
      const id = el.dataset.v
      const files = [...el.files]
      el.value = ''
      if (!files.length) return
      const read = await Promise.all(files.map(readFile))
      const p = pageById(id)
      if (!p) return
      draft(id, { attachments: [...p.draft.attachments, ...read] })
      S.set(pv(id), { editing: true })
    },
    'kb.attText': (el) => { const p = pageById(el.dataset.v); draft(p.id, { attachments: p.draft.attachments.map((a) => (a.id === el.dataset.att ? { ...a, text: el.value } : a)) }) },
    'kb.rmAtt': (el) => { const p = pageById(el.dataset.v); draft(p.id, { attachments: p.draft.attachments.filter((x) => x.id !== el.dataset.att) }) },
    'kb.addData': (el) => S.dispatch({ type: 'kbData', id: el.dataset.v, by: me().name, data: { columns: ['Item', 'Details', 'Owner'], source: 'Manual', syncedAt: Date.now(), rows: [{ id: newId('r'), cells: ['', '', ''] }] } }),
    'kb.note': (el) => S.dispatch({ type: 'kbNote', id: el.dataset.v, note: el.value }),
    'kb.go': (el) => S.nav(el.dataset.v, el.dataset.tab ? { tab: el.dataset.tab } : {}),
    'kb.discard': (el) => S.dispatch({ type: 'kbDiscard', id: el.dataset.v }),
    'kb.confirmDel': (el) => S.set(pv(el.dataset.v), { confirmDel: !!el.dataset.on }),
    'kb.delete': (el) => S.dispatch({ type: 'kbDelete', id: el.dataset.v }),
    // Data table
    'kb.dataSource': (el) => saveData(el.dataset.v, { source: el.value }),
    'kb.dataSync': (el) => S.dispatch({ type: 'kbDataSync', id: el.dataset.v, source: pageById(el.dataset.v).data.source }),
    'kb.dataEdit': (el) => { const u = dt(el.dataset.v); S.set(u, { edit: !u.edit }) },
    'kb.dataCol': (el) => { const d = pageById(el.dataset.v).data; const i = +el.dataset.i; saveData(el.dataset.v, { columns: d.columns.map((x, j) => (j === i ? el.value : x)) }) },
    'kb.dataCell': (el) => {
      const d = pageById(el.dataset.v).data
      const i = +el.dataset.i
      saveData(el.dataset.v, { rows: d.rows.map((r) => (r.id === el.dataset.row ? { ...r, cells: r.cells.map((c, j) => (j === i ? el.value : c)) } : r)) })
    },
    'kb.dataRmRow': (el) => { const d = pageById(el.dataset.v).data; saveData(el.dataset.v, { rows: d.rows.filter((x) => x.id !== el.dataset.row) }) },
    'kb.dataAddRow': (el) => { const d = pageById(el.dataset.v).data; saveData(el.dataset.v, { rows: [...d.rows, { id: newId('r'), cells: d.columns.map(() => '') }] }) },
    'kb.dataAddCol': (el) => { const d = pageById(el.dataset.v).data; saveData(el.dataset.v, { columns: [...d.columns, 'New column'], rows: d.rows.map((r) => ({ ...r, cells: [...r.cells, ''] })) }) },
  })
})()
