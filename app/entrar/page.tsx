"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

/**
 * WO-37 §C — Tela de entrada.
 *
 * A senha vai por POST para `/api/entrar`, que o middleware intercepta e troca por um cookie
 * httpOnly. A senha nunca é gravada em `localStorage` nem viaja na URL.
 */
export default function EntrarPage() {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/entrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha }),
      });
      if (res.ok) {
        // O destino pretendido vem na query, posto lá pelo middleware.
        const de = new URLSearchParams(window.location.search).get("de");
        window.location.href = de && de.startsWith("/") ? de : "/consultor";
        return;
      }
      const j = await res.json().catch(() => ({}));
      setErro(j?.error ?? "Não foi possível entrar.");
    } catch {
      setErro("Servidor indisponível. Verifique se a aplicação está no ar.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-term-bg p-4">
      <form onSubmit={entrar} className="panel border border-term-line bg-term-panel rounded p-6 w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2 text-term-cyan">
          <Lock size={16} />
          <h1 className="font-mono text-sm font-bold">OPÇÕES·TERMINAL</h1>
        </div>

        <p className="text-xxs text-term-dim leading-relaxed">
          Ferramenta pessoal de apoio à decisão em opções da B3. O acesso é restrito porque a
          plataforma consome uma conta paga de API.
        </p>

        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          placeholder="Senha"
          autoFocus
          autoComplete="current-password"
          className="w-full bg-term-panel2 border border-term-line rounded px-3 py-2 text-xs font-mono text-term-text outline-none focus:border-term-cyan"
        />

        {erro && (
          <div className="text-xxs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-2 py-1.5">
            {erro}
          </div>
        )}

        <button
          type="submit"
          disabled={enviando || senha.length === 0}
          className="btn btn-primary w-full text-xs py-2 disabled:opacity-50"
        >
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
