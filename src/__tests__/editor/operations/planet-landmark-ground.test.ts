import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import { enterPlanetSession, leavePlanetSession, rotateSessionLandmark, sessionPlanet } from '../../../editor/operations/planet-session';
import { placeSessionLandmark, removeSessionLandmark } from '../../_support/session-landmarks';
import { host } from '../../../editor/host/host';
import { LANDMARKS } from '../../../core/game/profile';
import { ANCHOR_LANDMARK } from '../../_support/anchor';
import { templateAnchor } from '../../../core/model/landmarks';
import { createGridState } from '../../../core/model/template';
import { isTrustedPlanet } from '../../../core/model/planet-validate';
import { CommandType, TerrainType, type MacroCoord, type MapTemplate } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { getCatalogItem } from '../../../state/catalog';
import { objectElevation, resolveAnchor } from '../../../state/object-geometry';
import { planObjectMove } from '../../../tools/placement/probe';
import { parseTemplate, readPlanetFile, serializeTemplate, writePlanetFile } from '../../../io/save/planet-codec';
import { decodeTemplateRecord, encodeTemplateRecord } from '../../../io/share/codec/template-record';
import { serialize } from '../../../io/save/json-codec';
import { deserialize } from '../../_support/save-file';

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

/** The cells of the session holding a mountain, as `x,y` keys. */
function mountains(): Set<string> {
  const out = new Set<string>();
  store().gridState!.cells.forEach((row, y) => row.forEach((c, x) => { if (c.terrain?.type === TerrainType.Mountain) out.add(`${x},${y}`); }));
  return out;
}


/** Drags session landmark `id` so its top-left lands at `to`, through the plan and the stroke a pointer drop runs. */
function drag(id: string, to: MacroCoord): boolean {
  const exec = store().commandExecutor!;
  const gs = store().gridState!;
  const obj = gs.objects.get(id)!;
  const { cmd, errors } = planObjectMove(exec, gs, obj, to.x, to.y);
  if (errors.length > 0) return false;
  const start = exec.beginStroke();
  exec.execute({ type: CommandType.RemoveObject, objectId: obj.id });
  const placed = exec.execute(cmd).success;
  return start.commit().length === 0 && placed;
}

describe('landmarks in the planet session', () => {
  // Grass rows 40 to 99 and a sand strip on rows 100 to 102, with open sea below.
  beforeEach(() => {
    localStorage.clear();
    newMap(editorPort, 'hexia');
    enterPlanetSession(editorPort, null);
    paintGround(rect(40, 40, 80, 60), CellZone.Grass);
    paintGround(rect(40, 100, 80, 3), CellZone.Beach);
  });
  afterEach(() => { leavePlanetSession(editorPort); host.camera.takeQueued(); });

  it('anchor the plaza and the station on half cells, as ramps do', () => {
    for (const id of [ANCHOR_LANDMARK.id, STATION.id]) {
      const item = getCatalogItem(id)!;
      expect(resolveAnchor(item, { x: 50, y: 50 }, { x: 50.5, y: 50.5 }), id).toEqual({ x: 50.5, y: 50.5 });
    }
  });

  it('place the plaza on flat ground at layer 0, laying no terrain', () => {
    expect(placeSessionLandmark({ x: 50.5, y: 45.5 }, 0).success).toBe(true);
    const plaza = store().gridState!.objects.get(ANCHOR_LANDMARK.id)!;
    expect(mountains().size).toBe(0);
    expect(objectElevation(store().gridState!, plaza)).toBe(0);
  });

  it('move and turn the plaza in half cells, leaving the terrain as it is', () => {
    expect(placeSessionLandmark({ x: 50, y: 45 }, 0).success).toBe(true);
    expect(drag(ANCHOR_LANDMARK.id, { x: 50.5, y: 45 })).toBe(true);
    expect(store().gridState!.objects.get(ANCHOR_LANDMARK.id)!.position).toEqual({ x: 50.5, y: 45 });
    expect(rotateSessionLandmark(editorPort, 1).success).toBe(true);
    expect(mountains().size).toBe(0);
    store().commandExecutor!.undo();
    store().commandExecutor!.undo();
    expect(store().gridState!.objects.get(ANCHOR_LANDMARK.id)!.position).toEqual({ x: 50, y: 45 });
    expect(removeSessionLandmark().success).toBe(true);
    expect(mountains().size).toBe(0);
  });

  it('move the station half a cell along the coast, with no support beneath it', () => {
    expect(placeSessionLandmark({ x: 60, y: 102 }, 0, STATION.id).success).toBe(true);
    expect(drag(STATION.id, { x: 60.5, y: 102 })).toBe(true);
    const station = store().gridState!.objects.get(STATION.id)!;
    expect(station.position).toEqual({ x: 60.5, y: 102 });
    expect(objectElevation(store().gridState!, station)).toBe(0);
    expect(mountains().size).toBe(0);
  });

  it('save half-cell landmarks that load, share and round-trip where they were placed', () => {
    expect(placeSessionLandmark({ x: 50.5, y: 45.5 }, 0).success).toBe(true);
    expect(placeSessionLandmark({ x: 60.5, y: 101.5 }, 0, STATION.id).success).toBe(true);
    const t = sessionPlanet(store().gridState!)!.template;
    expect(isTrustedPlanet(t)).toBe(true);
    const plaza = templateAnchor(t)!;
    const station = t.landmarks.find((l) => l.id === STATION.id)!;
    expect([plaza.x % 1, plaza.y % 1, station.x % 1, station.y % 1]).toEqual([0.5, 0.5, 0.5, 0.5]);
    const same = (u: MapTemplate) => {
      expect(u.id).toBe(t.id);
      expect(u.landmarks).toEqual(t.landmarks);
      expect(u.terrain).toEqual(t.terrain);
    };
    same(parseTemplate(JSON.parse(JSON.stringify(serializeTemplate(t)))));
    same(readPlanetFile(writePlanetFile('Bay', t)).template);
    same(decodeTemplateRecord(encodeTemplateRecord(t)));
    const map = createGridState(t);
    const back = deserialize(serialize(map), t);
    expect(back.objects.get(ANCHOR_LANDMARK.id)).toMatchObject({ position: { x: plaza.x, y: plaza.y } });
    expect(back.cells).toEqual(map.cells);
  });
});
