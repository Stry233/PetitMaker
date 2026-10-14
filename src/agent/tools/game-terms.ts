/* The game's names and catalog facts the assistant's prompt and tool text read, each from its source:
 * zone words from the profile's `ZONES`, the anchor landmark by its catalog name and id, and the
 * bridges' span from their catalog traits. */
import { ANCHOR_LANDMARK, ZONES, type CellZone, type ZoneSpec } from '../../core/game/profile';
import { getCatalogItem } from '../../state/catalog';
import { bridgeSpanRange } from '../../tools/placement';

/** Every zone a map holds, buildable ones first and then the rest by id: the order the assistant
 *  reads them in. */
export const ZONE_ORDER: readonly CellZone[] = (Object.keys(ZONES).map(Number) as CellZone[])
  .sort((a, b) => Number(spec(b).buildable) - Number(spec(a).buildable) || a - b);

function spec(zone: CellZone): ZoneSpec {
  return (ZONES as Readonly<Record<number, ZoneSpec>>)[zone]!;
}

/** The English word for `zone`. */
export const zoneName = (zone: CellZone): string => spec(zone).name;

/** The buildable zones' words, as one phrase. */
export const BUILDABLE_ZONES: string = ZONE_ORDER.filter((z) => spec(z).buildable).map(zoneName).join(' or ');

/** The words of every zone that refuses edits, in reading order. */
export const UNBUILDABLE_ZONES: readonly string[] = ZONE_ORDER.filter((z) => !spec(z).buildable).map(zoneName);

/** `words` as an English list closed by `or`: `a, b or c`. */
export function orList(words: readonly string[]): string {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}

/** The anchor landmark as the assistant reads it, its English catalog name and its object id
 *  (`Neighbor Center (__plaza__)`), or undefined for a game without one. */
export function anchorTerm(): string | undefined {
  const item = ANCHOR_LANDMARK && getCatalogItem(ANCHOR_LANDMARK.id);
  return item ? `${item.name.en} (${item.id})` : undefined;
}

/** The fixed features a rejection names: locked objects, the anchor landmark and locked layers. */
export function fixedFeatures(): string {
  const anchor = anchorTerm();
  return anchor ? `Locked objects, the ${anchor} and locked layers` : 'Locked objects and locked layers';
}

/** The note a write's result carries on what it may not remove. */
export function lockedNote(): string {
  const anchor = anchorTerm();
  return anchor ? `Locked objects and the ${anchor} cannot be removed.` : 'Locked objects cannot be removed.';
}

/** The gap the catalog's bridges cross, as `min-max` cells. */
export function bridgeSpanText(): string {
  const span = bridgeSpanRange();
  return span ? `${span.min}-${span.max}` : '0';
}
