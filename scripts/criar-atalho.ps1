# Cria o atalho "IPTVKZ" na área de trabalho apontando para launcher\start.vbs
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'IPTVKZ.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = "$env:WINDIR\System32\wscript.exe"
$s.Arguments = '"' + (Join-Path $root 'launcher\start.vbs') + '"'
$s.WorkingDirectory = $root
$s.IconLocation = (Join-Path $root 'launcher\iptvkz.ico') + ',0'
$s.Description = 'IPTVKZ - player IPTV pessoal'
$s.Save()
Write-Output "Atalho criado em: $lnk"
