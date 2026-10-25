# uninstall.ps1 -- remove everything install.ps1 set up (node_modules and config.json stay).
#
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
#
# NOTE: keep this file pure ASCII (see install.ps1).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$shell = New-Object -ComObject WScript.Shell

function Is-Ours([string]$path) {
  if (-not (Test-Path $path)) { return $false }
  return ($shell.CreateShortcut($path).TargetPath -ieq $electron)
}

# background watcher
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
  Where-Object { $_.CommandLine -like '*watch-claude.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Claude Splash Watcher.lnk'
if (Test-Path $startup) { Remove-Item $startup -Force; Write-Host ('removed ' + $startup) }

# Start menu
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Claude Splash.lnk'
if (Test-Path $startMenu) { Remove-Item $startMenu -Force; Write-Host ('removed ' + $startMenu) }

# Desktop: drop ours, put the backup back
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Claude.lnk'
if (Is-Ours $desktop) { Remove-Item $desktop -Force; Write-Host ('removed ' + $desktop) }
$saved = Join-Path $root 'backup\Desktop-Claude.lnk'
if ((Test-Path $saved) -and -not (Test-Path $desktop)) {
  Copy-Item $saved $desktop
  Write-Host ('restored ' + $desktop)
}

Write-Host 'Uninstalled. Delete this folder to remove the rest.' -ForegroundColor Green
