"use client";

/**
 * WO-50 §C — o arquivo de IV: quanto há no navegador, quanto há no banco, e o botão que leva um
 * para o outro uma vez. Exportar/importar JSON continuam como backup — o banco é a verdade, o
 * arquivo é o seguro.
 */

import { useEffect, useRef, useState } from "react";
import { Database, FileJson, Upload, Check } from "lucide-react";
import { useSnapshots, type IvSnapshot } from "@/lib/snapshots";
import { downloadText } from "@/lib/format";

interface Cobertura {
  configurado: boolean;
  minimoObservacoes: number;
  cobertura: Array<{ ticker: string; observacoes: number; ultimaData: string | null }>;
}

export function ArquivoIv() {
  const { snapshots, importSnapshots } = useSnapshots();
  const importRef = useRef<HTMLInputElement | null>(null);
  const [banco, setBanco] = useState<Cobertura | null>(null);
  const [migrando, setMigrando] = useState(false);
  const [feito, setFeito] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregarBanco = () =>
    fetch("/api/iv-historico", { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setBanco(j))
      .catch(() => {});

  useEffect(() => {
    void carregarBanco();
  }, []);

  const totalBanco = banco?.cobertura?.reduce((a, c) => a + c.observacoes, 0) ?? 0;
  const tickersBanco = banco?.cobertura?.length ?? 0;
  const tickersNav = new Set(snapshots.map((s) => s.ticker)).size;

  const migrar = async () => {
    setMigrando(true);
    setErro(null);
    try {
      const res = await fetch("/api/iv-historico/migrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshots }),
        signal: AbortSignal.timeout(60_000),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.configurado) {
        setErro(j?.error ?? `Migração recusada (${res.status}). Nada foi gravado.`);
        return;
      }
      setFeito(`${j.gravados} snapshot(s) gravado(s) no banco; ${j.ignorados} já existiam pelo sync e ficaram como estavam.`);
      await carregarBanco();
    } catch (e: any) {
      setErro(`Falha: ${e?.message ?? "erro"}`);
    } finally {
      setMigrando(false);
    }
  };

  const exportar = () =>
    downloadText("iv-snapshots.json", JSON.stringify({ exportedAt: new Date().toISOString(), snapshots }, null, 2), "application/json");

  const importar = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { snapshots?: IvSnapshot[] } | IvSnapshot[];
      const list = Array.isArray(parsed) ? parsed : parsed.snapshots ?? [];
      const added = importSnapshots(list);
      alert(`${added} snapshot(s) importado(s) para o navegador. Use "Levar para o banco" para gravá-los.`);
    } catch {
      alert("Arquivo inválido — esperado JSON exportado pelo terminal.");
    }
  };

  return (
    <div className="panel px-3 py-2 text-xxs text-term-dim space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Database size={12} className="text-term-cyan" />
        <span>
          Histórico de IV — navegador: <span className="text-term-text font-semibold">{snapshots.length}</span> snapshot(s) em {tickersNav} papel(is) ·{" "}
          banco:{" "}
          {banco == null ? (
            "consultando…"
          ) : banco.configurado ? (
            <>
              <span className="text-term-text font-semibold">{totalBanco}</span> em {tickersBanco} papel(is) (mínimo {banco.minimoObservacoes} por papel para o IV rank)
            </>
          ) : (
            <span className="text-term-gold">não configurado — o IV rank usa só este navegador</span>
          )}
        </span>
        <div className="flex-1" />
        {banco?.configurado && snapshots.length > 0 && !feito && (
          <button className="btn btn-primary flex items-center gap-1" disabled={migrando} onClick={migrar} title="Grava no banco os snapshots deste navegador. Dias que o sync já gravou não são alterados.">
            <Database size={12} /> {migrando ? "Levando…" : "Levar para o banco"}
          </button>
        )}
        <button className="btn flex items-center gap-1" onClick={exportar}>
          <FileJson size={12} /> Exportar
        </button>
        <button className="btn flex items-center gap-1" onClick={() => importRef.current?.click()}>
          <Upload size={12} /> Importar
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importar(f);
            e.target.value = "";
          }}
        />
      </div>
      {feito && (
        <p className="text-term-up flex items-center gap-1">
          <Check size={12} /> {feito}
        </p>
      )}
      {erro && <p className="text-term-down">{erro}</p>}
      <p className="leading-relaxed">
        O banco é a fonte do IV rank quando existe; o navegador é cache e só manda quando o banco não está configurado. A cadeia
        atualizada em qualquer aba também grava o snapshot do dia no banco (origem navegador); o <code>dados:sync</code> continua
        soberano onde os dois coincidem.
      </p>
    </div>
  );
}
