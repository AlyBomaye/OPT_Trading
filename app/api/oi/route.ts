import { NextRequest, NextResponse } from "next/server";

/**
 * Route /api/oi?ticker=PETR4
 * Baixa e analisa o arquivo oficial de Posição em Aberto de Derivativos da B3
 * (DerivativesOpenPositionFile), aplicando cache em memória de 6h.
 */

const REQ_TIMEOUT_MS = 10_000;
const DL_TIMEOUT_MS = 60_000;
const CACHE_TTL_MS = 6 * 3600 * 1000; // 6 horas

interface SeriesEntry {
  type: "CALL" | "PUT";
  totalPos: number;
  covered: number;
  uncovered: number;
}

type AssetSeriesMap = Map<string, Record<string, SeriesEntry>>;

// Cache em memória do arquivo parseado por data (YYYY-MM-DD)
const cacheByDate = new Map<string, { at: number; byAsset: AssetSeriesMap }>();

function parseB3Num(val: string | undefined): number {
  if (!val) return 0;
  const s = val.trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatDateIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Retorna a data do último dia útil (segunda a sexta). */
function getExpectedLastBizDate(): string {
  const d = new Date();
  // Se for antes das 20:00, considera o dia anterior como base
  if (d.getHours() < 20) {
    d.setDate(d.getDate() - 1);
  }
  // Se for sábado (6) ou domingo (0), recua para sexta-feira
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return formatDateIso(d);
}

async function fetchAndParseB3File(dateStr: string): Promise<AssetSeriesMap | null> {
  const cached = cacheByDate.get(dateStr);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.byAsset;
  }

  try {
    const reqUrl = `https://arquivos.b3.com.br/api/download/requestname?fileName=DerivativesOpenPositionFile&date=${dateStr}`;
    const reqRes = await fetch(reqUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
    });

    if (!reqRes.ok) return null;
    const reqJson = (await reqRes.json()) as { redirectUrl?: string };
    if (!reqJson.redirectUrl) return null;

    const tokenMatch = reqJson.redirectUrl.match(/token=([^&]+)/);
    if (!tokenMatch) return null;
    const token = tokenMatch[1];

    const dlUrl = `https://arquivos.b3.com.br/api/download?token=${token}`;
    const dlRes = await fetch(dlUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      cache: "no-store",
      signal: AbortSignal.timeout(DL_TIMEOUT_MS),
    });

    if (!dlRes.ok) return null;
    const csvBuffer = Buffer.from(await dlRes.arrayBuffer());
    const csvText = csvBuffer.toString("latin1");

    const lines = csvText.split(/\r?\n/);
    if (lines.length < 2) return null;

    const header = lines[0].split(";").map((h) => h.trim());
    const idxSymbol = header.indexOf("TckrSymb");
    const idxAsset = header.indexOf("Asst");
    const idxSgmt = header.indexOf("SgmtNm");
    const idxCovered = header.indexOf("CvrdQty");
    const idxUncovered = header.indexOf("UcvrdQty");
    const idxTotal = header.indexOf("TtlPos");

    if (idxSymbol < 0 || idxAsset < 0 || idxSgmt < 0 || idxTotal < 0) {
      return null;
    }

    const byAsset: AssetSeriesMap = new Map();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cols = line.split(";");
      const sgmt = cols[idxSgmt]?.trim();
      if (sgmt !== "EQUITY CALL" && sgmt !== "EQUITY PUT") continue;

      const asst = cols[idxAsset]?.trim().toUpperCase();
      const symb = cols[idxSymbol]?.trim();
      if (!asst || !symb) continue;

      const type: "CALL" | "PUT" = sgmt === "EQUITY CALL" ? "CALL" : "PUT";
      const totalPos = parseB3Num(cols[idxTotal]);
      const covered = parseB3Num(cols[idxCovered]);
      const uncovered = parseB3Num(cols[idxUncovered]);

      let assetRecord = byAsset.get(asst);
      if (!assetRecord) {
        assetRecord = {};
        byAsset.set(asst, assetRecord);
      }

      assetRecord[symb] = { type, totalPos, covered, uncovered };
    }

    cacheByDate.set(dateStr, { at: Date.now(), byAsset });
    return byAsset;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawTicker = searchParams.get("ticker")?.toUpperCase() ?? "PETR4";
  const asset = rawTicker.replace(/\d+$/, ""); // PETR4 -> PETR, BOVA11 -> BOVA

  const today = new Date();
  let foundDate: string | null = null;
  let seriesMap: AssetSeriesMap | null = null;

  // Sweeps up to 5 days backwards to find the latest available B3 file
  for (let i = 0; i < 5; i++) {
    const candidate = new Date(today);
    candidate.setDate(today.getDate() - i);
    const dateStr = formatDateIso(candidate);
    const result = await fetchAndParseB3File(dateStr);

    if (result && result.size > 0) {
      foundDate = dateStr;
      seriesMap = result;
      break;
    }
  }

  if (!seriesMap || !foundDate) {
    return NextResponse.json(
      { error: "Não foi possível carregar o arquivo de Posições em Aberto da B3 dos últimos 5 dias." },
      { status: 502 }
    );
  }

  const series = seriesMap.get(asset) ?? {};
  const expectedLastBiz = getExpectedLastBizDate();
  const stale = foundDate < expectedLastBiz;

  return NextResponse.json(
    {
      ticker: rawTicker,
      asset,
      fileDate: foundDate,
      series,
      updatedAt: new Date().toISOString(),
      stale,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    }
  );
}
