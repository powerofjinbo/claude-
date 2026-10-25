# watch-claude.ps1 -- play the splash whenever Claude Desktop is cold-started.
#
# Started at logon by scripts\watch-claude.vbs (hidden window). Waits on a WMI process-creation
# event (no busy polling) and launches `electron <app> --attach` when claude.exe appears and no
# older claude.exe was already running.
#
# NOTE: keep this file pure ASCII (see install.ps1).
param(
  [string]$ProcessName = 'claude'
)

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'

# one watcher per user session
$created = $false
$mutex = New-Object Threading.Mutex($true, 'Local\ClaudeBootSplashWatcher', [ref]$created)
if (-not $created) { exit 0 }

$query = "SELECT * FROM __InstanceCreationEvent WITHIN 1 WHERE TargetInstance ISA 'Win32_Process' AND TargetInstance.Name = '" + $ProcessName + ".exe'"
Register-CimIndicationEvent -Query $query -SourceIdentifier 'ClaudeSplashStart' | Out-Null

$last = [datetime]::MinValue
while ($true) {
  $ev = Wait-Event -SourceIdentifier 'ClaudeSplashStart'
  # Claude spawns a handful of processes at once; swallow the burst
  Start-Sleep -Milliseconds 150
  Get-Event -SourceIdentifier 'ClaudeSplashStart' -ErrorAction SilentlyContinue | Remove-Event
  if ($ev) { Remove-Event -EventIdentifier $ev.EventIdentifier -ErrorAction SilentlyContinue }

  $now = Get-Date
  if (($now - $last).TotalSeconds -lt 10) { continue }
  if (-not (Test-Path $electron)) { continue }

  # cold start only: every claude process must be brand new
  $procs = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
  if ($ProcessName -eq 'claude') {
    # Claude Code (the command-line tool) is claude.exe as well: only count Claude Desktop's own install folders
    $procs = @($procs | Where-Object { (-not $_.Path) -or ($_.Path -match 'AnthropicClaude|\\WindowsApps\\Claude') })
  }
  if ($procs.Count -eq 0) { continue }
  $oldest = $now
  foreach ($p in $procs) {
    try { if ($p.StartTime -lt $oldest) { $oldest = $p.StartTime } } catch {}
  }
  if (($now - $oldest).TotalSeconds -gt 6) { continue }

  $last = $now
  Start-Process -FilePath $electron -ArgumentList @(('"' + $root + '"'), '--attach')
}
