/**
 * The stroke runners every write tool runs under: one call is one silent stroke group and one undo
 * step. Silencing keeps the error toast off agent edits, whose refusals go back to the model.
 * Pre-command rejections skip their command; post-stroke violations roll commands back until the
 * map is legal and report what was retained. Model-facing text is English with the rule's hint.
 */
import { sameTerrain } from '../../core/model/grid-model';
import type { Command, MacroCoord, ValidationError } from '../../core/model/types';
import type { CommandExecutor, Stroke } from '../../core/commands/command-executor';
import type { HistoryEntry } from '../../core/commands/command-apply';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { footprintCells } from '../../core/grid/footprint';
import { regionBounds, cellKey } from '../../core/grid/rect';
import { ProvSource, type SourceContext } from '../../core/provenance/types';
import type { CellSet } from '../../core/grid/grids';
import type { ToolResultDetail } from '../core/types';
import { regionTokens } from './serialize';
import { objectCellsOver, terrainUnder } from './cells';
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

/** Token snapshot of the object cells over the edited terrain, appended to write results so the
 *  model sees the actual outcome without a follow-up inspect_region call. */
function bboxSnapshot(deps: AgentToolDeps, terrain: readonly MacroCoord[]): string {
  const over = objectCellsOver(terrain);
  if (!over) return '';
  // pad 1 so containment/support context around the edit is visible
  const x1 = over.x1 - 1, y1 = over.y1 - 1, x2 = over.x2 + 1, y2 = over.y2 + 1;
  if (x2 - x1 + 1 > SNAPSHOT_MAX || y2 - y1 + 1 > SNAPSHOT_MAX) return '';
  return `\nResult (current state of the edited area):\n${regionTokens(deps.getState(), { x1, y1, x2, y2 })}`;
}

/**
 * Where a history entry changed the map: the terrain cells it snapshotted and the footprint, not the
 * anchor, of every object it put on or took off, so a building straddling the boundary counts as
 * outside. Read from the entry's snapshots because a collapsed group keeps only its last command.
 * Footprints are covered cells (floor/ceil-expanded): a half-anchored bridge or ramp lands on no
 * integer anchor the region guard's membership set holds.
 */
function entryCells(entry: Pick<HistoryEntry, 'before' | 'objectOps'>): { ground: MacroCoord[]; objects: MacroCoord[] } {
  const objects: MacroCoord[] = [];
  for (const o of [...entry.objectOps?.added ?? [], ...entry.objectOps?.removed ?? []]) {
    const size = getPlacedObjectSize(o);
    objects.push(...footprintCells(o.position.x, o.position.y, size.w, size.h));
  }
  return { ground: entry.before.map((s) => s.coord), objects };
}

type RegionGuard = { has(c: MacroCoord): boolean; hasGround(c: MacroCoord): boolean; bounds: string };

/**
 * The region the agent is confined to, as a membership test plus the bounds to quote back, or null
 * when the user has painted nothing and the whole map is fair game. The region is object cells; its
 * ground is the terrain those cells rest on, so terrain painted under the region's cells is inside it.
 */
function regionGuard(deps: AgentToolDeps): RegionGuard | null {
  const region = deps.getRegion();
  const b = regionBounds(region);
  if (!b) return null;
  const inside = new Set(region.map((c) => cellKey(c.x, c.y)));
  const ground = new Set(terrainUnder(region, deps.getState()).map((c) => cellKey(c.x, c.y)));
  return {
    has: (c) => inside.has(cellKey(c.x, c.y)),
    hasGround: (c) => ground.has(cellKey(c.x, c.y)),
    bounds: `${b.count} cells within (${b.x1},${b.y1})-(${b.x2},${b.y2})`,
  };
}

/**
 * The region rule: the first place any of `entries` touches outside the region, in words, or null. Both
 * stroke runners pass the history the stroke left, whose commands are as applied, since bridge and
 * ramp traits snap position as the command resolves.
 */
function firstStray(guard: RegionGuard, entries: readonly HistoryEntry[]): string | null {
  for (const entry of entries) {
    const { ground, objects } = entryCells(entry);
    const out = objects.find((c) => !guard.has(c));
    if (out) return `(${out.x},${out.y})`;
    const off = ground.find((c) => !guard.hasGround(c));
    if (!off) continue;
    // Named by the cells resting on that ground, all of which lie outside the region.
    const over = objectCellsOver([off])!;
    return `the ground between cells (${over.x1},${over.y1})-(${over.x2},${over.y2})`;
  }
  return null;
}

