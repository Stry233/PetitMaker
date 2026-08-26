/**
 * WHAT A SMALL BOX SPENDS ITS DECORATION ON, pinned on pictures whose features are known by
 * construction.
 *
 * The decoration is the one instrument in a terrain picture that carries a real hue, so a small box
 * spends it on the few small interior areas the ramp cannot say — an eye, a marking, a throat — and on
 * nothing else (`tools/generation/stencil/stencil-feature.ts`). Three kinds of case here:
 *
 *  - the READING: which candidates are features and in what order, on a face with two eyes and on an
 *    emblem with one accent, plus each of the four gates refusing on its own picture;
 *  - the BUDGET: how many marks a figure may carry, and that the budget is spread over the features
 *    rather than spent on the first;
 *  - the PLACEMENT, through the real executor and the real rules: marks land on the features, the count
 *    stays inside the budget, nothing is left illegal, and ABOVE the gate the background texture is
 *    exactly what it was.
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { EventBus } from '../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../rules';
import { roadLookup } from '../../../../state/object-index';
import { type EditorEvents, type GridState, type Stencil, type StencilPlan } from '../../../../core/model/types';
import { makeState } from '../../../rules/_helpers';
import { getCatalogItem } from '../../../../state/catalog';
import { ELEVATION_COLORS } from '../../../../core/model/constants';
import { hexStringToNumber } from '../../../../core/model/colors';
import {
  detectFeatures, featureBudget, planFeatureMarks,
  FEATURE_BUDGET_SHARE, FEATURE_MAX, FEATURE_MAX_SHARE,
} from '../../../../tools/generation/stencil/stencil-feature';
import { layStencilDecor, runStencilPlan } from '../../../../tools/generation/stencil/stencil-generator';
import { terrainPalette } from '../../../../tools/generation/stencil/stencil';
import { smallBoxWeight } from '../../../../tools/generation/stencil/stencil-small';

const exec = (state: GridState): CommandExecutor =>
  new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));

/** The ramp a terrain picture is told in — what a feature's colour has to be out of reach of. */
const RAMP = terrainPalette(8, false);

/** An accent palette with real hues in it, as the catalog now declares them. */
const ACCENT = [
  { catalogId: 'flower-canna-red', rgb: 0xdc7064 },
  { catalogId: 'flower-agapanthus-blue', rgb: 0x696389 },
  { catalogId: 'flower-sunflower', rgb: 0xbf8c56 },
];

/** A fully covered picture in one colour, which every case below draws its subject into. */
function field(side: number, rgb: number): Stencil {
  return {
    width: side, height: side, nature: 'flat',
    coverage: new Uint8Array(side * side).fill(255),
    color: new Uint32Array(side * side).fill(rgb),
  };
}

/** A picture whose subject is a rectangle of `rgb`, everything else transparent. */
function subject(side: number, rgb: number, box: { x: number; y: number; w: number; h: number }): Stencil {
  const s: Stencil = {
    width: side, height: side, nature: 'flat',
    coverage: new Uint8Array(side * side),
    color: new Uint32Array(side * side),
  };
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) { s.coverage[y * side + x] = 255; s.color[y * side + x] = rgb; }
  }
  return s;
}

/** Paint a block of one colour into a picture. */
function block(s: Stencil, x0: number, y0: number, w: number, h: number, rgb: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) { s.coverage[y * s.width + x] = 255; s.color[y * s.width + x] = rgb; }
  }
}

const covered = (s: Stencil) => (i: number): boolean => (s.coverage[i] ?? 0) >= 128;

/** A cream face with two dark-red eyes and a red throat, which is the picture this reading is for. */
function face(side = 20): Stencil {
  const s = subject(side, 0xf0e0d0, { x: 2, y: 2, w: side - 4, h: side - 4 });
  block(s, 6, 6, 2, 2, 0x902020);          // left eye
  block(s, 12, 6, 2, 2, 0x902020);         // right eye
  block(s, 8, 12, 4, 2, 0xd04030);         // throat
  return s;
}

