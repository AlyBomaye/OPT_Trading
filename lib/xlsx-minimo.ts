/**
 * Escritor mínimo de .xlsx — sem dependência nova.
 *
 * Um .xlsx é um ZIP com meia dúzia de XMLs. O que está aqui é o suficiente para o Excel, o
 * LibreOffice e o Google Sheets abrirem: várias planilhas, célula numérica de verdade (não texto
 * com número dentro), texto inline, cabeçalho em negrito e largura de coluna. Nada de fórmulas,
 * estilos condicionais ou merges — não é o que a exportação da Carteira precisa.
 *
 * O ZIP usa entradas STORED (sem compressão): simplifica, e uma carteira inteira em XML cabe em
 * poucos MB. CRC-32 implementado aqui porque o container exige.
 */

export type Celula = string | number | boolean | null | undefined | Date;

export interface Planilha {
  nome: string;
  cabecalho: string[];
  linhas: Celula[][];
  /** Largura por coluna, em caracteres. Ausente = 14. */
  larguras?: number[];
}

/* ------------------------------ XML utils ------------------------------- */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function colLetra(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Nome de planilha válido no Excel: até 31 chars, sem []:*?/\ */
function nomePlanilha(n: string): string {
  return n.replace(/[\[\]:*?/\\]/g, "-").slice(0, 31) || "Planilha";
}

function celulaXml(ref: string, v: Celula, estilo?: number): string {
  const s = estilo != null ? ` s="${estilo}"` : "";
  if (v == null || v === "") return `<c r="${ref}"${s}/>`;
  if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  if (typeof v === "boolean") return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  if (v instanceof Date) return `<c r="${ref}"${s} t="inlineStr"><is><t>${esc(v.toISOString())}</t></is></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(p: Planilha): string {
  const cols = (p.larguras ?? p.cabecalho.map(() => 14))
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");
  const linhas: string[] = [];
  linhas.push(
    `<row r="1">${p.cabecalho.map((h, i) => celulaXml(`${colLetra(i)}1`, h, 1)).join("")}</row>`
  );
  p.linhas.forEach((l, ri) => {
    const r = ri + 2;
    linhas.push(`<row r="${r}">${l.map((v, ci) => celulaXml(`${colLetra(ci)}${r}`, v)).join("")}</row>`);
  });
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${linhas.join("")}</sheetData></worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
  `</styleSheet>`;

/* -------------------------------- ZIP ----------------------------------- */

let TABELA_CRC: Uint32Array | null = null;
function crc32(buf: Uint8Array): number {
  if (!TABELA_CRC) {
    TABELA_CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABELA_CRC[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = TABELA_CRC[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

/** ZIP com entradas STORED. Datas fixas (1980-01-01) — o conteúdo é o que importa. */
export function zipStored(arquivos: { nome: string; dados: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const partes: number[][] = [];
  const central: number[][] = [];
  let offset = 0;
  for (const a of arquivos) {
    const nome = enc.encode(a.nome);
    const crc = crc32(a.dados);
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0x0021), ...u16(0x0021),
      ...u32(crc), ...u32(a.dados.length), ...u32(a.dados.length), ...u16(nome.length), ...u16(0),
      ...Array.from(nome),
    ];
    partes.push(local, Array.from(a.dados));
    central.push([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0x0021), ...u16(0x0021),
      ...u32(crc), ...u32(a.dados.length), ...u32(a.dados.length), ...u16(nome.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...Array.from(nome),
    ]);
    offset += local.length + a.dados.length;
  }
  const centralFlat = central.flat();
  const fim = [
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(arquivos.length), ...u16(arquivos.length),
    ...u32(centralFlat.length), ...u32(offset), ...u16(0),
  ];
  return Uint8Array.from([...partes.flat(), ...centralFlat, ...fim]);
}

/* ------------------------------- workbook -------------------------------- */

export function gerarXlsx(planilhas: Planilha[]): Uint8Array {
  const enc = new TextEncoder();
  const nomes = planilhas.map((p) => nomePlanilha(p.nome));
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${nomes.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
  const wbRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    nomes.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${nomes.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    nomes.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const arquivos = [
    { nome: "[Content_Types].xml", dados: enc.encode(contentTypes) },
    { nome: "_rels/.rels", dados: enc.encode(rels) },
    { nome: "xl/workbook.xml", dados: enc.encode(workbook) },
    { nome: "xl/_rels/workbook.xml.rels", dados: enc.encode(wbRels) },
    { nome: "xl/styles.xml", dados: enc.encode(STYLES_XML) },
    ...planilhas.map((p, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, dados: enc.encode(sheetXml(p)) })),
  ];
  return zipStored(arquivos);
}

/* ---------------------------- leitura (teste) ---------------------------- */

/** Lê as entradas de um ZIP STORED gerado aqui — só para o teste conferir o que escreveu. */
export function lerZipStored(buf: Uint8Array): { nome: string; dados: Uint8Array }[] {
  const dec = new TextDecoder();
  const out: { nome: string; dados: Uint8Array }[] = [];
  let p = 0;
  const le32 = (i: number) => (buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)) >>> 0;
  const le16 = (i: number) => buf[i] | (buf[i + 1] << 8);
  while (p + 30 <= buf.length && le32(p) === 0x04034b50) {
    const crc = le32(p + 14);
    const tam = le32(p + 18);
    const nomeLen = le16(p + 26);
    const extraLen = le16(p + 28);
    const nome = dec.decode(buf.subarray(p + 30, p + 30 + nomeLen));
    const ini = p + 30 + nomeLen + extraLen;
    const dados = buf.subarray(ini, ini + tam);
    if (crc32(dados) !== crc) throw new Error(`CRC inválido em ${nome}`);
    out.push({ nome, dados });
    p = ini + tam;
  }
  return out;
}
