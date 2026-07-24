export const fmtBRL = (v: number | null | undefined, digits = 2): string =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtNum = (v: number | null | undefined, digits = 2): string =>
  v == null || !Number.isFinite(v)
    ? "—"
    : v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtPct = (v: number | null | undefined, digits = 1): string =>
  v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

export const fmtCompact = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
};

export const fmtDateBR = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export const pnlColor = (v: number): string => (v > 0 ? "text-term-up" : v < 0 ? "text-term-down" : "text-term-dim");

export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Exporta o primeiro SVG dentro do container como PNG. */
export function downloadSvgAsPng(container: HTMLElement, filename: string): void {
  const svg = container.querySelector("svg");
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const data = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  const url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(data)));
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0b0e14";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = filename;
    a.click();
  };
  img.src = url;
}
