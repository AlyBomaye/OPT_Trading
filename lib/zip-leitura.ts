/**
 * WO-56 — leitura de ZIP com entradas STORED ou DEFLATE, sem dependência.
 *
 * O `lerZipStored` de lib/xlsx-minimo.ts só lê o que nós mesmos escrevemos (STORED). Os arquivos
 * da B3 vêm comprimidos (método 8); o Node traz `zlib.inflateRawSync`, que é tudo o que falta.
 * Percorre o diretório central (fim do arquivo) para não depender de data descriptors.
 */

import { inflateRawSync } from "node:zlib";

export interface EntradaZip {
  nome: string;
  metodo: number;
  tamanho: number;
  conteudo: Buffer;
}

export function lerZip(buf: Buffer): EntradaZip[] {
  // End of central directory: assinatura 0x06054b50, procurada de trás para frente (comentário ≤ 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP sem diretório central.");
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: EntradaZip[] = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Entrada do diretório central inválida.");
    const metodo = buf.readUInt16LE(p + 10);
    const compTam = buf.readUInt32LE(p + 20);
    const tamanho = buf.readUInt32LE(p + 24);
    const nomeTam = buf.readUInt16LE(p + 28);
    const extraTam = buf.readUInt16LE(p + 30);
    const comentTam = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + nomeTam).toString("latin1");
    // Cabeçalho local: 30 bytes fixos + nome + extra (os do local podem diferir dos do central).
    if (buf.readUInt32LE(offset) !== 0x04034b50) throw new Error(`Cabeçalho local inválido em ${nome}.`);
    const lNome = buf.readUInt16LE(offset + 26);
    const lExtra = buf.readUInt16LE(offset + 28);
    const inicio = offset + 30 + lNome + lExtra;
    const dados = buf.subarray(inicio, inicio + compTam);
    let conteudo: Buffer;
    if (metodo === 0) conteudo = Buffer.from(dados);
    else if (metodo === 8) conteudo = inflateRawSync(dados);
    else throw new Error(`Método de compressão ${metodo} não suportado em ${nome}.`);
    out.push({ nome, metodo, tamanho, conteudo });
    p += 46 + nomeTam + extraTam + comentTam;
  }
  return out;
}
