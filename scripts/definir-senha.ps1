# WO-57 - define a APP_PASSWORD no .env.local, sem que a senha apareca na tela nem no historico.
#
# Por que existe: em producao o middleware (WO-37) exige APP_PASSWORD; sem ela a plataforma
# responde 503 em tudo. A senha e SUA - este script so pergunta, confere e grava. Ele nunca
# imprime o valor, e o .env.local e ignorado pelo git.
#
# Uso:  npm run senha        (ou  .\scripts\definir-senha.ps1)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $raiz ".env.local"

function DeSecure([System.Security.SecureString]$s) {
  $b = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
  finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

Write-Host ""
Write-Host "Senha de acesso da plataforma (APP_PASSWORD)" -ForegroundColor Cyan
Write-Host "Voce vai digita-la uma vez na tela de entrada a cada 7 dias." -ForegroundColor DarkGray
Write-Host "O vigia e o sync leem esta mesma senha do .env.local e entram sozinhos." -ForegroundColor DarkGray
Write-Host "Nada do que voce digitar aparece na tela." -ForegroundColor DarkGray
Write-Host ""

$s1 = Read-Host "Digite a senha" -AsSecureString
$s2 = Read-Host "Digite de novo para confirmar" -AsSecureString
$p1 = DeSecure $s1
$p2 = DeSecure $s2

if ($p1 -ne $p2) { Write-Host "`nAs duas nao batem. Nada foi gravado - rode de novo." -ForegroundColor Red; exit 1 }
if ($p1.Length -lt 8) { Write-Host "`nMuito curta: use ao menos 8 caracteres. Nada foi gravado." -ForegroundColor Red; exit 1 }
if ($p1 -ne $p1.Trim()) { Write-Host "`nComeca ou termina com espaco - isso se perde na leitura do arquivo. Nada foi gravado." -ForegroundColor Red; exit 1 }
if ($p1 -match '^"|"$|^''|''$') { Write-Host "`nNao comece nem termine com aspas: elas sao removidas na leitura. Nada foi gravado." -ForegroundColor Red; exit 1 }
if ($p1 -match '#') { Write-Host "`nEvite o caractere # : o leitor de .env pode trata-lo como comentario. Nada foi gravado." -ForegroundColor Red; exit 1 }

# Preserva o resto do arquivo e troca so a APP_PASSWORD (mesmo padrao do setup-db.ps1).
# @( ) e obrigatorio: com uma linha so, o pipeline devolve string e o += concatenaria.
$linhas = @()
$tinhaAntes = $false
if (Test-Path -LiteralPath $envPath) {
  $todas = @(Get-Content -LiteralPath $envPath)
  $tinhaAntes = ($todas | Where-Object { $_ -match '^\s*APP_PASSWORD\s*=' } | Measure-Object).Count -gt 0
  $linhas = @($todas | Where-Object { $_ -notmatch '^\s*APP_PASSWORD\s*=' })
}
$linhas += "APP_PASSWORD=$p1"

# SEM BOM: o UTF8 do PowerShell 5.1 poe EF BB BF no inicio e a primeira chave do arquivo passa a
# ser lida com o BOM colado no nome - a variavel some sem nenhum erro.
[System.IO.File]::WriteAllLines($envPath, [string[]]$linhas, (New-Object System.Text.UTF8Encoding($false)))
$p1 = $null; $p2 = $null

Write-Host ""
Write-Host ("APP_PASSWORD " + $(if ($tinhaAntes) { "atualizada" } else { "gravada" }) + " no .env.local (ignorado pelo git).") -ForegroundColor Green
Write-Host ""
Write-Host "Agora suba a producao:" -ForegroundColor Cyan
Write-Host "   npm run prod:start"
Write-Host ""
Write-Host "Depois abra http://localhost:3100 e digite a senha na tela de entrada." -ForegroundColor DarkGray
Write-Host "Se o dev (porta 3000) estiver rodando, reinicie-o para ele enxergar a variavel." -ForegroundColor DarkGray
Write-Host ""
