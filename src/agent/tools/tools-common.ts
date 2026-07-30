/**
 * Shared scaffolding for the agent tool surface: the dependency contract every
 * handler receives, the stroke runner that wraps each write tool in ONE silent
 * stroke group, and the input/shape resolvers. Kept in its own module so the
 * per-tool handler files (tools.ts, tools-search.ts, tools-terraform.ts,
 * tools-director.ts) share one source of truth without import cycles.
 *
 * Every WRITE tool call is exactly ONE stroke group:
 *   getUndoStackSize() → runSilently(execute each command) → commitStrokeGroup()
 * - runSilently suppresses `validation-failed` events, so the error Toast never
 *   fires for agent edits — rejections are fed back to the LLM instead.
 * - Pre-command rejections are reported per command (reject-and-skip); post-stroke
 *   violations mean the stroke already rolled back, reported as "REVERTED: …".
 * - Error strings are always English (translateFor('en', …)), augmented with the
 *   rule's agentHint (see rules/index.ts RULE_HINTS) for the violated rule.
 */
import {
  type CatalogItem,
  type Command,
  type GridState,
  type MacroCoord,
  type PlacementTrait,
  type ValidationError,
} from '../../core/model/types';
import type { CommandExecutor } from '../../core/commands/command-executor';
import { translateFor } from '../../i18n/context';
import { circleCells, lineCells } from '../../tools/paint/shapes';
import { regionTokens } from '../serialize';
import { RULE_HINTS } from '../../rules';
import type { PlanStage } from '../types';
import { ProvSource } from '../../core/provenance/types';

/** The user's single-block selection (mirrors state/store BlockRef). The editor's selection is a
 *  set; this surface has no vocabulary for a group, so a PLURAL selection arrives here as null. */
export type SelectedBlock = { kind: 'object'; id: string } | { kind: 'terrain'; x: number; y: number } | null;

export interface AgentToolDeps {
  getState(): GridState;
  getExecutor(): CommandExecutor;
  getRegion(): MacroCoord[];
  /** The clicked/selected block on canvas, if any. */
  getSelectedBlock?(): SelectedBlock;
  /** Visual acknowledgment hook — flashes the edited cells on the canvas
   *  (wired to the renderer's commit flash; absent in headless tests). */
  onFlash?(cells: MacroCoord[]): void;
  /** Rendered-map snapshotter; wire ONLY when the active model supports vision
   *  (supportsVision) — absence makes view_map degrade to the token grid. */
  snapshot?(): Promise<string | null>;
  /** Receives the agent's staged plan (rendered by the pinned header). */
  setPlan?(stages: PlanStage[]): void;
  /** The current plan — lets update_plan detect stage completions and inject
   *  a scorecard delta at exactly that decision point. */
  getPlan?(): PlanStage[];
  /** AI provenance descriptor (provider/model + per-edit approval). Absent in headless tests
   *  defaults to AI-write with no provider details. */
  getProvenanceSource?(): { provider?: string; model?: string; toolCallId?: string; userApproved?: boolean };
  /** Non-map UI action: open the share-image or JSON export flow for the user
   *  to complete (a file download is outward-facing, so the human confirms it).
   *  Browser-only; absent in headless/tests, where the tool reports so. */
  requestExport?(kind: 'image' | 'json'): void;
}

export type ToolResultBody = { content: string; isError: boolean; image?: { dataUrl: string } };

import { clamp } from '../../core/model/math';
export { clamp };
export const dedupe = (xs: string[]): string[] => [...new Set(xs)];

/* ── error formatting (the LLM feedback) ─────────────────────────────── */

export function formatErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => {
      const text = translateFor('en', e.message, e.messageParams);
      const at = e.cells.slice(0, 4).map((c) => `(${c.x},${c.y})`).join(' ');
      const hint = RULE_HINTS[e.ruleId] ? ` Hint: ${RULE_HINTS[e.ruleId]}` : '';
      return `[${e.ruleId}] ${text}${at ? ` at ${at}` : ''}.${hint}`;
    })
    .join('\n');
}

/* ── stroke runner: ONE stroke group per write tool call ─────────────── */

const SNAPSHOT_MAX = 24;

/** Token snapshot of the cells' bbox, appended to write results so the model
 *  sees the actual outcome without a follow-up inspect_region call. */
