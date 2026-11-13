# Runs Bonsai 2 27B for Lu on the PC's graphics card, and starts it again
# whenever it stops. Started at boot by the "Lu Model" scheduled task
# (register-tasks.ps1). Listens on this PC only. Settings come from
# docs/superpowers/specs/2026-11-13-lu-on-pc-design.md.
#
# The restart loop lives here because Task Scheduler's "restart on failure"
# doesn't restart a program that exits after starting (see start-lu.ps1).
$root = 'C:\lu-bot'
New-Item -ItemType Directory -Force "$root\logs" | Out-Null
$log = "$root\logs\model.log"

# --alias: without it the server names the model by its full path, which
# doesn't match LLM_CHAT_MODEL / LLM_JUDGE_MODEL=bonsai.gguf in .env, and Lu's
# startup check switches the addressee judge off.
$serverArgs = '-m C:\bonsai\bonsai.gguf --alias bonsai.gguf -ngl 99 -fa on -c 16384 ' +
  '--cache-type-k q4_0 --cache-type-v q4_0 --jinja --parallel 2 ' +
  '--host 127.0.0.1 --port 8080'

while ($true) {
  # A leftover server (from a stopped task) would hold port 8080.
  Get-Process llama-server -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like 'C:\bonsai\*' } | Stop-Process -Force
  # cmd does the redirection: Windows PowerShell 5.1 wraps a native program's
  # stderr in error records, which garbles the log.
  cmd /c "C:\bonsai\bin\llama-server.exe $serverArgs >> `"$log`" 2>&1"
  Add-Content $log "$(Get-Date -Format s) [start-model] server exited with code $LASTEXITCODE; starting it again in 10 s"
  Start-Sleep -Seconds 10
}
