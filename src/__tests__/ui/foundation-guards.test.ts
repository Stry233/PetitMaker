import ts from 'typescript';
/**
 * Literals and private mechanisms that belong to the foundations. A z-index of 0 or 1 orders two
 * parts of one control inside its own stacking context and is not a ladder rung.
 *
 * Colours (hex and `rgb()`/`rgba()`/`hsl()`/`hsla()` alike), stacking rungs, corner radii and spacing
 * are tokens in `ui/design`, and the only shadows drawn are those `styles.ts:shadows` declares (a ring
 * with no offset or blur, up to 3 px wide, is an edge, not a shadow); a size observer is a primitive
 * (`primitives/use-observed-size.ts`); a press outside or Escape dismisses through
 * `primitives/surface-scope.tsx`; motion timing comes from `design/motion`; a gap, padding or margin
 * sits on the spacing scale (`styles.ts:SPACE`).
 *
 * A drawing zone (`DRAWING_ZONES`) holds illustrations drawn to their own scale: its shadows,
 * stacking, corners, observers, motion and spacing are the drawing's, while its colours still come
 * from the tokens or `design/drawing-palette.ts`. `ui-guard-allowlist.ts:GUARD_EXEMPT` names the files
 * a guard does not read for what they are, each with its reason. A file that still writes a literal or
 * mechanism outside those is listed in `GUARD_ALLOWLIST` with its count, and the entry shrinks as the surface
 * adopts the foundations. A count above its entry fails, and so does one below it, so the list stays
 * exact.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GUARD_ALLOWLIST, GUARD_EXEMPT, type GuardId } from './ui-guard-allowlist';
import { SPACE } from '../../ui/design/styles';
import { parseSource, repoFiles } from '../_support/source-graph';

function sources(dir: string): { path: string; text: string }[] {
  return repoFiles(dir).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
}

const DESIGN = 'src/ui/design/';

/** Folders of drawn art: Help's figures, the sketchbook's pencil and the tour's gesture diagrams. */
const DRAWING_ZONES = ['src/ui/help/figures/', 'src/ui/agent/sketchbook/', 'src/ui/shell/tour/diagrams/'] as const;
/** What a drawing draws for itself; the colour guards apply in a drawing zone too. */
const DRAWN: ReadonlySet<GuardId> = new Set(['shadow', 'zIndex', 'radius', 'resizeObserver', 'motion', 'spacing']);

const UI = sources('src/ui').map(({ path, text }) => ({ path, text, file: parseSource(path, text) }));

const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/;
const COLOR_FUNCTION = /\b(?:rgba?|hsla?)\(/;
const SHADOW_PROP = new Set(['boxShadow', 'textShadow']);
const SHADOW_CSS = /(?:box|text)-shadow\s*:\s*([^;}]+)/g;
const RING_MAX = 3;
const LENGTH = /\b\d+(?:\.\d+)?px\b/;
const RAW_MOTION = new Set(['springs', 'snapTween', 'scaleRest']);
const DISMISS_EVENTS = new Set(['pointerdown', 'mousedown', 'click', 'touchstart', 'keydown']);
const ON_SCALE = new Set<number>(SPACE);
const SPACING_PROP = /^(gap|rowGap|columnGap|padding|margin)(Top|Bottom|Left|Right|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd)?$/;
const TRANSITION_TEXT = /(?:[a-z-]+)\s+[.\d]+m?s\s+(?:ease|linear|cubic-bezier)/;

