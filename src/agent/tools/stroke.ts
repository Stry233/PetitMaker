/**
 * The stroke runners every write tool runs under: one call is one silent stroke group and one undo
 * step. Silencing keeps the error toast off agent edits, whose refusals go back to the model.
 * Pre-command rejections skip their command; post-stroke violations roll commands back until the
 * map is legal and report what was retained. Model-facing text is English with the rule's hint.
 */
import { sameTerrain } from '../../core/model/grid-model';
import { CommandType, type Command, type MacroCoord, type ValidationError } from '../../core/model/types';
import type { CommandExecutor, Stroke } from '../../core/commands/command-executor';
import type { HistoryEntry } from '../../core/commands/command-apply';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { footprintCells } from '../../core/grid/footprint';
import { regionBounds, cellKey } from '../../core/grid/rect';
import { ProvSource, type SourceContext } from '../../core/provenance/types';
import type { CellSet } from '../../core/grid/grids';
import type { ToolResultDetail } from '../core/types';
import { regionTokens } from './serialize';
import type { AgentToolDeps } from './deps';
import { allRejectedOutcome, BANNERS, capLines, dedupe, formatErrors, revertedOutcome } from './feedback';
import type { ToolOutcome } from './spec';

/**
 * The refusals as rule keys and params for the panel's detail well (`ToolResultDetail.violations`),
 * beside the model's English. Deduped by key and params, and capped because details are persisted.
 */
const VIOLATION_MAX = 4;

/** The carrier as a spreadable, so a caller never writes `violations: undefined` into a detail that
 *  travels into storage. */
function withViolations(
  list: NonNullable<ToolResultDetail['violations']> | undefined,
): { violations?: NonNullable<ToolResultDetail['violations']> } {
  return list ? { violations: list } : {};
}

