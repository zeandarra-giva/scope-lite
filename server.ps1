# Scope Lite server: serves this folder and stores team suggestions.
# Uses only what ships with Windows (PowerShell 5.1 and .NET), so nothing to install.
#
#   run.bat     -> http://127.0.0.1:8080, only this computer can open it
#   share.bat   -> also reachable from the office network, so the team shares one list
#
# Suggestions are appended, one event per line, to data\suggestions.jsonl.
# Back that file up to keep them; delete it to start over.

param(
  [int]$Port = 8080,
  [switch]$Lan,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $Root 'data'
$DataFile = Join-Path $DataDir 'suggestions.jsonl'
$MaxBody = 1MB # an import arrives in chunks of 150 rows
$Utf8 = New-Object System.Text.UTF8Encoding $false

if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }
if (-not (Test-Path $DataFile)) { [System.IO.File]::WriteAllText($DataFile, '', $Utf8) }

# ---------- Shared operations log (real team data) ----------
# data\ops.jsonl: one event per line, {"seq":n,"at":ms,"by":"SOEID","e":{...}}.
# The server gives each event the next seq and the time; browsers fold the log into state.
# data\roster.json: the real team (SOEID, name, accessRole Lead|Analyst, active). The lead
# keeps it up to date; data\roster.example.json shows the format. Both stay out of git.
$OpsFile = Join-Path $DataDir 'ops.jsonl'
$RosterFile = Join-Path $DataDir 'roster.json'
# Event types the ops log accepts so far, and the ones only a Lead may send.
$OpsTypes = @('manualIncAdd', 'manualIncWithdraw', 'manualIncDecide', 'shiftStart', 'settingsSet', 'ticketsImported', 'ticketsAssigned', 'ticketTag', 'ticketNote', 'importUndo', 'rotaSet', 'leaveAdd', 'leaveCancel', 'shiftPlanSet')
$LeadOnly = @('manualIncDecide', 'settingsSet', 'rotaSet', 'shiftPlanSet')
if (-not (Test-Path $OpsFile)) { [System.IO.File]::WriteAllText($OpsFile, '', $Utf8) }
$OpsSeq = [int64]0
$OpsEids = New-Object 'System.Collections.Generic.HashSet[string]'
$lineNo = 0
foreach ($line in [System.IO.File]::ReadAllLines($OpsFile, $Utf8)) {
  $lineNo++
  if (-not $line.Trim()) { continue }
  # Never repair the log silently: a broken line stops the server so someone can look at it.
  try { $o = $line | ConvertFrom-Json } catch { $o = $null }
  if (-not $o -or -not $o.seq -or [int64]$o.seq -ne $OpsSeq + 1) {
    Write-Host "data\ops.jsonl line $lineNo is broken or out of order. Fix or remove that line, then start again." -ForegroundColor Red
    exit 1
  }
  $OpsSeq = [int64]$o.seq
  if ($o.e -and $o.e.eid) { [void]$OpsEids.Add([string]$o.e.eid) }
}

function Read-Roster {
  # The leading comma keeps an empty list a list: PowerShell would otherwise return nothing ($null),
  # which reads as "invalid JSON". Piping $r flattens arrays the same way in PowerShell 5.1 and 7.
  if (-not (Test-Path $RosterFile)) { return ,@() }
  try { $r = [System.IO.File]::ReadAllText($RosterFile, $Utf8) | ConvertFrom-Json } catch { return $null }
  return ,@($r | Where-Object { $null -ne $_ })
}

$Types = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.ico' = 'image/x-icon'; '.woff2' = 'font/woff2'; '.woff' = 'font/woff'; '.txt' = 'text/plain; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'
}

# ---------- Start listening (try the next port if this one is taken) ----------
$address = if ($Lan) { [System.Net.IPAddress]::Any } else { [System.Net.IPAddress]::Loopback }
$listener = $null
for ($p = $Port; $p -lt $Port + 10; $p++) {
  try {
    $listener = New-Object System.Net.Sockets.TcpListener($address, $p)
    $listener.Start()
    $Port = $p
    break
  } catch { $listener = $null }
}
if (-not $listener) { Write-Host "Couldn't open a port between $Port and $($Port + 9). Close other servers and try again." -ForegroundColor Red; exit 1 }

$url = "http://127.0.0.1:$Port/"
Write-Host ''
Write-Host '  Scope Lite is running' -ForegroundColor Cyan
Write-Host "  On this computer:  $url"
if ($Lan) {
  $ips = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) | Where-Object { $_.AddressFamily -eq 'InterNetwork' -and -not $_.ToString().StartsWith('169.254') }
  foreach ($ip in $ips) { Write-Host "  For your team:     http://$($ip):$Port/" -ForegroundColor Green }
  Write-Host '  If teammates cannot open it, Windows Firewall may be blocking the port; ask IT to allow it.' -ForegroundColor DarkGray
} else {
  Write-Host '  Only this computer can open it. Use share.bat to let the team in.' -ForegroundColor DarkGray
}
Write-Host "  Suggestions file:  $DataFile"
Write-Host "  Team ops log:      $OpsFile ($OpsSeq events)"
if (-not (Test-Path $RosterFile)) { Write-Host '  No data\roster.json yet: copy data\roster.example.json, fill in the team, then reload Scope.' -ForegroundColor Yellow }
Write-Host '  Keep this window open while you use Scope. Close it (or press Ctrl+C) to stop.' -ForegroundColor Yellow
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }

