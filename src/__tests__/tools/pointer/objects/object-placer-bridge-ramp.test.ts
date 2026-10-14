/** The placer's ghost and its click resolve a bridge or ramp to the same span, and the click lands it. */
import { describe, it, expect, vi } from 'vitest';
import { ObjectPlacerTool } from '../../../../tools/pointer/objects/object-placer';
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import { CellZone } from '../../../../core/game/zones';
import { makeState, setTerrain, setZone, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, objectsByCatalog, placementHover } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';
import { HEADLESS_OVERLAY } from '../../../../tools/pointer/runtime/host';

const m = (x: number, y: number): MacroCoord => ({ x, y });
const exec = (s: any) => makeExecutor(s);

describe('ObjectPlacerTool bridge and ramp placement', () => {
  it('places a bridge across a painted water river', () => {
    const S = 24; const state = makeState(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) setZone(state, x, y, CellZone.Grass);
    for (let y = 2; y < S - 2; y++) for (const x of [10, 11, 12]) setTerrain(state, x, y, TerrainType.Water, 1); // 3-wide river, ground banks
    const ex = exec(state);
    new ObjectPlacerTool().onPointerDown(cell(m(11, 11)), point(m(11, 11)), makeToolCtx(state, ex, 1, 1, { armedItem: 'bridge-teak' })); // width 2, waterSpan 3-6
    expect(objectsByCatalog(state, 'bridge-teak').length, 'bridge placed across the river').toBe(1);
  });

  it('places a ramp up a cliff in every drop direction', () => {
    // a level-1 plateau on one side, ground on the other; the ramp sits on the gap edge.
    const setups = [
      { name: 'top-high', hi: (_x: number, y: number) => y <= 9, at: m(8, 10) },
      { name: 'bottom-high', hi: (_x: number, y: number) => y >= 11, at: m(8, 10) },
      { name: 'left-high', hi: (x: number, _y: number) => x <= 9, at: m(10, 8) },
      { name: 'right-high', hi: (x: number, _y: number) => x >= 11, at: m(10, 8) },
    ];
    for (const s of setups) {
      const S = 20; const state = makeState(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        setZone(state, x, y, CellZone.Grass);
        if (s.hi(x, y)) setTerrain(state, x, y, TerrainType.Mountain, 1);
      }
      const ex = exec(state);
      new ObjectPlacerTool().onPointerDown(cell(s.at), point(s.at), makeToolCtx(state, ex, 1, 1, { armedItem: 'ramp-teak-stair' })); // width 2, height 2, heightDrop 1
      expect(objectsByCatalog(state, 'ramp-teak-stair').length, `ramp placed (${s.name})`).toBe(1);
    }
  });

  // Edge case: the ramp's bottom support is 1.5 macro blocks. A lower terrace of only 1
  // blocks is too short — the ramp must be rejected, and the ghost must read red (not green), because the
  // ghost now validates through the same rule. A 2-block terrace fits and places.
  it('rejects a ramp on a too-short (1-block) lower terrace — incl. the ghost; accepts a 2-block one', () => {
    const build = (lowLen: number) => {
      const S = 24; const state = makeState(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        setZone(state, x, y, CellZone.Grass);
        if (x <= 9) setTerrain(state, x, y, TerrainType.Mountain, 2);           // high plateau
        else if (x <= 9 + lowLen) setTerrain(state, x, y, TerrainType.Mountain, 1); // lower terrace (lowLen wide)
        // x > 9+lowLen: ground (level 0) — the terrace ends here
      }
      return state;
    };
    const ghostColor = (state: any): unknown => {
      let captured: unknown;
      const ctx = makeToolCtx(state, exec(state), 1, 1, { armedItem: 'ramp-teak-stair' }); // width 2, spanLen 2
      ctx.overlay = { ...HEADLESS_OVERLAY, showGhost: (_cells: MacroCoord[], color: unknown) => { captured = color; } } as any;
      new ObjectPlacerTool().onPointerMove(cell(m(9, 10)), point(m(9, 10)), ctx);
      return captured;
    };

    // 1-block terrace: too short → rule rejects + nothing places + ghost red
    const tooShort = build(1);
    const exS = exec(tooShort);
    new ObjectPlacerTool().onPointerDown(cell(m(9, 10)), point(m(9, 10)), makeToolCtx(tooShort, exS, 1, 1, { armedItem: 'ramp-teak-stair' }));
    expect(objectsByCatalog(tooShort, 'ramp-teak-stair').length, 'no ramp on a 1-block terrace').toBe(0);
    const shortColor = ghostColor(build(1));

    // 2-block terrace: fits → places + ghost green
    const ok = build(2);
    const exOk = exec(ok);
    new ObjectPlacerTool().onPointerDown(cell(m(9, 10)), point(m(9, 10)), makeToolCtx(ok, exOk, 1, 1, { armedItem: 'ramp-teak-stair' }));
    expect(objectsByCatalog(ok, 'ramp-teak-stair').length, 'ramp placed on a 2-block terrace').toBe(1);
    const okColor = ghostColor(build(2));

    expect(shortColor, 'ghost RED on the too-short terrace, GREEN on the good one').not.toBe(okColor);
  });
});


describe('span model previews', () => {
  it.each(['bridge-teak', 'ramp-grassy'])('previews the same snapped %s that a click places', (catalogId) => {
    const state = makeState(24, 24);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      setZone(state, x, y, CellZone.Grass);
      if (catalogId === 'bridge-teak' && x >= 10 && x <= 12) setTerrain(state, x, y, TerrainType.Water, 1);
      if (catalogId === 'ramp-grassy' && x <= 9) setTerrain(state, x, y, TerrainType.Mountain, 1);
    }
    const ctx = makeToolCtx(state, exec(state), 1, 1, { armedItem: catalogId });
    const at = m(10, 10);
    const plan = placementHover(catalogId, at, ctx)!;
    expect(plan.valid).toBe(true);
    expect(plan.span).toBeDefined();
    const preview = vi.fn();
    ctx.overlay.showPlacementGhost = preview;
    const tool = new ObjectPlacerTool();
    tool.onPointerMove(cell(at), point(at), ctx);
    const span = plan.span!;
    expect(preview).toHaveBeenCalledWith(
      { catalogId, x: span.position.x, y: span.position.y, rotation: span.rotation, elevation: span.elevation, spanLength: span.spanLength }, true,
    );
    tool.onPointerDown(cell(at), point(at), ctx);
    const placed = objectsByCatalog(state, catalogId)[0]!;
    expect(placed).toMatchObject({ position: span.position, rotation: span.rotation, elevation: span.elevation });
    expect(placed.spanLength).toBe(span.spanLength);
    ctx.overlay.clearGhost = vi.fn();
    preview.mockClear();
    tool.onPointerMove(cell(m(18, 18)), point(m(18, 18)), ctx);
    expect(ctx.overlay.clearGhost).toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
  });
});
