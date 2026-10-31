import { describe, expect, it } from 'vitest';
import { makeState } from '../../_support/map-state';
import { surveyAnnotations, surveyText } from '../../../agent/tools/annotation-survey';
import type { MapAnnotation, ZoneNote } from '../../../core/model/annotations';
import { rectCells } from '../../../core/grid/shapes';
import type { PlacedObject } from '../../../core/model/types';

const zone = (num: number, tag: string | null, [x1, y1, x2, y2]: number[], color = '#9BC53D'): ZoneNote =>
  ({ kind: 'zone', id: `z${num}`, num, tag, color, cells: rectCells({ x: x1!, y: y1! }, { x: x2!, y: y2! }) });

function surveyed(items: MapAnnotation[], landmark = false) {
  const state = makeState(20, 20);
  state.annotations = { items, visible: true, locked: false };
  if (landmark) {
    const plaza = { id: 'p', catalogId: '__plaza__', position: { x: 8, y: 0 }, rotation: 0, elevation: 0, locked: true, width: 4, height: 4 } as unknown as PlacedObject;
    state.objects.set('p', plaza);
  }
  return surveyAnnotations(state);
}

describe('annotation survey', () => {
  it('measures coverage of open ground, overlaps and touching zones on whole cells', () => {
    const s = surveyed([zone(1, 'homes', [0, 0, 9, 9]), zone(2, 'garden', [9, 0, 19, 9])]);
    expect(s.ground).toBe(400);
    expect(s.covered).toBe(200);
    expect(s.overlap).toBe(10);
    expect(s.overlaps).toEqual([{ a: 1, b: 2, cells: 10 }]);
    expect(s.zones[0]).toMatchObject({ area: 100, pieces: 1, neighbours: [2] });
    expect(s.unplanned[0]).toMatchObject({ cells: 200, bbox: { x1: 0, y1: 10, x2: 19, y2: 19 } });
  });

  it('counts fixed landmarks out of open ground and reports which ones circulation reaches', () => {
    const s = surveyed([zone(1, 'entrance', [0, 4, 19, 5]), zone(2, 'homes', [0, 10, 5, 15]), zone(3, 'farm', [0, 6, 5, 8])], true);
    expect(s.ground).toBe(384);
    expect(s.circulation).toMatchObject({ cells: 40, pieces: 1, reaches: ['__plaza__'], apart: [2] });
    expect(surveyText(s)).toContain('1 of 2 other zones touch no circulation (#2)');
  });

  it('names a label worn in several colours', () => {
    const s = surveyed([zone(1, 'forest', [0, 0, 2, 2], '#2FBF9B'), zone(2, 'forest', [5, 5, 7, 7], '#FFD84D')]);
    expect(s.mixedColours).toEqual([{ label: 'forest', colours: ['#2FBF9B', '#FFD84D'] }]);
  });

  it('classes every parcel edge by what it meets and counts parcels per label', () => {
    // Two 5-wide blocks either side of a 2-wide path on a 20x20 map, open ground below them.
    const s = surveyed([zone(1, 'entrance', [5, 0, 6, 9]), zone(2, 'homes', [0, 0, 4, 9]), zone(3, 'homes', [7, 0, 11, 9])]);
    expect(s.edges).toEqual({ parcels: 0, paths: 20, fixed: 20, open: 20 });
    expect(s.labels).toEqual([{ label: 'homes', zones: 2 }]);
    expect(s.largest).toEqual({ num: 2, share: 0.5 });
    expect(surveyText(s)).toMatch(/Their edges meet other parcels 0%, circulation 33%, coast or fixed ground 33%, open unplanned ground 33%\./);
  });

  it('reads a path zone at about its drawn width, straight or diagonal', () => {
    expect(surveyed([zone(1, 'entrance', [5, 0, 7, 19])]).zones[0]!.width).toBe(3);
    const diagonal: ZoneNote = { ...zone(2, 'entrance', [0, 0, 0, 0]), cells: Array.from({ length: 16 }, (_, k) => [{ x: k, y: k }, { x: k + 1, y: k }, { x: k + 2, y: k }]).flat() };
    expect(surveyed([diagonal]).zones[0]!.width).toBeLessThanOrEqual(3);
    expect(surveyText(surveyed([zone(1, 'entrance', [5, 0, 7, 19])]))).toMatch(/#1 entrance .*, about 3 wide/);
  });
});
