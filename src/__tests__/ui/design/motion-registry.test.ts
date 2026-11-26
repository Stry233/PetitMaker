import ts from 'typescript';
/**
 * The motion registry's contract beyond its types: a declared value is meaningful (a `says` of '' and
 * an amplitude below the floor both compile).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isTween } from '../../../ui/design/motion/curves';
import { DURATIONS, STAGGERS } from '../../../ui/design/motion/durations';
import { CURVES, MOTIONS, type Motion, type MotionId } from '../../../ui/design/motion/registry';
import { motionVar } from '../../../ui/design/motion/css-vars';
import { parseSource, repoFiles } from '../../_support/source-graph';

function sources(dir: string): { path: string; text: string }[] {
  return repoFiles(dir).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
}

/** Widened to `Motion`: the `as const satisfies` table infers each entry's literal shape, which omits
 *  optional fields it does not set. */
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

  /** The dock's state flip is its own motion, distinct from `panel.dock.paper`'s in-place crossfade. */
  it('declares the dock flip as an informing motion', () => {
    expect(MOTIONS['panel.dock.flip'].tier).toBe('inform');
  });

  /** A follow closes on a target that can move every frame, so a curve would never be read. */
  it('gives every motion a curve from the closed set, and a follow none', () => {
    for (const [id, m] of entries) {
      if (m.follow !== undefined) expect(m.curve, `${id} is a follow declaring a curve`).toBeUndefined();
      else expect(m.curve && CURVES[m.curve], `${id} names an unknown curve`).toBeDefined();
    }
  });

  it('makes every informing motion say what it says', () => {
    for (const [id, m] of entries) {
      if (m.tier !== 'inform') continue;
      expect(m.says.trim().length, `${id} declares no fact`).toBeGreaterThan(0);
    }
  });

  it('keeps every decorative motion above the amplitude it stops reading at', () => {
    for (const [id, m] of entries) {
      if (m.tier !== 'ambient') continue;
      const floor = m.amplitudeUnit === 'scale' ? AMPLITUDE_FLOOR_SCALE
        : m.amplitudeUnit === 'opacity' ? AMPLITUDE_FLOOR_OPACITY
          : AMPLITUDE_FLOOR_PX;
      expect(m.amplitude, `${id} is below the floor it would read at`).toBeGreaterThanOrEqual(floor);
    }
  });

  /** A seamless loop travels at a constant rate, and a sampled track carries its shape in frames (so
   *  declares no amplitude); `curves.ts` names these as the two uses of `linear`. */
  it('lets only a loop or a sampled track decline to have a shape', () => {
    for (const [id, m] of entries) {
      if (m.curve !== 'linear') continue;
      const sampled = m.amplitude === undefined;
      expect(m.loop === true || sampled, `${id} is linear but neither a loop nor a sampled track`).toBe(true);
    }
  });

  /** `accel` is still gaining speed when it ends, so it can only hand over to a second half; `settle`
   *  only follows an overshoot keyframe, which is where its gentle approach belongs. */
  it('keeps the segment curves to their segments', () => {
    for (const [id, m] of entries) {
      expect(m.curve, `${id} moves on accel, which never arrives`).not.toBe('accel');
      expect(m.curve, `${id} moves on settle, which only lands an overshoot`).not.toBe('settle');
      if (m.landCurve !== undefined) expect(m.overshootAt, `${id} lands with no overshoot to land from`).toBeDefined();
      if (m.outCurve === 'accel') expect(m.outShare, `${id} departs on accel with no arrival after it`).toBeDefined();
    }
  });

  /** A bezier has no length of its own, and a spring carries its timing in its physics. */
  it('gives a duration to every tween and to no spring', () => {
    for (const [id, m] of entries) {
      if (m.curve === undefined) continue;
      if (isTween(m.curve)) expect(m.duration, `${id} is a tween with no length`).toBeGreaterThan(0);
      else expect(m.duration, `${id} is a spring carrying a duration`).toBeUndefined();
    }
  });

  /** One job takes one length wherever it plays; a loop's cycle, a sampled track or a long wait says
   *  in its own entry why its length is its own. */
  it('times every tween on the duration scale or says why not', () => {
    const tiers = new Set<number>(Object.values(DURATIONS));
    for (const [id, m] of entries) {
      if (m.duration === undefined) continue;
      if (m.lengthFrom !== undefined) {
        expect(m.lengthFrom.trim().length, `${id} keeps its own length without a reason`).toBeGreaterThan(0);
        expect(tiers.has(m.duration), `${id} is on the scale and needs no lengthFrom`).toBe(false);
      } else {
        expect(tiers.has(m.duration), `${id} lasts ${m.duration}s, which is no tier`).toBe(true);
      }
    }
  });

  it('staggers a group by a set interval, and a loop by a phase of its own cycle', () => {
    const staggers = new Set<number>(Object.values(STAGGERS));
    for (const [id, m] of entries) {
      if (m.stagger === undefined || m.loop) continue;
      expect(staggers.has(m.stagger), `${id} staggers by ${m.stagger}s, which is not in STAGGERS`).toBe(true);
    }
  });
});

