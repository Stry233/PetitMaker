/*
 * What a pointer press means.
 *
 * One pure function over plain facts, returning what the press does, what a tap then does, and what
 * a drag then does. The pointer machine executes the plan; the hover path derives its cursor flags
 * from the same plan. Two readers, one rule, so a cursor can never promise something the press does
 * not do.
 *
 * The order of the decisions IS the rule: the pan-drag key, then the region brush, then one branch
 * covering both the multi-select gesture and ordinary selection (they are disjoint on whether an
 * item is armed), then an armed item's select-instead-of-place, then the tool. Each step returns,
 * so an earlier one always wins.
 */
import { ToolType, type BlockRef, type MacroCoord } from '../model/types';
import { PRIMARY_BUTTON } from './pointer-buttons';
import { inSelectMode, isBrushTool } from './tool-modes';

/** Who applies a pan: the pointer machine's own camera gestures, or the view's tool path. */
export type PanBy = 'machine' | 'tool';

/**
 * Which gesture asked for the pan. The machine holds the two apart: a pan-key pan applies on any
 * move it sees, while a left-drag pan applies only while the primary button is still reported down
 * (a release outside the window never reaches the handler that would clear the flag).
 */
export type PanSource = 'pan-key' | 'left-drag';

export type PressIntent =
  | { kind: 'pan-camera'; by: PanBy; source: PanSource }
  | { kind: 'paint-region' }
  | { kind: 'tool-stroke' }
  | { kind: 'select'; block: BlockRef }
  | { kind: 'toggle-select'; block: BlockRef }
  | { kind: 'deselect' }
  | { kind: 'collapse-select'; id: string }
  | { kind: 'move-selection'; anchorId: string }
  | { kind: 'band-select'; from: MacroCoord }
  | { kind: 'context-menu'; block: BlockRef }
  | { kind: 'cancel-pending' };

/** What the press landed on. `draggable` is `isDraggableObject`, resolved by the caller because it
 *  reads the catalog, which this floor may not. */
export interface PressHit { id: string; draggable: boolean; locked: boolean }

export interface PressFacts {
  button: number;
  tool: ToolType;
  armedItemId: string | null;
  selection: readonly BlockRef[];
  selectingRegion: boolean;
  panDragHeld: boolean;
  multiSelectHeld: boolean;
  macro: MacroCoord;
  hit: PressHit | null;
  /** The active tool's own `canActAt` answer for this cell. */
  placementAllowed: boolean;
  /** The active tool's own `grabAt` answer for this cell: a plain press picks up something the
   *  TOOL owns and the drag moves it (the annotate select state's note). False where the tool
   *  keeps no such gesture. */
  toolGrabs: boolean;
  /** The active tool's `selects` answer: it stands in its own select state, so the modifier means
   *  here what it means in the map's select mode — the press toggles (through the tool's own
   *  stroke) and the drag is a band. */
  toolSelects: boolean;
  /** The active tool's `selectHit` answer for this cell — what its select state finds under the
   *  pointer and whether it is already a member, for the modifier cursor's add/remove badge. */
  toolSelectHit: { id: string; selected: boolean } | null;
  /** Whether the active tool has a multi-tap gesture standing (`Tool.hasPending`) — the macro tool's
   *  road-link mark, the curve's chain of anchors. A tool that does not implement it is unaffected
   *  by the branch below. */
  pendingGesture: boolean;
  /** The view pans a left drag through its own tool path (2D, through the Hand tool). False where
   *  the pointer machine must pan it (the 3D editor). */
  viewPansLeftDrag: boolean;
  /** The armed stroke is a CLICK and uses no drag (the annotate tool's text/route/erase armings):
   *  the press acts, and a hand that then pulls is asking to move the map, not the tool — so the
   *  drag goes to the camera instead of dying in a stroke that ignores it. */
  clickOnlyStroke: boolean;
}

export interface PressPlan {
  /** Run immediately, at press time. `onTap` and `onDrag` are ARM lists run at press time too: their
   *  intents (`deselect`, `collapse-select`, `move-selection`, `band-select`, …) set flags and
   *  starting positions for the release (or an in-progress drag) to read later, rather than being
   *  deferred callbacks the machine holds and invokes on tap or on drag. */
  down: readonly PressIntent[];
  onTap: readonly PressIntent[];
  onDrag: readonly PressIntent[];
  /** True only where `down` itself writes a selection (`select`/`toggle-select`) that a build brush
   *  cannot hold: leave the brush for the Hand tool immediately BEFORE that write lands, or the store
   *  subscription that drops an unholdable selection erases the very write this gesture made. A Ctrl
   *  press that hits nothing arms the band but writes nothing here, so it leaves the brush alone; the
   *  band's own release write is the executor's second, separate application point for this same
   *  rule, outside this flag. */
  leaveBrush: boolean;
}

