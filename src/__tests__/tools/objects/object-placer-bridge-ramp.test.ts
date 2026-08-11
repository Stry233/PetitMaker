// Regression: the placer validates a placement BEFORE executing (to protect roads). The bridge (waterSpan)
// and ramp (heightDrop) traits SNAP — mutate — the command's position during validation, so validating the
// real command and then re-validating it in executeCommand double-snapped and wrongly REJECTED a perfectly
// legal bridge/ramp (the ghost was green, but placing it failed). The placer now validates a throwaway
// clone, so the original is snapped exactly once. These tests place a bridge across a river and a ramp up a
// cliff through the real tool and assert the object lands.
import { describe, it, expect } from 'vitest';
import { ObjectPlacerTool } from '../../../tools/objects/object-placer';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { TerrainType, CellZone, type EditorEvents, type MacroCoord } from '../../../core/model/types';
import { makeState, setTerrain, setZone } from '../../rules/_helpers';
import { makeToolCtx, objectsByCatalog } from '../_tool-ctx';
import { roadLookup } from '../../../state/object-index';

const m = (x: number, y: number): MacroCoord => ({ x, y });
const exec = (s: any) => new CommandExecutor(s, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(s));

describe('ObjectPlacerTool: bridge + ramp placement (double-snap regression)', () => {
  it('places a bridge across a painted water river', () => {
    const S = 24; const state = makeState(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) setZone(state, x, y, CellZone.Grass);
    for (let y = 2; y < S - 2; y++) for (const x of [10, 11, 12]) setTerrain(state, x, y, TerrainType.Water, 1); // 3-wide river, ground banks
    const ex = exec(state);
    new ObjectPlacerTool().onPointerDown(m(11, 11), m(11, 11), makeToolCtx(state, ex, 1, 1, { armedItem: 'bridge-teak' })); // width 2, waterSpan 3-6
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
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { setZone(state, x, y, CellZone.Grass); if (s.hi(x, y)) setTerrain(state, x, y, TerrainType.Mountain, 1); }
      const ex = exec(state);
      new ObjectPlacerTool().onPointerDown(s.at, s.at, makeToolCtx(state, ex, 1, 1, { armedItem: 'ramp-teak-stair' })); // width 2, height 4, heightDrop 1
      expect(objectsByCatalog(state, 'ramp-teak-stair').length, `ramp placed (${s.name})`).toBe(1);
    }
  });

  // Edge case: the ramp's bottom support is 3.5 macro blocks. A lower terrace of only 3
  // blocks is too short — the ramp must be rejected, AND the ghost must read red (not green), because the
  // ghost now validates through the same rule. A 5-block terrace fits and places.
  it('rejects a ramp on a too-short (3-block) lower terrace — incl. the ghost; accepts a 5-block one', () => {
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
      const ctx = makeToolCtx(state, exec(state), 1, 1, { armedItem: 'ramp-teak-stair' }); // width 2, spanLen 4
      ctx.overlay = { showGhost: (_cells: MacroCoord[], color: unknown) => { captured = color; }, clearGhost() {}, flashCommit() {} } as any;
      new ObjectPlacerTool().onPointerMove(m(10, 10), m(10, 10), ctx);
      return captured;
    };

    // 3-block terrace: too short → rule rejects + nothing places + ghost red
    const tooShort = build(3);
    const exS = exec(tooShort);
    new ObjectPlacerTool().onPointerDown(m(10, 10), m(10, 10), makeToolCtx(tooShort, exS, 1, 1, { armedItem: 'ramp-teak-stair' }));
    expect(objectsByCatalog(tooShort, 'ramp-teak-stair').length, 'no ramp on a 3-block terrace').toBe(0);
    const shortColor = ghostColor(build(3));

    // 5-block terrace: fits → places + ghost green
    const ok = build(5);
    const exOk = exec(ok);
    new ObjectPlacerTool().onPointerDown(m(10, 10), m(10, 10), makeToolCtx(ok, exOk, 1, 1, { armedItem: 'ramp-teak-stair' }));
    expect(objectsByCatalog(ok, 'ramp-teak-stair').length, 'ramp placed on a 5-block terrace').toBe(1);
    const okColor = ghostColor(build(5));

    expect(shortColor, 'ghost RED on the too-short terrace, GREEN on the good one').not.toBe(okColor);
  });
});
