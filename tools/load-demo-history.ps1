# Loads three months of practice history (Aug 28 - Nov 26, 2026) into data\ops.jsonl so the
# monthly reports, Compare and Ticket Explorer have data on this computer.
#
#   1. Stop Scope (Ctrl+C in the run.bat window).
#   2. powershell -ExecutionPolicy Bypass -File tools\load-demo-history.ps1
#   3. Start run.bat again and reload the browser (Ctrl+Shift+R).
#
# tools\demo-history.jsonl has no names in it (this repo is public): people are slots that
# this script fills from data\roster.json in its order (active people only), so it uses your
# team. The current data\ops.jsonl is kept in data\backup\ first. Nothing from today is in
# the history: today's queue stays empty for a live import.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Data = Join-Path $Root 'data'
$Src = Join-Path $PSScriptRoot 'demo-history.jsonl'
$RosterFile = Join-Path $Data 'roster.json'
$Ops = Join-Path $Data 'ops.jsonl'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path $RosterFile)) { Write-Host 'No data\roster.json: copy data\roster.example.json, fill in the team, then run this again.' -ForegroundColor Red; exit 1 }
$roster = @((Get-Content $RosterFile -Raw -Encoding UTF8 | ConvertFrom-Json) | Where-Object { $_.soeid -and $_.name -and $_.active -ne $false })
$text = [System.IO.File]::ReadAllText($Src, $Utf8)
$slots = 0
while ($text.Contains(('~~ID{0:D2}~~' -f ($slots + 1)))) { $slots++ }
if ($roster.Count -lt $slots) { Write-Host "The history needs $slots active people; data\roster.json has $($roster.Count)." -ForegroundColor Red; exit 1 }

$answer = Read-Host 'Is Scope stopped (run.bat window closed or Ctrl+C)? Type Y to load the history'
if ($answer -ne 'Y' -and $answer -ne 'y') { Write-Host 'Nothing changed.'; exit 0 }

for ($i = 1; $i -le $slots; $i++) {
  $p = $roster[$i - 1]
  $name = (ConvertTo-Json ([string]$p.name)).Trim('"') # same escaping as in the log
  $text = $text.Replace(('~~ID{0:D2}~~' -f $i), [string]$p.soeid).Replace(('~~NAME{0:D2}~~' -f $i), $name)
  Write-Host ("  {0} -> {1}" -f $i, $p.name)
}

if (Test-Path $Ops) {
  $bk = Join-Path $Data ('backup\before-history-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Force -Path $bk | Out-Null
  Copy-Item $Ops (Join-Path $bk 'ops.jsonl')
  Write-Host "Kept the old data\ops.jsonl in $bk"
}
[System.IO.File]::WriteAllText($Ops, $text, $Utf8)
Write-Host 'History loaded. Start run.bat and reload the browser (Ctrl+Shift+R).' -ForegroundColor Green
