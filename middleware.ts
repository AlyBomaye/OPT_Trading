import { NextRequest, NextResponse } from "next/server";

/**
 * WO-37 §C — Porta de entrada da plataforma.
 *
 * O que isto impede: quatro rotas chegam ao modelo da Anthropic e gastam créditos reais
 * (`/api/agents/chat`, `draft-report`, `run-cycle`, `run`). Sem porta, qualquer pessoa que
 * alcance a URL pode esvaziar a conta — e já se viu na prática que os créditos acabam.
 *
 * Como funciona: uma senha única em `APP_PASSWORD`, trocada por um cookie assinado. Sem
 * dependência nova — o `Web Crypto` do runtime do middleware basta.
 *
 * Em desenvolvimento, `APP_PASSWORD` ausente libera tudo. Isso é deliberado: exigir senha na
 * máquina local só criaria atrito. Em produção, ausência da variável FECHA a plataforma, porque o
 * modo inseguro nunca pode ser o padrão de quem esqueceu de configurar.
 */

export const config = {
  // Exclui os estáticos do Next e o favicon: proteger bundle não protege nada e quebra o carregamento.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

const COOKIE = "opt_sessao";
const DURACAO_S = 60 * 60 * 24 * 7; // 7 dias

/** Rotas que gastam dinheiro. Listadas à parte para o teto por IP. */
const ROTAS_DE_CUSTO = [
  "/api/agents/chat",
  "/api/agents/draft-report",
  "/api/agents/run-cycle",
  "/api/agents/run",
];

/**
 * Teto por IP, em memória do processo.
 *
 * Não substitui a senha — é a segunda camada, para o caso de a senha vazar ou de um script
 * autenticado entrar em laço. O gateway já limita CUSTO por dia e por ciclo; isto limita
 * FREQUÊNCIA, que é o que um laço acidental consome antes de o custo aparecer.
 */
const JANELA_MS = 60_000;
const MAX_POR_JANELA = 12;
const contador = new Map<string, { n: number; desde: number }>();

function excedeuTeto(ip: string): { excedeu: boolean; faltaS: number } {
  const agora = Date.now();
  const atual = contador.get(ip);
  if (!atual || agora - atual.desde > JANELA_MS) {
    contador.set(ip, { n: 1, desde: agora });
    // Limpeza preguiçosa: sem isto o Map cresce para sempre num processo de longa duração.
    if (contador.size > 5000) {
      const vencidos: string[] = [];
      contador.forEach((v, k) => {
        if (agora - v.desde > JANELA_MS) vencidos.push(k);
      });
      for (const k of vencidos) contador.delete(k);
    }
    return { excedeu: false, faltaS: 0 };
  }
  atual.n++;
  const faltaS = Math.ceil((JANELA_MS - (agora - atual.desde)) / 1000);
  return { excedeu: atual.n > MAX_POR_JANELA, faltaS };
}

/**
 * Token do cookie: HMAC da senha com um rótulo fixo. Não guarda a senha e não é reversível.
 * Comparação em tempo constante, para o cookie não virar oráculo de adivinhação byte a byte.
 */
async function tokenEsperado(senha: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(senha),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const assinatura = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode("opcoes-terminal/sessao"));
  return Array.from(new Uint8Array(assinatura))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function igualdadeConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function middleware(req: NextRequest) {
  const senha = process.env.APP_PASSWORD;
  const ehProducao = process.env.NODE_ENV === "production";
  const caminho = req.nextUrl.pathname;

  // WO-57: /api/saude é o único caminho sem senha — "estou vivo", sem dado e sem custo. É o que o
  // script de produção e o vigia consultam para saber se a plataforma está de pé.
  if (caminho === "/api/saude") return NextResponse.next();

  // Sem senha configurada: liberado em desenvolvimento, fechado em produção.
  if (!senha) {
    if (!ehProducao) return NextResponse.next();
    return NextResponse.json(
      {
        error:
          "APP_PASSWORD não está definida no ambiente. A plataforma não sobe sem senha em produção — " +
          "defina a variável e reinicie. Ver DEPLOY.md.",
      },
      { status: 503 }
    );
  }

  const esperado = await tokenEsperado(senha);

  // Endpoint de login: recebe a senha, devolve o cookie. Fica antes da checagem de sessão.
  if (caminho === "/api/entrar" && req.method === "POST") {
    const corpo = await req.json().catch(() => ({}));
    if (typeof corpo?.senha === "string" && igualdadeConstante(corpo.senha, senha)) {
      const res = NextResponse.json({ ok: true });
      res.cookies.set(COOKIE, esperado, {
        httpOnly: true,
        sameSite: "lax",
        secure: ehProducao,
        path: "/",
        maxAge: DURACAO_S,
      });
      return res;
    }
    // Mensagem única para senha errada e ausente: não confirmar qual dos dois foi.
    return NextResponse.json({ error: "Senha incorreta." }, { status: 401 });
  }

  const cookie = req.cookies.get(COOKIE)?.value ?? "";
  const autenticado = igualdadeConstante(cookie, esperado);

  if (!autenticado) {
    if (caminho.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Não autenticado. Faça login na tela inicial para usar a plataforma." },
        { status: 401 }
      );
    }
    // Páginas caem na tela de entrada, preservando o destino pretendido.
    if (caminho !== "/entrar") {
      const url = req.nextUrl.clone();
      url.pathname = "/entrar";
      url.searchParams.set("de", caminho);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Autenticado: só as rotas de custo passam pelo teto de frequência.
  if (ROTAS_DE_CUSTO.some((r) => caminho.startsWith(r))) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
    const { excedeu, faltaS } = excedeuTeto(ip);
    if (excedeu) {
      // Causa explícita, não 500 mudo — mesma disciplina do gateway e do CoverageGrid.
      return NextResponse.json(
        {
          error: `Limite de ${MAX_POR_JANELA} chamadas por minuto atingido nas rotas que consomem a API. Aguarde ${faltaS}s.`,
        },
        { status: 429 }
      );
    }
  }

  return NextResponse.next();
}
