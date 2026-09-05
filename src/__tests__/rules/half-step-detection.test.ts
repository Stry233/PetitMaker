/**
 * Half-step span items at the detection level: bridge-span and
 * heightDrop walking the half grid. The reported cases are (a) a ramp that only
 * fits flush at a half anchor beside a mountain edge and (b) the 0.5 + 1 + 0.5
 * gap — half a block of mountain either side of a one-block gap — which the
 * whole-cell grid cannot express.
 *
 * Terrain renders at -HALF_TILE, so a terrain cell's visual extent is
 * [c - 0.5, c + 0.5): a footprint anchored on a WHOLE coordinate straddles one
 * extra cell on each axis (the dual-grid bleed), while a HALF-anchored one lands
 * exactly on the cells it covers. That is the whole of the unlock.
 */
import { describe, it, expect } from 'vitest';
import { traitPlacementRule } from '../../rules/placement';
import { createDefaultRegistry } from '../../rules/index';
import { detectBridgeSpan } from '../../core/model/bridge-span';
import { CellZone, CommandType, ItemCategory, TerrainType } from '../../core/model/types';
import type { GridState, PlaceObjectCommand } from '../../core/model/types';
import { makeState, setTerrain, setZone } from './_helpers';
import { registerCatalogItem } from '../../state/catalog';

// A bridge WITHOUT the halfStep trait: the gate. Its detection must answer exactly
// as the shipped (halfStep) bridges do on a whole anchor, and it must never reach
// detection at all on a half one.
registerCatalogItem({
  id: 'hsd-plain-bridge', category: ItemCategory.Bridge, name: { en: 'Plain Bridge' },
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [{ type: 'waterSpan', min: 3, max: 6 }],
});

function place(id: string, x: number, y: number): PlaceObjectCommand {
  return {
    type: CommandType.PlaceObject,
    timestamp: 0,
    object: { id: 'test', catalogId: id, position: { x, y }, rotation: 0, elevation: 0 },
    loadValue: 0,
  };
}

/** The snapped placement a trait writes back onto the command, or null when refused. */
function snap(id: string, x: number, y: number, state: GridState) {
  const cmd = place(id, x, y);
  const errors = traitPlacementRule.validate(cmd, state);
  if (errors.length > 0) return null;
  const { position, rotation, elevation, spanLength } = cmd.object;
  return { position, rotation, elevation, spanLength };
}

/** Same, through the whole pre-command registry — the snapped footprint then also
 *  faces V-ZONE-01 / V-PLACE-OVERLAP, which read the position the trait wrote. */
function snapThroughRegistry(id: string, x: number, y: number, state: GridState) {
  const cmd = place(id, x, y);
  const errors = createDefaultRegistry().validatePreCommand(cmd, state);
  if (errors.length > 0) return null;
  const { position, rotation, elevation, spanLength } = cmd.object;
  return { position, rotation, elevation, spanLength };
}

function grassMap(size = 20): GridState {
  const state = makeState(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) setZone(state, x, y, CellZone.Grass);
  return state;
}

/** A level-1 plateau over y <= 9 with bare ground below it: a cliff of one layer
 *  running along the y = 9/10 boundary, which a ramp descends. */
