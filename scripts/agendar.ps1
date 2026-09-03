# WO-57 — as tarefas agendadas da plataforma, no Agendador do Windows, no contexto do usuario.
#
# Uso:  .\scripts\agendar.ps1 instalar | remover | listar
#
# Quatro tarefas com o prefixo OpcoesTerminal-:
#   Plataforma  no logon           -> producao.ps1 start (confere a porta antes; nao abre dois servidores)
#   Sync        dias uteis 18:30   -> npm run dados:sync na porta 3100 (historico de IV e GEX diario)
#   Vigia       no logon           -> scripts/vigia.mjs residente (avisos nativos do Windows)
#   Backup      dias uteis 19:00   -> backup-db.ps1 (pg_dump para o OneDrive)
# Nenhuma exige administrador. Se o Windows pedir elevacao, o script diz e para.

param([Parameter(Position = 0)][ValidateSet("instalar", "remover", "listar")][string]$acao = "listar")

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot
$prefixo = "OpcoesTerminal-"
$usuario = "$env:USERDOMAIN\$env:USERNAME"
$ps = "powershell.exe"
$argsBase = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden"

function Tarefas { Get-ScheduledTask -TaskName "$prefixo*" -ErrorAction SilentlyContinue }

function Registrar($nome, $acaoTask, $trigger, $semLimite) {
  $settings = if ($semLimite) { New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) }
              else { New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew }
  try {
    Register-ScheduledTask -TaskName "$prefixo$nome" -Action $acaoTask -Trigger $trigger -Settings $settings -User $usuario -RunLevel Limited -Force | Out-Null
    Write-Host "  registrada: $prefixo$nome" -ForegroundColor Green
  } catch {
    if ($_.Exception.Message -match "Acesso negado|Access is denied") { Write-Host "  $prefixo$nome: o Windows exigiu elevacao para registrar. Abra um PowerShell como administrador e rode este script de novo." -ForegroundColor Yellow; exit 3 }
    throw
  }
}

switch ($acao) {
  "instalar" {
    Write-Host "Registrando tarefas para $usuario em $raiz"
    $logon = New-ScheduledTaskTrigger -AtLogOn -User $usuario
    $logon.Delay = "PT1M"
    Registrar "Plataforma" (New-ScheduledTaskAction -Execute $ps -Argument "$argsBase -File `"$raiz\scripts\producao.ps1`" start" -WorkingDirectory $raiz) $logon $false

    $sync = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At 18:30
    Registrar "Sync" (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c set BASE_URL=http://localhost:3100&& npm run dados:sync >> `"$raiz\data\logs\sync.log`" 2>&1" -WorkingDirectory $raiz) $sync $false

    $logonVigia = New-ScheduledTaskTrigger -AtLogOn -User $usuario
    $logonVigia.Delay = "PT2M"
    Registrar "Vigia" (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c set BASE_URL=http://localhost:3100&& node scripts\vigia.mjs >> `"$raiz\data\logs\vigia-processo.log`" 2>&1" -WorkingDirectory $raiz) $logonVigia $true

    $backup = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At 19:00
    Registrar "Backup" (New-ScheduledTaskAction -Execute $ps -Argument "$argsBase -File `"$raiz\scripts\backup-db.ps1`"" -WorkingDirectory $raiz) $backup $false
    Write-Host "Pronto. Confira com: .\scripts\agendar.ps1 listar"
  }
  "remover" {
    $t = Tarefas
    if (-not $t) { Write-Host "Nenhuma tarefa $prefixo* registrada."; exit 0 }
    $t | ForEach-Object { Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false; Write-Host "  removida: $($_.TaskName)" }
  }
  "listar" {
    $t = Tarefas
    if (-not $t) { Write-Host "Nenhuma tarefa $prefixo* registrada. Rode: .\scripts\agendar.ps1 instalar"; exit 1 }
    $t | ForEach-Object {
      $info = Get-ScheduledTaskInfo -TaskName $_.TaskName
      [PSCustomObject]@{ Tarefa = $_.TaskName; Estado = $_.State; UltimaExecucao = $info.LastRunTime; UltimoResultado = $info.LastTaskResult; Proxima = $info.NextRunTime }
    } | Format-Table -AutoSize
  }
}