const propName = (node: ts.PropertyAssignment, file: ts.SourceFile) => node.name.getText(file).replace(/['"]/g, '');

/** Whether a CSS shadow value casts a shadow: some layer has an offset or a blur, or spreads past
 *  a ring. `none` and the rings that draw an edge do not. An interpolated colour reads as a word. */
function castsShadow(value: string): boolean {
  if (/drop-shadow\(/.test(value)) return true;
  const layers = value.replace(/\w+\([^()]*\)/g, 'c').split(',');
  return layers.some((layer) => {
    const lengths = layer.trim().split(/\s+/).filter((t) => /^-?\d*\.?\d+(?:px|r?em)?$/.test(t)).map((t) => Math.abs(parseFloat(t)));
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    return x !== 0 || y !== 0 || blur !== 0 || spread > RING_MAX;
  });
}

/** The static text of a string or template, with each interpolation read as one word. */
const staticText = (node: ts.Node): string | null =>
  ts.isStringLiteralLike(node) ? node.text
    : ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' x ')
      : null;
const isNumber = (node: ts.Expression) => ts.isNumericLiteral(node) || (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand));

/** Every site each guard finds, per file. */
function scan(): Record<GuardId, Map<string, number>> {
  const found: Record<GuardId, Map<string, number>> = {
    hex: new Map(), colorFunction: new Map(), shadow: new Map(), zIndex: new Map(), radius: new Map(),
    resizeObserver: new Map(), dismissal: new Map(), motion: new Map(), spacing: new Map(),
  };
  for (const { path, file } of UI) {
    const inDesign = path.startsWith(DESIGN);
    const inDrawing = DRAWING_ZONES.some((zone) => path.startsWith(zone));
    const hit = (guard: GuardId, at: string) => {
      if ((inDrawing && DRAWN.has(guard)) || GUARD_EXEMPT[guard]?.[at] !== undefined || (guard === 'spacing' && inDesign)) return;
      found[guard].set(at, (found[guard].get(at) ?? 0) + 1);
    };
    const inMotion = path.startsWith(`${DESIGN}motion/`) || path === `${DESIGN}styles.ts`;
    const visit = (node: ts.Node) => {
      if (!inDesign && (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
        && HEX.test(node.text)) hit('hex', path);
      if (!inDesign && (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
        && COLOR_FUNCTION.test(node.text)) hit('colorFunction', path);
      if (!inDesign && ts.isPropertyAssignment(node) && SHADOW_PROP.has(propName(node, file))) {
        const inner = (n: ts.Node): void => {
          const text = staticText(n);
          if (text !== null) { if (castsShadow(text)) hit('shadow', path); return; }
          if (!ts.isCallExpression(n)) ts.forEachChild(n, inner);
        };
        inner(node.initializer);
      }
      if (!inDesign && ts.isPropertyAssignment(node) && propName(node, file) === 'filter') {
        const text = staticText(node.initializer);
        if (text !== null && /drop-shadow\(/.test(text)) hit('shadow', path);
      }
      if (!inDesign && (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || ts.isStringLiteral(node))) {
        const text = staticText(node);
        for (const m of text?.matchAll(SHADOW_CSS) ?? []) if (castsShadow(m[1]!)) hit('shadow', path);
      }
      if (!inDesign && ts.isPropertyAssignment(node)) {
        const name = propName(node, file);
        if (name === 'zIndex' && isNumber(node.initializer) && Math.abs(Number(node.initializer.getText(file))) > 1) hit('zIndex', path);
        if (/^border(?:Top|Bottom)?(?:Left|Right)?Radius$|^borderRadius$/.test(name)
          && (isNumber(node.initializer) && Number(node.initializer.getText(file)) !== 0
            || ts.isStringLiteralLike(node.initializer) && LENGTH.test(node.initializer.text))) hit('radius', path);
      }
      if (ts.isPropertyAssignment(node) && SPACING_PROP.test(propName(node, file))) {
        const v = node.initializer;
        if (isNumber(v) && !ON_SCALE.has(Math.abs(Number(v.getText(file))))) hit('spacing', path);
        if (ts.isStringLiteralLike(v)) for (const m of v.text.matchAll(/(-?\d+(?:\.\d+)?)px/g)) if (!ON_SCALE.has(Math.abs(Number(m[1])))) hit('spacing', path);
      }
      if (!path.startsWith('src/ui/primitives/') && ts.isNewExpression(node) && node.expression.getText(file) === 'ResizeObserver') hit('resizeObserver', path);
      if (path !== 'src/ui/primitives/surface-scope.tsx' && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'addEventListener' && /^(document|window)$/.test(node.expression.expression.getText(file))
        && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && DISMISS_EVENTS.has(node.arguments[0].text)) hit('dismissal', path);
      if (!inMotion) {
        if (ts.isIdentifier(node) && RAW_MOTION.has(node.text) && !ts.isImportSpecifier(node.parent)
          && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) hit('motion', path);
        if ((ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
          && TRANSITION_TEXT.test(node.text)) hit('motion', path);
        if (ts.isPropertyAssignment(node) && propName(node, file) === 'delay' && isNumber(node.initializer)
          && Number(node.initializer.getText(file)) !== 0) hit('motion', path);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return found;
}

const GUARDS: readonly GuardId[] = ['hex', 'colorFunction', 'shadow', 'zIndex', 'radius', 'resizeObserver', 'dismissal', 'motion', 'spacing'];
const found = scan();

describe('foundation guards', () => {
  it.each(GUARDS)('finds no %s literal or mechanism outside its home beyond the allowlist', (guard) => {
    const allowed = GUARD_ALLOWLIST[guard] ?? {};
    const over = [...found[guard]].filter(([path, n]) => n > (allowed[path]?.count ?? 0)).map(([path, n]) => `${path}: ${n} > ${allowed[path]?.count ?? 0}`);
    expect(over).toEqual([]);
  });

  it.each(GUARDS)('keeps the %s allowlist exact, so a fixed site comes off it', (guard) => {
    const allowed = GUARD_ALLOWLIST[guard] ?? {};
    const stale = Object.entries(allowed).filter(([path, { count }]) => (found[guard].get(path) ?? 0) !== count)
      .map(([path, { count }]) => `${path}: listed ${count}, found ${found[guard].get(path) ?? 0}`);
    expect(stale).toEqual([]);
  });

  it('names only folders and files that exist in its drawing zones and exemptions', () => {
    const paths = UI.map(({ path }) => path);
    expect(DRAWING_ZONES.filter((zone) => !paths.some((path) => path.startsWith(zone)))).toEqual([]);
    expect(Object.values(GUARD_EXEMPT).flatMap((files) => Object.keys(files ?? {})).filter((path) => !paths.includes(path))).toEqual([]);
  });

  it('reads a cast shadow, and leaves none and an edge ring alone', () => {
    expect(castsShadow('0 2px 4px rgba(0, 0, 0, 0.2)')).toBe(true);
    expect(castsShadow('0 0 0 4000px rgba(0, 0, 0, 0.4)')).toBe(true);
    expect(castsShadow('inset 0 0 0 1.5px x')).toBe(false);
    expect(castsShadow('0 0 0 1px x, 0 0 0 2px x')).toBe(false);
    expect(castsShadow('none')).toBe(false);
  });
});
