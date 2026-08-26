/**
 * What a Γ fillet may be, checked three ways: as rules, against the maps that were reported broken,
 * and against random editing.
 *
 * A fillet is DECORATION (docs RULES.md §10.4): additive geometry on the inner corner of a concave
 * Γ arrangement, carrying no support of its own and replaced outright if terrain is later painted
 * over it. Every artefact reported on this feature came from one of those clauses being broken
 * somewhere, so they are written down here as invariants any map must satisfy:
 *
 *   I1  A fillet's tier is JUSTIFIED by its walls: some fillet corner is wrapped at that tier and
 *       not past it. Below any wrap it HANGS (a wedge nothing stands beside); wrapped past it, the
 *       walls have OUTGROWN it (the stale wedge stacking a layer onto a trimmed notch leaves, #17).
 *       Between those it is a grounded column from its support to its tier — height above the
 *       support is not a fault.
 *   I2  A fillet decorates a NOTCH, not a PIT: a bare cell with terrain on all four edges is a hole
 *       in the surface, and a fillet there reads as terrain the map does not have.
 *   I3  Every cut VALIDATES: the seam with each neighbour still meets.
 *   I4  Editing never LOSES MASS: no stroke leaves a cell that held a real block empty. (A fillet
 *       going when its Γ arrangement changes is the decoration doing its job, not lost mass.)
 *
 * The four fixtures are the maps from the reports, stripped to their cells. They still CONTAIN the
 * violations — that is what they are for: the tools must refuse to make them again, and the
 * reconcile pass must clear the ones already saved.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { deserialize } from '../../../io/json-codec';
import { getMapTemplate } from '../../../config/maps';
import { getCell } from '../../../core/model/grid-model';
import { cornerWrappedAt, surfaceElevation } from '../../../core/edge-cut/terrain-silhouette';
import { isInnerCorner, validateCut } from '../../../core/edge-cut/cut-validator';
import { reconcileCuts } from '../../../core/edge-cut/cut-reconcile';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { DrawingTool } from '../../../tools/paint/drawing-tool';
import { EdgeCutTool } from '../../../tools/edge-cut/edge-cut-tool';
import { TerrainType, type EditorEvents, type GridState, type MacroCoord } from '../../../core/model/types';
import { makeState } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';
import { roadLookup } from '../../../state/object-index';

const FIXTURES = 'src/__tests__/fixtures/gamma-maps';   // vitest runs from the repo root
const MAPS = ['report-1.json', 'report-2.json', 'report-3.json', 'report-4.json'];

interface Violation { x: number; y: number; why: string }

/** Every cell of a map that breaks I1, I2 or I3 — one entry per cell, all its reasons.
 *  A fillet is a grounded COLUMN from its support to its tier (#17), so height above the support
 *  is not a fault; what faults a patch is a tier nothing justifies: HANGING (no fillet corner
 *  wrapped at the recorded tier), OUTGROWN (every wrapped corner's wall reaches past the tier — the
 *  stale wedge a stacked layer leaves), or sitting on a PIT. */
function violations(state: GridState): Violation[] {
  const out: Violation[] = [];
  state.cells.forEach((row, y) => row.forEach((cell, x) => {
    const t = cell?.terrain;
    if (!t) return;
    const why: string[] = [];
    if (t.patchOnly) {
      const support = t.patchBase ?? t.elevation - 1;
      const fillets = (t.corners ?? [])
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c !== 'empty' && c !== 'square');
      const wrappedAt = (i: number, e: number) => cornerWrappedAt(state, x, y, i, t.type, e);
      if (fillets.length > 0) {
        if (!fillets.some(({ i }) => wrappedAt(i, t.elevation))) {
          why.push(`I1 hanging fillet at ${t.elevation}`);
        } else if (fillets.every(({ i }) => !wrappedAt(i, t.elevation) || wrappedAt(i, t.elevation + 1))) {
          why.push(`I1 fillet outgrown by its walls at ${t.elevation}`);
        }
      }
      const ringed = [[-1, 0], [1, 0], [0, -1], [0, 1]]
        .every(([dx, dy]) => surfaceElevation(getCell(state.cells, x + dx!, y + dy!)?.terrain) >= 1);
      if (support < 1 && ringed) why.push('I2 fillet on a pit');
    } else if (t.corners && !validateCut(state, roadLookup(state), x, y, 'terrain', t.corners)) {
      why.push(`I3 cut does not validate: ${t.corners.join('|')}`);
    }
    if (why.length > 0) out.push({ x, y, why: why.join(' + ') });
  }));
  return out;
}

