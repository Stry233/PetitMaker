// The designed pipeline as it reaches a map: plans committed through the live RuleRegistry and read
// back with the evaluation harness's scorers, since a plan promising a building is not the rules
// accepting it. Every placement is legal by construction, so a refusal, a post-stroke violation or a
// missing anchor is a defect, never an expected loss.
import { describe, it, expect, vi } from 'vitest';

// Synchronous generation batch over both templates and every seed; tens of seconds on an idle machine.
vi.setConfig({ testTimeout: 60_000 });
import { MAP_TEMPLATES } from '../../../../config/maps/index';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { ProvenanceRecorder } from '../../../../core/commands/provenance-recorder';
import { EventBus } from '../../../../core/commands/event-bus';
import { TerrainType, type GridState, type MapTemplate } from '../../../../core/model/types';
import { defaultConfig } from '../../../../tools/generation/recipe';
import { type EditorEvents } from '../../../../state/editing/events';
import { createDefaultRegistry } from '../../../../rules/index';
import { categoryOf } from '../../../../state/catalog';
import { objectRect } from '../../../../state/object-geometry';
import {
  evaluateMap, waterStoryLedger, STREAM_STRAIGHT_MAX,
} from '../../../_support/design-eval';
import { buildDesigned, designedMap, freshMap, type DesignedRun } from './_designed-map';
import { generateTerrain } from '../../../../tools/generation';
import { GENERATION_STYLE } from '../../../../config/generation-style';
import { terrainStrokePolicy } from '../../../../core/domain/edge-cut/stroke-policy';
import { applyTrim } from '../../../../core/domain/edge-cut/trim-apply';
import { generateWith } from '../../../_support/generation';
import { ItemCategory } from '../../../../config/catalog/categories';

const HEXIA = MAP_TEMPLATES['hexia']!;
const TAFA = MAP_TEMPLATES['tafa']!;
const SEEDS = Array.from({ length: 10 }, (_, i) => 1 + i * 7919);
const DEFAULT_RICHNESS = 0.5;

/** One designed map, generated once per (seed, template, richness) for this file. Read-only: a
 *  test that edits the map builds its own with `buildDesigned`. */
function build(seed: number, template: MapTemplate, richness = DEFAULT_RICHNESS): DesignedRun {
  return designedMap(seed, template, { richness });
}

/** The map's content as one string, without object ids: each run mints fresh ones, so
 *  `mapFingerprint` (which mixes them in) differs between two identical runs. */
function contentDigest(state: GridState): string {
  const cells: string[] = [];
  for (let y = 0; y < state.template.height; y++) {
    for (let x = 0; x < state.template.width; x++) {
      const t = state.cells[y]![x]!.terrain;
      if (t) cells.push(`${x},${y},${t.type},${t.elevation}`);
    }
  }
  const objects = [...state.objects.values()]
    .map((o) => `${o.catalogId}@${o.position.x},${o.position.y}r${o.rotation}e${o.elevation}`)
    .sort();
  return `${cells.join('|')}#${objects.join('|')}`;
}

/** Every cell of a rect, for a claim read over a drawn shape rather than over its box. */
const rectCells = (r: { x: number; y: number; w: number; h: number }): { x: number; y: number }[] => {
  const out: { x: number; y: number }[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
  return out;
};

const pavedCells = (state: GridState): Set<string> => {
  const out = new Set<string>();
  for (const o of state.objects.values()) {
    if (categoryOf(o) !== ItemCategory.Road) continue;
    const r = objectRect(o);
    for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++) {
      for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) out.add(`${x},${y}`);
    }
  }
  return out;
};

