/** The save codec carries a non-empty plan-notes layer as one optional, validated field. The
 * canonical terrain/object map remains independent from this annotation carrier. */
import { describe, it, expect } from 'vitest';
import { serialize } from '../../../io/save/json-codec';
import { deserialize } from '../../_support/save-file';
import { decodeAnnotations } from '../../../io/save/annotations-codec';
import { canonicalize, toSaveJSON } from '../../../io/save/canonical';
import { autosaveWorthy } from '../../../io/storage/facts';
import { makeState } from '../../_support/map-state';
import { routeWidth, type AnnotationsState, type ChipNote, type RouteNote, type ZoneNote } from '../../../core/model/annotations';

const notes = (): AnnotationsState => ({
  items: [
    { kind: 'zone', id: 'z1', cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }], color: '#FF8A7A', tag: 'homes', num: 1 },
    { kind: 'chip', id: 't1', x: 5.5, y: 6, tag: 'plaza', size: 'l', color: '#FFB347' },
    { kind: 'route', id: 'r1', points: [{ x: 1, y: 1 }, { x: 4.5, y: 2, hx: 1.5, hy: -0.5, ihx: -2, ihy: 0.25 }], color: '#FFFEE3', dashed: true },
  ],
  visible: true,
  locked: false,
});

describe('annotations through serialize/deserialize', () => {
  it('round-trips every kind, the eye and the lock', () => {
    const state = makeState(12, 12);
    state.annotations = { ...notes(), visible: false, locked: true };
    const back = deserialize(serialize(state), state.template);
    expect(back.annotations).toBeDefined();
    expect(back.annotations!.visible).toBe(false);
    expect(back.annotations!.locked).toBe(true);
    expect(back.annotations!.items).toHaveLength(3);
    expect(back.annotations!.items[0] as ZoneNote).toMatchObject({ kind: 'zone', tag: 'homes', num: 1 });
    expect((back.annotations!.items[1] as ChipNote)).toMatchObject({ x: 5.5, y: 6, tag: 'plaza', size: 'l' });
    expect((back.annotations!.items[2] as RouteNote).points).toHaveLength(2);
  });

  it('an empty or omitted annotation layer loads with none', () => {
    const state = makeState(8, 8);
    state.annotations = { items: [], visible: false, locked: true };
    const json = serialize(state);
    expect(JSON.parse(json)).not.toHaveProperty('annotations');
    const back = deserialize(json, state.template);
    expect(back.annotations).toBeUndefined();
  });

  it('clamps and drops crafted input instead of loading it', () => {
    const state = makeState(8, 8);
    const raw = JSON.parse(serialize(state));
    raw.annotations = {
      items: [
        { kind: 'zone', cells: [{ x: 1, y: 1 }, { x: 1e9, y: 2 }, { x: 2.5, y: 2 }], color: 'javascript:alert(1)', tag: 'not-a-tag', num: -3 },
        { kind: 'chip', x: 3, y: 3, tag: 'not-a-tag', size: 'm', color: '#abc' },
        { kind: 'route', points: [{ x: 1, y: 1 }], color: '#2FBF9B', dashed: true },
        { kind: 'mystery' },
        null,
      ],
      visible: 'yes', locked: 0,
    };
    const back = deserialize(JSON.stringify(raw), state.template);
    // The unknown-tag chip, the one-point route and the unknown kind all drop; the zone survives clamped.
    expect(back.annotations!.items).toHaveLength(1);
    const zone = back.annotations!.items[0] as ZoneNote;
    expect(zone.cells).toEqual([{ x: 1, y: 1 }]);
    expect(zone.color).toBe('#FF8A7A');
    expect(zone.tag).toBeNull();
    expect(zone.num).toBe(0);
    expect(back.annotations!.visible).toBe(true);
    expect(back.annotations!.locked).toBe(false);
  });

  it('a save from before tags loads its zones untagged and without its text notes', () => {
    const state = makeState(8, 8);
    const raw = JSON.parse(serialize(state));
    raw.annotations = {
      items: [
        { kind: 'zone', id: 'z', cells: [{ x: 1, y: 1 }], color: '#FF8A7A', name: '住宅区', num: 1 },
        { kind: 'text', id: 't', x: 3, y: 3, text: '中心广场', style: 'chip', size: 'm', color: '#FFB347' },
      ],
      visible: true, locked: false,
    };
    const back = deserialize(JSON.stringify(raw), state.template);
    expect(back.annotations!.items).toHaveLength(1);
    expect(back.annotations!.items[0]).toMatchObject({ kind: 'zone', id: 'z', tag: null, num: 1 });
    expect(JSON.stringify(back.annotations)).not.toContain('住宅区');
  });

  it('stays outside the canonical terrain/object map', () => {
    const state = makeState(8, 8);
    state.annotations = notes();
    const canonical = canonicalize(state);
    expect(JSON.stringify(canonical)).not.toContain('"tag"');
    expect(toSaveJSON(canonical)).not.toContain('annotations');
  });

  it('an annotation-only map is autosave-worthy', () => {
    const state = makeState(8, 8);
    expect(autosaveWorthy(state)).toBe(false);
    state.annotations = notes();
    expect(autosaveWorthy(state)).toBe(true);
  });
});

