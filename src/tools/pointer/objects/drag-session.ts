/**
 * Drag-to-move as an edit: the session a press on a selected object begins, which previews the drop
 * as the pointer travels and commits it on release (one object as an atomic remove and place, a
 * plural selection as one group move), or reports why it was refused. The pointer side keeps the
 * drag threshold and reads the map point under the pointer; everything the drop means is here.
 */
import type { CommandExecutor } from '../../../core/commands/command-executor';
import type { GridState, MacroCoord, PlacedObject, Refusal } from '../../../core/model/types';
import type { MapPoint } from '../../../core/grid/grids';
import { cellSet } from '../../../core/grid/grids';
import { getFootprint } from '../../../core/grid/footprint';
import { cellAtPoint, halfPoint } from '../../../core/grid/pointer';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { selectedObjectIds, type BlockRef } from '../../../state/selection';
import { getPlacedObjectSize, hasHalfStep, resolveAnchor, snapsOwnPlacement } from '../../../state/object-geometry';
import { getCatalogItem } from '../../../state/catalog';
import { planObjectMove } from '../../placement/probe';
import { moveObject } from '../../objects/actions';
import { groupMembers, moveGroup, planGroupMove } from '../../objects/group-actions';
import type { ToolOverlay } from '../runtime/view-seam';

/** What a drag reads and writes outside the map: the session's map, executor and selection, and the
 *  channel a refusal is reported on. */
export interface ObjectDragPort {
  state(): GridState | null;
  executor(): CommandExecutor | null;
  selection(): readonly BlockRef[];
  setSelection(blocks: BlockRef[]): void;
  report(refusal: Refusal | null | undefined): void;
}

/** The view a preview draws on and a drop plays its landing cue in. */
export interface ObjectDragView {
  overlay: Pick<ToolOverlay, 'showGhost' | 'showObjectMove'>;
  plopObject(id: string): void;
}

/** The ids a drag anchored on `anchorId` carries, or null when it carries that object alone:
 *  the whole selection, when it is plural and the anchor belongs to it. */
function groupDragIds(sel: readonly BlockRef[], anchorId: string): string[] | null {
  if (sel.length < 2) return null;
  const ids = selectedObjectIds(sel);
  return ids.length > 1 && ids.includes(anchorId) ? ids : null;
}

/**
 * `obj`'s anchor at map point `point` plus `offset`: the one seam the press (offset {0,0}, to
 * capture the grab), the live preview and the drop all resolve through
 * (`state/object-geometry:resolveAnchor`), so none of the three can land on a different cell for
 * the same pointer read. Reads the point at `obj`'s own item's granularity: the half-cell point for
 * a halfStep ramp or bridge, the placement cell otherwise. Falls back to the plain whole-cell
 * reading when `obj`'s catalog item is unknown (a corrupt catalogId).
 *
 * Not used for a group move: a mixed selection's delta stays a whole-cell integer deliberately.
 */
function objectPointerAnchor(obj: PlacedObject, point: MapPoint, offset: MacroCoord): MacroCoord {
  const whole = cellAtPoint(point, PLACEMENT_GRID);
  const item = getCatalogItem(obj.catalogId);
  if (!item) return { x: Math.round(whole.x + offset.x), y: Math.round(whole.y + offset.y) };
  const half = hasHalfStep(item) ? halfPoint(point) : undefined;
  return resolveAnchor(item, whole, half, offset);
}

export class ObjectDragSession {
  /** The object the session moves, from `begin` until the drop or a cancel. */
  objectId: string | null = null;
  // Where the object's top-left sits relative to the grabbed cell, so the object follows the
  // pointer from where it was picked up (not snapped by its top-left corner).
  private grabOffsetX = 0;
  private grabOffsetY = 0;
  // The (groupIds, dx, dy) or (id, anchor) key the preview last recomputed for: a pointer move that
  // lands on the same cell as the previous one changes nothing about the ghost, so this skips
  // re-running the group's O(members) validity re-check and rebuilding the ghost geometry.
  private lastGhostKey: string | null = null;

  constructor(private readonly port: ObjectDragPort) {}

  /** Begins a move of the selection anchored on `anchorId`, grabbed at map point `grab`, or at
   *  `fallback` (the pressed cell) when no view reads the pointer. Returns whether it began. */
  begin(anchorId: string, grab: MapPoint | null, fallback: MacroCoord): boolean {
    const obj = this.port.state()?.objects.get(anchorId);
    if (!obj) return false;
    this.objectId = anchorId;
    // The grab offset, at the same granularity the preview and the drop read the pointer at
    // (offset {0,0}: nothing is grabbed yet): half-cell for a halfStep ramp or bridge, so a grab
    // anywhere on its half-covered footprint drags true, whole otherwise.
    const pressAnchor = grab ? objectPointerAnchor(obj, grab, { x: 0, y: 0 }) : fallback;
    this.grabOffsetX = obj.position.x - pressAnchor.x;
    this.grabOffsetY = obj.position.y - pressAnchor.y;
    this.lastGhostKey = null;
    return true;
  }

  /** Ends the session without committing anything. */
  cancel(): void {
    this.objectId = null;
  }

