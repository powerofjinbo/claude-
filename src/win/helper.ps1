# helper.ps1 -- launch Claude Desktop and report when its window shows up.
#
# Spawned once by src/claude.js. Talks over stdio, one line per message:
#   stdout: ALREADY | LAUNCHED <target> | MISSING [reason] | ATTACH | PROC <pid> | WINDOW <pid> | FOCUSED
#   stdin : FOCUS   (bring Claude's window to the foreground)
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 decodes a BOM-less file with the
# system ANSI code page, which mangles CJK bytes.
param(
  [string]$ProcessName = 'claude',
  [string]$Target = '',
  [int]$ParentPid = 0,
  [switch]$Launch
)

$ErrorActionPreference = 'Continue'

function Say([string]$s) {
  [Console]::Out.WriteLine($s)
  [Console]::Out.Flush()
}

function Parent-Gone {
  if ($ParentPid -le 0) { return $false }
  return -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)
}

function Resolve-Target([string]$t) {
  if ($t -ne '') { return $t }
  # Squirrel installer (claude.ai/download, older builds)
  $squirrel = Join-Path $env:LOCALAPPDATA 'AnthropicClaude\claude.exe'
  if (Test-Path $squirrel) { return $squirrel }
  # MSIX / Store builds: ask the Start menu for the app id
  try {
    $app = Get-StartApps | Where-Object { $_.Name -eq 'Claude' } | Select-Object -First 1
    if ($app) { return 'shell:AppsFolder\' + $app.AppID }
  } catch {}
  return ''
}

function Find-Claude {
  $procs = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
  if ($ProcessName -ne 'claude') { return $procs }
  # Claude Code (the command-line tool) is claude.exe as well: only count Claude Desktop's own install folders
  return @($procs | Where-Object { (-not $_.Path) -or ($_.Path -match 'AnthropicClaude|\\WindowsApps\\Claude') })
}

if ($Launch) {
  $running = Find-Claude
  $t = Resolve-Target $Target
  if ($t -eq '') {
    Say 'MISSING not-found'
  } else {
    try {
      if ($t -like 'shell:*') {
        Start-Process -FilePath 'explorer.exe' -ArgumentList $t
      } else {
        Start-Process -FilePath $t
      }
      if ($running.Count -gt 0) { Say 'ALREADY'; exit 0 }
      Say ('LAUNCHED ' + $t)
    } catch {
      Say ('MISSING ' + $_.Exception.Message)
    }
  }
} else {
  Say 'ATTACH'
}

# --- wait for the window ---------------------------------------------------
$deadline = (Get-Date).AddSeconds(180)
$sawProc = $false
$win = $null
while ((Get-Date) -lt $deadline) {
  $procs = Find-Claude
  if ($procs.Count -gt 0 -and -not $sawProc) {
    $sawProc = $true
    Say ('PROC ' + $procs[0].Id)
  }
  $win = $procs | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -ne '' } | Select-Object -First 1
  if ($win) { break }
  if (Parent-Gone) { exit 0 }
  Start-Sleep -Milliseconds 200
}
if (-not $win) { exit 0 }
Say ('WINDOW ' + $win.Id)

# --- focus on request --------------------------------------------------------
$shell = New-Object -ComObject WScript.Shell
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq 'FOCUS') {
    try { [void]$shell.AppActivate([int]$win.Id) } catch {}
    Say 'FOCUSED'
  }
}
