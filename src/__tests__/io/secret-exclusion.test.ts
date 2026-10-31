// @vitest-environment jsdom
// Export codecs are pure functions of map state. Distinctive storage canaries verify that API keys,
// preferences, and session-only command history never enter saves or share payloads.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Autosave's camera read touches the live view registries; with no view mounted it gets the answer a
// cold session would.
vi.mock('../../editor/host/host', () => ({
  host: { camera: { get2d: () => undefined, get3d: () => undefined } },
}));

import { makeState, makeTemplate, setTerrain, makeExecutor } from '../_support/map-state';
import { serialize } from '../../io/save/json-codec';
import { deserialize } from '../_support/save-file';
import { buildShareCode } from '../../io/share/export';
import { encodeMapPayload, decodeMapPayload } from '../../io/share/codec/payload';
import { toSaveJSON } from '../../io/save/canonical';
import { carrying, serializeWithSections, type ExportJsonOptions } from '../../io/save/sections';
import { autosave } from '../../editor/session/autosave';
import { versionStore } from '../../state/stylize-versions';
import { PREFS } from '../../platform/storage/prefs';
import { CommandExecutor } from '../../core/commands/command-executor';
import { getPlaceableByCategory } from '../../state/catalog';
import { MAP_TEMPLATES } from '../../config/maps';
import { createGrid } from '../../core/model/grid-model';
import { CommandType, TerrainType, type GridState, type MapTemplate, type PlaceObjectCommand } from '../../core/model/types';
import { exportable } from '../_support/exportable';
import { ItemCategory } from '../../config/catalog/categories';

// jsdom's built-in localStorage is unreliable under this Node version, so a Map backs it.
const backing = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

const MARKER = 'sk-FAKESECRET1234567890abcdef';
const LOCALE_CANARY = 'zz-CANARY-LOCALE-9f8e7d6c5b4a';
const ZOOM_CANARY = '4242424.242424';
const AUTOSAVE_CANARY = 'CANARY-AUTOSAVE-VALUE-0011223344';
const CANARIES = [MARKER, LOCALE_CANARY, ZOOM_CANARY, AUTOSAVE_CANARY];

/** Mirrors key-storage.ts's private `enc()` (base64 obfuscation of the fallback key path). */
function obfuscate(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

/** Seeds every localStorage key the app writes with the fake secret (agent settings) or a canary. */
function seedLocalStorage(): void {
  backing.clear();
  localStorage.setItem(
    'petit-agent-settings-v1',
    JSON.stringify({
      provider: 'claude',
      model: { claude: 'claude-opus-4-8' },
      keys: { claude: obfuscate(MARKER) },
      askBeforeEdits: false,
    }),
  );
  localStorage.setItem('petit-planet-locale', LOCALE_CANARY);
  localStorage.setItem('petit-planet-ui-zoom', ZOOM_CANARY);
  localStorage.setItem('petit-planet-autosave', JSON.stringify({ marker: AUTOSAVE_CANARY }));
}

/** `encodeMapPayload`'s self-verify resolves the template by id, and `makeState`'s 'test' id is not
 *  registered, so it would fall back to the default map and fail to decode a differently sized grid. */
function registeredTemplate(id: string, width: number, height: number): MapTemplate {
  const template: MapTemplate = { ...makeTemplate(width, height), id };
  MAP_TEMPLATES[id] = template;
  return template;
}

/** A GridState with terrain and a handful of real-catalog objects. */
function buildStateWithObjects(): GridState {
  const template = registeredTemplate('secret-exclusion-test', 24, 24);
  const state: GridState = { ...makeState(24, 24), template, cells: createGrid(template) };
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);

  const floraItems = getPlaceableByCategory(ItemCategory.Flora);
  for (let i = 0; i < 6; i++) {
    const item = floraItems[i % floraItems.length]!;
    const id = `sec-o${i}`;
    state.objects.set(id, {
      id,
      catalogId: item.id,
      position: { x: 10 + i, y: 10 },
      rotation: 0,
      elevation: 0,
    });
  }
  return state;
}

function newExecutor(state: GridState): CommandExecutor {
  return makeExecutor(state);
}

