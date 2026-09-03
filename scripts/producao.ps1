# WO-57 — a plataforma em produção, numa porta própria, de pé sem janela aberta.
#
# Uso:  .\scripts\producao.ps1 build | start | stop | status | logs
#
# Produção na 3100; o dev continua na 3000 e os dois convivem. `build` recusa com `next dev` vivo
# porque os dois escrevem em .next e isso já corrompeu o CSS. O .env.local (com DATABASE_URL) é o
# mesmo para as duas portas. Nada aqui imprime segredo.

param([Parameter(Position = 0)][ValidateSet("build", "start", "stop", "status", "logs")][string]$acao = "status")

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
$porta = 3100
$dirRun = Join-Path $raiz "data\run"
$dirLog = Join-Path $raiz "data\logs"
$pidFile = Join-Path $dirRun "producao.pid"
New-Item -ItemType Directory -Force $dirRun, $dirLog | Out-Null

function Porta-Responde {
  try { $r = Invoke-WebRequest -Uri "http://localhost:$porta/api/limites" -UseBasicParsing -TimeoutSec 5; return $r.StatusCode -eq 200 } catch { return $false }
}
function Pid-Gravado {
  if (-not (Test-Path $pidFile)) { return $null }
  $p = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p -and (Get-Process -Id ([int]$p) -ErrorAction SilentlyContinue)) { return [int]$p }
  return $null
}
function Dev-Vivo {
  # next dev deixa um node com "next dev" na linha de comando
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match "next dev" }
  return ($procs | Measure-Object).Count -gt 0
}

switch ($acao) {
  "build" {
    if (Dev-Vivo) { Write-Host "Recusado: ha um 'next dev' vivo. dev e build brigam pelo .next (ja corrompeu o CSS antes). Pare o dev, faca o build e suba o dev de novo." -ForegroundColor Yellow; exit 2 }
    $vivo = Pid-Gravado
    if ($vivo) { Write-Host "Parando a producao (PID $vivo) para o build..."; Stop-Process -Id $vivo -Force; Start-Sleep -Seconds 2 }
    Push-Location $raiz
    try {
      Write-Host "npm run build ..."
      & cmd /c "npm run build"
      if ($LASTEXITCODE -ne 0) { Write-Host "Build falhou (codigo $LASTEXITCODE)." -ForegroundColor Red; exit $LASTEXITCODE }
      $ver = (git -C $raiz rev-parse --short HEAD 2>$null)
      Set-Content -Path (Join-Path $dirRun "producao.build") -Value "$ver $(Get-Date -Format s)" -Encoding ascii
      Write-Host "Build ok ($ver). Suba com: npm run prod:start" -ForegroundColor Green
    } finally { Pop-Location }
  }
  "start" {
    if (Porta-Responde) { Write-Host "A producao ja responde na porta $porta (PID $(Pid-Gravado)). Nada a fazer." -ForegroundColor Green; exit 0 }
    if (-not (Test-Path (Join-Path $raiz ".next"))) { Write-Host "Sem build (.next ausente). Rode: npm run prod:build" -ForegroundColor Yellow; exit 2 }
    $log = Join-Path $dirLog ("producao-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
    $cmd = "cd /d `"$raiz`" && npx next start -p $porta >> `"$log`" 2>&1"
    $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmd -WindowStyle Hidden -PassThru
    Set-Content -Path $pidFile -Value $p.Id -Encoding ascii
    $ok = $false
    for ($i = 0; $i -lt 30 -and -not $ok; $i++) { Start-Sleep -Seconds 1; $ok = Porta-Responde }
    if ($ok) { Write-Host "Producao no ar: http://localhost:$porta (PID $($p.Id)) - log em $log" -ForegroundColor Green }
    else { Write-Host "Subiu o processo (PID $($p.Id)) mas a porta $porta nao respondeu em 30s. Veja: npm run prod:logs" -ForegroundColor Yellow; exit 1 }
  }
  "stop" {
    $vivo = Pid-Gravado
    if (-not $vivo) { Write-Host "Producao nao esta rodando (sem PID vivo)."; Remove-Item $pidFile -ErrorAction SilentlyContinue; exit 0 }
    # O cmd hospeda o node; encerra a arvore.
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $vivo" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $vivo -Force -ErrorAction SilentlyContinue
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    Write-Host "Producao parada (PID $vivo)."
  }
  "status" {
    $vivo = Pid-Gravado
    $resp = Porta-Responde
    $build = if (Test-Path (Join-Path $dirRun "producao.build")) { Get-Content (Join-Path $dirRun "producao.build") } else { "sem build registrado" }
    Write-Host ("porta {0}: {1} | PID: {2} | build: {3} | dev vivo: {4}" -f $porta, $(if ($resp) { "responde" } else { "sem resposta" }), $(if ($vivo) { $vivo } else { "-" }), $build, $(Dev-Vivo))
    if (-not $resp) { exit 1 }
  }
  "logs" {
    $log = Get-ChildItem $dirLog -Filter "producao-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($log) { Get-Content $log.FullName -Tail 40 } else { Write-Host "Sem log de producao ainda." }
  }
}
