import { describe, it, expect, beforeEach, vi } from 'vitest';

const raster = vi.hoisted(() => ({ current: null as { pixels: Uint8Array; width: number; height: number } | null }));
// jsdom has no createImageBitmap; the raster reader hands over the rendered code's pixels.
vi.mock('../../../io/raster-image', () => ({ readRasterImage: async () => ({ ...raster.current!, pixels: new Uint8Array(raster.current!.pixels) }) }));
import { encodeMapPayload, decodeMapPayload, type ShareCodeMeta } from '../../../io/share/codec/payload';
import { encodeTemplateRecord, decodeTemplateRecord } from '../../../io/share/codec/template-record';
import { MODEL_VARIANTS, modelCanRepresent } from '../../../io/share/codec/map-coder';
import { tokensOf, parseToken } from '../../../io/share/codec/grid-io';
import { canonicalize, canonicalBytes } from '../../../io/share/canonical';
import { buildShareCode } from '../../../io/share/export';
import { importFromBytes } from '../../../io/share/import';
import { inspectImportFile } from '../../../io/import-file';
import { validateImportedState } from '../../../io/share/validate';
import { ShareError } from '../../../io/share/errors';
import { encodePng } from '../../../io/share/raster/png-raster';
import { listPlanets } from '../../../io/planet-library';
import { planetFixture, worstCasePlanet, NO_PLAZA, pondMask } from '../../fixtures/planet';
import { getMapTemplate } from '../../../config/maps';
import { createGridState, planetTemplateId } from '../../../core/model/planet';
import { CellZone, TerrainType } from '../../../core/model/types';
import { landmarkAt } from '../../fixtures/planet';

const META: ShareCodeMeta = { appVersion: '1.0-test', saveVersion: 3 };

