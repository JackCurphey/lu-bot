# Starts Lu on the PC once the model server answers, and starts him again
# whenever he stops. Started at boot by the "Lu Bot" scheduled task
# (register-tasks.ps1). Uses the portable Node 26 in C:\lu-bot\node, so the
# PC's own Node install is left alone.
#
# The restart loop lives here because Task Scheduler's "restart on failure"
# only covers a task that fails to launch: when node exits after starting,
# the task just ends (checked 2026-11-13: killed Lu, no restart in 2.5 min).
# stop-all.ps1 ends this loop by stopping the task, then stops node.
$root = 'C:\lu-bot'
New-Item -ItemType Directory -Force "$root\logs" | Out-Null
$log = "$root\logs\lu.log"
function Note($text) { Add-Content $log "$(Get-Date -Format s) [start-lu] $text" }

function Wait-ForModel {
  $warned = $false
  while ($true) {
    try {
      $res = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8080/health
      if ($res.StatusCode -eq 200) { return }
    } catch { }
    if (-not $warned) { Note 'waiting for the model server'; $warned = $true }
    Start-Sleep -Seconds 2
  }
}

# Only Lu's own process: matched on its command line, so an npm test or
# script run with the same portable node is left alone.
function Stop-LeftoverLu {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.ExecutablePath -eq "$root\node\node.exe" -and $_.CommandLine -like '*src/index.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

Set-Location $root
while ($true) {
  # The model takes about 15 seconds to load; without this wait Lu's first
  # replies would fail against a server that isn't up yet.
  Wait-ForModel
  # Two copies would both log in to Discord and reply twice.
  Stop-LeftoverLu
  cmd /c "`"$root\node\node.exe`" --env-file-if-exists=.env src/index.js >> `"$log`" 2>&1"
  Note "Lu exited with code $LASTEXITCODE; starting him again in 10 s"
  Start-Sleep -Seconds 10
}