describe('the hard ledger, on the committed map', () => {
  it('places every anchor exactly once, on both templates, at every seed', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS) {
        const { state, outcome } = build(seed, template);
        const { hard, metrics } = evaluateMap(state);
        expect(outcome.anchors.unplaced, `${template.id}/${seed}`).toEqual([]);
        expect(hard.allAnchorsPlaced.missing, `${template.id}/${seed}`).toEqual([]);
        expect(hard.allAnchorsPlaced.repeated, `${template.id}/${seed}`).toEqual([]);
        expect(metrics.objects.anchors).toBe(metrics.objects.anchorsExpected);
      }
    }
  });

  it('passes the whole ledger, on both templates, at every seed', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS) {
        const { state } = build(seed, template);
        const { hard } = evaluateMap(state);
        expect(hard.pass, `${template.id}/${seed}: `
          + `${hard.roadsConnected.reachableShare.toFixed(2)} reachable, `
          + `${hard.roadsConnected.deadEnds} dead ends, `
          + `${(100 * hard.noOneWideRoads.oneWideShare).toFixed(1)}% 1-wide, `
          + `${hard.streetsArrive.deadEnds}/${hard.streetsArrive.termini} ends arrive at nothing, `
          + `${hard.waterStory.tofu} tofu lakes and `
          + `${(100 * hard.waterStory.unaccountedShare).toFixed(0)}% of the water in no story`)
          .toBe(true);
      }
    }
  });

  it('holds the ledger across the richness range', () => {
    for (const richness of [0, 0.5, 1]) {
      const { state, outcome } = build(2026, HEXIA, richness);
      const ledger = evaluateMap(state).hard;
      expect(ledger.pass, `richness ${richness}: `
        + `${ledger.streetsArrive.deadEnds}/${ledger.streetsArrive.termini} ends arrive at nothing, `
        + `${ledger.allAnchorsPlaced.missing.length} anchors missing`).toBe(true);
      expect(outcome.anchors.unplaced, `richness ${richness}`).toEqual([]);
    }
  });
});

describe('the rules accept the whole plan', () => {
  it('has nothing refused and nothing reverted', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS) {
        const { outcome, violations } = build(seed, template);
        expect(outcome.refused, `${template.id}/${seed}`).toEqual({ roads: 0, anchors: 0, lanes: 0, crossings: 0 });
        expect(violations, `${template.id}/${seed}`).toEqual([]);
      }
    }
  });

  it('lays every court lane it planned', () => {
    for (const seed of SEEDS) {
      const { outcome } = build(seed, HEXIA);
      expect(outcome.lanesSkipped, `seed ${seed}`).toEqual([]);
    }
  });

  it('commits every terrain layer the sculpt asked for', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS.slice(0, 4)) {
        const { outcome, state } = build(seed, template);
        expect(outcome.terrain.refused, `${template.id}/${seed}`).toBe(0);
        expect(outcome.terrain.commands, `${template.id}/${seed}`).toBeGreaterThan(0);
        const shaped = state.cells.flat()
          .filter((c) => c.terrain && c.terrain.type !== TerrainType.None).length;
        expect(shaped, `${template.id}/${seed}`).toBeGreaterThan(500);
      }
    }
  });
});

describe('every door opens on a road', () => {
  it('puts pavement on the approach cell of every anchor, on both templates', () => {
    for (const template of [HEXIA, TAFA]) {
      const unroaded: number[] = [];
      for (const seed of SEEDS) {
        const { state, outcome } = build(seed, template);
        const paved = pavedCells(state);
        // A door the network cannot reach is reported rather than given a doorstep the plaza cannot
        // walk to. Over twenty-five seeds per template a map has at most 6 unroaded gates.
        expect(outcome.unroadedGates.length, `${template.id}/${seed}`).toBeLessThanOrEqual(7);
        unroaded.push(outcome.unroadedGates.length);
        // Every approach but the ones the outcome named is pavement.
        const named = new Set(outcome.unroadedGates.map((g) => g.catalogId));
        for (const p of outcome.anchors.placements) {
          if (named.has(p.catalogId)) continue;
          expect(paved.has(`${p.approach.x},${p.approach.y}`),
            `${template.id}/${seed} ${p.catalogId} approach ${p.approach.x},${p.approach.y}`).toBe(true);
        }
      }
      // These ten seeds average 1.1 (hexia) and 1.7 (tafa).
      const mean = unroaded.reduce((a, b) => a + b, 0) / unroaded.length;
      expect(mean, `${template.id}: mean ${mean.toFixed(1)} unroaded gates`).toBeLessThanOrEqual(2);
    }
  });

  it('keeps the doorstep clear of the neighbours, so a door is reached and not walled in', () => {
    for (const seed of SEEDS) {
      const { state, outcome } = build(seed, HEXIA);
      const walls = new Set<string>();
      for (const o of state.objects.values()) {
        const cat = categoryOf(o);
        if (cat !== ItemCategory.Building && cat !== ItemCategory.Facility) continue;
        const r = objectRect(o);
        for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++) {
          for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) walls.add(`${x},${y}`);
        }
      }
      for (const p of outcome.anchors.placements) {
        expect(walls.has(`${p.approach.x},${p.approach.y}`),
          `seed ${seed}: ${p.catalogId} doorstep at ${p.approach.x},${p.approach.y}`).toBe(false);
      }
    }
  });
});

