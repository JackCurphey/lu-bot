# Runs Bonsai 2 27B for Lu on the PC's graphics card. Started at boot by the
# "Lu Model" scheduled task (register-tasks.ps1). Listens on this PC only.
# Settings come from docs/superpowers/specs/2026-11-13-lu-on-pc-design.md.
$ErrorActionPreference = 'Stop'
$root = 'C:\lu-bot'
New-Item -ItemType Directory -Force "$root\logs" | Out-Null

$serverArgs = '-m C:\bonsai\bonsai.gguf -ngl 99 -fa on -c 16384 ' +
  '--cache-type-k q4_0 --cache-type-v q4_0 --jinja --parallel 2 ' +
  '--host 127.0.0.1 --port 8080'

# cmd does the redirection: Windows PowerShell 5.1 wraps a native program's
# stderr in error records, which garbles the log.
cmd /c "C:\bonsai\bin\llama-server.exe $serverArgs >> `"$root\logs\model.log`" 2>&1"
exit $LASTEXITCODE