describe('secret exclusion — codecs never touch storage', () => {
  beforeEach(() => seedLocalStorage());

  it('serialize(state) contains neither the fake key nor any localStorage pref value', () => {
    const state = buildStateWithObjects();
    const json = serialize(state);
    for (const c of CANARIES) expect(json).not.toContain(c);
  });

  it('buildShareCode payload bytes (decoded as latin1) contain neither the fake key nor any pref value', async () => {
    const state = buildStateWithObjects();

    // The raw pre-glyph payload is the most direct place to look for byte-level leakage.
    const payload = await encodeMapPayload(state, null, { appVersion: '1.0-test', saveVersion: 3 });
    const latin1 = Array.from(payload, (b) => String.fromCharCode(b)).join('');
    for (const c of CANARIES) expect(latin1).not.toContain(c);

    // The full public entry point (rendered glyph image) too.
    const code = await buildShareCode(exportable(state), null, { appVersion: '1.0-test', saveVersion: 3 }, 1600);
    expect(code).not.toBeNull();
  });

  it('[FILE-07] sectioned JSON export with ALL sections enabled excludes the fake key and pref values', () => {
    const state = buildStateWithObjects();
    const executor = newExecutor(state);

    const allSections: ExportJsonOptions = {
      carry: carrying('annotations', 'notes', 'generation', 'provenance', 'history', 'session', 'stats', 'catalog'),
      notes: { title: 'Test Map', description: 'A test map' },
      history: { entries: executor.getUndoEntries(), depth: 'all' },
      session: { lockedLayers: [], camera: { view2d: { x: 0, y: 0, zoom: 1 } } },
      pretty: true,
    };
    const json = serializeWithSections(exportable(state), allSections);
    for (const c of CANARIES) expect(json).not.toContain(c);
  });

  it('the provenance summary has no localStorage-derived content and no token-shaped fields', () => {
    const state = buildStateWithObjects();
    const executor = newExecutor(state);
    const summary = executor.getProvenanceSummary();
    const json = JSON.stringify(summary);

    for (const c of CANARIES) expect(json).not.toContain(c);

    // MapProvenanceSummary carries only booleans, numbers and short DisclosureClass strings, so no
    // value may look like a token.
    const tokenShaped = /[A-Za-z0-9_-]{24,}/g;
    const matches = json.match(tokenShaped) ?? [];
    expect(matches).toEqual([]);
  });
});

