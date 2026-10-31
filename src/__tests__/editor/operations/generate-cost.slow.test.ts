/**
 * A built card lands without being built again, counted rather than timed. Object ids are minted
 * per placement and never seed-derived, so a map carrying the card's ids is the card's own run. A
 * build validates every command the generator offers, a landing only the accepted ones, so landing
 * costs measurably fewer rule calls.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultRegistry } from '../../../rules';
import type { RuleRegistry } from '../../../rules/registry';
import { templateLandmarkObjects } from '../../../core/model/landmarks';
import { createGridState } from '../../../core/model/template';
import { getMapTemplate } from '../../../config/maps';
import { mapFingerprint } from '../../../core/model/fingerprint';
import { clearGenerated, generateMap } from '../../../editor/operations/generate';
import { generateCandidate, __resetCandidateCache } from '../../../tools/generation/run/candidates';
import type { EditContext } from '../../../core/commands/edit-context';
import type { GridState, PlacedObject } from '../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../tools/generation/recipe';
import { makeExecutor } from '../../_support/map-state';

/** A landing's rule calls as a share of a build's; wide, since it catches a landing that builds. */
const LANDING_SHARE = 0.7;

interface Counted extends EditContext { counts: { pre: number; post: number } }

function hexiaKit(): Counted {
  const template = getMapTemplate('hexia');
  const objects = new Map<string, PlacedObject>();
  const plaza = (templateLandmarkObjects(template)[0] ?? null);
  if (plaza) objects.set(plaza.id, plaza);
  const state: GridState = { template, cells: createGridState(template).cells, objects, objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
  const registry = createDefaultRegistry();
  const counts = { pre: 0, post: 0 };
  const pre = registry.validatePreCommand.bind(registry) as RuleRegistry['validatePreCommand'];
  const post = registry.validatePostStroke.bind(registry) as RuleRegistry['validatePostStroke'];
  registry.validatePreCommand = (cmd, s) => { counts.pre++; return pre(cmd, s); };
  registry.validatePostStroke = (s, o) => { counts.post++; return post(s, o); };
  const executor = makeExecutor(state, registry);
  return { state, executor, registry, counts };
}

const config = (seed: number): GenerateConfig => (defaultConfig('designed', { maxElevation: 6, seed, richness: 1 }));

const ids = (state: GridState): string[] => [...state.objects.keys()];

beforeEach(() => { __resetCandidateCache(); });

describe('what a generation costs', () => {
  it('lands a built card for less than it costs to build one', async () => {
    const kit = hexiaKit();
    const card = await generateCandidate(kit, { config: config(2718), region: null });
    kit.counts.pre = 0;
    await generateMap(kit, { config: config(2718), region: null, candidate: card });
    const landing = kit.counts.pre;
    expect(ids(kit.state)).toEqual(ids(card!.state));

    // Same recipe and ground with no card: the generator runs and every offered command is validated.
    __resetCandidateCache();
    const cold = hexiaKit();
    await generateMap(cold, { config: config(2718), region: null });
    expect(landing).toBeLessThan(cold.counts.pre * LANDING_SHARE);
  }, 120_000);

  it('lands a second card over the first planet without building it again', async () => {
    const kit = hexiaKit();
    const first = await generateCandidate(kit, { config: config(11), region: null });
    const second = await generateCandidate(kit, { config: config(12), region: null });
    await generateMap(kit, { config: config(11), region: null, candidate: first });

    await generateMap(kit, { config: config(12), region: null, candidate: second });
    expect(ids(kit.state)).toEqual(ids(second!.state));
  }, 120_000);

  it('lands a card after Clear has taken the last run back', async () => {
    const kit = hexiaKit();
    const first = await generateCandidate(kit, { config: config(21), region: null });
    const second = await generateCandidate(kit, { config: config(22), region: null });
    await generateMap(kit, { config: config(21), region: null, candidate: first });
    clearGenerated(kit, { region: null });

    await generateMap(kit, { config: config(22), region: null, candidate: second });
    expect(ids(kit.state)).toEqual(ids(second!.state));
  }, 120_000);

  /**
   * An erase is refused outside the buildable zone, so the Γ patches auto edge-cut writes along the
   * rim are the cells most likely to survive a clear.
   */
  it('clears a generated planet back to the map it opened on', async () => {
    const kit = hexiaKit();
    const opened = mapFingerprint(kit.state);
    await generateMap(kit, { config: config(31), region: null });
    expect(mapFingerprint(kit.state)).not.toBe(opened);

    clearGenerated(kit, { region: null });
    expect(mapFingerprint(kit.state)).toBe(opened);
  }, 120_000);
});
