// DEV harness, not a test: generates + populates sample maps and dumps them to
// /tmp/petit-terrain.json so an offline renderer can draw a PNG montage for visual
// inspection (no browser needed). Skipped by default — run with PETIT_DUMP=1.
import { describe, it } from 'vitest';
// @ts-ignore - node:fs is untyped in this project (no @types/node); dev-only render harness.
import { writeFileSync } from 'node:fs';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState } from '../../rules/_helpers';
import { generateTerrain } from '../../../tools/generation/terrain-generator';
import { toGenConfig } from '../../../tools/generation';
import { populate } from '../../../tools/generation/placement';
import { objectRect } from '../../../state/object-geometry';
import { getCatalogItem } from '../../../state/catalog';
import { TerrainType, type EditorEvents, type GenerateConfig } from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';

const SIZE = 80;

function gen(mode: 'earth' | 'water' | 'mixed', seed: number, relief: number, label: string, row: number, col: number) {
  const state = makeState(SIZE, SIZE);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const config: GenerateConfig = {
    algorithm: 'random', mode, corridorWidth: 1, maxElevation: 6, seed, region: null,
    relief, waterAmount: 0.5, rivers: 0.4, flatness: 0.5, settlement: 0.7, nature: 0.7,
  };
  const start = exec.getUndoStackSize();
  const r = generateTerrain(config, state, (c) => exec.execute(c));
  populate(toGenConfig(config), state, (c) => exec.execute(c), exec.getRegistry(), undefined, r.zonePlan);
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
      // Row 0 — relief trend (earth, seed 7): does higher relief = more/taller mountains, monotonically?
      gen('earth', 7, 0.0, 'earth s7 relief0', 0, 0),
      gen('earth', 7, 0.25, 'earth s7 relief.25', 0, 1),
      gen('earth', 7, 0.5, 'earth s7 relief.5', 0, 2),
      gen('earth', 7, 0.75, 'earth s7 relief.75', 0, 3),
      gen('earth', 7, 1.0, 'earth s7 relief1', 0, 4),
      // Row 1 — modes at relief .5 (water should be water-only, no mountains)
      gen('earth', 7, 0.5, 'earth s7', 1, 0),
      gen('water', 7, 0.5, 'water s7', 1, 1),
      gen('mixed', 7, 0.5, 'mixed s7', 1, 2),
      gen('water', 1, 0.5, 'water s1', 1, 3),
      gen('mixed', 1, 0.5, 'mixed s1', 1, 4),
      // Row 2 — mixed variety (rivers + lakes → bridges; village + groves + waterside flora)
      gen('mixed', 42, 0.5, 'mixed s42', 2, 0),
      gen('mixed', 99, 0.5, 'mixed s99', 2, 1),
      gen('mixed', 13, 0.6, 'mixed s13 r.6', 2, 2),
      gen('mixed', 2, 0.7, 'mixed s2 r.7', 2, 3),
      gen('mixed', 100, 0.4, 'mixed s100 r.4', 2, 4),
      // Row 3 — more seeds for a broader sample (bridges/ramps + crafted villages across variety)
      gen('mixed', 11, 0.5, 'mixed s11', 3, 0),
      gen('mixed', 64, 0.5, 'mixed s64', 3, 1),
      gen('water', 12, 0.5, 'water s12', 3, 2),
      gen('mixed', 137, 0.6, 'mixed s137 r.6', 3, 3),
      gen('earth', 23, 0.7, 'earth s23 r.7', 3, 4),
    ];
    writeFileSync('/tmp/petit-terrain.json', JSON.stringify({ size: SIZE, cols: 5, maps }));
  });
});
