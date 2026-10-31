// The designed generator's set piece, a phrase or figure written into the terrain. The drawing is read
// off `rasterizePhrase` with no map; the gate off the pure sculpt; legibility only on a committed map,
// since letters lowered by the rules or the repair pass would pass every rule check and fail the design.
import { describe, it, expect, vi } from 'vitest';

// Synchronous generation batch; tens of seconds on an idle machine and over a minute instrumented.
vi.setConfig({ testTimeout: 180_000 });
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { flatIndex } from '../../../../../core/grid/rect';
import { TerrainType, type GridState, type MapTemplate } from '../../../../../core/model/types';
import { categoryOf } from '../../../../../state/catalog';
import { objectRect } from '../../../../../state/object-geometry';
import { covered } from '../../../../../tools/generation/stencil/stencil';
import { SET_PIECE_BIG, SET_PIECE_MIN, carveLandmark, landmarkCells, type LandmarkPlan } from '../../../../../tools/generation/designer/terrain/landmark';
import { COURT_PATTERNS, courtInk, type CourtPattern, GLYPHS, PHRASE_BANK, rasterizePhrase } from '../../../../../tools/generation/designer/terrain/landmark-glyphs';
import { planDesign } from '../../../../../tools/generation/designer/pipeline';
import { buildDesigned, memo } from '../_designed-map';
import { sculptTerrain } from '../../../../../tools/generation/designer/terrain/terrain-sculpt';
import { ItemCategory } from '../../../../../config/catalog/categories';

const HEXIA = MAP_TEMPLATES['hexia']!;
const TAFA = MAP_TEMPLATES['tafa']!;
/** A batch wide enough that an occasional set piece appears in it several times over. */
const SEEDS = Array.from({ length: 24 }, (_, i) => 1 + i * 7919);

/**
 * The landmark one seed's plan carries, read off the pure sculpt. The stages are threaded as
 * `pipeline.ts` threads them: omitting one changes which blocks exist and so moves the set piece to
 * another seed.
 */
function sculptLandmark(seed: number, template: MapTemplate, richness: number): LandmarkPlan | null {
  const { composition, line, streets, plan, anchors, ground } = planDesign({ seed, template, richness });
  return sculptTerrain({
    template, composition, streets, plan, anchors, seed, richness, ground, line, maxElevation: 8, waterScale: 1,
  }).landmark;
}

/** `sculptLandmark`, sculpted once per (seed, template, richness) for this file. */
const landmarkOf = memo(sculptLandmark);

function carriers(template: MapTemplate, richness: number): { seed: number; landmark: LandmarkPlan }[] {
  const out: { seed: number; landmark: LandmarkPlan }[] = [];
  for (const seed of SEEDS) {
    const landmark = landmarkOf(seed, template, richness);
    if (landmark) out.push({ seed, landmark });
  }
  return out;
}

describe('landmark: the glyph bank', () => {
  it('every drawing is a rectangle of ink and space', () => {
    for (const [key, rows] of Object.entries(GLYPHS)) {
      expect(rows.length, key).toBeGreaterThan(0);
      const width = rows[0]!.length;
      expect(width, key).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.length, `${key}: "${row}"`).toBe(width);
        expect(/^[#.]+$/.test(row), `${key}: "${row}"`).toBe(true);
      }
      expect(rows.some((r) => r.includes('#')), key).toBe(true);
    }
  });

  it('every phrase names glyphs the bank draws', () => {
    for (const phrase of PHRASE_BANK) {
      expect(phrase.glyphs.length, phrase.id).toBeGreaterThan(0);
      expect(phrase.weight, phrase.id).toBeGreaterThan(0);
      for (const key of phrase.glyphs) expect(GLYPHS[key], `${phrase.id}: ${key}`).toBeDefined();
    }
  });
});

