/**
 * Curve adjust restores, then re-lays. Whatever the map held under the curve, an adjusted curve must
 * leave exactly the map a curve drawn at the new anchors would have left, and moving an anchor away
 * and back must return the map as first drawn. The matrix runs each property over ground that tests
 * the restore: a hand-cut mountain block, a laid road, another road material, a mountain terrace,
 * and an eraser curve through a raised plateau. Maps compare by content; object ids are minted per
 * placement and are left out.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import { EraserTool } from '../../../../tools/pointer/paint/eraser';
import { __resetCurveSession, getCurveSession, moveCurveAnchor } from '../../../_support/curve-session';
import { CommandType, TerrainType, type GridState, type MacroCoord } from '../../../../core/model/types';
import { getRoadMaterials } from '../../../../state/catalog';
import { setToastPresenter } from '../../../../platform/channels/toast-bus';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, arm } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';

type Executor = ReturnType<typeof makeExecutor>;
type Content = 'mountain' | 'water' | 'road';
interface Scenario { name: string; content: Content; trim: 'off' | 'round'; eraser?: boolean; setup(ex: Executor): void }

const road = getRoadMaterials();
const block = (x0: number, y0: number, x1: number, y1: number): MacroCoord[] => {
  const out: MacroCoord[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push({ x, y });
  return out;
};
const paint = (ex: Executor, cells: MacroCoord[], elevation: number): void => {
  ex.execute({ type: CommandType.PaintTerrain, cells, terrainType: TerrainType.Mountain, elevation });
};
const lay = (ex: Executor, id: string, catalogId: string, x: number, y: number): void => {
  ex.execute({ type: CommandType.PlaceObject, object: { id, catalogId, position: { x, y }, rotation: 0, elevation: 0 } });
};

const SCENARIOS: Scenario[] = [
  { name: 'a mountain curve beside a raised block with a hand cut', content: 'mountain', trim: 'round', setup: (ex) => {
    paint(ex, block(10, 12, 12, 14), 1);
    ex.execute({ type: CommandType.TrimCorners, x: 11, y: 12, layer: 'terrain', afterCorners: ['square', 'fan', 'square', 'square'] });
  } },
  { name: 'a mountain curve crossing a laid road', content: 'mountain', trim: 'round', setup: (ex) => {
    for (let y = 5; y < 20; y++) lay(ex, `r${y}`, road[0]!.id, 12, y);
  } },
  { name: 'a tile curve over another road material', content: 'road', trim: 'round', setup: (ex) => {
    for (let x = 4; x < 22; x++) lay(ex, `r${x}`, road[1]!.id, x, 8);
  } },
  { name: 'a water curve across a mountain terrace', content: 'water', trim: 'off', setup: (ex) => {
    paint(ex, block(4, 4, 24, 16), 1);
  } },
  { name: 'an eraser curve through a raised plateau', content: 'mountain', trim: 'round', eraser: true, setup: (ex) => {
    paint(ex, block(4, 4, 24, 16), 1);
    paint(ex, block(4, 4, 24, 16), 2);
  } },
];

const ANCHORS: MacroCoord[] = [{ x: 6, y: 10 }, { x: 13, y: 6 }, { x: 20, y: 10 }];
const MOVED: MacroCoord = { x: 13, y: 11 };

/** Terrain in raster order, then objects by their own fields, sorted; ids left out. */
function content(s: GridState): string {
  const cells = s.cells.map((row) => row.map((c) => (c.terrain
    ? `${c.terrain.type}:${c.terrain.elevation}:${c.terrain.patchOnly ? 1 : 0}:${c.terrain.patchBase ?? ''}:${(c.terrain.corners ?? []).join('')}`
    : '-')).join('|'));
  const objects = [...s.objects.values()]
    .map((o) => `${o.catalogId}/${o.position.x},${o.position.y}/${o.rotation}/${o.elevation}/${(o.corners ?? []).join('')}`)
    .sort();
  return [...cells, '#', ...objects].join('\n');
}

/** A world with the scenario laid and a curve drawn through `anchors`, its adjust session open. */
function drawn(sc: Scenario, anchors: MacroCoord[]): GridState {
  __resetCurveSession();
  const state = makeState(28, 24);
  const ex = makeExecutor(state);
  sc.setup(ex);
  const ctx = makeToolCtx(state, ex, 2, 1, { autoEdgeCut: sc.trim, contentType: sc.content, tileMaterial: road[0]!.id, eraserShape: 'curve' });
  const tool = sc.eraser ? new EraserTool() : new DrawingTool();
  if (tool instanceof DrawingTool) {
    arm(ctx, { shape: 'curve', contentType: sc.content });
  }
  tool.onActivate(ctx);
  const click = (c: MacroCoord): void => {
    tool.onPointerDown(cell(c), point({ x: 0, y: 0 }), ctx);
    tool.onPointerUp(cell(c), point({ x: 0, y: 0 }), ctx);
  };
  for (const a of anchors) click(a);
  click(anchors[anchors.length - 1]!);
  expect(getCurveSession(), 'the adjust session opens').not.toBeNull();
  return state;
}

type Check = 'same anchors' | 'moved' | 'away and back';

const CHECKS: Record<Check, { title: string; run(sc: Scenario): void }> = {
  'same anchors': {
    title: 'a tweak back onto the same anchors leaves the curve as drawn',
    run: (sc) => {
      const state = drawn(sc, ANCHORS);
      const first = content(state);
      moveCurveAnchor(1, ANCHORS[1]!.x, ANCHORS[1]!.y, true);
      expect(content(state)).toBe(first);
    },
  },
  moved: {
    title: 'a moved anchor leaves the map a curve drawn there would have left',
    run: (sc) => {
      const fresh = content(drawn(sc, [ANCHORS[0]!, MOVED, ANCHORS[2]!]));
      const state = drawn(sc, ANCHORS);
      moveCurveAnchor(1, MOVED.x, MOVED.y, true);
      expect(content(state)).toBe(fresh);
    },
  },
  'away and back': {
    title: 'moving an anchor away and back returns the map as first drawn',
    run: (sc) => {
      const state = drawn(sc, ANCHORS);
      const first = content(state);
      moveCurveAnchor(1, MOVED.x, MOVED.y, true);
      moveCurveAnchor(1, ANCHORS[1]!.x, ANCHORS[1]!.y, true);
      expect(content(state)).toBe(first);
    },
  },
};

setToastPresenter(() => {});
afterEach(() => { __resetCurveSession(); });

describe('curve adjust restore fidelity', () => {
  for (const sc of SCENARIOS) {
    describe(sc.name, () => {
      for (const { title, run } of Object.values(CHECKS)) {
        it(title, () => run(sc));
      }
    });
  }
});
