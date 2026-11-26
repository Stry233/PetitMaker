/*
 * What the map offers for an object or a selection, which the selection card, the map's menu, the
 * Delete key and the selection's commands all read: whether it turns, faces or flips, whether it can
 * be copied, picked, moved or deleted and whether Delete asks first.
 * The finger's menu actions start from the object they were opened on: each selects that object
 * alone first, as the selection card's actions act on the selection, and publishes one update.
 */
import type { PlacedGroup } from '../../core/model/placed-group';
import type { GridState, PlacedObject } from '../../core/model/types';
import { getCell } from '../../core/model/grid-model';
import { isLandmarkItem } from '../../core/model/landmarks';
import { getCatalogItem } from '../../state/catalog';
import { copyAllowed } from '../../state/clipboard';
import { modeOpenIn } from '../../state/editing/edit-mode';
import { selectedGroup } from '../../state/placed-groups';
import { selectedObjectIds, singleSelection, type BlockRef } from '../../state/selection';
import type { PlanetSession } from '../../state/slices/planet-session';
import { batchStore, useEditorStore, type EditorStore } from '../../state/store';
import type { DeleteMeaning } from '../../platform/input/back-stack';
import { translate } from '../../i18n/context';
import { isDraggableObject } from '../../view/interaction/selection-hover';
import { turnsInSession } from '../operations/planet-session';
import { pickedMaterial, pickSelection } from './pick-selection';
import { deleteObjectConfirmed, deleteSelection, rotateSelection } from './group-edit';

/** What a selection can do; locked objects (the plaza) and bare ground take no action. */
export interface SelectionTarget {
  key: string;
  plural: boolean;
  block: BlockRef | null;
  object: PlacedObject | null;
  rotatable: boolean;
  /** A facing is offered for it: one object that turns in place, which the planet session's plaza
   *  does not. */
  faceable: boolean;
  /** Flip is offered for it (BLUE-14): a placed blueprint selected whole, or two or more objects
   *  outside the planet editor; one object alone only turns. */
  flippable: boolean;
  deletable: boolean;
  pickable: boolean;
  /** Copy is offered for it (EDIT-53): two or more objects, or a placed blueprint selected whole,
   *  where copying is allowed at all (`state/clipboard.ts:copyAllowed`); one object alone is armed
   *  for placing again by Pick instead. */
  copyable: boolean;
  /** The planet session's plaza: it turns about its centre with its footprint swapped, so it has no facing. */
  sessionLandmark: boolean;
  /** Save as blueprint is offered for it: it holds an object other than a landmark, which a frame
   *  never captures, and Blueprint mode can open in this session. */
  blueprintable: boolean;
}

/** The session a selection stands in, as far as its abilities depend on it. */
interface SelectionSession { planet: PlanetSession | null; repairing: boolean; group?: PlacedGroup | null }

const NO_SESSION: SelectionSession = { planet: null, repairing: false };

/** The selection's abilities on `gs`, or null for a selection that can take none. `session` says
 *  which modes may open, for Save as blueprint. The map's menu asks it of its one object alone. */
export function selectionTarget(
  selection: readonly BlockRef[], gs: GridState | null, inSession: boolean, session: SelectionSession = NO_SESSION,
): SelectionTarget | null {
  const copyable = copyAllowed({ planetSession: inSession ? true : null, repairSession: session.repairing ? { phase: 'hand' } : null });
  // A placed blueprint selected whole is one target whatever it holds: objects, terrain or both.
  if (session.group) {
    return {
      key: `grp:${session.group.id}`, plural: true, block: null, object: null, rotatable: true, faceable: false, flippable: true, deletable: true,
      pickable: false, copyable, sessionLandmark: false, blueprintable: false,
    };
  }
  const plural = selection.length > 1;
  const blueprintable = !!gs && modeOpenIn(session.planet, 'blueprint', session.repairing)
    && selectedObjectIds(selection).some((id) => { const o = gs.objects.get(id); return !!o && !isLandmarkItem(o.catalogId); });
  if (plural) {
    return {
      key: `g:${selectedObjectIds(selection).join(',')}`, plural, block: null, object: null, rotatable: true, faceable: false, flippable: !inSession,
      deletable: true, pickable: false, copyable, sessionLandmark: false, blueprintable,
    };
  }
  const block = singleSelection(selection);
  if (!block || !gs) return null;
  const object = block.kind === 'object' ? gs.objects.get(block.id) ?? null : null;
  const item = object ? getCatalogItem(object.catalogId) : null;
  const terrain = block.kind === 'terrain' ? getCell(gs.cells, block.x, block.y)?.terrain ?? null : null;
  const sessionLandmark = turnsInSession(object, inSession);
  const rotatable = (!!item?.rotatable && !object?.locked) || sessionLandmark;
  const deletable = (!!object && !object.locked) || !!terrain;
  const pickable = pickedMaterial(gs, selection) !== null;
  if (!deletable && !pickable) return null;
  return {
    key: block.kind === 'object' ? block.id : `t:${block.x},${block.y}`, plural, block, object, rotatable, faceable: !!object && rotatable && !sessionLandmark,
    flippable: false, deletable, pickable, copyable: false, sessionLandmark, blueprintable,
  };
}

