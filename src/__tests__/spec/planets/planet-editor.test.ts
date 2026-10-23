/** The planet editor: the ground a planet is drawn on, and the landmarks standing on it. */
import { afterEach, beforeEach, describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { useEditorStore } from '../../../state/store';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import { enterPlanetSession, leavePlanetSession } from '../../../editor/operations/planet-session';
import { host } from '../../../editor/host/host';
import { CellZone, type GroundZone } from '../../../core/game/zones';
import { CommandType, TerrainType, type MacroCoord } from '../../../core/model/types';
import { placeSessionLandmark } from '../../_support/session-landmarks';
import { ANCHOR_LANDMARK } from '../../_support/anchor';
import { rect } from '../_world';

const store = () => useEditorStore.getState();

/** One stroke of the planet editor's ground brush: `ground` laid flat over `cells`, or sea erased back. */
function brush(cells: MacroCoord[], ground: GroundZone | typeof CellZone.Void) {
  const executor = store().commandExecutor!;
  const stroke = executor.beginStroke();
  const result = ground === CellZone.Void
    ? executor.execute({ type: CommandType.EraseTerrain, cells, ground })
    : executor.execute({ type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 0, ground });
  stroke.commit();
  return result;
}

const zoneAt = (c: MacroCoord) => store().gridState!.cells[c.y]![c.x]!.zone;

beforeEach(() => { localStorage.clear(); newMap(editorPort, 'hexia'); enterPlanetSession(editorPort, null); });
afterEach(() => { leavePlanetSession(editorPort); host.camera.takeQueued(); });

describe('the planet editor', () => {
  spec('PLAN-16', 'keeps the ground under a placed landmark as it is', () => {
    expect(brush(rect({ x: 10, y: 10 }, 60, 60), CellZone.Grass).success).toBe(true);
    expect(placeSessionLandmark({ x: 20.5, y: 20 }, 0).success).toBe(true);
    const plaza = store().gridState!.objects.get(ANCHOR_LANDMARK.id)!;
    const under = rect({ x: Math.ceil(plaza.position.x) + 2, y: Math.ceil(plaza.position.y) + 2 }, 2, 2);

    for (const ground of [CellZone.Void, CellZone.Beach] as const) {
      const result = brush(under, ground);
      expect(result.success, `brush ${ground}`).toBe(false);
      expect(result.errors.map((e) => e.ruleId)).toContain('V-PLANET-01');
      expect(under.every((c) => zoneAt(c) === CellZone.Grass)).toBe(true);
    }

    const clear = rect({ x: 60, y: 60 }, 2, 2);
    expect(brush(clear, CellZone.Void).success).toBe(true);
    expect(clear.every((c) => zoneAt(c) !== CellZone.Grass)).toBe(true);
  });
});
