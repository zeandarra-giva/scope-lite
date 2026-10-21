# Sharing the Suggestions board without admin rights

A review of how to give the team one shared, near-real-time Suggestions board on locked-down corporate VDI, with no installs, no admin rights and no Windows Firewall changes.

## The setup being reviewed

- Scope Lite is a static front end (HTML, CSS, vanilla JS, no build step) served by `server.ps1`, a single-threaded PowerShell 5.1 web server.
- Suggestions are an append-only event log: one JSON event per line in `data/suggestions.jsonl`. The browser fetches every event and folds them into the current state, deduping by `eid` and sorting by timestamp.
- Writes only go through `POST /api/events`. The browser polls every 15 seconds.
- `run.bat` serves localhost only. `share.bat` listens on the LAN.

**Constraints:** fewer than 10 people, daily reads and writes, locked-down VDI, a shared network folder everyone can read and write, no admin installs and no firewall changes. The goal is one shared URL, no per-person launching and near-instant updates.

**The plan under review:**

1. One teammate runs `share.bat` and everyone uses `http://HOST:8080`. Ask for a firewall exception if needed.
2. Keep the data file on the shared folder. One active host means a single writer.
3. Add `GET /api/version` and poll it every 2 seconds, fetching the full list only when it changes.
4. Fallback: everyone runs their own localhost server, each writing its own `events-<username>.jsonl` in the shared folder and merging all of them.

## Verdict

The firewall instinct is right: on a locked-down VDI fleet, one shared URL served from a teammate's desktop is probably not going to happen. But the question is framed wrong. It isn't "how do I get a server everyone can reach?" It's "do I need a server at all?" Most likely, no.

## 1. Holes in the plan

### Step 1: one host running share.bat (the weakest step)

- **Segmentation can block you even if the firewall allows it.** VDI networks often block desktop-to-desktop traffic at the network layer (NSX, VLAN rules). Teammates may fail to connect even when Windows Firewall would allow it.
- **The first-run prompt can make things worse.** When `powershell.exe` first listens on all addresses, Windows asks whether to allow it. A non-admin can't approve, and cancelling often creates *Block* rules for `powershell.exe`. Testing it once can silently block you from then on.
- **The exception you'd ask for is a big one.** An inbound allow rule for `powershell.exe` lets *any* PowerShell script accept connections, and security teams rightly refuse that. Many domains also turn off local firewall rules by Group Policy, so even a local admin couldn't add one. If you do ask, ask for one port, scoped to your subnet.
- **The URL won't stay put.** Non-persistent VDI pools give the host a different machine name and IP at each logon. Idle disconnects and logoffs kill the server overnight. One person going on leave takes the board down.
- **There's no authentication.** Anything on the network can POST to `/api/events`, and the author field is whatever the browser claims. That's fine on localhost, but on the LAN anyone can forge entries.
- **One slow client freezes everyone.** The server is single-threaded with a 5-second read timeout, so a client that sends half a request blocks all others for those 5 seconds. Polling every 2 seconds from 10 people makes stalls more likely.

### Step 2: data file on the shared folder

- "Single writer" assumes nobody else ever runs `share.bat` against the same file. Someone eventually will, for example while the host is away.
- `AppendAllText` opens the file without sharing write access and doesn't retry. Two writers wouldn't corrupt the file, but one write would fail with a sharing error and the event would be lost.

### Step 3: version endpoint plus 2-second polling

- The extra endpoint isn't needed. Have the client send the byte offset it has already read, and return only the complete lines after it. That's simpler and cheaper.
- Two seconds is false precision. For a suggestions board, 5–10 seconds feels instant. Over SMB you can't reliably beat about 10 seconds anyway (see section 4), so 2-second polling adds load for no real gain.

### Check this first: PowerShell language mode

Many locked-down VDIs run PowerShell in Constrained Language Mode (enforced by AppLocker or WDAC). In that mode, creating a `TcpListener` with `New-Object` is blocked, so `server.ps1` won't start at all. Run this on a teammate's machine:

```powershell
$ExecutionContext.SessionState.LanguageMode
```

Endpoint protection may also flag a long-running `powershell -ExecutionPolicy Bypass` that listens on a port. If that happens, expect to explain yourself to security.

## 2. Alternatives

### A. Serve the app from the shared folder and have the browser write files directly (no server)

- Everyone opens the same path, e.g. `\\fileserver\team\scope-lite\index.html`. That *is* the single shared URL. It needs no firewall change, no admin, no launching and no port.
- Writes use the browser's File System Access API (`showDirectoryPicker`), available in Edge and Chrome. Each person clicks "Connect team folder" once and picks the shared `data` folder. The browser then:
  - appends to that person's own `events-<user>.jsonl`;
  - reads everyone's files and merges them with the existing dedupe-and-sort.
