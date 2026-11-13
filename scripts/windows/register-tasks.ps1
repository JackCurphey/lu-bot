# Registers the two scheduled tasks that run Lu on the PC. Run once, from an
# administrator PowerShell (an SSH session as jack is one). Safe to re-run:
# -Force replaces existing tasks.
#
# S4U: the tasks run at boot as this user without anyone logging in, and
# Windows stores no password for them.
$ErrorActionPreference = 'Stop'

# The account comes from the current identity, not $env:USERDOMAIN: over SSH
# that variable reads WORKGROUP, which Windows can't map to an account.
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$trigger = New-ScheduledTaskTrigger -AtStartup

$tasks = @(
  @{ Name = 'Lu Model'; Script = 'start-model.ps1' },
  @{ Name = 'Lu Bot';   Script = 'start-lu.ps1' }
)
foreach ($t in $tasks) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\lu-bot\scripts\windows\$($t.Script)" `
    -WorkingDirectory 'C:\lu-bot'
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null
  Write-Output "registered: $($t.Name)"
}
