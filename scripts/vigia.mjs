/**
 * WO-57 — o vigia: um processo pequeno que fica de pé, pergunta à plataforma "o que merece aviso
 * agora?" e dispara notificação nativa do Windows para o que é novo. Não avalia regra nenhuma —
 * quem avalia é GET /api/alertas, com as funções da tela.
 *
 * Uso:
 *   node scripts/vigia.mjs                # produção em http://localhost:3100
 *   BASE_URL=http://localhost:3000 node scripts/vigia.mjs
 *   node scripts/vigia.mjs --uma-vez      # um ciclo e sai (para testar)
 *
 * Estado: data/run/vigia-avisados-AAAA-MM-DD.json (o "visto" zera a cada pregão, como na tela).
 * Log:    data/logs/vigia-AAAA-MM-DD.log
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const UMA_VEZ = process.argv.includes("--uma-vez");
const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIR_RUN = path.join(RAIZ, "data", "run");
const DIR_LOG = path.join(RAIZ, "data", "logs");
const SEVERIDADES_QUE_AVISAM = new Set(["urgente", "atencao"]);
const INTERVALO_MIN = { ABERTO: 5, PRE: 15, FECHADO: 60, FIM_DE_SEMANA: 360 };
const FALHAS_ATE_AVISAR = 3;

for (const d of [DIR_RUN, DIR_LOG]) fs.mkdirSync(d, { recursive: true });

const hojeIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function log(linha) {
  const ts = new Date().toISOString();
  const txt = `${ts} ${linha}`;
  console.log(txt);
  try {
    fs.appendFileSync(path.join(DIR_LOG, `vigia-${hojeIso()}.log`), txt + "\n");
  } catch {
    /* log é conveniência */
  }
}

function lerAvisados(dia) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DIR_RUN, `vigia-avisados-${dia}.json`), "utf8"));
    return new Set(Array.isArray(j?.chaves) ? j.chaves : []);
  } catch {
    return new Set();
  }
}

function gravarAvisados(dia, chaves) {
  try {
    fs.writeFileSync(path.join(DIR_RUN, `vigia-avisados-${dia}.json`), JSON.stringify({ dia, chaves: Array.from(chaves), atualizadoEm: new Date().toISOString() }, null, 2));
  } catch (e) {
    log(`falha ao gravar avisados: ${e?.message ?? e}`);
  }
}

/** Notificação nativa do Windows (WinRT toast) via PowerShell. Devolve false sem lançar. */
function toast(titulo, corpo) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const ps = [
    "$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]",
    "$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]",
    "$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
    "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
    `$xml.LoadXml('<toast><visual><binding template="ToastText02"><text id="1">${esc(titulo).replace(/'/g, "''")}</text><text id="2">${esc(corpo).replace(/'/g, "''")}</text></binding></visual></toast>')`,
    "$toast = New-Object Windows.UI.Notifications.ToastNotification $xml",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)",
  ].join("; ");
  const encoded = Buffer.from(ps, "utf16le").toString("base64");
  return new Promise((resolve) => {
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", (code) => {
      if (code !== 0) log(`toast falhou (código ${code}): ${err.trim().slice(0, 200)} — o registro no log vale como aviso`);
      resolve(code === 0);
    });
    p.on("error", (e) => {
      log(`toast indisponível: ${e?.message ?? e}`);
      resolve(false);
    });
  });
}

let falhasSeguidas = 0;
let avisouQueda = false;

async function ciclo() {
  const dia = hojeIso();
  let resp;
  try {
    const r = await fetch(`${BASE}/api/alertas`, { signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    resp = await r.json();
  } catch (e) {
    falhasSeguidas++;
    log(`plataforma não respondeu (${falhasSeguidas}/${FALHAS_ATE_AVISAR}): ${e?.message ?? e}`);
    if (falhasSeguidas >= FALHAS_ATE_AVISAR && !avisouQueda) {
      avisouQueda = true;
      await toast("Opções Terminal fora do ar", `Sem resposta de ${BASE} em ${falhasSeguidas} ciclos. Rode npm run prod:status.`);
    }
    return { estado: "FECHADO" };
  }
  if (falhasSeguidas > 0) log(`plataforma voltou depois de ${falhasSeguidas} falha(s)`);
  falhasSeguidas = 0;
  avisouQueda = false;

  if (!resp?.configurado) {
    log(`sem livro: ${resp?.aviso ?? "banco não configurado"}`);
    return { estado: resp?.sessao ?? "FECHADO" };
  }
  const alertas = Array.isArray(resp.alertas) ? resp.alertas : [];
  const avisados = lerAvisados(dia);
  // Mesma regra de lib/vigia.ts: severidade mínima e chave nova.
  const novos = alertas.filter((a) => SEVERIDADES_QUE_AVISAM.has(a.severidade) && !avisados.has(a.chave));
  log(`sessão ${resp.sessao} · ${resp.posicoes} perna(s) · ${alertas.length} alerta(s) · ${novos.length} novo(s)${resp.semCadeia?.length ? ` · sem cadeia: ${resp.semCadeia.join(", ")}` : ""}`);
  for (const a of novos) {
    const ok = await toast(`${a.severidade === "urgente" ? "⚠ " : ""}${a.titulo}`, a.detalhe);
    log(`${ok ? "avisado" : "registrado"} [${a.severidade}] ${a.chave} — ${a.titulo}`);
    avisados.add(a.chave);
  }
  if (novos.length) gravarAvisados(dia, avisados);
  return { estado: resp.sessao };
}

async function principal() {
  log(`vigia iniciado — base ${BASE}${UMA_VEZ ? " (um ciclo)" : ""}`);
  for (;;) {
    const { estado } = await ciclo();
    if (UMA_VEZ) break;
    const min = INTERVALO_MIN[estado] ?? 60;
    await new Promise((r) => setTimeout(r, min * 60_000));
  }
}

principal().catch((e) => {
  log(`erro fatal: ${e?.message ?? e}`);
  process.exit(1);
});
