/**
 * The relocation planner and its landing: on a visitor's save written before the plaza moved, where
 * a frame of flowerbeds that edged the plaza's old place stands under its new one, and on built maps
 * where a pattern must move whole without taking its neighbours along.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { parseSave } from '../../io/save/parse';
import { decodeSave, serialize } from '../../io/save/json-codec';
import { createDefaultRegistry } from '../../rules';
import { clearUnderLandmarks } from '../../state/landmark-clearance';
import { applyRelocation, isLegalMap, planRelocation, unresolved } from '../../state/relocation-plan';
import { createExecutor } from '../../state/executor';
import { objectRect } from '../../state/object-geometry';
import { createGridState } from '../../core/model/template';
import { templateAnchor } from '../../core/model/landmarks';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { rectsOverlap } from '../../core/grid/rect';
import { getMapTemplate } from '../../config/maps';
import type { GridState, PlacedObject } from '../../core/model/types';

// Each case reads and plans a whole visitor's map, which outlasts the default timeout on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

const FILE = join(__dirname, '..', 'fixtures', 'saves', 'hexia-plaza-frame-1.5.557.json.gz');
const BED = 'path-simple-flowerbed';
/** The save's house whose doorstep faces a rise. */
const HOUSE = 'mut4y2a817yibax';
const rules = createDefaultRegistry;

function loadedSave() {
  const parsed = parseSave(JSON.parse(gunzipSync(readFileSync(FILE)).toString('utf8')));
  const state = decodeSave(parsed);
  const saved = state.objects.size;
  return { state, saved, cleared: clearUnderLandmarks(state, rules(), parsed.landmarksAsSaved) };
}

const ruleIds = (state: GridState) => rules().validatePostStroke(state).map((v) => v.ruleId);
const anchorRect = (state: GridState) => {
  const a = templateAnchor(state.template)!;
  return { x: a.x, y: a.y, w: a.width, h: a.height };
};
const unlockedUnder = (state: GridState) => [...state.objects.values()].filter((o) => !o.locked && rectsOverlap(objectRect(o), anchorRect(state)));
const bed = (id: string, x: number, y: number, catalogId = BED): PlacedObject => ({ id, catalogId, position: { x, y }, rotation: 0, elevation: 0 });

describe('the compatibility report of a save written before the plaza moved', () => {
  it('takes off the 88 flowerbeds under the plaza and the house whose doorstep breaks the door rule, and plans a place for each', () => {
    const { state, saved, cleared } = loadedSave();
    const report = cleared.report!;
    expect(cleared.objects).toBe(89);
    expect(state.objects.size).toBe(saved - 89);
    expect(report.objects).toHaveLength(89);
    const beds = report.objects.filter((o) => o.object.catalogId === BED);
    expect(beds).toHaveLength(88);
    expect(beds.every((o) => o.issue === 'covered')).toBe(true);
    // The save's own fault, a door against a rise, is the current rules' to repair too.
    expect(report.objects.filter((o) => o.object.catalogId !== BED)).toEqual([
      expect.objectContaining({ issue: 'invalid', rule: 'V-PLACE-DOOR', object: expect.objectContaining({ id: HOUSE }) }),
    ]);
    expect(report.landmarks).toEqual([expect.objectContaining({ id: templateAnchor(state.template)!.id, distance: 6, was: expect.anything() })]);
    // Every object is planned, none removed: the beds that framed the plaza move as one with it and
    // the house a cell, to the nearest doorstep that holds.
    expect(report.plan.moves.filter((m) => m.proposal.kind === 'no-place')).toEqual([]);
    const shifts = new Set(report.plan.moves.map((m) => ('shift' in m.proposal ? `${m.proposal.shift.x},${m.proposal.shift.y}` : m.proposal.kind)));
    expect([...shifts]).toEqual(['3,6', '0,-1']);
    expect(report.terrain.every((t) => t.landmark !== undefined)).toBe(true);
    expect(ruleIds(state)).toEqual([]);
  });

  it('applies the plan as one undo step: all 89 placed, none under the plaza, the map legal', () => {
    const { state, saved, cleared } = loadedSave();
    const ex = createExecutor(state, rules());
    expect(applyRelocation(ex, state, cleared.report!.plan)).toEqual({ moved: 89, removed: 0, unplanned: 0 });
    expect(state.objects.size).toBe(saved);
    expect(isLegalMap(state, rules())).toBe(true);
    expect(unlockedUnder(state)).toEqual([]);
    expect(ex.historyDepth()).toBe(1);
    ex.undo();
    expect(state.objects.size).toBe(saved - 89);
    ex.redo();
    expect(state.objects.size).toBe(saved);
  });

  it('keeps each bed\'s author when it is set back', () => {
    const { state, cleared } = loadedSave();
    const id = cleared.report!.objects[0]!.object.id;
    const before = { ...state.provenance!.objectTaint.get(id)! };
    applyRelocation(createExecutor(state, rules()), state, cleared.report!.plan);
    expect(state.provenance!.objectTaint.get(id)).toMatchObject({ createdByOp: before.createdByOp, contribution: before.contribution });
  });

  it('leaves a map with nothing under its landmarks as it was', () => {
    const state = createGridState(getMapTemplate('hexia'));
    expect(clearUnderLandmarks(state, rules())).toEqual({ objects: 0, cells: 0, restored: 0 });
  });
});

