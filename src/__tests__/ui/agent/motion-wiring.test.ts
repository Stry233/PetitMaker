/**
 * The registry and the panel say the same thing.
 *
 * A declaration nothing runs and a motion nothing declared are the SAME defect from two sides:
 * without this scan the registry accumulates entries with no call site while animations (a ticket
 * turning, a tape filling) grow numbers of their own. Neither side is visible from inside one file,
 * which is why this is a test.
 *
 * Modelled on `__tests__/ui/shell/motion-registry.test.ts`'s own call-site scan. Scope is the
 * `panel.*` ids: the `character.*` entries name motions the character makes BESIDE a pose (the
 * blink, the two badge swaps, the morph leap), and a POSE's own keyframes live in
 * `character/poses.ts`, a table that predates the registry and is its own subject.
 *
 * `DECLARED_AHEAD_OF_CONSUMER` below is the one named exception to "every id has a call site":
 * a motion whose card has not been built yet, admitted rather than hidden.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { MOTIONS } from '../../../ui/shell/motion/registry';
import { CURVES } from '../../../ui/shell/motion/curves';
import {
  cssMotion, flipProfile, framerMotion, outMotion, outSeconds, seconds, turnSeconds,
} from '../../../ui/agent/motion';

const DIR = 'src/ui/agent';

/**
 * THE ONE `panel.*` MOTION FAMILY THE PANEL DOES NOT DRIVE. Docking moves the panel and the whole
 * interface together, so the sequence and the fraction every surface multiplies live in the shell
 * (`ui/shell/use-dock.ts`) rather than behind the panel's lazy boundary — which puts the call sites for
 * `panel.pin.*` there. Named as a file rather than by widening the scan to `ui/shell`, whose own
 * motions are `motion-registry.test.ts`'s subject.
 */
const DOCK_DRIVER = 'src/ui/shell/use-dock.ts';

function sources(dir: string): { path: string; text: string }[] {
  return (readdirSync(dir) as string[]).flatMap((name) => {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [{ path: full, text: readFileSync(full, 'utf8') }] : [];
  });
}

const files = [...sources(DIR), { path: DOCK_DRIVER, text: readFileSync(DOCK_DRIVER, 'utf8') }];
const allText = files.map((f) => f.text).join('\n');
const panelIds = Object.keys(MOTIONS).filter((id) => id.startsWith('panel.'));

/**
 * DECLARED AHEAD OF THE FAMILY TASK THAT CONSUMES THEM.
 *
 * The vocabulary in `registry.ts` is the whole panel's, fixed against the normative artifact
 * before every card it describes has been built. It is EMPTY: every declared panel motion has a
 * runner.
 * Naming a motion before the card is honest as long as the gap is named here rather than passing
 * silently: an id LEAVES this set the same commit that gives it a call site, never before.
 */
const DECLARED_AHEAD_OF_CONSUMER: ReadonlySet<string> = new Set<string>([]);

describe('every declared panel motion has a runner', () => {
  it('declares at least one, so an empty table cannot pass this file', () => {
    expect(panelIds.length).toBeGreaterThan(0);
  });

  /** A declaration nothing names is a promise about the interface that the interface does not keep:
   *  it reads as "this moves" to everyone downstream of the registry, and nothing moves — unless the
   *  gap is the OTHER honest one, above. */
  it('names every one of them at a call site, or admits it has none yet', () => {
    const unwired = panelIds.filter((id) => !allText.includes(`'${id}'`) && !DECLARED_AHEAD_OF_CONSUMER.has(id));
    expect(unwired).toEqual([]);
  });

  /** The admission has to cost something, or every future orphan hides behind it: an id the sources
   *  already name has a real call site and does not belong on the list. */
  it('keeps the admitted set to ids that truly have no call site yet', () => {
    const wrongly = [...DECLARED_AHEAD_OF_CONSUMER].filter((id) => allText.includes(`'${id}'`));
    expect(wrongly).toEqual([]);
  });
});

