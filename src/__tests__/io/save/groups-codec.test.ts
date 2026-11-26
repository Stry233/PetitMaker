/** A save's blueprint groups are untrusted input: a damaged group is left out and the map still opens. */
import { describe, expect, it } from 'vitest';
import { createGridState } from '../../../core/model/template';
import { getMapTemplate } from '../../../config/maps';
import { TerrainType, type GridState } from '../../../core/model/types';
import { decodeGroups, encodeGroups, type SaveGroup } from '../../../io/save/groups-codec';
import { buildSaveFile } from '../../../io/save/json-codec';
import { deserialize } from '../../_support/save-file';

function map(): GridState {
  const state = createGridState(getMapTemplate(undefined));
  const cell = state.cells[20]![20]!;
  cell.terrain = { type: TerrainType.Mountain, elevation: 2 };
  state.objects.set('road1', { id: 'road1', catalogId: 'path-blue-board', position: { x: 21, y: 21 }, rotation: 0, elevation: 0 });
  return state;
}

const good: SaveGroup = {
  id: 'g1', blueprint: 'b1', name: 'Terrace', origin: 'Ann', frame: [20, 20, 3, 3], base: 0, objects: ['road1'], cells: [[20, 20, 't1:1']],
};

describe('groups in a save', () => {
  it('reads a group against the map, with what the map holds as what it laid', () => {
    const [g] = decodeGroups([good], map())!;
    expect(g).toMatchObject({ id: 'g1', name: 'Terrace', origin: 'Ann', frame: { x: 20, y: 20, w: 3, h: 3 } });
    expect(g!.cells).toEqual([{ x: 20, y: 20, laid: { type: TerrainType.Mountain, elevation: 2 }, prior: { type: TerrainType.Mountain, elevation: 1 } }]);
    expect(g!.objects.map((o) => o.id)).toEqual(['road1']);
    // Written back, it reads the same.
    expect(encodeGroups({ ...map(), groups: [g!] })).toEqual([good]);
  });

  it('leaves out damaged groups, members the map lacks and members another group already claims', () => {
    const state = map();
    const out = decodeGroups([
      null, 'x', { ...good, id: 'bad id!' }, { ...good, frame: [0, 0, 0, 3] }, { ...good, name: '' },
      { ...good, objects: ['missing'], cells: [[5, 5, '_']] },
      good,
      { ...good, id: 'g2' },
      { ...good, id: 'g3', cells: [[20, 20, 'garbage']], objects: [] },
    ], state);
    expect(out?.map((g) => g.id)).toEqual(['g1']);
    expect(decodeGroups({ not: 'a list' }, state)).toBeUndefined();
  });

  it('leaves out a group whose frame is too big or off the map, or whose members lie outside its frame', () => {
    const state = map();
    const { width } = state.template;
    const out = decodeGroups([
      { ...good, id: 'huge', frame: [0, 0, 5000, 5000] },
      { ...good, id: 'wide', frame: [0, 20, 40, 3] },
      { ...good, id: 'off', frame: [width - 1, 20, 3, 3] },
      { ...good, id: 'stray', frame: [30, 30, 3, 3] },
      { ...good, id: 'ok' },
    ], state);
    expect(out?.map((g) => g.id)).toEqual(['ok']);
  });

  it('a damaged groups section never stops the map opening', () => {
    const state = map();
    const file = { ...buildSaveFile(state), groups: [{ ...good, frame: 'wide' }, 42] };
    const reopened = deserialize(JSON.stringify(file), state.template);
    expect(reopened.groups).toBeUndefined();
    expect(reopened.objects.has('road1')).toBe(true);
  });
});
