import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { TickerBar } from "@/components/TickerBar";

export const metadata: Metadata = {
  title: "Opções Terminal — B3",
  description: "Plataforma de trading de opções, risco de carteira e simulação de estratégias (B3).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="min-h-screen bg-term-bg text-term-text antialiased">
        <div className="flex min-h-screen">
          <Nav />
          <div className="flex-1 flex flex-col min-w-0">
            <TickerBar />
            <main className="flex-1 p-3 space-y-3 overflow-x-hidden">{children}</main>
            <footer className="px-4 py-2 text-xxs text-term-dim border-t border-term-line">
              Dados: opcoes.net.br (delay). IV e gregas calculadas localmente (Black-Scholes, 252 du).
              Ferramenta educacional — não é recomendação de investimento.
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
