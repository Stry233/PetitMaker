/**
 * What Copy holds: an arrangement of objects with no map under it. Positions are relative to the
 * arrangement's outline and heights to its lowest member, so it can stand anywhere the ground keeps
 * those differences. The store keeps the page's one copy (`slices/edit.ts:clipboard`); the
 * system-clipboard text is `io/clipboard/payload.ts`'s.
 */
import type { Corners, MacroCoord, Rotation } from '../core/model/types';

/** One copied object. */
export interface CopiedMember {
  catalogId: string;
  /** The anchor (top-left) relative to the outline's top-left, in placement cells; a half for an
   *  item that stands on half cells. */
  x: number;
  y: number;
  rotation: Rotation;
  /** Layers above the arrangement's lowest member. */
  rise: number;
  spanLength?: number;
  corners?: Corners;
}

/** A copied arrangement: its members, the whole cells its outline covers and where it was copied. */
export interface Arrangement {
  members: readonly CopiedMember[];
  w: number;
  h: number;
  /** The outline's top-left on the map it was copied from, in placement cells, which the paste key
   *  places the copy nearest to (EDIT-54); absent from a copy an older release wrote. */
  origin?: MacroCoord;
}

/** What `copyAllowed` reads: the sessions that withhold copy and paste, and the copy itself. */
interface CopyReads {
  planetSession: unknown;
  repairSession: { phase: string } | null;
  clipboard: Arrangement | null;
}

/** Whether copy and paste are offered at all: not in the planet editor or a hand repair (EDIT-63). */
export function copyAllowed(s: Omit<CopyReads, 'clipboard'>): boolean {
  return s.planetSession === null && s.repairSession?.phase !== 'hand';
}

/** Whether a paste is offered: copying is allowed and something is copied (EDIT-56). */
export function pasteOffered(s: CopyReads): boolean {
  return copyAllowed(s) && s.clipboard !== null;
}
