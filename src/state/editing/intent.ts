/**
 * What the map's next press and the selection keys are for, and when an update moves on from it.
 *
 * The one seam that ends a selection the user has left behind (EDIT-25): every store writer of a
 * fact read here (`slices/edit.ts:editModeFields` and `setSelectingRegion`,
 * `slices/blueprint.ts:setArmedBlueprint`) asks `movesOn` and puts the selection down in the same
 * update, so a new way to arm or to start a step ends it without a caller of its own. A headless
 * world (`editor/sandbox/demo-world.ts`) resolves its own arming into a `Purpose` and runs the same
 * rules (`purposeMovesOn`, `rearmFields`, `selectionWrite`).
 */
import { activeToolOf, armedItemOf, armedMacroOf, armedPicksOf, holdsSelection, isBrushTool, type EditModeInputs } from './edit-mode';
import type { ToolType } from './vocabulary';
import { shownOn, type BlockRef } from '../selection';
import { explorerUnfolded, type BlueprintStep } from '../slices/blueprint';
import type { GridState, MacroCoord } from '../../core/model/types';
import { mapRevisionOf } from '../../core/model/grid-model';
import type { EditorStore } from '../store';

/** The store facts a purpose is read from. */
interface IntentFacts {
  readonly editMode: EditModeInputs;
  readonly blueprint: { readonly armed: string | null };
  readonly selectingRegion: boolean;
  readonly regionSelectionOwner: string | null;
  readonly blueprintStep: BlueprintStep;
  readonly carrying: string | null;
}

/** What the next press is for, resolved: the tool up, the items armed in pick order, the blueprint
 *  a press places, the surface whose region brush paints, the card carried to the map and the
 *  unfolded explorer, whose own selection takes the map's place. */
export interface Purpose {
  readonly tool: ToolType;
  readonly picks: readonly string[];
  /** Blueprint mode's armed blueprint; null for none. */
  readonly blueprint: string | null;
  /** The surface whose region brush paints, or null while none does. */
  readonly painting: string | null;
  /** The card or blueprint a carry under way holds; null for none. */
  readonly carrying: string | null;
  /** The id of Blueprint's explorer step while it stands unfolded; null otherwise. */
  readonly explorer: number | null;
}

/** What is armed, resolved: the purpose with the mode, the armed item and the armed macro. */
export interface ArmedFacts extends Purpose {
  readonly mode: string | null;
  readonly armedItem: string | null;
  readonly armedMacro: string | null;
}

const blueprintArmedIn = (s: Pick<IntentFacts, 'editMode' | 'blueprint'>): boolean =>
  s.editMode.mode === 'blueprint' && s.blueprint.armed !== null;

/** The purpose the store's facts hold. */
export function purposeOf(s: IntentFacts): Purpose {
  return {
    tool: activeToolOf(s),
    picks: armedPicksOf(s),
    blueprint: blueprintArmedIn(s) ? s.blueprint.armed : null,
    painting: s.selectingRegion ? String(s.regionSelectionOwner) : null,
    carrying: s.carrying,
    explorer: explorerUnfolded(s.blueprintStep) ? s.blueprintStep.id : null,
  };
}

/** What the store's facts hold armed. */
export function armedFactsOf(s: IntentFacts): ArmedFacts {
  return { ...purposeOf(s), mode: s.editMode.mode, armedItem: armedItemOf(s), armedMacro: armedMacroOf(s) };
}

/** What the next press does, as one comparable key, or null where it selects: a region or frame
 *  step, a carry, the unfolded explorer, Blueprint mode's armed blueprint, the armed items in pick
 *  order, or a tool that holds no selection. A new kind of purpose is a case here. */
function intentOf(p: Purpose): string | null {
  if (p.painting !== null) return `region:${p.painting}`;
  if (p.carrying !== null) return `carry:${p.carrying}`;
  if (p.explorer !== null) return `explorer:${p.explorer}`;
  if (p.blueprint !== null) return `blueprint:${p.blueprint}`;
  if (p.picks.length > 0) return `items:${p.picks.join(',')}`;
  return holdsSelection(p.tool) ? null : `tool:${p.tool}`;
}

