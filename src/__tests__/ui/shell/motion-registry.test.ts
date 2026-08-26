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

  /** The dock's state-identity flip is its own motion, distinct from `panel.dock.paper`'s in-place
   *  crossfade (a clock tick, a countdown digit, a mid-state word repainting the standing face). */
  it('declares the dock flip as an informing motion', () => {
    expect(MOTIONS['panel.dock.flip'].tier).toBe('inform');
  });

  it('gives every motion a curve from the closed set', () => {
    for (const [id, m] of entries) {
      expect(CURVES[m.curve], `${id} names an unknown curve`).toBeDefined();
    }
  });

  /** A motion whose only answer is "looks nice" is ambient or it is not registered. An inform entry
   *  states the fact it underlines, or it is not one. */
  it('makes every informing motion say what it says', () => {
    for (const [id, m] of entries) {
      if (m.tier !== 'inform') continue;
      expect(m.says.trim().length, `${id} declares no fact`).toBeGreaterThan(0);
    }
  });

  /**
   * An idle bob under this amplitude reads as sub-pixel font jitter rather than as liveness. Below
   * the floor a motion is a rendering fault, so an ambient entry clears it or it is not one.
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

  /**
   * `linear` is the ONE curve that declines to have a shape, so a motion may only name it where the
   * shape is not the registry's to choose (`curves.ts` states the two cases). Those two are
   * distinguishable here: a seamless LOOP has to travel at a constant rate, and a SAMPLED track
   * carries its shape in frames whose travel is measured at run time, so it declares no amplitude.
   * A motion that is neither has simply skipped choosing a curve.
   */
  it('lets only a loop or a sampled track decline to have a shape', () => {
    for (const [id, m] of entries) {
      if (m.curve !== 'linear') continue;
      const sampled = m.amplitude === undefined;
      expect(m.loop === true || sampled, `${id} is linear but neither a loop nor a sampled track`).toBe(true);
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
 * and chrome drifts exactly that way. The registry's own directory is exempt, because that is
 * where the numbers are supposed to be.
 */
describe('no motion is chosen at a call site', () => {
  const OFFENDER = /duration:\s*[0-9.]+|stiffness:\s*[0-9]+|damping:\s*[0-9]+|cubic-bezier\(|ease:\s*\[/;

  /**
   * The DECLARATION tables, which are where the numbers are supposed to be.
   *
   * `ui/shell/motion/` is the registry itself. The panel's own three are the same kind of thing one
   * layer down: `ui/agent/motion.ts` is the bridge that reads the registry, `character/poses.ts` is
   * the character's choreography transcribed WHOLE from the normative prototype (one drawing's WAAPI
   * tracks, per-track and in ms, which is not a shape the registry speaks), and
   * `sketchbook/sketch-motion.ts` is the idle dressings' beat sheet — two LOOPS whose numbers are
   * only meaningful against each other, both ambient and both dropped whole under reduced motion.
   * What the guard is for either way is a number written where the thing MOVES.
   */
  const TABLES = [
    '/ui/shell/motion/', '/ui/agent/motion.ts', '/ui/agent/character/poses.ts',
    '/ui/agent/sketchbook/sketch-motion.ts',
  ];

  function offenders(dir: string): string[] {
    return sources(dir)
      .filter(({ path }) => !TABLES.some((t) => `/${path}`.includes(t)))
      .flatMap(({ path, text }) => text.split('\n').flatMap((line, i) => (
        OFFENDER.test(line) ? [`${path}:${i + 1}${line.trim()}`] : []
      )));
  }

  it('every curve and duration under ui/shell comes from the registry', () => {
    expect(offenders('src/ui/shell')).toEqual([]);
  });

  /** The panel is chrome the shell stands beside, held to the shell's own rule. */
  it('every curve and duration under ui/agent comes from a declaration', () => {
    expect(offenders('src/ui/agent')).toEqual([]);
  });
});
