/** The edit slice's policies that ride inside one update: the session's modes, a floor press leaving
 *  annotate, a region request moving the tool it does not offer, and the road families' memory. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { modeOpenIn, modesInSession } from '../../../state/editing/edit-mode';
import { SESSION_BUILD_MODES, type PlanetSession } from '../../../state/slices/planet-session';
import { resetStore, setStoreState } from '../../_support/store';
import { regionRequestOf } from '../../../state/editing/region';
import { DEFAULT_REGION_REQUEST } from '../../../state/editing/vocabulary';
import { getRoadMaterials } from '../../../state/catalog';
import { buildToolOf } from '../../../state/editing/edit-mode';
import { roadFamilyOf } from '../../../state/slices/edit';

const s = () => useEditorStore.getState();
const session = { entryId: null, name: '', nameReviewed: true } as unknown as PlanetSession;

beforeEach(resetStore);

describe('a planet session offers its own modes', () => {
  it('lists them only inside a session', () => {
    expect(modesInSession(null)).toBeNull();
    expect(modesInSession(session)).toEqual(SESSION_BUILD_MODES);
  });

  it('keeps rest and the notes layer open in a session', () => {
    expect(modeOpenIn(session, null)).toBe(true);
    expect(modeOpenIn(session, 'annotate')).toBe(true);
    expect(modeOpenIn(session, 'road')).toBe(false);
    expect(modeOpenIn(null, 'road')).toBe(true);
  });

  it('setEditMode ignores a mode the session does not offer and keeps rest open', () => {
    setStoreState({ planetSession: session });
    s().setEditMode({ mode: 'water' });
    for (const mode of ['road', 'generate'] as const) {
      s().setEditMode({ mode });
      expect(s().editMode.mode).toBe('water');
    }
    s().setEditMode({ mode: null });
    expect(s().editMode.mode).toBeNull();
  });

  it('outside a session every mode arms', () => {
    s().setEditMode({ mode: 'road' });
    expect(s().editMode.mode).toBe('road');
  });
});

describe('starting a region brush', () => {
  const request = { tools: ['rect', 'erase'], single: true, minSide: 4 } as const;

  it('paints under the request it was started with from the update that starts it, the tool moved to the first one offered', () => {
    s().setRegionTool('curve');
    const seen: Array<readonly string[]> = [];
    const off = useEditorStore.subscribe((st) => { if (st.selectingRegion) seen.push(regionRequestOf(st).tools); });
    s().setSelectingRegion(true, 'generator', request);
    off();
    expect(seen[0]).toEqual(['rect', 'erase']);
    expect(s().regionTool).toBe('rect');
    expect(s().regionBrushShape).toBe('rect');
  });

  it('keeps a tool the request offers, and stopping goes back to the default request', () => {
    s().setRegionTool('erase');
    s().setSelectingRegion(true, 'generator', request);
    expect(s().regionTool).toBe('erase');
    s().setSelectingRegion(false);
    expect(regionRequestOf(s())).toEqual(DEFAULT_REGION_REQUEST);
  });
});

describe('the road families', () => {
  const [firstRoad, road] = getRoadMaterials().map((item) => item.id);
  const [firstPrint, print] = getRoadMaterials(true).map((item) => item.id);

  it('[EDIT-82] switch to the other family\'s first material until one was laid there, then to the one last laid', () => {
    expect([s().tileMaterial, roadFamilyOf(s())]).toEqual([firstRoad, 'roads']);
    s().switchRoadFamily();
    expect([s().tileMaterial, roadFamilyOf(s()), s().tileMaterialPicked]).toEqual([firstPrint, 'prints', true]);
    s().setTileMaterial(print!);
    s().switchRoadFamily();
    expect(s().tileMaterial).toBe(firstRoad);
    s().setTileMaterial(road!);
    s().switchRoadFamily('prints');
    expect(s().tileMaterial).toBe(print);
    s().switchRoadFamily('prints');
    expect(s().tileMaterial, 'the family already laid changes nothing').toBe(print);
    s().switchRoadFamily('roads');
    expect(s().tileMaterial).toBe(road);
  });

  it('[EDIT-82] keep a material armed without the setter for the way back, and remember across another surface', () => {
    setStoreState({ tileMaterial: road! });
    s().switchRoadFamily();
    s().setTileMaterial(print!);
    s().setEditMode({ mode: 'mountain' });
    s().setEditMode({ mode: 'road' });
    s().switchRoadFamily();
    expect(s().tileMaterial).toBe(road);
    s().switchRoadFamily();
    expect(s().tileMaterial).toBe(print);
  });

  it('put down a tool a print lacks as the switch arms one', () => {
    s().setEditMode({ mode: 'road', arm: { kind: 'trim' } });
    s().switchRoadFamily('prints');
    expect(buildToolOf(s())).not.toBe('trim');
  });
});