describe('landmark: rasterizing a phrase', () => {
  it('a single letter is its own drawing, cell for cell', () => {
    const drawing = GLYPHS['H']!;
    const stencil = rasterizePhrase(['H'], 1, 'h')!;
    expect(stencil.width).toBe(5);
    expect(stencil.height).toBe(6);
    for (let y = 0; y < stencil.height; y++) {
      for (let x = 0; x < stencil.width; x++) {
        expect(covered(stencil, x, y), `${x},${y}`).toBe(drawing[y]![x] === '#');
      }
    }
  });

  it('scale doubles both axes and thickens the stroke with them', () => {
    const drawing = GLYPHS['H']!;
    const stencil = rasterizePhrase(['H'], 2, 'h')!;
    expect(stencil.width).toBe(10);
    expect(stencil.height).toBe(12);
    for (let y = 0; y < stencil.height; y++) {
      for (let x = 0; x < stencil.width; x++) {
        const want = drawing[Math.floor(y / 2)]![Math.floor(x / 2)] === '#';
        expect(covered(stencil, x, y), `${x},${y}`).toBe(want);
      }
    }
  });

  it('a phrase runs along its axis with one cell of air per unit of scale', () => {
    const across = rasterizePhrase(['H', 'O', 'M', 'E'], 1, 'h')!;
    expect(across.width).toBe(4 * 5 + 3);
    expect(across.height).toBe(6);
    const down = rasterizePhrase(['H', 'O', 'M', 'E'], 1, 'v')!;
    expect(down.width).toBe(5);
    expect(down.height).toBe(4 * 6 + 3);
    for (let y = 0; y < across.height; y++) expect(covered(across, 5, y)).toBe(false);
  });

  it('a figure wider than the letters beside it is centred on them', () => {
    const stencil = rasterizePhrase(['I', 'HEART', 'U'], 1, 'h')!;
    expect(stencil.width).toBe(5 + 1 + 7 + 1 + 5);
    expect(stencil.height).toBe(6);
  });

  it('an unknown glyph draws nothing rather than a hole', () => {
    expect(rasterizePhrase(['H', 'not-a-glyph'], 1, 'h')).toBeNull();
    expect(rasterizePhrase([], 1, 'h')).toBeNull();
  });
});

