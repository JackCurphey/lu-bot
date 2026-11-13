# Starts Lu on the PC once the model server answers. Started at boot by the
# "Lu Bot" scheduled task (register-tasks.ps1). Uses the portable Node 26 in
# C:\lu-bot\node, so the PC's own Node install is left alone.
$ErrorActionPreference = 'Stop'
$root = 'C:\lu-bot'
New-Item -ItemType Directory -Force "$root\logs" | Out-Null
$log = "$root\logs\lu.log"

# The model takes about 15 seconds to load. Without this wait, Lu's first
# replies would fail against a server that isn't up yet.
$deadline = (Get-Date).AddSeconds(120)
$ready = $false
while ((Get-Date) -lt $deadline) {
  try {
    $res = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8080/health
    if ($res.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
  Start-Sleep -Seconds 2
}
if (-not $ready) {
  Add-Content $log "$(Get-Date -Format s) model server not answering after 120 s; exiting so Task Scheduler retries"
  exit 1
}

Set-Location $root
cmd /c "`"$root\node\node.exe`" --env-file-if-exists=.env src/index.js >> `"$log`" 2>&1"
exit $LASTEXITCODE
