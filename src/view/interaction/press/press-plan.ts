/*
 * What a pointer press means.
 *
 * One pure function over plain facts, returning what the press does, what a tap then does, and what
 * a drag then does. The pointer machine executes the plan; the hover path derives its cursor flags
 * from the same plan. Two readers, one rule, so a cursor can never promise something the press does
 * not do.
 *
 * The order of the decisions is the rule: the pan-drag key, then the region brush, then one branch
 * covering both the multi-select gesture and ordinary selection (they are disjoint on whether an
 * item is armed), then an armed item's select-instead-of-place, then the tool. Each step returns,
 * so an earlier one always wins.
 */
import { type MacroCoord } from '../../../core/model/types';
import { type BlockRef } from '../../../state/selection';
import { PRIMARY_BUTTON } from './pointer-buttons';

/**
 * Which gesture asked for the pan. The machine holds the two apart: a pan-key pan applies on any
 * move it sees, while a left-drag pan applies only while the primary button is still reported down
 * (a release outside the window never reaches the handler that would clear the flag).
 */
type PanSource = 'pan-key' | 'left-drag';

export type PressIntent =
  | { kind: 'pan-camera'; source: PanSource }
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
interface PressHit { id: string; draggable: boolean; locked: boolean }

export interface PressFacts {
  button: number;
  /** The active tool's `selectMode` answer: an unmodified click selects whatever is under it. */
  selectMode: boolean;
  /** The active tool is a terrain brush (`Tool.brush`). */
  brush: boolean;
  /** The armed catalog item. Only the placer arms one (`state/editing/edit-mode.ts`), so an item
   *  here means the placer is up with it. */
  armedItemId: string | null;
  selection: readonly BlockRef[];
  selectingRegion: boolean;
  panDragHeld: boolean;
  multiSelectHeld: boolean;
  /** The placement-grid cell under the pointer: where a band or a region brush starts. */
  macro: MacroCoord;
  /** The terrain cell under the pointer: what a press that hits no object selects, since a terrain
   *  selection names a terrain cell. */
  terrain: MacroCoord;
  hit: PressHit | null;
  /** The active tool's own `canActAt` answer for this cell. */
  placementAllowed: boolean;
  /** The active tool's own `grabAt` answer for this cell: a plain press picks up something the
   *  Tool owns and the drag moves it (the annotate select state's note). False where the tool
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
  /** The active tool's `clickOnly` answer: the press acts, and a hand that then pulls is asking to
   *  move the map, not the tool, so the drag goes to the camera instead of dying in a stroke that
   *  ignores it. */
  clickOnlyStroke: boolean;
}

export interface PressPlan {
  /** Run immediately, at press time. `onTap` and `onDrag` are arm lists run at press time too: their
   *  intents (`deselect`, `collapse-select`, `move-selection`, `band-select`, …) set flags and
   *  starting positions for the release (or an in-progress drag) to read later, rather than being
   *  deferred callbacks the machine holds and invokes on tap or on drag. */
  down: readonly PressIntent[];
  onTap: readonly PressIntent[];
  onDrag: readonly PressIntent[];
}

const EMPTY: PressPlan = {
  down: [], onTap: [], onDrag: [],
};

const plan = (over: Partial<PressPlan>): PressPlan => ({ ...EMPTY, ...over });

const isMember = (selection: readonly BlockRef[], id: string): boolean =>
  selection.some((r) => r.kind === 'object' && r.id === id);

/** The one member of a selection of exactly one, else null. A plural selection has no single member
 *  to answer for it. */
const lone = (selection: readonly BlockRef[]): BlockRef | null =>
  selection.length === 1 ? selection[0]! : null;

const blockFor = (f: PressFacts): BlockRef =>
  f.hit ? { kind: 'object', id: f.hit.id } : { kind: 'terrain', x: f.terrain.x, y: f.terrain.y };

/**
 * With an item armed, does a plain press select the object under it instead of placing?
 *
 * Gated on the placement being refused there, so only the click that could not have placed anything
 * changes meaning. A locked object is excluded: the locked-object rule refuses its rotate and delete
 * such a selection would offer, so swallowing the press would take the placement's own refusal with
 * it and the click would do nothing at all.
 */
function armedPressSelects(f: PressFacts): boolean {
  return !!f.armedItemId
    && !f.selectingRegion && !f.multiSelectHeld
    && f.hit !== null && !f.hit.locked && !f.placementAllowed;
}