function detailViolations(errors: ValidationError[]): NonNullable<ToolResultDetail['violations']> | undefined {
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

/* ── stroke runner: One stroke group per write tool call ─────────────── */

const SNAPSHOT_MAX = 24;

/** Token snapshot of the cells' bbox, appended to write results so the model
 *  sees the actual outcome without a follow-up inspect_region call. */
function bboxSnapshot(deps: AgentToolDeps, cells: readonly MacroCoord[]): string {
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
 * Every macro cell a history entry's command touches — the footprint for an object, not its anchor, so a building
 * straddling the boundary counts as outside. Covered cells (floor/ceil-expanded), not position +
 * integer offset: a half-anchored bridge/ramp (halfStep) straddling the region boundary must
 * still be caught by `firstStray` below, which `position + dx` for a half position would miss
 * (it never lands on an integer cell key the region guard's membership set holds).
 */
function entryCells(entry: Pick<HistoryEntry, 'cmd' | 'objectOps'>): MacroCoord[] {
  const cmd = entry.cmd;
  switch (cmd.type) {
    case CommandType.PaintTerrain:
    case CommandType.EraseTerrain:
      return cmd.cells;
    case CommandType.PlaceObject: {
      const size = getPlacedObjectSize(cmd.object);
      return footprintCells(cmd.object.position.x, cmd.object.position.y, size.w, size.h);
    }
    case CommandType.RemoveObject: {
      const gone = entry.objectOps?.removed.find((o) => o.id === cmd.objectId);
      if (!gone) return [];
      const size = getPlacedObjectSize(gone);
      return footprintCells(gone.position.x, gone.position.y, size.w, size.h);
    }
    case CommandType.TrimCorners:
      return [{ x: cmd.x, y: cmd.y }];
  }
}

type RegionGuard = { has(c: MacroCoord): boolean; bounds: string };

/**
 * The region the agent is confined to, as a membership test plus the bounds to quote back, or null
 * when the user has painted nothing and the whole map is fair game.
 */
function regionGuard(region: MacroCoord[]): RegionGuard | null {
  const b = regionBounds(region);
  if (!b) return null;
  const inside = new Set(region.map((c) => cellKey(c.x, c.y)));
  return {
    has: (c) => inside.has(cellKey(c.x, c.y)),
    bounds: `${b.count} cells within (${b.x1},${b.y1})-(${b.x2},${b.y2})`,
  };
}

/**
 * The region rule: the first cell any of `entries` touches outside the region, or null. Both
 * stroke runners pass the history the stroke left, whose commands are as applied, since bridge and
 * ramp traits snap position as the command resolves.
 */
function firstStray(guard: RegionGuard, entries: readonly HistoryEntry[]): MacroCoord | null {
  for (const entry of entries) {
    const out = entryCells(entry).find((c) => !guard.has(c));
    if (out) return out;
  }
  return null;
}

/** Tallies applied commands into the shape both stroke runners report: painted/erased cells deduped
 *  (a multi-tier mountain stroke issues one PaintTerrain per tier over the same cell list, so the
 *  count is cells touched, not commands issued) and objects placed/removed. `undefined` when
 *  neither landed, matching how an ordinary tool call omits `detail` entirely. */
function tallyDetail(commands: readonly Command[]): ToolResultDetail | undefined {
  const cellSet = new Set<string>();
  let objects = 0;
  for (const cmd of commands) {
    if (cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.EraseTerrain) {
      for (const c of cmd.cells) cellSet.add(cellKey(c.x, c.y));
    } else if (cmd.type === CommandType.PlaceObject || cmd.type === CommandType.RemoveObject) {
      objects++;
    }
  }
  if (cellSet.size === 0 && objects === 0) return undefined;
  return { ...(cellSet.size > 0 ? { cells: cellSet.size } : {}), ...(objects > 0 ? { objects } : {}) };
}

/** A committed stroke's representative command omits earlier edits; its snapshots retain them. */
function postStrokeDetail(stroke: Stroke, violations: ValidationError[]): ToolResultDetail {
  const entries = stroke.entries();
  const cells = new Set<string>();
  const objects = new Set<string>();
  for (const entry of entries) {
    const before = new Map(entry.before.map((s) => [cellKey(s.coord.x, s.coord.y), s.cell.terrain]));
    for (const s of entry.after) {
      const key = cellKey(s.coord.x, s.coord.y);
      if (!sameTerrain(before.get(key), s.cell.terrain, { patchOnly: 'exact' })) cells.add(key);
    }
    for (const obj of entry.objectOps?.added ?? []) objects.add(obj.id);
    for (const obj of entry.objectOps?.removed ?? []) objects.add(obj.id);
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
function outOfRegionResult(at: MacroCoord, guard: RegionGuard): ToolOutcome {
  return {
    isError: true,
    detail: { regionBlocked: true },
    content: `${BANNERS.outOfRegion} this edit reached (${at.x},${at.y}), outside the region the user selected `
      + `(${guard.bounds}). Nothing was applied. Every cell you write, and every object you place or `
      + `remove, must lie inside that region — an object counts by its whole footprint, not its corner. `
      + `Re-plan within it, or ask the user to change the selection.`,
  };
}

/** The author both stroke runners name: a model wrote this content, accepted by the user or not. */
function agentSource(deps: AgentToolDeps): SourceContext {
  const src = deps.getProvenanceSource?.() ?? {};
  return { source: src.userApproved ? ProvSource.AiAccepted : ProvSource.AiWrite, tool: 'agent', ai: src };
}

/**
 * Closes a stroke for either runner: any applied command (snapped crossings and follow-up trims
 * included) outside the region rolls the whole call back as a refusal; otherwise the stroke commits.
 */
function closeStroke(
  tx: Stroke, guard: RegionGuard | null, reconcile: boolean | undefined,
): { refusal: ToolOutcome } | { violations: ValidationError[] } {
  const stray = guard ? firstStray(guard, tx.entries()) : null;
  if (stray) {
    // Nothing half-applies: an undo has to restore what the user was looking at.
    tx.rollback();
    return { refusal: outOfRegionResult(stray, guard!) };
  }
  return { violations: tx.commit({ reconcile }) };
}

interface StrokeOptions {
  /** Pure edge-cut strokes skip the reconcile pass: a silhouette-only cut cannot invalidate another cut. */
  reconcile?: boolean;
}

export function runStroke(
  deps: AgentToolDeps,
  commands: Command[],
  okMessage: (ok: number) => string,
  opts: StrokeOptions & {
    snapshot?: CellSet;
    /** Runs inside the silent stroke after the commands (an auto edge-cut), so its trims share the undo step. */
    afterApply?: (exec: CommandExecutor) => void;
  } = {},
): ToolOutcome {
  const { snapshot, afterApply } = opts;
  const exec = deps.getExecutor();
  let ok = 0; const failures: string[] = [];
  // The refusals as rules, beside the model's English (see `detailViolations`).
  const rejected: ValidationError[] = [];
  // The caller's commands that applied, tallied for the view's detail; afterApply's own commands
  // are not among them.
  const accepted: Command[] = [];
  const guard = regionGuard(deps.getRegion());
  // Crashes restore the whole call, including commands that have already applied.
  const stroke = exec.transaction({ source: agentSource(deps) }, (tx): { refusal: ToolOutcome } | { tx: Stroke; violations: ValidationError[] } => {
    exec.transaction({ silent: true }, () => {
      for (const cmd of commands) {
        const depth = tx.size;
        const r = exec.execute(cmd);
        if (!r.success) { failures.push(formatErrors(r.errors)); rejected.push(...r.errors); continue; }
        ok++;
        accepted.push(cmd);
        // A stray stops the batch before the rest of it runs; closing the stroke refuses it.
        if (guard && firstStray(guard, tx.entries().slice(depth))) return;
      }
      if (ok > 0) afterApply?.(exec);
    });
    const closed = closeStroke(tx, guard, opts.reconcile);
    return 'refusal' in closed ? closed : { tx, violations: closed.violations };
  });
  if ('refusal' in stroke) return stroke.refusal;
  const { tx, violations } = stroke;
  if (violations.length > 0) return revertedOutcome('the edit', violations, postStrokeDetail(tx, violations));
  if (ok === 0 && failures.length > 0) return allRejectedOutcome(failures, withViolations(detailViolations(rejected)));
  let msg = okMessage(ok);
  if (failures.length > 0) {
    msg += `\nPartially applied — ${failures.length} command(s) rejected:\n${capLines(dedupe(failures)).join('\n')}`;
  }
  if (snapshot) {
    msg += bboxSnapshot(deps, snapshot.cells);
    deps.onFlash?.([snapshot]);
  }
  const tally = { ...tallyDetail(accepted), ...withViolations(detailViolations(rejected)) };
  const detail: ToolResultDetail | undefined = Object.keys(tally).length > 0 ? tally : undefined;
  return { isError: failures.length > 0, content: msg, detail };
}

/** What `runStrokeBody` settles to: a finished refusal to return as is, or the body's result. */
export type StrokeBodyOutcome<T> = { refusal: ToolOutcome } | { result: T; detail?: ToolResultDetail };

/**
 * The callback variant of runStroke, for a stroke body that issues its own commands (a per-cell loop
 * or a populator call). Same stroke group, author and region check, read off the stroke once the
 * body settles. A stray or a post-stroke revert comes back as the refusal, the revert worded with
 * `label`.
 */
export async function runStrokeBody<T>(
  deps: AgentToolDeps,
  label: string,
  body: () => T | Promise<T>,
  opts: StrokeOptions = {},
): Promise<StrokeBodyOutcome<T>> {
  const exec = deps.getExecutor();
  const guard = regionGuard(deps.getRegion());
  // Same guarantee as runStroke: a crash never leaves half-applied, unvalidated edits.
  return exec.transactionAsync({ source: agentSource(deps) }, async (tx): Promise<StrokeBodyOutcome<T>> => {
    const result = await exec.transactionAsync({ silent: true }, async () => body());
    const applied = tx.commands(); // read before the commit collapses the group
    const closed = closeStroke(tx, guard, opts.reconcile);
    if ('refusal' in closed) return closed;
    if (closed.violations.length > 0) {
      return { refusal: revertedOutcome(label, closed.violations, postStrokeDetail(tx, closed.violations)) };
    }
    return { result, detail: tallyDetail(applied) };
  });
}
