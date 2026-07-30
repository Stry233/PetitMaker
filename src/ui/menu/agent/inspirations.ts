// Inspiration pool for the agent welcome screen. Ninety-six short build ideas live in the
// locale files as agent2.insp_01 through agent2.insp_96, authored in a fixed cycle of the
// eight verb icons so each phrase's subject matches its icon and tile color. The sampler
// draws a few distinct entries at random for display; it is UI-only and never seeds a run.

import { colors } from '../../styles';
import type { VerbIcon } from '../../../agent/session';

export interface Inspiration { icon: VerbIcon; tile: string; key: string }

/** Cozy tile colors per icon (no blues; warm greens, sands, honeys, a soft
 *  rose). Each icon owns a small pool and every phrase picks one
 *  deterministically, so a sampled trio shows variety while any given
 *  phrase always wears the same tile. */
const TILE_POOLS: Record<VerbIcon, string[]> = {
  terrain: [colors.tileDeepGreen, '#D9E4B5', '#BFCF8A'],
  water: [colors.tilePaleYellow, '#F3D9A4'],
  tree: [colors.tileGreen, '#BFD98A', '#D9E4B5'],
  road: ['#E8E1D2', '#DCD3BE'],
  build: [colors.tileYellow, '#F6C99F', '#F3D9A4'],
  flower: [colors.tilePaleYellow, '#F5C2C2', '#EFB8A2'],
  eval: ['#E8E1D2', '#F3E7CE'],
  plan: [colors.tileYellow, '#F6C99F'],
};

/** The authored icon cycle: insp_01 is terrain, insp_02 water, and so on, repeating every 8 keys. */
const ICON_CYCLE: VerbIcon[] = ['terrain', 'water', 'tree', 'road', 'build', 'flower', 'eval', 'plan'];

export const INSPIRATIONS: Inspiration[] = Array.from({ length: 96 }, (_, i) => {
  const icon = ICON_CYCLE[i % ICON_CYCLE.length] ?? 'terrain';
  const pool = TILE_POOLS[icon];
  const tile = pool[Math.floor(i / ICON_CYCLE.length) % pool.length] ?? pool[0]!;
  return { icon, tile, key: `agent2.insp_${String(i + 1).padStart(2, '0')}` };
});

/** n distinct random picks by drawing without replacement from a copy of the pool. */
function drawDistinct(n: number): Inspiration[] {
  const pool = [...INSPIRATIONS];
  const count = Math.min(n, pool.length);
  const out: Inspiration[] = [];
  for (let i = 0; i < count; i++) {
    const j = Math.floor(Math.random() * pool.length);
    out.push(...pool.splice(j, 1));
  }
  return out;
}

/**
 * Pick n distinct random inspirations. Tries a few reshuffles to avoid showing two
 * entries with the same icon, then accepts whatever it has (unavoidable for n > 8).
 */
export function sampleInspirations(n = 3): Inspiration[] {
  let picked = drawDistinct(n);
  for (let attempt = 0; attempt < 4; attempt++) {
    const icons = new Set(picked.map((p) => p.icon));
    if (icons.size === picked.length) break;
    picked = drawDistinct(n);
  }
  return picked;
}
