import { describe, it, expect } from 'vitest';
import { serializeWithSections, sectionSizes, sectionSizeFormats, buildStats, verifyIntegrity } from '../../io/export-json';
import { serialize, deserialize } from '../../io/json-codec';
import { makeState } from '../rules/_helpers';
import { TerrainType, type GenerateConfig } from '../../core/model/types';

const BASE = { includeGeneration: false, includeProvenance: true, includeStats: false, includeCatalogInfo: false, pretty: false } as const;

function edited() {
  const s = makeState(16, 16);
  for (let x = 2; x < 8; x++) s.cells[4]![x]!.terrain = { type: TerrainType.Mountain, elevation: 2 };
  return s;
}

describe('serializeWithSections', () => {
  it('no options ≈ plain serialize + manifest (loads with today\'s loader)', () => {
    const s = edited();
    const out = JSON.parse(serializeWithSections(s, { ...BASE }));
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
      const kept = JSON.parse(serializeWithSections(state, { ...BASE, pretty, notes: null }));
      expect(kept.annotations).toEqual(state.annotations);
      expect(kept.notes).toBeUndefined();
      const options = { ...BASE, pretty, includeAnnotations: false };
      const json = serializeWithSections(state, options);
      const omitted = JSON.parse(json);
      expect(omitted.annotations).toBeUndefined();
      expect(omitted.notes).toEqual(state.notes);
      expect(verifyIntegrity(omitted)).toBe('ok');
      const restored = deserialize(json, state.template);
      expect(restored.annotations).toBeUndefined();
      expect(restored.cells).toEqual(state.cells);
      expect(restored.notes).toEqual(state.notes);
      const includedSizes = sectionSizes(state, { ...BASE, pretty }, { pretty });
      const omittedSizes = sectionSizes(state, options, { pretty });
      expect(includedSizes.annotations).toBeGreaterThan(0);
      expect(omittedSizes.annotations).toBe(0);
      expect(omittedSizes.core).toBe(includedSizes.core);
      expect(omittedSizes.total).toBe(new TextEncoder().encode(json).length);
    }
    expect(JSON.parse(serialize(state))).toEqual({ ...original, metadata: expect.any(Object) });
  });
  it('generation + session + stats + catalogInfo sections appear on demand', () => {
    const s = edited();
    s.generation = { algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 8, seed: 7, region: null } as GenerateConfig;
    const out = JSON.parse(serializeWithSections(s, { ...BASE, includeGeneration: true, includeStats: true, includeCatalogInfo: true, session: { v: 1, lockedLayers: [2], camera: { x: 1, y: 2, zoom: 1.5 } } }));
    expect(out.generation.seed).toBe(7);
    expect(out.session.lockedLayers).toEqual([2]);
    expect(out.stats.cells.byType.mountain).toBe(6);
    expect(out.stats).toEqual(JSON.parse(JSON.stringify(buildStats(s))));
    expect(out.catalogInfo).toBeTypeOf('object');
  });
  it('includeProvenance:false strips provenance', () => {
    // fresh makeState has no provenance; a deserialize round-trip creates it (markLegacyUnknown)
    const base = edited();
    const s = deserialize(serialize(base), base.template);
    expect(JSON.parse(serialize(s)).provenance).toBeDefined(); // fixture guard: there IS something to strip
    expect(JSON.parse(serializeWithSections(s, { ...BASE })).provenance).toBeDefined();
    const out = JSON.parse(serializeWithSections(s, { ...BASE, includeProvenance: false }));
    expect(out.provenance).toBeUndefined();
  });
  it('sectionSizes: non-zero core, zero for absent sections, total = real output size', () => {
    const s = edited();
    const sizes = sectionSizes(s, { ...BASE });
    expect(sizes.core).toBeGreaterThan(50);
    expect(sizes.history).toBe(0);
    expect(sizes.total).toBe(new TextEncoder().encode(serializeWithSections(s, { ...BASE })).length);
  });
  it('pretty output is larger and still loads', () => {
    const s = edited();
    const mini = serializeWithSections(s, { ...BASE });
    const pretty = serializeWithSections(s, { ...BASE, pretty: true });
    expect(pretty.length).toBeGreaterThan(mini.length);
    expect(() => deserialize(pretty, s.template)).not.toThrow();
  });
  it('sectionSizes withTotal:false skips the full-file serialize (total = 0)', () => {
    const s = edited();
    expect(sectionSizes(s, { ...BASE }, { withTotal: false }).total).toBe(0);
    // per-section fields are still populated
    expect(sectionSizes(s, { ...BASE }, { withTotal: false }).core).toBeGreaterThan(50);
  });
  it('sectionSizes pretty:true measures larger sections than compact (so the total tracks Pretty-print)', () => {
    const s = edited();
    const opts = { ...BASE, includeStats: true } as const;
    const compact = sectionSizes(s, opts, { withTotal: false });
    const pretty = sectionSizes(s, opts, { withTotal: false, pretty: true });
    // A structured section (stats: nested objects) is meaningfully bigger pretty-printed.
    expect(pretty.stats).toBeGreaterThan(compact.stats);
    expect(pretty.core).toBeGreaterThanOrEqual(compact.core);
  });

  it('shares preparation while preserving both displayed section-size formats', () => {
    const state = edited();
    const formats = sectionSizeFormats(state, BASE);
    expect(formats.compact).toEqual(sectionSizes(state, BASE, { withTotal: false }));
    expect(formats.pretty).toEqual(sectionSizes(state, BASE, { withTotal: false, pretty: true }));
  });

  describe('integrity code', () => {
    it('embeds a manifest.integrity code that verifies as ok on an untouched export', () => {
      const s = edited();
      const parsed = JSON.parse(serializeWithSections(s, { ...BASE }));
      expect(typeof parsed.manifest.integrity).toBe('string');
      expect(verifyIntegrity(parsed)).toBe('ok');
    });
    it('is format-independent: pretty vs compact both verify ok', () => {
      const s = edited();
      expect(verifyIntegrity(JSON.parse(serializeWithSections(s, { ...BASE, pretty: true })))).toBe('ok');
      expect(verifyIntegrity(JSON.parse(serializeWithSections(s, { ...BASE, pretty: false })))).toBe('ok');
    });
    it('detects a hand-edited value as modified', () => {
      const s = edited();
      const parsed = JSON.parse(serializeWithSections(s, { ...BASE }));
      parsed.cells = parsed.cells + ',t1:1'; // tamper with the terrain payload
      expect(verifyIntegrity(parsed)).toBe('modified');
    });
    it('detects an edit even inside a section (e.g. notes)', () => {
      const s = edited();
      const parsed = JSON.parse(serializeWithSections(s, { ...BASE, notes: { title: 'orig' } }));
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
