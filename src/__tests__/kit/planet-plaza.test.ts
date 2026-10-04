import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEditorStore } from '../../state/store';
import { newMap } from '../../kit/operations/map';
import {
  enterPlanetSession, leavePlanetSession, finishPlanetSession,
  placeSessionPlaza, rotateSessionPlaza, removeSessionPlaza, turnsInSession,
} from '../../kit/operations/planet-session';
import { host } from '../../kit/host';
import { rotateSessionPlazaAction } from '../../kit/group-edit';
import { PLAZA_ID } from '../../core/model/constants';
import { PLANET_PROFILE } from '../../core/model/game-profile';
import { validatePlanetTemplate } from '../../core/model/planet-validate';
import { CellZone, CommandType, TerrainType, type EditorEvents, type MacroCoord, type ValidationError } from '../../core/model/types';
import { createGridState } from '../../core/model/planet';
import { removeObjectCommand, planObjectMove, planPlacementGhost, ObjectPlacerTool } from '../../tools/objects/object-placer';
import { makeToolCtx } from '../tools/_tool-ctx';

const store = () => useEditorStore.getState();
const plaza = () => store().gridState!.objects.get(PLAZA_ID);

function rect(x0: number, y0: number, w: number, h: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push({ x, y });
  return cells;
}

function paintGround(cells: MacroCoord[]): void {
  const exec = store().commandExecutor!;
  const start = exec.getUndoStackSize();
  exec.execute({ type: CommandType.PaintTerrain, timestamp: 0, cells, terrainType: TerrainType.Mountain, elevation: 0, ground: CellZone.Grass });
  exec.commitStroke(start);
}

const centre = (o: { position: MacroCoord; width?: number; height?: number }) => ({ x: o.position.x + o.width! / 2, y: o.position.y + o.height! / 2 });

