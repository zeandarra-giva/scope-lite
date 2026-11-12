# Sharing the Suggestions board without admin rights

How to give the team one shared, near-real-time Suggestions board on locked-down corporate VDI, with no installs, no admin rights and no Windows Firewall changes.

## The setup

- Scope Lite is a static front end (HTML, CSS, vanilla JS, no build step) served by `server.ps1`, a single-threaded PowerShell 5.1 web server.
- Suggestions are an append-only event log: one JSON event per line in `data/suggestions.jsonl`. The browser fetches every event and folds them into the current state, deduping by `eid` and sorting by timestamp.
- Writes only go through `POST /api/events`. The browser polls every 15 seconds.
- `run.bat` serves localhost only. `share.bat` listens on all addresses (`0.0.0.0`) and prints the team URL.
- The whole folder (code, `.bat` files and `data/`) lives on the team's shared network drive.

**Constraints:** fewer than 10 people, daily reads and writes, locked-down VDI, no admin installs and no firewall changes. The goal is one shared URL, no per-person launching and near-instant updates.

## Decision: one host runs share.bat

One teammate runs `share.bat` from the shared folder, and everyone opens the URL it prints, e.g. `http://10.x.x.x:8080/`.

An earlier draft of this doc advised against this, on the grounds that VDI networks often block desktop-to-desktop traffic. That turned out to be wrong for our network. The team's QueueManager tool already runs exactly this way, and has done for a while:

| | QueueManager | Scope Lite |
|---|---|---|
| Launcher | `start.bat` on the team share | `share.bat` on the shared folder |
| Server | Python Flask, bound to `0.0.0.0:8000` | PowerShell `TcpListener`, bound to `0.0.0.0:8080` |
| Data | Access `.accdb` on the team share | `suggestions.jsonl` in the shared folder |
| Clients | Every browser calls `http://<host>:8000/api` | Every browser opens `http://HOST:8080/` |

So we know that teammates can reach a server on a colleague's machine, and that the host's IP stays stable enough to hardcode.

Where the `.bat` file lives doesn't matter. The server runs on whichever machine double-clicks it, and the shared folder just holds the code and the data. The host needs the share mapped, as QueueManager's does.

Scope Lite is also simpler than QueueManager in one respect: the page and the API come from the same server, so the front end uses relative URLs (`api/events`). No IP is baked into the code. If the host's IP ever changes, people update a bookmark, not a JS constant.

## What QueueManager doesn't prove

There is one real difference, and it should be tested before relying on the setup (about 10 minutes):

- **Windows Firewall rules apply per program.** QueueManager proves that `python.exe` is allowed to accept connections on its host. It says nothing about `powershell.exe`. If someone approved Python once, or the host has a rule for it, PowerShell may still be blocked.
- **PowerShell may be locked down.** On the intended host, run `$ExecutionContext.SessionState.LanguageMode`. If it prints anything but `FullLanguage`, `server.ps1` can't create its listener.
- **Don't cancel the firewall prompt.** The first time `share.bat` runs, Windows may ask whether to allow PowerShell on the network. If you can't approve it, close the prompt with the X rather than Cancel, because Cancel can create a permanent *Block* rule for `powershell.exe`.

**The test:** run `share.bat` on the intended host and have one teammate open the printed "For your team" URL from their own VDI.

- **It loads:** done. Go ahead.
- **It times out:** the firewall is blocking PowerShell. Pick one of these, in order:
  1. Run Scope Lite on the QueueManager host itself, using that machine's Python, which is already allowed through. That needs a small Python port of `server.ps1` (standard library only, about 100 lines, same API and the same data file).
  2. Ask IT for an inbound rule for TCP port 8080 only, scoped to the team subnet. Don't ask for a rule that allows `powershell.exe` as a program.
  3. Fall back to the serverless options at the end of this doc.

## Risks we accept (the same ones QueueManager accepts)

- **One point of failure.** If the host's window closes, the machine sleeps or the host logs off, the board stops for everyone until someone runs `share.bat` again. While it's down, an open page shows "Lost the connection" and new saves fail with a message, so nobody loses work silently. But they do have to retype it once the server is back.
- **No authentication.** Anyone on the network can post, and the author name is whatever the browser sends. That's fine for an internal team board.
- **HTTP only.** The board holds no credentials, so there's nothing sensitive to encrypt.

## Small changes worth making

None of these are needed to start, but each one removes a known sharp edge.

1. **Stop a second host writing the same file.** If the host is away and someone else runs `share.bat`, two servers append to one file. `AppendAllText` doesn't share write access and doesn't retry, so one of two simultaneous writes would fail and that event would be lost. Fix: on start, `share.bat` writes `data/host.json` (machine name, URL, time) and refreshes it every minute. A second `share.bat` that finds a fresh file prints "Scope Lite is already running at …" and exits. Also open the file for append with `FileShare.ReadWrite`, and retry briefly on a sharing error.
2. **Poll faster.** Drop the 15-second poll to 5 seconds. A version endpoint isn't needed: at under 10 people and a few hundred KB of events, a full fetch every 5 seconds is cheap.
3. **Keep the host awake.** The host should set Windows sleep to "Never" while plugged in (a per-user setting on most machines) and leave the window minimized, not closed.
4. **Print one URL.** `server.ps1` prints every IPv4 address the machine has. On a VDI with a VPN adapter, that can be two or three. Print the `10.x` one first so people bookmark the right one.

## If the network test fails and Python isn't an option

These need no listening port at all.

### A. Open the app from the shared folder, with the browser writing files directly

- Everyone opens the same path, e.g. `\\fileserver\team\scope-lite\index.html`.
- Writes use the browser's File System Access API (`showDirectoryPicker`), available in Edge and Chrome. Each person picks the shared `data` folder once. The browser appends to that person's own `events-<user>-<session>.jsonl` and reads everyone's files, merging them with the existing dedupe and sort.
- Test first: company policy can disable the API, the picker may refuse network folders, and the permission may need re-granting each session.
- Over SMB, expect 2–10 seconds before others see a change, because Windows caches folder listings and file sizes for about 10 seconds. Read each file from a saved byte offset, parse only up to the last newline, and reload a file from the start if it gets shorter.

### B. A Microsoft List as a tab in a Teams channel

Sanctioned, multi-user, updates within seconds, with history and backups. You lose the custom UI.

### Ruled out

- **Tunnel services (ngrok, dev tunnels, cloudflared).** They get around controls we can't get approved and send internal data through a third party.
- **SharePoint-hosted HTML or Graph calls from the browser.** Modern SharePoint downloads `.html` files instead of running them, and Graph needs an Azure AD app registration, which needs an admin.
- **SQLite or Access written by several machines over SMB.** Locking over network shares is unreliable. With one host as the only writer, this matters less, but the append-only file is still simpler.
