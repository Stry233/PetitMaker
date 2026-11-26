/*
 * A placed blueprint copied whole, pasted (BLUE-07, EDIT-54, EDIT-57): it goes where an object copy
 * goes, laid by the blueprint placement, so its terrain lands on the surface under it and a part that
 * cannot land is skipped rather than refusing the rest. Where the paste only asks for room, a picked
 * block where nothing of it lands, a region or the nearest open ground, it takes a place where all
 * of it lands on open ground, its frame clear of every placement on the map.
 */
import { cellKey, rectsOverlap } from '../../core/grid/rect';
import { mapGroups } from '../../core/model/placed-group';
import type { MacroCoord } from '../../core/model/types';
import type { BlueprintBody } from '../../core/model/blueprint';
import { copiedBody, type Arrangement } from '../../state/clipboard';
import { nearestRoom, pasteReach, readingOrder, roomAround, type PasteAim, type PasteDoor } from '../objects/arrangement';
import { openLanding, placeBlueprint, previewBlueprint, type BlueprintLaid } from './place';

/** What pasting a placed blueprint came to: what it laid, null when nothing was; whether it went
 *  nearby rather than where it was aimed, and whether no place had room for it. */
interface GroupPasteOutcome {
  readonly laid: BlueprintLaid | null;
  readonly nearby: boolean;
  readonly noRoom: boolean;
}

/** The base `body` lands on with its frame's top-left at `at` when all of it lands on open ground,
 *  its frame overlapping no placement's on the map; null otherwise. */
function openAt(door: PasteDoor, body: BlueprintBody, at: MacroCoord): number | null {
  const frame = { x: at.x, y: at.y, w: body.w, h: body.h };
  if (mapGroups(door.state).some((g) => rectsOverlap(g.frame, frame))) return null;
  return openLanding(door, body, { at, quarters: 0 });
}

/** Whether `body`'s frame with its top-left at `at` lies wholly on the cells `inside` (keyed). */
function frameInside(body: BlueprintBody, at: MacroCoord, inside: ReadonlySet<string>): boolean {
  for (let y = at.y; y < at.y + body.h; y++) for (let x = at.x; x < at.x + body.w; x++) if (!inside.has(cellKey(x, y))) return false;
  return true;
}

/** Lays the copy of a placed blueprint `a` holds with its frame's top-left at `at`, as one undo step
 *  recording a new group of its blueprint under its names; null when `a` holds no placed blueprint. */
export function layGroupCopy(door: PasteDoor, a: Arrangement, at: MacroCoord): BlueprintLaid | null {
  const body = copiedBody(a);
  return body && a.group ? placeBlueprint(door, body, { at, quarters: 0 }, a.group.seed) : null;
}

/**
 * Lays one copy of the placed blueprint `a` holds where `aim` asks, as one undo step recording a new
 * group of the same blueprint: on a picked or pressed block (`cell`) its frame's top-left goes there
 * whenever anything of it lands, what cannot land skipped; in a region, on the first top-left in
 * reading order whose frame stays inside it and where all of it lands on open ground; with `near`, at
 * the place it was copied from when all of it lands there. Otherwise it goes to the nearest place
 * where all of it lands on open ground, preferring the layer the aimed top-left gives it (for `near`
 * the layer it was copied from), within a few cells, or anywhere on the map for `near`. Nothing
 * changes when `a` holds no placed blueprint or no place has room.
 */
export function pasteGroupAt(door: PasteDoor, a: Arrangement, aim: PasteAim): GroupPasteOutcome {
  const body = copiedBody(a);
  const noRoom: GroupPasteOutcome = { laid: null, nearby: false, noRoom: true };
  if (!body || !a.group || (aim.kind === 'region' && aim.cells.length === 0)) return noRoom;
  const lay = (at: MacroCoord, nearby: boolean): GroupPasteOutcome => ({ laid: layGroupCopy(door, a, at), nearby: nearby && aim.kind !== 'near', noRoom: false });

  let from: MacroCoord;
  let level: number;
  if (aim.kind === 'cell') {
    const here = previewBlueprint(door, body, { at: aim.cell, quarters: 0 });
    if (here.cells.length > 0 || here.objects.length > 0) return lay(aim.cell, false);
    from = aim.cell;
    level = here.base;
  } else if (aim.kind === 'region') {
    const inside = new Set(aim.cells.map((c) => cellKey(c.x, c.y)));
    const order = readingOrder(aim.cells);
    for (const at of order) if (frameInside(body, at, inside) && openAt(door, body, at) !== null) return lay(at, false);
    from = order[0]!;
    level = previewBlueprint(door, body, { at: from, quarters: 0 }).base;
  } else {
    if (openAt(door, body, aim.origin) !== null) return lay(aim.origin, false);
    from = aim.origin;
    level = a.group.base;
  }

  const room = nearestRoom(roomAround(door.state, from, body.w, body.h, pasteReach(door.state, aim)), from, level, (at) => {
    const base = openAt(door, body, at);
    return base === null ? null : { at, level: base };
  });
  return room ? lay(room.at, true) : noRoom;
}