# ---------- HTTP helpers ----------
function Send-Response($stream, [int]$code, [string]$status, [string]$type, [byte[]]$body) {
  if ($null -eq $body) { $body = [byte[]]@() }
  $head = "HTTP/1.1 $code $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}
function Send-Text($stream, [int]$code, [string]$status, [string]$text, [string]$type = 'text/plain; charset=utf-8') {
  Send-Response $stream $code $status $type ($Utf8.GetBytes($text))
}

# Read one request: headers up to the blank line, then Content-Length bytes of body.
function Read-Request($client) {
  $stream = $client.GetStream()
  $client.ReceiveTimeout = 5000
  $buf = New-Object byte[] 8192
  $ms = New-Object System.IO.MemoryStream
  $headerEnd = -1
  while ($headerEnd -lt 0) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { return $null }
    $ms.Write($buf, 0, $n)
    $all = $ms.ToArray()
    for ($i = [Math]::Max(0, $all.Length - $n - 3); $i -le $all.Length - 4; $i++) {
      if ($all[$i] -eq 13 -and $all[$i + 1] -eq 10 -and $all[$i + 2] -eq 13 -and $all[$i + 3] -eq 10) { $headerEnd = $i; break }
    }
    if ($ms.Length -gt 32KB -and $headerEnd -lt 0) { return $null }
  }
  $all = $ms.ToArray()
  $headText = [System.Text.Encoding]::ASCII.GetString($all, 0, $headerEnd)
  $lines = $headText -split "`r`n"
  $parts = $lines[0] -split ' '
  $len = 0
  foreach ($l in $lines) { if ($l -match '^(?i)content-length:\s*(\d+)') { $len = [int]$Matches[1] } }
  if ($len -gt $MaxBody) { return @{ Method = $parts[0]; Path = $parts[1]; TooBig = $true } }
  $bodyStart = $headerEnd + 4
  $body = New-Object System.IO.MemoryStream
  if ($all.Length -gt $bodyStart) { $body.Write($all, $bodyStart, $all.Length - $bodyStart) }
  while ($body.Length -lt $len) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $body.Write($buf, 0, $n)
  }
  return @{ Method = $parts[0]; Path = $parts[1]; Body = $Utf8.GetString($body.ToArray()); TooBig = $false }
}