describe('the features a small box spends its decoration on', () => {
  it('finds the eyes and the throat, and not the face they are drawn on', () => {
    const s = face();
    const features = detectFeatures(s, covered(s), RAMP, ACCENT);
    expect(features.length).toBeGreaterThanOrEqual(3);
    const cells = features.slice(0, 3).flatMap((f) => f.cells);
    // Every cell of the top three is one of the three marks, and none of them is the face.
    for (const i of cells) {
      const x = i % s.width, y = (i / s.width) | 0;
      const onEye = (y === 6 || y === 7) && ((x === 6 || x === 7) || (x === 12 || x === 13));
      const onThroat = (y === 12 || y === 13) && x >= 8 && x < 12;
      expect(onEye || onThroat).toBe(true);
    }
    // And BOTH eyes are found, which is what says the reading is about features and not about one peak.
    const left = features.some((f) => f.cells.every((i) => i % s.width < 10));
    const right = features.some((f) => f.cells.every((i) => i % s.width >= 10));
    expect(left && right).toBe(true);
  });

  it('finds the one accent on an emblem, and reads its own colour', () => {
    const s = subject(20, 0xe8e8e8, { x: 3, y: 3, w: 14, h: 14 });
    block(s, 8, 8, 3, 3, 0xc03040);
    const features = detectFeatures(s, covered(s), RAMP, ACCENT);
    expect(features).toHaveLength(1);
    expect(features[0]!.cells).toHaveLength(9);
    expect(features[0]!.rgb).toBe(0xc03040);
  });

  it('declines a colour the primary palette says as well as the accent can', () => {
    // The same picture with its accent drawn in one of the ramp's OWN greens: a mark there would add an
    // object and no information, which is the whole difference between an accent and a decoration.
    const s = subject(20, 0xe8e8e8, { x: 3, y: 3, w: 14, h: 14 });
    block(s, 8, 8, 3, 3, hexStringToNumber(ELEVATION_COLORS[7]!));
    expect(detectFeatures(s, covered(s), RAMP, ACCENT)).toEqual([]);
  });

  it('declines a mark on the silhouette, whose job the outline already does', () => {
    const s = subject(20, 0xe8e8e8, { x: 3, y: 3, w: 14, h: 14 });
    block(s, 3, 8, 1, 3, 0xc03040);          // against the subject's own left edge
    expect(detectFeatures(s, covered(s), RAMP, ACCENT)).toEqual([]);
  });

  it('declines an area that is the subject rather than a feature of it', () => {
    const s = subject(20, 0xe8e8e8, { x: 3, y: 3, w: 14, h: 14 });
    block(s, 5, 5, 10, 10, 0xc03040);        // half the figure, well past FEATURE_MAX_SHARE
    const features = detectFeatures(s, covered(s), RAMP, ACCENT);
    expect(FEATURE_MAX_SHARE).toBeLessThan(0.5);
    expect(features).toEqual([]);
  });

  it('declines an area that is barely a different colour from what surrounds it', () => {
    const s = subject(20, 0xe8e8e8, { x: 3, y: 3, w: 14, h: 14 });
    block(s, 8, 8, 3, 3, 0xe2e2e2);
    expect(detectFeatures(s, covered(s), RAMP, ACCENT)).toEqual([]);
  });

  it('is one answer per picture, asked twice', () => {
    const s = face();
    const read = (): string => JSON.stringify(detectFeatures(s, covered(s), RAMP, ACCENT));
    expect(read()).toBe(read());
  });

  it('says nothing at all about a picture with no accent palette to say it in', () => {
    const s = face();
    expect(detectFeatures(s, covered(s), RAMP, [])).toEqual([]);
  });
});

