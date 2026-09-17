// Export codecs are pure functions of map state. Distinctive storage canaries verify that API keys,
// preferences, and session-only command history never enter saves or share payloads.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// autosave's camera read touches the live 2D/3D view registries; this suite mounts neither, so it
// gets the same "no view opened this session" answer a real cold session would (mirrors
// src/__tests__/io/autosave.test.ts's own mock).
vi.mock('../../kit/host', () => ({
  host: { camera: { get2d: () => undefined, get3d: () => undefined } },
}));

import { makeState, makeTemplate, setTerrain } from '../rules/_helpers';
import { serialize, deserialize } from '../../io/json-codec';
import { buildShareCode } from '../../io/share/export';
import { encodeMapPayload, decodeMapPayload } from '../../io/share/codec/payload';
import { toSaveJSON } from '../../io/share/canonical';
import { serializeWithSections, type ExportJsonOptions } from '../../io/export-json';
import { scheduleAutosave } from '../../io/autosave';
import { versionStore } from '../../io/stylize/versions';
import { PREFS } from '../../core/runtime/prefs';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { getPlaceableByCategory } from '../../state/catalog';
import { MAP_TEMPLATES } from '../../config/maps';
import { createGrid } from '../../core/model/grid-model';
import {
  CommandType,
  ItemCategory,
  TerrainType,
  type GridState,
  type MapTemplate,
  type PlaceObjectCommand,
} from '../../core/model/types';
import { roadLookup } from '../../state/object-index';

// jsdom's built-in localStorage is unreliable under this node version (see
// src/__tests__/agent/security/key-storage.test.ts) — back it with a real Map-based stub.
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

/** Seed every real localStorage key the app writes, each carrying either the fake secret
 *  (agent settings) or a distinctive canary (ordinary prefs). */
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

/** `makeState`'s default template id ('test') is NOT registered in the shared MAP_TEMPLATES
 *  registry, so `encodeMapPayload`'s self-verify round-trip (which resolves the template by id
 *  via `getMapTemplate`) would silently fall back to the default map and fail to decode a
 *  differently-sized grid. Register a dedicated id up front — same fix as
 *  src/__tests__/io/share/corpus.ts:namedState. */
function registeredTemplate(id: string, width: number, height: number): MapTemplate {
  const template: MapTemplate = { ...makeTemplate(width, height), id };
  MAP_TEMPLATES[id] = template;
  return template;
}