function bboxSnapshot(deps: AgentToolDeps, cells: MacroCoord[]): string {
  if (cells.length === 0) return '';
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const c of cells) {
    if (c.x < x1) x1 = c.x;
    if (c.x > x2) x2 = c.x;
    if (c.y < y1) y1 = c.y;
    if (c.y > y2) y2 = c.y;
  }
  // pad 1 so containment/support context around the edit is visible
  x1 -= 1; y1 -= 1; x2 += 1; y2 += 1;
  if (x2 - x1 + 1 > SNAPSHOT_MAX || y2 - y1 + 1 > SNAPSHOT_MAX) return '';
  return `\nResult (current state of the edited area):\n${regionTokens(deps.getState(), { x1, y1, x2, y2 })}`;
}

export function runStroke(
  deps: AgentToolDeps,
  commands: Command[],
  okMessage: (ok: number) => string,
  snapshotCells?: MacroCoord[],
  /** Runs inside the silent stroke after the commands (e.g. auto edge-cut) —
   *  its trims join the same stroke/undo step, like the build brushes (ATOMIC UNDO). */
  afterApply?: (exec: CommandExecutor) => void,
  /** Pure edge-cut strokes skip the reconcile pass (EDGE-CUTS SKIP RECONCILE:
   *  a silhouette-only cut can never invalidate any cut, exactly like the
   *  manual EdgeCutTool's commit). */
  opts: { reconcile?: boolean } = {},
): ToolResultBody {
  const exec = deps.getExecutor();
  const start = exec.getUndoStackSize();
  const src = deps.getProvenanceSource?.() ?? {};
  exec.pushSource({ source: src.userApproved ? ProvSource.AiAccepted : ProvSource.AiWrite, tool: 'agent', ai: src });
  let ok = 0; const failures: string[] = [];
  let violations: ReturnType<typeof exec.commitStrokeGroup>;
  try {
    exec.runSilently(() => {
      for (const cmd of commands) {
        const r = exec.execute(cmd);
        if (r.success) ok++;
        else failures.push(formatErrors(r.errors));
      }
      if (ok > 0) afterApply?.(exec);
    });
    violations = exec.commitStrokeGroup(start, opts);
  } catch (err) {
    // A crash mid-stroke must behave like REVERTED: already-executed commands would
    // otherwise stay applied with no post-stroke validation, while the model is told
    // "Tool crashed" — a half-edit it believes never happened.
    exec.rollbackTo(start);
    throw err;
  } finally {
    exec.popSource();
  }
  if (violations.length > 0) {
    return {
      isError: true,
      content: `REVERTED: the edit violated post-stroke rules and was rolled back. The map is unchanged.\n${formatErrors(violations)}`,
    };
  }
  if (ok === 0 && failures.length > 0) {
    return { isError: true, content: `All commands rejected:\n${dedupe(failures).join('\n')}` };
  }
  let msg = okMessage(ok);
  if (failures.length > 0) {
    msg += `\nPartially applied — ${failures.length} command(s) rejected:\n${dedupe(failures).join('\n')}`;
  }
  if (snapshotCells) {
    msg += bboxSnapshot(deps, snapshotCells);
    deps.onFlash?.(snapshotCells);
  }
  return { isError: failures.length > 0, content: msg };
}

/**
 * Callback variant of runStroke, for the write tools whose stroke body is a
 * per-cell loop or a populator call rather than a fixed Command[]. It reproduces
 * the same one-stroke-group dance runStroke does — capture the undo size, run the
 * body with validation-failed events silenced (async-safe: keeps silent across
 * awaits, mirroring run_generator's runSilentlyAsync path), then commitStrokeGroup
 * and detect a post-stroke revert — and hands back the body's own data (`result`)
 * plus the raw `violations` so each site formats its own REVERTED string (the eight
 * call sites word that message differently). Unlike runStroke it does NOT push a
 * provenance source: the hand-rolled sites never did, so this stays behaviour-identical.
 */
export async function runStrokeBody<T>(
  deps: AgentToolDeps,
  body: () => T | Promise<T>,
): Promise<{ reverted: boolean; violations: ValidationError[]; result: T }> {
  const exec = deps.getExecutor();
  const start = exec.getUndoStackSize();
  try {
    const result = await exec.runSilentlyAsync(async () => body());
    const violations = exec.commitStrokeGroup(start);
    return { reverted: violations.length > 0, violations, result };
  } catch (err) {
    // Same guarantee as runStroke: a crash never leaves half-applied, unvalidated edits.
    exec.rollbackTo(start);
    throw err;
  }
}

