import { describe, it, expect } from 'vitest';
import { encodeHistory, decodeHistory } from '../../../io/save/history-codec';
import { makeState, makeExecutor, makeTemplate } from '../../_support/map-state';
import { CommandType, TerrainType, type GridState, type PlaceObjectCommand, type TrimCornersCommand } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { getCatalogItem } from '../../../state/catalog';
import { createPlanetRegistry } from '../../../rules';
import { ProvSource, TaintFlag, hasFlag } from '../../../core/provenance/types';
import { ANCHOR_LANDMARK } from '../../_support/anchor';
import { resolveTemplate } from '../../../config/maps/resolve';
import { createGridState } from '../../../core/model/template';
import { inspectImportFile } from '../../../io/import/file';
import { carrying, serializeWithSections } from '../../../io/save/sections';
import type { CommandExecutor } from '../../../core/commands/command-executor';
import type { HistoryEntry } from '../../../core/commands/command-apply';
import { exportable } from '../../_support/exportable';

/** The history section version this build writes. */
const HISTORY_V = encodeHistory([], 'all').v;

const T = makeTemplate(12, 12);

function editedExecutor() {
  const state = makeState(12, 12);
  const exec = makeExecutor(state);
  // Execute 5 commands without commitStroke so they remain as separate undo entries
  for (let i = 0; i < 5; i++) {
    exec.execute({ type: CommandType.PaintTerrain, cells: [{ x: 2 + i, y: 3 }], terrainType: TerrainType.Mountain, elevation: 1 });
  }
  // Do not call commitStroke — keep entries uncollapsed for testing the codec
  return { state, exec };
}