/** Whether `next` takes up a purpose `prev` did not have. Putting one down (Escape, Done, a placed
 *  blueprint) is no move: a selection made under it stands. */
export function movesOn(prev: IntentFacts, next: IntentFacts): boolean {
  return purposeMovesOn(purposeOf(prev), purposeOf(next));
}

/** `movesOn` over resolved purposes. */
export function purposeMovesOn(prev: Purpose, next: Purpose): boolean {
  const intent = intentOf(next);
  return intent !== null && intent !== intentOf(prev);
}

/** Whether a press places what is armed: an item card, or Blueprint mode's armed blueprint. */
export function placesArmed(s: Pick<IntentFacts, 'editMode' | 'blueprint'>): boolean {
  return blueprintArmedIn(s) || armedPicksOf(s).length > 0;
}

/** Puts down what a press would place (`placesArmed`), as a Ctrl selection that catches something does. */
export function putArmedDown(s: Pick<EditorStore, 'editMode' | 'blueprint' | 'setEditMode' | 'setArmedBlueprint'>): void {
  if (blueprintArmedIn(s)) s.setArmedBlueprint(null);
  else if (armedPicksOf(s).length > 0) s.setEditMode({ arm: { kind: 'none' } });
}

/** The transient surfaces whose subject may be the selection: the delete question and the map's menu. */
export interface SelectionSurfaces {
  readonly deletePopover: BlockRef | null;
  readonly contextMenu: { readonly target: BlockRef } | null;
}

/** What a map surface stands over, read as it opens: the live map, its edit revision, and the mode
 *  with what the next press is for. */
export interface SurfaceTicket {
  readonly map: GridState | null;
  readonly revision: string;
  readonly intent: string;
}

/** The facts a map surface's ticket and target are read from. */
interface SurfaceFacts extends IntentFacts {
  readonly gridState: GridState | null;
  readonly layerVisibility: Record<number, boolean>;
  readonly deletePopover: BlockRef | null;
  readonly deletePopoverOpened: SurfaceTicket | null;
  readonly contextMenu: { readonly target: BlockRef; readonly opened?: SurfaceTicket } | null;
}

const intentKey = (s: IntentFacts): string => `${s.editMode.mode}|${intentOf(purposeOf(s))}`;

/** The ticket a map surface opening now takes. */
export function surfaceTicket(s: IntentFacts & { readonly gridState: GridState | null }): SurfaceTicket {
  return { map: s.gridState, revision: mapRevisionOf(s.gridState), intent: intentKey(s) };
}

/** Whether a surface opened on `target` with `ticket` still stands over `s`: the same map at the same
 *  revision under the same mode and purpose, holding the target on a shown floor (a cell holding
 *  terrain, where `terrain` asks for it). A surface written with no ticket is judged by its target alone. */
function surfaceStands(s: SurfaceFacts, target: BlockRef, ticket: SurfaceTicket | null | undefined, terrain: boolean): boolean {
  const map = s.gridState;
  if (!map) return false;
  if (ticket && (ticket.map !== map || ticket.revision !== mapRevisionOf(map) || ticket.intent !== intentKey(s))) return false;
  if (!shownOn(s)(target)) return false;
  if (target.kind === 'object') return map.objects.has(target.id);
  const cell = map.cells[target.y]?.[target.x];
  return !!cell && (!terrain || !!cell.terrain);
}

/** The writes that close the delete question and the map's menu where they no longer stand
 *  (`surfaceStands`); only the fields that change. The one closer of both: a writer that moves on
 *  changes the purpose their ticket holds. */
export function staleSurfaceFields(s: SurfaceFacts): { deletePopover?: null; contextMenu?: null } {
  const question = s.deletePopover && !surfaceStands(s, s.deletePopover, s.deletePopoverOpened, true);
  const menu = s.contextMenu && !surfaceStands(s, s.contextMenu.target, s.contextMenu.opened, false);
  return { ...(question ? { deletePopover: null } : null), ...(menu ? { contextMenu: null } : null) };
}

/** What the selection's state holds: the selection, the picked block and the touch latches, which
 *  ending it puts down together. */