const EMPTY: PressPlan = {
  down: [], onTap: [], onDrag: [], leaveBrush: false,
};

const plan = (over: Partial<PressPlan>): PressPlan => ({ ...EMPTY, ...over });

const isMember = (selection: readonly BlockRef[], id: string): boolean =>
  selection.some((r) => r.kind === 'object' && r.id === id);

/** The one member of a selection of exactly one, else null. A plural selection has no single member
 *  to answer for it. */
const lone = (selection: readonly BlockRef[]): BlockRef | null =>
  selection.length === 1 ? selection[0]! : null;

const blockFor = (f: PressFacts): BlockRef =>
  f.hit ? { kind: 'object', id: f.hit.id } : { kind: 'terrain', x: f.macro.x, y: f.macro.y };

/**
 * With an item armed, does a PLAIN press select the object under it instead of placing?
 *
 * Gated on the placement being REFUSED there, so only the click that could not have placed anything
 * changes meaning. A LOCKED object is excluded: V-LOCK-02 refuses both the rotate and the delete
 * such a selection would offer, so swallowing the press would take the placement's own refusal with
 * it and the click would do nothing at all.
 */
export function armedPressSelects(f: PressFacts): boolean {
  return f.tool === ToolType.ObjectPlacer && !!f.armedItemId
    && !f.selectingRegion && !f.multiSelectHeld
    && f.hit !== null && !f.hit.locked && !f.placementAllowed;
}

/** The pan a left drag applies once the press has fallen through to the tool, if any. */
function leftDragPan(f: PressFacts, dragMode: boolean): PressIntent[] {
  if (!dragMode) return [];
  if (!f.viewPansLeftDrag) return [{ kind: 'pan-camera', by: 'machine', source: 'left-drag' }];
  if (f.tool === ToolType.Hand) return [{ kind: 'pan-camera', by: 'tool', source: 'left-drag' }];
  return [];
}

function resolveSelectionPress(f: PressFacts, dragMode: boolean, brushCtrl: boolean): PressPlan {
  const ctrl = f.multiSelectHeld;
  const down: PressIntent[] = [];
  const onTap: PressIntent[] = [];
  const onDrag: PressIntent[] = [];

  if (f.hit) {
    const block: BlockRef = { kind: 'object', id: f.hit.id };
    if (ctrl) {
      down.push({ kind: 'toggle-select', block });
    } else if (isMember(f.selection, f.hit.id)) {
      // MEMBERSHIP, not identity: a press picks the whole group up by whichever member it landed on.
      onTap.push(f.selection.length > 1
        ? { kind: 'collapse-select', id: f.hit.id }
        : { kind: 'deselect' });
      if (f.hit.draggable) onDrag.push({ kind: 'move-selection', anchorId: f.hit.id });
    } else {
      down.push({ kind: 'select', block });
    }
  } else if (!ctrl) {
    const sel = lone(f.selection);
    if (sel && sel.kind === 'terrain' && sel.x === f.macro.x && sel.y === f.macro.y) {
      onTap.push({ kind: 'deselect' });
    } else {
      down.push({ kind: 'select', block: { kind: 'terrain', x: f.macro.x, y: f.macro.y } });
    }
  }

  // The modifier arms a band on ANY press it holds, hit or not: terrain never joins a group, and a
  // press over an object still toggles, so the band is what the DRAG means in either case.
  if (ctrl) onDrag.push({ kind: 'band-select', from: f.macro });

  const arms = onDrag.some((i) => i.kind === 'move-selection') || ctrl;
  if (!arms) {
    down.push({ kind: 'tool-stroke' });
    onDrag.push(...leftDragPan(f, dragMode));
  }

  const writesSelection = down.some((i) => i.kind === 'select' || i.kind === 'toggle-select');
  return plan({ down, onTap, onDrag, leaveBrush: brushCtrl && writesSelection });
}

/**
 * What a nav TAP does, given the facts at the release position.
 *
 * Separate from the plan because the machine resolves this one late: a nav press that never moved
 * targets whatever is under the pointer when it lifts, not when it landed.
 */
export function resolveNavTap(f: PressFacts): readonly PressIntent[] {
  // A NAV TAP ENDS A PENDING GESTURE, and does nothing else. Right and middle drag the camera, so a
  // right press that never moved is the one press with no camera meaning left in it, and "put that
  // down" is what a hand reaches for it to mean.
  if (f.pendingGesture) return [{ kind: 'cancel-pending' }];
  if (!inSelectMode(f.tool, f.armedItemId)) return [];
  const block = blockFor(f);
  const out: PressIntent[] = [{ kind: 'context-menu', block }];
  if (f.multiSelectHeld) {
    if (f.hit) out.push({ kind: 'toggle-select', block });
  } else {
    out.push({ kind: 'select', block });
  }
  return out;
}

