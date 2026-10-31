/*
 * What a Ctrl+drag copy (EDIT-60) shows and says: its ghost under the pointer and the toasts a
 * placed copy raises. The drop lands through `objects/arrangement.ts:pasteArrangement`.
 */
import type { PlacedObject } from '../../../core/model/types';
import { cellSet } from '../../../core/grid/grids';
import { getFootprint } from '../../../core/grid/footprint';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { objectRect } from '../../../state/object-geometry';
import type { Translate } from '../../../i18n/keys';
import { pasteNotices } from '../../../i18n/terms/copy-notices';
import type { PasteOutcome } from '../../objects/arrangement';
import type { NoticeTone } from '../runtime/types';
import type { ToolOverlay } from '../runtime/view-seam';

/** Draws `objects` as a copy's ghost: their footprints washed by `valid` and a body for each. */
export function showCopyGhost(overlay: Pick<ToolOverlay, 'showGhost' | 'showGroupPlacementGhost'>, objects: readonly PlacedObject[], valid: boolean): void {
  const cells = objects.flatMap((obj) => {
    const r = objectRect(obj);
    return getFootprint(r.x, r.y, r.w, r.h);
  });
  overlay.showGhost(cellSet(PLACEMENT_GRID, cells), { wash: 'placement', valid });
  overlay.showGroupPlacementGhost(objects.map((obj) => ({
    catalogId: obj.catalogId, x: obj.position.x, y: obj.position.y, rotation: obj.rotation, elevation: obj.elevation,
    ...(obj.spanLength ? { spanLength: obj.spanLength } : null),
  })), valid);
}

/** Says what `outcome` came to through `notify`, in `t`'s words. */
export function reportPaste(outcome: PasteOutcome, t: Translate, notify: (text: string, tone: NoticeTone) => void): void {
  for (const notice of pasteNotices(t, outcome)) notify(notice.text, notice.tone);
}