function load(name: string): GridState {
  const raw = readFileSync(`${FIXTURES}/${name}`, 'utf-8') as string;
  return deserialize(raw, getMapTemplate(JSON.parse(raw).templateId as string));
}

/** Bare cells with terrain all round them: the holes reported as "empty blocks". */
function pits(state: GridState): MacroCoord[] {
  const out: MacroCoord[] = [];
  state.cells.forEach((row, y) => row.forEach((cell, x) => {
    if (cell?.terrain) return;
    const ringed = [[-1, 0], [1, 0], [0, -1], [0, 1]]
      .every(([dx, dy]) => !!getCell(state.cells, x + dx!, y + dy!)?.terrain);
    if (ringed) out.push({ x, y });
  }));
  return out;
}

describe('the maps that were reported broken', () => {
  it('each fixture still holds the fault it was reported for', () => {
    // Two faults across the four: fillets that hang or sit on a pit, and pits left where a paint
    // could not fill them. Nothing here is fixed by editing the fixtures — they are the evidence.
    const found = MAPS.map((name) => {
      const state = load(name);
      return `${name}: ${violations(state).length} bad fillets, ${pits(state).length} pits`;
    });
    expect(found).toEqual([
      'report-1.json: 14 bad fillets, 0 pits',
      'report-2.json: 1 bad fillets, 0 pits',
      'report-3.json: 1 bad fillets, 1 pits',
      'report-4.json: 0 bad fillets, 2 pits',
    ]);
  });

  it.each(MAPS)('%s: the tools refuse to make its violations again', (name) => {
    const state = load(name);
    const bad = violations(state);
    if (bad.length === 0) return;
    // Every corner of every violating cell: nothing on offer.
    for (const v of bad) {
      const tier = getCell(state.cells, v.x, v.y)!.terrain!.elevation;
      const offered = [0, 1, 2, 3].filter((i) => isInnerCorner(state, v.x, v.y, i, TerrainType.Mountain, tier));
      expect(offered, `${name} ${v.x},${v.y} (${v.why})`).toEqual([]);
    }
  });

  it.each(MAPS)('%s: reconcile clears them', (name) => {
    const state = load(name);
    const bad = violations(state);
    if (bad.length === 0) return;
    const ex = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    reconcileCuts(bad.map((v) => ({ x: v.x, y: v.y })), state, { execute: (cmd) => ex.execute(cmd), roadAt: ex.roadAt });
    expect(violations(state)).toEqual([]);
  });
});

/* ── the same invariants under random editing ─────────────────────────────── */

const MICRO = { x: 0, y: 0 };

/** mulberry32 — the repo's seeded generator, so a failure replays exactly. */
function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The STRUCTURAL surface of every cell — what the map really holds, fillets discounted. A real
 *  block that gains a fillet keeps its height here, which is the point: the decoration is not mass
 *  and losing it is not a loss. */
function massOf(state: GridState): Map<string, number> {
  const out = new Map<string, number>();
  state.cells.forEach((row, y) => row.forEach((cell, x) => {
    const h = surfaceElevation(cell?.terrain);
    if (h > 0) out.set(`${x},${y}`, h);
  }));
  return out;
}

