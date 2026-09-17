import { protectedImageNotes } from '../../core/provenance/image-attribution';
// src/io/share/export.ts — build the visible share-code band for a state (the ONLY carrier).
import type { GridState } from '../../core/model/types';
import type { MapProvenanceSummary } from '../../core/provenance/types';
import { encodeMapPayload, type ShareCodeMeta } from './codec/payload';
import { encodeGlyph } from './glyph/encode';
import { moduleBaseFor } from './glyph/geometry';
import type { GlyphPlan, GlyphProfile } from './glyph/profiles';
import { ShareError } from './errors';

export interface ShareCode {
  rgba: Uint8Array;
  width: number;
  height: number;
  profile: GlyphProfile;
  plan: GlyphPlan;
  payloadLen: number;
  shareOriginalRecommended: boolean;
  /** The title and description did not fit beside the map in the densest profile and were left out. */
  notesOmitted: boolean;
}

/** Render the share-code band at the module base for a composition width. */
export async function buildShareCode(
  state: GridState,
  summary: MapProvenanceSummary | null,
  meta: ShareCodeMeta,
  compositionWidth: number,
): Promise<ShareCode | null> {
  const mb = moduleBaseFor(compositionWidth);
  if (mb === null) return null; // composition too small for a robust code
  let payload = await encodeMapPayload(state, summary, meta);
  let g = encodeGlyph(payload, mb);
  let notesOmitted = false;
  // The map itself outranks its notes: a code that only fits without them still carries the map.
  if (!g && state.notes && !protectedImageNotes(state)) {
    payload = await encodeMapPayload({ ...state, notes: undefined }, summary, meta);
    g = encodeGlyph(payload, mb);
    notesOmitted = true;
  }
  if (!g) throw new ShareError('decode-failed', 'Map payload exceeds the densest PetitGlyph profile.');
  return { ...g, payloadLen: payload.length, shareOriginalRecommended: g.profile.div > 4, notesOmitted };
}
