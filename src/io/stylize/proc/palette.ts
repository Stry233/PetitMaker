/*
 * palette.ts — a pack declares VALUE first, and the declaration is checked.
 *
 * The shipped map palette fails three of the four rules below, which is most of why the raw export
 * reads flatter than a drawn picture: its nine elevation greens never go darker than OKLab L 0.49,
 * its water sits within 0.02 of its lowland green, and several path surfaces land on a green they
 * cross. Those are not stylistic complaints; they are the reason a path can vanish into the lawn at
 * thumbnail size. A procedural pack must not reproduce them, so its palette is validated rather
 * than eyeballed.
 */
import { lightness } from './oklab';

export interface PackPalette {
  /** The substrate the picture sits on. */
  paper: string;
  /** Ground values, lightest first. A pack may declare as few as two. */
  ground: readonly string[];
  /** Open water and its deeper form. */
  water: string;
  waterDeep: string;
  /** The path surface, and the shade under its kerb. */
  road: string;
  roadShade: string;
  /** How the pack draws a path.
   *
   *  `filled` paints the surface, so the surface itself must clear the ground it crosses.
   *  `reserved` leaves the path as bare substrate and draws its EDGE instead, which is how a
   *  porcelain painter or a watercolourist draws a light line — by not putting anything there. A
   *  reserved path reads by its rim, so the rule is checked against the rim colour. */
  roadTreatment?: 'filled' | 'reserved';
  /** The darkest value in the pack. Ink, shadow, outline: whatever carries the anchor. */
  dark: string;
}

/** Water must clear the DOMINANT ground by this much, or the two read as one mass. */
export const MIN_WATER_GROUND_DELTA = 0.1;
/** The road must clear the DOMINANT ground by this much, or the lattice stops carrying. */
export const MIN_ROAD_GROUND_DELTA = 0.18;
/** Against the rarer ground values a smaller floor applies: a road crossing a high terrace may
 *  close on it without the picture failing, but it must not disappear into it. */
export const MIN_ROAD_TIER_DELTA = 0.07;
/** A pack needs a real dark somewhere, or nothing in it reads as structure. */
export const MAX_DARK_ANCHOR = 0.32;

/** Check a pack palette. Returns one message per violation; empty means the palette is sound. */
export function validatePalette(p: PackPalette): string[] {
  const problems: string[] = [];
  const ground = p.ground.map(lightness);

  if (ground.length === 0) problems.push('ground ramp is empty');

  const dark = lightness(p.dark);
  if (dark > MAX_DARK_ANCHOR) {
    problems.push(`dark anchor is L ${dark.toFixed(3)}, above the ${MAX_DARK_ANCHOR} ceiling`);
  }

  for (let i = 1; i < ground.length; i++) {
    if (ground[i]! >= ground[i - 1]!) {
      problems.push(`ground ramp is not strictly darkening at step ${i} (${ground[i - 1]!.toFixed(3)} then ${ground[i]!.toFixed(3)})`);
    }
  }

  /* Both rules are written against ground[0] because that is the ground a real map is made of:
     on the reference maps 23,337 of 23,660 cells stand at base elevation, and one has no raised
     cell at all. A rule demanding clearance from every tier at once is unsatisfiable for any ramp
     wider than the threshold, and it would be asking the palette to solve a case that barely
     occurs. The tiers get a smaller floor of their own. */
  const dominant = ground[0];
  if (dominant !== undefined) {
    const water = lightness(p.water);
    const dw = Math.abs(water - dominant);
    if (dw < MIN_WATER_GROUND_DELTA) {
      problems.push(`water clears the dominant ground by only ${dw.toFixed(3)}`);
    }

    // A reserved path is read by the edge drawn around it, so that edge is what must clear.
    const reserved = p.roadTreatment === 'reserved';
    const carrier = reserved ? p.dark : p.road;
    const label = reserved ? 'the reserved path rim' : 'road';
    const road = lightness(carrier);
    const dr = Math.abs(road - dominant);
    if (dr < MIN_ROAD_GROUND_DELTA) {
      problems.push(`${label} clears the dominant ground by only ${dr.toFixed(3)}`);
    }
    for (let i = 1; i < ground.length; i++) {
      const d = Math.abs(road - ground[i]!);
      if (d < MIN_ROAD_TIER_DELTA) {
        problems.push(`${label} clears ground tier ${i} by only ${d.toFixed(3)}`);
      }
    }
  }

  return problems;
}

/** The lightness spread a picture spans. A pack whose range is narrow has no value structure, and
 *  no amount of texture will rescue it at the size the picture is first seen. */
export function valueRange(hexes: readonly string[]): { min: number; max: number; span: number } {
  const ls = hexes.map(lightness);
  const min = Math.min(...ls);
  const max = Math.max(...ls);
  return { min, max, span: max - min };
}