describe('random painting and cutting', () => {
  it('never leaves a violation behind, and never loses a block', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 80 && failures.length < 5; seed++) {
      const rand = rng(seed);
      // Preserve the original draw order (mode roll, then brush-size roll) so a seed's replay is
      // unchanged: `makeToolCtx`'s options object would otherwise be built AFTER the size argument.
      const autoEdgeCut = rand() < 0.5 ? 'round' : 'rect';
      const state = makeState(24, 24);
      const ex = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
      const ctx = makeToolCtx(state, ex, 1 + Math.floor(rand() * 3), 1, { autoEdgeCut });
      const paint = new DrawingTool();
      paint.contentType = 'mountain';
      const cut = new EdgeCutTool();
      const log: string[] = [];
      let mass = massOf(state);

      for (let step = 0; step < 14; step++) {
        const x = 6 + Math.floor(rand() * 12), y = 6 + Math.floor(rand() * 12);
        if (rand() < 0.7) {
          const layer = 1 + Math.floor(rand() * 3);
          (ctx as unknown as { elevation: number }).elevation = layer;
          paint.mode = rand() < 0.5 ? 'brush' : 'rect';
          paint.onActivate(ctx);
          const to = { x: Math.min(20, x + Math.floor(rand() * 5)), y: Math.min(20, y + Math.floor(rand() * 5)) };
          paint.onPointerDown({ x, y }, MICRO, ctx);
          paint.onPointerMove(to, MICRO, ctx);
          paint.onPointerUp(to, MICRO, ctx);
          log.push(`paint ${paint.mode} L${layer} ${x},${y}->${to.x},${to.y}`);
        } else {
          cut.onActivate(ctx);
          cut.onPointerDown({ x, y }, { x, y }, ctx);
          log.push(`cut ${x},${y}`);
        }

        const bad = violations(state);
        const lost: MacroCoord[] = [];
        const now = massOf(state);
        // Painting only ever ADDS height, so a cell whose surface dropped is a block that went
        // missing — the fault behind every "empty block" report.
        for (const [k, h] of mass) {
          if ((now.get(k) ?? 0) < h) lost.push({ x: Number(k.split(',')[0]), y: Number(k.split(',')[1]) });
        }
        if (bad.length > 0 || lost.length > 0) {
          failures.push(`seed ${seed} step ${step}: `
            + (bad.length ? `${bad[0]!.why} at ${bad[0]!.x},${bad[0]!.y}` : `lost mass at ${lost.map((c) => `${c.x},${c.y}`).join(' ')}`)
            + `\n      ${log.join('\n      ')}`);
          break;
        }
        mass = now;
      }
    }
    expect(failures.join('\n---\n')).toBe('');
  });
});

describe('a pit left in a map', () => {
  it('takes the paint that fills it, one tier at a time', () => {
    // report-4's fault: cells the brush cannot fill, because a planner that reads a Γ fillet's cosmetic
    // tier as support starts the ladder above the ground. The skipped rung is refused for having no base,
    // the cell stays out of the mass, and the fillet it could not replace is dropped later — the hole.
    const state = load('report-4.json');
    const holes = pits(state);
    expect(holes.length).toBeGreaterThan(0);
    const ex = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = makeToolCtx(state, ex, 1, 2);
    const paint = new DrawingTool();
    paint.contentType = 'mountain';
    paint.mode = 'brush';
    paint.onActivate(ctx);
    for (const h of holes) {
      paint.onPointerDown(h, MICRO, ctx);
      paint.onPointerUp(h, MICRO, ctx);
      expect(getCell(state.cells, h.x, h.y)?.terrain, `${h.x},${h.y} filled`).toBeTruthy();
      expect(surfaceElevation(getCell(state.cells, h.x, h.y)?.terrain), `${h.x},${h.y} holds real mass`)
        .toBeGreaterThan(0);
    }
  });
});