/** The pan a left drag applies once the press has fallen through to the tool: in the select
 *  modes a drag that picks nothing up moves the map, in both views. */
function leftDragPan(dragMode: boolean): PressIntent[] {
  return dragMode ? [{ kind: 'pan-camera', source: 'left-drag' }] : [];
}

function resolveSelectionPress(f: PressFacts, dragMode: boolean): PressPlan {
  const ctrl = f.multiSelectHeld;
  const down: PressIntent[] = [];
  const onTap: PressIntent[] = [];
  const onDrag: PressIntent[] = [];

  if (f.hit) {
    const block: BlockRef = { kind: 'object', id: f.hit.id };
    if (ctrl) {
      down.push({ kind: 'toggle-select', block });
    } else if (isMember(f.selection, f.hit.id)) {
      // Membership, not identity: a press picks the whole group up by whichever member it landed on.
      onTap.push(f.selection.length > 1
        ? { kind: 'collapse-select', id: f.hit.id }
        : { kind: 'deselect' });
      if (f.hit.draggable) onDrag.push({ kind: 'move-selection', anchorId: f.hit.id });
    } else {
      down.push({ kind: 'select', block });
    }
  } else if (!ctrl) {
    const sel = lone(f.selection);
    if (sel && sel.kind === 'terrain' && sel.x === f.terrain.x && sel.y === f.terrain.y) {
      onTap.push({ kind: 'deselect' });
    } else {
      down.push({ kind: 'select', block: blockFor(f) });
    }
  }

  // The modifier arms a band on any press it holds, hit or not: terrain never joins a group, and a
  // press over an object still toggles, so the band is what the drag means in either case.
  if (ctrl) onDrag.push({ kind: 'band-select', from: f.macro });

  const arms = onDrag.some((i) => i.kind === 'move-selection') || ctrl;
  if (!arms) {
    down.push({ kind: 'tool-stroke' });
    onDrag.push(...leftDragPan(dragMode));
  }

  return plan({ down, onTap, onDrag });
}

/**
 * What a nav tap does, given the facts at the release position.
 *
 * Separate from the plan because the machine resolves this one late: a nav press that never moved
 * targets whatever is under the pointer when it lifts, not when it landed.
 */
export function resolveNavTap(f: PressFacts): readonly PressIntent[] {
  // A nav tap ends a pending gesture, and does nothing else. Right and middle drag the camera, so a
  // right press that never moved is the one press with no camera meaning left in it, and "put that
  // down" is what a hand reaches for it to mean.
  if (f.pendingGesture) return [{ kind: 'cancel-pending' }];
  if (!f.selectMode) return [];
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

  // Navigate-while-drawing: the pan-drag key takes the press in any tool mode, so a brush never has
  // to fight the camera.
  if (f.panDragHeld) {
    const pan: PressIntent = { kind: 'pan-camera', source: 'pan-key' };
    return plan({ down: [pan], onDrag: [pan] });
  }
  if (f.selectingRegion) {
    const paint: PressIntent = { kind: 'paint-region' };
    return plan({ down: [paint], onDrag: [paint] });
  }

  const armed = !!f.armedItemId;
  const brushCtrl = f.multiSelectHeld && f.brush;
  const dragMode = f.selectMode;

  if (dragMode || (armed && f.multiSelectHeld) || brushCtrl) {
    return resolveSelectionPress(f, dragMode);
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
      onDrag: [{ kind: 'pan-camera', source: 'left-drag' }],
    });
  }
  return plan({ down: [{ kind: 'tool-stroke' }] });
}

/** The three positional cursor facts, read off the plan a press with these facts would run.
 *  `overSelected` answers whether a press would arm a move, not merely land on the selection: it is
 *  false wherever a press would not pick anything up, including with an item armed in the placer
 *  (there the press places or select-instead-of-places; neither is a pickup). */
interface CursorFacts {
  ctrlHint: 'select-add' | 'select-remove' | 'marquee' | null;
  pressSelects: boolean;
  overSelected: boolean;
}

export function cursorFactsFor(f: PressFacts): CursorFacts {
  // What a press would select is a question about the selection rules, not the camera: the pan-drag
  // key changes what a press does, never what is under the pointer, so it is forced off here even
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
