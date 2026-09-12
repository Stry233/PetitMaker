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
 * - Pre-command rejections are reported per command (reject-and-skip, the same
 *   semantics generation runs under); post-stroke violations roll commands back until legal,
 *   with retained changes reported so the model can re-plan from the current map.
 * - One stroke group is one undo step, so a user undoes agent work like their own.
 * - Error strings are always English (translateFor('en', …)), augmented with the
 *   rule's agentHint (see rules/index.ts RULE_HINTS) for the violated rule: the model
 *   converses in any language but reasons over stable rule feedback.
 */
import {
  CellZone,
  CommandType,
  type CatalogItem,
  type Command,
  type GridState,
  type MacroCoord,
  type PlacementTrait,
  type ValidationError,
} from '../../core/model/types';
import type { CommandExecutor } from '../../core/commands/command-executor';
import { translateFor } from '../../i18n/context';
import { footprintCells, getPlacedObjectSize } from '../../state/object-geometry';
import { entriesNear, getObjectIndex } from '../../state/object-index';
import { regionBounds } from '../../state/region-bounds';
import { circleCells, lineCells } from '../../tools/paint';
import { rectsOverlap } from '../../core/model/grid-model';
import { normalizeGeometry, missingScalars, type FlatDefault } from './geometry';
import { regionTokens } from '../serialize';
import { RULE_HINTS } from '../../rules';
import { ProvSource } from '../../core/provenance/types';
import type { ToolResultDetail } from '../core/types';

/** The user's single-block selection (mirrors state/store BlockRef). The editor's selection is a
 *  set; this surface has no vocabulary for a group, so a PLURAL selection arrives here as null. */
export type SelectedBlock = { kind: 'object'; id: string } | { kind: 'terrain'; x: number; y: number } | null;

export interface AgentToolDeps {
  getState(): GridState;
  getExecutor(): CommandExecutor;
  getRegion(): MacroCoord[];
  /** The clicked/selected block on canvas, if any. */
  getSelectedBlock?(): SelectedBlock;
  /** Undo-stack size recorded when the running job's first write committed. `undo` stops there, so
   *  the assistant cannot reverse edits the user made before the job started. Absent means 0. */
  undoFloor?(): number;
  /** Visual acknowledgment hook — flashes the edited cells on the canvas
   *  (wired to the renderer's commit flash; absent in headless tests). */
  onFlash?(cells: MacroCoord[]): void;
  /** Rendered-map snapshotter; wire ONLY when the active model supports vision
   *  (supportsVision) — absence makes view_map degrade to the token grid. */
  snapshot?(): Promise<string | null>;
  /** Rendered crop of one rect (absolute map coordinates, corners inclusive); wire only on a
   *  vision seat whose renderer can crop — absence makes a region'd view_map degrade to the
   *  token grid, whether or not the full-map snapshotter is wired. */
  snapshotRegion?(rect: { x1: number; y1: number; x2: number; y2: number }): Promise<string | null>;
  /**
   * AI provenance descriptor (provider/model + per-edit approval). Absent in headless tests
   * defaults to AI-write with no provider details.
   *
   * `toolCallId` is the call the stroke belongs to, handed in by `executeToolCall` — the stroke
   * runner is given `deps` and never the call, and the export disclosure has to name WHICH call a
   * human approved (`AiAccepted`) as against one that ran under a standing allow-always.
   */
  getProvenanceSource?(toolCallId?: string): {
    provider?: string; model?: string; toolCallId?: string; userApproved?: boolean;
  };
  /** Non-map UI action: open the share-image or JSON export flow for the user
   *  to complete (a file download is outward-facing, so the human confirms it).
   *  Browser-only; absent in headless/tests, where the tool reports so. */
  requestExport?(kind: 'image' | 'json'): void;
}

export type ToolResultBody = { content: string; isError: boolean; image?: { dataUrl: string }; detail?: ToolResultDetail };

import { clamp } from '../../core/model/math';
export { clamp };
export const dedupe = (xs: string[]): string[] => [...new Set(xs)];

/** The cells a WRITE may actually reach: the buildable grass zone. Sea, beach, the plaza and the
 *  boundary refuse every edit (V-ZONE-01), and the zone map is static — so a write's geometry is
 *  clipped up front and the result names the count, instead of one off-zone corner failing or
 *  reverting the whole stroke. Read tools never clip: a look at the sea is a legitimate look. */
export function clipBuildable(cells: MacroCoord[], state: GridState): { cells: MacroCoord[]; offZone: number } {
  const kept = cells.filter((c) => state.cells[c.y]?.[c.x]?.zone === CellZone.Grass);
  return { cells: kept, offZone: cells.length - kept.length };
}

