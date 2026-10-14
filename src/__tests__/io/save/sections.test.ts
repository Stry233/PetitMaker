import { describe, it, expect } from 'vitest';
import { carrying, serializeWithSections, sectionSizeFormats, verifyIntegrity, type ExportJsonOptions, type SectionKey } from '../../../io/save/sections';
import { serialize } from '../../../io/save/json-codec';
import { deserialize } from '../../_support/save-file';
import { makeState } from '../../_support/map-state';
import { roundLoad } from '../../../core/model/load';
import { catalogLoadValue } from '../../../state/catalog';
import { placedLoad } from '../../../state/map-stats';
import { TerrainType } from '../../../core/model/types';
import { defaultConfig } from '../../../tools/generation/recipe';
import { exportable } from '../../_support/exportable';

const BASE_KEYS: SectionKey[] = ['annotations', 'notes', 'provenance'];
const BASE = { carry: carrying(...BASE_KEYS), pretty: false };
/** The base sections with `on` added and `off` taken out. */
const with_ = (on: SectionKey[], off: SectionKey[] = []) => carrying(...[...BASE_KEYS, ...on].filter((k) => !off.includes(k)));
/** The section sizes the export window shows for `state`, in the chosen format. */
const sizesOf = (state: ReturnType<typeof makeState>, opts: ExportJsonOptions, pretty = false) => sectionSizeFormats(exportable(state), opts)[pretty ? 'pretty' : 'compact'];
/** The statistics section an export carrying it writes. */
const statsOf = (state: ReturnType<typeof makeState>) => JSON.parse(serializeWithSections(exportable(state), { ...BASE, carry: with_(['stats']) })).stats;

function edited() {
  const s = makeState(16, 16);
  for (let x = 2; x < 8; x++) s.cells[4]![x]!.terrain = { type: TerrainType.Mountain, elevation: 2 };
  return s;
}