function plateauMap(size = 20): GridState {
  const state = grassMap(size);
  for (let y = 0; y <= 9; y++) for (let x = 0; x < size; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
  return state;
}

describe('heightDrop on the half grid', () => {
  it('(a) a ramp fits flush at a half anchor where every whole anchor is blocked', () => {
    // The low ground carries a mountain shoulder at x = 7 and a water bank at x = 4;
    // the open lane is exactly the ramp's two cells wide (x = 5, 6). A whole anchor
    // sweeps three columns (the bleed) and always hits one of the two.
    const build = () => {
      const state = plateauMap();
      for (let y = 10; y <= 14; y++) {
        setTerrain(state, 7, y, TerrainType.Mountain, 1);
        setTerrain(state, 4, y, TerrainType.Water, 0);
      }
      return state;
    };
    expect(snap('ramp-teak-stair', 5, 10, build()), 'whole anchor: the sweep hits the shoulder').toBeNull();
    expect(snap('ramp-teak-stair', 6, 10, build()), 'whole anchor one over: still blocked').toBeNull();

    const half = snap('ramp-teak-stair', 4.5, 10, build());
    expect(half, 'half anchor: the ramp lands in the lane').not.toBeNull();
    expect(half!.position).toEqual({ x: 4.5, y: 9 });
    expect(half!.rotation).toBe(0);
    expect(half!.elevation).toBe(1);
    // and it survives the rest of the pre-command rules (V-ZONE-01 reads the snapped position)
    expect(snapThroughRegistry('ramp-teak-stair', 4.5, 10, build())).toEqual(half);
  });

  it('(b) the 0.5 + 1 + 0.5 gap takes a one-wide ramp', () => {
    // Mountain shoulders at x = 4 and x = 6 leave one block of open ground at x = 5.
    const build = () => {
      const state = plateauMap();
      for (let y = 10; y <= 14; y++) {
        setTerrain(state, 4, y, TerrainType.Mountain, 1);
        setTerrain(state, 6, y, TerrainType.Mountain, 1);
      }
      return state;
    };
    expect(snap('ramp-plank', 5, 10, build()), 'whole anchor: every direction hits a shoulder').toBeNull();

    const half = snap('ramp-plank', 4.5, 10, build());
    expect(half, 'half anchor: the ramp sits between the shoulders').not.toBeNull();
    expect(half!.position).toEqual({ x: 4.5, y: 9 });
    expect(half!.rotation).toBe(0);
    expect(half!.elevation).toBe(1);
    expect(snapThroughRegistry('ramp-plank', 4.5, 10, build())).toEqual(half);
  });
});

describe('waterSpan on the half grid', () => {
  /** Banks of mountain at x = 4 and x = 8 on `rows`, water between them on `rows`. */
  function channel(rows: number[]): GridState {
    const state = grassMap();
    for (const y of rows) {
      setTerrain(state, 4, y, TerrainType.Mountain, 1);
      setTerrain(state, 8, y, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    }
    return state;
  }

  it('(b) a one-wide deck crosses a one-row channel at a half anchor', () => {
    // One row of bank is half a deck at a whole anchor (the bleed samples two rows),
    // so the whole-anchor placement is refused; the half anchor covers row 5 exactly.
    expect(snap('bridge-plank', 6, 5, channel([5])), 'whole anchor: the end reaches an unbanked row').toBeNull();

    const half = snap('bridge-plank', 6, 4.5, channel([5]));
    expect(half, 'half anchor: the deck lands on the channel').not.toBeNull();
    expect(half!.position).toEqual({ x: 4, y: 4.5 });
    expect(half!.rotation).toBe(0);
    expect(half!.spanLength).toBe(4);
    expect(half!.elevation).toBe(1);
    expect(snapThroughRegistry('bridge-plank', 6, 4.5, channel([5]))).toEqual(half);
  });

  it('(d) refuses a deck end resting half on rock and half on water', () => {
    // A two-wide deck at y = 4.5 covers rows 5 and 6 exactly. With the near bank's
    // row 6 flooded, one half of the end has no support under it.
    const flooded = channel([5, 6]);
    setTerrain(flooded, 4, 6, TerrainType.Water, 0);
    expect(snap('bridge-teak', 6, 4.5, flooded), 'end half on rock, half on water').toBeNull();

    const banked = snap('bridge-teak', 6, 4.5, channel([5, 6]));
    expect(banked, 'the same span with both rows banked').not.toBeNull();
    expect(banked!.position).toEqual({ x: 4, y: 4.5 });
    expect(banked!.spanLength).toBe(4);
  });
});

describe('a doubly-half anchor (both axes on the half grid — a hover near a corner rounds both)', () => {
  /** Banks of mountain at x = 4 and x = 8 on `rows`, water between them on `rows`. */
  function channel(rows: number[]): GridState {
    const state = grassMap();
    for (const y of rows) {
      setTerrain(state, 4, y, TerrainType.Mountain, 1);
      setTerrain(state, 8, y, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    }
    return state;
  }

  it('bridge: the along axis still resolves whole, the across axis keeps its half offset', () => {
    // The gap walk's own induction (see bridge-span.ts's header) rescues a half ALONG input: the
    // first raised read can only land on a whole cell, whichever axis carries it. Anchoring at
    // x = 6.5 (half on the span axis too, not just y) must reach the exact same span as the whole-
    // and single-half-axis anchors already pinned above.
    const state = channel([5]);
    const whole = snap('bridge-plank', 6, 4.5, state)!;
    expect(snap('bridge-plank', 6.5, 4.5, state)).toEqual(whole);
    expect(Number.isInteger(whole.position.x)).toBe(true);
    expect(Number.isInteger(whole.spanLength)).toBe(true);
  });

  it('ramp: the along axis rounds onto a whole cell instead of leaking the anchor\'s own half', () => {
    // A ramp read from the HIGH side (anchorIsHigh) takes the anchor's own coordinate as the
    // along-axis position verbatim — so a hover that rounds BOTH axes to the half grid can hand
    // it a fractional along value the terrain-support sweep never actually validated at (it reads
    // the same cell via floor(v + 0.5) regardless). The rule must round it to that cell, not store
    // the half, while the across axis (x) keeps the offset the anchor supplied.
    const build = () => {
      const state = plateauMap();
      for (let y = 10; y <= 14; y++) {
        setTerrain(state, 7, y, TerrainType.Mountain, 1);
        setTerrain(state, 4, y, TerrainType.Water, 0);
      }
      return state;
    };
    const wholeAlong = snap('ramp-teak-stair', 4.5, 10, build())!; // pinned above: { x: 4.5, y: 9 }
    for (const y of [8.5, 9.5]) {
      const doubled = snap('ramp-teak-stair', 4.5, y, build());
      expect(doubled, `anchor (4.5, ${y})`).toEqual(wholeAlong);
      expect(Number.isInteger(doubled!.position.y), `anchor (4.5, ${y})`).toBe(true);
    }
  });
});

describe('granularity: nothing off the half grid gets in or out', () => {
  it('detectBridgeSpan refuses an anchor that is not on the half grid', () => {
    const state = grassMap();
    for (const y of [5, 6]) {
      setTerrain(state, 4, y, TerrainType.Mountain, 1);
      setTerrain(state, 8, y, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    }
    expect(detectBridgeSpan(state, { x: 6, y: 5 }, 1, 3, 6), 'whole anchor still detects').not.toBeNull();
    expect(detectBridgeSpan(state, { x: 6, y: 4.5 }, 1, 3, 6), 'half anchor detects').not.toBeNull();
    expect(detectBridgeSpan(state, { x: 6.33, y: 5 }, 1, 3, 6)).toBeNull();
    expect(detectBridgeSpan(state, { x: 6, y: 5.25 }, 1, 3, 6)).toBeNull();
  });

  it('a whole anchor never snaps onto a half cell', () => {
    // Everything that reads a footprint by whole-cell key (the agent's region lock,
    // the layer-number mask) only ever sees anchors from the generator and the agent,
    // which are whole. The half grid must stay reachable only from a half anchor.
    const state = plateauMap();
    for (let y = 10; y <= 14; y++) setTerrain(state, 7, y, TerrainType.Mountain, 1);
    for (let x = 3; x <= 12; x++) {
      for (let y = 8; y <= 12; y++) {
        for (const id of ['ramp-teak-stair', 'ramp-plank', 'bridge-plank', 'bridge-teak']) {
          const result = snap(id, x, y, state);
          if (!result) continue;
          expect(Number.isInteger(result.position.x), `${id} at ${x},${y}`).toBe(true);
          expect(Number.isInteger(result.position.y), `${id} at ${x},${y}`).toBe(true);
        }
      }
    }
  });

  it('the rule refuses an off-half position on a halfStep item', () => {
    const state = grassMap();
    for (const y of [5, 6]) {
      setTerrain(state, 4, y, TerrainType.Mountain, 1);
      setTerrain(state, 8, y, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    }
    const errors = traitPlacementRule.validate(place('bridge-plank', 6.33, 5), state);
    expect(errors.map((e) => e.message)).toContain('error.placement_off_grid');

    const rampErrors = traitPlacementRule.validate(place('ramp-plank', 4.25, 10), plateauMap());
    expect(rampErrors.map((e) => e.message)).toContain('error.placement_off_grid');
  });

  it('every snapped position lands on the half grid', () => {
    const state = channelState();
    for (const anchor of [{ x: 6, y: 5 }, { x: 6, y: 4.5 }, { x: 5.5, y: 5 }]) {
      const span = detectBridgeSpan(state, anchor, 1, 3, 6);
      if (!span) continue;
      expect(Number.isInteger(span.position.x * 2), `x on the half grid at ${anchor.x},${anchor.y}`).toBe(true);
      expect(Number.isInteger(span.position.y * 2), `y on the half grid at ${anchor.x},${anchor.y}`).toBe(true);
      expect(Number.isInteger(span.spanLength), 'span lengths stay whole').toBe(true);
    }
  });

  function channelState(): GridState {
    const state = grassMap();
    for (const y of [5, 6]) {
      setTerrain(state, 4, y, TerrainType.Mountain, 1);
      setTerrain(state, 8, y, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    }
    return state;
  }
});

describe('gating: only a halfStep item may anchor on a half cell', () => {
  it('refuses a half anchor on a span item without the trait', () => {
    const state = grassMap();
    for (const y of [5, 6]) {
      setTerrain(state, 4, y, TerrainType.Mountain, 1);
      setTerrain(state, 8, y, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    }
    const errors = traitPlacementRule.validate(place('hsd-plain-bridge', 6, 4.5), state);
    expect(errors.map((e) => e.message)).toContain('error.placement_off_grid');
  });

  it('answers a whole anchor identically with and without the trait', () => {
    const build = () => {
      const state = grassMap();
      for (const y of [5, 6]) {
        setTerrain(state, 4, y, TerrainType.Mountain, 1);
        setTerrain(state, 8, y, TerrainType.Mountain, 1);
        for (let x = 5; x <= 7; x++) setTerrain(state, x, y, TerrainType.Water, 0);
      }
      return state;
    };
    expect(snap('hsd-plain-bridge', 6, 5, build())).toEqual(snap('bridge-plank', 6, 5, build()));
  });
});

describe('whole-anchor placements remain legal', () => {
  it('pins the bridge span over a three-wide river, both orientations', () => {
    const horizontal = grassMap();
    for (const y of [5, 6]) {
      setTerrain(horizontal, 4, y, TerrainType.Mountain, 1);
      setTerrain(horizontal, 8, y, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) setTerrain(horizontal, x, y, TerrainType.Water, 0);
    }
    expect(snap('bridge-plank', 6, 5, horizontal)).toEqual({
      position: { x: 4, y: 5 }, rotation: 0, spanLength: 4, elevation: 1,
    });

    const vertical = grassMap();
    for (const x of [5, 6]) {
      setTerrain(vertical, x, 4, TerrainType.Mountain, 1);
      setTerrain(vertical, x, 8, TerrainType.Mountain, 1);
      for (let y = 5; y <= 7; y++) setTerrain(vertical, x, y, TerrainType.Water, 0);
    }
    expect(snap('bridge-plank', 5, 6, vertical)).toEqual({
      position: { x: 5, y: 4 }, rotation: 90, spanLength: 4, elevation: 1,
    });
  });

  it('pins the bridge over a dry valley and a two-wide deck', () => {
    const dry = grassMap();
    for (const y of [5, 6]) {
      setTerrain(dry, 4, y, TerrainType.Mountain, 2);
      setTerrain(dry, 8, y, TerrainType.Mountain, 2);
    }
    expect(snap('bridge-plank', 6, 5, dry)).toEqual({
      position: { x: 4, y: 5 }, rotation: 0, spanLength: 4, elevation: 2,
    });

    const wide = grassMap();
    for (const y of [5, 6, 7]) {
      setTerrain(wide, 4, y, TerrainType.Mountain, 1);
      setTerrain(wide, 8, y, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) setTerrain(wide, x, y, TerrainType.Water, 0);
    }
    expect(snap('bridge-teak', 6, 5, wide)).toEqual({
      position: { x: 4, y: 5 }, rotation: 0, spanLength: 4, elevation: 1,
    });
  });

  it('pins the ramp snap in all four drop directions', () => {
    const cases = [
      { name: 'top-high', hi: (_x: number, y: number) => y <= 9, at: { x: 8, y: 10 }, expect: { position: { x: 8, y: 9 }, rotation: 0 as const, elevation: 1, spanLength: undefined } },
      { name: 'bottom-high', hi: (_x: number, y: number) => y >= 11, at: { x: 8, y: 10 }, expect: { position: { x: 8, y: 7 }, rotation: 180 as const, elevation: 1, spanLength: undefined } },
      { name: 'left-high', hi: (x: number, _y: number) => x <= 9, at: { x: 10, y: 8 }, expect: { position: { x: 9, y: 8 }, rotation: 90 as const, elevation: 1, spanLength: undefined } },
      { name: 'right-high', hi: (x: number, _y: number) => x >= 11, at: { x: 10, y: 8 }, expect: { position: { x: 7, y: 8 }, rotation: 270 as const, elevation: 1, spanLength: undefined } },
    ];
    for (const c of cases) {
      const state = grassMap();
      for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if (c.hi(x, y)) setTerrain(state, x, y, TerrainType.Mountain, 1);
      expect(snap('ramp-teak-stair', c.at.x, c.at.y, state), c.name).toEqual(c.expect);
    }
  });

  it('pins the terrace-length refusal (a whole anchor still needs the bleed cell)', () => {
    const build = (lowLen: number) => {
      const state = grassMap(24);
      for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
        if (x <= 9) setTerrain(state, x, y, TerrainType.Mountain, 2);
        else if (x <= 9 + lowLen) setTerrain(state, x, y, TerrainType.Mountain, 1);
      }
      return state;
    };
    expect(snap('ramp-teak-stair', 10, 10, build(3)), 'a three-block terrace is too short').toBeNull();
    expect(snap('ramp-teak-stair', 10, 10, build(5))).toEqual({
      position: { x: 9, y: 10 }, rotation: 90, elevation: 2, spanLength: undefined,
    });
  });
});