describe('buildings on the street\'s own pavement', () => {
  const structures = (state: GridState) => [...state.objects.values()].filter((o) => {
    const cat = categoryOf(o);
    return !o.locked && (cat === ItemCategory.Building || cat === ItemCategory.Facility);
  });

  it('stands most street-facing buildings on a whole floor, and leaves the rest on their ground', () => {
    for (const template of [HEXIA, TAFA]) {
      let eligible = 0, paved = 0, standing = 0;
      for (const seed of SEEDS) {
        const { state, outcome } = build(seed, template);
        const roads = pavedCells(state);
        let floored = 0;
        for (const o of structures(state)) {
          standing++;
          const cells = rectCells(objectRect(o));
          const under = cells.filter((c) => roads.has(`${c.x},${c.y}`)).length;
          expect(under === 0 || under === cells.length, `${template.id}/${seed} ${o.catalogId}: ${under} of ${cells.length} cells paved`).toBe(true);
          if (under > 0) floored++;
        }
        expect(floored, `${template.id}/${seed}`).toBe(outcome.floors.paved);
        eligible += outcome.floors.eligible;
        paved += outcome.floors.paved;
      }
      const share = GENERATION_STYLE.pavedFloors.share;
      // At a share of 0.75 these seeds pave 69 of 101 qualifying buildings on hexia and 77 of 99 on tafa.
      expect(paved / eligible, `${template.id}: ${paved} of ${eligible} qualifying buildings paved`).toBeGreaterThan(share - 0.15);
      expect(paved / eligible, `${template.id}: ${paved} of ${eligible} qualifying buildings paved`).toBeLessThan(share + 0.15);
      expect(eligible / standing, `${template.id}: ${eligible} of ${standing} buildings qualify`).toBeLessThan(1);
    }
  });

  it('leaves the walkable network the evaluator reads as it was', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const { state, outcome } = buildDesigned(seed, HEXIA, { richness: DEFAULT_RICHNESS });
      expect(outcome.floors.paved, `seed ${seed}`).toBeGreaterThan(0);
      const withFloors = evaluateMap(state);
      const rects = structures(state).map((o) => objectRect(o));
      for (const o of [...state.objects.values()]) {
        if (categoryOf(o) !== ItemCategory.Road) continue;
        const r = objectRect(o);
        if (rects.some((s) => r.x >= s.x && r.x < s.x + s.w && r.y >= s.y && r.y < s.y + s.h)) state.objects.delete(o.id);
      }
      const without = evaluateMap(state);
      expect(withFloors.hard, `seed ${seed}`).toEqual(without.hard);
      expect(withFloors.metrics.roads, `seed ${seed}`).toEqual(without.metrics.roads);
      expect(withFloors.scores, `seed ${seed}`).toEqual(without.scores);
    }
  });
});

describe('determinism', () => {
  it('builds the same map twice from the same seed, and a different one from another', () => {
    const a = buildDesigned(31337, HEXIA, { richness: 0.7 });
    const b = buildDesigned(31337, HEXIA, { richness: 0.7 });
    expect(contentDigest(b.state)).toBe(contentDigest(a.state));
    expect(b.outcome.placed).toBe(a.outcome.placed);
    const c = buildDesigned(31338, HEXIA, { richness: 0.7 });
    expect(contentDigest(c.state)).not.toBe(contentDigest(a.state));
  });
});

