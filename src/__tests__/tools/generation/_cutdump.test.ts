// DEV harness, not a test: dumps a close-up window around a water↔mountain boundary, WITH
// per-cell corner trims, to /tmp/petit-cuts.json so an offline renderer can draw the actual
// cut shapes for visual inspection. Skipped by default — run with PETIT_DUMP=1.
import { describe, it } from 'vitest';
// @ts-ignore - node:fs is untyped (no @types/node); dev-only harness.
import { writeFileSync } from 'node:fs';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState } from '../../rules/_helpers';
import { generateTerrain } from '../../../tools/generation/terrain-generator';
import { getCell } from '../../../core/model/grid-model';
import { TerrainType, type EditorEvents, type GenerateConfig } from '../../../core/model/types';

const SIZE = 80, WIN = 30;

// @ts-ignore dev-only harness — process.env via globalThis (no @types/node)
const DUMP = Boolean((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.PETIT_DUMP);

describe.runIf(DUMP)('CUT dump', () => {
  it('dumps a window around a water/mountain boundary with corners', () => {
    const state = makeState(SIZE, SIZE);
    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    // env overrides: CUT_SEED / CUT_MODE / CUT_CX / CUT_CY (centre); default centres on the
    // highest-tier gamma patch (an N>=2 fillet sitting on a real N-1 base).
    // @ts-ignore dev-only harness
    const env = (globalThis as any).process?.env ?? {};
    const seed = Number(env.CUT_SEED ?? 42);
    const mode = (env.CUT_MODE ?? 'mixed') as GenerateConfig['mode'];
    const config: GenerateConfig = { algorithm: 'random', mode, corridorWidth: 1, maxElevation: Number(env.CUT_ELEV ?? 6), seed, region: null, relief: Number(env.CUT_RELIEF ?? 0.6) };
    exec.runSilently(() => generateTerrain(config, state, (c) => exec.execute(c)));
    exec.commitStrokeGroup(exec.getUndoStackSize());

    let fx = SIZE / 2, fy = SIZE / 2, best = -1;
    if (env.CUT_CX && env.CUT_CY) {
      fx = Number(env.CUT_CX); fy = Number(env.CUT_CY);
    } else {
      for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) {
        const t = getCell(state.cells, x, y)?.terrain;
        if (t?.patchOnly && t.type === TerrainType.Mountain && t.elevation > best) { best = t.elevation; fx = x; fy = y; }
      }
    }
    const ox = Math.max(0, Math.min(SIZE - WIN, fx - (WIN >> 1))), oy = Math.max(0, Math.min(SIZE - WIN, fy - (WIN >> 1)));

    const cells: unknown[] = [];
    for (let y = oy; y < oy + WIN; y++) for (let x = ox; x < ox + WIN; x++) {
      const c = getCell(state.cells, x, y)!;
      const t = c.terrain;
      cells.push({
        x, y, zone: c.zone,
        type: t ? (t.type === TerrainType.Mountain ? 'm' : t.type === TerrainType.Water ? 'w' : 'n') : 'n',
        e: t ? t.elevation : 0,
        corners: t?.corners ?? null,
        patch: !!t?.patchOnly,
      });
    }
    writeFileSync('/tmp/petit-cuts.json', JSON.stringify({ win: WIN, ox, oy, cells }));
  });
});