// Command history belongs to CommandExecutor rather than GridState. The payload must therefore be
// identical for equal live states regardless of undo depth, and decoding must recover only live values.
describe('history/undo state never enters share payloads', () => {
  const SHARED_TEMPLATE_ID = 'secret-exclusion-history-shared';
  // Elevations stay at 1 to 3 so every intermediate stroke passes the 3x3 base rule (V-MTN-03)
  // without support scaffolding.
  const MARKER_ELEV = 3; // painted, then overwritten: survives only inside undo entries
  const FINAL_ELEV = 1; // the live value at that same cell after the overwrite

  function freshState(): GridState {
    const template = registeredTemplate(SHARED_TEMPLATE_ID, 24, 24);
    return { ...makeState(24, 24), template, cells: createGrid(template) };
  }

  /** Builds a state through CommandExecutor edits (undo depth ≥3) with a marker value that exists
   *  only in history. */
  function buildStateWithHistory(): { state: GridState; executor: CommandExecutor } {
    const state = freshState();
    const executor = newExecutor(state);

    const paint = (x: number, y: number, elevation: number, terrainType = TerrainType.Mountain) => {
      const start = executor.beginStroke();
      const res = executor.execute({
        type: CommandType.PaintTerrain,         cells: [{ x, y }], terrainType, elevation,
      });
      if (!res.success) throw new Error(`test setup: paint(${x},${y},${elevation}) rejected: ${JSON.stringify(res.errors)}`);
      start.commit();
    };

    // No floating blocks (V-MTN-02) means each raise builds on the elevation below, so ramp 1, 2, 3,
    // then drop to FINAL_ELEV in one entry (a decrease always passes). MARKER_ELEV is left in entry
    // snapshots only.
    paint(3, 3, 1);
    paint(3, 3, 2);
    paint(3, 3, MARKER_ELEV);
    paint(3, 3, FINAL_ELEV); // entry: before=elev MARKER_ELEV, after=elev FINAL_ELEV (the live value)

    paint(10, 10, 0, TerrainType.Water);

    const item = getPlaceableByCategory(ItemCategory.Flora)[0]!;
    const placeStart = executor.beginStroke();
    executor.execute({
      type: CommandType.PlaceObject,       object: {
        id: 'hist-o0', catalogId: item.id, position: { x: 15, y: 15 },
        rotation: 0, elevation: 0,
      },
      loadValue: item.loadValue ?? 0,
    } as PlaceObjectCommand);
    placeStart.commit(); // undo depth is well past the ≥3 requirement by this point

    // Paint then undo: this Water value exists only in the redo stack; the live cell reverts to empty.
    paint(18, 18, 0, TerrainType.Water);
    executor.undo();

    return { state, executor };
  }

  /** `buildStateWithHistory`'s end state, written directly with no executor and so no history. */
  function buildStateDirectEquivalent(): GridState {
    const state = freshState();
    setTerrain(state, 3, 3, TerrainType.Mountain, FINAL_ELEV);
    setTerrain(state, 10, 10, TerrainType.Water, 0);
    const item = getPlaceableByCategory(ItemCategory.Flora)[0]!;
    state.objects.set('direct-o0', {
      id: 'direct-o0', catalogId: item.id, position: { x: 15, y: 15 },
      rotation: 0, elevation: 0,
    });
    return state;
  }

  it('accumulates real undo history (depth ≥3) with a marker value present only in history', () => {
    const { state, executor } = buildStateWithHistory();

    expect(executor.historyDepth()).toBeGreaterThanOrEqual(3);

    // Keyed by coordinate and value, so an unrelated cell at the same elevation cannot match.
    const entries = executor.getUndoEntries();
    const at = (e: (typeof entries)[number], x: number, y: number) =>
      [...e.before, ...e.after].filter((s) => s.coord.x === x && s.coord.y === y);

    const historyHasMarker = entries.some((e) => at(e, 3, 3).some((s) => s.cell.terrain?.elevation === MARKER_ELEV));
    expect(historyHasMarker).toBe(true);
    // getUndoEntries() exposes only the undo stack, so the redo-only marker is absent.
    const historyHasRedoOnlyMarker = entries.some((e) => at(e, 18, 18).some((s) => s.cell.terrain?.type === TerrainType.Water));
    expect(historyHasRedoOnlyMarker).toBe(false);

    expect(state.cells[3]![3]!.terrain?.elevation).toBe(FINAL_ELEV);
    expect(state.cells[18]![18]!.terrain).toBeNull();
  });

  it('share payload bytes from an executor-built state (real undo history) are byte-identical to a state built with NO executor/history at all', async () => {
    const { state: execState, executor } = buildStateWithHistory();
    expect(executor.historyDepth()).toBeGreaterThanOrEqual(3);

    const directState = buildStateDirectEquivalent();
    expect(execState).not.toBe(directState);
    expect(execState.cells).not.toBe(directState.cells);

    const meta = { appVersion: '1.0-test', saveVersion: 3 };
    const execPayload = await encodeMapPayload(execState, null, meta);
    const directPayload = await encodeMapPayload(directState, null, meta);
    expect(Array.from(execPayload)).toEqual(Array.from(directPayload));

    // The full public entry point renders identical pixels either way.
    const execCode = await buildShareCode(exportable(execState), null, meta, 1600);
    const directCode = await buildShareCode(exportable(directState), null, meta, 1600);
    expect(execCode).not.toBeNull();
    expect(directCode).not.toBeNull();
    expect(execCode!.payloadLen).toBe(directCode!.payloadLen);
    expect(Array.from(execCode!.rgba)).toEqual(Array.from(directCode!.rgba));
  });

  it('decoding the payload recovers only the LIVE final values, never the superseded/undone history markers', async () => {
    const { state } = buildStateWithHistory();
    const meta = { appVersion: '1.0-test', saveVersion: 3 };
    const payload = await encodeMapPayload(state, null, meta);
    const decoded = await decodeMapPayload(payload);

    // decoded.canonical.cells is RLE-encoded like a save file's, so the save codec expands it.
    const rebuilt = deserialize(toSaveJSON(decoded.canonical), state.template);

    expect(rebuilt.cells[3]![3]!.terrain?.type).toBe(TerrainType.Mountain);
    expect(rebuilt.cells[3]![3]!.terrain?.elevation).toBe(FINAL_ELEV);
    expect(rebuilt.cells[3]![3]!.terrain?.elevation).not.toBe(MARKER_ELEV);

    // (18,18) was painted then undone.
    expect(rebuilt.cells[18]![18]!.terrain).toBeNull();
  });
});

