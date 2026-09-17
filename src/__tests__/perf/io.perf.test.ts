/*
 * io.perf.test.ts — save/load and the share-code pipeline's operation costs.
 *
 * Covers what a Save, a Load and a "copy share code" press pay for: the plain JSON codec (the
 * autosave/save-file path), the PetitGlyph range-coded payload (the visible glyph's byte frame,
 * not the raster it rides in — that needs a canvas and lives in the io/share suite's own tests),
 * the undo-stack codec a JSON export's history section runs through, and the sectioned export's
 * pure assembly. See `_harness.ts` for the gate and methodology.
 */
import { describe, it } from 'vitest';
import { PERF, perfSuite } from './_harness';
import { denseIsland, islandConfig, templateWorld } from './_fixtures';
import { serialize, deserialize } from '../../io/json-codec';
import { encodeMapPayload, decodeMapPayload } from '../../io/share/codec/payload';
import { encodeHistory, decodeHistory, type HistoryBounds } from '../../io/history-codec';
import { serializeWithSections } from '../../io/export-json';
import { generateTerrain } from '../../tools/generation/terrain-generator';
import type { ShareCodeMeta } from '../../io/share/codec/payload';

const s = perfSuite('io');
const enc = new TextEncoder();
const byteLen = (str: string) => enc.encode(str).length;

describe.runIf(PERF)('perf: io', () => {
  it('json codec: serialize and deserialize the dense map', async () => {
    const { state } = denseIsland();
    let json = '';
    await s.bench('json/serialize', () => { json = serialize(state); }, {
      meta: { objects: state.objects.size },
    });
    json = serialize(state);
    await s.bench('json/deserialize', () => { deserialize(json, state.template); }, {
      meta: { bytes: byteLen(json) },
    });
  });

  it('share codec: encode and decode the dense map as a PetitGlyph payload', async () => {
    const { state } = denseIsland();
    const meta: ShareCodeMeta = { appVersion: 'perf', saveVersion: 1 };
    let payload: Uint8Array = new Uint8Array(0);
    await s.bench('share/encode-map', async () => { payload = await encodeMapPayload(state, null, meta); }, {
      minSamples: 3, maxSamples: 20,
    });
    payload = await encodeMapPayload(state, null, meta);
    await s.bench('share/decode-map', async () => { await decodeMapPayload(payload); }, {
      meta: { bytes: payload.length },
    });
  });

  it('history codec: encode and decode a ~100-entry undo stack', async () => {
    // A real editing session's undo stack, not a synthetic one: run the designed generator over
    // a fresh template WITHOUT collapsing the stroke, so every PaintTerrain/TrimCorners/PlaceObject
    // it issues keeps its own entry, then take the tail — the shape an editor actually accumulates.
    const world = templateWorld();
    generateTerrain(islandConfig(4242), world.state, (c) => world.executor.execute(c), world.executor.getRegistry());
    const entries = world.executor.getUndoEntries().slice(-100);
    const bounds: HistoryBounds = { width: world.state.template.width, height: world.state.template.height };

    let section = encodeHistory(entries, 'all');
    await s.bench('history/encode', () => { section = encodeHistory(entries, 'all'); }, {
      meta: { entries: entries.length },
    });
    await s.bench('history/decode', () => { decodeHistory(section, bounds); });
  });

  it('sectioned JSON export: pure assembly over the dense map', async () => {
    const { state } = denseIsland();
    const opts = {
      includeGeneration: true,
      includeProvenance: true,
      history: null,
      session: null,
      includeStats: true,
      includeCatalogInfo: true,
      pretty: false,
    };
    const out = serializeWithSections(state, opts);
    await s.bench('export/sections-pure', () => { serializeWithSections(state, opts); }, {
      meta: { bytes: byteLen(out) },
    });
  });
});