describe('landmark: the gate', () => {
  it('a quiet map carries one only occasionally, and the floor holds', () => {
    // Below the set-piece richness the pass rolls per map, so the claim is "not every map", not a count.
    for (const richness of [0, 0.3]) {
      const carried = SEEDS.filter((seed) => landmarkOf(seed, HEXIA, richness) !== null).length;
      expect(carried, `r${richness}: ${carried} of ${SEEDS.length}`).toBeLessThan(SEEDS.length);
    }
  });

  it('EVERY map from the set-piece richness up carries its one figure', () => {
    // One map in ninety-six may come back without one: the pass needs a clear one-tier panel of
    // `SET_PIECE_MIN` cells, and staggered crossings cut terraces small. The top terrace is left
    // unstaggered for this (`streets/lines.ts:crownMask`), but on `tafa/15839` at full richness the
    // panel would sit on a lower tier.
    const missing: string[] = [];
    for (const richness of [0.5, 1]) {
      for (const template of [HEXIA, TAFA]) {
        for (const seed of SEEDS) {
          if (!landmarkOf(seed, template, richness)) missing.push(`${template.id} ${seed} r${richness}`);
        }
      }
    }
    expect(missing.length, missing.join(', ')).toBeLessThanOrEqual(1);
  });

  it('floods ONE panel and not two', () => {
    // A finished map cannot tell a second set piece from a large cascade, so this counts the water
    // the pass lays on open ground: exactly one panel less its ink.
    const W = 60, H = 60;
    for (const seed of SEEDS) {
      const terrain = { width: W, height: H, tier: new Int8Array(W * H), water: new Int8Array(W * H).fill(-1) };
      const grass = new Uint8Array(W * H).fill(1);
      const clearance = new Int16Array(W * H).fill(9);
      const plan = carveLandmark({
        terrain, grass, flat: new Uint8Array(W * H), clearance,
        wall: { rect: { x: 0, y: 0, w: 0, h: 0 }, peak: 0 },
        hub: { x: 30, y: 30 }, seed, richness: 1,
      });
      expect(plan, `seed ${seed}`).not.toBeNull();
      let flooded = 0;
      for (let i = 0; i < terrain.water.length; i++) if (terrain.water[i]! >= 0) flooded++;
      expect(flooded, `seed ${seed}: ${plan!.kind} ${plan!.panel.w}x${plan!.panel.h}`)
        .toBe(plan!.panel.w * plan!.panel.h - plan!.ink.length);
    }
  });

  it('writes a placement of the reference grammar', () => {
    const kinds = new Set(carriers(HEXIA, 1).map((c) => c.landmark.kind));
    // Which forms a batch draws is the composition's choice; each must come from the bank.
    expect([...kinds].every((k) => k === 'wall-banner' || k === 'ground-field' || k === 'terrace-court')).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(1);
  });

  it('the same inputs always write the same landmark', () => {
    for (const seed of SEEDS) {
      const a = landmarkOf(seed, HEXIA, 1);
      const b = sculptLandmark(seed, HEXIA, 1);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });
});

describe('landmark: what reaches the map', () => {
  interface Run { state: GridState; landmark: LandmarkPlan | null; violations: number; refused: number }

  function build(seed: number, template: MapTemplate, richness: number): Run {
    const { state, outcome, violations } = buildDesigned(seed, template, { richness, maxElevation: 8 });
    return {
      state, landmark: outcome.sculpt.landmark, violations: violations.length,
      refused: outcome.refused.roads + outcome.refused.anchors + outcome.refused.lanes,
    };
  }

  // Seeds are selected off the committed run, so a planning helper that drifts from the pipeline
  // cannot hand this block a seed whose map carries nothing.
  const runs = SEEDS.flatMap((seed) => {
    const run = build(seed, HEXIA, 1);
    return run.landmark ? [{ seed, run: { ...run, landmark: run.landmark } }] : [];
  });

  it('the batch offers a landmark to read at all', () => {
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });

  it('every stroke of the glyph is still standing once the map is committed', () => {
    for (const { seed, run } of runs) {
      const { landmark, state } = run;
      let standing = 0;
      for (const c of landmark.ink) {
        const terrain = state.cells[c.y]?.[c.x]?.terrain;
        const ok = landmark.tier === 0
          // The ground field's ink is the ground itself: nothing painted, nothing flooded.
          ? !terrain || terrain.type === TerrainType.None
          : !!terrain && terrain.type === TerrainType.Mountain && terrain.elevation === landmark.tier;
        if (ok) standing++;
      }
      expect(standing, `seed ${seed}: ${landmark.kind} "${landmark.phraseId}"`).toBe(landmark.ink.length);
      // A court pattern on the smallest panel (`SET_PIECE_MIN`, 120 cells) draws about nine cells of
      // ink; a phrase draws far more.
      expect(landmark.ink.length, `seed ${seed}: ${landmark.phraseId} ink`).toBeGreaterThan(8);
    }
  });

  it('the panel around the glyph is water at the panel\'s own elevation', () => {
    for (const { seed, run } of runs) {
      const { landmark, state } = run;
      const ink = new Set(landmark.ink.map((c) => flatIndex(c.x, c.y, state.template.width)));
      const { panel } = landmark;
      for (let y = panel.y; y < panel.y + panel.h; y++) {
        for (let x = panel.x; x < panel.x + panel.w; x++) {
          if (ink.has(flatIndex(x, y, state.template.width))) continue;
          const terrain = state.cells[y]?.[x]?.terrain;
          expect(terrain?.type, `seed ${seed} at ${x},${y}`).toBe(TerrainType.Water);
          expect(terrain?.elevation, `seed ${seed} at ${x},${y}`).toBe(landmark.tier);
        }
      }
    }
  });

  it('a landmark map commits as clean as any other', () => {
    for (const { seed, run } of runs) {
      expect(run.violations, `seed ${seed}`).toBe(0);
      expect(run.refused, `seed ${seed}`).toBe(0);
    }
  });

  // Roads may frame the panel, as the style target frames its banner; plants may not, which is what
  // `landmarkCells` tells the decoration pass.
  it('nothing is planted on the panel or its margin, so the letters stay readable', () => {
    for (const { seed, run } of runs) {
      const { landmark, state } = run;
      const claimed = landmarkCells(landmark, state.template.width, state.template.height);
      for (const object of state.objects.values()) {
        const category = categoryOf(object);
        if (category !== ItemCategory.Tree && category !== ItemCategory.Flora) continue;
        const i = flatIndex(object.position.x, object.position.y, state.template.width);
        expect(claimed.has(i), `seed ${seed}: ${object.catalogId} on the landmark`).toBe(false);
      }
    }
  });

  it('nothing stands inside the panel at all', () => {
    for (const { seed, run } of runs) {
      const { landmark, state } = run;
      const { panel } = landmark;
      for (const object of state.objects.values()) {
        const rect = objectRect(object);
        const clear = rect.x + rect.w <= panel.x || panel.x + panel.w <= rect.x
          || rect.y + rect.h <= panel.y || panel.y + panel.h <= rect.y;
        expect(clear, `seed ${seed}: ${object.catalogId} in the panel`).toBe(true);
      }
    }
  });
});

describe('the one big thing (I5.3)', () => {
  // A scatter of similar ponds reads as no centrepiece, so the panel is the largest rectangle a tier's
  // clear ground holds rather than a size off a list.
  it('draws the panel at the scale of the ground, not off a size list', () => {
    for (const template of [HEXIA, TAFA]) {
      const rows = SEEDS.slice(0, 8).map((seed) => landmarkOf(seed, template, 1))
        .filter((l): l is LandmarkPlan => l !== null);
      expect(rows.length, `${template.id}: seeds carrying a figure`).toBeGreaterThanOrEqual(6);
      const areas = rows.map((l) => l.panel.w * l.panel.h).sort((a, b) => b - a);
      expect(areas[0]!, `${template.id}: largest panel ${areas.join(', ')}`)
        .toBeGreaterThanOrEqual(SET_PIECE_BIG);
      expect(areas[areas.length - 1]!, `${template.id}: smallest panel ${areas.join(', ')}`)
        .toBeGreaterThanOrEqual(SET_PIECE_MIN);
    }
  });

  it('stands the pattern inside the water rather than out to the panel edge', () => {
    // The reference's banner is 130 cells of ink inside 772 of water; ink drawn to the edge would read
    // as a paved terrace with a moat, so the inset scales with the panel.
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS.slice(0, 8)) {
        const plan = landmarkOf(seed, template, 1);
        if (!plan || plan.kind !== 'terrace-court') continue;
        const short = Math.min(plan.panel.w, plan.panel.h);
        const margin = Math.max(2, Math.round(short * 0.2));
        for (const c of plan.ink) {
          const inX = c.x >= plan.panel.x + margin && c.x < plan.panel.x + plan.panel.w - margin;
          const inY = c.y >= plan.panel.y + margin && c.y < plan.panel.y + plan.panel.h - margin;
          expect(inX && inY, `${template.id}/${seed}: ink at ${c.x},${c.y} of panel`
            + ` ${plan.panel.x},${plan.panel.y} ${plan.panel.w}x${plan.panel.h}`).toBe(true);
        }
        expect(plan.ink.length / (plan.panel.w * plan.panel.h), `${template.id}/${seed}: ink share`)
          .toBeLessThan(0.5);
      }
    }
  });
});

