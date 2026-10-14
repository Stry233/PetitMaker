/*
 * What the largest custom planet costs against the readme map.
 *
 * The baseline is the hand-built share map (`docs/media/share-map.png`, 169 × 140 hexia). Two
 * 256 × 256 planets carry that build copied over them and then settled by the rules: the
 * `worstCasePlanet()` archipelago, held to four times the baseline (it has 2.8 times the cells, so
 * a linear operation stays under the bound and a superlinear one does not), and a planet whose
 * ground fills the whole canvas, reported beside it. With PETIT_PERF_DUMP set to a directory, the
 * share map and the two filled maps are written there as save files for browser measurements. See `_harness.ts` for
 * the gate and methodology.
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PERF, perfSuite } from './_harness';
import { islandConfig, makeWorld, type World } from './_fixtures';
import { landmarkAt, worstCasePlanet } from '../_support/planet';
import { importFromBytes } from '../../io/share/import';
import { buildSaveFile, serialize } from '../../io/save/json-codec';
import { encodeMapPayload, type ShareCodeMeta } from '../../io/share/codec/payload';
import { evaluateMap } from '../_support/design-eval';
import { transferPreviewOf } from '../../tools/generation/run/planet-preview';
import { reviveTransferPreview, wireGrid, type WireTransferPreview } from '../../tools/generation/run/candidate-wire';
import { encodeCells } from '../../core/model/grid-wire';
import { buildTransfer } from '../../tools/generation/transfer';
import { sessionPlanet } from '../../editor/operations/planet-session';
import { getMapTemplate } from '../../config/maps';
import { planetTemplateId, PLANET_MAX_CELLS } from '../../core/model/planet';
import { createGridState } from '../../core/model/template';
import { deriveBoundary, refreshBoundary } from '../../core/model/shore';
import { PLANET_CANVAS_ID_PREFIX } from '../../tools/generation/run/planet-canvas';
import { PLANET_PROFILE, CHUNK_SIZE } from '../../core/game/profile';
import { ANCHOR_LANDMARK } from '../_support/anchor';
import { validatePlanetTemplate } from '../../core/model/planet-validate';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { footprintCells } from '../../core/grid/footprint';
import { CommandType, TerrainType, type GridState, type MacroCell, type MacroCoord, type MapTemplate, type PaintTerrainCommand } from '../../core/model/types';
import { CellZone } from '../../core/game/zones';
import { CommandExecutor } from '../../core/commands/command-executor';
import { createPlanetRegistry } from '../../rules/index';
import { createExecutor } from '../../state/executor';
import { generateWith } from '../_support/generation';

vi.setConfig({ testTimeout: 120_000 });

const s = perfSuite('custom-planet');
const META: ShareCodeMeta = { appVersion: 'perf', saveVersion: 1 };
/** The glyph's largest payload (`io/share/glyph/profiles.ts:planFor`). */
const GLYPH_MAX_PAYLOAD = 12_000;
const BOUND = 4;

let shareMap: GridState | null = null;
async function readShareMap(): Promise<GridState> {
  if (shareMap) return shareMap;
  const res = await importFromBytes(readFileSync('docs/media/share-map.png'));
  if (!res.ok) throw new Error(`share-map.png: ${res.error.code}`);
  shareMap = res.state;
  return shareMap;
}

/** The largest drawable ground: every cell of the 256 × 256 canvas grass inside a three-cell sea
 *  margin, the plaza in the middle. */
function fullGroundPlanet(): MapTemplate {
  const n = PLANET_MAX_CELLS, m = 3;
  const zones = deriveBoundary(Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x): CellZone =>
    (x >= m && y >= m && x < n - m && y < n - m ? CellZone.Grass : CellZone.Void))));
  const plaza = landmarkAt(n / 2 - ANCHOR_LANDMARK.width / 2 + 0.5, n / 2 - ANCHOR_LANDMARK.height / 2);
  const body = {
    width: n, height: n, zones, landmarks: [plaza],
    chunkGrid: { origin: { x: 0, y: 0 }, columns: PLANET_PROFILE.maxChunks, rows: PLANET_PROFILE.maxChunks },
  };
  const t: MapTemplate = { id: planetTemplateId(body), name: { en: 'Full' }, ...body };
  if (validatePlanetTemplate(t) !== null) throw new Error('fullGroundPlanet: invalid fixture');
  return t;
}

