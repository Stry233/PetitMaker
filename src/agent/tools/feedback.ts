/**
 * What the model is told when a call is refused or reverted. Model-facing English: rule text is
 * rendered through `translateFor('en', ...)` with the rule's agent hint, so the model reasons over
 * stable feedback whatever language it converses in.
 */
import type { MacroCoord, ValidationError } from '../../core/model/types';
import { translateFor } from '../../i18n/context';
import type { Translate } from '../../i18n/keys';
import { violationToast } from '../../i18n/terms/rule-copy';
import { ruleHint } from './rule-hints';
import type { ToolResultDetail } from '../core/types';
import { normalizeGeometry, missingScalars } from './geometry';
import type { ToolOutcome } from './spec';

export const dedupe = (xs: string[]): string[] => [...new Set(xs)];

/* ── error formatting (the LLM feedback) ─────────────────────────────── */

/**
 * Every argument-shape refusal: it names the missing or invalid parameter and, where one helps,
 * shows a minimal valid call in the tool's own schema shape. `reason` ends in its own punctuation.
 */
export function argError(reason: string, example?: string): ToolOutcome {
  return { isError: true, content: `Arguments: ${reason}${example ? ` Example: ${example}` : ''}` };
}

/** The minimal valid flat call per shape family — what every geometry refusal shows. */
const RECT_EXAMPLE = 'shape: "rect", x1: 10, y1: 10, x2: 20, y2: 18';
const LINE_EXAMPLE = 'shape: "line", x1: 10, y1: 10, x2: 20, y2: 10';

/** The shared refusal for a shape-taking tool called with no geometry at all. `'area'` is the
 *  rect/circle/line/cells family (paint_terrain, erase_terrain, clear_area); `'path'` is the
 *  line/cells pair (build_road). */
function noCellsError(shapes: 'area' | 'path'): ToolOutcome {
  return shapes === 'path'
    ? argError('no cells given, pass shape "line" with flat endpoint coordinates, or cells.', LINE_EXAMPLE)
    : argError('no cells given, pass shape ("rect", "circle", or "line") with its flat coordinates, or cells.', RECT_EXAMPLE);
}

/**
 * The argument refusal for a shape-taking call that resolved to no cells: names exactly what the
 * given shape still lacks. The example uses the flat form, which every guided decoder can emit.
 */
export function geometryError(input: Record<string, unknown>, shapes: 'area' | 'path'): ToolOutcome {
  const shape = typeof input.shape === 'string' ? input.shape : undefined;
  if (shape === 'rect' || shape === 'line') {
    const missing = missingScalars(input, ['x1', 'y1', 'x2', 'y2']);
    if (missing.length > 0) {
      return argError(
        `shape "${shape}" needs the ${shape === 'rect' ? 'corner' : 'endpoint'} coordinates, missing ${missing.join(', ')}.`,
        shape === 'rect' ? RECT_EXAMPLE : LINE_EXAMPLE,
      );
    }
  } else if (shape === 'circle') {
    const missing = missingScalars(input, ['cx', 'cy', 'r']);
    if (missing.length > 0) {
      return argError(`shape "circle" needs the center and radius, missing ${missing.join(', ')}.`, 'shape: "circle", cx: 15, cy: 12, r: 5');
    }
  } else if (shape === 'cells') {
    if (!Array.isArray(input.cells) || input.cells.length === 0) {
      return argError('shape "cells" needs the cells array.', 'cells: [{"x":10,"y":10},{"x":11,"y":10}]');
    }
  } else if (shape !== undefined) {
    return argError(`unknown shape "${shape}", use rect, circle, line, or cells.`, RECT_EXAMPLE);
  }
  const norm = normalizeGeometry(input, shapes === 'path' ? 'line' : 'rect');
  if (norm.rect || norm.circle || norm.line || (Array.isArray(norm.cells) && norm.cells.length > 0)) {
    return argError('the given shape covers no cell on the map, use coordinates inside it.');
  }
  return noCellsError(shapes);
}

export function formatErrors(errors: ValidationError[]): string {
  // A bare translator: the model reads quantities as plain digits, whatever the locale would group.
  const inEnglish: Translate = (key, params) => translateFor('en', key, params);
  // One line per distinct refusal (rule and sentence), with the evidence merged across errors: a
  // region-sized stroke over a forbidden zone returns one error per cell.
  const groups = new Map<string, { e: ValidationError; rects: NonNullable<ValidationError['rects']>; cells: MacroCoord[] }>();
  for (const e of errors) {
    const text = violationToast(inEnglish, e);
    const key = `${e.ruleId}|${text}`;
    const g = groups.get(key) ?? { e, rects: [], cells: [] };
    if (e.rects) g.rects.push(...e.rects);
    g.cells.push(...e.cells);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ e, rects, cells }) => {
      const text = violationToast(inEnglish, e);
      // Rect evidence (an object's drawn body) is quoted whole: a 4-cell sample of a building's footprint
      // reads as a thin bar, and the model then probes "free" cells that are inside the same
      // blocker. Cell evidence keeps the sample but names how much of it is unshown.
      const at = rects.length > 0
        ? rects.slice(0, 4).map((r) => `footprint (${r.x},${r.y})-(${r.x + r.w},${r.y + r.h})`).join(' ')
          + (rects.length > 4 ? ` and ${rects.length - 4} more` : '')
        : cells.slice(0, 4).map((c) => `(${c.x},${c.y})`).join(' ')
          + (cells.length > 4 ? ` and ${cells.length - 4} more cells` : '');
      const advice = ruleHint(e.ruleId);
      const hint = advice ? ` Hint: ${advice}` : '';
      return `[${e.ruleId}] ${text}${at ? ` at ${at}` : ''}.${hint}`;
    })
    .join('\n');
}

// A batch rejects per command, so even grouped lines multiply by the command count. The model acts
// on the first few refusals; past that the list is weight, not information.
export function capLines(lines: string[], max = 12): string[] {
  return lines.length <= max
    ? lines
    : [...lines.slice(0, max), `…and ${lines.length - max} more rejections like these.`];
}

/** The opening words of each rollback and region refusal; the system prompt quotes them. */
export const BANNERS = {
  reverted: 'REVERTED:',
  partial: 'PARTIALLY REVERTED:',
  outOfRegion: 'OUT OF REGION:',
} as const;

/** The outcome of a post-stroke rollback: the retained state beside the rule text and correction hints. */
export function revertedOutcome(what: string, violations: ValidationError[], detail: ToolResultDetail | undefined): ToolOutcome {
  const content = detail?.partialRevert
    ? `${BANNERS.partial} ${what} violated post-stroke rules. Only the commands needed to restore a legal map were rolled back. `
      + `Retained changes: ${detail.cells ?? 0} cell(s), ${detail.objects ?? 0} object(s). Inspect the current map before retrying.\n${formatErrors(violations)}`
    : `${BANNERS.reverted} ${what} violated post-stroke rules and was rolled back. The map is unchanged.\n${formatErrors(violations)}`;
  return { isError: true, content, detail: { ...detail, reverted: true, banner: true } };
}

/** The outcome of a batch whose every command was refused before it applied. */
export function allRejectedOutcome(failures: string[], detail: ToolResultDetail | undefined): ToolOutcome {
  return {
    isError: true,
    detail: { ...detail, banner: true },
    content: `All commands rejected:\n${capLines(dedupe(failures)).join('\n')}`,
  };
}
