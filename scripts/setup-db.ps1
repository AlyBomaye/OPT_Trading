<#
  WO-42 — Setup do banco do Opções Terminal.

  Cria usuário e banco próprios, grava a DATABASE_URL no .env.local (fora do git) e aplica o
  schema. Idempotente: rodar de novo não estraga nada.

  Por que você roda isto e não o Claude: criar o banco exige a senha do superusuário `postgres`.
  Credencial é sua e não passa por chat — o script pergunta aqui, no seu terminal.

  A porta padrão é a 5433, que é o PostgreSQL 18. A 5432 é o PostgreSQL 17, onde vive o `flg_dcm`
  do DCM Residencial — deixar os dois separados evita qualquer chance de um projeto atrapalhar o
  outro.

  Uso:
      powershell -ExecutionPolicy Bypass -File .\scripts\setup-db.ps1
#>

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot

Write-Host "== Banco do Opcoes Terminal ==" -ForegroundColor Cyan

# --- localizar o psql -------------------------------------------------------
$psql = $null
foreach ($v in 18, 17) {
  $tentativa = "C:\Program Files\PostgreSQL\$v\bin\psql.exe"
  if (Test-Path -LiteralPath $tentativa) { $psql = $tentativa; break }
}
if (-not $psql) { $psql = (Get-Command psql -ErrorAction SilentlyContinue).Source }
if (-not $psql) { throw "psql nao encontrado. Instale o PostgreSQL ou ajuste o PATH." }
Write-Host "psql: $psql"

# --- parâmetros -------------------------------------------------------------
$porta = Read-Host "Porta do Postgres [5433 = v18; 5432 = v17, onde fica o flg_dcm]"
if ([string]::IsNullOrWhiteSpace($porta)) { $porta = "5433" }

$usuario = "opcoes"
$banco   = "opcoes_terminal"

$senhaApp = Read-Host "Senha para o usuario '$usuario' (a criar)" -AsSecureString
$senhaAppTxt = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($senhaApp))
if ([string]::IsNullOrWhiteSpace($senhaAppTxt)) { throw "A senha do usuario da aplicacao nao pode ficar vazia." }

$senhaSuper = Read-Host "Senha do usuario 'postgres' (superusuario)" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($senhaSuper))

# --- criar usuário e banco --------------------------------------------------
Write-Host "`nCriando usuario '$usuario' e banco '$banco'..." -ForegroundColor Yellow

# A senha entra por variavel do psql (:'v') em vez de interpolada na string SQL: assim ela nunca
# aparece no texto do comando nem em log de erro.
#
# ATENCAO: o psql NAO interpola :'v' dentro de $$...$$ — um bloco DO recebe o texto literal e o
# servidor devolve "syntax error at or near ':'" (aconteceu em 01/09). Por isso sao dois SELECT
# fora de dollar-quote, executados com \gexec: o primeiro cria o papel so se faltar, o segundo
# sempre grava a senha. Idempotente, e a senha continua fora do texto do comando.
$sqlUsuario = @'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'usuario', :'senha_app')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'usuario') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'usuario', :'senha_app') \gexec
'@

$sqlUsuario | & $psql -h localhost -p $porta -U postgres -d postgres -v usuario="$usuario" -v senha_app="$senhaAppTxt" -v ON_ERROR_STOP=1 -q -f -
if ($LASTEXITCODE -ne 0) { throw "Falha ao criar/alterar o usuario." }

# CREATE DATABASE nao roda dentro de bloco DO; verificar antes e criar so se faltar.
$existe = & $psql -h localhost -p $porta -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$banco'"
if ($existe -ne "1") {
  & $psql -h localhost -p $porta -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $banco OWNER $usuario"
  if ($LASTEXITCODE -ne 0) { throw "Falha ao criar o banco." }
  Write-Host "Banco criado."
} else {
  Write-Host "Banco ja existia."
}

& $psql -h localhost -p $porta -U postgres -d postgres -q -c "GRANT ALL PRIVILEGES ON DATABASE $banco TO $usuario" | Out-Null
Write-Host "Usuario e banco prontos." -ForegroundColor Green

# --- aplicar o schema -------------------------------------------------------
Write-Host "`nAplicando schema..." -ForegroundColor Yellow
$env:PGPASSWORD = $senhaAppTxt
Get-ChildItem -LiteralPath (Join-Path $raiz "db") -Filter "*.sql" | Sort-Object Name | ForEach-Object {
  Write-Host "  $($_.Name)"
  & $psql -h localhost -p $porta -U $usuario -d $banco -v ON_ERROR_STOP=1 -q -f $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "Falha ao aplicar $($_.Name)." }
}
Write-Host "Schema aplicado." -ForegroundColor Green

# --- gravar a DATABASE_URL no .env.local ------------------------------------
$envPath = Join-Path $raiz ".env.local"
$url = "postgresql://${usuario}:${senhaAppTxt}@localhost:${porta}/${banco}"

$linhas = @()
if (Test-Path -LiteralPath $envPath) {
  # Preserva tudo o que ja existe (APP_PASSWORD, ANTHROPIC_API_KEY) e troca so a DATABASE_URL.
  # @( ) e obrigatorio: com UMA linha no arquivo o pipeline devolve string, e o += abaixo
  # concatenaria a URL no fim dela (aconteceu em 01/09: colou na ANTHROPIC_API_KEY).
  $linhas = @(Get-Content -LiteralPath $envPath | Where-Object { $_ -notmatch '^\s*DATABASE_URL\s*=' })
}
$linhas += "DATABASE_URL=$url"
# SEM BOM: -Encoding UTF8 do PowerShell 5.1 poe EF BB BF no inicio e o dotenv passa a ler a
# primeira chave com o BOM colado no nome — a variavel some sem nenhum erro.
[System.IO.File]::WriteAllLines($envPath, [string[]]$linhas, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "`nDATABASE_URL gravada em .env.local (ignorado pelo git)." -ForegroundColor Green
$env:PGPASSWORD = $null

Write-Host "`nPronto. Reinicie o servidor para a conexao valer:" -ForegroundColor Cyan
Write-Host "   npm run dev`n"