export function resolvePress(f: PressFacts): PressPlan {
  if (f.button !== PRIMARY_BUTTON) return EMPTY;

  // Navigate-while-drawing: the pan-drag key takes the press in ANY tool mode, so a brush never has
  // to fight the camera.
  if (f.panDragHeld) {
    const pan: PressIntent = { kind: 'pan-camera', by: 'machine', source: 'pan-key' };
    return plan({ down: [pan], onDrag: [pan] });
  }
  if (f.selectingRegion) {
    const paint: PressIntent = { kind: 'paint-region' };
    return plan({ down: [paint], onDrag: [paint] });
  }

  const armed = f.tool === ToolType.ObjectPlacer && !!f.armedItemId;
  const brushCtrl = f.multiSelectHeld && isBrushTool(f.tool);
  const dragMode = inSelectMode(f.tool, f.armedItemId);

  if (dragMode || (armed && f.multiSelectHeld) || brushCtrl) {
    return resolveSelectionPress(f, dragMode, brushCtrl);
  }
  if (armed && armedPressSelects(f) && f.hit) {
    return plan({
      down: [{ kind: 'select', block: { kind: 'object', id: f.hit.id } }],
    });
  }
  // A tool standing in its own select state answers the modifier as the map's select mode does:
  // the press still reaches the tool (whose own stroke toggles the thing it hit), and the drag is
  // a band — never a pan, never a move.
  if (f.toolSelects && f.multiSelectHeld) {
    return plan({
      down: [{ kind: 'tool-stroke' }],
      onDrag: [{ kind: 'band-select', from: f.macro }],
    });
  }
  if (f.clickOnlyStroke) {
    return plan({
      down: [{ kind: 'tool-stroke' }],
      // By the MACHINE in both views: the tool path's pan is the Hand tool's, which is not the
      // tool standing here.
      onDrag: [{ kind: 'pan-camera', by: 'machine', source: 'left-drag' }],
    });
  }
  return plan({ down: [{ kind: 'tool-stroke' }] });
}

/** The three positional cursor facts, read off the plan a press with these facts would run.
 *  `overSelected` answers whether a press would ARM A MOVE, not merely land on the selection: it is
 *  false wherever a press would not pick anything up, including with an item armed in the placer
 *  (there the press places or select-instead-of-places; neither is a pickup). */
export interface CursorFacts {
  ctrlHint: 'select-add' | 'select-remove' | 'marquee' | null;
  pressSelects: boolean;
  overSelected: boolean;
}

export function cursorFactsFor(f: PressFacts): CursorFacts {
  // What a press would SELECT is a question about the selection rules, not the camera: the pan-drag
  // key changes what a press DOES, never what is under the pointer, so it is forced off here even
  // where the live facts have it held.
  const p = resolvePress({ ...f, button: PRIMARY_BUTTON, panDragHeld: false });
  const toggle = p.down.find((i) => i.kind === 'toggle-select');
  let ctrlHint: CursorFacts['ctrlHint'] = null;
  if (toggle && toggle.kind === 'toggle-select' && toggle.block.kind === 'object') {
    ctrlHint = isMember(f.selection, toggle.block.id) ? 'select-remove' : 'select-add';
  } else if (f.multiSelectHeld && f.toolSelects && f.toolSelectHit) {
    // The tool's own select state: its toggle runs inside the tool stroke, so the membership fact
    // arrives through `toolSelectHit` rather than a toggle intent.
    ctrlHint = f.toolSelectHit.selected ? 'select-remove' : 'select-add';
  } else if (p.onDrag.some((i) => i.kind === 'band-select')) {
    ctrlHint = 'marquee';
  }
  return {
    ctrlHint,
    pressSelects: (p.down.some((i) => i.kind === 'select') && !p.down.some((i) => i.kind === 'tool-stroke'))
      || (f.toolSelects && f.toolSelectHit !== null && !f.toolGrabs && p.down.some((i) => i.kind === 'tool-stroke')),
    // A press that would pick something up: the machine's own move gesture, or a tool-owned grab
    // (the annotate select state's note) — the open hand promises the same closed hand either way.
    overSelected: p.onDrag.some((i) => i.kind === 'move-selection')
      || (f.toolGrabs && !f.multiSelectHeld && p.down.some((i) => i.kind === 'tool-stroke')),
  };
}