/**
 * A setting sample is the one motion allowed past the reduced-motion gate. Framer's nearest
 * `MotionConfig` wins, so only the editor root may set `reducedMotion`; `MotionSample` plays its
 * loops as Web Animations, which no gate reaches, and plays only sample entries.
 */
describe('setting samples and the reduced-motion gate', () => {
  const GATE_OWNERS = ['src/ui/app/EditorRoot.tsx'];
  const sampleIds = new Set(entries.filter(([, m]) => m.tier === 'sample').map(([id]) => id));
  const tsx = sources('src').filter(({ path }) => !path.startsWith('src/__tests__/'));

  it('declares what each sample previews', () => {
    expect(sampleIds.size).toBeGreaterThan(0);
    for (const [id, m] of entries) {
      if (m.tier === 'sample') expect(m.previews.trim().length, `${id} previews nothing`).toBeGreaterThan(0);
    }
  });

  it('lets only the root config set reducedMotion', () => {
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

/**
 * Motion timing is declared in its homes and named everywhere else: the DOM registry and its curve set
 * and scale (`ui/design/motion/`) and the canvas registry (`view/shared/motion/anim-config.ts`). A
 * scripted timeline (a pose, an idle dressing, a Help demo) times its beats against each other and says
 * so by passing through `design/motion/timeline.ts:timeline`, whose lengths are data; its curves still
 * come from the set.
 */
describe('motion call sites', () => {
  const HOMES = ['src/ui/design/motion/', 'src/view/shared/motion/anim-config.ts'];
  const home = (path: string) => HOMES.some((h) => path.startsWith(h));
  const TIMING_KEY = /^(duration|delay|delayChildren|staggerChildren|stagger|bounce|stiffness|damping|mass|repeatDelay|visualDuration)$/;
  const EASING_KEY = /^(ease|easing|transitionTimingFunction|animationTimingFunction)$/;
  const PRESS_KEY = /^(scale|x|y|rotate|opacity)$/;
  /** A length and curve written into a transition or animation string. */
  const CSS_TIMING = /\d*\.?\d+m?s\s+(?:ease|linear|cubic-bezier|steps)|(?:^|[\s,])(?:ease(?:-in|-out|-in-out)?|linear)\s+\d*\.?\d+m?s/;
  /** A template that writes a length into a transition: `${…}ms` or `${…}s` followed by a curve slot or keyword. */
  const TEMPLATE_TIMING = /\$\{[^}]*\}m?s(?:\s|$|,)/;

  /** Whether `expr` is fixed by the file itself: a literal, arithmetic over literals, or a name bound
   *  in this file to one, rather than a value read from a registry or from data. */
  function literalTiming(expr: ts.Expression, consts: ReadonlyMap<string, ts.Expression>, seen = new Set<string>()): boolean {
    if (ts.isNumericLiteral(expr)) return Number(expr.text) !== 0;
    if (ts.isParenthesizedExpression(expr)) return literalTiming(expr.expression, consts, seen);
    if (ts.isPrefixUnaryExpression(expr)) return literalTiming(expr.operand, consts, seen);
    if (ts.isBinaryExpression(expr)) {
      const parts = [expr.left, expr.right];
      return parts.some((p) => literalTiming(p, consts, seen)) && parts.every((p) => ts.isNumericLiteral(p) || literalTiming(p, consts, seen));
    }
    if (ts.isIdentifier(expr) && consts.has(expr.text) && !seen.has(expr.text)) {
      seen.add(expr.text);
      return literalTiming(consts.get(expr.text)!, consts, seen);
    }
    return false;
  }

  function scan(path: string, text: string): string[] {
    const file = parseSource(path, text);
    const found: string[] = [];
    const at = (node: ts.Node) => `${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1} ${node.getText(file).slice(0, 120)}`;
    const consts = new Map<string, ts.Expression>();
    const collect = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
        && (node.parent.flags & ts.NodeFlags.Const)) consts.set(node.name.text, node.initializer);
      ts.forEachChild(node, collect);
    };
    collect(file);
    const visit = (node: ts.Node, scripted: boolean) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'timeline') scripted = true;
      if (ts.isPropertyAssignment(node) && !ts.isComputedPropertyName(node.name)) {
        const key = node.name.getText(file).replace(/['"]/g, '');
        const owner = node.parent;
        const timed = ts.isObjectLiteralExpression(owner) && owner.properties.some((p) => ts.isPropertyAssignment(p) && EASING_KEY.test(p.name.getText(file)));
        if (!scripted && (TIMING_KEY.test(key) || (key === 'dur' && timed)) && literalTiming(node.initializer, consts)) found.push(at(node));
        const bare = ts.isStringLiteralLike(node.initializer) || ts.isArrayLiteralExpression(node.initializer);
        if (!scripted && EASING_KEY.test(key) && bare) found.push(at(node));
      }
      if (ts.isStringLiteralLike(node) && (node.text.includes('cubic-bezier(') || CSS_TIMING.test(node.text))) found.push(at(node));
      if (ts.isTemplateExpression(node)) {
        const whole = node.getText(file);
        if (whole.includes('cubic-bezier(') || CSS_TIMING.test(whole) || TEMPLATE_TIMING.test(whole)) found.push(at(node));
      }
      if (ts.isJsxAttribute(node) && /^(whileHover|whileTap)$/.test(node.name.getText(file)) && node.initializer) {
        const press = (part: ts.Node) => {
          if (ts.isPropertyAssignment(part) && PRESS_KEY.test(part.name.getText(file))
            && (ts.isNumericLiteral(part.initializer) || ts.isPrefixUnaryExpression(part.initializer))) found.push(at(part));
          ts.forEachChild(part, press);
        };
        press(node.initializer);
      }
      ts.forEachChild(node, (child) => visit(child, scripted));
    };
    visit(file, false);
    return found;
  }

  /** Text every file `scan` could flag contains: a timing, easing or press key, a curve or length in a
   *  string or template. Parsing only these keeps the scan within the fast tier. */
  const MAY_TIME = /\b(?:duration|delay|delayChildren|staggerChildren|stagger|bounce|stiffness|damping|mass|repeatDelay|visualDuration|ease|easing|transitionTimingFunction|animationTimingFunction|dur|whileHover|whileTap)['"]?\s*[:=]|cubic-bezier\(|\d\s*m?s\s+(?:ease|linear|cubic-bezier|steps)|(?:ease(?:-in|-out|-in-out)?|linear)\s+\d|\}m?s(?:\s|$|,|`)/m;

  it('names a registry motion or a curve wherever motion is timed, in every layer', () => {
    const failures = sources('src').filter(({ path }) => !path.startsWith('src/__tests__/') && !home(path))
      .filter(({ text }) => MAY_TIME.test(text))
      .flatMap(({ path, text }) => scan(path, text));
    expect(failures).toEqual([]);
  });

  /** A stylesheet's animation reads its length and curve from the custom properties the registry
   *  writes on the root (`design/motion/css-vars.ts`). Under a millisecond is the reduced-motion gate's
   *  "no time at all", not a length. */
  it('times every stylesheet animation and transition through the registry\'s properties', () => {
    const failures: string[] = [];
    for (const path of repoFiles('src', { accept: /\.css$/ })) {
      readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
        const values = [...line.matchAll(/(?:^|[{;\s])(?:animation|transition)(?:-duration|-delay|-timing-function)?\s*:([^;}]*)/g)].map((m) => m[1]!);
        const lengths = values.flatMap((v) => [...v.matchAll(/(\d*\.?\d+)(m?s)\b/g)]).map((m) => Number(m[1]) / (m[2] === 'ms' ? 1000 : 1));
        if (line.includes('cubic-bezier(') || lengths.some((t) => t >= 0.001)
          || values.some((v) => /\b(ease(-in|-out|-in-out)?|linear|steps\()/.test(v))) failures.push(`${path}:${i + 1} ${line.trim()}`);
      });
    }
    expect(failures).toEqual([]);
  });
});

/**
 * Every declared motion is played somewhere: production code names its id as a string, or builds it
 * from a template whose static head ends at a dot and starts it (a family such as `tour.${step}`), or
 * a stylesheet reads its custom property (`design/motion/css-vars.ts`).
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
  const sheets = repoFiles('src', { accept: /\.css$/ }).map((path) => readFileSync(path, 'utf8')).join('\n');
  const unplayed = (Object.keys(MOTIONS) as MotionId[])
    .filter((id) => !named.has(id) && !families.some((head) => id.startsWith(head)) && !sheets.includes(`var(${motionVar(id)}`)).sort();

  it('names every motion id in production code', () => {
    expect(unplayed, 'play the motion or delete its entry').toEqual([]);
  });
});