/** REVERTED feedback with the full rule text, coordinates and hints — the model can only
 *  self-correct from what it is told, so a bare rule id starves the retry. Shared by the
 *  director tools; runStroke words its own equivalent inline. */
export function revertedMsg(what: string, violations: ValidationError[]): string {
  return `REVERTED: ${what} violated post-stroke rules and was rolled back. The map is unchanged.\n${formatErrors(violations)}`;
}

/** A caller-supplied determinism seed, or the fallback when absent/malformed. */
export function parseSeed(input: Record<string, unknown>, fallback: number): number {
  return input.seed !== undefined && Number.isFinite(Number(input.seed)) ? Number(input.seed) : fallback;
}

/** The waterSpan (bridge) trait of a catalog item, if it has one. Shared by the
 *  bridge-site scanner and place_object's failure diagnostics. */
export type WaterSpanTrait = Extract<PlacementTrait, { type: 'waterSpan' }>;
export function waterSpanTrait(item: CatalogItem | undefined): WaterSpanTrait | undefined {
  return item?.traits.find((tr): tr is WaterSpanTrait => tr.type === 'waterSpan');
}

/* ── input helpers ───────────────────────────────────────────────────── */

/** Resolve a shape input (rect / circle / line / cells, optional outline) into a
 *  deduped, in-bounds cell list. */
export function resolveCells(input: Record<string, unknown>, state: GridState): MacroCoord[] {
  const outline = Boolean(input.outline);
  const { width, height } = state.template;
  let cells: MacroCoord[] = [];
  const rect = input.rect as { x1: number; y1: number; x2: number; y2: number } | undefined;
  const circle = input.circle as { cx: number; cy: number; r: number } | undefined;
  const line = input.line as { x1: number; y1: number; x2: number; y2: number; width?: number } | undefined;
  // Every shape's raw extent is CLAMPED to the map before enumerating cells.
  // Out-of-bounds cells are dropped by the final filter anyway, so clamping the
  // iteration window is output-preserving; without it a model that passes a
  // huge or off-map rect/circle/line (a common coordinate mistake) would make
  // this loop run for billions of iterations and freeze the tab. NaN inputs
  // collapse to an empty range here rather than looping forever.
  const cx0 = (v: number) => clamp(Number.isFinite(v) ? v : 0, 0, width - 1);
  const cy0 = (v: number) => clamp(Number.isFinite(v) ? v : 0, 0, height - 1);
  if (rect) {
    // real (unclamped) edges decide which cells are the outline border; the
    // loop only walks the in-bounds window
    const rxa = Math.min(rect.x1, rect.x2), rxb = Math.max(rect.x1, rect.x2);
    const rya = Math.min(rect.y1, rect.y2), ryb = Math.max(rect.y1, rect.y2);
    if (Number.isFinite(rxa) && Number.isFinite(rya)) {
      for (let y = cy0(rya); y <= cy0(ryb); y++) {
        for (let x = cx0(rxa); x <= cx0(rxb); x++) {
          if (!outline || x === rxa || x === rxb || y === rya || y === ryb) cells.push({ x, y });
        }
      }
    }
  } else if (circle) {
    // a radius larger than the map already covers every in-bounds cell, so cap
    // it at the map diagonal — same output, bounded work
    const r = clamp(Number.isFinite(circle.r) ? circle.r : 0, 0, width + height);
    const c = { x: cx0(circle.cx), y: cy0(circle.cy) };
    cells = circleCells(c, r, r);
    if (outline && r > 1) {
      const inner = new Set(circleCells(c, r - 1, r - 1).map((cc) => `${cc.x},${cc.y}`));
      cells = cells.filter((cc) => !inner.has(`${cc.x},${cc.y}`));
    }
  } else if (line) {
    // a line walks from end to end; an endpoint far off-map would enumerate a
    // huge span before the filter trims it. Reject the pathological case (the
    // in-bounds segment of a wildly off-map line is ambiguous anyway) and cap
    // width to a sane brush size.
    const span = Math.max(Math.abs(line.x2 - line.x1), Math.abs(line.y2 - line.y1));
    if (!Number.isFinite(span) || span > (width + height) * 2) return [];
    const w = clamp(Math.max(1, Number(line.width) || 1), 1, Math.max(width, height));
    cells = lineCells({ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }, w);
  } else {
    cells = (input.cells as MacroCoord[] | undefined) ?? [];
  }
  const seen = new Set<string>();
  return cells.filter((c) => {
    if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) return false;
    const k = `${c.x},${c.y}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