/** The terrain cells whose terrain differs across `entries`, read from the snapshots, which a
 *  collapsed group retains in full. */
function changedGround(entries: readonly HistoryEntry[]): MacroCoord[] {
  const cells = new Map<string, MacroCoord>();
  for (const entry of entries) {
    const before = new Map(entry.before.map((s) => [cellKey(s.coord.x, s.coord.y), s.cell.terrain]));
    for (const s of entry.after) {
      const key = cellKey(s.coord.x, s.coord.y);
      if (!sameTerrain(before.get(key), s.cell.terrain, { patchOnly: 'exact' })) cells.set(key, s.coord);
    }
  }
  return [...cells.values()];
}

/** What `entries` changed, as a detail's counts: the cells whose terrain differs across them and the
 *  objects put on or taken off. */
function entriesTally(entries: readonly HistoryEntry[], ground = changedGround(entries)): Pick<ToolResultDetail, 'cells' | 'objects'> {
  const objects = new Set<string>();
  for (const entry of entries) {
    for (const obj of entry.objectOps?.added ?? []) objects.add(obj.id);
    for (const obj of entry.objectOps?.removed ?? []) objects.add(obj.id);
  }
  return { ...(ground.length > 0 ? { cells: ground.length } : {}), ...(objects.size > 0 ? { objects: objects.size } : {}) };
}

function postStrokeDetail(stroke: Stroke, violations: ValidationError[]): ToolResultDetail {
  const entries = stroke.entries();
  return {
    reverted: true,
    ...(entries.length > 0 ? { partialRevert: true } : {}),
    ...entriesTally(entries),
    ...withViolations(detailViolations(violations)),
  };
}

/** What a stray earns. One rule, so one wording, whichever runner caught it. */
function outOfRegionResult(at: string, guard: RegionGuard): ToolOutcome {
  return {
    isError: true,
    detail: { regionBlocked: true },
    content: `${BANNERS.outOfRegion} this edit reached ${at}, outside the region the user selected `
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
  const guard = regionGuard(deps);
  // Crashes restore the whole call, including commands that have already applied.
  const stroke = exec.transaction({ source: agentSource(deps) }, (tx): { refusal: ToolOutcome } | { tx: Stroke; violations: ValidationError[]; tally: Pick<ToolResultDetail, 'cells' | 'objects'> } => {
    exec.transaction({ silent: true }, () => {
      for (const cmd of commands) {
        const depth = tx.size;
        const r = exec.execute(cmd);
        if (!r.success) { failures.push(formatErrors(r.errors)); rejected.push(...r.errors); continue; }
        ok++;
        // A stray stops the batch before the rest of it runs; closing the stroke refuses it.
        if (guard && firstStray(guard, tx.entries().slice(depth))) return;
      }
      if (ok > 0) afterApply?.(exec);
    });
    const tally = entriesTally(tx.entries());
    const closed = closeStroke(tx, guard, opts.reconcile);
    return 'refusal' in closed ? closed : { tx, violations: closed.violations, tally };
  });
  if ('refusal' in stroke) return stroke.refusal;
  const { tx, violations, tally: changed } = stroke;
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
  const tally = { ...changed, ...withViolations(detailViolations(rejected)) };
  const detail: ToolResultDetail | undefined = Object.keys(tally).length > 0 ? tally : undefined;
  return { isError: failures.length > 0, content: msg, detail };
}

/** What `runStrokeBody` settles to: a finished refusal to return as is, or the body's result with
 *  the terrain cells the stroke changed. */
type StrokeBodyOutcome<T> = { refusal: ToolOutcome } | { result: T; detail?: ToolResultDetail; ground: MacroCoord[] };

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
  const guard = regionGuard(deps);
  // Same guarantee as runStroke: a crash never leaves half-applied, unvalidated edits.
  return exec.transactionAsync({ source: agentSource(deps) }, async (tx): Promise<StrokeBodyOutcome<T>> => {
    const result = await exec.transactionAsync({ silent: true }, async () => body());
    const ground = changedGround(tx.entries());
    const tally = entriesTally(tx.entries(), ground);
    const closed = closeStroke(tx, guard, opts.reconcile);
    if ('refusal' in closed) return closed;
    if (closed.violations.length > 0) {
      return { refusal: revertedOutcome(label, closed.violations, postStrokeDetail(tx, closed.violations)) };
    }
    return { result, ground, ...(Object.keys(tally).length > 0 ? { detail: tally } : {}) };
  });
}
