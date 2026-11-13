# Stops Lu and his model server on the PC, and keeps them from restarting
# until start is run again. Stop-ScheduledTask alone ends the start scripts
# but leaves the programs they launched running, so those are stopped here.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\stop-all.ps1          # stop now; they come back at next boot
#   powershell -ExecutionPolicy Bypass -File scripts\windows\stop-all.ps1 -Disable # also keep them off after reboots
param([switch]$Disable)

foreach ($name in 'Lu Bot', 'Lu Model') {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($Disable) { Disable-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue | Out-Null }
}
# Stopping the tasks first ends the start scripts' restart loops; only then
# are the programs stopped, so nothing starts them again.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.ExecutablePath -eq 'C:\lu-bot\node\node.exe' -and $_.CommandLine -like '*src/index.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-Process llama-server -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like 'C:\bonsai\*' } | Stop-Process -Force
Write-Output 'stopped'