const cellKey = (x: number, y: number) => `${x},${y}`;
const elevationOf = (c: MacroCell | undefined) => c?.terrain?.elevation ?? 0;

/**
 * `template` with `src`'s build copied over it until its terrain covers as much of its grass as
 * the build covers of its own. Each pass lays the build at a shifted offset: terrain onto bare free
 * grass, then every unlocked object whose footprint lands whole on free grass at the elevations it
 * stood on in `src`.
 */
function filled(src: GridState, template: MapTemplate): GridState {
  const dest = createGridState(template);
  const { width, height } = template;
  const taken = new Set<string>();
  for (const o of dest.objects.values()) {
    const { w, h } = getPlacedObjectSize(o);
    for (const c of footprintCells(o.position.x, o.position.y, w, h)) taken.add(cellKey(c.x, c.y));
  }
  const free = (x: number, y: number) => dest.cells[y]?.[x]?.zone === CellZone.Grass && !taken.has(cellKey(x, y));
  const target = census(src).terrain / census(src).grass;
  const pw = src.template.width, ph = src.template.height;
  const shifts = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5], [0.25, 0.25], [0.75, 0.75], [0.25, 0.75], [0.75, 0.25]] as const;
  let pass = 0;
  for (const [fx, fy] of shifts) {
    const c = census(dest);
    if (c.terrain / c.grass >= target) break;
    const cx = Math.round((width - pw) / 2 + fx * pw), cy = Math.round((height - ph) / 2 + fy * ph);
    for (let oy = cy - Math.ceil(cy / ph) * ph; oy < height; oy += ph) for (let ox = cx - Math.ceil(cx / pw) * pw; ox < width; ox += pw) {
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
        const t = src.cells[y]![x]!.terrain;
        if (t && free(x + ox, y + oy) && !dest.cells[y + oy]![x + ox]!.terrain) dest.cells[y + oy]![x + ox]!.terrain = structuredClone(t);
      }
      for (const o of src.objects.values()) {
        if (o.locked) continue;
        const { w, h } = getPlacedObjectSize(o);
        const cells = footprintCells(o.position.x + ox, o.position.y + oy, w, h);
        if (!cells.every((d) => free(d.x, d.y) && elevationOf(dest.cells[d.y]![d.x]) === elevationOf(src.cells[d.y - oy]?.[d.x - ox]))) continue;
        for (const d of cells) taken.add(cellKey(d.x, d.y));
        const id = `${o.id}~${pass}:${ox},${oy}`;
        dest.objects.set(id, { ...structuredClone(o), id, position: { x: o.position.x + ox, y: o.position.y + oy } });
      }
    }
    pass++;
  }
  return dest;
}

const denseCache = new Map<string, GridState>();
const dense = (src: GridState, template: MapTemplate): GridState => {
  const hit = denseCache.get(template.id);
  if (hit) return hit;
  // The copy breaks rules where passes meet; carrying it onto its own planet leaves the map the rules
  // accept, which is the map a user could have built.
  const built = buildTransfer(filled(src, template), template).dest;
  denseCache.set(template.id, built);
  return built;
};
const tiledPlanet = (src: GridState) => dense(src, worstCasePlanet());
const fullPlanet = (src: GridState) => dense(src, fullGroundPlanet());

function census(state: GridState): { grass: number; terrain: number; objects: number } {
  let grass = 0, terrain = 0;
  for (const row of state.cells) for (const c of row) {
    if (c.zone === CellZone.Grass) grass++;
    if (c.terrain) terrain++;
  }
  return { grass, terrain, objects: state.objects.size };
}

