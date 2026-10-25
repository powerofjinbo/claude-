' watch-claude.vbs -- start watch-claude.ps1 without a console window.
' (powershell -WindowStyle Hidden still flashes a console for a moment; wscript does not.)
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\watch-claude.ps1"""
CreateObject("WScript.Shell").Run cmd, 0, False