/** A real GridState with terrain + a handful of real-catalog objects (pattern from
 *  src/__tests__/io/share/corpus.ts:handEditSmall). */
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
  return new CommandExecutor(state, new EventBus(), createDefaultRegistry(), roadLookup(state));
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

    // The raw pre-glyph payload (what actually gets range-coded/compressed) — the most direct
    // thing to inspect for byte-level leakage.
    const payload = await encodeMapPayload(state, null, { appVersion: '1.0-test', saveVersion: 3 });
    const latin1 = Array.from(payload, (b) => String.fromCharCode(b)).join('');
    for (const c of CANARIES) expect(latin1).not.toContain(c);

    // Exercise the full public entry point too (rendered glyph image) — confirms it doesn't
    // crash and stays consistent with the payload above.
    const code = await buildShareCode(state, null, { appVersion: '1.0-test', saveVersion: 3 }, 1600);
    expect(code).not.toBeNull();
  });

  it('sectioned JSON export with ALL sections enabled excludes the fake key and pref values', () => {
    const state = buildStateWithObjects();
    const executor = newExecutor(state);

    const allSections: ExportJsonOptions = {
      notes: { title: 'Test Map', description: 'A test map' },
      includeGeneration: true,
      includeProvenance: true,
      history: { entries: executor.getUndoEntries(), depth: 'all' },
      session: { v: 1, lockedLayers: [], camera: { x: 0, y: 0, zoom: 1 } },
      includeStats: true,
      includeCatalogInfo: true,
      pretty: true,
    };
    const json = serializeWithSections(state, allSections);
    for (const c of CANARIES) expect(json).not.toContain(c);
  });

  it('the provenance summary has no localStorage-derived content and no token-shaped fields', () => {
    const state = buildStateWithObjects();
    const executor = newExecutor(state);
    const summary = executor.getProvenanceSummary();
    const json = JSON.stringify(summary);

    for (const c of CANARIES) expect(json).not.toContain(c);

    // MapProvenanceSummary (src/core/provenance/types.ts) today carries only booleans, numbers,
    // and short DisclosureClass enum strings ('human_created', 'mixed_human_ai', …) for `dominant`
    // / `exportDisclosure` — there is NO hash/digest/id field on this type. ALLOWLIST is therefore
    // empty; if a hash-shaped field (e.g. a content hash) is ever added to MapProvenanceSummary,
    // name it here rather than loosening the regex.
    const ALLOWLISTED_FIELD_NAMES: readonly string[] = [];
    void ALLOWLISTED_FIELD_NAMES;
    const tokenShaped = /[A-Za-z0-9_-]{24,}/g;
    const matches = json.match(tokenShaped) ?? [];
    expect(matches).toEqual([]);
  });

  // ── Self-check: prove the marker-detection assertions above would actually fire on a real
  //    leak, rather than passing vacuously (e.g. from a typo'd canary that can never match). ──
  describe('self-check: marker detection actually fires (negative control)', () => {
    it('a tampered copy of a real serialize() output WITH the marker injected fails the same assertion', () => {
      const state = buildStateWithObjects();
      const clean = serialize(state);
      expect(clean).not.toContain(MARKER); // the real output stays clean, as pinned above

      const tampered = `${clean}::${MARKER}`;
      expect(tampered).toContain(MARKER); // sanity: the marker string itself is well-formed
      expect(() => expect(tampered).not.toContain(MARKER)).toThrow();
    });

    it('a tampered copy of the payload latin1 string WITH a canary injected fails the same assertion', async () => {
      const state = buildStateWithObjects();
      const payload = await encodeMapPayload(state, null, { appVersion: '1.0-test', saveVersion: 3 });
      const latin1 = Array.from(payload, (b) => String.fromCharCode(b)).join('');
      const tampered = latin1 + ZOOM_CANARY;
      expect(() => expect(tampered).not.toContain(ZOOM_CANARY)).toThrow();
    });

    it('the token-shaped regex used on the provenance summary actually matches an injected token', () => {
      const tokenShaped = /[A-Za-z0-9_-]{24,}/g;
      const withToken = JSON.stringify({ ok: true, evil: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
      const matches = withToken.match(tokenShaped) ?? [];
      expect(matches.length).toBeGreaterThan(0);
      expect(() => expect(matches).toEqual([])).toThrow();
    });
  });
});