describe('the generate facade', () => {

  it('routes `designed` to the methodology pipeline', () => {
    const state = freshMap(HEXIA);
    const exec = new CommandExecutor(
      state,
      { bus: new EventBus<EditorEvents>(), rules: createDefaultRegistry(), policy: terrainStrokePolicy(() => null), provenance: new ProvenanceRecorder(state),
      trims: applyTrim },
    );
    let result: ReturnType<typeof generateTerrain> | undefined;
    exec.transaction({ silent: true }, () => {
      result = generateWith(state, exec, defaultConfig('designed', { maxElevation: 8, seed: 12345, richness: 0.5 }));
    });
    exec.beginStroke().commit();
    expect(result!.designed).toBeDefined();
    expect(result!.skipped).toBe(0);
    expect(result!.placed).toBeGreaterThan(0);
    expect(evaluateMap(state).hard.pass).toBe(true);
  });

});

describe('the water system, on the committed map', () => {
  // Tofu water is a box-shaped lake bordered by mountain. Read per seed, a failure points at the
  // water reading rather than the whole ledger.
  it('drops no tofu lake, on either template, at any seed', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS) {
        const { state } = build(seed, template, 1);
        const w = waterStoryLedger(state);
        expect(w.tofu, `${template.id}/${seed}: first at `
          + `${w.where.map((c) => `${c.x},${c.y} (${c.cells})`).join(' ')}`).toBe(0);
        // Most water stands in a few large figures that account for themselves, so a loose accent is a
        // small share of the total.
        expect(w.unaccountedShare, `${template.id}/${seed}`).toBeLessThanOrEqual(0.10);
      }
    }
  });

  it('runs one course, and it arrives somewhere', () => {
    // The arrival is read on the committed map: every carved cell and the named arrival stand in water
    // when the stroke closes, which catches a later pass (raising ground, paving, planting) writing
    // over the story. The shape reading takes whichever body reads as a descending channel, cascade
    // stairs included, so the shape bars are batch claims.
    let carved = 0, landed = 0;
    let present = 0, straightOk = 0, bothEnds = 0;
    for (const seed of SEEDS) {
      const { state, outcome } = build(seed, HEXIA, 1);
      const story = outcome.sculpt.story;
      if (story) {
        carved++;
        const wet = (x: number, y: number): boolean =>
          state.cells[y]?.[x]?.terrain?.type === TerrainType.Water;
        const pond = story.pond;
        const mouth = story.spine[story.spine.length - 1];
        // A pond is a drawn shape, not a filled rect, so it arrives if water stands anywhere in its box.
        const arrival = story.ending === 'pond'
          ? !!pond && rectCells(pond.rect).some((c) => wet(c.x, c.y))
          : !!mouth && wet(mouth.x, mouth.y);
        if (arrival && story.cells.every((c) => wet(c.x, c.y))) landed++;
      }
      const s = evaluateMap(state).water.stream;
      if (!s.present) continue;
      present++;
      if (s.longestStraight <= STREAM_STRAIGHT_MAX) straightOk++;
      if (s.source && s.destination) bothEnds++;
    }
    expect(carved, `${carved} of ${SEEDS.length} seeds carve a course`).toBe(SEEDS.length);
    expect(landed, `${landed} of ${carved} courses stand whole on the map, arrival included`)
      .toBe(carved);
    expect(present, `${present} of ${SEEDS.length} seeds read as carrying a course`)
      .toBeGreaterThan(SEEDS.length * 0.7);
    // The bar is low because the picked body is as often a cascade stair or a trough as the story, and
    // neither has to end anywhere; the story's own arrival is asserted above.
    expect(bothEnds, `${bothEnds} of ${present} courses read both ends`)
      .toBeGreaterThanOrEqual(present * 0.2);
    // Width is asserted on the course's own cells in `water-story.test.ts`. On the finished map the
    // course, its pond and any cascade read as one body, which lengthens the straight run.
    expect(straightOk, `${straightOk} of ${present} courses stay under ${STREAM_STRAIGHT_MAX}`)
      .toBeGreaterThan(present * 0.7);
  });

  it('stands a fountain court composed against a space it can be reached from', () => {
    let related = 0;
    for (const seed of SEEDS) {
      const { state } = build(seed, HEXIA, 1);
      const f = evaluateMap(state).water.fountains;
      if (f.related >= 1) related++;
    }
    // A majority claim: a court needs a flat terrace with room for it and a street within reach, and a
    // seed whose plates offer neither gets no court.
    expect(related, `${related} of ${SEEDS.length} seeds carry a related court`)
      .toBeGreaterThan(SEEDS.length * 0.6);
  });
});