describe('serializeWithSections', () => {
  it('no options ≈ plain serialize + manifest (loads with today\'s loader)', () => {
    const s = edited();
    const out = JSON.parse(serializeWithSections(exportable(s), { ...BASE }));
    const plain = JSON.parse(serialize(s));
    expect(out.cells).toBe(plain.cells);
    expect(out.manifest.saveVersion).toBe(plain.version);
    const back = deserialize(JSON.stringify(out), s.template);
    expect(JSON.parse(serialize(back)).cells).toBe(plain.cells);
  });
  it('notes round-trip through serialize/deserialize', () => {
    const s = edited();
    s.notes = { title: 'My Island', description: 'a first draft' };
    const back = deserialize(serialize(s), s.template);
    expect(back.notes).toEqual({ title: 'My Island', description: 'a first draft' });
  });
  it('drops the retired author field and clamps the title and description on load', () => {
    const s = makeState(8, 8);
    s.notes = { title: 'T'.repeat(60), description: 'D'.repeat(260) };
    const parsed = JSON.parse(serialize(s)) as { notes: Record<string, unknown> };
    parsed.notes.author = 'someone';
    const back = deserialize(JSON.stringify(parsed), s.template);
    expect(back.notes).toEqual({ title: 'T'.repeat(48), description: 'D'.repeat(200) });
  });
  it('can omit annotations independently of notes without changing the working map', () => {
    const state = edited();
    state.annotations = {
      items: [{ kind: 'chip', id: 'garden-marker', x: 3, y: 4, tag: 'garden', size: 'm', color: '#B4D8A2' }],
      visible: false,
      locked: true,
    };
    state.notes = { title: 'Garden plan', description: 'Creator notes' };
    const original = JSON.parse(serialize(state));
    for (const pretty of [false, true]) {
      const kept = JSON.parse(serializeWithSections(exportable(state), { ...BASE, pretty, carry: with_([], ['notes']) }));
      expect(kept.annotations).toEqual(state.annotations);
      expect(kept.notes).toBeUndefined();
      const options = { ...BASE, pretty, carry: with_([], ['annotations']) };
      const json = serializeWithSections(exportable(state), options);
      const omitted = JSON.parse(json);
      expect(omitted.annotations).toBeUndefined();
      expect(omitted.notes).toEqual(state.notes);
      expect(verifyIntegrity(omitted)).toBe('ok');
      const restored = deserialize(json, state.template);
      expect(restored.annotations).toBeUndefined();
      expect(restored.cells).toEqual(state.cells);
      expect(restored.notes).toEqual(state.notes);
      const includedSizes = sizesOf(state, { ...BASE, pretty }, pretty);
      const omittedSizes = sizesOf(state, options, pretty);
      expect(includedSizes.annotations).toBeGreaterThan(0);
      expect(omittedSizes.annotations).toBe(0);
      expect(omittedSizes.core).toBe(includedSizes.core);
    }
    expect(JSON.parse(serialize(state))).toEqual({ ...original, metadata: expect.any(Object) });
  });
  it('generation + session + stats + catalogInfo sections appear on demand', () => {
    const s = edited();
    s.generation = defaultConfig('designed', { maxElevation: 8, seed: 7 });
    const out = JSON.parse(serializeWithSections(exportable(s), {
      ...BASE, carry: with_(['generation', 'stats', 'catalog', 'session']),
      session: { lockedLayers: [2], camera: { view2d: { x: 1, y: 2, zoom: 1.5 } } },
    }));
    expect(out.generation.seed).toBe(7);
    expect(out.session).toEqual({ v: 1, lockedLayers: [2] });
    expect(out.camera).toEqual({ view2d: { x: 1, y: 2, zoom: 1.5 } });
    expect(out.stats.cells.byType.mountain).toBe(6);
    expect(out.catalogInfo).toBeTypeOf('object');
  });
  it('includeProvenance:false strips provenance', () => {
    // fresh makeState has no provenance; a deserialize round-trip creates it (markLegacyUnknown)
    const base = edited();
    const s = deserialize(serialize(base), base.template);
    expect(JSON.parse(serialize(s)).provenance).toBeDefined(); // fixture guard: there is something to strip
    expect(JSON.parse(serializeWithSections(exportable(s), { ...BASE })).provenance).toBeDefined();
    const out = JSON.parse(serializeWithSections(exportable(s), { ...BASE, carry: with_([], ['provenance']) }));
    expect(out.provenance).toBeUndefined();
  });
  it('section sizes: non-zero core, zero for absent sections', () => {
    const sizes = sizesOf(edited(), { ...BASE });
    expect(sizes.core).toBeGreaterThan(50);
    expect(sizes.history).toBe(0);
  });
  it('pretty output is larger and still loads', () => {
    const s = edited();
    const mini = serializeWithSections(exportable(s), { ...BASE });
    const pretty = serializeWithSections(exportable(s), { ...BASE, pretty: true });
    expect(pretty.length).toBeGreaterThan(mini.length);
    expect(() => deserialize(pretty, s.template)).not.toThrow();
  });
  it('measures larger sections pretty-printed than compact (so the estimate tracks Pretty-print)', () => {
    const s = edited();
    const opts = { ...BASE, carry: with_(['stats']) };
    const compact = sizesOf(s, opts);
    const pretty = sizesOf(s, opts, true);
    // A structured section (stats: nested objects) is meaningfully bigger pretty-printed.
    expect(pretty.stats).toBeGreaterThan(compact.stats);
    expect(pretty.core).toBeGreaterThanOrEqual(compact.core);
  });

  describe('integrity code', () => {
    it('embeds a manifest.integrity code that verifies as ok on an untouched export', () => {
      const s = edited();
      const parsed = JSON.parse(serializeWithSections(exportable(s), { ...BASE }));
      expect(typeof parsed.manifest.integrity).toBe('string');
      expect(verifyIntegrity(parsed)).toBe('ok');
    });
    it('is format-independent: pretty vs compact both verify ok', () => {
      const s = edited();
      expect(verifyIntegrity(JSON.parse(serializeWithSections(exportable(s), { ...BASE, pretty: true })))).toBe('ok');
      expect(verifyIntegrity(JSON.parse(serializeWithSections(exportable(s), { ...BASE, pretty: false })))).toBe('ok');
    });
    it('detects a hand-edited value as modified', () => {
      const s = edited();
      const parsed = JSON.parse(serializeWithSections(exportable(s), { ...BASE }));
      parsed.cells = parsed.cells + ',t1:1'; // tamper with the terrain payload
      expect(verifyIntegrity(parsed)).toBe('modified');
    });
    it('detects an edit even inside a section (e.g. notes)', () => {
      const s = edited();
      const parsed = JSON.parse(serializeWithSections(exportable(s), { ...BASE, notes: { title: 'orig' } }));
      parsed.notes.title = 'hacked';
      expect(verifyIntegrity(parsed)).toBe('modified');
    });
    it('reports absent when there is no integrity code (legacy / hand-made / plain serialize)', () => {
      const s = edited();
      expect(verifyIntegrity(JSON.parse(serialize(s)))).toBe('absent'); // plain autosave-shape file
      expect(verifyIntegrity(null)).toBe('absent');
      expect(verifyIntegrity({ manifest: {} })).toBe('absent');
    });
  });
});

describe('the statistics section', () => {
  it('sums decimal loads without floating-point residue', () => {
    const s = makeState();
    for (let i = 0; i < 3; i++) {
      s.objects.set(`apple-${i}`, { id: `apple-${i}`, catalogId: 'tree-apple', position: { x: 2 + 2 * i, y: 2 }, rotation: 0, elevation: 0 });
    }
    expect(statsOf(s).load.total).toBe(roundLoad(3 * catalogLoadValue('tree-apple')));
    expect(String(statsOf(s).load.total)).not.toMatch(/\d{6,}/);
  });

  it('counts a patch-only object as standing on the map but carrying no load, as the editor does', () => {
    const s = makeState();
    s.objects.set('apple', { id: 'apple', catalogId: 'tree-apple', position: { x: 2, y: 2 }, rotation: 0, elevation: 0 });
    s.objects.set('patch', { id: 'patch', catalogId: 'tree-apple', position: { x: 6, y: 2 }, rotation: 0, elevation: 0, patchOnly: true });
    const stats = statsOf(s);
    expect(stats.objects.total).toBe(2);
    expect(stats.load.total).toBe(catalogLoadValue('tree-apple'));
    expect(stats.load.total).toBe(placedLoad(s.objects.get('apple')!) + placedLoad(s.objects.get('patch')!));
  });
});
