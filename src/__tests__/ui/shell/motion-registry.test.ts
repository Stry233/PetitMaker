/**
 * The motion registry's own contract.
 *
 * The tier a motion belongs to decides what it must declare, and the type system carries most of
 * that. What a type cannot carry is that the declared value is MEANINGFUL: a `says` of '' compiles,
 * and an amplitude below the floor compiles. Those are what these assert.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isTween } from '../../../ui/shell/motion/curves';
import {
  AMPLITUDE_FLOOR_OPACITY, AMPLITUDE_FLOOR_PX, AMPLITUDE_FLOOR_SCALE, CURVES, MOTIONS, type Motion,
} from '../../../ui/shell/motion/registry';

function sources(dir: string): { path: string; text: string }[] {
  return (readdirSync(dir) as string[]).flatMap((name) => {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [{ path: full, text: readFileSync(full, 'utf8') }] : [];
  });
}

/** The table is `as const satisfies`, so each entry's inferred type is its own literal shape and an
 *  optional field it happens not to set is absent from it. These assertions are about the CONTRACT,
 *  which is what a new entry will be written against. */
const entries = Object.entries(MOTIONS) as [string, Motion][];

describe('the motion registry', () => {
  it('names every motion once', () => {
    const ids = Object.keys(MOTIONS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('gives every motion a curve from the closed set', () => {
    for (const [id, m] of entries) {
      expect(CURVES[m.curve], `${id} names an unknown curve`).toBeDefined();
    }
  });

  /** V2's fifth rule as a test: a motion whose only answer is "looks nice" is ambient or it is not
   *  registered. An inform entry states the fact it underlines, or it is not one. */
  it('makes every informing motion say what it says', () => {
    for (const [id, m] of entries) {
      if (m.tier !== 'inform') continue;
      expect(m.says.trim().length, `${id} declares no fact`).toBeGreaterThan(0);
    }
  });

  /**
   * The idle bob was removed from V2 for reading as sub-pixel font jitter rather than as liveness.
   * Below this floor a motion is a rendering fault, so an ambient entry clears it or it is not one.
   */
  it('keeps every decorative motion above the amplitude it stops reading at', () => {
    for (const [id, m] of entries) {
      if (m.tier !== 'ambient') continue;
      const floor = m.amplitudeUnit === 'scale' ? AMPLITUDE_FLOOR_SCALE
        : m.amplitudeUnit === 'opacity' ? AMPLITUDE_FLOOR_OPACITY
          : AMPLITUDE_FLOOR_PX;
      expect(m.amplitude, `${id} is below the floor it would read at`).toBeGreaterThanOrEqual(floor);
    }
  });

  /** A bezier is a shape with no length until something gives it one, and a spring already carries
   *  its timing in its physics. Either mistake makes a motion that does not run as written. */
  it('gives a duration to every tween and to no spring', () => {
    for (const [id, m] of entries) {
      if (isTween(m.curve)) expect(m.duration, `${id} is a tween with no length`).toBeGreaterThan(0);
      else expect(m.duration, `${id} is a spring carrying a duration`).toBeUndefined();
    }
  });
});

/**
 * A CALL SITE NAMES A MOTION, IT DOES NOT CHOOSE ONE.
 *
 * Modelled on `__tests__/core/prefs.test.ts`, which fails on a storage key written outside its one
 * table. The same argument applies: a number chosen at a call site is a decision nobody can find,
 * and V2's chrome drifted exactly that way. The registry's own directory is exempt, because that is
 * where the numbers are supposed to be.
 */
describe('no motion is chosen at a call site', () => {
  const OFFENDER = /duration:\s*[0-9.]+|stiffness:\s*[0-9]+|damping:\s*[0-9]+|cubic-bezier\(|ease:\s*\[/;

  it('every curve and duration under ui/shell comes from the registry', () => {
    const found = sources('src/ui/shell')
      .filter(({ path }) => !path.includes('/motion/'))
      .flatMap(({ path, text }) => text.split('\n').flatMap((line, i) => (
        OFFENDER.test(line) ? [`${path}:${i + 1}${line.trim()}`] : []
      )));
    expect(found).toEqual([]);
  });
});
