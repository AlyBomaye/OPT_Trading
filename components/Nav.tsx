"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Gauge, Table2, GitBranch, Search, Briefcase, Newspaper, History, LayoutGrid, BookOpen, Globe, Bot } from "lucide-react";
import clsx from "clsx";

import { useMarket } from "@/store/market";
import { sessionInfo } from "@/lib/session";
import { BotaoSync } from "@/components/BotaoSync";
import { SeletorAtivo } from "@/components/SeletorAtivo";
import { fmtDateBR } from "@/lib/format";

/**
 * WO-36: o Consultor abre a barra — é a tela que consolida as outras.
 * WO-46: o Cockpit vem logo depois, já contendo a Watchlist; Chain e Histórico foram absorvidos
 * pela Estratégia. Onze abas viraram oito.
 *
 * A tecla de atalho de cada aba NÃO acompanha a posição: o Consultor continua em `C` e as demais
 * mantêm o número que sempre tiveram. Renumerar por causa da ordem visual trocaria o significado
 * de teclas que já estão na memória muscular, e a ordem da barra é uma escolha de leitura, não um
 * contrato de atalho. Por isso 5, 8 e 9 (Watchlist, Chain, Histórico) simplesmente deixam de
 * existir em vez de serem reaproveitadas pelas abas seguintes.
 */
const ITEMS = [
  { href: "/consultor", label: "Consultor", key: "C", icon: Bot },
  { href: "/", label: "Cockpit", key: "4", icon: Gauge },
  { href: "/carteira", label: "Carteira", key: "1", icon: Briefcase },
  { href: "/noticias", label: "Notícias", key: "2", icon: Newspaper },
  { href: "/macro", label: "Macro", key: "3", icon: Globe },
  { href: "/scanner", label: "Scanner", key: "6", icon: Search },
  { href: "/estrategia", label: "Estratégia", key: "7", icon: GitBranch },
  { href: "/manual", label: "Manual", key: "0", icon: BookOpen },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const chain = useMarket((st) => st.chain);
  const [showHelp, setShowHelp] = useState(false);

  const sess = sessionInfo();
  let subText = "B3 · tempo quase-real";
  if (sess.state === "ABERTO" && chain?.dataEfetiva === sess.ultimaSessao) {
    subText = "B3 · ao vivo";
  } else if (sess.state === "PRE") {
    subText = `B3 · pré-abertura`;
  } else if (sess.state === "FIM_DE_SEMANA") {
    subText = chain?.dataEfetiva ? `B3 · fim de semana (${fmtDateBR(chain.dataEfetiva)})` : "B3 · fim de semana";
  } else {
    subText = chain?.dataEfetiva ? `B3 · fechado (${fmtDateBR(chain.dataEfetiva)})` : "B3 · fechado";
  }

  // Atalhos: teclas 1–9 e 0 navegam entre módulos, ? abre a ajuda (fora de inputs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "?") {
        setShowHelp((s) => !s);
        return;
      }
      if (e.key === "Escape") {
        setShowHelp(false);
        return;
      }
      const item = ITEMS.find((i) => i.key === e.key);
      if (item) router.push(item.href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <nav className="w-40 shrink-0 border-r border-term-line bg-term-panel flex flex-col">
      <div className="px-3 py-3 border-b border-term-line">
        <div className="font-mono font-bold text-term-cyan tracking-tight">OPÇÕES·TERMINAL</div>
        <div className="text-xxs text-term-dim truncate" title={subText}>{subText}</div>
      </div>
      {/* `py-2` sem `flex-1`: a lista ocupa só a própria altura, para o botão de sincronização
          ficar logo abaixo de Manual em vez de ser empurrado para o rodapé da barra. */}
      <div className="py-2">
        {ITEMS.map(({ href, label, key, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex items-center gap-2 px-3 py-1.5 text-xs border-l-2 transition-colors",
              pathname === href
                ? "border-term-cyan bg-term-cyan/10 text-term-cyan"
                : "border-transparent text-term-dim hover:text-term-text"
            )}
          >
            <Icon size={14} />
            <span className="flex-1">{label}</span>
            <kbd className="text-xxs bg-term-panel2 border border-term-line rounded px-1">{key}</kbd>
          </Link>
        ))}
      </div>
      {/* WO-38: atualização completa das fontes, alcançável de qualquer aba. */}
      <BotaoSync />

      {/* WO-39: ativo de referência da plataforma, logo abaixo do botão de atualização. */}
      <SeletorAtivo />

      {/* Espaçador: empurra o rodapé de atalhos para baixo, agora que a lista não se estica. */}
      <div className="flex-1" />

      <div className="px-3 py-2 text-xxs text-term-dim border-t border-term-line">
        Atalhos: <kbd>1</kbd>–<kbd>0</kbd> abas · <kbd>G</kbd> Gestor · <kbd>R</kbd> atualizar · <kbd>?</kbd> ajuda
      </div>

      {showHelp && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={() => setShowHelp(false)}
        >
          <div className="panel border border-term-line p-4 w-72" onClick={(e) => e.stopPropagation()}>
            <div className="font-mono font-bold text-term-cyan mb-2">Atalhos de teclado</div>
            <table className="w-full text-xs">
              <tbody>
                {ITEMS.map((i) => (
                  <tr key={i.href} className="border-t border-term-line/40">
                    <td className="py-1">
                      <kbd className="text-xxs bg-term-panel2 border border-term-line rounded px-1">{i.key}</kbd>
                    </td>
                    <td className="py-1">{i.label}</td>
                  </tr>
                ))}
                <tr className="border-t border-term-line/40">
                  <td className="py-1">
                    <kbd className="text-xxs bg-term-panel2 border border-term-line rounded px-1">G</kbd>
                  </td>
                  <td className="py-1">Abrir/fechar Gestor (Dock)</td>
                </tr>
                <tr className="border-t border-term-line/40">
                  <td className="py-1">
                    <kbd className="text-xxs bg-term-panel2 border border-term-line rounded px-1">R</kbd>
                  </td>
                  <td className="py-1">Atualizar chain</td>
                </tr>
                <tr className="border-t border-term-line/40">
                  <td className="py-1">
                    <kbd className="text-xxs bg-term-panel2 border border-term-line rounded px-1">?</kbd>
                  </td>
                  <td className="py-1">Abrir/fechar esta ajuda (Esc fecha)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </nav>
  );
}
