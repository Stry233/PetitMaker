import { removeObjectCommand } from '../../../core/model/command-build';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import { enterPlanetSession, leavePlanetSession, finishPlanetSession, rotateSessionLandmark, turnsInSession } from '../../../editor/operations/planet-session';
import { placeSessionLandmark, removeSessionLandmark } from '../../_support/session-landmarks';
import { host } from '../../../editor/host/host';
import { rotateObjectTo } from '../../../editor/editing/group-edit';
import { ANCHOR_LANDMARK } from '../../_support/anchor';
import { validatePlanetTemplate } from '../../../core/model/planet-validate';
import { CommandType, TerrainType, type MacroCoord, type ValidationError } from '../../../core/model/types';
import { type EditorEvents } from '../../../state/editing/events';
import { CellZone } from '../../../core/game/zones';
import { createGridState } from '../../../core/model/template';
import { ObjectPlacerTool } from '../../../tools/pointer/objects/object-placer';
import { planObjectMove } from '../../../tools/placement/probe';
import { makeToolCtx, placementHover } from '../../_support/tool-ctx';
import { templateAnchor } from '../../../core/model/landmarks';
import { cell, point } from '../../_support/grid';
import { RUN, type CommandContext } from '../../../editor/commands/commands';

const NO_SHELL: CommandContext = { toggleMenu: () => {} };

const store = () => useEditorStore.getState();
const plaza = () => store().gridState!.objects.get(ANCHOR_LANDMARK.id);

function rect(x0: number, y0: number, w: number, h: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push({ x, y });
  return cells;
}

function paintGround(cells: MacroCoord[]): void {
  const exec = store().commandExecutor!;
  const start = exec.beginStroke();
  exec.execute({ type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 0, ground: CellZone.Grass });
  start.commit();
}

const centre = (o: { position: MacroCoord; width?: number; height?: number }) => ({ x: o.position.x + o.width! / 2, y: o.position.y + o.height! / 2 });

