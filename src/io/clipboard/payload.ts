/*
 * A copied arrangement as clipboard text, and back. The text is JSON that names itself, so a paste
 * can tell a copy from the editor apart from any other text; what comes back is untrusted and is
 * checked field by field before an arrangement is built from it (EDIT-62).
 *
 * Wire shape (append-only; `v` is the oldest version that reads the text, so a copy of objects stays
 * version 1 and an older release still pastes it):
 *   { "petitmaker": "objects", "v": 1 | 2,
 *     "members": [{ "id": <catalog id>, "x", "y", "r": 0|90|180|270, "z": <rise>, "span"?, "corners"? }],
 *     "at"?: { "x", "y" },
 *     "group"?: { "blueprint": <id>, "name", "origin": <name> | null, "base", "w", "h", "cells" } }
 * `at` is where the outline's top-left stood on the map it was copied from. `group`, from version 2,
 * marks a placed blueprint copied whole: its frame is `w` by `h`, `cells` are its terrain cells as a
 * blueprint file writes a body's, `base` the layer its rises stood on, and members stand relative to
 * the frame's top-left with rises over that layer.
 */
import type { CornerTrim, Corners, MacroCoord, Rotation } from '../../core/model/types';
import { clampText } from '../../core/base/text';
import { isRecord, isValidId } from '../../core/base/guards';
import { currentCatalogId } from '../../config/catalog/retired-ids';
import { getCatalogItem } from '../../state/catalog';
import type { Arrangement, CopiedGroup, CopiedMember } from '../../state/clipboard';
import { arrangementOf } from '../../tools/objects';
import { admitBlueprintBody } from '../blueprint/codec';
import { isValidCorners, isValidElevation, isValidRotation } from '../save/admission';
import { BLUEPRINT_NAME_MAX } from '../blueprint/facts';

const MARK = 'objects';
/** The newest version this release reads; version 2 adds `group`. */
const VERSION = 2;
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
  const g = a.group;
  const group = g ? { blueprint: g.seed.blueprint, name: g.seed.name, origin: g.seed.origin, base: g.base, w: a.w, h: a.h, cells: g.cells } : null;
  return JSON.stringify({
    petitmaker: MARK, v: group ? 2 : 1, members, ...(a.origin ? { at: { x: a.origin.x, y: a.origin.y } } : null), ...(group ? { group } : null),
  });
}

/** What reading clipboard text came to. `not-a-copy`: the text is not from the editor and a paste
 *  ignores it. `future`: a newer release wrote it. `ok`: the arrangement, with the members naming
 *  an item this release does not know left out and counted. */
type DecodedCopy =
  | { kind: 'not-a-copy' }
  | { kind: 'future' }
  | { kind: 'malformed' }
  | { kind: 'ok'; arrangement: Arrangement | null; unknown: number };

/** A coordinate on the half-cell grid within reach. */
const isOffset = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_OFFSET && Number.isInteger(v * 2);

/** The wire's `at` as a map cell, or null when it is malformed. */
function readOrigin(v: unknown): MacroCoord | null {
  if (!isRecord(v) || !Number.isInteger(v.x) || !Number.isInteger(v.y)) return null;
  const x = v.x as number, y = v.y as number;
  return x >= 0 && y >= 0 && x <= MAX_OFFSET && y <= MAX_OFFSET ? { x, y } : null;
}

/** One wire member as a copied member, or null when any field is malformed. */
function readMember(v: unknown): CopiedMember | null {
  if (!isRecord(v) || typeof v.id !== 'string' || v.id.length === 0 || v.id.length > 128) return null;
  if (!isOffset(v.x) || !isOffset(v.y) || !isValidElevation(v.z) || !isValidRotation(v.r)) return null;
  if (v.span !== undefined && !(Number.isInteger(v.span) && (v.span as number) > 0 && (v.span as number) <= MAX_SPAN)) return null;
  if (v.corners !== undefined && !isValidCorners(v.corners)) return null;
  return {
    catalogId: currentCatalogId(v.id), x: v.x, y: v.y, rotation: v.r, rise: v.z,
    ...(v.span !== undefined ? { spanLength: v.span as number } : null),
    ...(v.corners !== undefined ? { corners: [...v.corners] as Corners } : null),
  };
}

/** The wire's `group` as a copied group and its frame, or null when any part is malformed: its
 *  frame and cells by a blueprint file's rules, its names as a map file admits a group's. */
function readGroup(v: unknown): { group: CopiedGroup; w: number; h: number } | null {
  if (!isRecord(v) || !isValidId(v.blueprint) || !isValidElevation(v.base)) return null;
  const name = clampText(v.name, BLUEPRINT_NAME_MAX);
  if (name === null || (v.origin !== null && typeof v.origin !== 'string')) return null;
  const body = admitBlueprintBody({ w: v.w, h: v.h, cells: v.cells, objects: [] });
  if (!body) return null;
  const seed = { blueprint: v.blueprint, name, origin: v.origin === null ? null : clampText(v.origin, BLUEPRINT_NAME_MAX) };
  return { group: { cells: body.cells, base: v.base, seed }, w: body.w, h: body.h };
}

/** Reads clipboard `text`. A copy whose envelope, any member or its group is malformed is refused
 *  whole, since a partial arrangement is not what was copied. */
export function decodeArrangement(text: string): DecodedCopy {
  if (!text.trimStart().startsWith('{')) return { kind: 'not-a-copy' };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { kind: 'not-a-copy' }; }
  if (!isRecord(raw) || raw.petitmaker !== MARK) return { kind: 'not-a-copy' };
  if (typeof raw.v === 'number' && Number.isInteger(raw.v) && raw.v > VERSION) return { kind: 'future' };
  if ((raw.v !== 1 && raw.v !== 2) || !Array.isArray(raw.members) || raw.members.length > MAX_MEMBERS) return { kind: 'malformed' };
  const members: CopiedMember[] = [];
  for (const entry of raw.members) {
    const member = readMember(entry);
    if (!member) return { kind: 'malformed' };
    members.push(member);
  }
  const origin = raw.at === undefined ? undefined : readOrigin(raw.at);
  if (origin === null) return { kind: 'malformed' };
  const group = raw.v >= 2 && raw.group !== undefined ? readGroup(raw.group) : undefined;
  if (group === null) return { kind: 'malformed' };
  const known = members.filter((m) => getCatalogItem(m.catalogId));
  const unknown = members.length - known.length;
  // A placed blueprint keeps its members where its frame holds them.
  if (group) return { kind: 'ok', arrangement: { members: known, w: group.w, h: group.h, ...(origin ? { origin } : null), group: group.group }, unknown };
  // The outline is the members' own, never the text's: a forged size could only mislead the grab.
  return { kind: 'ok', arrangement: arrangementOf(known, origin), unknown };
}