describe('history codec', () => {
  it('encodes the undo stack and JSON round-trips it', () => {
    const { exec } = editedExecutor();
    const entries = exec.getUndoEntries();
    expect(entries.length).toBeGreaterThanOrEqual(5);
    const section = encodeHistory(entries, 'all');
    expect(section.totalSteps).toBe(entries.length);
    const back = decodeHistory(JSON.parse(JSON.stringify(section)), T);
    expect(back).not.toBeNull();
    expect(back!.length).toBe(entries.length);
  });
  it('writes commands without a time stamp and still reads saves whose commands carry one', () => {
    const { exec } = editedExecutor();
    const written = JSON.stringify(encodeHistory(exec.getUndoEntries(), 'all'));
    expect(written).not.toContain('timestamp');
    const old = JSON.parse(written) as { entries: { cmd: Record<string, unknown> }[] };
    for (const e of old.entries) e.cmd = { type: e.cmd.type, timestamp: 1700000000000, ...e.cmd };
    const back = decodeHistory(old, T);
    expect(back).toHaveLength(5);
    expect(JSON.stringify(encodeHistory(back!, 'all'))).toBe(written);
  });
  it('depth N keeps only the most recent N steps', () => {
    const { exec } = editedExecutor();
    const section = encodeHistory(exec.getUndoEntries(), 2);
    expect(section.entries.length).toBe(2);
    expect(section.totalSteps).toBeGreaterThanOrEqual(5);
  });
  it('restoreHistory seeds a FRESH executor so undo reverts the imported edits', () => {
    const { state, exec } = editedExecutor();
    const entries = decodeHistory(JSON.parse(JSON.stringify(encodeHistory(exec.getUndoEntries(), 'all'))), T)!;
    // Fresh executor over the same (already edited) state — like after an import.
    const fresh = makeExecutor(state);
    expect(fresh.canUndo()).toBe(false);
    fresh.restoreHistory(entries);
    expect(fresh.canUndo()).toBe(true);
    fresh.undo();
    expect(state.cells[3]![6]!.terrain).toBeNull(); // last SetTerrain reverted
    expect(state.cells[3]![2]!.terrain).not.toBeNull(); // earlier ones intact
  });
  it('gives a road corner trim from an older save its road before and after, so undo and redo restore it', () => {
    const state = makeState(12, 12);
    const exec = makeExecutor(state);
    const road = { id: 'r-1', catalogId: 'path-overgrown-dirt', position: { x: 4, y: 4 }, rotation: 0 as const, elevation: 0 };
    const placed = structuredClone(road);
    const afterFirst = { ...placed, corners: ['fan', 'square', 'square', 'square'] };
    exec.execute({ type: CommandType.PlaceObject, object: road });
    const first: TrimCornersCommand = { type: CommandType.TrimCorners, x: 4, y: 4, layer: 'road', objectId: road.id, afterCorners: ['fan', 'square', 'square', 'square'] };
    const second: TrimCornersCommand = { type: CommandType.TrimCorners, x: 4, y: 4, layer: 'road', objectId: road.id, afterCorners: ['fan', 'fan', 'square', 'square'], afterRotation: 90 };
    exec.execute(first);
    exec.execute(second);
    const final = structuredClone(state.objects.get(road.id)!);
    // The wire older builds wrote: no object ops on single steps, the trim's before-state on its command.
    const legacy = JSON.parse(JSON.stringify(encodeHistory(exec.getUndoEntries(), 'all'))) as { entries: { cmd: Record<string, unknown>; objectOps?: unknown }[] };
    for (const e of legacy.entries) delete e.objectOps;
    Object.assign(legacy.entries[2]!.cmd, { beforeCorners: first.afterCorners, beforeRotation: 0 });

    const fresh = makeExecutor(state);
    fresh.restoreHistory(decodeHistory(legacy, T, state.objects)!);
    fresh.undo();
    expect(state.objects.get(road.id)).toEqual(afterFirst);
    fresh.undo();
    expect(state.objects.get(road.id)).toEqual(placed);
    fresh.redo();
    fresh.redo();
    expect(state.objects.get(road.id)).toEqual(final);
  });
  it('gives a placement and a removal from an older save their objects, and drops the legacy fields', () => {
    const state = makeState(12, 12);
    const exec = makeExecutor(state);
    const tree = { id: 't-1', catalogId: 'path-overgrown-dirt', position: { x: 6, y: 6 }, rotation: 0 as const, elevation: 0 };
    exec.execute({ type: CommandType.PlaceObject, object: tree });
    exec.execute({ type: CommandType.RemoveObject, objectId: tree.id });
    const wire = JSON.parse(JSON.stringify(encodeHistory(exec.getUndoEntries(), 'all'))) as { entries: { cmd: Record<string, unknown>; objectOps?: unknown }[] };
    expect(wire.entries[1]!.cmd.removedObject, 'older builds read the removed object off the command').toEqual(tree);
    for (const e of wire.entries) delete e.objectOps;

    const decoded = decodeHistory(wire, T, state.objects)!;
    expect(decoded.map((e) => e.objectOps)).toEqual([{ removed: [], added: [tree] }, { removed: [tree], added: [] }]);
    expect(decoded[1]!.cmd).toEqual({ type: CommandType.RemoveObject, objectId: tree.id });
    const fresh = makeExecutor(state);
    fresh.restoreHistory(decoded);
    fresh.undo();
    expect(state.objects.get(tree.id)).toEqual(tree);
    fresh.undo();
    expect(state.objects.has(tree.id)).toBe(false);
  });
  it('decodeHistory fails safe on wrong version / malformed input', () => {
    const { exec } = editedExecutor();
    const good = encodeHistory(exec.getUndoEntries(), 'all');
    expect(decodeHistory({ ...good, v: 99 }, T)).toBeNull();
    expect(decodeHistory(null, T)).toBeNull();
    expect(decodeHistory({ v: 1, totalSteps: 1, entries: [{ nope: true }] }, T)).toBeNull();
  });

  it('collapsed-entry round-trip: place object → commitStroke → encode → decode → restore → undo removes it', () => {
    const { state: originalState, exec: originalExec } = editedExecutor();

    // Place an object and collapse it into a single undo entry via commitStroke
    const startSize = originalExec.beginStroke();
    const obj = {
      id: 'test-obj-1', catalogId: 'path-overgrown-dirt',
      position: { x: 5, y: 5 }, rotation: 0, elevation: 0,
    };
    const item = getCatalogItem('path-overgrown-dirt');
    const placeResult = originalExec.execute({
      type: CommandType.PlaceObject,       object: obj, loadValue: item?.loadValue ?? 0,
    } as PlaceObjectCommand);
    expect(placeResult.success).toBe(true);
    expect(originalState.objects.has(obj.id)).toBe(true);

    // Collapse into one entry
    startSize.commit();
    expect(startSize.size).toBe(1); // collapsed to one

    // Encode all undo entries, JSON round-trip, and decode
    const entries = originalExec.getUndoEntries();
    const section = encodeHistory(entries, 'all');
    const decoded = decodeHistory(JSON.parse(JSON.stringify(section)), T);
    expect(decoded).not.toBeNull();
    expect(decoded!.length).toBe(entries.length);

    // Create a fresh executor over the same (already edited) state and restore history
    const freshExec = makeExecutor(originalState);
    expect(freshExec.canUndo()).toBe(false); // fresh executor has no history yet

    freshExec.restoreHistory(decoded!);
    expect(freshExec.canUndo()).toBe(true);

    // One undo should remove the placed object (the collapsed entry reverts everything)
    freshExec.undo();
    expect(originalState.objects.has(obj.id)).toBe(false); // object removed
  });

  it('keeps a step that placed a half-anchored ramp, drops one that placed a half-anchored tree', () => {
    // Undo replays this data verbatim, so the gate is the same one the map loader applies: a
    // halfStep item may stand on the half grid, nothing else may. One bad object drops the whole
    // section, so a gate that refused a ramp at 5.5 would cost the user their entire step history
    // on re-import.
    const section = (catalogId: string, x: number) => ({
      v: HISTORY_V,
      totalSteps: 1,
      entries: [{
        cmd: {
          type: CommandType.PlaceObject, loadValue: 0,
          object: { id: 'o', catalogId, position: { x, y: 5 }, rotation: 0, elevation: 0 },
        },
        before: [], after: [],
      }],
    });

    const kept = decodeHistory(section('ramp-plank', 5.5), T);
    expect(kept).not.toBeNull();
    expect((kept![0]!.cmd as PlaceObjectCommand).object.position).toEqual({ x: 5.5, y: 5 });

    expect(decodeHistory(section('tree-ginkgo', 5.5), T)).toBeNull();
    expect(decodeHistory(section('ramp-plank', 5.25), T)).toBeNull();
    expect(decodeHistory(section('ramp-plank', 5), T)).not.toBeNull();
  });

  it('decodeHistory rejects objectOps with non-array removed or added', () => {
    const malformed = {
      v: HISTORY_V,
      totalSteps: 1,
      entries: [{
        cmd: { type: CommandType.PaintTerrain, cells: [], terrainType: TerrainType.Mountain, elevation: 1 },
        before: [],
        after: [],
        objectOps: { added: 'nope' }, // should be an array
      }],
    };
    expect(decodeHistory(malformed, T)).toBeNull();
  });

  it('decodeHistory rejects objectOps that is not an object', () => {
    const malformed = {
      v: HISTORY_V,
      totalSteps: 1,
      entries: [{
        cmd: { type: CommandType.PaintTerrain, cells: [], terrainType: TerrainType.Mountain, elevation: 1 },
        before: [],
        after: [],
        objectOps: null, // should be an object with arrays
      }],
    };
    expect(decodeHistory(malformed, T)).toBeNull();
  });
});

