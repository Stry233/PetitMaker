// DEV harness, not a test: generates on the REAL hexia template and dumps the result to
// /tmp/petit-real.json for offline PNG rendering. Skipped by default — run with PETIT_DUMP=1.
import { describe, it } from 'vitest';
// @ts-ignore dev-only
import { readFileSync, writeFileSync } from 'node:fs';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { createGrid, createPlazaObject } from '../../../core/model/grid-model';
import { generateTerrain } from '../../../tools/generation/terrain-generator';
import { toGenConfig } from '../../../tools/generation';
import { populate } from '../../../tools/generation/placement';
import { objectRect } from '../../../state/object-geometry';
import { getCatalogItem } from '../../../state/catalog';
import { TerrainType, type EditorEvents, type GenerateConfig, type GridState, type MapTemplate, type PlacedObject } from '../../../core/model/types';

function loadHexia(): GridState {
  const template = JSON.parse(readFileSync('src/config/maps/hexia.json', 'utf8')) as MapTemplate;
  const cells = createGrid(template);
  const objects = new Map<string, PlacedObject>();
  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);
  return { template, cells, objects, lockedLayers: new Set() };
}

// @ts-ignore dev-only harness — process.env via globalThis (no @types/node)
const DUMP = Boolean((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.PETIT_DUMP);

describe.runIf(DUMP)('RENDER real map', () => {
  it('dumps hexia generations', () => {
    const maps: unknown[] = [];
    const combos: [string, 'earth' | 'mixed', number][] = [['hexia mixed s7', 'mixed', 7], ['hexia mixed s42', 'mixed', 42]];
    let W = 0, H = 0;
    for (let k = 0; k < combos.length; k++) {
      const [label, mode, seed] = combos[k]!;
      const state = loadHexia();
      W = state.template.width; H = state.template.height;
      const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
      const config: GenerateConfig = { algorithm: 'random', mode, corridorWidth: 1, maxElevation: 6, seed, region: null, settlement: 0.6, nature: 0.6 };
      exec.runSilently(() => {
        const r = generateTerrain(config, state, (c) => exec.execute(c));
        void populate(toGenConfig(config), state, (c) => exec.execute(c), exec.getRegistry(), undefined, r.zonePlan);
      });
      exec.commitStrokeGroup(exec.getUndoStackSize());
      const tier: number[] = [], water: number[] = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const c = state.cells[y]![x]!.terrain;
        tier.push(c && c.type === TerrainType.Mountain ? c.elevation : 0);
        water.push(c && c.type === TerrainType.Water ? c.elevation : -1);
      }
      const objects = [...state.objects.values()].filter((o) => !o.locked)
        .map((o) => ({ kind: getCatalogItem(o.catalogId)?.category ?? 'building', e: o.elevation, ...objectRect(o) }));
      maps.push({ label, row: k, col: 0, tier, water, objects });
    }
    writeFileSync('/tmp/petit-real.json', JSON.stringify({ size: Math.max(W, H), w: W, h: H, cols: 1, maps }));
  });
});
