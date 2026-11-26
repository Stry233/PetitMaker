/**
 * A map carried in a link to the app's own page: the share code's payload, base64url-encoded into one
 * query parameter. The payload is already entropy coded (deflate saves under 4 % across the share
 * corpus), so the text runs four thirds of the payload's bytes: about 200 characters for an empty
 * planet, 2,300 to 4,400 for a generated one and up to 6,000 for a dense hand-built one.
 */
import { base64ToBytes, bytesToBase64 } from '../../core/base/bytes';
import { protectedImageNotes } from '../../state/notes-attribution';
import type { MapProvenanceSummary } from '../../core/provenance/types';
import type { ExportableState } from '../save/exportable-state';
import { encodeMapPayload, type ShareCodeMeta } from './codec/payload';

/** The query parameter that carries the map. */
const MAP_LINK_PARAM = 'map';

/** The longest page path, query included, a map travels in: RFC 9110's recommended minimum for a
 *  request line, which every measured real map stays under. */
const MAX_MAP_LINK_PATH = 8000;

/** The payload `code` spells, or null for text that is not base64url or runs past any link. */
export function decodeMapLinkCode(code: string): Uint8Array | null {
  if (!code || code.length > MAX_MAP_LINK_PATH || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  try {
    return base64ToBytes(code);
  } catch {
    return null;
  }
}

/** The path of `page` carrying `payload`, or null where it would run past `MAX_MAP_LINK_PATH`. */
function mapLinkPath(page: string, payload: Uint8Array): string | null {
  const path = `${page}?${MAP_LINK_PARAM}=${bytesToBase64(payload, { url: true })}`;
  return path.length <= MAX_MAP_LINK_PATH ? path : null;
}

/** The path of `page` carrying `state`, its title and description left out where only they keep it
 *  from fitting, as a share code leaves them out; null where the map is too large for a link. */
export async function mapLinkFor(page: string, state: ExportableState, summary: MapProvenanceSummary | null, meta: ShareCodeMeta): Promise<string | null> {
  const path = mapLinkPath(page, await encodeMapPayload(state, summary, meta));
  if (path || !state.notes || protectedImageNotes(state)) return path;
  return mapLinkPath(page, await encodeMapPayload({ ...state, notes: undefined }, summary, meta));
}

/** The map code a page's query string carries, or null. */
export function mapLinkCode(search: string): string | null {
  return new URLSearchParams(search).get(MAP_LINK_PARAM);
}

/** `search` without the map parameter, `?` included where anything is left. */
export function withoutMapLink(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(MAP_LINK_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