// Command history belongs to CommandExecutor rather than GridState. The payload must therefore be
// identical for equal live states regardless of undo depth, and decoding must recover only live values.
describe('history/undo state never enters share payloads', () => {
  const SHARED_TEMPLATE_ID = 'secret-exclusion-history-shared';
  // Elevations kept at 1-3 so layers auto-pass the 3x3 base rule (V-MTN-03) — no support
  // scaffolding needed to keep every intermediate stroke post-stroke-valid.
  const MARKER_ELEV = 3; // painted, then overwritten — survives only inside undo entries
  const FINAL_ELEV = 1; // the live value at that same cell after the overwrite

  function freshState(): GridState {
    const template = registeredTemplate(SHARED_TEMPLATE_ID, 24, 24);
    return { ...makeState(24, 24), template, cells: createGrid(template) };
  }

  /** Builds a state via REAL CommandExecutor edits, accumulating undo depth ≥3, with a marker
   *  value that exists only in history (never in the final live state). */
  function buildStateWithHistory(): { state: GridState; executor: CommandExecutor } {
    const state = freshState();
    const executor = newExecutor(state);

    const paint = (x: number, y: number, elevation: number, terrainType = TerrainType.Mountain) => {
      const start = executor.getUndoStackSize();
      const res = executor.execute({
        type: CommandType.PaintTerrain, timestamp: 0,
        cells: [{ x, y }], terrainType, elevation,
      });
      if (!res.success) throw new Error(`test setup: paint(${x},${y},${elevation}) rejected: ${JSON.stringify(res.errors)}`);
      executor.commitStroke(start);
    };

    // V-MTN-02 (no floating blocks) requires each RAISE to build on the elevation already at that
    // cell — you can't jump straight to elevation 3 on empty ground — so ramp 1→2→3 (three
    // entries), then drop straight back down to FINAL_ELEV in one more entry (a decrease always
    // passes the floating check). MARKER_ELEV now exists in entry snapshots (the ramp's last
    // entry.after and the drop's entry.before) but never in the live final state.
    paint(3, 3, 1);
    paint(3, 3, 2);
    paint(3, 3, MARKER_ELEV);
    paint(3, 3, FINAL_ELEV); // entry: before=elev MARKER_ELEV, after=elev FINAL_ELEV (the live value)

    paint(10, 10, 0, TerrainType.Water);

    const item = getPlaceableByCategory(ItemCategory.Flora)[0]!;
    const placeStart = executor.getUndoStackSize();
    executor.execute({
      type: CommandType.PlaceObject, timestamp: 0,
      object: {
        id: 'hist-o0', catalogId: item.id, position: { x: 15, y: 15 },
        rotation: 0, elevation: 0,
      },
      loadValue: item.loadValue ?? 0,
    } as PlaceObjectCommand);
    executor.commitStroke(placeStart); // undo depth is well past the ≥3 requirement by this point

    // Paint-then-undo: this cell's Water value exists ONLY in the redo stack afterward — not in
    // getUndoEntries() (the undo stack) and not in the live state, which reverts to fully empty.
    paint(18, 18, 0, TerrainType.Water);
    executor.undo();

    return { state, executor };
  }

  /** The SAME final content as buildStateWithHistory()'s end state, built with plain cell/object
   *  writes and NO CommandExecutor at all — so it carries zero history. */
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

    expect(executor.getUndoStackSize()).toBeGreaterThanOrEqual(3);

    // The marker is genuinely IN history (not a vacuous check) — keyed by (coord, value) so it
    // can't accidentally match an unrelated cell that legitimately carries the same elevation.
    const entries = executor.getUndoEntries();
    const at = (e: (typeof entries)[number], x: number, y: number) =>
      [...e.before, ...e.after].filter((s) => s.coord.x === x && s.coord.y === y);

    const historyHasMarker = entries.some((e) => at(e, 3, 3).some((s) => s.cell.terrain?.elevation === MARKER_ELEV));
    expect(historyHasMarker).toBe(true);
    // The redo-only marker never appears in the undo stack at all (it's one entry further back,
    // in the redo stack — getUndoEntries() only exposes the undo stack).
    const historyHasRedoOnlyMarker = entries.some((e) => at(e, 18, 18).some((s) => s.cell.terrain?.type === TerrainType.Water));
    expect(historyHasRedoOnlyMarker).toBe(false);

    // ...but is ABSENT from the live state, which only ever shows the final values.
    expect(state.cells[3]![3]!.terrain?.elevation).toBe(FINAL_ELEV);
    expect(state.cells[18]![18]!.terrain).toBeNull();
  });

  it('share payload bytes from an executor-built state (real undo history) are byte-identical to a state built with NO executor/history at all', async () => {
    const { state: execState, executor } = buildStateWithHistory();
    expect(executor.getUndoStackSize()).toBeGreaterThanOrEqual(3);

    const directState = buildStateDirectEquivalent();
    // Sanity: these are genuinely two independent constructions, not the same object compared to itself.
    expect(execState).not.toBe(directState);
    expect(execState.cells).not.toBe(directState.cells);

    const meta = { appVersion: '1.0-test', saveVersion: 3 };
    const execPayload = await encodeMapPayload(execState, null, meta);
    const directPayload = await encodeMapPayload(directState, null, meta);
    expect(Array.from(execPayload)).toEqual(Array.from(directPayload));

    // Same pin at the full public entry point (rendered glyph): identical payload length and
    // identical rendered pixels either way.
    const execCode = await buildShareCode(execState, null, meta, 1600);
    const directCode = await buildShareCode(directState, null, meta, 1600);
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

    // decoded.canonical.cells is RLE-encoded (same shape as a save file's `cells` field) —
    // round-trip it through the real save codec to inspect actual per-cell terrain.
    const rebuilt = deserialize(toSaveJSON(decoded.canonical), state.template);

    expect(rebuilt.cells[3]![3]!.terrain?.type).toBe(TerrainType.Mountain);
    expect(rebuilt.cells[3]![3]!.terrain?.elevation).toBe(FINAL_ELEV);
    expect(rebuilt.cells[3]![3]!.terrain?.elevation).not.toBe(MARKER_ELEV);

    // (18,18) was painted then undone — the live state (and thus the payload) never saw it.
    expect(rebuilt.cells[18]![18]!.terrain).toBeNull();
  });
});