/** The one sentence a clipped write appends where anything was clipped. */
export function offZoneNote(offZone: number): string {
  return offZone > 0 ? ` ${offZone} cell(s) outside the buildable grass zone were skipped.` : '';
}

/** The paint cells a NON-coating object footprint covers, filtered out: terrain under a standing
 *  object is never paintable (V-PLACE-BLOCK), and the rule's own fix is clear_area first. Roads
 *  and other coatings ride surface changes and do not block. */
export function clipOccupied(cells: MacroCoord[], state: GridState): { cells: MacroCoord[]; occupied: number } {
  const index = getObjectIndex(state);
  const kept = cells.filter((c) => {
    const fp = { x: c.x - 0.5, y: c.y - 0.5, w: 1, h: 1 };
    for (const e of entriesNear(index, fp)) {
      if (e.coating) continue;
      if (rectsOverlap(e.rect, fp)) return false;
    }
    return true;
  });
  return { cells: kept, occupied: cells.length - kept.length };
}

/** The sentence an occupied-clipped paint appends where anything was clipped. */
export function occupiedNote(occupied: number): string {
  return occupied > 0 ? ` ${occupied} cell(s) under standing objects were skipped (clear_area removes object and terrain together).` : '';
}


/* ── error formatting (the LLM feedback) ─────────────────────────────── */

/**
 * AN ARGUMENT REFUSAL TEACHES. Every argument-shape error goes through here: it names the missing
 * or invalid parameter and, where one helps, shows a minimal valid example in the tool's own
 * schema shape, so the retry the error earns can differ from the call that earned it. Model-facing
 * English in the "Arguments: reason" register; `reason` ends in its own punctuation.
 */
export function argError(reason: string, example?: string): ToolResultBody {
  return { isError: true, content: `Arguments: ${reason}${example ? ` Example: ${example}` : ''}` };
}

/** The minimal valid flat call per shape family — what every geometry refusal shows. */
const RECT_EXAMPLE = 'shape: "rect", x1: 10, y1: 10, x2: 20, y2: 18';
const LINE_EXAMPLE = 'shape: "line", x1: 10, y1: 10, x2: 20, y2: 10';

/** The shared refusal for a shape-taking tool called with no geometry at all. `'area'` is the
 *  rect/circle/line/cells family (paint_terrain, erase_terrain, clear_area); `'path'` is the
 *  line/cells pair (build_road). */
export function noCellsError(shapes: 'area' | 'path'): ToolResultBody {
  return shapes === 'path'
    ? argError('no cells given, pass shape "line" with flat endpoint coordinates, or cells.', LINE_EXAMPLE)
    : argError('no cells given, pass shape ("rect", "circle", or "line") with its flat coordinates, or cells.', RECT_EXAMPLE);
}

/**
 * The argument refusal for a shape-taking call that resolved to no cells: names exactly what the
 * given shape still lacks, so the retry the error earns can differ from the call that earned it.
 * Teaches the FLAT form first — the nested forms stay accepted, but a guided decoder that cannot
 * emit them needs the example it can.
 */
