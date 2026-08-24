<#
  WO-42 — Redefinição da senha do superusuário 'postgres'.

  Só rode isto se você NÃO souber a senha do 'postgres'. Se souber, vá direto ao setup:
      npm run setup:db

  COMO FUNCIONA, e por que exige administrador: o PostgreSQL não deixa trocar a senha sem
  autenticar. A saída é liberar o método de autenticação para `trust` no pg_hba.conf, reiniciar o
  serviço, trocar a senha, e RESTAURAR o arquivo.

  A restauração não é opcional: enquanto o `trust` estiver valendo, qualquer processo da máquina
  entra no banco sem senha. Por isso ela está num `finally` — mesmo que algo falhe no meio, ou que
  você interrompa com Ctrl+C, o arquivo volta ao que era e o serviço reinicia.

  Uso (PowerShell COMO ADMINISTRADOR):
      npm run reset:senha-db
  ou
      powershell -ExecutionPolicy Bypass -File .\scripts\reset-senha-postgres.ps1
#>

$ErrorActionPreference = "Stop"

Write-Host "== Redefinicao da senha do 'postgres' ==" -ForegroundColor Cyan

# --- exige administrador ----------------------------------------------------
$ehAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $ehAdmin) {
  throw "Este script precisa de PowerShell COMO ADMINISTRADOR: ele edita o pg_hba.conf e reinicia o servico do PostgreSQL."
}

# --- descobrir as instancias instaladas e suas portas -----------------------
$instancias = @()
foreach ($v in 18, 17, 16, 15) {
  $dados = "C:\Program Files\PostgreSQL\$v\data"
  $conf  = Join-Path $dados "postgresql.conf"
  $psql  = "C:\Program Files\PostgreSQL\$v\bin\psql.exe"
  if ((Test-Path -LiteralPath $conf) -and (Test-Path -LiteralPath $psql)) {
    $linhaPorta = Select-String -LiteralPath $conf -Pattern '^\s*port\s*=\s*(\d+)' | Select-Object -First 1
    $porta = if ($linhaPorta) { [int]$linhaPorta.Matches[0].Groups[1].Value } else { 5432 }
    $instancias += [pscustomobject]@{
      Versao  = $v
      Porta   = $porta
      Dados   = $dados
      Psql    = $psql
      Servico = "postgresql-x64-$v"
    }
  }
}
if ($instancias.Count -eq 0) { throw "Nenhuma instalacao do PostgreSQL encontrada em C:\Program Files\PostgreSQL." }

Write-Host "`nInstancias encontradas:"
foreach ($i in $instancias) { Write-Host ("  PostgreSQL {0} na porta {1}" -f $i.Versao, $i.Porta) }

$padrao = ($instancias | Where-Object { $_.Versao -eq 18 } | Select-Object -First 1)
if (-not $padrao) { $padrao = $instancias[0] }

$portaEscolhida = Read-Host "`nPorta a redefinir [$($padrao.Porta)]"
if ([string]::IsNullOrWhiteSpace($portaEscolhida)) { $portaEscolhida = $padrao.Porta }

$alvo = $instancias | Where-Object { $_.Porta -eq [int]$portaEscolhida } | Select-Object -First 1
if (-not $alvo) { throw "Nenhuma instancia escutando na porta $portaEscolhida." }

Write-Host ("`nAlvo: PostgreSQL {0}, porta {1}, servico {2}" -f $alvo.Versao, $alvo.Porta, $alvo.Servico) -ForegroundColor Yellow
if ($alvo.Porta -eq 5432) {
  Write-Host "ATENCAO: a porta 5432 e a instancia onde vive o banco do DCM Residencial." -ForegroundColor Red
  $ok = Read-Host "Confirma mexer nela? (digite SIM)"
  if ($ok -ne "SIM") { Write-Host "Cancelado."; exit 0 }
}

# --- nova senha, com confirmacao -------------------------------------------
$s1 = Read-Host "NOVA senha para o usuario 'postgres'" -AsSecureString
$s2 = Read-Host "Repita a nova senha" -AsSecureString
$t1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
$t2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))
if ($t1 -ne $t2) { throw "As senhas nao conferem." }
if ([string]::IsNullOrWhiteSpace($t1)) { throw "A senha nao pode ficar vazia." }

$hba    = Join-Path $alvo.Dados "pg_hba.conf"
$backup = "$hba.antes-do-reset"
if (-not (Test-Path -LiteralPath $hba)) { throw "pg_hba.conf nao encontrado em $($alvo.Dados)." }

$restaurado = $false
try {
  # --- liberar temporariamente ---------------------------------------------
  Copy-Item -LiteralPath $hba -Destination $backup -Force
  # Troca o metodo SO nas linhas host/local de conexao, preservando comentarios.
  $novo = Get-Content -LiteralPath $hba | ForEach-Object {
    if ($_ -match '^\s*(host|hostssl|hostnossl|local)\s') {
      $_ -replace '(scram-sha-256|md5|password|peer|sspi|ident)\s*$', 'trust'
    } else { $_ }
  }
  Set-Content -LiteralPath $hba -Value $novo -Encoding UTF8

  Write-Host "`nLiberando autenticacao temporariamente e reiniciando o servico..." -ForegroundColor Yellow
  Restart-Service -Name $alvo.Servico -Force
  Start-Sleep -Seconds 3

  # --- trocar a senha -------------------------------------------------------
  # A senha entra por variavel do psql (:'v'), nunca interpolada no texto do comando — assim ela
  # nao aparece em log nem em mensagem de erro.
  $env:PGPASSWORD = ""
  "ALTER ROLE postgres PASSWORD :'nova';" |
    & $alvo.Psql -h localhost -p $alvo.Porta -U postgres -d postgres -v nova="$t1" -v ON_ERROR_STOP=1 -f -
  if ($LASTEXITCODE -ne 0) { throw "Falha ao redefinir a senha (psql retornou $LASTEXITCODE)." }
  Write-Host "Senha redefinida." -ForegroundColor Green
}
finally {
  # --- restaurar SEMPRE -----------------------------------------------------
  # Enquanto o 'trust' estiver valendo, qualquer processo da maquina entra sem senha. Este bloco
  # roda mesmo em erro ou Ctrl+C — e por isso que ele existe.
  if (Test-Path -LiteralPath $backup) {
    Move-Item -LiteralPath $backup -Destination $hba -Force
    Restart-Service -Name $alvo.Servico -Force
    Start-Sleep -Seconds 2
    $restaurado = $true
    Write-Host "pg_hba.conf restaurado e servico reiniciado." -ForegroundColor Green
  }
  $env:PGPASSWORD = $null
}

if (-not $restaurado) {
  Write-Host "ATENCAO: nao foi possivel restaurar o pg_hba.conf. Verifique $hba ANTES de usar o banco." -ForegroundColor Red
  exit 1
}

Write-Host "`nPronto. Agora rode o setup do banco com a senha nova:" -ForegroundColor Cyan
Write-Host "  npm run setup:db`n"
