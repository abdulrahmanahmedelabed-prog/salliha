$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "صلّحها: http://127.0.0.1:8080"
Start-Process "http://127.0.0.1:8080"
python -m http.server 8080 --bind 127.0.0.1 --directory $root