describe('a real executor history round-trips', () => {
  /** Strokes of every kind the history carries: terrain, a gamma fillet, a road and its corner
   *  trim, a ground command, AI-sourced work for taint. */
  function richHistory(): { state: GridState; exec: CommandExecutor } {
    const state = makeState(12, 12);
    const exec = makeExecutor(state, createPlanetRegistry());
    const stroke = (fn: () => void) => { const start = exec.beginStroke(); fn(); start.commit(); };
    stroke(() => exec.execute(
      { type: CommandType.PaintTerrain, cells: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }], terrainType: TerrainType.Mountain, elevation: 1 },
    ));
    stroke(() => expect(exec.execute({
      type: CommandType.TrimCorners, x: 3, y: 3, layer: 'terrain',
      afterCorners: ['fan', 'square', 'square', 'square'], patchOnly: true, terrainType: TerrainType.Mountain, elevation: 1, patchBase: 0,
    } as TrimCornersCommand).success).toBe(true));
    const road = { id: 'road1', catalogId: 'path-overgrown-dirt', position: { x: 8, y: 8 }, rotation: 0 as const, elevation: 0 };
    stroke(() => expect(exec.execute({ type: CommandType.PlaceObject, object: road }).success).toBe(true));
    const start = exec.beginStroke();
    expect(exec.execute({ type: CommandType.TrimCorners, x: 8, y: 8, layer: 'road', objectId: road.id, afterCorners: ['fan', 'square', 'square', 'square'] }).success).toBe(true);
    start.commit({ reconcile: false });
    stroke(() => expect(exec.execute(
      { type: CommandType.PaintTerrain, cells: [{ x: 6, y: 2 }], terrainType: TerrainType.Mountain, elevation: 0, ground: CellZone.Grass },
    ).success).toBe(true));
    exec.transaction({ source: { source: ProvSource.AiWrite, ai: { model: 'm' } } }, () =>
      stroke(() => exec.execute({ type: CommandType.PaintTerrain, cells: [{ x: 9, y: 2 }], terrainType: TerrainType.Mountain, elevation: 1 })));
    return { state, exec };
  }

  it('decodes to the entries it encoded, and undo and redo replay them', () => {
    const { state, exec } = richHistory();
    const wire = JSON.parse(JSON.stringify(encodeHistory(exec.getUndoEntries(), 'all')));
    const decoded = decodeHistory(structuredClone(wire), state.template);
    expect(decoded).toEqual(wire.entries);
    expect(decoded!.some((e) => e.taint && e.taint.cells.length > 0)).toBe(true);

    const edited = structuredClone({ cells: state.cells, objects: [...state.objects.entries()] });
    const fresh = makeExecutor(state, createPlanetRegistry());
    fresh.restoreHistory(decoded!);
    while (fresh.canUndo()) fresh.undo();
    expect(state.objects.size).toBe(0);
    expect(state.cells.flat().every((c) => c.terrain === null)).toBe(true);
    while (fresh.canRedo()) fresh.redo();
    expect({ cells: state.cells, objects: [...state.objects.entries()] }).toEqual(edited);
  });
});

