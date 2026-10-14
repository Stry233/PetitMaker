/**
 * The candidate cache: the same question about the same map is answered once.
 *
 * The key is the map's fingerprint plus the whole recipe (region folded in), so the invalidation
 * story is exactly "the map changed or the question did" — there is no timer and no explicit
 * flush to forget.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CommandType, TerrainType } from '../../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../../tools/generation/recipe';
import { generateCandidate, __resetCandidateCache } from '../../../../tools/generation/run/candidates';
import { generateMap } from '../../../../editor/operations/generate';
import { mapFingerprint } from '../../../../core/model/fingerprint';
import type { EditContext } from '../../../../core/commands/edit-context';
import { kindConfig, type GenerateKind } from '../../../../tools/generation/kinds';
import { makeState, makeExecutor } from '../../../_support/map-state';

function kitOn(size = 24): EditContext {
  const state = makeState(size, size);
  const executor = makeExecutor(state);
  return { state, executor, registry: executor.getRegistry() };
}

const config = (seed: number): GenerateConfig => (defaultConfig('designed', { seed, maxElevation: 3, richness: 1 }));

beforeEach(() => { __resetCandidateCache(); });

describe('the candidate cache', () => {
  it('answers the same recipe on the same map with the same candidate', async () => {
    const kit = kitOn();
    const first = await generateCandidate(kit, { config: config(7), region: null });
    const second = await generateCandidate(kit, { config: config(7), region: null });
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it('treats another seed as another question', async () => {
    const kit = kitOn();
    const first = await generateCandidate(kit, { config: config(7), region: null });
    const second = await generateCandidate(kit, { config: config(8), region: null });
    expect(second).not.toBe(first);
  });

  it('treats another region as another question', async () => {
    const kit = kitOn();
    const whole = await generateCandidate(kit, { config: config(7), region: null });
    const scoped = await generateCandidate(kit, {
      config: config(7),
      region: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
    });
    expect(scoped).not.toBe(whole);
  });

  /** The user's own round trip, through the shelf's own recipe builder: a tab left for the maze and
   *  returned to must find the planet batch standing — `kindConfig` is pure over (kind, sliders,
   *  seed) and nothing else may leak into the key. */
  it('answers a tab round trip from the cache', async () => {
    const kit = kitOn();
    const at = (kind: GenerateKind, seed: number) => kindConfig({
      kind, seed, richness: 100, maxElevation: 4, corridorWidth: 2, gates: null,
    });
    const land = await generateCandidate(kit, { config: at('island', 7), region: null });
    await generateCandidate(kit, { config: at('maze', 7), region: null });
    const back = await generateCandidate(kit, { config: at('island', 7), region: null });
    expect(land).not.toBeNull();
    expect(back, 'the planet batch was still in the cache').toBe(land);
  });

  /**
   * Landing card two after card one: candidate B was built against the empty map and the live map
   * now carries A's planet — but a full run clears before it builds, and a planet clears to the
   * ground B was built on. So B lands as itself, down to the object ids a rebuild would have minted
   * fresh, and the planet underneath costs nothing.
   */
  it('lands a card over another card\'s planet without building it again', async () => {
    const kit = kitOn();
    const a = await generateCandidate(kit, { config: config(7), region: null });
    const b = await generateCandidate(kit, { config: config(8), region: null });
    expect((await generateMap(kit, { config: config(7), region: null, candidate: a })).cancelled).toBe(false);

    const landed = await generateMap(kit, { config: config(8), region: null, candidate: b });
    expect(landed.cancelled).toBe(false);
    expect(mapFingerprint(kit.state)).toBe(mapFingerprint(b!.state));
  });

  it('treats a picture allowed onto other cells as another question', async () => {
    const kit = kitOn();
    const stencil = { width: 3, height: 3, coverage: new Uint8Array(9).fill(255), color: new Uint32Array(9) };
    const printed = (allow: number[]): GenerateConfig => (defaultConfig('stencil', { seed: 1, maxElevation: 3, stencilPlan: {
        read: 'shape', fill: { kind: 'terrain', terrain: TerrainType.Mountain }, stencil, origin: { x: 4, y: 4 },
        allow: new Set(allow),
      } }));
    const row = await generateCandidate(kit, { config: printed([4 * 24 + 4, 4 * 24 + 5, 4 * 24 + 6]), region: null });
    const column = await generateCandidate(kit, { config: printed([4 * 24 + 4, 5 * 24 + 4, 6 * 24 + 4]), region: null });
    expect(row).not.toBeNull();
    expect(column).not.toBe(row);
  });

  it('forgets nothing by timer: a map EDIT is what changes the answer', async () => {
    const kit = kitOn();
    const before = await generateCandidate(kit, { config: config(7), region: null });
    kit.executor.execute({
      type: CommandType.PaintTerrain,       cells: [{ x: 5, y: 5 }], terrainType: TerrainType.Mountain, elevation: 1,
    });
    const after = await generateCandidate(kit, { config: config(7), region: null });
    expect(after).not.toBe(before);
  });
});