describe('plaza in the planet session', () => {
  beforeEach(() => {
    localStorage.clear();
    newMap('hexia');
    enterPlanetSession(null);
    paintGround(rect(10, 10, 60, 60));
  });
  afterEach(() => { leavePlanetSession(); host.camera.takeQueued(); });

  it('places an unlocked plaza on the half-cell grid', () => {
    const r = placeSessionPlaza({ x: 20.5, y: 20 }, 0);
    expect(r.success).toBe(true);
    const p = plaza()!;
    expect(p.position).toEqual({ x: 20.5, y: 20 });
    expect(p).toMatchObject({ catalogId: PLAZA_ID, width: PLANET_PROFILE.landmark.width, height: PLANET_PROFILE.landmark.height, rotation: 0, locked: false });
  });

  it('lays a quarter-turned plaza with its footprint swapped', () => {
    expect(placeSessionPlaza({ x: 20, y: 20 }, 90).success).toBe(true);
    expect(plaza()).toMatchObject({ width: PLANET_PROFILE.landmark.height, height: PLANET_PROFILE.landmark.width, rotation: 90 });
  });

  it('refuses a second plaza', () => {
    placeSessionPlaza({ x: 20.5, y: 20 }, 0);
    const r = placeSessionPlaza({ x: 45, y: 20 }, 0);
    expect(r.success).toBe(false);
    expect(r.errors.map((e) => e.message)).toContain('error.max_count');
    expect(plaza()!.position).toEqual({ x: 20.5, y: 20 });
  });

  it('refuses a plaza over sea', () => {
    const r = placeSessionPlaza({ x: 150, y: 150 }, 0);
    expect(r.success).toBe(false);
    expect(r.errors.map((e) => e.ruleId)).toContain('V-ZONE-01');
    expect(plaza()).toBeUndefined();
  });

  it('rotates about its centre and swaps the footprint', () => {
    placeSessionPlaza({ x: 20.5, y: 20 }, 0);
    const before = centre(plaza()!);
    expect(rotateSessionPlaza().success).toBe(true);
    const p = plaza()!;
    expect(p).toMatchObject({ width: PLANET_PROFILE.landmark.height, height: PLANET_PROFILE.landmark.width, rotation: 90, locked: false });
    const after = centre(p);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
    expect(Number.isInteger(p.position.x * 2) && Number.isInteger(p.position.y * 2)).toBe(true);
  });

  it('turns through all four rotations back to the start', () => {
    placeSessionPlaza({ x: 20.5, y: 20 }, 0);
    for (const r of [90, 180, 270, 0]) {
      expect(rotateSessionPlaza().success).toBe(true);
      expect(plaza()!.rotation).toBe(r);
    }
    expect(plaza()!.position).toEqual({ x: 20.5, y: 20 });
  });

  it('refuses a rotation whose footprint would cover sea and leaves the plaza unchanged', () => {
    leavePlanetSession();
    enterPlanetSession(null);
    paintGround(rect(10, 10, 24, 40));
    expect(placeSessionPlaza({ x: 12, y: 12 }, 0).success).toBe(true);
    const before = { ...plaza()! };
    const undo = store().commandExecutor!.getUndoStackSize();
    const failed: EditorEvents['validation-failed'][] = [];
    const onFail = (e: EditorEvents['validation-failed']) => failed.push(e);
    store().eventBus.on('validation-failed', onFail);
    const r = rotateSessionPlaza();
    expect(failed).toHaveLength(0);
    rotateSessionPlazaAction(store().eventBus);
    store().eventBus.off('validation-failed', onFail);
    expect(r.success).toBe(false);
    expect(r.errors.map((e) => e.ruleId)).toContain('V-ZONE-01');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.errors.map((e) => e.ruleId)).toContain('V-ZONE-01');
    expect(plaza()).toEqual(before);
    expect(store().commandExecutor!.getUndoStackSize()).toBe(undo);
  });

  it('turns an unlocked footprint-turning object only while the session is open', () => {
    placeSessionPlaza({ x: 20.5, y: 20 }, 0);
    const p = plaza()!;
    expect(turnsInSession(p)).toBe(true);
    expect(turnsInSession(p, false)).toBe(false);
    expect(turnsInSession({ ...p, locked: true })).toBe(false);
    expect(turnsInSession({ ...p, id: 'cabin', catalogId: 'building-forest-cabin' })).toBe(false);
    expect(turnsInSession(undefined)).toBe(false);
  });

  it('turns several quarters as one undo step', () => {
    placeSessionPlaza({ x: 20.5, y: 20 }, 0);
    const before = { ...plaza()! };
    const undo = store().commandExecutor!.getUndoStackSize();
    expect(rotateSessionPlaza(3).success).toBe(true);
    expect(plaza()).toMatchObject({ rotation: 270, width: PLANET_PROFILE.landmark.height, height: PLANET_PROFILE.landmark.width });
    expect(store().commandExecutor!.getUndoStackSize()).toBe(undo + 1);
    store().commandExecutor!.undo();
    expect(plaza()).toEqual(before);
  });

  it('plays the spin from the old facing when the action turns the plaza', () => {
    placeSessionPlaza({ x: 20.5, y: 20 }, 0);
    const spin = vi.spyOn(host.feedback, 'spin');
    try {
      rotateSessionPlazaAction(store().eventBus, 2);
      expect(spin).toHaveBeenCalledWith(PLAZA_ID, -180, 0);
    } finally {
      spin.mockRestore();
    }
  });

  it('reports a failure when the post-stroke rules revert an edit', () => {
    const exec = store().commandExecutor!;
    const violation: ValidationError = { ruleId: 'V-TEST', message: 'error.test', cells: [], severity: 'error' };
    const commit = vi.spyOn(exec, 'commitStroke').mockReturnValue([violation]);
    try {
      const placed = placeSessionPlaza({ x: 20.5, y: 20 }, 0);
      expect(placed.success).toBe(false);
      expect(placed.errors).toEqual([violation]);
      expect(placed.cmd?.object.catalogId).toBe(PLAZA_ID);
      expect(rotateSessionPlaza().success).toBe(false);
      expect(removeSessionPlaza().success).toBe(false);
    } finally {
      commit.mockRestore();
    }
  });

  it('undoes a rotation in one step', () => {
    placeSessionPlaza({ x: 20.5, y: 20 }, 0);
    const before = { ...plaza()! };
    rotateSessionPlaza();
    store().commandExecutor!.undo();
    expect(plaza()).toEqual(before);
    store().commandExecutor!.redo();
    expect(plaza()).toMatchObject({ rotation: 90, width: PLANET_PROFILE.landmark.height });
  });

  it('moves on the half-cell grid', () => {
    placeSessionPlaza({ x: 20.5, y: 20 }, 0);
    const exec = store().commandExecutor!, gs = store().gridState!;
    const { cmd, errors } = planObjectMove(exec, gs, plaza()!, 30, 25.5);
    expect(errors).toEqual([]);
    const start = exec.getUndoStackSize();
    exec.execute(removeObjectCommand(plaza()!));
    exec.execute(cmd);
    exec.commitStroke(start);
    expect(plaza()!.position).toEqual({ x: 30, y: 25.5 });
  });

  it('removes the plaza and places it again', () => {
    placeSessionPlaza({ x: 20.5, y: 20 }, 0);
    expect(removeSessionPlaza().success).toBe(true);
    expect(plaza()).toBeUndefined();
    expect(placeSessionPlaza({ x: 30, y: 30 }, 0).success).toBe(true);
    store().commandExecutor!.undo();
    expect(plaza()).toBeUndefined();
  });

  it('the placer lays the armed plaza with its own footprint on the half-cell grid', () => {
    const s = store();
    const ctx = { ...makeToolCtx(s.gridState, s.commandExecutor!, 1, 1, { armedItem: PLAZA_ID }), halfCoord: { x: 20.5, y: 20 } };
    const ghost = planPlacementGhost(PLAZA_ID, { x: 20, y: 20 }, ctx)!;
    expect(ghost.valid).toBe(true);
    expect(ghost.cells).toHaveLength(PLANET_PROFILE.landmark.width * PLANET_PROFILE.landmark.height);
    expect(ghost.bodyElevation).toBeNull();
    new ObjectPlacerTool().onPointerDown({ x: 20, y: 20 }, { x: 40, y: 40 }, ctx);
    expect(plaza()).toMatchObject({ position: { x: 20.5, y: 20 }, width: PLANET_PROFILE.landmark.width, height: PLANET_PROFILE.landmark.height, locked: false });
    expect(planPlacementGhost(PLAZA_ID, { x: 45, y: 20 }, { ...ctx, halfCoord: { x: 45, y: 20 } })!.valid).toBe(false);
  });

  it('finishes with the rotated plaza, locked on the finished map', () => {
    placeSessionPlaza({ x: 20.5, y: 20 }, 0);
    rotateSessionPlaza();
    const p = plaza()!;
    const r = finishPlanetSession('Square');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.template;
    expect(t.plaza).toMatchObject({ width: PLANET_PROFILE.landmark.height, height: PLANET_PROFILE.landmark.width, rotation: 90 });
    expect(t.plaza.x + t.plaza.width).toBeLessThanOrEqual(t.width);
    expect(t.plaza.y + t.plaza.height).toBeLessThanOrEqual(t.height);
    expect(t.plaza.x % 1).toBe(p.position.x % 1);
    expect(validatePlanetTemplate(t)).toBeNull();
    const fresh = createGridState(t).objects.get(PLAZA_ID)!;
    expect(fresh).toMatchObject({ locked: true, rotation: 90, width: PLANET_PROFILE.landmark.height, height: PLANET_PROFILE.landmark.width });
  });
});

describe('plaza outside the planet session', () => {
  beforeEach(() => { localStorage.clear(); newMap('hexia'); });

  it('session plaza operations do nothing on an ordinary map', () => {
    const before = { ...plaza()! };
    expect(placeSessionPlaza({ x: 20, y: 20 }, 0).success).toBe(false);
    expect(rotateSessionPlaza().success).toBe(false);
    expect(removeSessionPlaza().success).toBe(false);
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