// The stylize API key is sealed in settings and generated pictures live only in `versionStore`.
// Neither is an input to a map save or share codec.
describe('stylize secrets never enter a payload', () => {
  const STYLIZE_KEY_CANARY = 'CANARY-STYLIZE-SEALED-KEY-1a2b3c4d5e6f';
  const STYLIZE_BITMAP_CANARY = 'CANARY-STYLIZE-BITMAP-9f8e7d6c5b4a3f2e';

  /** The real on-disk shape (`StoredRecord` in settings.ts): the canary rides in the fields a real
   *  key/prompt would occupy, including `keySealed`, which is where an ENCRYPTED key ciphertext
   *  lives on a real machine — planting it in plain here proves the codecs never read this record
   *  at all, encrypted or not. */
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

  it('a settings-record key and a minted version bitmap reach no save payload, share payload, exported JSON section, or autosave blob', async () => {
    const img = new Image();
    img.src = `data:image/png;base64,${btoa(STYLIZE_BITMAP_CANARY)}`;
    versionStore.mint({ kind: 'model', direction: 'watercolor', image: img, fingerprint: versionStore.currentFingerprint() });
    expect(versionStore.getState().versions).toHaveLength(1); // the mint actually happened

    const state = buildStateWithObjects();

    const save = serialize(state);
    expect(save).not.toContain(STYLIZE_KEY_CANARY);
    expect(save).not.toContain(STYLIZE_BITMAP_CANARY);

    const payload = await encodeMapPayload(state, null, { appVersion: '1.0-test', saveVersion: 3 });
    const latin1 = Array.from(payload, (b) => String.fromCharCode(b)).join('');
    expect(latin1).not.toContain(STYLIZE_KEY_CANARY);
    expect(latin1).not.toContain(STYLIZE_BITMAP_CANARY);
    const code = await buildShareCode(state, null, { appVersion: '1.0-test', saveVersion: 3 }, 1600);
    expect(code).not.toBeNull();

    const allSections: ExportJsonOptions = {
      notes: { title: 'Test Map', description: 'A test map' },
      includeGeneration: true,
      includeProvenance: true,
      session: { v: 1, lockedLayers: [], camera: { x: 0, y: 0, zoom: 1 } },
      includeStats: true,
      includeCatalogInfo: true,
      pretty: true,
    };
    const exported = serializeWithSections(state, allSections);
    expect(exported).not.toContain(STYLIZE_KEY_CANARY);
    expect(exported).not.toContain(STYLIZE_BITMAP_CANARY);

    vi.useFakeTimers();
    scheduleAutosave(state);
    vi.advanceTimersByTime(2000);
    const autosaved = localStorage.getItem(PREFS.autosave.key);
    expect(autosaved).not.toBeNull();
    expect(autosaved).not.toContain(STYLIZE_KEY_CANARY);
    expect(autosaved).not.toContain(STYLIZE_BITMAP_CANARY);
  });

  // ── Self-check: prove these two canaries would actually fire on a real leak. ──────────────────
  describe('self-check: the stylize canaries actually fire (negative control)', () => {
    it('a tampered save payload with the sealed-key canary injected fails the same assertion', () => {
      const state = buildStateWithObjects();
      const clean = serialize(state);
      expect(clean).not.toContain(STYLIZE_KEY_CANARY);
      const tampered = `${clean}::${STYLIZE_KEY_CANARY}`;
      expect(() => expect(tampered).not.toContain(STYLIZE_KEY_CANARY)).toThrow();
    });

    it('a tampered autosave blob with the bitmap canary injected fails the same assertion', () => {
      vi.useFakeTimers();
      const state = buildStateWithObjects();
      scheduleAutosave(state);
      vi.advanceTimersByTime(2000);
      const clean = localStorage.getItem(PREFS.autosave.key);
      expect(clean).not.toBeNull();
      expect(clean).not.toContain(STYLIZE_BITMAP_CANARY);
      const tampered = `${clean}::${STYLIZE_BITMAP_CANARY}`;
      expect(() => expect(tampered).not.toContain(STYLIZE_BITMAP_CANARY)).toThrow();
    });
  });
});