describe('a pattern moves whole', () => {
  /**
   * A one-cell ring of beds that framed a plaza standing 3 cells left and 6 up of where the template
   * lays it now, sized so that, moved with the plaza, it frames the new plaza and its raised ground
   * a cell clear on every side.
   */
  function ringed(): { state: GridState; ring: PlacedObject[] } {
    const state = createGridState(getMapTemplate('hexia'));
    const a = anchorRect(state);
    const x0 = Math.floor(a.x) - 2 - 3, x1 = Math.ceil(a.x + a.w) + 1 - 3;
    const y0 = Math.floor(a.y) - 2 - 6, y1 = Math.ceil(a.y + a.h) + 1 - 6;
    const ring: PlacedObject[] = [];
    for (let x = x0; x <= x1; x++) ring.push(bed(`top-${x}`, x, y0), bed(`bottom-${x}`, x, y1));
    for (let y = y0 + 1; y < y1; y++) ring.push(bed(`left-${y}`, x0, y), bed(`right-${y}`, x1, y));
    return { state, ring };
  }
  const place = (state: GridState, objects: PlacedObject[]) => {
    for (const o of objects) state.objects.set(o.id, o);
    bumpObjectsVersion(state, { added: objects });
  };
  const formerPlaza = (state: GridState) => {
    const a = templateAnchor(state.template)!;
    return [{ id: a.id, x: a.x - 3, y: a.y - 6, width: a.width, height: a.height }];
  };

  it('keeps a frame a closed ring, a cell clear of the plaza on every side', () => {
    const { state, ring } = ringed();
    place(state, ring);
    const cleared = clearUnderLandmarks(state, rules(), formerPlaza(state));
    expect(cleared.objects).toBeGreaterThan(0);
    expect(cleared.objects).toBeLessThan(ring.length);
    const plan = cleared.report!.plan;
    expect(plan.moves).toHaveLength(ring.length);
    expect(plan.moves.every((m) => m.proposal.kind === 'pattern-shift' && m.proposal.shift.x === 3 && m.proposal.shift.y === 6)).toBe(true);
    expect(applyRelocation(createExecutor(state, rules()), state, plan)).toEqual({ moved: ring.length, removed: 0, unplanned: 0 });
    for (const o of ring) expect(state.objects.get(o.id)!.position).toEqual({ x: o.position.x + 3, y: o.position.y + 6 });
    const a = anchorRect(state);
    const xs = ring.map((o) => o.position.x + 3), ys = ring.map((o) => o.position.y + 6);
    const gaps = [a.x - (Math.min(...xs) + 1), Math.max(...xs) - (a.x + a.w), a.y - (Math.min(...ys) + 1), Math.max(...ys) - (a.y + a.h)];
    expect(new Set(gaps).size).toBe(1);
    expect(ruleIds(state)).toEqual([]);
  });

  it('leaves the pattern\'s neighbours where they stand: another item touching it, and its own item set apart', () => {
    const { state, ring } = ringed();
    const corner = ring.find((o) => o.id.startsWith('top-'))!;
    const touching = bed('lily', corner.position.x, corner.position.y - 1, 'flower-lily-yellow');
    const apart = bed('apart', corner.position.x, corner.position.y - 3);
    place(state, [...ring, touching, apart]);
    const plan = clearUnderLandmarks(state, rules(), formerPlaza(state)).report!.plan;
    expect(plan.moves.map((m) => m.id).sort()).toEqual(ring.map((o) => o.id).sort());
    applyRelocation(createExecutor(state, rules()), state, plan);
    expect(state.objects.get('lily')!.position).toEqual(touching.position);
    expect(state.objects.get('apart')!.position).toEqual(apart.position);
  });
});

