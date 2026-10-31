/*
 * A copied arrangement as clipboard text, and back. The text is JSON that names itself, so a paste
 * can tell a copy from the editor apart from any other text; what comes back is untrusted and is
 * checked field by field before an arrangement is built from it (EDIT-62).
 *
 * Wire shape, version 1 (append-only; a breaking change takes version 2):
 *   { "petitmaker": "objects", "v": 1,
 *     "members": [{ "id": <catalog id>, "x", "y", "r": 0|90|180|270, "z": <rise>, "span"?, "corners"? }],
 *     "at"?: { "x", "y" } }
 * `at` is where the outline's top-left stood on the map it was copied from.
 */
import { CORNER_TRIMS, ROTATIONS, type CornerTrim, type Corners, type MacroCoord, type Rotation } from '../../core/model/types';
import { ELEVATION_MAX } from '../../core/game/profile';
import { currentCatalogId } from '../../config/catalog/retired-ids';
import { getCatalogItem } from '../../state/catalog';
import type { Arrangement, CopiedMember } from '../../state/clipboard';
import { arrangementOf } from '../../tools/objects';

const MARK = 'objects';
const VERSION = 1;
/** The most members a pasted copy may hold: more than any planet can stand, so a real copy always
 *  fits and a hostile one cannot make the editor plan without end. */
const MAX_MEMBERS = 4096;
/** The widest offset a member may sit at, in placement cells. */
const MAX_OFFSET = 1024;
const MAX_SPAN = 64;

interface WireMember { id: string; x: number; y: number; r: Rotation; z: number; span?: number; corners?: CornerTrim[] }

/** The clipboard text for `a`. */
export function encodeArrangement(a: Arrangement): string {
  const members = a.members.map((m): WireMember => ({
    id: m.catalogId, x: m.x, y: m.y, r: m.rotation, z: m.rise,
    ...(m.spanLength ? { span: m.spanLength } : null),
    ...(m.corners ? { corners: [...m.corners] } : null),
  }));
  return JSON.stringify({ petitmaker: MARK, v: VERSION, members, ...(a.origin ? { at: { x: a.origin.x, y: a.origin.y } } : null) });
}

/** What reading clipboard text came to. `not-a-copy`: the text is not from the editor and a paste
 *  ignores it. `future`: a newer release wrote it. `ok`: the arrangement, with the members naming
 *  an item this release does not know left out and counted. */
export type DecodedCopy =
  | { kind: 'not-a-copy' }
  | { kind: 'future' }
  | { kind: 'malformed' }
  | { kind: 'ok'; arrangement: Arrangement | null; unknown: number };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A coordinate on the half-cell grid within reach. */
const isOffset = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_OFFSET && Number.isInteger(v * 2);
const isRise = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= ELEVATION_MAX;
const isCorners = (v: unknown): v is Corners =>
  Array.isArray(v) && v.length === 4 && v.every((t) => (CORNER_TRIMS as readonly unknown[]).includes(t));

/** The wire's `at` as a map cell, or null when it is malformed. */
function readOrigin(v: unknown): MacroCoord | null {
  if (!isRecord(v) || !Number.isInteger(v.x) || !Number.isInteger(v.y)) return null;
  const x = v.x as number, y = v.y as number;
  return x >= 0 && y >= 0 && x <= MAX_OFFSET && y <= MAX_OFFSET ? { x, y } : null;
}

/** One wire member as a copied member, or null when any field is malformed. */
function readMember(v: unknown): CopiedMember | null {
  if (!isRecord(v) || typeof v.id !== 'string' || v.id.length === 0 || v.id.length > 128) return null;
  if (!isOffset(v.x) || !isOffset(v.y) || !isRise(v.z)) return null;
  if (!(ROTATIONS as readonly unknown[]).includes(v.r)) return null;
  if (v.span !== undefined && !(Number.isInteger(v.span) && (v.span as number) > 0 && (v.span as number) <= MAX_SPAN)) return null;
  if (v.corners !== undefined && !isCorners(v.corners)) return null;
  return {
    catalogId: currentCatalogId(v.id), x: v.x, y: v.y, rotation: v.r as Rotation, rise: v.z,
    ...(v.span !== undefined ? { spanLength: v.span as number } : null),
    ...(v.corners !== undefined ? { corners: [...v.corners] as Corners } : null),
  };
}

/** Reads clipboard `text`. A copy whose envelope or any member is malformed is refused whole, since
 *  a partial arrangement is not what was copied. */
export function decodeArrangement(text: string): DecodedCopy {
  if (!text.trimStart().startsWith('{')) return { kind: 'not-a-copy' };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { kind: 'not-a-copy' }; }
  if (!isRecord(raw) || raw.petitmaker !== MARK) return { kind: 'not-a-copy' };
  if (typeof raw.v === 'number' && Number.isInteger(raw.v) && raw.v > VERSION) return { kind: 'future' };
  if (raw.v !== VERSION || !Array.isArray(raw.members) || raw.members.length > MAX_MEMBERS) return { kind: 'malformed' };
  const members: CopiedMember[] = [];
  for (const entry of raw.members) {
    const member = readMember(entry);
    if (!member) return { kind: 'malformed' };
    members.push(member);
  }
  const origin = raw.at === undefined ? undefined : readOrigin(raw.at);
  if (origin === null) return { kind: 'malformed' };
  const known = members.filter((m) => getCatalogItem(m.catalogId));
  // The outline is the members' own, never the text's: a forged size could only mislead the grab.
  return { kind: 'ok', arrangement: arrangementOf(known, origin), unknown: members.length - known.length };
}