describe('no panel motion is chosen at a call site', () => {
  // The shell's own offender set, plus the two CSS spellings a hand-written transition or animation
  // string can carry a number in.
  const OFFENDER = /duration:\s*[0-9.]+|stiffness:\s*[0-9]+|damping:\s*[0-9]+|cubic-bezier\(|ease:\s*\[|transition:\s*[`'"][^`'"]*[0-9]s|animation:\s*[`'"][^`'"]*[0-9]s/;
  // `motion.ts` is the adapter that reads the registry, so it is the one file allowed to hold the
  // words a duration is made of. `character/` is the pose table this file's header excludes: its
  // keyframes are a drawing's own choreography, declared per pose rather than per motion, and it
  // predates the registry (the same standing exemption the canvas primitives have).
  //
  // `sketchbook/sketch-motion.ts` joins it on the same footing, and the exemption is DELIBERATE
  // rather than convenient. The registry declares interface motions: one thing moving, once, at one
  // call site. The idle dressings are LOOPS whose beats are only meaningful against each other (the
  // wipe 800ms before the next idea, the ritual halfway through the hold, the dream's glyph inside
  // its own hold), so cutting the sheet into registry entries would spread one piece of timing over
  // a dozen ids and still leave nobody able to read it. Both loops are AMBIENT and both are dropped
  // whole under reduced motion, which is the registry's own tier for exactly this.
  const EXEMPT = ['/motion.ts', '/sketchbook/sketch-motion.ts'];
  const EXEMPT_DIRS = ['/character/'];

  it('takes every duration and curve from the registry', () => {
    const found = files
      .filter(({ path }) => !EXEMPT.some((e) => path.endsWith(e)) && !EXEMPT_DIRS.some((d) => path.includes(d)))
      .flatMap(({ path, text }) => text.split('\n').flatMap((line: string, i: number) => (
        OFFENDER.test(line) ? [`${path}:${i + 1}${line.trim()}`] : []
      )));
    expect(found).toEqual([]);
  });
});

/**
 * THE THREE GATES, on the panel's side of them.
 *
 * Framer-driven motion is gated by App's own `<MotionConfig>`; a hand-written CSS transition is
 * gated twice, by `animations.css`'s catch-all under `[data-reduced-motion='1']` AND by the caller
 * passing the answer it already holds into `cssMotion` — the same JS+CSS double gate the rest of the
 * panel wears, so a component is testable without touching the document attribute.
 */
describe('the adapter honours reduced motion, and reads its numbers from the declaration', () => {
  it('collapses a CSS transition outright rather than shortening it', () => {
    expect(cssMotion('panel.dock.paper', ['background-color'], true)).toBe('none');
    expect(cssMotion('panel.dock.paper', ['background-color'], false))
      .toContain(`${seconds('panel.dock.paper')}s`);
  });

  it('gives a tween its declared length and a spring none at all', () => {
    expect(framerMotion('panel.op.enter')).toMatchObject({ duration: seconds('panel.op.enter') });
    expect(framerMotion('panel.gate.enter')).toMatchObject({ type: 'spring' });
    expect('duration' in framerMotion('panel.gate.enter')).toBe(false);
  });

  // Split on the JOIN, not on every comma: a bezier carries four of its own.
  it('writes one transition per property asked for', () => {
    const value = cssMotion('panel.tape.fill', ['width', 'opacity']);
    expect(value.split(', ').filter((part) => /^(width|opacity) /.test(part))).toHaveLength(2);
  });

  /** The dock flip's leave is a declared FRACTION of the entry's own length (see the entry's own
   *  comment): `outSeconds` is the one reader, so DeskHeader's call site does no multiplication of
   *  its own and a retune of either number moves both halves together. */
  it('derives the flip\'s leave length from the registry\'s own declared share', () => {
    const share = MOTIONS['panel.dock.flip'].outShare;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
    expect(outSeconds('panel.dock.flip')).toBeCloseTo(seconds('panel.dock.flip') * (share ?? 1));
    // An id with no declared share runs its one length both ways.
    expect(outSeconds('panel.op.enter')).toBe(seconds('panel.op.enter'));
  });
});

/**
 * THE FLIP'S PROFILE IS THREE SEGMENTS AND THREE SHAPES, and the weight is in the spacing of them.
 *
 * Framer spaces keyframes evenly unless told otherwise, so a three-frame rotation with one curve
 * over it puts the overshoot at the halfway mark and gives the settle back as long as the whole
 * approach: the landing reads as a swing rather than as weight. And a DEPARTURE is not an arrival
 * reversed — it accelerates away, having no mark to settle on.
 */
describe('a flip asks the registry for its profile, not for a curve', () => {
  const flip = MOTIONS['panel.dock.flip'];

  it('declares where the overshoot sits and which curve settles back from it', () => {
    expect(flip.overshootAt).toBeGreaterThan(0.5);
    expect(flip.overshootAt).toBeLessThan(1);
    expect(flip.landCurve).toBeDefined();
    expect(flip.outCurve).toBeDefined();
  });

  it('spaces the keyframes by that declaration and gives each segment its own easing', () => {
    const profile = flipProfile('panel.dock.flip') as { times?: number[]; ease?: unknown[] };
    expect(profile.times).toEqual([0, flip.overshootAt, 1]);
    // One easing per SEGMENT, so the array is one shorter than the keyframe list.
    expect(profile.ease).toHaveLength(2);
    expect(profile.ease![0]).toEqual(CURVES[flip.curve].ease);
    expect(profile.ease![1]).toEqual(CURVES[flip.landCurve!].ease);
  });

  it('gives the leave its own length and its own accelerating curve', () => {
    const out = outMotion('panel.dock.flip') as { duration?: number; ease?: unknown };
    expect(out.duration).toBeCloseTo(outSeconds('panel.dock.flip'));
    expect(out.ease).toEqual(CURVES[flip.outCurve!].ease);
    // The accelerating leave is NOT the landing's curve: one motion reversed is not the other.
    expect(out.ease).not.toEqual(CURVES[flip.curve].ease);
  });

  it('adds up the whole turn, which is how long a guard over the turning card must stand', () => {
    expect(turnSeconds('panel.dock.flip'))
      .toBeCloseTo(outSeconds('panel.dock.flip') + seconds('panel.dock.flip'));
  });

  /** An entry with no declared overshoot keeps the plain transition: the default spacing is what
   *  every other keyframe motion in the panel wants. */
  it('leaves a motion that declares no overshoot exactly as it was', () => {
    expect(flipProfile('panel.op.enter')).toEqual(framerMotion('panel.op.enter'));
  });
});
