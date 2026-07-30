import type { MacroCoord } from './types';
import { CHUNK_SIZE, CHUNK_LOAD_LIMIT } from './constants';
import { chunkKey } from './grid-model';

export class ChunkTracker {
  private loads = new Map<string, number>();

  getLoad(cx: number, cy: number): number {
    return this.loads.get(chunkKey(cx, cy)) ?? 0;
  }

  getChunkLoads(): Map<string, number> {
    return new Map(this.loads);
  }

  private affectedChunks(pos: MacroCoord, w: number, h: number): Set<string> {
    const chunks = new Set<string>();
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const cx = Math.floor((pos.x + dx) / CHUNK_SIZE);
        const cy = Math.floor((pos.y + dy) / CHUNK_SIZE);
        chunks.add(chunkKey(cx, cy));
      }
    }
    return chunks;
  }

  addObject(pos: MacroCoord, w: number, h: number, loadValue: number): Map<string, number> {
    const delta = new Map<string, number>();
    for (const key of this.affectedChunks(pos, w, h)) {
      const prev = this.loads.get(key) ?? 0;
      this.loads.set(key, prev + loadValue);
      delta.set(key, loadValue);
    }
    return delta;
  }

  removeObject(pos: MacroCoord, w: number, h: number, loadValue: number): Map<string, number> {
    const delta = new Map<string, number>();
    for (const key of this.affectedChunks(pos, w, h)) {
      const prev = this.loads.get(key) ?? 0;
      this.loads.set(key, Math.max(0, prev - loadValue));
      delta.set(key, -loadValue);
    }
    return delta;
  }

  canPlace(pos: MacroCoord, w: number, h: number, loadValue: number): boolean {
    for (const key of this.affectedChunks(pos, w, h)) {
      const current = this.loads.get(key) ?? 0;
      if (current + loadValue > CHUNK_LOAD_LIMIT) return false;
    }
    return true;
  }

  applyDelta(delta: Map<string, number>): void {
    for (const [key, change] of delta) {
      const prev = this.loads.get(key) ?? 0;
      const next = prev + change;
      if (next <= 0) {
        this.loads.delete(key);
      } else {
        this.loads.set(key, next);
      }
    }
  }
}
