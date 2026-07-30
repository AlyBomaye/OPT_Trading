"use client";

import React from "react";
import Link from "next/link";
import { Sparkline } from "../Sparkline";
import clsx from "clsx";

interface Props {
  label: string;
  value: string;
  delta?: { value: string; positive: boolean };
  sparklineData?: number[];
  href?: string;
  tooltip?: string;
}

export function KpiTile({ label, value, delta, sparklineData, href, tooltip }: Props) {
  const content = (
    <div className="bg-neutral-900 border border-neutral-800 p-3 flex flex-col justify-between hover:border-neutral-700 transition-colors h-24" title={tooltip}>
      <div className="flex justify-between items-start">
        <span className="text-xxs text-neutral-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 flex items-end justify-between">
        <div>
          <div className="font-mono text-xl text-neutral-100">{value}</div>
          {delta && (
            <div className={clsx("text-xs mt-1", delta.positive ? "text-green-400" : "text-red-400")}>
              {delta.positive ? "+" : ""}{delta.value}
            </div>
          )}
        </div>
        {sparklineData && sparklineData.length > 0 && (
          <div className="ml-2 w-16 opacity-70">
            <Sparkline data={sparklineData} width={64} height={24} color={delta?.positive === false ? "#f87171" : "#4ade80"} />
          </div>
        )}
      </div>
    </div>
  );

  if (href) {
    return <Link href={href} className="block">{content}</Link>;
  }

  return content;
}