describe('plaza in the planet session', () => {
  beforeEach(() => {
    localStorage.clear();
    newMap(editorPort, 'hexia');
    enterPlanetSession(editorPort, null);
    paintGround(rect(10, 10, 60, 60));
  });
  afterEach(() => { leavePlanetSession(editorPort); host.camera.takeQueued(); });

  it('places an unlocked plaza on the half-cell grid', () => {
    const r = placeSessionLandmark({ x: 20.5, y: 20 }, 0);
    expect(r.success).toBe(true);
    const p = plaza()!;
    expect(p.position).toEqual({ x: 20.5, y: 20 });
    expect(p).toMatchObject({ catalogId: ANCHOR_LANDMARK.id, width: ANCHOR_LANDMARK.width, height: ANCHOR_LANDMARK.height, rotation: 0, locked: false });
  });

  it('lays a quarter-turned plaza with its footprint swapped', () => {
    expect(placeSessionLandmark({ x: 20, y: 20 }, 90).success).toBe(true);
    expect(plaza()).toMatchObject({ width: ANCHOR_LANDMARK.height, height: ANCHOR_LANDMARK.width, rotation: 90 });
  });

  it('refuses a second plaza', () => {
    placeSessionLandmark({ x: 20.5, y: 20 }, 0);
    const r = placeSessionLandmark({ x: 45, y: 20 }, 0);
    expect(r.success).toBe(false);
    expect(r.errors.map((e) => e.message)).toContain('error.max_count');
    expect(plaza()!.position).toEqual({ x: 20.5, y: 20 });
  });

  it('refuses a plaza over sea', () => {
    const r = placeSessionLandmark({ x: 150, y: 150 }, 0);
    expect(r.success).toBe(false);
    expect(r.errors.map((e) => e.ruleId)).toContain('V-ZONE-01');
    expect(plaza()).toBeUndefined();
  });

  it('rotates about its centre and swaps the footprint', () => {
    placeSessionLandmark({ x: 20.5, y: 20 }, 0);
    const before = centre(plaza()!);
    expect(rotateSessionLandmark(editorPort).success).toBe(true);
    const p = plaza()!;
    expect(p).toMatchObject({ width: ANCHOR_LANDMARK.height, height: ANCHOR_LANDMARK.width, rotation: 90, locked: false });
    const after = centre(p);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
    expect(Number.isInteger(p.position.x * 2) && Number.isInteger(p.position.y * 2)).toBe(true);
  });

  it('turns through all four rotations back to the start', () => {
    placeSessionLandmark({ x: 20.5, y: 20 }, 0);
    for (const r of [90, 180, 270, 0]) {
      expect(rotateSessionLandmark(editorPort).success).toBe(true);
      expect(plaza()!.rotation).toBe(r);
    }
    expect(plaza()!.position).toEqual({ x: 20.5, y: 20 });
  });

  it('refuses a rotation whose footprint would cover sea and leaves the plaza unchanged', () => {
    leavePlanetSession(editorPort);
    enterPlanetSession(editorPort, null);
    paintGround(rect(10, 10, 24, 40));
    expect(placeSessionLandmark({ x: 12, y: 12 }, 0).success).toBe(true);
    const before = { ...plaza()! };
    const undo = store().commandExecutor!.historyDepth();
    const failed: EditorEvents['validation-failed'][] = [];
    const onFail = (e: EditorEvents['validation-failed']) => failed.push(e);
    store().eventBus.on('validation-failed', onFail);
    const r = rotateSessionLandmark(editorPort);
    expect(failed).toHaveLength(0);
    rotateObjectTo(plaza()!, 90);
    store().eventBus.off('validation-failed', onFail);
    expect(r.success).toBe(false);
    expect(r.errors.map((e) => e.ruleId)).toContain('V-ZONE-01');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.errors.map((e) => e.ruleId)).toContain('V-ZONE-01');
    expect(plaza()).toEqual(before);
    expect(store().commandExecutor!.historyDepth()).toBe(undo);
  });

  it('turns an unlocked footprint-turning object only while the session is open', () => {
    placeSessionLandmark({ x: 20.5, y: 20 }, 0);
    const p = plaza()!;
    expect(turnsInSession(p, true)).toBe(true);
    expect(turnsInSession(p, false)).toBe(false);
    expect(turnsInSession({ ...p, locked: true }, true)).toBe(false);
    expect(turnsInSession({ ...p, id: 'cabin', catalogId: 'building-forest-cabin' }, true)).toBe(false);
    expect(turnsInSession(undefined, true)).toBe(false);
  });

  it('turns several quarters as one undo step', () => {
    placeSessionLandmark({ x: 20.5, y: 20 }, 0);
    const before = { ...plaza()! };
    const undo = store().commandExecutor!.historyDepth();
    expect(rotateSessionLandmark(editorPort, 2).success).toBe(true);
    expect(plaza()).toMatchObject({ rotation: 180, width: ANCHOR_LANDMARK.width, height: ANCHOR_LANDMARK.height });
    expect(store().commandExecutor!.historyDepth()).toBe(undo + 1);
    store().commandExecutor!.undo();
    expect(plaza()).toEqual(before);
  });

  it('plays the spin from the old facing when the action turns the plaza', () => {
    placeSessionLandmark({ x: 20.5, y: 20 }, 0);
    const spin = vi.spyOn(host.feedback, 'spin');
    try {
      rotateObjectTo(plaza()!, 180);
      expect(spin).toHaveBeenCalledWith(ANCHOR_LANDMARK.id, -180, 0);
    } finally {
      spin.mockRestore();
    }
  });

  it('turns a selected plaza a quarter turn back the short way on the counter-clockwise key', () => {
    placeSessionLandmark({ x: 20.5, y: 20 }, 0);
    store().setSelection([{ kind: 'object', id: ANCHOR_LANDMARK.id }]);
    const spin = vi.spyOn(host.feedback, 'spin');
    try {
      RUN['selection.rotate_ccw'](NO_SHELL);
      expect(plaza()!.rotation).toBe(270);
      expect(spin).toHaveBeenCalledWith(ANCHOR_LANDMARK.id, 90, 0);
    } finally {
      spin.mockRestore();
    }
  });

  it('reports a failure when the post-stroke rules revert an edit', () => {
    const exec = store().commandExecutor!;
    const violation: ValidationError = { ruleId: 'V-TEST', message: 'error.test', cells: [], grid: 'object' };
    const commit = vi.spyOn(exec, 'commitStroke').mockReturnValue([violation]);
    try {
      const placed = placeSessionLandmark({ x: 20.5, y: 20 }, 0);
      expect(placed.success).toBe(false);
      expect(placed.errors).toEqual([violation]);
      expect(placed.cmd?.object.catalogId).toBe(ANCHOR_LANDMARK.id);
      expect(rotateSessionLandmark(editorPort).success).toBe(false);
      expect(removeSessionLandmark().success).toBe(false);
    } finally {
      commit.mockRestore();
    }
  });

  it('undoes a rotation in one step', () => {
    placeSessionLandmark({ x: 20.5, y: 20 }, 0);
    const before = { ...plaza()! };
    rotateSessionLandmark(editorPort);
    store().commandExecutor!.undo();
    expect(plaza()).toEqual(before);
    store().commandExecutor!.redo();
    expect(plaza()).toMatchObject({ rotation: 90, width: ANCHOR_LANDMARK.height });
  });

  it('moves on the half-cell grid', () => {
    placeSessionLandmark({ x: 20.5, y: 20 }, 0);
    const exec = store().commandExecutor!, gs = store().gridState!;
    const { cmd, errors } = planObjectMove(exec, gs, plaza()!, 30, 25.5);
    expect(errors).toEqual([]);
    const start = exec.beginStroke();
    exec.execute(removeObjectCommand(plaza()!));
    exec.execute(cmd);
    start.commit();
    expect(plaza()!.position).toEqual({ x: 30, y: 25.5 });
  });

  it('removes the plaza and places it again', () => {
    placeSessionLandmark({ x: 20.5, y: 20 }, 0);
    expect(removeSessionLandmark().success).toBe(true);
    expect(plaza()).toBeUndefined();
    expect(placeSessionLandmark({ x: 30, y: 30 }, 0).success).toBe(true);
    store().commandExecutor!.undo();
    expect(plaza()).toBeUndefined();
  });

  it('the placer lays the armed plaza with its own footprint on the half-cell grid', () => {
    const s = store();
    const ctx = { ...makeToolCtx(s.gridState, s.commandExecutor!, 1, 1, { armedItem: ANCHOR_LANDMARK.id }), point: point({ x: 20.5, y: 20 }) };
    const ghost = placementHover(ANCHOR_LANDMARK.id, { x: 20, y: 20 }, ctx)!;
    expect(ghost.valid).toBe(true);
    expect(ghost.cells).toHaveLength(ANCHOR_LANDMARK.width * ANCHOR_LANDMARK.height);
    expect(ghost.bodyElevation).toBeNull();
    new ObjectPlacerTool().onPointerDown(cell({ x: 20, y: 20 }), point({ x: 40, y: 40 }), ctx);
    expect(plaza()).toMatchObject({ position: { x: 20.5, y: 20 }, width: ANCHOR_LANDMARK.width, height: ANCHOR_LANDMARK.height, locked: false });
    expect(placementHover(ANCHOR_LANDMARK.id, { x: 45, y: 20 }, { ...ctx, point: point({ x: 45, y: 20 }) })!.valid).toBe(false);
  });

  it('finishes with the rotated plaza, locked on the finished map', () => {
    placeSessionLandmark({ x: 20.5, y: 20 }, 0);
    rotateSessionLandmark(editorPort);
    const p = plaza()!;
    const r = finishPlanetSession(editorPort, 'Square');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.template;
    expect(templateAnchor(t)!).toMatchObject({ width: ANCHOR_LANDMARK.height, height: ANCHOR_LANDMARK.width, rotation: 90 });
    expect(templateAnchor(t)!.x + templateAnchor(t)!.width).toBeLessThanOrEqual(t.width);
    expect(templateAnchor(t)!.y + templateAnchor(t)!.height).toBeLessThanOrEqual(t.height);
    expect(templateAnchor(t)!.x % 1).toBe(p.position.x % 1);
    expect(validatePlanetTemplate(t)).toBeNull();
    const fresh = createGridState(t).objects.get(ANCHOR_LANDMARK.id)!;
    expect(fresh).toMatchObject({ locked: true, rotation: 90, width: ANCHOR_LANDMARK.height, height: ANCHOR_LANDMARK.width });
  });
});

describe('plaza outside the planet session', () => {
  beforeEach(() => { localStorage.clear(); newMap(editorPort, 'hexia'); });

  it('session plaza operations do nothing on an ordinary map', () => {
    const before = { ...plaza()! };
    expect(placeSessionLandmark({ x: 20, y: 20 }, 0).success).toBe(false);
    expect(rotateSessionLandmark(editorPort).success).toBe(false);
    expect(removeSessionLandmark().success).toBe(false);
    expect(plaza()).toEqual(before);
  });

  it('the finished map still refuses removing or moving the plaza', () => {
    const exec = store().commandExecutor!;
    const p = plaza()!;
    expect(p.locked).toBe(true);
    expect(exec.execute(removeObjectCommand(p)).errors.map((e) => e.ruleId)).toContain('V-LOCK-02');
    expect(plaza()).toEqual(p);
  });

  it('refuses dragging the locked plaza on a finished map', () => {
    const exec = store().commandExecutor!;
    const p = plaza()!;
    const { errors } = planObjectMove(exec, store().gridState!, p, p.position.x + 1, p.position.y);
    expect(errors.map((e) => e.ruleId)).toContain('V-LOCK-02');
    expect(plaza()).toEqual(p);
  });
});