describe('share codes on custom planets', () => {
  beforeEach(() => localStorage.clear());

  it('round-trip through frame 6 without the library', async () => {
    const state = createGridState(planetFixture());
    state.cells[8]![8]!.terrain = { type: TerrainType.Mountain, elevation: 2 };
    const bytes = await encodeMapPayload(state, null, META);
    expect(bytes[2]).toBe(6);
    const out = await decodeMapPayload(bytes);
    expect(out.canonical.templateId).toBe(state.template.id);
    expect(out.template?.id).toBe(state.template.id);
    expect(out.template?.terrain).toEqual(state.template.terrain);
    expect(canonicalBytes(out.canonical)).toEqual(canonicalBytes(canonicalize(state)));
  });

  it('round-trip a planet with a pond, which a fresh map lays as water on its grass', async () => {
    const t = planetFixture({ plaza: landmarkAt(12.5, 3.5, 90), water: pondMask([[30, 20], [31, 20]]) });
    const state = createGridState(t);
    expect(state.cells[20]![30]!.terrain).toEqual({ type: TerrainType.Water, elevation: 0 });
    expect(state.cells[20]![32]!.terrain).toBeNull();
    const out = await decodeMapPayload(await encodeMapPayload(state, null, META));
    expect(out.template).toEqual(t);
    expect(decodeTemplateRecord(encodeTemplateRecord(t))).toEqual(t);
    expect(canonicalBytes(out.canonical)).toEqual(canonicalBytes(canonicalize(state)));
  });

  it.each([90, 270] as const)('round-trip a plaza turned %s degrees', async (rotation) => {
    const t = planetFixture({ plaza: landmarkAt(12.5, 3.5, rotation) });
    const state = createGridState(t);
    const out = await decodeMapPayload(await encodeMapPayload(state, null, META));
    expect(out.template).toEqual(t);
    expect(canonicalBytes(out.canonical)).toEqual(canonicalBytes(canonicalize(state)));
    expect(decodeTemplateRecord(encodeTemplateRecord(t))).toEqual(t);
  });

  it('built-in maps still write frame 4 or 5', async () => {
    const bytes = await encodeMapPayload(createGridState(getMapTemplate('hexia')), null, META);
    expect(bytes[2]).toBeLessThan(6);
    expect((await decodeMapPayload(bytes)).template).toBeUndefined();
  });

  it('uses only unmasked model variants on a custom planet', async () => {
    const state = createGridState(planetFixture());
    const c = canonicalize(state);
    const cells = tokensOf(c.cells).map(parseToken);
    for (const v of MODEL_VARIANTS.filter((m) => m.templateMask)) {
      expect(modelCanRepresent(state.template, cells, c.objects, v)).toBe(false);
    }
    const bytes = await encodeMapPayload(state, null, META);
    expect(MODEL_VARIANTS[bytes[3]!]!.templateMask).toBeUndefined();
  });

  it('the largest planet leaves room for a build', async () => {
    const bytes = await encodeMapPayload(createGridState(worstCasePlanet()), null, META);
    console.info(`[measure] worst-case empty planet payload: ${bytes.length} bytes`);
    expect(bytes.length).toBeLessThan(3000);
  });

  it('carries notes beside the planet', async () => {
    const state = createGridState(planetFixture());
    state.notes = { title: 'Harbor', description: 'A quiet bay' };
    const out = await decodeMapPayload(await encodeMapPayload(state, null, META));
    expect(out.notes).toEqual({ title: 'Harbor', description: 'A quiet bay' });
    expect(out.template?.id).toBe(state.template.id);
  });

  it('opens a file whose planet is not in the library', async () => {
    const state = createGridState(planetFixture());
    const code = await buildShareCode(state, null, META, 1600);
    raster.current = { pixels: code!.rgba, width: code!.width, height: code!.height };
    expect(listPlanets()).toEqual([]);
    const inspection = await inspectImportFile(new File(['x'], 'map.png', { type: 'image/png' }), 'map.png');
    expect(inspection.status).toBe('ready');
    if (inspection.status !== 'ready') return;
    expect(inspection.preview.state.template.id).toBe(state.template.id);
    expect(listPlanets()).toEqual([]);
    let loaded: unknown = null;
    inspection.commit({ loadMap: (s) => { loaded = s; }, getSectionDeps: () => { throw new Error('unused'); } });
    expect(loaded).toBe(inspection.preview.state);
    expect(listPlanets().map((e) => e.template.id)).toEqual([state.template.id]);
  });

  it('decodes a share image without adding its planet to the library', async () => {
    const state = createGridState(planetFixture());
    const code = await buildShareCode(state, null, META, 1600);
    const png = await encodePng({ width: code!.width, height: code!.height, data: code!.rgba });
    const result = await importFromBytes(png);
    expect(result.ok && result.state.template.id).toBe(state.template.id);
    expect(listPlanets()).toEqual([]);
  });

  it('rejects a planet frame whose planet record is empty', async () => {
    const t = planetFixture();
    const bytes = await encodeMapPayload(createGridState(t), null, META);
    const record = encodeTemplateRecord(t);
    let at = -1;
    for (let i = 0; i + record.length <= bytes.length && at < 0; i++) {
      if (record.every((b, j) => bytes[i + j] === b)) at = i;
    }
    const stripped = new Uint8Array(bytes.length - record.length);
    stripped.set(bytes.subarray(0, at - 2));
    stripped.set(bytes.subarray(at + record.length), at);
    await expect(decodeMapPayload(stripped)).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('accepts a valid custom template and rejects an unknown built-in id', () => {
    const state = createGridState(planetFixture());
    const info = { templateId: state.template.id, templateHash: 0, catalogHash: 0 };
    expect(() => validateImportedState(state, { ...info, template: state.template })).not.toThrow();
    expect(() => validateImportedState(state, info)).toThrow(ShareError);
  });

  it('reports a planet too large for any code as the ordinary too-large failure', async () => {
    let s = 7;
    const next = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
    const size = 256;
    const zones = Array.from({ length: size }, () => Array.from({ length: size }, () => (next() % 5) as CellZone));
    const terrain = Uint8Array.from({ length: size * size }, () => next() % 9);
    const body = { width: size, height: size, zones, plaza: NO_PLAZA, terrain, chunkGrid: { origin: { x: 0, y: 0 }, columns: 16, rows: 16 } };
    const t = { id: planetTemplateId(body), name: { en: 'Noise' }, ...body };
    const state = createGridState(t);
    state.notes = { title: 'Noise' };
    await expect(buildShareCode(state, null, META, 1600)).rejects.toMatchObject({ code: 'decode-failed' });
  });
});

describe('the template record', () => {
  const corrupt = (fn: () => unknown) => {
    try { fn(); } catch (e) { return e instanceof ShareError && e.code === 'corrupt'; }
    return false;
  };

  it('round-trips a planet without a plaza or terrain', () => {
    const base = planetFixture({ plaza: NO_PLAZA, terrain: null });
    const zones = base.zones.map((r) => [...r]);
    zones[1]![1] = CellZone.Beach;
    zones[2]![2] = CellZone.Boundary;
    const body = { width: base.width, height: base.height, zones, plaza: NO_PLAZA, chunkGrid: { origin: { x: -16, y: 32 }, columns: 3, rows: 2 } };
    const t = { id: planetTemplateId(body), name: { en: 'Reef' }, ...body };
    const back = decodeTemplateRecord(encodeTemplateRecord(t));
    expect(back).toEqual(t);
  });

  it('drops water on cells that cannot hold it when it reads a record', () => {
    const pond = planetFixture({ water: pondMask([[30, 20]]) });
    const back = decodeTemplateRecord(encodeTemplateRecord({ ...pond, water: pondMask([[30, 20], [0, 0]]) }));
    expect(back).toEqual(pond);
  });

  it('round-trips a rotated plaza on the half grid', () => {
    const t0 = planetFixture({ plaza: landmarkAt(12.5, 3.5, 180, 2) });
    const back = decodeTemplateRecord(encodeTemplateRecord(t0));
    expect(back.plaza).toEqual(t0.plaza);
    expect(back.id).toBe(t0.id);
  });

  it('keeps a shared name within the planet name limit', () => {
    const t = { ...planetFixture(), name: { en: 'A'.repeat(40) } };
    expect(decodeTemplateRecord(encodeTemplateRecord(t)).name.en).toBe('A'.repeat(24));
  });

  it('rejects oversized dimensions before allocating', () => {
    const bytes = encodeTemplateRecord(planetFixture());
    bytes[0] = 0xff; bytes[1] = 0xff;
    expect(corrupt(() => decodeTemplateRecord(bytes))).toBe(true);
  });

  it('rejects a truncated record', () => {
    const bytes = encodeTemplateRecord(planetFixture());
    expect(corrupt(() => decodeTemplateRecord(bytes.slice(0, 10)))).toBe(true);
  });

  it('rejects a record whose plaza leaves the ground', () => {
    const bytes = encodeTemplateRecord(planetFixture());
    bytes[4] = 0; bytes[5] = 0; // plaza x at 0, over sea
    expect(corrupt(() => decodeTemplateRecord(bytes))).toBe(true);
  });

  it('rejects a frame whose template record was altered', async () => {
    const t = planetFixture();
    const bytes = await encodeMapPayload(createGridState(t), null, META);
    const record = encodeTemplateRecord(t);
    let at = -1;
    for (let i = 0; i + record.length <= bytes.length && at < 0; i++) {
      if (record.every((b, j) => bytes[i + j] === b)) at = i;
    }
    expect(at).toBeGreaterThan(0);
    const tampered = new Uint8Array(bytes);
    tampered[at + 6] = tampered[at + 6]! ^ 0x02; // plaza y moves by one cell
    await expect(decodeMapPayload(tampered)).rejects.toMatchObject({ code: 'corrupt' });
  });
});
