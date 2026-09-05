/** The save codec carries a non-empty plan-notes layer as one optional, validated field. The
 * canonical terrain/object map remains independent from this annotation carrier. */
import { describe, it, expect } from 'vitest';
import { serialize, deserialize } from '../../io/json-codec';
import { canonicalize, toSaveJSON } from '../../io/share/canonical';
import { autosaveWorthy } from '../../io/autosave';
import { makeState } from '../rules/_helpers';
import type { AnnotationsState, RouteNote, TextNote, ZoneNote } from '../../core/model/annotations';

const notes = (): AnnotationsState => ({
  items: [
    { kind: 'zone', id: 'z1', cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }], color: '#FF8A7A', name: '住宅区', num: 1 },
    { kind: 'text', id: 't1', x: 5.5, y: 6, text: '中心广场', style: 'chip', size: 'l', color: '#FFB347' },
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
    expect(back.annotations!.items[0] as ZoneNote).toMatchObject({ kind: 'zone', name: '住宅区', num: 1 });
    expect((back.annotations!.items[1] as TextNote)).toMatchObject({ x: 5.5, y: 6, style: 'chip', size: 'l' });
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
        { kind: 'zone', cells: [{ x: 1, y: 1 }, { x: 1e9, y: 2 }, { x: 2.5, y: 2 }], color: 'javascript:alert(1)', name: 'x'.repeat(200), num: -3 },
        { kind: 'text', x: 3, y: 3, text: '', style: 'chip', size: 'm', color: '#abc' },
        { kind: 'route', points: [{ x: 1, y: 1 }], color: '#2FBF9B', dashed: true },
        { kind: 'mystery' },
        null,
      ],
      visible: 'yes', locked: 0,
    };
    const back = deserialize(JSON.stringify(raw), state.template);
    // The empty text, the one-point route and the unknown kind all drop; the zone survives clamped.
    expect(back.annotations!.items).toHaveLength(1);
    const zone = back.annotations!.items[0] as ZoneNote;
    expect(zone.cells).toEqual([{ x: 1, y: 1 }]);
    expect(zone.color).toBe('#FF8A7A');
    expect(zone.name).toHaveLength(40);
    expect(zone.num).toBe(0);
    expect(back.annotations!.visible).toBe(true);
    expect(back.annotations!.locked).toBe(false);
  });

  it('stays outside the canonical terrain/object map', () => {
    const state = makeState(8, 8);
    state.annotations = notes();
    const canonical = canonicalize(state);
    expect(JSON.stringify(canonical)).not.toContain('住宅区');
    expect(toSaveJSON(canonical)).not.toContain('annotations');
  });

  it('an annotation-only map is autosave-worthy', () => {
    const state = makeState(8, 8);
    expect(autosaveWorthy(state)).toBe(false);
    state.annotations = notes();
    expect(autosaveWorthy(state)).toBe(true);
  });
});
