# install.ps1 -- set up the Claude boot splash on Windows.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#
# What it does:
#   1. npm install (downloads Electron, ~100 MB, once)
#   2. finds Claude Desktop and writes its launch target into config.json
#   3. Desktop shortcut "Claude"         -> splash + Claude (the old one is backed up to backup\)
#      Start menu shortcut "Claude Splash" -> same thing
#   4. Background watcher (Startup folder) -> plays the splash whenever Claude is cold-started
#      some other way (taskbar pin, Start menu, claude:// link ...). Skip with -NoWatcher.
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 decodes a BOM-less file with the
# system ANSI code page, which mangles CJK bytes.
param(
  [string]$Target = '',
  [switch]$NoWatcher,
  [switch]$NoDesktop,
  [switch]$SkipNpm
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'assets\icon.ico'
$backup = Join-Path $root 'backup'

function Step([string]$s) { Write-Host ('==> ' + $s) -ForegroundColor Cyan }

# --- 1. dependencies ---------------------------------------------------------
if (-not $SkipNpm) {
  Step 'npm install (Electron)'
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) { throw 'Node.js not found. Install the LTS from https://nodejs.org and run this again.' }
  Push-Location $root
  try {
    & $npm.Source install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw ('npm install failed, exit code ' + $LASTEXITCODE) }
    if (-not (Test-Path $electron)) {
      # npm configured with ignore-scripts: fetch the Electron binary by hand
      & node (Join-Path $root 'node_modules\electron\install.js')
    }
  } finally {
    Pop-Location
  }
}
if (-not (Test-Path $electron)) { throw ('Electron is missing: ' + $electron) }

# --- 2. find Claude Desktop ---------------------------------------------------
Step 'Looking for Claude Desktop'
function Find-ClaudeTarget {
  $squirrel = Join-Path $env:LOCALAPPDATA 'AnthropicClaude\claude.exe'
  if (Test-Path $squirrel) { return $squirrel }
  try {
    $app = Get-StartApps | Where-Object { $_.Name -eq 'Claude' } | Select-Object -First 1
    if ($app) { return 'shell:AppsFolder\' + $app.AppID }
  } catch {}
  return ''
}
if ($Target -eq '') { $Target = Find-ClaudeTarget }
if ($Target -eq '') {
  Write-Warning 'Claude Desktop not found. Install it from https://claude.ai/download, then run this again (or pass -Target).'
} else {
  Write-Host ('    ' + $Target)
}

$cfgPath = Join-Path $root 'config.json'
$cfg = $null
if (Test-Path $cfgPath) {
  $raw = [IO.File]::ReadAllText($cfgPath, [Text.Encoding]::UTF8)
  try { $cfg = $raw | ConvertFrom-Json } catch { Write-Warning 'config.json is not valid JSON, rewriting it' }
}
if (-not $cfg) { $cfg = New-Object PSObject }
if (-not $cfg.PSObject.Properties['claude']) { $cfg | Add-Member -NotePropertyName claude -NotePropertyValue (New-Object PSObject) }
$cfg.claude | Add-Member -NotePropertyName target -NotePropertyValue $Target -Force
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding $false))

# --- 3. shortcuts --------------------------------------------------------------
$shell = New-Object -ComObject WScript.Shell
function New-Shortcut([string]$path, [string]$exe, [string]$arguments, [string]$desc) {
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $exe
  $lnk.Arguments = $arguments
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = $icon + ',0'
  $lnk.Description = $desc
  $lnk.Save()
}
function Is-Ours([string]$path) {
  if (-not (Test-Path $path)) { return $false }
  return ($shell.CreateShortcut($path).TargetPath -ieq $electron)
}

$appArg = '"' + $root + '"'

if (-not $NoDesktop) {
  Step 'Desktop shortcut'
  $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Claude.lnk'
  if ((Test-Path $desktop) -and -not (Is-Ours $desktop)) {
    New-Item -ItemType Directory -Force -Path $backup | Out-Null
    Copy-Item $desktop (Join-Path $backup 'Desktop-Claude.lnk') -Force
    Write-Host '    old Claude.lnk backed up to backup\Desktop-Claude.lnk'
  }
  New-Shortcut $desktop $electron $appArg 'Claude Desktop (with boot splash)'
  Write-Host ('    ' + $desktop)
}

Step 'Start menu shortcut'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Claude Splash.lnk'
New-Shortcut $startMenu $electron $appArg 'Claude Desktop (with boot splash)'
Write-Host ('    ' + $startMenu)

# --- 4. background watcher -------------------------------------------------
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Claude Splash Watcher.lnk'
if ($NoWatcher) {
  if (Test-Path $startup) { Remove-Item $startup -Force }
} else {
  Step 'Background watcher (runs at logon)'
  $vbs = Join-Path $root 'scripts\watch-claude.vbs'
  $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $lnk = $shell.CreateShortcut($startup)
  $lnk.TargetPath = $wscript
  $lnk.Arguments = '"' + $vbs + '"'
  $lnk.WorkingDirectory = $root
  $lnk.Description = 'Plays the Claude boot splash when Claude Desktop starts'
  $lnk.Save()
  Write-Host ('    ' + $startup)
  # start it now as well (it exits on its own if one is already running)
  Start-Process -FilePath $wscript -ArgumentList ('"' + $vbs + '"')
}

Write-Host ''
Write-Host 'Done. Open Claude from the desktop shortcut to see the splash.' -ForegroundColor Green
Write-Host 'Taskbar: unpin the old Claude icon, then right-click the new desktop shortcut > Pin to taskbar.'
Write-Host ('Preview without starting Claude:  "' + $electron + '" "' + $root + '" --preview')