describe('measurement persistence', () => {
  const note = { kind: 'measure', id: 'distance', points: [{ x: 1, y: 4 }, { x: 84, y: 4 }], color: '#FFB347' } as const;
  it('round-trips a measurement-only map and makes it autosave-worthy', () => {
    const state = makeState(100, 100);
    state.annotations = { items: [{ ...note, points: [...note.points] }], visible: true, locked: false };
    expect(autosaveWorthy(state)).toBe(true);
    expect(deserialize(serialize(state), state.template).annotations).toEqual(state.annotations);
  });
  it.each([true, false])('preserves the flipped side %s in save files', flipped => {
    const state = makeState(100, 100);
    state.annotations = { items: [{ ...note, points: [...note.points], flipped }], visible: true, locked: false };
    expect(deserialize(serialize(state), state.template).annotations).toEqual(state.annotations);
  });
  it.each([
    { points: [{ x: 1, y: 2 }] },
    { points: [{ x: 1.5, y: 2 }, { x: 8, y: 2 }] },
    { points: [{ x: 1, y: 2 }, { x: 8, y: 9 }] },
    { points: [null, { x: 8, y: 2 }] },
    { points: [{ x: 1, y: 2 }, { x: Infinity, y: 2 }] },
  ])('rejects malformed measurement endpoints $points', ({ points }) => {
    expect(decodeAnnotations({ items: [{ ...note, points }] })).toBeUndefined();
  });
});

describe('a zone with no text', () => {
  const zoneOf = (size: unknown) => decodeAnnotations({
    items: [{ kind: 'zone', id: 'z', cells: [{ x: 1, y: 1 }], color: '#FF8A7A', tag: 'homes', num: 2, size }],
  })!.items[0] as ZoneNote;

  it('keeps its own no-text size through a save and a share code', () => {
    const state = makeState(8, 8);
    state.annotations = { items: [{ kind: 'zone', id: 'z', cells: [{ x: 1, y: 1 }], color: '#FF8A7A', tag: 'homes', num: 2, size: 'none' }], visible: true, locked: false };
    expect((deserialize(serialize(state), state.template).annotations!.items[0] as ZoneNote).size).toBe('none');
    const shared = deserialize(toSaveJSON(canonicalize(state), state.annotations), state.template);
    expect((shared.annotations!.items[0] as ZoneNote).size).toBe('none');
  });

  it('reads earlier sizes as before and an unknown one as medium', () => {
    expect(zoneOf('s').size).toBe('s');
    expect(zoneOf(undefined).size).toBe('m');
    expect(zoneOf('huge').size).toBe('m');
    expect(zoneOf('none').size).toBe('none');
  });

  it('never gives a chip no text', () => {
    const chip = decodeAnnotations({ items: [{ kind: 'chip', id: 'c', x: 1, y: 1, tag: 'plaza', size: 'none', color: '#FFB347' }] })!.items[0] as ChipNote;
    expect(chip.size).toBe('m');
  });
});

describe('route width in saves', () => {
  const route = (extra: Record<string, unknown>) => decodeAnnotations({
    items: [{ kind: 'route', id: 'r', points: [{ x: 1, y: 1 }, { x: 5, y: 2 }], color: '#FFB347', dashed: false, ...extra }],
  })!.items[0] as RouteNote;

  it('carries each route its own width through a save and a share code', () => {
    const state = makeState(8, 8);
    state.annotations = { items: [
      { kind: 'route', id: 'a', points: [{ x: 1, y: 1 }, { x: 5, y: 2 }], color: '#FFB347', dashed: false, width: 4 },
      { kind: 'route', id: 'b', points: [{ x: 1, y: 3 }, { x: 5, y: 4 }], color: '#FFB347', dashed: true },
    ], visible: true, locked: false };
    for (const back of [deserialize(serialize(state), state.template), deserialize(toSaveJSON(canonicalize(state), state.annotations), state.template)]) {
      expect(back.annotations!.items.map((n) => (n as RouteNote).width)).toEqual([4, undefined]);
    }
  });

  it('draws a route saved before widths, or with a width it cannot use, at the base width', () => {
    expect(routeWidth(route({}))).toBe(1);
    expect(route({ width: 0 }).width).toBeUndefined();
    expect(route({ width: 2.5 }).width).toBeUndefined();
    expect(route({ width: 'wide' }).width).toBeUndefined();
    expect(route({ width: 40 }).width).toBe(5);
  });
});
