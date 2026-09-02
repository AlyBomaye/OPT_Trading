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
import { usePersistedState } from "@/lib/use-persisted-state";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

/**
 * WO-36: o Consultor abre a barra — é a tela que consolida as outras.
 * WO-46: o Cockpit vem logo depois, já contendo a Watchlist; Chain e Histórico foram absorvidos
 * pela Estratégia. Onze abas viraram oito.
 * 02/09/2026: as teclas passam a SEGUIR A POSIÇÃO — 1 a 8, de cima para baixo. O WO-36 as
 * mantinha fixas por memória muscular quando a barra ainda mudava; com oito abas estáveis, a
 * posição é o mapa mental, e a tecla igual à posição é o que se decora sem esforço.
 */
const ITEMS = [
  { href: "/consultor", label: "Consultor", key: "1", icon: Bot },
  { href: "/", label: "Cockpit", key: "2", icon: Gauge },
  { href: "/carteira", label: "Carteira", key: "3", icon: Briefcase },
  { href: "/noticias", label: "Notícias", key: "4", icon: Newspaper },
  { href: "/macro", label: "Macro", key: "5", icon: Globe },
  { href: "/scanner", label: "Scanner", key: "6", icon: Search },
  { href: "/estrategia", label: "Estratégia", key: "7", icon: GitBranch },
  { href: "/manual", label: "Manual", key: "8", icon: BookOpen },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const chain = useMarket((st) => st.chain);
  const [showHelp, setShowHelp] = useState(false);
  // Barra retratil: recolhida mostra so os icones. Chave por secao, nunca por numero.
  const [recolhida, setRecolhida] = usePersistedState<boolean>("nav-recolhida", false);

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

  // Atalhos: teclas 1–8 navegam entre as abas na ordem da barra, ? abre a ajuda (fora de inputs)
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
      if (e.key === "[") {
        setRecolhida(!recolhida);
        return;
      }
      // WO-48: B abre a Carteira com a boleta focada, de qualquer aba.
      if (e.key === "b" || e.key === "B") {
        router.push("/carteira#boleta");
        return;
      }
      const item = ITEMS.find((i) => i.key === e.key);
      if (item) router.push(item.href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, recolhida, setRecolhida]);

  return (
    <nav
      className={clsx(
        "shrink-0 border-r border-term-line bg-term-panel flex flex-col transition-[width] duration-150",
        recolhida ? "w-12" : "w-40"
      )}
    >
      <div className={clsx("py-3 border-b border-term-line flex items-start gap-1", recolhida ? "px-1 justify-center" : "px-3")}>
        {!recolhida && (
          <div className="min-w-0 flex-1">
            <div className="font-mono font-bold text-term-cyan tracking-tight">OPÇÕES·TERMINAL</div>
            <div className="text-xxs text-term-dim truncate" title={subText}>{subText}</div>
          </div>
        )}
        <button
          onClick={() => setRecolhida(!recolhida)}
          title={recolhida ? `Expandir a barra ([) — ${subText}` : "Recolher a barra ([)"}
          aria-label={recolhida ? "Expandir a barra lateral" : "Recolher a barra lateral"}
          className="text-term-dim hover:text-term-cyan shrink-0 mt-0.5"
        >
          {recolhida ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>
      {/* `py-2` sem `flex-1`: a lista ocupa só a própria altura, para o botão de sincronização
          ficar logo abaixo de Manual em vez de ser empurrado para o rodapé da barra. */}
      <div className="py-2">
        {ITEMS.map(({ href, label, key, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            title={recolhida ? `${label} (${key})` : undefined}
            className={clsx(
              "flex items-center gap-2 py-1.5 text-xs border-l-2 transition-colors",
              recolhida ? "px-0 justify-center" : "px-3",
              pathname === href
                ? "border-term-cyan bg-term-cyan/10 text-term-cyan"
                : "border-transparent text-term-dim hover:text-term-text"
            )}
          >
            <Icon size={14} />
            {!recolhida && <span className="flex-1">{label}</span>}
            {!recolhida && <kbd className="text-xxs bg-term-panel2 border border-term-line rounded px-1">{key}</kbd>}
          </Link>
        ))}
      </div>
      {/* WO-38: atualização completa das fontes, alcançável de qualquer aba. */}
      {!recolhida && <BotaoSync />}

      {/* WO-39: ativo de referência da plataforma, logo abaixo do botão de atualização. */}
      {!recolhida && <SeletorAtivo />}

      {/* Espaçador: empurra o rodapé de atalhos para baixo, agora que a lista não se estica. */}
      <div className="flex-1" />

      {!recolhida && (
        <div className="px-3 py-2 text-xxs text-term-dim border-t border-term-line">
          Atalhos: <kbd>1</kbd>–<kbd>8</kbd> abas · <kbd>B</kbd> boleta · <kbd>G</kbd> Gestor · <kbd>R</kbd> atualizar · <kbd>[</kbd> barra · <kbd>?</kbd> ajuda
        </div>
      )}

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
