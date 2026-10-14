import { removeObjectCommand } from '../../../core/model/command-build';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import { enterPlanetSession, leavePlanetSession, sessionPlanet, turnsInSession } from '../../../editor/operations/planet-session';
import { placeSessionLandmark, removeSessionLandmark } from '../../_support/session-landmarks';
import { host } from '../../../editor/host/host';
import { LANDMARKS } from '../../../core/game/profile';
import { CommandType, TerrainType, type MacroCoord } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { validatePlanetTemplate } from '../../../core/model/planet-validate';
import { parseTemplate, serializeTemplate } from '../../../io/save/planet-codec';
import { decodeTemplateRecord, encodeTemplateRecord } from '../../../io/share/codec/template-record';
import { createGridState } from '../../../core/model/template';
import { getMapTemplate } from '../../../config/maps';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';

const STATION = LANDMARKS.find((l) => l.ground === 'coast')!;
const store = () => useEditorStore.getState();

function rect(x0: number, y0: number, w: number, h: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) cells.push({ x, y });
  return cells;
}

function paintGround(cells: MacroCoord[], ground: CellZone.Grass | CellZone.Beach): void {
  const exec = store().commandExecutor!;
  const start = exec.beginStroke();
  exec.execute({ type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 0, ground });
  start.commit();
}

describe('the station in the planet session', () => {
  // Grass rows 40 to 79 and a sand strip on rows 80 to 82, with open sea below.
  beforeEach(() => {
    localStorage.clear();
    newMap(editorPort, 'hexia');
    enterPlanetSession(editorPort, null);
    paintGround(rect(40, 40, 60, 40), CellZone.Grass);
    paintGround(rect(40, 80, 60, 3), CellZone.Beach);
  });
  afterEach(() => { leavePlanetSession(editorPort); host.camera.takeQueued(); });

  it('is on the session shelf beside the plaza and stands with its north edge on the shore', () => {
    const r = placeSessionLandmark({ x: 50.5, y: 82 }, 0, STATION.id);
    expect(r.success).toBe(true);
    expect(store().gridState!.objects.get(STATION.id)).toMatchObject(
      { locked: false, width: STATION.width, height: STATION.height, position: { x: 50.5, y: 82 } },
    );
  });

  it('is refused on grass and out at sea, with the coast refusal', () => {
    const onGrass = placeSessionLandmark({ x: 50.5, y: 70 }, 0, STATION.id);
    expect(onGrass.success).toBe(false);
    expect(onGrass.errors.map((e) => e.message)).toContain('error.landmark_coast');
    const adrift = placeSessionLandmark({ x: 50.5, y: 90 }, 0, STATION.id);
    expect(adrift.success).toBe(false);
    expect(store().gridState!.objects.has(STATION.id)).toBe(false);
  });

  it('is placed at most once, keeps its facing and may be taken off again', () => {
    expect(placeSessionLandmark({ x: 50.5, y: 82 }, 0, STATION.id).success).toBe(true);
    expect(placeSessionLandmark({ x: 70.5, y: 82 }, 0, STATION.id).success).toBe(false);
    expect(turnsInSession(store().gridState!.objects.get(STATION.id), true)).toBe(false);
    expect(removeSessionLandmark(STATION.id).success).toBe(true);
    expect(store().gridState!.objects.has(STATION.id)).toBe(false);
  });

  it('travels with the planet: saved, in a planet file and in a share code', () => {
    expect(placeSessionLandmark({ x: 50.5, y: 82 }, 0, STATION.id).success).toBe(true);
    const t = sessionPlanet(store().gridState!)!.template;
    expect(validatePlanetTemplate(t)).toBeNull();
    const station = t.landmarks.find((l) => l.id === STATION.id)!;
    expect(station).toMatchObject({ width: STATION.width, height: STATION.height });
    expect(station.y + station.height).toBeLessThanOrEqual(t.height);
    expect(parseTemplate(JSON.parse(JSON.stringify(serializeTemplate(t))))).toEqual(t);
    expect(decodeTemplateRecord(encodeTemplateRecord(t))).toEqual(t);
    const back = createGridState(t).objects.get(STATION.id);
    expect(back).toMatchObject({ locked: true, catalogId: STATION.id });
  });
});

describe('the station on a built-in planet', () => {
  it('is locked: removing it is refused and nothing is built over it', () => {
    const state = createGridState(getMapTemplate('tafa'));
    const exec = createExecutor(state, createDefaultRegistry());
    const station = state.objects.get(STATION.id)!;
    const removed = exec.execute(removeObjectCommand(station));
    expect(removed.success).toBe(false);
    expect(removed.errors[0]!.message).toBe('error.locked_immutable');
    const x = Math.ceil(station.position.x) + 2, y = Math.ceil(station.position.y);
    const placed = exec.execute({ type: CommandType.PlaceObject, object: { id: 'f', catalogId: 'flower-daisy', position: { x, y }, rotation: 0, elevation: 0 } });
    expect(placed.success).toBe(false);
  });
});
