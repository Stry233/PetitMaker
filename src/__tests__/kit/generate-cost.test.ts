/**
 * WHAT A GENERATION COSTS, counted rather than timed.
 *
 * A card that has already been built must not be built again, and there are two honest ways to say
 * so without a clock. An OBJECT ID is minted per placement and is never seed-derived, so a map
 * whose ids are the card's own is the card's own run arriving rather than a repeat of it. And a
 * build asks the rules about every command the generator OFFERS, most of which it rejects by
 * design, where a landing asks only about the commands that were accepted — so the same recipe
 * costs measurably less to land than to build and land.
 *
 * The three cases this pins are the ones daily use walks through: pressing the same card twice,
 * pressing a second card while the first island stands, and pressing a card after Clear. All three
 * clear to the same ground, which is what makes one run the answer to all of them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules';
import type { RuleRegistry } from '../../rules/registry';
import { createGrid, createPlazaObject } from '../../core/model/grid-model';
import { getMapTemplate } from '../../config/maps';
import { roadLookup } from '../../state/object-index';
import { mapFingerprint } from '../../tools/macros/scratch';
import {
  clearGenerated, generateCandidate, generateMap, __resetCandidateCache,
} from '../../kit/operations/generate';
import type { KitContext } from '../../kit/context';
import type { EditorEvents, GenerateConfig, GridState, PlacedObject } from '../../core/model/types';

/** What a landing may cost as a share of building the same recipe and landing it. The margin is
 *  wide on purpose: what it is here to catch is a landing that silently became a build again. */
const LANDING_SHARE = 0.7;

interface Counted extends KitContext { counts: { pre: number; post: number } }

function hexiaKit(): Counted {
  const template = getMapTemplate('hexia');
  const objects = new Map<string, PlacedObject>();
  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);
  const state: GridState = { template, cells: createGrid(template), objects, lockedLayers: new Set() };
  const registry = createDefaultRegistry();
  const counts = { pre: 0, post: 0 };
  const pre = registry.validatePreCommand.bind(registry) as RuleRegistry['validatePreCommand'];
  const post = registry.validatePostStroke.bind(registry) as RuleRegistry['validatePostStroke'];
  registry.validatePreCommand = (cmd, s) => { counts.pre++; return pre(cmd, s); };
  registry.validatePostStroke = (s, o) => { counts.post++; return post(s, o); };
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), registry, roadLookup(state));
  return { state, executor, registry, counts };
}

const config = (seed: number): GenerateConfig => ({
  algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed, region: null,
  richness: 1,
});

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

    // The same recipe on the same ground with nothing built for it: the generator runs, and every
    // command it offers is validated whether or not it is accepted.
    __resetCandidateCache();
    const cold = hexiaKit();
    await generateMap(cold, { config: config(2718), region: null });
    expect(landing).toBeLessThan(cold.counts.pre * LANDING_SHARE);
  }, 120_000);

  it('lands a second card over the first island without building it again', async () => {
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
   * CLEAR LEAVES NO CRUMBS. An erase is refused outside the buildable zone, so the cosmetic Γ
   * patches an auto edge-cut writes along the island's rim are the ones at risk of surviving every
   * clear and every regeneration — leaving a blank map that still remembers the island before it,
   * and a card built for plain ground that can never be landed as itself again.
   */
  it('clears a generated island back to the map it opened on', async () => {
    const kit = hexiaKit();
    const opened = mapFingerprint(kit.state);
    await generateMap(kit, { config: config(31), region: null });
    expect(mapFingerprint(kit.state)).not.toBe(opened);

    clearGenerated(kit, { region: null });
    expect(mapFingerprint(kit.state)).toBe(opened);
  }, 120_000);
});