describe('the budget a figure may carry', () => {
  it('is a share of the figure, and at least one mark', () => {
    expect(featureBudget(160)).toBe(Math.round(160 * FEATURE_BUDGET_SHARE));
    expect(featureBudget(2)).toBe(1);
    expect(featureBudget(0)).toBe(1);
  });

  it('spreads the budget over the features instead of spending it on the first', () => {
    const s = face();
    const features = detectFeatures(s, covered(s), RAMP, ACCENT);
    const marks = planFeatureMarks(features, ACCENT, 6);
    expect(marks.length).toBeGreaterThanOrEqual(3);
    expect(marks.reduce((sum, mark) => sum + mark.want, 0)).toBe(6);
    for (const mark of marks) expect(mark.want).toBeLessThanOrEqual(4);
  });

  it('never plans more than the budget, however many features there are', () => {
    const s = face();
    const features = detectFeatures(s, covered(s), RAMP, ACCENT);
    for (const budget of [1, 2, 3, 5, 9, 40]) {
      const marks = planFeatureMarks(features, ACCENT, budget);
      expect(marks.reduce((sum, mark) => sum + mark.want, 0)).toBeLessThanOrEqual(budget);
      expect(marks.length).toBeLessThanOrEqual(FEATURE_MAX);
    }
  });

  it('offers every cell of a feature but asks for only what the budget affords', () => {
    const s = subject(20, 0xe8e8e8, { x: 3, y: 3, w: 14, h: 14 });
    block(s, 8, 8, 3, 3, 0xc03040);
    const marks = planFeatureMarks(detectFeatures(s, covered(s), RAMP, ACCENT), ACCENT, 2);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.want).toBe(2);
    expect(marks[0]!.cells).toHaveLength(9);
  });

  it('tells each feature in the ONE accent whose colour is nearest to it', () => {
    const s = subject(20, 0xe8e8e8, { x: 3, y: 3, w: 14, h: 14 });
    block(s, 6, 6, 2, 2, 0xdc7064);          // the red flower's own colour
    block(s, 12, 12, 2, 2, 0x696389);        // the blue one's
    const marks = planFeatureMarks(detectFeatures(s, covered(s), RAMP, ACCENT), ACCENT, 8);
    expect(new Set(marks.map((m) => m.catalogId)))
      .toEqual(new Set(['flower-canna-red', 'flower-agapanthus-blue']));
  });
});

