"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Bot, X, Send, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useMarket } from "@/store/market";
import { usePersistedState } from "@/lib/use-persisted-state";
import { MarkdownLite } from "@/lib/markdown-lite";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_BY_ROUTE: Record<string, string[]> = {
  "/carteira": ["Qual posição está fora do meu perfil de risco?", "Preciso rebalancear os baldes?", "Como está meu theta carry?"],
  "/scanner": ["Esse pozinho cabe no meu ¼-Kelly?", "Qual setor está mais barato em vol?", "Tem convexidade boa pra comprar?"],
  // WO-46: a Estratégia absorveu Chain e Histórico, então as perguntas das três se juntam aqui.
  "/estrategia": ["Essa estrutura tem EV positivo?", "Qual o risco máximo dessa operação?", "Esse skew justifica um backspread?", "Em que quantil está a vol atual?"],
  // WO-46: o Cockpit absorveu a Watchlist.
  "/": ["Como está meu VaR hoje?", "Qual o regime GEX atual?", "Preciso de hedge?", "Tem skew extremo em algum ativo?"],
  "/noticias": ["Alguma notícia impacta minhas posições?", "Tem spike de atenção em algum ativo?", "O que o macro está dizendo?"],
  "/macro": ["A curva de juros está invertida?", "Qual driver macro domina hoje?", "O Brent afeta minha carteira?"],
  "/consultor": ["Por que a alocação está desviada?", "Qual o custo do gestor hoje?", "Resuma o relatório em 3 pontos."],
  "/manual": ["Como funciona o Kelly?", "O que são baldes de risco?", "Como leio o skew?"],
};

const ROUTE_LABELS: Record<string, string> = {
  "/": "Cockpit",
  "/carteira": "Carteira",
  "/noticias": "Notícias",
  "/macro": "Macro",
  "/scanner": "Scanner",
  "/estrategia": "Estratégia",
  "/consultor": "Consultor",
  "/manual": "Manual",
};

function getAgentIdForRoute(path: string): string | null {
  const map: Record<string, string> = {
    "/": "cockpit",
    "/carteira": "carteira",
    "/noticias": "noticias",
    "/macro": "macro",
    "/scanner": "scanner",
    "/estrategia": "estrategia",
    "/consultor": "gestor-global",
  };
  return map[path] ?? null;
}

const LS_KEY = "gestor-dock-history";

export function GestorDock() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // Ver lib/use-persisted-state.ts: ler o storage no inicializador quebra a hidratação.
  const [messages, setMessages] = usePersistedState<ChatMessage[]>(LS_KEY, []);

  const pathname = usePathname();
  const ticker = useMarket((st) => st.ticker);
  const positions = useMarket((st) => st.positions);
  const capitalTotal = useMarket((st) => st.capitalTotal);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A persistência é do usePersistedState; aqui só limitamos o histórico guardado.
  useEffect(() => {
    if (messages.length > 20) setMessages((prev) => prev.slice(-20));
  }, [messages, setMessages]);

  // Scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  // Listen for G key (D.3 atalho)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "G" || e.key === "g") {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          setOpen((prev) => !prev);
        }
      }
    };
    // Also listen for custom event from Nav
    const customHandler = () => setOpen((prev) => !prev);
    window.addEventListener("keydown", handler);
    window.addEventListener("toggle-gestor-dock", customHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("toggle-gestor-dock", customHandler);
    };
  }, []);

  const routeLabel = ROUTE_LABELS[pathname] ?? pathname;
  const suggestions = SUGGESTED_BY_ROUTE[pathname] ?? SUGGESTED_BY_ROUTE["/"];
  const agentId = getAgentIdForRoute(pathname);

  const handleSend = async (msg?: string) => {
    const text = msg ?? input.trim();
    if (!text || loading) return;

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          currentPath: pathname,
          currentAgentReport: agentId,
          carteiraCtx: { positions, capitalTotal },
          history: newMessages.slice(-10),
        }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply ?? data.error ?? "Erro desconhecido." }]);
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Erro de conexão: ${err?.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = () => {
    setMessages([]);
    localStorage.removeItem(LS_KEY);
  };

  return (
    <>
      {/* Botão flutuante */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2.5 rounded-full shadow-lg shadow-cyan-900/30 transition-all hover:scale-105 print:hidden"
          title="Abrir Gestor (G)"
        >
          <Bot size={18} />
          <span className="text-sm font-mono font-medium">Gestor</span>
        </button>
      )}

      {/* Drawer lateral */}
      {open && (
        <div className="fixed top-0 right-0 z-50 h-full w-[380px] max-w-full bg-neutral-950 border-l border-neutral-800 flex flex-col shadow-2xl print:hidden">
          {/* Header */}
          <div className="border-b border-neutral-800 p-3 flex items-center justify-between shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <Bot size={16} className="text-cyan-400" />
                <span className="font-mono text-sm font-bold text-cyan-400">Gestor</span>
                <kbd className="text-[9px] bg-neutral-800 border border-neutral-700 rounded px-1 text-neutral-500">G</kbd>
              </div>
              <div className="text-[10px] text-neutral-500 mt-0.5">
                Você está em: <span className="text-neutral-300">{routeLabel}</span>
                {ticker && <span className="text-cyan-400 ml-1">— {ticker}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={clearHistory} className="p-1.5 rounded hover:bg-neutral-800 text-neutral-500" title="Limpar histórico">
                <Trash2 size={14} />
              </button>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded hover:bg-neutral-800 text-neutral-500" title="Fechar (G)">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Suggestions */}
          {messages.length === 0 && (
            <div className="p-3 border-b border-neutral-800/50 space-y-1.5 shrink-0">
              <div className="text-[10px] font-mono text-neutral-600 uppercase">Perguntas sugeridas</div>
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(s)}
                  className="block w-full text-left text-xs bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded px-3 py-2 text-neutral-300 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={clsx("text-xs", msg.role === "user" ? "text-right" : "")}>
                {msg.role === "user" ? (
                  <div className="inline-block bg-cyan-900/40 text-cyan-100 rounded-lg px-3 py-2 max-w-[85%] text-left">
                    {msg.content}
                  </div>
                ) : (
                  <div className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2">
                    <MarkdownLite text={msg.content} />
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="text-xs text-neutral-500 animate-pulse font-mono">Pensando...</div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-neutral-800 p-3 shrink-0">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Pergunte ao Gestor..."
                className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-cyan-700"
                disabled={loading}
              />
              <button
                onClick={() => handleSend()}
                disabled={loading || !input.trim()}
                className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white rounded px-3 py-2 transition-colors"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
