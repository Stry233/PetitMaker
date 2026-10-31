/**
 * Every `panel.*` motion in the registry has a call site, and no panel source times its own motion.
 * The scan mirrors `__tests__/ui/design/motion-registry.test.ts`; pose keyframes live in
 * `character/poses.ts` and are out of scope.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MOTIONS } from '../../../ui/design/motion/registry';
import { CURVES } from '../../../ui/design/motion/curves';
import {
  cssMotion, flipProfile, framerMotion, outMotion, outSeconds, seconds, turnSeconds,
} from '../../../ui/design/motion';
import { repoFiles } from '../../_support/source-graph';
import EXEMPT from './motion-wiring-allowlist.json';

const DIR = 'src/ui/agent';

/** Docking moves the panel and the whole interface together, so the `panel.pin.*` call sites live in
 *  the shell, outside the panel's lazy boundary. Only this file is added, since `ui/shell` motions are
 *  `motion-registry.test.ts`'s subject. */
const DOCK_DRIVER = 'src/ui/shell/use-dock.ts';

function sources(dir: string): { path: string; text: string }[] {
  return repoFiles(dir).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
}

const files = [...sources(DIR), { path: DOCK_DRIVER, text: readFileSync(DOCK_DRIVER, 'utf8') }];
const allText = files.map((f) => f.text).join('\n') + readFileSync('src/ui/design/motion/index.ts', 'utf8');
const panelIds = Object.keys(MOTIONS).filter((id) => id.startsWith('panel.'));

describe('every declared panel motion has a runner', () => {
  it('declares at least one, so an empty table cannot pass this file', () => {
    expect(panelIds.length).toBeGreaterThan(0);
  });

  it('names every one of them at a call site', () => {
    const unwired = panelIds.filter((id) => !allText.includes(`'${id}'`) && !allText.includes(`"${id}"`));
    expect(unwired).toEqual([]);
  });
});

describe('no panel motion is chosen at a call site', () => {
  // The shell's offender set, plus a number in a hand-written CSS transition or animation string.
  const OFFENDER = /duration:\s*[0-9.]+|stiffness:\s*[0-9]+|damping:\s*[0-9]+|cubic-bezier\(|ease:\s*\[|transition:\s*[`'"][^`'"]*[0-9]s|animation:\s*[`'"][^`'"]*[0-9]s/;
  /** The files and folders (trailing slash) that time their own motion, each with its reason in
   *  `motion-wiring-allowlist.json`. */
  const exempt = (path: string): string | undefined =>
    Object.keys(EXEMPT).find((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));
  const offences = (path: string, text: string): string[] => text.split('\n').flatMap((line: string, i: number) => (
    OFFENDER.test(line) ? [`${path}:${i + 1}${line.trim()}`] : []
  ));

  it('takes every duration and curve from the registry', () => {
    const found = files.filter(({ path }) => !exempt(path)).flatMap(({ path, text }) => offences(path, text));
    expect(found).toEqual([]);
  });

  it('exempts only files that still time their own motion', () => {
    const timing = new Set(files.filter(({ path, text }) => offences(path, text).length > 0).map(({ path }) => exempt(path)));
    expect(Object.keys(EXEMPT).filter((entry) => !timing.has(entry))).toEqual([]);
  });
});

/** Framer motion is gated by App's `<MotionConfig>`. A CSS transition is gated both by
 *  `animations.css` under `[data-reduced-motion='1']` and by the flag passed to `cssMotion`, so a
 *  component is testable without the document attribute. */
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

  // Split on the join, not on every comma: a bezier carries four of its own.
  it('writes one transition per property asked for', () => {
    const value = cssMotion('panel.tape.fill', ['width', 'opacity']);
    expect(value.split(', ').filter((part) => /^(width|opacity) /.test(part))).toHaveLength(2);
  });

  /** The flip's leave is a declared share of its length, read only through `outSeconds`. */
  it('derives the flip\'s leave length from the registry\'s own declared share', () => {
    const share = MOTIONS['panel.dock.flip'].outShare;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
    expect(outSeconds('panel.dock.flip')).toBeCloseTo(seconds('panel.dock.flip') * (share ?? 1));
    // An id with no declared share runs its one length both ways.
    expect(outSeconds('panel.op.enter')).toBe(seconds('panel.op.enter'));
  });
});

/** Framer spaces keyframes evenly, which would put the flip's overshoot at the halfway mark; the
 *  registry declares where it sits, a curve per segment, and an accelerating curve for the leave. */
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
    expect(profile.ease).toHaveLength(2);
    expect(profile.ease![0]).toEqual(CURVES[flip.curve].ease);
    expect(profile.ease![1]).toEqual(CURVES[flip.landCurve!].ease);
  });

  it('gives the leave its own length and its own accelerating curve', () => {
    const out = outMotion('panel.dock.flip') as { duration?: number; ease?: unknown };
    expect(out.duration).toBeCloseTo(outSeconds('panel.dock.flip'));
    expect(out.ease).toEqual(CURVES[flip.outCurve!].ease);
    expect(out.ease).not.toEqual(CURVES[flip.curve].ease);
  });

  it('adds up the whole turn, which is how long a guard over the turning card must stand', () => {
    expect(turnSeconds('panel.dock.flip'))
      .toBeCloseTo(outSeconds('panel.dock.flip') + seconds('panel.dock.flip'));
  });

  it('leaves a motion that declares no overshoot exactly as it was', () => {
    expect(flipProfile('panel.op.enter')).toEqual(framerMotion('panel.op.enter'));
  });
});