export function geometryError(input: Record<string, unknown>, shapes: 'area' | 'path'): ToolResultBody {
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
  // One line per DISTINCT refusal (rule + sentence), with the evidence merged across errors: a
  // region-sized stroke over a forbidden zone comes back as one error per cell, and quoting each
  // would put thousands of identical lines in front of the model (a real run overflowed the
  // provider's context doing exactly that).
  const groups = new Map<string, { e: ValidationError; rects: NonNullable<ValidationError['rects']>; cells: ValidationError['cells'] }>();
  for (const e of errors) {
    const text = translateFor('en', e.message, e.messageParams);
    const key = `${e.ruleId}|${text}`;
    const g = groups.get(key) ?? { e, rects: [], cells: [] };
    if (e.rects) g.rects.push(...e.rects);
    g.cells.push(...e.cells);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ e, rects, cells }) => {
      const text = translateFor('en', e.message, e.messageParams);
      // Rect evidence (an object's drawn body) is quoted WHOLE: a 4-cell sample of a 6x5 footprint
      // reads as a thin bar, and the model then probes "free" cells that are inside the same
      // blocker. Cell evidence keeps the sample but names how much of it is unshown.
      const at = rects.length > 0
        ? rects.slice(0, 4).map((r) => `footprint (${r.x},${r.y})-(${r.x + r.w},${r.y + r.h})`).join(' ')
          + (rects.length > 4 ? ` and ${rects.length - 4} more` : '')
        : cells.slice(0, 4).map((c) => `(${c.x},${c.y})`).join(' ')
          + (cells.length > 4 ? ` and ${cells.length - 4} more cells` : '');
      const hint = RULE_HINTS[e.ruleId] ? ` Hint: ${RULE_HINTS[e.ruleId]}` : '';
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

/**
 * THE SAME REFUSAL, KEYED RATHER THAN WRITTEN, for the panel's own detail well.
 *
 * `formatErrors` above is the MODEL's copy and stays English. This is the reader's: the rule's own
 * i18n key and params, so the panel says it in the user's language (`ToolResultDetail.violations`).
 * Deduped by key+params, since a stroke refused over forty cells reports one rule forty times and a
 * well shows one sentence. Capped, because a detail rides into storage with the log.
 */
const VIOLATION_MAX = 4;

/** The carrier as a spreadable, so a caller never writes `violations: undefined` into a detail that
 *  travels into storage. */
function withViolations(
  list: NonNullable<ToolResultDetail['violations']> | undefined,
): { violations?: NonNullable<ToolResultDetail['violations']> } {
  return list ? { violations: list } : {};
}

export function detailViolations(errors: ValidationError[]): NonNullable<ToolResultDetail['violations']> | undefined {
  const out: NonNullable<ToolResultDetail['violations']> = [];
  const seen = new Set<string>();
  for (const e of errors) {
    const key = `${e.message}|${JSON.stringify(e.messageParams ?? {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ruleId: e.ruleId,
      message: e.message,
      ...(e.messageParams ? { params: e.messageParams } : {}),
    });
    if (out.length === VIOLATION_MAX) break;
  }
  return out.length > 0 ? out : undefined;
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

/**
 * Every macro cell a command touches — the FOOTPRINT for an object, not its anchor, so a building
 * straddling the boundary counts as outside. Covered cells (floor/ceil-expanded), not position +
 * integer offset: a half-anchored bridge/ramp (halfStep) straddling the region boundary must
 * still be caught by `firstStray` below, which `position + dx` for a half position would miss
 * (it never lands on an integer cell key the region guard's membership set holds).
 */
export function commandCells(cmd: Command): MacroCoord[] {
  switch (cmd.type) {
    case CommandType.PaintTerrain:
    case CommandType.EraseTerrain:
      return cmd.cells;
    case CommandType.PlaceObject: {
      const size = getPlacedObjectSize(cmd.object);
      return footprintCells(cmd.object.position.x, cmd.object.position.y, size.w, size.h);
    }
    case CommandType.RemoveObject: {
      const size = getPlacedObjectSize(cmd.removedObject);
      return footprintCells(cmd.removedObject.position.x, cmd.removedObject.position.y, size.w, size.h);
    }
    case CommandType.TrimCorners:
      return [{ x: cmd.x, y: cmd.y }];
  }
}

/** Shared bounds keep the region chip, order context, and write guard in agreement. */
export { regionBounds };

type RegionGuard = { has(c: MacroCoord): boolean; bounds: string };

/**
 * The region the agent is confined to, as a membership test plus the bounds to quote back, or null
 * when the user has painted nothing and the whole map is fair game.
 */
function regionGuard(region: MacroCoord[]): RegionGuard | null {
  const b = regionBounds(region);
  if (!b) return null;
  const inside = new Set(region.map((c) => `${c.x},${c.y}`));
  return {
    has: (c) => inside.has(`${c.x},${c.y}`),
    bounds: `${b.count} cells within (${b.x1},${b.y1})-(${b.x2},${b.y2})`,
  };
}

/**
 * THE region rule, in one place: the first cell any of `commands` touches outside the region, or
 * null. Both stroke runners feed it the commands AS APPLIED — the bridge and ramp traits SNAP
 * position during validation, so where a command finally lands is only knowable once it has run.
 */
function firstStray(guard: RegionGuard, commands: Command[]): MacroCoord | null {
  for (const cmd of commands) {
    const out = commandCells(cmd).find((c) => !guard.has(c));
    if (out) return out;
  }
  return null;
}

/** Tallies applied commands into the same shape `runStroke` reports: painted/erased cells deduped
 *  (a multi-tier mountain stroke issues one PaintTerrain per tier over the SAME cell list, so the
 *  count is cells touched, not commands issued) and objects placed/removed. `undefined` when
 *  neither landed, matching how an ordinary tool call omits `detail` entirely. */
function tallyDetail(commands: readonly Command[]): ToolResultDetail | undefined {
  const cellSet = new Set<string>();
  let objects = 0;
  for (const cmd of commands) {
    if (cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.EraseTerrain) {
      for (const c of cmd.cells) cellSet.add(`${c.x},${c.y}`);
    } else if (cmd.type === CommandType.PlaceObject || cmd.type === CommandType.RemoveObject) {
      objects++;
    }
  }
  if (cellSet.size === 0 && objects === 0) return undefined;
  return { ...(cellSet.size > 0 ? { cells: cellSet.size } : {}), ...(objects > 0 ? { objects } : {}) };
}

/** A committed stroke's representative command omits earlier edits; its snapshots retain them. */
function postStrokeDetail(exec: CommandExecutor, start: number, violations: ValidationError[]): ToolResultDetail {
  const entries = exec.getUndoEntries(start);
  const cells = new Set<string>();
  const objects = new Set<string>();
  for (const entry of entries) {
    const before = new Map(entry.before.map((s) => [`${s.coord.x},${s.coord.y}`, s.cell.terrain]));
    for (const s of entry.after) {
      const key = `${s.coord.x},${s.coord.y}`;
      if (JSON.stringify(before.get(key)) !== JSON.stringify(s.cell.terrain)) cells.add(key);
    }
    if (entry.objectOps) {
      for (const obj of entry.objectOps.added) objects.add(obj.id);
      for (const obj of entry.objectOps.removed) objects.add(obj.id);
    } else if (entry.cmd.type === CommandType.PlaceObject) objects.add(entry.cmd.object.id);
    else if (entry.cmd.type === CommandType.RemoveObject) objects.add(entry.cmd.removedObject.id);
    else if (entry.cmd.type === CommandType.TrimCorners && entry.cmd.objectId) objects.add(entry.cmd.objectId);
  }
  return {
    reverted: true,
    ...(entries.length > 0 ? { partialRevert: true } : {}),
    ...(cells.size > 0 ? { cells: cells.size } : {}),
    ...(objects.size > 0 ? { objects: objects.size } : {}),
    ...withViolations(detailViolations(violations)),
  };
}

/** What a stray earns. One rule, so one wording, whichever runner caught it. */
function outOfRegionResult(at: MacroCoord, guard: RegionGuard): ToolResultBody {
  return {
    isError: true,
    detail: { regionBlocked: true },
    content: `OUT OF REGION: this edit reached (${at.x},${at.y}), outside the region the user selected `
      + `(${guard.bounds}). Nothing was applied. Every cell you write, and every object you place or `
      + `remove, must lie inside that region — an object counts by its whole footprint, not its corner. `
      + `Re-plan within it, or ask the user to change the selection.`,
  };
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
  // The refusals as RULES beside the same refusals as the model's English (see `detailViolations`).
  const rejected: ValidationError[] = [];
  // Tallied alongside `ok` for the view's detail — a Set for cells since a multi-tier
  // mountain stroke (paintTerrain) issues one PaintTerrain command per tier over the
  // SAME cell list, and the painted count is the cells, not the tier count.
  const cellSet = new Set<string>();
  let objectsCount = 0;
  let violations: ReturnType<typeof exec.commitStrokeGroup>;
  // A painted region is a boundary, not a suggestion. Checked as each command applies, so a stray
  // stops the loop before the rest of the batch runs.
  const guard = regionGuard(deps.getRegion());
  let strayed: MacroCoord | null = null;
  try {
    exec.runSilently(() => {
      for (const cmd of commands) {
        const r = exec.execute(cmd);
        if (!r.success) { failures.push(formatErrors(r.errors)); rejected.push(...r.errors); continue; }
        ok++;
        if (cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.EraseTerrain) {
          for (const c of cmd.cells) cellSet.add(`${c.x},${c.y}`);
        } else if (cmd.type === CommandType.PlaceObject || cmd.type === CommandType.RemoveObject) {
          objectsCount++;
        }
        if (guard) {
          const out = firstStray(guard, [cmd]);
          if (out) { strayed = out; return; }
        }
      }
      if (ok > 0) afterApply?.(exec);
    });
    if (strayed) {
      // Nothing half-applies: an undo has to restore what the user was looking at.
      exec.rollbackTo(start);
      return outOfRegionResult(strayed as MacroCoord, guard!);
    }
    violations = exec.commitStrokeGroup(start, opts);
  } catch (err) {
    // Crashes restore the whole call, including commands that have already applied.
    exec.rollbackTo(start);
    throw err;
  } finally {
    exec.popSource();
  }
  if (violations.length > 0) {
    const detail = postStrokeDetail(exec, start, violations);
    return {
      isError: true,
      detail,
      content: revertedMsg('the edit', violations, detail),
    };
  }
  if (ok === 0 && failures.length > 0) {
    return {
      isError: true,
      ...(rejected.length > 0 ? { detail: { ...withViolations(detailViolations(rejected)) } } : {}),
      content: `All commands rejected:\n${capLines(dedupe(failures)).join('\n')}`,
    };
  }
  let msg = okMessage(ok);
  if (failures.length > 0) {
    msg += `\nPartially applied — ${failures.length} command(s) rejected:\n${capLines(dedupe(failures)).join('\n')}`;
  }
  if (snapshotCells) {
    msg += bboxSnapshot(deps, snapshotCells);
    deps.onFlash?.(snapshotCells);
  }
  const partial = withViolations(detailViolations(rejected));
  const tally = {
    ...(cellSet.size > 0 ? { cells: cellSet.size } : {}),
    ...(objectsCount > 0 ? { objects: objectsCount } : {}),
    ...partial,
  };
  const detail: ToolResultDetail | undefined = Object.keys(tally).length > 0 ? tally : undefined;
  return { isError: failures.length > 0, content: msg, detail };
}

/**
 * Callback variant of runStroke, for the write tools whose stroke body is a
 * per-cell loop or a populator call rather than a fixed Command[]. It reproduces
 * the same one-stroke-group dance runStroke does — capture the undo size, run the
 * body with validation-failed events silenced (async-safe: keeps silent across
 * awaits), then commitStrokeGroup and detect a post-stroke revert — and hands back
 * the body's own data (`result`) plus the raw `violations` and retained-change detail. It names
 * the same author runStroke does — a model wrote this content either way, and the
 * export disclosure and clearGenerated's sparing both read that authorship.
 *
 * The painted region binds here exactly as it binds runStroke, over the same
 * `firstStray` test. The body issues its own commands, so the check reads them back
 * off the executor (`commandsSince`) once the body settles rather than per command —
 * one rule, one set of facts, and a stray still rolls the whole call back. `outOfRegion`
 * is a finished refusal for the call site to return as-is; `result` is meaningless
 * beside it, since nothing was applied.
 */
export async function runStrokeBody<T>(
  deps: AgentToolDeps,
  body: () => T | Promise<T>,
): Promise<{ reverted: boolean; violations: ValidationError[]; result: T; outOfRegion: ToolResultBody | null; detail?: ToolResultDetail }> {
  const exec = deps.getExecutor();
  const start = exec.getUndoStackSize();
  const src = deps.getProvenanceSource?.() ?? {};
  exec.pushSource({ source: src.userApproved ? ProvSource.AiAccepted : ProvSource.AiWrite, tool: 'agent', ai: src });
  const guard = regionGuard(deps.getRegion());
  try {
    const result = await exec.runSilentlyAsync(async () => body());
    const applied = exec.commandsSince(start); // read BEFORE commitStrokeGroup collapses the group
    if (guard) {
      const stray = firstStray(guard, applied);
      if (stray) {
        exec.rollbackTo(start);
        return { reverted: false, violations: [], result, outOfRegion: outOfRegionResult(stray, guard) };
      }
    }
    const violations = exec.commitStrokeGroup(start);
    const reverted = violations.length > 0;
    return {
      reverted,
      violations,
      result,
      outOfRegion: null,
      detail: reverted
        ? postStrokeDetail(exec, start, violations)
        : tallyDetail(applied),
    };
  } catch (err) {
    // Same guarantee as runStroke: a crash never leaves half-applied, unvalidated edits.
    exec.rollbackTo(start);
    throw err;
  } finally {
    exec.popSource();
  }
}

/** Both stroke runners report the retained state beside the rule text and correction hints. */
export function revertedMsg(what: string, violations: ValidationError[], detail: ToolResultDetail | undefined): string {
  if (detail?.partialRevert) {
    return `PARTIALLY REVERTED: ${what} violated post-stroke rules. Only the commands needed to restore a legal map were rolled back. `
      + `Retained changes: ${detail.cells ?? 0} cell(s), ${detail.objects ?? 0} object(s). Inspect the current map before retrying.\n${formatErrors(violations)}`;
  }
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

/** Resolve a shape input — nested (rect / circle / line / cells) or flat (shape + top-level
 *  scalars), optional outline — into a deduped, in-bounds cell list. `flatDefault` is what bare
 *  corners with no `shape` mean: a rect for the area tools, the line for build_road. */
export function resolveCells(input: Record<string, unknown>, state: GridState, flatDefault: FlatDefault = 'rect'): MacroCoord[] {
  input = normalizeGeometry(input, flatDefault);
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
