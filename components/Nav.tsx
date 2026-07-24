"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Gauge, Table2, GitBranch, Search, Briefcase, Newspaper, History } from "lucide-react";
import clsx from "clsx";

const ITEMS = [
  { href: "/", label: "Cockpit", key: "1", icon: Gauge },
  { href: "/chain", label: "Chain", key: "2", icon: Table2 },
  { href: "/estrategia", label: "Estratégia", key: "3", icon: GitBranch },
  { href: "/scanner", label: "Scanner", key: "4", icon: Search },
  { href: "/carteira", label: "Carteira", key: "5", icon: Briefcase },
  { href: "/noticias", label: "Notícias", key: "6", icon: Newspaper },
  { href: "/historico", label: "Histórico", key: "7", icon: History },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  // Atalhos: teclas 1–7 navegam entre módulos (fora de inputs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
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
        <div className="text-xxs text-term-dim">B3 · tempo quase-real</div>
      </div>
      <div className="flex-1 py-2">
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
      <div className="px-3 py-2 text-xxs text-term-dim border-t border-term-line">
        Atalhos: <kbd>1</kbd>–<kbd>7</kbd> módulos · <kbd>R</kbd> atualizar
      </div>
    </nav>
  );
}
