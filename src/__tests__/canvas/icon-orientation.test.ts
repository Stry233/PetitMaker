/**
 * Which way an icon faces in the 2D map.
 *
 * Two items carry an orientation the user never set: a bridge lies along the gap it spans, and a
 * ramp climbs one particular way. Both are drawn from one piece of art, so the art has to be turned
 * to match — otherwise the map shows a bridge across the wrong axis, or a slope running downhill.
 */
import './_pixi-env';   // ramp-graphic imports pixi, which needs jsdom's missing 2D context
import { describe, it, expect } from 'vitest';
import { rampIconTurn } from '../../canvas/map2d/draw/ramp-graphic';
import { getCatalogItem } from '../../state/catalog';

describe('the ramp badge', () => {
  // The art is drawn low-left to high-right, and the rotation names the UPHILL direction:
  // 0 north, 90 west, 180 south, 270 east (the same table the arrow overlay reads).
  it('is left as drawn when the ramp climbs east', () => {
    expect(rampIconTurn(270)).toEqual({ rotation: 0, flipX: false });
  });

  it('is MIRRORED when it climbs west, not turned upside down', () => {
    // A half turn would flip the ramp vertically too, which draws it hanging from its high end.
    expect(rampIconTurn(90)).toEqual({ rotation: 0, flipX: true });
  });

  it('is a quarter turn for the two vertical directions, in opposite senses', () => {
    const north = rampIconTurn(0), south = rampIconTurn(180);
    expect(north.flipX).toBe(false);
    expect(south.flipX).toBe(false);
    expect(north.rotation).toBeCloseTo(-Math.PI / 2, 10);
    expect(south.rotation).toBeCloseTo(Math.PI / 2, 10);
    expect(north.rotation).toBe(-south.rotation);
  });

  it('reads a rotation that has wrapped past a full turn', () => {
    expect(rampIconTurn(450)).toEqual(rampIconTurn(90));
    expect(rampIconTurn(-90)).toEqual(rampIconTurn(270));
  });
});

describe('the bridge', () => {
  it('is not rotatable by hand, yet its orientation is real', () => {
    // Which is why the sprite follows `obj.rotation` for a spanning item rather than `rotatable`:
    // the placement chose the axis, and the icon has to show the one the deck actually lies on.
    const bridge = getCatalogItem('bridge-iron');
    expect(bridge?.rotatable).toBe(false);
    expect(bridge?.traits.some((t) => t.type === 'waterSpan')).toBe(true);
  });
});