/** The live selection's abilities, as the selection card reads them. */
export function liveSelectionTarget(s: EditorStore): SelectionTarget | null {
  return selectionTarget(s.selection, s.gridState, s.planetSession !== null, {
    planet: s.planetSession, repairing: s.repairSession?.phase === 'hand', group: selectedGroup(s),
  });
}

/** What the map's menu offers on the block it was opened on. */
interface MenuTarget {
  /** The object the menu stands on; null on a cell. */
  object: PlacedObject | null;
  /** The object turns, so the menu offers its facings, or a finger's quarter turn. */
  rotatable: boolean;
  /** Pick is offered: the object is of an item that can be armed again. */
  pickable: boolean;
  /** The finger's Move is offered: the object can be dragged. */
  movable: boolean;
  /** Delete peels a layer: the cell holds terrain. */
  peelable: boolean;
}

/** The map menu's offers on `block` of the live map, or null where the object is gone; an object
 *  offers what the selection card would for it alone, and a cell off the map nothing to peel. */
export function menuTarget(block: BlockRef, s: Pick<EditorStore, 'gridState' | 'planetSession'>): MenuTarget | null {
  const gs = s.gridState;
  if (!gs) return null;
  if (block.kind === 'terrain') {
    return { object: null, rotatable: false, pickable: false, movable: false, peelable: !!getCell(gs.cells, block.x, block.y)?.terrain };
  }
  const object = gs.objects.get(block.id);
  if (!object) return null;
  const alone = selectionTarget([block], gs, s.planetSession !== null);
  return { object, rotatable: !!alone?.rotatable, pickable: !!alone?.pickable, movable: isDraggableObject(object), peelable: false };
}

/** Whether `refs` holds objects only, every one of them locked, which no Delete removes. */
function lockedOnly(gs: GridState | null, refs: readonly BlockRef[]): boolean {
  return !!gs && refs.length > 0 && refs.every((r) => r.kind === 'object' && gs.objects.get(r.id)?.locked === true);
}

/** What Delete does to the map's selection, by its key, on the selection card and in the map's menu:
 *  a placed blueprint selected whole and several blocks go at once, as one undo step
 *  (`deleteSelection`), and a selection of locked objects only is refused at once with the lock's
 *  message, asking nothing; one other block asks first, through the delete question; a cell of open
 *  ground or no selection takes nothing. */
export function selectionDeleteMeaning(s: EditorStore): DeleteMeaning {
  if (s.selection.length > 1 || selectedGroup(s) || lockedOnly(s.gridState, s.selection)) {
    return () => { deleteSelection(translate, selectedObjectIds(useEditorStore.getState().selection)); };
  }
  const one = singleSelection(s.selection);
  if (!one || (one.kind === 'terrain' && !s.gridState?.cells[one.y]?.[one.x]?.terrain)) return null;
  return () => useEditorStore.getState().setDeletePopover(one);
}

/** The selection card's Delete: what Delete means on the selection (`selectionDeleteMeaning`), and
 *  a press while the delete question stands closes it. */
export function pressSelectionDelete(): void {
  const s = useEditorStore.getState();
  if (s.deletePopover) s.setDeletePopover(null);
  else {
    const meaning = selectionDeleteMeaning(s);
    if (typeof meaning === 'function') meaning();
  }
}

const selectAlone = (id: string): void => useEditorStore.getState().setSelection([{ kind: 'object', id }]);

/** The map menu's Delete on object `id`, the menu being the choice: it goes at once, and a locked
 *  object, selected alone as every menu action selects it, is refused as `selectionDeleteMeaning` refuses it. */
export function deleteMenuObject(id: string): void {
  if (!useEditorStore.getState().gridState?.objects.get(id)?.locked) {
    deleteObjectConfirmed(translate, id);
    return;
  }
  batchStore(() => {
    selectAlone(id);
    const meaning = selectionDeleteMeaning(useEditorStore.getState());
    if (typeof meaning === 'function') meaning();
  });
}

/** Arms what object `id` is made of, as Pick on the selection card does. */
export function pickObject(id: string): void {
  batchStore(() => {
    selectAlone(id);
    pickSelection();
  });
}

/** Turns object `id` a quarter clockwise, as Rotate on the selection card does; the menu it is
 *  pressed on stands for the next turn. */
export function turnObjectQuarter(id: string): void {
  useEditorStore.getState().keepSurfacesThrough(() => batchStore(() => {
    selectAlone(id);
    rotateSelection(90);
  }));
}

/** Selects object `id` and latches the next one-finger drag to move it, wherever the drag starts. */
export function latchMove(id: string): void {
  batchStore(() => {
    selectAlone(id);
    useEditorStore.getState().setMoveLatched(true);
  });
}

/** Selects object `id` and latches multi-select, so taps add and remove and a drag bands. */
export function latchMultiSelect(id: string): void {
  batchStore(() => {
    selectAlone(id);
    useEditorStore.getState().setMultiSelectLatched(true);
  });
}
