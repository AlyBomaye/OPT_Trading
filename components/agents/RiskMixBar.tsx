"use client";

import React from "react";
import clsx from "clsx";

interface Props {
  alto: number;
  medio: number;
  baixo: number;
  utilizacaoPct: number;
  desvio?: { alto: number; medio: number; baixo: number };
}

export function RiskMixBar({ alto, medio, baixo, utilizacaoPct, desvio }: Props) {
  if (alto === 0 && medio === 0 && baixo === 0) {
    return (
      <div className="bg-neutral-900 border border-neutral-800 p-4 w-full h-full flex flex-col justify-center items-center text-neutral-500">
        <span className="text-sm">Sem capital alocado</span>
        <span className="text-xs mt-1">Composição de risco indefinida</span>
      </div>
    );
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 p-4 w-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h4 className="text-sm text-neutral-200">Composição do Risco Alocado</h4>
        <span className="text-xs text-neutral-400">Utilização do Bankroll: <span className="font-mono text-neutral-200">{utilizacaoPct}%</span></span>
      </div>
      
      {/* Target Lines (20/50/30) relative to 100% of ALOCADO */}
      <div className="relative h-6 w-full flex rounded overflow-hidden opacity-90">
        <div style={{ width: `${alto}%` }} className="bg-red-500 transition-all duration-500 h-full"></div>
        <div style={{ width: `${medio}%` }} className="bg-yellow-500 transition-all duration-500 h-full"></div>
        <div style={{ width: `${baixo}%` }} className="bg-green-500 transition-all duration-500 h-full"></div>
        
        {/* Markers for 20% and 70% (20+50) */}
        <div className="absolute top-0 bottom-0 border-l border-white/50 z-10" style={{ left: "20%" }}></div>
        <div className="absolute top-0 bottom-0 border-l border-white/50 z-10" style={{ left: "70%" }}></div>
      </div>
      
      <div className="flex mt-2 text-xs font-mono justify-between text-neutral-400">
        <div className="flex flex-col items-start w-1/3">
          <span className="text-red-400">ALTO 20%</span>
          <span>{alto.toFixed(1)}% {desvio && <span className={clsx(desvio.alto > 0 ? "text-red-400" : "text-neutral-500")}>({desvio.alto > 0 ? "+" : ""}{desvio.alto}pp)</span>}</span>
        </div>
        <div className="flex flex-col items-center w-1/3">
          <span className="text-yellow-400">MÉDIO 50%</span>
          <span>{medio.toFixed(1)}% {desvio && <span className={clsx(desvio.medio > 0 ? "text-yellow-400" : "text-neutral-500")}>({desvio.medio > 0 ? "+" : ""}{desvio.medio}pp)</span>}</span>
        </div>
        <div className="flex flex-col items-end w-1/3">
          <span className="text-green-400">BAIXO 30%</span>
          <span>{baixo.toFixed(1)}% {desvio && <span className={clsx(desvio.baixo > 0 ? "text-green-400" : "text-neutral-500")}>({desvio.baixo > 0 ? "+" : ""}{desvio.baixo}pp)</span>}</span>
        </div>
      </div>
    </div>
  );
}
