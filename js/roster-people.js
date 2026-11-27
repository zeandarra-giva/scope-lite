// The team is the real roster (data/roster.json), everywhere.
//
// The pages ported from the prototype (profile, Team, Knowledge Base, Copilot, notifications)
// were built on a placeholder team in data.js (S.ANALYSTS: "Team Lead", "Analyst 2"…). Once
// the roster loads, this swaps that list for the real people, the lead first, keeping the
// ids (a1, a2…) the seeded tickets, schedule and handovers point at. Every placeholder name
// in the app state is renamed to the person who took its place, and seeded work held by a
// placeholder with no real person behind it moves to one who is. The signed-in person is
// S.currentUser everywhere (store.js).
;(function () {
  let applied = ''
  const ORIG = S.ANALYSTS.map((a) => ({ ...a }))

  function useRoster(roster) {
    const people = (roster || []).filter((p) => p && p.soeid && p.name && p.active !== false)
    if (!people.length) return
    const key = people.map((p) => `${p.soeid}:${p.name}:${p.accessRole}`).join('|')
    if (key === applied) return
    applied = key
    const lead = people.filter((p) => p.accessRole === 'Lead')
    const ordered = [...lead, ...people.filter((p) => p.accessRole !== 'Lead')]
    const n = ordered.length

    // The new list: real names and SOEIDs on the placeholder slots (statuses, skills, shifts).
    const next = ordered.map((p, i) => ({ ...(ORIG[i] || ORIG[ORIG.length - 1]), id: 'a' + (i + 1), name: p.name, soeid: p.soeid, role: p.accessRole === 'Lead' ? 'Manager' : 'Analyst', status: 'online' }))
    // Placeholder slot i → real person (slots past the roster wrap onto the analysts).
    const slotOf = (i) => (i < n ? i : n > 1 ? 1 + ((i - 1) % (n - 1)) : 0)
    const names = new Map(ORIG.map((a, i) => [a.name, next[slotOf(i)].name]))
    const ids = new Map(ORIG.map((a, i) => [a.id, next[slotOf(i)].id]))

    S.ANALYSTS.length = 0
    next.forEach((a) => S.ANALYSTS.push(a))
    for (const k of Object.keys(S.byId)) delete S.byId[k]
    next.forEach((a) => (S.byId[a.id] = a))

    // Rename placeholders inside the app state (handovers, approvals, notifications, KB pages…).
    const re = new RegExp([...names.keys()].sort((a, b) => b.length - a.length).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
    const seen = new Set()
    const walk = (o) => {
      if (!o || typeof o !== 'object' || seen.has(o)) return
      seen.add(o)
      for (const k of Object.keys(o)) {
        const v = o[k]
        if (typeof v === 'string') { if (re.test(v)) { re.lastIndex = 0; o[k] = v.replace(re, (m) => names.get(m)) } re.lastIndex = 0 }
        else if (v && typeof v === 'object') walk(v)
      }
    }
    const st = S.state
    if (!st) return
    walk(st)
    st.analysts = next.map((a) => ({ ...a }))
    for (const t of st.tickets || []) if (t.assignedTo && ids.has(t.assignedTo)) t.assignedTo = ids.get(t.assignedTo)
    if (st.schedule && st.schedule.sched) for (const a of ORIG) if (!next.some((x) => x.id === a.id)) delete st.schedule.sched[a.id]
    if (st.stats) for (const a of ORIG) if (!next.some((x) => x.id === a.id)) delete st.stats[a.id]
  }

  S.useRoster = useRoster
})()