- This is step 4 minus the per-person server.
- Bonus: everyone runs the same copy of the app code, so nobody is on an old version.

**What to test before relying on it (about 30 minutes):**

- Can a page opened from a file path call `showDirectoryPicker` on your Edge build? Company policy can disable it.
- Can you pick a network folder in that picker?
- Is the folder permission remembered between sessions? Newer Edge and Chrome offer "allow on every visit". Otherwise it's one click per session, which is acceptable.

**Limitations:**

- The browser doesn't know the Windows username, so people type their name once. That's no more spoofable than today.
- Without the API (e.g. Firefox), it doesn't work. The app already falls back to saving in the browser, so keep that path.

### B. A Microsoft List, used as a tab in a Teams channel

It's sanctioned and multi-user, updates within seconds, has history and permissions, and is already backed up. If the shared board is the only multi-user feature, a List with columns for kind, status, votes and comments does the job at zero maintenance. You lose the custom UI.

### C. Excel Online co-authoring, or a Microsoft Form that feeds a List

Sanctioned and real-time, but clunky.

### Ruled out

- **Hosting the HTML on SharePoint.** Modern SharePoint downloads `.html` files instead of running them, and custom scripts need admin.
- **Calling SharePoint or Graph from the browser.** It needs an Azure AD app registration, which means admin.
- **OneDrive sync.** It's slow, often broken on VDI, and conflicts create duplicate copies of files.
- **SQLite or Access on SMB.** Locking is unreliable over network shares. Deferring Access was the right call.
- **Tunnel services (ngrok, dev tunnels, cloudflared).** They'd give one URL, but they deliberately get around the security controls you can't get approved and send internal data through a third party. That turns a prototype into a policy violation. Don't.
- **An existing approved server.** If anyone in the org already runs an internal IIS site or team VM, putting the static files and a tiny API there is the *legitimate* way to get one shared URL. It's worth one email to ask.

## 3. Ranking

| Option | Effort | Robustness | Meets every constraint? |
|---|---|---|---|
| **A. App on the shared folder, browser writes per-user files** | Low–medium (about a day) | High: no process to keep alive | Yes, if the 30-minute test passes |
| **B. Microsoft List in Teams** | Very low | Highest | Yes, but no custom UI |
| **Step 4: localhost server per person plus per-user files** | Medium | Medium | Mostly: needs per-person launching (a shortcut in the Startup folder, no admin), PowerShell running normally, and endpoint protection not objecting |
| **Steps 1–3: single host plus firewall exception** | Low if it happens to work | Low | Probably not |

**Recommendation:** run the 30-minute test for option A first.

- **If it works:** build A, and keep `run.bat` only for solo or offline use.
- **If company policy blocks the File System Access API:** move the board to a Microsoft List (B) rather than run 10 PowerShell listeners. Step 4 works, but it's the most moving parts for the least benefit.
- **Either way:** don't put more effort into `share.bat`. Even if the firewall happens to allow it, everything depends on one VDI session staying up.

## 4. Per-user files: what to get right (A or step 4)

The core design is sound. Each file has exactly one writer, merging is set-union plus dedupe, and order doesn't matter. The risks are in how files are opened and read.

- **Opening files**
  - Writers open with append access and let others read *and write* the file at the same time (`FileShare.ReadWrite`). Write each line in one call and flush.
  - Readers open with the same sharing mode, plus delete.
  - .NET's `ReadAllLines` and `AppendAllText` only share read access, so a reader and a writer can block each other at random with "file in use" errors. Add a retry with a short pause.
- **Half-written lines.** A reader can catch a line mid-write. Only parse up to the last newline, carry the leftover bytes to the next read, and read from a saved byte offset. If a file gets *shorter* than the saved offset, someone replaced it: reload it from the start.
- **SMB caching**
  - Windows caches file size and timestamps for about 10 seconds by default.
  - A new person's file may not show up in the folder listing for about 10 seconds, because folder listings are cached too.
  - Don't use the modified time as the change signal. Read from the saved offset each poll, which is cheap at this size.
  - Expect 2–10 seconds before others see a change. Poll every 5 seconds.
- **Offline Files.** If the share is set up for Offline Files or folder redirection, writes go to a local cache and sync later, so others see them late or as conflicts. Check that it's off for that folder.
- **One person on two sessions.** That means two writers on one file. Name files `events-<user>-<machine or session id>.jsonl`.
- **Clock skew.** Domain machines are kept in sync to within minutes, but ties and small skew can still reorder status changes. Make the outcome deterministic: compare timestamp, then event ID. Model votes as one entry per voter rather than an ordered list.
- **Security.** Anyone with write access to the folder can edit or delete anyone's file. That's acceptable for a team board, as long as it's understood. The share's Previous Versions snapshots are the backup.
- **Never rewrite files in place.** At under 10 people, years of events will stay at a few MB, so compaction is never needed.
