import { bytesToSymbols, symbolsToBytes } from './bitpack';
import { whiten } from './encode';
import { deinterleave, interleaveBlocks } from './interleave';
import { rsDecode, rsEncode } from './rs';
import { crc32 } from '../crypto/crc32';
import type { GlyphPlan } from './profiles';

export interface RecoveryBudget { attempts: number }

/** Corrected blocks can be shared across sampling passes with the same protected header. */
export class BlockRecovery {
  private readonly decoded: (Uint8Array | null)[];
  private labels: readonly number[] | null = null;

  constructor(
    readonly plan: GlyphPlan,
    private readonly payloadLen: number,
    private readonly crc: number,
  ) {
    this.decoded = Array.from({ length: plan.blocks }, () => null);
  }

  knownSymbols(): readonly number[] {
    if (this.labels) return this.labels;
    const { plan } = this;
    const blocks = this.decoded.map((block) => block ? rsEncode(block, plan.parityBytes) : new Uint8Array(plan.codewordBytes));
    const symbols = bytesToSymbols(whiten(interleaveBlocks(blocks)), plan.profile.bits);
    for (let k = 0; k < symbols.length; k++) {
      for (let b = Math.floor(k * plan.profile.bits / 8); b <= Math.floor(((k + 1) * plan.profile.bits - 1) / 8); b++) {
        if (b < plan.streamBytes && !this.decoded[b % plan.blocks]) symbols[k] = -1;
      }
    }
    this.labels = symbols;
    return symbols;
  }

  read(symbols: number[], confidence: number[], budget?: RecoveryBudget): Uint8Array | null {
    const { plan } = this;
    const stream = whiten(symbolsToBytes(symbols, plan.profile.bits, plan.streamBytes));
    const blocks = deinterleave(stream, plan.blocks, plan.codewordBytes);
    const byteConfidence = new Float32Array(plan.streamBytes).fill(1);
    for (let k = 0; k < confidence.length; k++) {
      const first = Math.floor(k * plan.profile.bits / 8);
      const last = Math.floor(((k + 1) * plan.profile.bits - 1) / 8);
      for (let b = first; b <= last && b < byteConfidence.length; b++) {
        byteConfidence[b] = Math.min(byteConfidence[b]!, confidence[k]!);
      }
    }

    for (let block = 0; block < plan.blocks; block++) {
      if (this.decoded[block]) continue;
      const positions = Array.from({ length: plan.codewordBytes }, (_, i) => i);
      const reliability = (i: number): number => byteConfidence[i * plan.blocks + block]!;
      positions.sort((a, b) => reliability(a) - reliability(b) || a - b);
      const counts = new Set<number>();
      for (const threshold of [0.2, 0, 0.1, 0.3]) {
        counts.add(positions.filter((i) => reliability(i) < threshold).length);
      }
      // A single block has an immediate payload CRC; cached partial blocks retain sixteen equations.
      const maxErasures = plan.blocks === 1 ? plan.parityBytes : Math.max(0, plan.parityBytes - 16);
      if (budget) for (let count = 4; count <= maxErasures; count += 4) counts.add(count);
      for (const count of counts) {
        if (count > maxErasures) continue;
        if (budget) {
          if (budget.attempts <= 0) return null;
          budget.attempts--;
        }
        const data = rsDecode(blocks[block]!, plan.parityBytes, positions.slice(0, count));
        if (data) {
          this.decoded[block] = data;
          this.labels = null;
          break;
        }
      }
    }
    if (this.decoded.some((block) => block === null)) return null;
    const full = new Uint8Array(plan.blocks * plan.dataBytes);
    this.decoded.forEach((block, index) => full.set(block!, index * plan.dataBytes));
    const payload = full.slice(0, this.payloadLen);
    if ((crc32(payload) >>> 0) === (this.crc >>> 0)) return payload;
    this.decoded.fill(null);
    this.labels = null;
    return null;
  }
}