export interface Left {
  readonly selection: readonly BlockRef[];
  readonly pickedCell: MacroCoord | null;
  readonly multiSelectLatched: boolean;
  readonly moveLatched: boolean;
}

/** The fields of `Left`, the one list of what ending a selection puts down. */
const HELD: readonly (keyof Left)[] = ['selection', 'pickedCell', 'multiSelectLatched', 'moveLatched'];

/** Whether `s` holds anything ending a selection puts down. */
export function selectionHeld(s: Left): boolean {
  return s.selection.length > 0 || s.pickedCell !== null || s.multiSelectLatched || s.moveLatched;
}

/** What `s` holds of a selection, as one comparable key, or null while it holds nothing. */
export function selectionKey(s: Left): string | null {
  return selectionHeld(s) ? JSON.stringify(HELD.map((field) => s[field])) : null;
}

/** The writes that end a selection (`leftBehindFields`). */
export interface LeftBehind {
  selection?: BlockRef[];
  pickedCell?: null;
  multiSelectLatched?: false;
  moveLatched?: false;
}

/** The writes that put down what `s` holds of a selection (`selectionHeld`), as moving on, a clear
 *  and a mode leaving a placement it owns do; only the fields that change. */
export function leftBehindFields(s: Left): LeftBehind {
  return {
    ...(s.selection.length > 0 ? { selection: [] } : null),
    ...(s.pickedCell ? { pickedCell: null } : null),
    ...(s.multiSelectLatched || s.moveLatched ? { multiSelectLatched: false, moveLatched: false } : null),
  };
}

/** The writes a change of arming from `prev` to `next` makes to what `held` holds: one that moves on
 *  (`purposeMovesOn`) or arms a tool that cannot hold a selection puts the selection down
 *  (`leftBehindFields`); any change of mode, tool or item, or moving on, ends the touch latches; and
 *  that or a change of macro drops the picked block. */
export function rearmFields(held: Left, prev: ArmedFacts, next: ArmedFacts): LeftBehind {
  const movedOn = purposeMovesOn(prev, next);
  const drops = held.selection.length > 0 && (movedOn || !holdsSelection(next.tool));
  const rearmed = next.mode !== prev.mode || next.tool !== prev.tool || next.armedItem !== prev.armedItem || movedOn;
  return {
    ...(drops ? leftBehindFields(held) : null),
    ...((rearmed || next.armedMacro !== prev.armedMacro) && held.pickedCell ? { pickedCell: null } : null),
    ...(rearmed && (held.multiSelectLatched || held.moveLatched) ? { multiSelectLatched: false, moveLatched: false } : null),
  };
}

/** The facts a selection write is admitted against. */
interface WriteFacts {
  readonly gridState: GridState | null;
  readonly layerVisibility: Record<number, boolean>;
  readonly pickedCell: MacroCoord | null;
  readonly moveLatched: boolean;
}

/** What writing `requested` under `tool` lands, or null where the write is dropped. On a map that
 *  limits presses (`GridState.unsettled`) only those objects are kept, and nothing on a hidden floor
 *  is. Any write spends the move latch and drops the picked block. A selection stands only under a
 *  tool that holds one (`edit-mode.ts:holdsSelection`): written while a terrain brush is up, it puts
 *  the brush away for the Hand tool in the same update (`brushAway`); under any other such tool the
 *  write is dropped. */
export function selectionWrite(s: WriteFacts, tool: ToolType, requested: readonly BlockRef[]):
{ fields: { selection: BlockRef[]; moveLatched?: false; pickedCell?: null }; brushAway: boolean } | null {
  const unsettled = s.gridState?.unsettled;
  const settled = unsettled ? requested.filter((r) => r.kind === 'object' && unsettled.has(r.id)) : [...requested];
  const shown = shownOn(s);
  const selection = settled.some((r) => !shown(r)) ? settled.filter(shown) : settled;
  const fields = { selection, ...(s.moveLatched ? { moveLatched: false as const } : null), ...(s.pickedCell ? { pickedCell: null } : null) };
  if (selection.length === 0 || holdsSelection(tool)) return { fields, brushAway: false };
  return isBrushTool(tool) ? { fields, brushAway: true } : null;
}