// The stylize API key is sealed in settings and generated pictures live only in `versionStore`.
// Neither is an input to a map save or share codec.
describe('stylize secrets never enter a payload', () => {
  const STYLIZE_KEY_CANARY = 'CANARY-STYLIZE-SEALED-KEY-1a2b3c4d5e6f';
  const STYLIZE_BITMAP_CANARY = 'CANARY-STYLIZE-BITMAP-9f8e7d6c5b4a3f2e';

  /** The on-disk `StoredRecord` shape with the canary in plain in every key and prompt field,
   *  `keySealed` included, so a pass proves the codecs never read the record, encrypted or not. */
  function seedStylizeSettings(): void {
    localStorage.setItem(
      PREFS.stylize.key,
      JSON.stringify({
        provider: 'gemini',
        model: STYLIZE_KEY_CANARY,
        customBaseUrl: '',
        direction: 'watercolor',
        customPrompt: STYLIZE_KEY_CANARY,
        keySealed: { iv: 'AAAAAAAAAAAAAAAA', ct: STYLIZE_KEY_CANARY },
      }),
    );
  }

  beforeEach(() => {
    seedLocalStorage();
    seedStylizeSettings();
    versionStore.reset();
  });
  afterEach(() => {
    versionStore.reset();
    vi.useRealTimers();
  });

  it('[FILE-07] a settings-record key and a minted version bitmap reach no save payload, share payload, exported JSON section, or autosave blob', async () => {
    const img = new Image();
    img.src = `data:image/png;base64,${btoa(STYLIZE_BITMAP_CANARY)}`;
    versionStore.mint({ kind: 'model', direction: 'watercolor', image: img, mapEdit: versionStore.currentMapEdit() });
    expect(versionStore.getState().versions).toHaveLength(1);

    const state = buildStateWithObjects();

    const save = serialize(state);
    expect(save).not.toContain(STYLIZE_KEY_CANARY);
    expect(save).not.toContain(STYLIZE_BITMAP_CANARY);

    const payload = await encodeMapPayload(state, null, { appVersion: '1.0-test', saveVersion: 3 });
    const latin1 = Array.from(payload, (b) => String.fromCharCode(b)).join('');
    expect(latin1).not.toContain(STYLIZE_KEY_CANARY);
    expect(latin1).not.toContain(STYLIZE_BITMAP_CANARY);
    const code = await buildShareCode(exportable(state), null, { appVersion: '1.0-test', saveVersion: 3 }, 1600);
    expect(code).not.toBeNull();

    const allSections: ExportJsonOptions = {
      carry: carrying('annotations', 'notes', 'generation', 'provenance', 'session', 'stats', 'catalog'),
      notes: { title: 'Test Map', description: 'A test map' },
      session: { lockedLayers: [], camera: { view2d: { x: 0, y: 0, zoom: 1 } } },
      pretty: true,
    };
    const exported = serializeWithSections(exportable(state), allSections);
    expect(exported).not.toContain(STYLIZE_KEY_CANARY);
    expect(exported).not.toContain(STYLIZE_BITMAP_CANARY);

    vi.useFakeTimers();
    autosave.schedule(state);
    vi.advanceTimersByTime(2000);
    const autosaved = localStorage.getItem(PREFS.autosave.key);
    expect(autosaved).not.toBeNull();
    expect(autosaved).not.toContain(STYLIZE_KEY_CANARY);
    expect(autosaved).not.toContain(STYLIZE_BITMAP_CANARY);
  });
});