describe('planRelocation', () => {
  /** An open grass cell beside the plaza. */
  function besidePlaza(state: GridState): { x: number; y: number } {
    const a = anchorRect(state);
    return { x: Math.floor(a.x + a.w) + 4, y: Math.floor(a.y) + 4 };
  }

  it('moves the taken objects one at a time when no shift fits them together', () => {
    const state = createGridState(getMapTemplate('hexia'));
    const at = besidePlaza(state);
    // Two beds on one cell touch, so they are one pattern, and no shift lays both.
    const items = [bed('bed-a', at.x, at.y), bed('bed-b', at.x, at.y)].map((object) => ({ object, shift: { x: 0, y: 0 } }));
    const mapOf = (s: GridState) => ({ ...JSON.parse(serialize(s)), metadata: null });
    const before = mapOf(state);
    const plan = planRelocation(state, rules(), items);
    expect(mapOf(state)).toEqual(before);
    expect(plan.moves.map((m) => m.proposal.kind)).toEqual(['single-move', 'single-move']);
    const [a, b] = plan.moves.map((m) => (m.proposal.kind === 'single-move' ? m.proposal.to.position : null));
    expect(a).toEqual(at);
    expect(b).not.toEqual(at);
  });

  it('finds no place for an object the map may hold only one of, and landing the plan leaves it off', () => {
    const { state, cleared } = loadedSave();
    applyRelocation(createExecutor(state, rules()), state, cleared.report!.plan);
    const house = [...state.objects.values()].find((o) => o.catalogId === 'building-myhouse')!;
    const second = { ...house, id: 'second-house', position: { ...house.position } };
    const placed = { ...state.objects.get(house.id)! };
    const plan = planRelocation(state, rules(), [{ object: second, shift: { x: 0, y: 0 } }]);
    expect(plan.moves).toEqual([{ id: 'second-house', group: 0, proposal: { kind: 'no-place' } }]);
    const ex = createExecutor(state, rules());
    expect(applyRelocation(ex, state, plan)).toEqual({ moved: 0, removed: 1, unplanned: 0 });
    expect(state.objects.has('second-house')).toBe(false);
    expect(state.objects.get(house.id)).toEqual(placed);
    expect(ex.historyDepth()).toBe(0);
  });

  it('closes every landing with the full rules around it: what stands against them all the same comes off in the same step', () => {
    const state = createGridState(getMapTemplate('hexia'));
    const at = besidePlaza(state);
    const plan = planRelocation(state, rules(), [{ object: bed('bed-a', at.x, at.y), shift: { x: 0, y: 0 } }]);
    // The map changed after the plan: two trees on one cell beside the spot, which no plan foresaw.
    const stacked = [bed('tree-a', at.x + 2, at.y, 'tree-apple'), bed('tree-b', at.x + 2, at.y, 'tree-apple')];
    for (const o of stacked) state.objects.set(o.id, o);
    bumpObjectsVersion(state, { added: stacked });
    const ex = createExecutor(state, rules());
    expect(applyRelocation(ex, state, plan)).toEqual({ moved: 1, removed: 0, unplanned: 2 });
    expect(stacked.some((o) => state.objects.has(o.id))).toBe(false);
    expect(isLegalMap(state, rules())).toBe(true);
    expect(ex.historyDepth()).toBe(1);
  });

  it('counts an object as repaired once the placement rules accept it where it stands', () => {
    const { state, cleared } = loadedSave();
    const report = cleared.report!;
    const back = report.objects.map((o) => o.object);
    for (const o of back) state.objects.set(o.id, o);
    bumpObjectsVersion(state, { added: back });
    expect(unresolved(state, rules(), back.map((o) => o.id))).toHaveLength(89);
  });
});
