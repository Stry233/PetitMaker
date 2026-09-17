// DEV harness, not a test: generates sample maps and dumps them to /tmp/petit-terrain.json so an
// offline renderer can draw a PNG montage for visual inspection (no browser needed). Skipped by
// default — run with PETIT_DUMP=1.
import { describe, it } from 'vitest';
// @ts-ignore - node:fs is untyped in this project (no @types/node); dev-only render harness.
import { writeFileSync } from 'node:fs';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState } from '../../rules/_helpers';
import { generateTerrain } from '../../../tools/generation/terrain-generator';
import { objectRect } from '../../../state/object-geometry';
import { getCatalogItem } from '../../../state/catalog';
import { TerrainType, type EditorEvents, type GenerateConfig } from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';

const SIZE = 80;

function gen(mode: 'earth' | 'water' | 'mixed', seed: number, richness: number, label: string, row: number, col: number) {
  const state = makeState(SIZE, SIZE);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const config: GenerateConfig = {
    algorithm: 'designed', mode, corridorWidth: 1, maxElevation: 6, seed, region: null,
    richness: richness,
  };
  const start = exec.getUndoStackSize();
  generateTerrain(config, state, (c) => exec.execute(c), exec.getRegistry());
  exec.commitStrokeGroup(start);

  // Reconstruct tier/water from the committed cells (mountain elevation vs water elevation).
  const tier: number[] = [], water: number[] = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const c = state.cells[y]![x]!.terrain;
    tier.push(c && c.type === TerrainType.Mountain ? c.elevation : 0);
    water.push(c && c.type === TerrainType.Water ? c.elevation : -1);
  }
  // `kind` is the catalog ItemCategory (building/road/bridge/ramp/tree/flora/facility) — more
  // informative than which lumps road/bridge/ramp under House. Drives the render color.
  const objects = [...state.objects.values()]
    .filter((o) => !o.locked)
    .map((o) => ({ kind: getCatalogItem(o.catalogId)?.category ?? 'building', e: o.elevation, ...objectRect(o) }));
  return { label, row, col, tier, water, objects };
}

// @ts-ignore dev-only harness — process.env via globalThis (no @types/node)
const DUMP = Boolean((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.PETIT_DUMP);

describe.runIf(DUMP)('RENDER dump', () => {
  it('dumps populated maps', () => {
    const maps = [
      // Row 0 — the richness axis on one seed: does a richer planet get more relief, water and decor?
      gen('mixed', 7, 0.0, 'mixed s7 r0', 0, 0),
      gen('mixed', 7, 0.25, 'mixed s7 r.25', 0, 1),
      gen('mixed', 7, 0.5, 'mixed s7 r.5', 0, 2),
      gen('mixed', 7, 0.75, 'mixed s7 r.75', 0, 3),
      gen('mixed', 7, 1.0, 'mixed s7 r1', 0, 4),
      // Row 1 — the three planet kinds at mid richness (water should carry the most water)
      gen('earth', 7, 0.5, 'earth s7', 1, 0),
      gen('water', 7, 0.5, 'water s7', 1, 1),
      gen('mixed', 7, 0.5, 'mixed s7', 1, 2),
      gen('water', 1, 0.5, 'water s1', 1, 3),
      gen('mixed', 1, 0.5, 'mixed s1', 1, 4),
      // Row 2 — seed variety at the shelf's own default richness
      gen('mixed', 42, 0.7, 'mixed s42', 2, 0),
      gen('mixed', 99, 0.7, 'mixed s99', 2, 1),
      gen('mixed', 13, 0.7, 'mixed s13', 2, 2),
      gen('mixed', 2, 0.7, 'mixed s2', 2, 3),
      gen('mixed', 100, 0.7, 'mixed s100', 2, 4),
      // Row 3 — a broader sample (crossings + composed places across variety)
      gen('mixed', 11, 1.0, 'mixed s11 r1', 3, 0),
      gen('mixed', 64, 1.0, 'mixed s64 r1', 3, 1),
      gen('water', 12, 1.0, 'water s12 r1', 3, 2),
      gen('mixed', 137, 1.0, 'mixed s137 r1', 3, 3),
      gen('earth', 23, 1.0, 'earth s23 r1', 3, 4),
    ];
    writeFileSync('/tmp/petit-terrain.json', JSON.stringify({ size: SIZE, cols: 5, maps }));
  });
});