  /** Draws the drop the pointer at `point` would make: the footprint wash and the moved bodies,
   *  tinted by whether the drop would be accepted. */
  preview(view: ObjectDragView, point: MapPoint): void {
    const gs = this.port.state();
    const executor = this.port.executor();
    const obj = this.objectId ? gs?.objects.get(this.objectId) : undefined;
    if (!obj || !executor || !gs) return;
    const groupIds = groupDragIds(this.port.selection(), obj.id);
    if (groupIds) {
      // A group drag moves by whole cells: half steps would push the members without halfStep
      // off their grid, and the trait rule would refuse the whole move every time.
      const { dx, dy } = this.groupDelta(obj, point);
      const ghostKey = `${groupIds.join(',')}|${dx}|${dy}`;
      if (ghostKey === this.lastGhostKey) return;
      this.lastGhostKey = ghostKey;
      // A group is judged as a group: every member's destination, with the whole group lifted (so
      // a row sliding along itself is not a collision), and one tint for all of them.
      const members = groupMembers(gs, groupIds);
      const { valid, landed } = planGroupMove(executor, gs, groupIds, dx, dy);
      const cells: MacroCoord[] = members.flatMap((m) => {
        const size = getPlacedObjectSize(m);
        return getFootprint(m.position.x + dx, m.position.y + dy, size.w, size.h);
      });
      view.overlay.showGhost(cellSet(PLACEMENT_GRID, cells), { wash: 'placement', valid });
      // Each member keeps its whole-cell destination and takes the elevation its plan resolved
      // (half-cell anchors and terrain-snapped items).
      view.overlay.showObjectMove(members.map((m, i) => (
        { ...m, position: { x: m.position.x + dx, y: m.position.y + dy }, elevation: landed[i]!.elevation }
      )), valid);
      return;
    }
    // The pointer read at the dragged item's own granularity (half-cell for a halfStep ramp or
    // bridge), so the drag steps in half cells too; a whole-cell read would floor away exactly the
    // sub-cell motion a halfStep item needs.
    const anchor = objectPointerAnchor(obj, point, this.soloOffset(obj));
    const ghostKey = `${obj.id}|${anchor.x}|${anchor.y}`;
    if (ghostKey === this.lastGhostKey) return;
    this.lastGhostKey = ghostKey;
    // The preview geometry, which for a bridge or ramp is the span the trait snapped to, not the
    // cell under the pointer; a refused plan never snapped, so it still stands at the pointer.
    const plan = planObjectMove(executor, gs, obj, anchor.x, anchor.y);
    const valid = plan.errors.length === 0;
    const at = plan.preview;
    const size = getPlacedObjectSize(at);
    view.overlay.showGhost(cellSet(PLACEMENT_GRID, getFootprint(at.position.x, at.position.y, size.w, size.h)), { wash: 'placement', valid });
    view.overlay.showObjectMove([at], valid);
  }

  /** Commits the drop at map point `point` and ends the session. */
  commit(view: ObjectDragView, point: MapPoint): void {
    const movedId = this.objectId;
    this.objectId = null;
    const gs = this.port.state();
    const executor = this.port.executor();
    const obj = movedId ? gs?.objects.get(movedId) : undefined;
    if (!obj || !gs || !executor) return;

    const groupIds = groupDragIds(this.port.selection(), obj.id);
    if (groupIds) {
      const { dx, dy } = this.groupDelta(obj, point);
      if (dx === 0 && dy === 0) return;
      // The whole selection travels by the drag's delta, all-or-nothing. Every member lands (a move
      // never turns anything), so each gets the squash cue a single placement plays, requested as
      // its own placement command is about to run: the group is lifted before any of it is placed,
      // so there is no earlier moment where the destination body exists to animate. The members
      // keep their ids, so the selection still names them.
      const res = moveGroup(executor, gs, groupIds, { dx, dy }, (member) => view.plopObject(member.id));
      this.port.report(res.refusal);
      return;
    }

    // The same anchor resolution the preview used, so a halfStep object's drop lands on the half
    // grid it was dragged to.
    const anchor = objectPointerAnchor(obj, point, this.soloOffset(obj));
    const res = moveObject(executor, gs, obj, anchor.x, anchor.y);
    this.port.report(res.refusal);
    if (!res.ok) return;
    // The selection follows the moved object's new geometry. setSelection, never toggle: Ctrl
    // pressed mid-drag would otherwise deselect the object just moved.
    this.port.setSelection([{ kind: 'object', id: obj.id }]);
  }

  /** The whole-cell delta a group drag at `point` moves by: the grabbed cell plus the grab offset,
   *  against the anchor's own position. */
  private groupDelta(obj: PlacedObject, point: MapPoint): { dx: number; dy: number } {
    const macro = cellAtPoint(point, PLACEMENT_GRID);
    return { dx: macro.x + this.grabOffsetX - obj.position.x, dy: macro.y + this.grabOffsetY - obj.position.y };
  }

  /**
   * The pointer offset the solo drag resolves its anchor with. A snapping item (bridge or ramp) has
   * no grab to preserve: the trait detects a gap or cliff near the position it is handed, so what
   * the pointer names is a probe anchor and what the object carries is the snapped footprint's
   * top-left (`snapsOwnPlacement`). Tracking the top-left rigidly would hand the judge a cell a
   * whole span away from the ghost being aimed, so the offset is zeroed and the pointer names the
   * cliff directly, as a fresh placement's does.
   *
   * The group delta keeps the real offset: its arithmetic (`macro + grabOffset - obj.position`) is
   * a pure pointer delta only because the two obj.position terms cancel.
   */
  private soloOffset(obj: PlacedObject): MacroCoord {
    return snapsOwnPlacement(getCatalogItem(obj.catalogId))
      ? { x: 0, y: 0 }
      : { x: this.grabOffsetX, y: this.grabOffsetY };
  }
}
