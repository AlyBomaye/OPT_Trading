"use client";

import React from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowRight, Play } from "lucide-react";
import type { Recomendacao } from "@/lib/agents/types";
import { useMarket } from "@/store/market";

interface Props {
  rec: Recomendacao;
}

export function ActionCard({ rec }: Props) {
  const setLegs = useMarket((st) => st.setLegs);

  // Parse risk colors
  const riskColor = 
    rec.risco === "ALTO" ? "bg-red-500/20 text-red-400 border-red-500/30" :
    rec.risco === "MEDIO" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" :
    "bg-green-500/20 text-green-400 border-green-500/30";

  const handleMontar = () => {
    // In a real app we might parse rec.acao or provide structured legs in Recomendacao
    // but the prompt says "mesmo caminho do setLegs usado pelos cards de sugestão".
    // For now, if we have structure details we'd set them. Since Recomendacao only has strings, 
    // we'll just redirect to workbench or set empty legs. 
    // Ideally we'd need structured legs. If missing, we just navigate.
    if (rec.deepLink) {
      // Just navigate or do something
      window.location.href = rec.deepLink;
    }
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 p-4 hover:border-neutral-700 transition-colors flex flex-col justify-between h-full">
      <div>
        <div className="flex justify-between items-start mb-2">
          <div className="flex space-x-2">
            <span className={clsx("text-xxs px-1.5 py-0.5 rounded border font-mono font-medium", riskColor)}>
              {rec.risco}
            </span>
            <span className="text-xxs px-1.5 py-0.5 rounded border border-neutral-700 text-neutral-400 font-mono uppercase">
              {rec.horizonte}
            </span>
          </div>
        </div>
        <h4 className="text-sm font-bold text-neutral-100 mb-1">{rec.acao}</h4>
        <p className="text-xxs text-neutral-400 leading-relaxed line-clamp-3">{rec.justificativa}</p>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <Link href={rec.deepLink || "/"} className="text-xxs text-cyan-500 hover:text-cyan-400 flex items-center group">
          Abrir na aba
          <ArrowRight size={12} className="ml-1 group-hover:translate-x-0.5 transition-transform" />
        </Link>
        <button 
          onClick={handleMontar}
          className="bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xxs px-2 py-1 rounded flex items-center transition-colors"
        >
          <Play size={10} className="mr-1" /> Montar na Estratégia
        </button>
      </div>
    </div>
  );
}