/**
 * Times `op` on the share map, the filled worst-case planet and the filled full-ground planet, and
 * holds the worst-case planet to four times the share map. The full-ground planet carries about
 * four times the share map's build, so it is reported beside the bound but not held to it.
 */
async function trio(name: string, op: (state: GridState) => unknown, src: GridState, opts: { maxSamples?: number } = {}): Promise<void> {
  const worst = tiledPlanet(src), full = fullPlanet(src);
  const a = await s.bench(`${name}/share-map`, () => op(src), opts);
  const b = await s.bench(`${name}/worst-case`, () => op(worst), opts);
  const c = await s.bench(`${name}/full-ground`, () => op(full), opts);
  const ratio = b.p50 / Math.max(a.p50, 0.001);
  const fullRatio = c.p50 / Math.max(a.p50, 0.001);
  console.warn(`[measure] ${name}: share map ${a.p50.toFixed(2)} ms, worst-case ${b.p50.toFixed(2)} ms (${ratio.toFixed(2)}x), full ground ${c.p50.toFixed(2)} ms (${fullRatio.toFixed(2)}x)`);
  expect(ratio, `${name} on the worst-case planet against the share map`).toBeLessThanOrEqual(BOUND);
}

describe.runIf(PERF)('perf: custom planet', () => {
  it('fills both planets to at least two thirds of the share map density', async () => {
    const src = await readShareMap();
    const a = census(src), b = census(tiledPlanet(src)), c = census(fullPlanet(src));
    console.warn(`[measure] census: share map ${JSON.stringify(a)}; worst-case ${JSON.stringify(b)}; full ground ${JSON.stringify(c)}`);
    expect(b.terrain / b.grass).toBeGreaterThan((2 / 3) * (a.terrain / a.grass));
    expect(c.terrain / c.grass).toBeGreaterThan((2 / 3) * (a.terrain / a.grass));
    const dump = process.env.PETIT_PERF_DUMP;
    if (dump) {
      mkdirSync(dump, { recursive: true });
      writeFileSync(`${dump}/share-map.save.json`, serialize(src));
      writeFileSync(`${dump}/worst-case.save.json`, serialize(tiledPlanet(src)));
      writeFileSync(`${dump}/full-ground.save.json`, serialize(fullPlanet(src)));
    }
  });

  it('evaluateMap, buildSaveFile and serialize', async () => {
    const src = await readShareMap();
    await trio('evaluate-map', (st) => evaluateMap(st), src, { maxSamples: 20 });
    await trio('build-save-file', (st) => buildSaveFile(st), src);
    await trio('serialize', (st) => serialize(st), src);
  });

  it('encodeMapPayload, with the payload bytes against the glyph limit', async () => {
    const src = await readShareMap();
    await trio('encode-map-payload', (st) => encodeMapPayload(st, null, META), src, { maxSamples: 20 });
    const bytes = async (st: GridState) => (await encodeMapPayload(st, null, META)).length;
    const report = {
      shareMap: await bytes(src),
      emptyWorstCase: await bytes(createGridState(worstCasePlanet())),
      denseWorstCase: await bytes(tiledPlanet(src)),
      emptyFullGround: await bytes(createGridState(fullGroundPlanet())),
      denseFullGround: await bytes(fullPlanet(src)),
    };
    console.warn(`[measure] payload bytes: ${JSON.stringify(report)} (glyph limit ${GLYPH_MAX_PAYLOAD})`);
  });

  it('the carry preview of the share map onto each planet and onto tafa', async () => {
    const src = await readShareMap();
    const onto = (from: GridState, t: MapTemplate) => () => transferPreviewOf(from, t);
    const hexia = getMapTemplate('hexia'), tafa = getMapTemplate('tafa');
    const worst = worstCasePlanet(), full = fullGroundPlanet();
    const a = await s.bench('preview-transfer/share-map-to-hexia', onto(src, hexia), { maxSamples: 10 });
    const b = await s.bench('preview-transfer/share-map-to-worst-case', onto(src, worst), { maxSamples: 10 });
    const c = await s.bench('preview-transfer/share-map-to-full-ground', onto(src, full), { maxSamples: 10 });
    const d = await s.bench('preview-transfer/share-map-to-tafa', onto(src, tafa), { maxSamples: 10 });
    const e = await s.bench('preview-transfer/full-ground-to-tafa', onto(fullPlanet(src), tafa), { maxSamples: 10 });
    const f = await s.bench('preview-transfer/full-ground-to-full-ground', onto(fullPlanet(src), full), { maxSamples: 5 });
    console.warn(`[measure] preview-transfer p50/p95: onto hexia ${a.p50.toFixed(0)}/${a.p95.toFixed(0)} ms, worst-case ${b.p50.toFixed(0)}/${b.p95.toFixed(0)} ms, full ground ${c.p50.toFixed(0)}/${c.p95.toFixed(0)} ms, tafa ${d.p50.toFixed(0)}/${d.p95.toFixed(0)} ms; full ground onto tafa ${e.p50.toFixed(0)}/${e.p95.toFixed(0)} ms, onto itself ${f.p50.toFixed(0)}/${f.p95.toFixed(0)} ms`);
    expect(b.p50 / a.p50, 'preview-transfer onto the worst-case planet against hexia').toBeLessThanOrEqual(BOUND);
    const p = transferPreviewOf(src, worst);
    console.warn(`[measure] share map onto the worst-case planet: moved ${JSON.stringify(p.moved)}, dropped ${JSON.stringify(p.droppedCounts)}`);
  });

  it('the carry preview on the worker wire: the source map out, the destination back', async () => {
    const src = await readShareMap();
    const tafa = getMapTemplate('tafa');
    // What the main thread pays per preview in the pool: the source encoded and cloned into the
    // message, and the answer cloned back and revived. The replay itself runs in the worker.
    const post = (st: GridState) => () => { const g = wireGrid(st, false); structuredClone(g, { transfer: [g.wire.buffer] }); };
    const answer = (st: GridState, t: MapTemplate) => {
      const p = transferPreviewOf(st, t);
      return () => {
        const wire: WireTransferPreview = {
          grid: {
            wire: encodeCells(p.state.cells, t.width, t.height), objects: [...p.state.objects.values()], lockedLayers: [], cellsVersion: 0,
            objectsVersion: 0,
          },
          dropped: p.dropped, moved: p.moved, droppedCounts: p.droppedCounts,
        };
        reviveTransferPreview(structuredClone(wire, { transfer: [wire.grid.wire.buffer] }), t);
      };
    };
    const worst = tiledPlanet(src), full = fullPlanet(src);
    const rows: string[] = [];
    for (const [name, st, t] of [['worst-case-to-tafa', worst, tafa], ['share-map-to-worst-case', src, worstCasePlanet()], ['full-ground-to-tafa', full, tafa], ['full-ground-to-itself', full, full.template]] as const) {
      const out = await s.bench(`preview-transfer-wire/post/${name}`, post(st), { maxSamples: 30 });
      const back = await s.bench(`preview-transfer-wire/answer/${name}`, answer(st, t), { maxSamples: 30 });
      const target = await s.bench(`preview-transfer-wire/target-template/${name}`, () => structuredClone(t), { maxSamples: 30 });
      rows.push(`${name} post ${out.p50.toFixed(1)}, answer ${back.p50.toFixed(1)}, first-time target ${target.p50.toFixed(1)}`);
    }
    console.warn(`[measure] preview-transfer wire p50 ms: ${rows.join('; ')}`);
  });

  it('the session planet cut', async () => {
    const src = await readShareMap();
    await trio('session-template', (st) => sessionPlanet(st)?.template ?? null, src, { maxSamples: 30 });
  });

  it('refreshBoundary per change at the largest brush and shape sizes', async () => {
    const canvas = createGridState(worstCasePlanet()).cells;
    const n = canvas.length;
    const block = (x0: number, y0: number, w: number, h: number, step = 1): MacroCoord[] => {
      const out: MacroCoord[] = [];
      for (let y = y0; y < y0 + h; y += step) for (let x = x0; x < x0 + w; x += step) out.push({ x, y });
      return out;
    };
    // The largest brush is 5 × 5 and a freehand stroke announces each dab alone; the stroke case is
    // every dab of one pass across the canvas announced at once.
    const dab = block(100, 100, 5, 5);
    const stroke: MacroCoord[] = [];
    for (let x = 0; x < n - 5; x++) stroke.push(...block(x, 120, 5, 5));
    const cases: Array<[string, MacroCoord[]]> = [
      ['brush-dab-5', dab],
      ['brush-stroke-5-across', stroke],
      ['compact-399', block(0, 0, 19, 21)],
      ['spread-399', block(0, 0, 19 * 5, 21 * 5, 5)],
      ['shape-chunk-row', block(0, 0, n, CHUNK_SIZE)],
      ['shape-whole-canvas', block(0, 0, n, n)],
    ];
    for (const [name, changed] of cases) {
      await s.bench(`refresh-boundary/${name}`, () => refreshBoundary(canvas, changed), { meta: { cells: changed.length } });
    }
  });

  it('a whole-canvas ground rectangle through the planet rules', async () => {
    const n = PLANET_MAX_CELLS;
    const zones = Array.from({ length: n }, () => Array.from({ length: n }, (): CellZone => CellZone.Void));
    const canvas: MapTemplate = { id: `${PLANET_CANVAS_ID_PREFIX}1`, name: { en: '' }, width: n, height: n, zones, landmarks: [] };
    const cells: MacroCoord[] = [];
    for (let y = 3; y < n - 3; y++) for (let x = 3; x < n - 3; x++) cells.push({ x, y });
    let executor: CommandExecutor;
    let state: GridState;
    const stroke = () => {
      const start = executor.beginStroke();
      executor.execute(
        { type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation: 0, ground: CellZone.Grass } as PaintTerrainCommand,
      );
      refreshBoundary(state.cells, cells);
      return start.commit();
    };
    const setup = () => {
      state = createGridState(canvas);
      executor = createExecutor(state, createPlanetRegistry());
    };
    setup();
    const violations = stroke();
    expect(state!.cells[n / 2]![n / 2]!.zone).toBe(CellZone.Grass);
    await s.bench('session/ground-rectangle-whole-canvas', stroke, { setup, maxSamples: 10, meta: { cells: cells.length, violations: violations.length } });
  });

  it('a designed generation run on each planet', async () => {
    const world = (t: MapTemplate) => makeWorld(createGridState(t));
    const run = (w: World) => {
      const start = w.executor.beginStroke();
      generateWith(w.state, w.executor, islandConfig());
      start.commit();
    };
    const hexia = getMapTemplate('hexia'), worst = worstCasePlanet(), full = fullGroundPlanet();
    let w = world(hexia);
    const opts = (t: MapTemplate) => ({ setup: () => { w = world(t); }, minSamples: 3, maxSamples: 5, budgetMs: 8000 });
    const a = await s.bench('generate/hexia', () => run(w), opts(hexia));
    const b = await s.bench('generate/worst-case', () => run(w), opts(worst));
    const c = await s.bench('generate/full-ground', () => run(w), opts(full));
    console.warn(`[measure] generate: hexia ${a.p50.toFixed(0)} ms, worst-case ${b.p50.toFixed(0)} ms (${(b.p50 / a.p50).toFixed(2)}x), full ground ${c.p50.toFixed(0)} ms (${(c.p50 / a.p50).toFixed(2)}x)`);
    expect(b.p50 / a.p50, 'generation on the worst-case planet against hexia').toBeLessThanOrEqual(BOUND);
  });
});