describe('what the decoration lays on the map', () => {
  it('stands its marks on the features and nowhere else, inside the budget', () => {
    const state = makeState(30, 30);
    const e = exec(state);
    const s = face();
    const res = layStencilDecor(
      state, { origin: { x: 5, y: 5 }, stencil: s }, { palette: ACCENT },
      (c) => e.execute(c), undefined, RAMP,
    );
    expect(res.placed).toBeGreaterThan(0);
    const figure = [...s.coverage].filter((c) => c >= 128).length;
    expect(res.placed).toBeLessThanOrEqual(featureBudget(figure));
    // Every mark is on a feature's own cells or the cell beside one: a feature is a colour boundary and
    // so a tier boundary, and a flat placement is refused beside a step.
    const features = detectFeatures(s, covered(s), RAMP, ACCENT).slice(0, FEATURE_MAX);
    const near = new Set<number>();
    for (const feature of features) {
      for (const i of feature.cells) {
        near.add(i);
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          near.add((((i / s.width) | 0) + dy) * s.width + (i % s.width) + dx);
        }
      }
    }
    for (const object of state.objects.values()) {
      const i = (object.position.y - 5) * s.width + (object.position.x - 5);
      expect(near.has(i)).toBe(true);
    }
    expect(e.commitStroke(0)).toEqual([]);
  });

  it('lays nothing on a picture whose colours the ramp can say, however detailed it is', () => {
    // A chequer of two of the ramp's own greens: every cell is an edge, so the background pass would
    // mark it densely, and there is nothing here an accent could add.
    const side = 20;
    const s = field(side, 0);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        s.color[y * side + x] = hexStringToNumber(ELEVATION_COLORS[(x + y) % 2 === 0 ? 2 : 6]!);
      }
    }
    const state = makeState(30, 30);
    const e = exec(state);
    const res = layStencilDecor(
      state, { origin: { x: 5, y: 5 }, stencil: s }, { palette: ACCENT },
      (c) => e.execute(c), undefined, RAMP,
    );
    expect(res.placed).toBe(0);
    expect(state.objects.size).toBe(0);
  });

  it('takes a cell of the paving its own picture borrowed, because a feature is the finer statement', () => {
    // The mixed material borrows a road surface for a region the ramp has no hue for
    // (`stencil-small.ts:planBorrow`) and nothing may stand on a coating (V-PLACE-COATED), so a mark on
    // a paved feature has to take the cell. The picture is a flat green field with one pink patch: the
    // patch is both the borrow's best region and the accent's one feature.
    const side = 16;
    const s = field(side, hexStringToNumber(ELEVATION_COLORS[4]!));
    block(s, 6, 6, 4, 4, 0xe0407a);
    const state = makeState(30, 30);
    const e = exec(state);
    const plan: StencilPlan = {
      read: 'color', stencil: s, origin: { x: 6, y: 6 }, water: 'palette',
      decor: { palette: ACCENT },
    };
    const res = runStencilPlan(state, plan, 8, (c) => e.execute(c));
    expect(res.coated).toBeGreaterThan(0);
    expect(res.decorated).toBeGreaterThan(0);
    const marks = [...state.objects.values()].filter((o) => o.catalogId.startsWith('flower-'));
    expect(marks.length).toBe(res.decorated);
    // Each one stands inside the patch, on ground the paving had taken.
    for (const mark of marks) {
      expect(mark.position.x - 6).toBeGreaterThanOrEqual(5);
      expect(mark.position.x - 6).toBeLessThanOrEqual(10);
      expect(mark.position.y - 6).toBeGreaterThanOrEqual(5);
      expect(mark.position.y - 6).toBeLessThanOrEqual(10);
    }
    expect(e.commitStroke(0)).toEqual([]);
  });

  it('is the background texture again above the gate, and nothing below it', () => {
    // ONE PICTURE, BOTH SIDES OF THE GATE. A hard seam between two flat halves holds no FEATURE at all —
    // each half is half the figure — so a small box says nothing about it, while above the gate the same
    // seam is the ranked anchor points it always was, spaced, in the same cells.
    const seam = (side: number): Stencil => {
      const s = field(side, 0x202020);
      for (let y = 0; y < side; y++) {
        for (let x = side / 2; x < side; x++) s.color[y * side + x] = 0xf0f0f0;
      }
      return s;
    };
    const run = (side: number): { placed: number; at: number[] } => {
      const state = makeState(56, 56);
      const e = exec(state);
      const s = seam(side);
      expect(detectFeatures(s, covered(s), RAMP, ACCENT)).toEqual([]);
      const res = layStencilDecor(
        state, { origin: { x: 6, y: 6 }, stencil: s }, { palette: ACCENT, density: 0.1 },
        (c) => e.execute(c), undefined, RAMP,
      );
      for (const object of state.objects.values()) expect(getCatalogItem(object.catalogId)).toBeDefined();
      expect(e.commitStroke(0)).toEqual([]);
      return { placed: res.placed, at: [...state.objects.values()].map((o) => o.position.x - 6) };
    };

    expect(smallBoxWeight(seam(20))).toBe(1);
    expect(run(20).placed).toBe(0);

    const side = 40;
    expect(smallBoxWeight(seam(side))).toBe(0);
    const above = run(side);
    expect(above.placed).toBeGreaterThan(0);
    for (const x of above.at) expect(Math.abs(x - (side / 2 - 0.5))).toBeLessThanOrEqual(1.5);
  });
});
