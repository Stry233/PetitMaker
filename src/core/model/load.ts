import { CHUNK_LOAD_ENABLED, CHUNK_LOAD_LIMIT, LOAD_DECIMALS } from './game-profile';
import type { GridState } from './types';

export function isChunkLoadEnforced(state: GridState): boolean {
  return CHUNK_LOAD_ENABLED && !state.ignoreChunkLoad;
}

/** Quantize arithmetic so repeated additions and removals preserve exact budget boundaries. */
export function roundLoad(value: number): number {
  const scale = 10 ** LOAD_DECIMALS;
  return Math.round(value * scale) / scale;
}

/** An already overloaded region permits changes that do not increase its load. */
export function exceedsLoadBudget(current: number, change: number): boolean {
  return change > 0 && roundLoad(current + change) > CHUNK_LOAD_LIMIT;
}
