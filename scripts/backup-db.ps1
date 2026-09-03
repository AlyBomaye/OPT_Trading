# WO-57 §E — backup diario do Postgres para o OneDrive, mantendo os 30 ultimos.
#
# O livro (boletas, base fiscal) e o historico de IV sao as duas coisas da plataforma que nao se
# recuperam de fonte nenhuma. A senha NAO entra aqui: o pg_dump recebe a DATABASE_URL do
# .env.local como conexao, e este script nunca a imprime.

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
$env = Join-Path $raiz ".env.local"
if (-not (Test-Path $env)) { Write-Host "Sem .env.local — nada a fazer."; exit 2 }
$linha = Get-Content $env | Where-Object { $_ -like "DATABASE_URL=*" } | Select-Object -First 1
if (-not $linha) { Write-Host "DATABASE_URL ausente do .env.local."; exit 2 }
$url = $linha.Substring("DATABASE_URL=".Length).Trim().Trim('"')

# pg_dump: PATH, depois as instalacoes padrao (a 18 primeiro).
$pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
if (-not $pgDump) {
  $cands = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue | Sort-Object { [int]($_.Name -replace '\D', '0') } -Descending | ForEach-Object { Join-Path $_.FullName "bin\pg_dump.exe" }
  $pgDump = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $pgDump) { Write-Host "pg_dump nao encontrado (PATH ou C:\Program Files\PostgreSQL\*\bin)."; exit 2 }

$destino = if ($env:OneDrive) { Join-Path $env:OneDrive "Vitor\Opções - Trading\backup" } else { Join-Path $raiz "data\backup" }
New-Item -ItemType Directory -Force $destino | Out-Null
$arquivo = Join-Path $destino ("opcoes-" + (Get-Date -Format "yyyy-MM-dd") + ".dump")
$log = Join-Path $raiz "data\logs\backup.log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null

& $pgDump --format=custom --no-owner --file=$arquivo --dbname=$url 2>&1 | Where-Object { $_ -notmatch "postgres(ql)?://" } | Out-Null
$codigo = $LASTEXITCODE
if ($codigo -ne 0 -or -not (Test-Path $arquivo)) {
  Add-Content $log "$(Get-Date -Format s) FALHOU codigo=$codigo"
  Write-Host "Backup falhou (codigo $codigo)." -ForegroundColor Red
  exit 1
}
$tam = (Get-Item $arquivo).Length
Add-Content $log "$(Get-Date -Format s) ok $arquivo ($tam bytes)"
Get-ChildItem $destino -Filter "opcoes-*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -Force -ErrorAction SilentlyContinue
Write-Host "Backup ok: $arquivo ($tam bytes)" -ForegroundColor Green
