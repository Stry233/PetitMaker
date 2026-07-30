// src/io/share/glyph/interleave.ts — column-major interleave of equal-length RS
// codewords, so a local burst of damage in the rendered code spreads thinly across many
// blocks (each block then has few errors, within its RS budget) instead of destroying one.
export function interleaveBlocks(blocks: Uint8Array[]): Uint8Array {
  if (blocks.length === 0) return new Uint8Array(0);
  const len = blocks[0]!.length;
  for (const b of blocks) if (b.length !== len) throw new Error('interleave: blocks must be equal length');
  const out = new Uint8Array(blocks.length * len);
  let o = 0;
  for (let col = 0; col < len; col++) for (let i = 0; i < blocks.length; i++) out[o++] = blocks[i]![col]!;
  return out;
}

export function deinterleave(stream: Uint8Array, nBlocks: number, blockLen: number): Uint8Array[] {
  if (stream.length !== nBlocks * blockLen) throw new Error('deinterleave: length mismatch');
  const blocks: Uint8Array[] = Array.from({ length: nBlocks }, () => new Uint8Array(blockLen));
  let p = 0;
  for (let col = 0; col < blockLen; col++) for (let i = 0; i < nBlocks; i++) blocks[i]![col] = stream[p++]!;
  return blocks;
}

/** Map a flat set of damaged STREAM indices back to per-block indices (for RS erasures). */
export function deinterleaveErasures(streamErasures: number[], nBlocks: number, blockLen: number): number[][] {
  const per: number[][] = Array.from({ length: nBlocks }, () => []);
  for (const idx of streamErasures) {
    if (idx < 0 || idx >= nBlocks * blockLen) continue;
    const col = Math.floor(idx / nBlocks);
    const block = idx % nBlocks;
    per[block]!.push(col);
  }
  return per;
}
