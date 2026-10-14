import { describe, it, expect } from 'vitest';
import { serialize } from '../../../io/save/json-codec';
import { deserialize } from '../../_support/save-file';
import { createGridState } from '../../../core/model/template';
import { getMapTemplate } from '../../../config/maps';
import type { PlacedObject } from '../../../core/model/types';
import type { SaveFile, SaveObject } from '../../../io/save/format';

const road = (x: number, y: number, i: number): SaveObject =>
  ({ id: `r${x}-${y}-${i}`, catalogId: 'path-overgrown-dirt', x, y, rotation: 0, elevation: 0 });

/** Legacy saves may contain overlapping placements that current placement rules reject. */
function stackedSave(extra: SaveObject[] = []): string {
  const save = JSON.parse(serialize(createGridState(getMapTemplate('hexia')))) as SaveFile;
  save.objects = [
    ...Array.from({ length: 8 }, (_, i) => road(27, 108, i)),
    ...Array.from({ length: 9 }, (_, i) => road(28, 108, i)),
    ...Array.from({ length: 10 }, (_, i) => road(29, 108, i)),
    ...extra,
  ];
  return JSON.stringify(save);
}

const loaded = (json: string): PlacedObject[] =>
  [...deserialize(json, getMapTemplate('hexia')).objects.values()].filter((o) => !o.locked);

describe('loading preserves coating layers', () => {
  it.each([false, true])('retains pavement and its print in either insertion order, reversed %s', reversed => {
    const pair: SaveObject[] = [road(40, 40, 0), {
      id: 'print', catalogId: 'print-field-corner', x: 40, y: 40, elevation: 0, rotation: 90,
    }];
    const objects = loaded(stackedSave(reversed ? pair.reverse() : pair)).filter(o => o.position.x === 40);
    expect(objects).toHaveLength(2);
    expect(new Set(objects.map(o => o.catalogId))).toEqual(new Set(['path-overgrown-dirt', 'print-field-corner']));
  });

  it('preserves overlapping objects instead of repairing gameplay state while decoding', () => {
    const objects = loaded(stackedSave());
    expect(objects).toHaveLength(27);
    expect(objects.filter(o => o.position.x === 29)).toHaveLength(10);
  });
});
