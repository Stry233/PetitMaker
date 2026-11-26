/** What each folder of the library lets the player do and whether it is one of the player's own, by
 *  its role (`io/blueprint/format.ts:BuiltInFolder`); a folder named as typed is the player's own and
 *  allows everything. What a blueprint or a selection of them offers stands beside it. */
import { builtInFolderOf, type BuiltInFolder } from '../../../io/blueprint';
import { SUPPORTS_JSON_FILES } from '../../../platform/build/edition';
import { shownBlueprints } from './names';

/** What a folder's own menu may do to it, in the menu's order. */
export type FolderVerb = 'rename' | 'export' | 'delete';

interface FolderTraits { readonly rename: boolean; readonly delete: boolean; readonly own: boolean }

const ROLES: Record<BuiltInFolder['role'], FolderTraits> = {
  examples: { rename: true, delete: false, own: false },
  mine: { rename: false, delete: false, own: true },
  author: { rename: true, delete: true, own: false },
};

const TYPED: FolderTraits = { rename: true, delete: true, own: true };

const traitsOf = (folder: string): FolderTraits => {
  const builtIn = builtInFolderOf(folder);
  return builtIn ? ROLES[builtIn.role] : TYPED;
};

/** What folder `folder` lets the player do to it, in its menu's order: Export only where the edition
 *  writes files and the folder holds a blueprint. */
export function blueprintFolderVerbs(folder: string): readonly FolderVerb[] {
  const traits = traitsOf(folder);
  const exports = SUPPORTS_JSON_FILES && shownBlueprints().some((r) => r.folder === folder);
  return [...(traits.rename ? ['rename' as const] : []), ...(exports ? ['export' as const] : []), ...(traits.delete ? ['delete' as const] : [])];
}

/** What the menu of one blueprint or of a selection may do to them, in the menu's order. */
export type BlueprintVerb = 'rename' | 'move' | 'export' | 'delete';

/** What the menu of `count` blueprints offers, in its order: Rename for one alone, and Export only
 *  where the edition writes files. */
export function blueprintVerbs(count: number): readonly BlueprintVerb[] {
  return [...(count === 1 ? ['rename' as const] : []), 'move', ...(SUPPORTS_JSON_FILES ? ['export' as const] : []), 'delete'];
}

/** Whether folder `folder` holds the player's own blueprints, where a save goes when it is open:
 *  My Blueprints and every folder named as typed, never the examples or an author's. */
export function holdsOwnBlueprints(folder: string): boolean {
  return traitsOf(folder).own;
}
