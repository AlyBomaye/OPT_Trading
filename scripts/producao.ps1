# WO-57 - a plataforma em producao, numa porta própria, de pe sem janela aberta.
#
# Uso:  .\scripts\producao.ps1 build | start | stop | status | logs
#
# Producao na 3100 com build em .next-prod; o dev continua na 3000 em .next. Os dois convivem de
# verdade: nem o build nem o start de producao tocam na pasta do dev. O .env.local (com
# DATABASE_URL e APP_PASSWORD) e o mesmo para as duas portas. Nada aqui imprime segredo.

param([Parameter(Position = 0)][ValidateSet("build", "start", "stop", "status", "logs")][string]$acao = "status")

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
$porta = 3100
$dirRun = Join-Path $raiz "data\run"
$dirLog = Join-Path $raiz "data\logs"
$pidFile = Join-Path $dirRun "producao.pid"
# Build de producao numa pasta propria (.next-prod): o dev continua em .next e os dois convivem.
$env:NEXT_DIST_DIR = ".next-prod"
New-Item -ItemType Directory -Force $dirRun, $dirLog | Out-Null

function Porta-Responde {
  try { $r = Invoke-WebRequest -Uri "http://localhost:$porta/api/saude" -UseBasicParsing -TimeoutSec 5; return $r.StatusCode -eq 200 } catch { return $false }
}
function Pid-Gravado {
  if (-not (Test-Path $pidFile)) { return $null }
  $p = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p -and (Get-Process -Id ([int]$p) -ErrorAction SilentlyContinue)) { return [int]$p }
  return $null
}
# Quem realmente escuta a porta. O PID gravado e o do cmd hospedeiro; quem abre o socket e um neto.
# Sem isto, um `stop` deixava servidor orfao na 3100 (com build velho) e o `start` seguinte nao subia.
function Pid-DaPorta {
  try { return (Get-NetTCPConnection -LocalPort $porta -State Listen -ErrorAction Stop | Select-Object -First 1 -ExpandProperty OwningProcess) } catch { return $null }
}
function Parar-Arvore([int]$raizPid) {
  if (-not $raizPid) { return }
  Get-CimInstance Win32_Process -Filter "ParentProcessId = $raizPid" -ErrorAction SilentlyContinue | ForEach-Object { Parar-Arvore ([int]$_.ProcessId) }
  Stop-Process -Id $raizPid -Force -ErrorAction SilentlyContinue
}
function Dev-Vivo {
  # next dev deixa um node com "next dev" na linha de comando
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match "\bnext\b.*\bdev\b" }
  return ($procs | Measure-Object).Count -gt 0
}

switch ($acao) {
  "build" {
    # O build vai para .next-prod: o 'next dev' (em .next) pode continuar vivo.
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
    if (Porta-Responde) { Write-Host "A producao ja responde na porta $porta (PID $(Pid-DaPorta)). Nada a fazer." -ForegroundColor Green; exit 0 }
    $ocupada = Pid-DaPorta
    if ($ocupada) { Write-Host "A porta $porta esta ocupada pelo PID $ocupada, que nao responde em /api/saude (build antigo ou processo orfao). Rode: npm run prod:stop" -ForegroundColor Yellow; exit 2 }
    if (-not (Test-Path (Join-Path $raiz ".next-prod"))) { Write-Host "Sem build (.next-prod ausente). Rode: npm run prod:build" -ForegroundColor Yellow; exit 2 }
    # Producao exige APP_PASSWORD (middleware, WO-37): sem ela toda rota responde 503. So se confere a presenca; o valor nunca e lido nem impresso.
    $envFile = Join-Path $raiz ".env.local"
    $temSenha = (Test-Path $envFile) -and ((Get-Content $envFile | Where-Object { $_ -match '^APP_PASSWORD=\S+' } | Measure-Object).Count -gt 0)
    if (-not $temSenha) { Write-Host "Producao exige APP_PASSWORD no .env.local (a plataforma responde 503 sem ela). Adicione a linha APP_PASSWORD=<sua senha> e rode prod:start de novo. Os scripts (vigia, sync) leem a mesma senha para entrar." -ForegroundColor Yellow; exit 2 }
    $log = Join-Path $dirLog ("producao-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
    $cmd = "cd /d `"$raiz`" && set NEXT_DIST_DIR=.next-prod&& npx next start -p $porta >> `"$log`" 2>&1"
    $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmd -WindowStyle Hidden -PassThru
    Set-Content -Path $pidFile -Value $p.Id -Encoding ascii
    $ok = $false
    for ($i = 0; $i -lt 30 -and -not $ok; $i++) { Start-Sleep -Seconds 1; $ok = Porta-Responde }
    if ($ok) { Write-Host "Producao no ar: http://localhost:$porta (PID $($p.Id)) - log em $log" -ForegroundColor Green }
    else { Write-Host "Subiu o processo (PID $($p.Id)) mas a porta $porta nao respondeu em 30s. Veja: npm run prod:logs" -ForegroundColor Yellow; exit 1 }
  }
  "stop" {
    $alvos = @((Pid-Gravado), (Pid-DaPorta)) | Where-Object { $_ } | Select-Object -Unique
    if (-not $alvos) { Write-Host "Producao nao esta rodando (nada no PID gravado nem escutando a $porta)."; Remove-Item $pidFile -ErrorAction SilentlyContinue; exit 0 }
    foreach ($a in $alvos) { Parar-Arvore ([int]$a); Write-Host "  encerrado PID $a e filhos" }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $sobrou = Pid-DaPorta
    if ($sobrou) { Write-Host "Ainda ha algo na porta $porta (PID $sobrou)." -ForegroundColor Yellow; exit 1 }
    Write-Host "Producao parada."
  }
  "status" {
    $vivo = Pid-DaPorta
    if (-not $vivo) { $vivo = Pid-Gravado }
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