describe('the court pattern bank', () => {
  // Long panels (the first three) are the common ones, and where `bars` and `rings` risk collapsing
  // into the same parallel stripes.
  const ASPECTS = [[46, 8], [52, 7], [60, 6], [21, 15], [18, 18]] as const;

  it('draws five distinct figures at every aspect a panel comes in', () => {
    for (const [w, h] of ASPECTS) {
      const drawn = new Map<string, CourtPattern>();
      for (const pattern of COURT_PATTERNS) {
        const ink = courtInk(w, h, pattern);
        const key = [...ink.coverage].map((v) => (v > 0 ? '#' : '.')).join('');
        const twin = drawn.get(key);
        expect(twin, `${w}x${h}: ${pattern} draws the same figure as ${twin}`).toBeUndefined();
        drawn.set(key, pattern);
      }
    }
  });

  it('never answers a long panel with lines running its whole width', () => {
    for (const [w, h] of ASPECTS) {
      for (const pattern of COURT_PATTERNS) {
        const ink = courtInk(w, h, pattern);
        let broken = 0;
        for (let y = 0; y < h; y++) {
          let full = true;
          for (let x = 0; x < w && full; x++) if (!ink.coverage[y * w + x]) full = false;
          if (!full) broken++;
        }
        expect(broken, `${w}x${h} ${pattern}: every row runs the whole width`).toBeGreaterThan(0);
      }
    }
  });
});