describe('a crafted history is dropped whole', () => {
  const template = resolveTemplate(undefined);
  const find = (want: (zone: CellZone) => boolean) => {
    for (let y = 2; y < template.height; y++) for (let x = 2; x < template.width; x++) if (want(template.zones[y]![x]!)) return { x, y };
    throw new Error('no such cell');
  };
  const at = find((z) => z === CellZone.Grass);
  const sea = find((z) => z === CellZone.Void);
  const grass = { zone: CellZone.Grass, terrain: null };
  const obj = (over: Record<string, unknown> = {}) => ({ id: 'p1', catalogId: 'path-overgrown-dirt', position: { ...at }, rotation: 0, elevation: 0, ...over });
  const erase = (before: unknown[], extra: Record<string, unknown> = {}) => ({
    cmd: { type: CommandType.EraseTerrain, cells: [at] }, before, after: [{ coord: at, cell: grass }], ...extra
  });
  const trim = (over: Record<string, unknown>) => ({ cmd: { type: CommandType.TrimCorners, x: at.x, y: at.y, layer: 'terrain', afterCorners: ['fan', 'square', 'square', 'square'], ...over }, before: [], after: [] });
  const goodTaint = { createdByOp: 'op', lastModifiedByOp: 'op', origin: ProvSource.Human, contribution: { ai: 0, human: 1, procedural: 0 }, flags: 0 };

  const cases: Record<string, unknown> = {
    'a removal naming a landmark while carrying another object': { cmd: { type: CommandType.RemoveObject, objectId: ANCHOR_LANDMARK.id, removedObject: obj() }, before: [], after: [] },
    'a placement under a landmark id': { cmd: { type: CommandType.PlaceObject, object: obj({ id: ANCHOR_LANDMARK.id }) }, before: [], after: [] },
    'a placement of a landmark item': { cmd: { type: CommandType.PlaceObject, object: obj({ id: 'p2', catalogId: ANCHOR_LANDMARK.id }) }, before: [], after: [] },
    'a placement of a locked object': { cmd: { type: CommandType.PlaceObject, object: obj({ locked: true }) }, before: [], after: [] },
    'an object id outside the emitted alphabet': { cmd: { type: CommandType.PlaceObject, object: obj({ id: 'a b' }) }, before: [], after: [] },
    'a zone that is not a zone': erase([{ coord: at, cell: { zone: 'lava', terrain: null } }]),
    'a zone the template does not hold there': { cmd: { type: CommandType.EraseTerrain, cells: [] }, before: [{ coord: sea, cell: grass }], after: [] },
    'ground kept under a rim other than sand': erase([{ coord: at, cell: { ...grass, under: CellZone.Void } }]),
    'corners that are not four known trims': erase([{ coord: at, cell: { zone: CellZone.Grass, terrain: { type: TerrainType.Mountain, elevation: 1, corners: 5 } } }]),
    'an unknown corner trim': erase([{ coord: at, cell: { zone: CellZone.Grass, terrain: { type: TerrainType.Mountain, elevation: 1, corners: ['fan', 'square', 'square', 'wedge'] } } }]),
    'a trim on an unknown layer': trim({ layer: 'sky' }),
    'a trim without after corners': trim({ afterCorners: undefined }),
    'a trim off the map': trim({ x: -1 }),
    'a trim with an out-of-range patch base': trim({ patchBase: 99 }),
    'a trim with a rotation that is no quarter turn': trim({ layer: 'road', objectId: 'p1', afterRotation: 45 }),
    'a paint with an unknown terrain type': { cmd: { type: CommandType.PaintTerrain, cells: [at], terrainType: 7, elevation: 1 }, before: [], after: [] },
    'a paint writing the retired plaza zone': { cmd: { type: CommandType.PaintTerrain, cells: [at], terrainType: TerrainType.Mountain, elevation: 0, ground: 3 as CellZone }, before: [], after: [] },
    'a paint over cells off the map': { cmd: { type: CommandType.EraseTerrain, cells: [{ x: 1e6, y: 0 }] }, before: [], after: [] },
    'an unknown command type': { cmd: { type: 'Teleport', timestamp: 0 }, before: [], after: [] },
    'a taint delta without lists': erase([], { taint: {} }),
    'a taint delta on a cell off the map': erase([], { taint: { cells: [{ x: -1, y: 0, before: null, after: goodTaint }], objects: [], opIds: [] } }),
    'a taint unit that is not a record': erase([], { taint: { cells: [{ x: at.x, y: at.y, before: 'human', after: null }], objects: [], opIds: [] } }),
  };

  it.each(Object.entries(cases))('%s', async (_name, entry) => {
    const base = createGridState(template);
    const json = JSON.parse(serializeWithSections(exportable(base), { carry: carrying('annotations', 'notes', 'provenance', 'history'), pretty: false, history: { entries: [], depth: 'all' } }));
    json.history = { v: HISTORY_V, totalSteps: 1, entries: [entry] };
    const inspection = await inspectImportFile(new Blob([JSON.stringify(json)], { type: 'application/json' }), 'map.json');
    if (inspection.status !== 'ready') throw new Error(`inspection ${inspection.status}`);
    let state!: GridState; let exec!: CommandExecutor;
    const out = inspection.commit({
      loadMap: (s) => { state = s; exec = makeExecutor(s); },
      getSectionDeps: () => ({ executor: exec, state, setLayerLocked: () => {}, setCamera: () => {} }),
    });
    expect(out.status === 'imported' && out.warnings).toContainEqual({ kind: 'dropped-section', section: 'history' });
    expect(exec.canUndo()).toBe(false);
    expect(state.objects.has(ANCHOR_LANDMARK.id)).toBe(true);
  });

  it('a removal whose id matches the object it carries is kept', () => {
    const entry = { cmd: { type: CommandType.RemoveObject, objectId: 'p1', removedObject: obj() }, before: [], after: [] };
    expect(decodeHistory({ v: HISTORY_V, totalSteps: 1, entries: [entry] }, template)).toHaveLength(1);
  });
});

describe('history taint is read like the saved provenance record', () => {
  it('a forged unit reads Unknown with clamped shares', () => {
    const forged = { createdByOp: 'x'.repeat(5000), lastModifiedByOp: 'op', origin: 'forged', contribution: { ai: -5, human: 7, procedural: 0 }, flags: 0 };
    const entry: HistoryEntry = {
      cmd: { type: CommandType.EraseTerrain, cells: [] }, before: [], after: [],
      taint: { cells: [{ x: 1, y: 1, before: null, after: forged as never }], objects: [{ id: 'ghost', before: null, after: forged as never }], opIds: ['op'] },
    };
    const [decoded] = decodeHistory(JSON.parse(JSON.stringify(encodeHistory([entry], 'all'))), T)!;
    for (const unit of [decoded!.taint!.cells[0]!.after!, decoded!.taint!.objects[0]!.after!]) {
      expect(unit.origin).toBe(ProvSource.Unknown);
      expect(hasFlag(unit.flags, TaintFlag.UNKNOWN)).toBe(true);
      expect(unit.contribution).toEqual({ ai: 0, human: 0, procedural: 0 });
      expect(unit.createdByOp.length).toBeLessThanOrEqual(64);
    }
  });
});
