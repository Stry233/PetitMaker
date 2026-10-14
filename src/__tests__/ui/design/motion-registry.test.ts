import ts from 'typescript';
/**
 * The motion registry's own contract.
 *
 * The tier a motion belongs to decides what it must declare, and the type system carries most of
 * that. What a type cannot carry is that the declared value is meaningful: a `says` of '' compiles,
 * and an amplitude below the floor compiles. Those are what these assert.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isTween } from '../../../ui/design/motion/curves';
import { CURVES, MOTIONS, type Motion } from '../../../ui/design/motion/registry';
import { parseSource, repoFiles } from '../../_support/source-graph';

function sources(dir: string): { path: string; text: string }[] {
  return repoFiles(dir).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
}

/** The table is `as const satisfies`, so each entry's inferred type is its own literal shape and an
 *  optional field it happens not to set is absent from it. These assertions are about the contract,
 *  which is what a new entry will be written against. */
const entries = Object.entries(MOTIONS) as [string, Motion][];

/** Below this a displacement reads as jitter rather than as motion. */
const AMPLITUDE_FLOOR_PX = 4;
/** The same floor for a motion that scales rather than moves. */
const AMPLITUDE_FLOOR_SCALE = 0.03;
/** Minimum opacity range for a visible ambient fade. */
const AMPLITUDE_FLOOR_OPACITY = 0.2;

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
   * `linear` is the one curve that declines to have a shape, so a motion may only name it where the
   * shape is not the registry's to choose (`curves.ts` states the two cases). Those two are
   * distinguishable here: a seamless loop has to travel at a constant rate, and a sampled track
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
 * A setting sample is the one motion allowed past the reduced-motion gate: Framer's nearest
 * `MotionConfig` wins, so a nested `reducedMotion` override lifts the gate for its subtree. Only the
 * editor root both editions mount and `MotionSample` may set one, and `MotionSample` plays only
 * sample entries.
 */
describe('setting samples and the reduced-motion gate', () => {
  const GATE_OWNERS = ['src/ui/app/EditorRoot.tsx', 'src/ui/design/motion/MotionSample.tsx'];
  const sampleIds = new Set(entries.filter(([, m]) => m.tier === 'sample').map(([id]) => id));
  const tsx = sources('src').filter(({ path }) => !path.startsWith('src/__tests__/'));

  it('declares what each sample previews', () => {
    expect(sampleIds.size).toBeGreaterThan(0);
    for (const [id, m] of entries) {
      if (m.tier === 'sample') expect(m.previews.trim().length, `${id} previews nothing`).toBeGreaterThan(0);
    }
  });

  it('lets only the root config and MotionSample set reducedMotion', () => {
    const setters = tsx.filter(({ text }) => /<MotionConfig\b[^>]*\breducedMotion=/.test(text)).map(({ path }) => path).sort();
    expect(setters).toEqual([...GATE_OWNERS].sort());
  });

  it('opts out of the gate only for registry-declared samples', () => {
    const played: string[] = [];
    const failures: string[] = [];
    for (const { path, text } of tsx) {
      const file = parseSource(path, text);
      const visit = (node: ts.Node) => {
        if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(file) === 'MotionSample') {
          const id = node.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText(file) === 'id');
          const literal = id && ts.isJsxAttribute(id) && id.initializer && ts.isStringLiteral(id.initializer) ? id.initializer.text : null;
          if (literal === null || !sampleIds.has(literal)) failures.push(`${path}: ${node.getText(file)}`);
          else played.push(literal);
        }
        // A sample id anywhere else would play it through a gated path, or a gated motion as a sample.
        if (ts.isStringLiteralLike(node) && sampleIds.has(node.text) && !path.includes('/design/motion/')
          && !(ts.isJsxAttribute(node.parent) && (node.parent.parent.parent as ts.JsxOpeningLikeElement).tagName.getText(file) === 'MotionSample')) {
          failures.push(`${path}: ${node.getText(file)} outside MotionSample`);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(failures).toEqual([]);
    expect(new Set(played)).toEqual(sampleIds);
  });
});

/** Drawing-specific choreography owns its timings; shared controls use named declarations. */
describe('motion call sites', () => {
  const tables = [
    '/ui/design/styles.ts', '/ui/design/motion/',
    '/ui/agent/character/poses.ts', '/ui/agent/sketchbook/sketch-motion.ts',
    '/ui/chrome/modals/keyboard/motion.ts',
    // The Help figures' drawn timelines: the demo player's pointer and the caption's press pulse.
    '/ui/help/figures/HelpDemo.tsx', '/ui/help/figures/caption.tsx',
  ];

  it('uses declared timings and interaction profiles across every UI owner', () => {
    const failures: string[] = [];
    for (const { path, text } of sources('src/ui')) {
      if (tables.some((table) => `/${path}`.includes(table))) continue;
      const file = parseSource(path, text);
      const fail = (node: ts.Node) => failures.push(`${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1} ${node.getText(file)}`);
      const visit = (node: ts.Node) => {
        if (ts.isPropertyAssignment(node) && /^(duration|stiffness|damping|mass)$/.test(node.name.getText(file))
          && ts.isNumericLiteral(node.initializer) && Number(node.initializer.text) !== 0) fail(node);
        if (ts.isStringLiteralLike(node) && /(?:[a-z-]+)\s+[.\d]+m?s\s+(?:ease|linear|cubic-bezier)/.test(node.text)) fail(node);
        if (ts.isJsxAttribute(node) && /^(whileHover|whileTap)$/.test(node.name.getText(file)) && node.initializer) {
          const scan = (part: ts.Node) => {
            if (ts.isPropertyAssignment(part) && /^(scale|x|y|rotate|opacity)$/.test(part.name.getText(file))
              && (ts.isNumericLiteral(part.initializer) || ts.isPrefixUnaryExpression(part.initializer))) fail(part);
            ts.forEachChild(part, scan);
          };
          scan(node.initializer);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(failures).toEqual([]);
  });
});

/**
 * Every declared motion is played somewhere: production code names its id as a string, or builds it
 * from a template whose static head ends at a dot and starts it (a family such as `tour.${step}`).
 */
describe('the registry declares only motions that play', () => {
  const named = new Set<string>();
  const families: string[] = [];
  for (const { path, text } of sources('src')) {
    if (path.startsWith('src/__tests__/') || path === 'src/ui/design/motion/registry.ts') continue;
    const file = parseSource(path, text);
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteralLike(node)) named.add(node.text);
      if (ts.isTemplateExpression(node) && node.head.text.endsWith('.')) families.push(node.head.text);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  const unplayed = Object.keys(MOTIONS).filter((id) => !named.has(id) && !families.some((head) => id.startsWith(head))).sort();

  it('names every motion id in production code', () => {
    expect(unplayed, 'play the motion or delete its entry').toEqual([]);
  });
});