function Handle($client) {
  $stream = $client.GetStream()
  $req = Read-Request $client
  if (-not $req) { return }
  $path = [System.Uri]::UnescapeDataString(($req.Path -split '\?')[0])

  if ($req.TooBig) { Send-Text $stream 413 'Payload Too Large' 'That is too long to save.'; return }

  # --- API ---
  if ($path -eq '/api/health') { Send-Text $stream 200 'OK' '{"ok":true}' 'application/json; charset=utf-8'; return }
  if ($path -eq '/api/roster') {
    if ($req.Method -ne 'GET') { Send-Text $stream 405 'Method Not Allowed' 'Use GET.'; return }
    $roster = Read-Roster
    if ($null -eq $roster) { Send-Text $stream 500 'Server Error' "data\roster.json isn't valid JSON. Compare it with data\roster.example.json."; return }
    Send-Text $stream 200 'OK' (ConvertTo-Json -InputObject @($roster) -Depth 4 -Compress) 'application/json; charset=utf-8'
    return
  }
  if ($path -eq '/api/ops') {
    if ($req.Method -eq 'GET') {
      $lines = [System.IO.File]::ReadAllLines($OpsFile, $Utf8) | Where-Object { $_.Trim() }
      Send-Text $stream 200 'OK' ('[' + ($lines -join ',') + ']') 'application/json; charset=utf-8'
      return
    }
    if ($req.Method -eq 'POST') {
      $raw = $req.Body.Trim()
      try { $obj = $raw | ConvertFrom-Json } catch { $obj = $null }
      if (-not $obj -or -not $raw.StartsWith('{') -or $OpsTypes -notcontains $obj.type -or -not $obj.eid -or -not $obj.by) {
        Send-Text $stream 400 'Bad Request' "That isn't an event Scope knows."
        return
      }
      # A resent event (same eid) is accepted but not written twice.
      if ($OpsEids.Contains([string]$obj.eid)) { Send-Text $stream 200 'OK' '{"ok":true,"duplicate":true}' 'application/json; charset=utf-8'; return }
      # Who: must be an active person on the roster. Honour system until there is SSO.
      $roster = Read-Roster
      $me = @($roster) | Where-Object { $_.soeid -eq $obj.by -and $_.active -ne $false } | Select-Object -First 1
      if (-not $me) { Send-Text $stream 403 'Forbidden' "$($obj.by) isn't on the active roster (data\roster.json)."; return }
      if ($LeadOnly -contains $obj.type -and $me.accessRole -ne 'Lead') { Send-Text $stream 403 'Forbidden' 'Only a lead can do that.'; return }
      # Light shape check; the browser's fold applies the full rules.
      if ($obj.type -eq 'manualIncAdd') {
        $bad = if ($obj.inc -notmatch '^INC\d{7,}$') { 'The INC number should look like INC0012345.' }
          elseif (-not ($obj.handledAt -is [int64] -or $obj.handledAt -is [int] -or $obj.handledAt -is [double])) { 'Add when you handled it.' }
          elseif ([int64]$obj.handledAt -gt [DateTimeOffset]::UtcNow.AddMinutes(5).ToUnixTimeMilliseconds()) { 'The handled time is in the future.' }
          elseif (-not "$($obj.actions)".Trim()) { 'Describe the actions you took.' }
          elseif (-not "$($obj.reason)".Trim()) { 'Give the reason for the manual entry.' }
        if ($bad) { Send-Text $stream 400 'Bad Request' $bad; return }
      }
      $raw = $raw -replace "[`r`n]+", ' '
      $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      $script:OpsSeq++
      $byJson = ConvertTo-Json -InputObject ([string]$obj.by) -Compress
      [System.IO.File]::AppendAllText($OpsFile, ('{"seq":' + $script:OpsSeq + ',"at":' + $at + ',"by":' + $byJson + ',"e":' + $raw + '}' + "`n"), $Utf8)
      [void]$OpsEids.Add([string]$obj.eid)
      Send-Text $stream 200 'OK' ('{"ok":true,"seq":' + $script:OpsSeq + '}') 'application/json; charset=utf-8'
      return
    }
    Send-Text $stream 405 'Method Not Allowed' 'Use GET or POST.'
    return
  }
  if ($path -eq '/api/events') {
    if ($req.Method -eq 'GET') {
      $lines = [System.IO.File]::ReadAllLines($DataFile, $Utf8) | Where-Object { $_.Trim() }
      Send-Text $stream 200 'OK' ('[' + ($lines -join ',') + ']') 'application/json; charset=utf-8'
      return
    }
    if ($req.Method -eq 'POST') {
      $raw = $req.Body.Trim()
      # Only accept a single JSON object with a known type; the client builds everything else.
      try { $obj = $raw | ConvertFrom-Json } catch { $obj = $null }
      if (-not $obj -or -not $raw.StartsWith('{') -or @('create', 'vote', 'status', 'comment') -notcontains $obj.type) {
        Send-Text $stream 400 'Bad Request' "That doesn't look like a suggestion."
        return
      }
      $raw = $raw -replace "[`r`n]+", ' '
      $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      [System.IO.File]::AppendAllText($DataFile, ('{"at":' + $at + ',"e":' + $raw + '}' + "`n"), $Utf8)
      Send-Text $stream 200 'OK' '{"ok":true}' 'application/json; charset=utf-8'
      return
    }
    Send-Text $stream 405 'Method Not Allowed' 'Use GET or POST.'
    return
  }

  # --- Static files ---
  if ($req.Method -ne 'GET' -and $req.Method -ne 'HEAD') { Send-Text $stream 405 'Method Not Allowed' 'Read only.'; return }
  if ($path -eq '/') { $path = '/index.html' }
  $rel = $path.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  # Stay inside this folder, and never serve the data folder or the scripts directly.
  $blocked = ($rel -match '^(data|\.git)([\\/]|$)') -or $rel.EndsWith('.ps1') -or $rel.EndsWith('.bat')
  if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or $blocked -or -not (Test-Path $full -PathType Leaf)) {
    Send-Text $stream 404 'Not Found' 'Not found.'
    return
  }
  $ext = [System.IO.Path]::GetExtension($full).ToLower()
  $type = $Types[$ext]
  if (-not $type) { $type = 'application/octet-stream' }
  Send-Response $stream 200 'OK' $type ([System.IO.File]::ReadAllBytes($full))
}

# ---------- Main loop ----------
# Browsers open spare connections they may never use, so keep a list of open
# connections and only read from the ones that have sent something.
$pending = New-Object System.Collections.ArrayList
try {
  while ($true) {
    while ($listener.Pending()) { [void]$pending.Add(@{ Client = $listener.AcceptTcpClient(); Since = [DateTime]::UtcNow }) }
    $busy = $false
    foreach ($c in @($pending)) {
      $client = $c.Client
      $drop = $false
      try {
        if ($client.Available -gt 0) {
          $busy = $true
          try { Handle $client }
          catch { try { Send-Text $client.GetStream() 500 'Internal Server Error' "Server error: $($_.Exception.Message)" } catch { } }
          $drop = $true
        } elseif (([DateTime]::UtcNow - $c.Since).TotalSeconds -gt 15 -or ($client.Client.Poll(0, [System.Net.Sockets.SelectMode]::SelectRead) -and $client.Available -eq 0)) {
          $drop = $true
        }
      } catch { $drop = $true }
      if ($drop) { try { $client.Close() } catch { }; $pending.Remove($c) }
    }
    if (-not $busy) { Start-Sleep -Milliseconds 15 }
  }
} finally {
  $listener.Stop()
  Write-Host 'Scope Lite stopped.'
}
