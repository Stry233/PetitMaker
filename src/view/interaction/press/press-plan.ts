/*
 * What a pointer press means.
 *
 * One pure function over plain facts, returning what the press does, what a tap then does, and what
 * a drag then does. The pointer machine executes the plan; the hover path derives its cursor flags
 * from the same plan. Two readers, one rule, so a cursor can never promise something the press does
 * not do.
 *
 * The order of the decisions is the rule: the pan-drag key, then the region brush, then a touch
 * press that waits, then one branch covering both the multi-select gesture and ordinary selection
 * (they are disjoint on whether an item is armed), then an armed item's select-instead-of-place,
 * then the tool. Each step returns, so an earlier one always wins.
 */
import { type MacroCoord } from '../../../core/model/types';
import { type BlockRef } from '../../../state/selection';
import type { InputMode } from '../../../platform/device/input-mode';
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
  /** Selects `block`; a terrain block also picks `pick` as the paste's top-left (EDIT-54). */
  | { kind: 'select'; block: BlockRef; pick?: MacroCoord }
  /** Picks the placement cell as the paste's top-left, clearing the selection (EDIT-54). */
  | { kind: 'pick-cell'; cell: MacroCoord }
  | { kind: 'toggle-select'; block: BlockRef }
  | { kind: 'deselect' }
  /** A tap toggles `block` on its release: the press waits, since its drag copies. */
  | { kind: 'toggle-on-release'; block: BlockRef }
  | { kind: 'collapse-select'; id: string }
  | { kind: 'move-selection'; anchorId: string }
  /** The drag carries a copy of the selection, leaving the originals (EDIT-60). */
  | { kind: 'copy-selection'; anchorId: string }
  | { kind: 'band-select'; from: MacroCoord }
  | { kind: 'context-menu'; block: BlockRef }
  | { kind: 'cancel-pending' }
  /** The finger carries the armed item's preview over the map; nothing is placed while it moves. */
  | { kind: 'preview-placement' }
  /** One zoom step in, around the press. */
  | { kind: 'zoom-in' };

/** What the press landed on. `draggable` is `isDraggableObject`, resolved by the caller because it
 *  reads the catalog, which this floor may not. */
interface PressHit { id: string; draggable: boolean; locked: boolean }

export interface PressFacts {
  button: number;
  /** The row of the pointer that pressed (`gesture-timing.ts:modalityOf`): a pen is touch. */
  inputMode: InputMode;
  /** The active tool's `selectMode` answer: an unmodified click selects whatever is under it. */
  selectMode: boolean;
  /** The active tool is a terrain brush (`Tool.brush`). */
  brush: boolean;
  /** The armed catalog item. Only the placer arms one (`state/editing/edit-mode.ts`), so an item
   *  here means the placer is up with it. */
  armedItemId: string | null;
  /** Something is copied, so the map's menu offers Paste (EDIT-56). */
  copyHeld: boolean;
  selection: readonly BlockRef[];
  selectingRegion: boolean;
  panDragHeld: boolean;
  /** The multi-select key is held, or the touch multi-select latch is on (`keymap/held.ts`). */
  multiSelectHeld: boolean;
  /** The touch move latch: a finger's next drag moves the selection wherever it starts. */
  moveLatched: boolean;
  /** The placement-grid cell under the pointer: where a band or a region brush starts. */
  macro: MacroCoord;
  /** The terrain cell under the pointer: what a press that hits no object selects, since a terrain
   *  selection names a terrain cell. */
  terrain: MacroCoord;
  /** The placement cell a press picks where it hits no object and `terrain` is open ground
   *  (`selection-hover.ts:PointerTarget.pick`); null elsewhere. */
  pick: MacroCoord | null;
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
  /** The active tool's `strokes` answer: the armed item paints a stroke, so a press acts at once and
   *  its drag is the stroke, never a preview or a selection. */
  armedStrokes: boolean;
}

export interface PressPlan {
  /** Run immediately, at press time. `onTap` and `onDrag` are arm lists run at press time too: their
   *  intents (`deselect`, `collapse-select`, `move-selection`, `band-select`, …) set flags and
   *  starting positions for the release (or an in-progress drag) to read later, rather than being
   *  deferred callbacks the machine holds and invokes on tap or on drag. */
  down: readonly PressIntent[];
  onTap: readonly PressIntent[];
  onDrag: readonly PressIntent[];
  /** Set only on a touch press that waits (`pending.ts`): `down` is empty, and the machine runs
   *  `onTap`, `onDrag` or `onHold` once the press resolves, against the facts of the landing. Absent
   *  on every other plan, so a mouse plan is the object it always was. */
  pending?: true;
  /** What a still press does once the hold time runs out; read only while `pending`. */
  onHold?: readonly PressIntent[];
  /** What a tap does in place of `onTap` when it follows a tap with this same arm inside the
   *  double-tap window and slop; read only while `pending`. */
  onDoubleTap?: readonly PressIntent[];
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

/** The placement cell a press that hits no object picks, given the placement cell under it: the
 *  terrain grid reaches half a cell past the placement grid's top and left edges, and a pointer
 *  there picks the edge cell beside it. */
export const anchorCell = (cell: MacroCoord): MacroCoord => ({ x: Math.max(cell.x, 0), y: Math.max(cell.y, 0) });

/** What a plain press that selects does: pick the open ground under it, else select its block; a
 *  mountain or water cell also picks the placement cell under the press. */
const selectFor = (f: PressFacts): PressIntent => {
  if (f.pick) return { kind: 'pick-cell', cell: f.pick };
  const block = blockFor(f);
  return block.kind === 'terrain' ? { kind: 'select', block, pick: anchorCell(f.macro) } : { kind: 'select', block };
};

/**
 * With an item armed, does a plain press select the object under it instead of placing?
 *
 * Gated on the placement being refused there, so only the click that could not have placed anything
 * changes meaning. A locked object is excluded: the locked-object rule refuses its rotate and delete
 * such a selection would offer, so swallowing the press would take the placement's own refusal with
 * it and the click would do nothing at all.
 */
function armedPressSelects(f: PressFacts): boolean {
  return !!f.armedItemId && !f.armedStrokes
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
    if (ctrl && f.hit.draggable && isMember(f.selection, f.hit.id)) {
      // A Ctrl press on a selected member waits: a tap still takes it out of the selection, and a
      // drag carries a copy of the selection away instead of drawing a band.
      onTap.push({ kind: 'toggle-on-release', block });
      onDrag.push({ kind: 'copy-selection', anchorId: f.hit.id });
    } else if (ctrl) {
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
    if (!f.pick && sel && sel.kind === 'terrain' && sel.x === f.terrain.x && sel.y === f.terrain.y) {
      onTap.push({ kind: 'deselect' });
    } else {
      down.push(selectFor(f));
    }
  }

  // The modifier arms a band on any press it holds that does not copy, hit or not: terrain never
  // joins a group, and a press over an object still toggles, so the band is what the drag means.
  if (ctrl && onDrag.length === 0) onDrag.push({ kind: 'band-select', from: f.macro });

  const arms = onDrag.some((i) => i.kind === 'move-selection') || ctrl;
  if (!arms) {
    down.push({ kind: 'tool-stroke' });
    onDrag.push(...leftDragPan(dragMode));
  }

  return plan({ down, onTap, onDrag });
}

/** A touch press waits with nothing armed and with an item armed in the placer to place once. Every
 *  other tool, a painting placer's included, acts on the way down, so a brush lays its dot under the finger at once and a second finger takes
 *  the stroke back. With an item armed, the multi-select modifier keeps its own gesture. */
const touchPressWaits = (f: PressFacts): boolean =>
  f.inputMode === 'touch' && (f.selectMode || (!!f.armedItemId && !f.multiSelectHeld && !f.armedStrokes));

/** The first selected object: what a drag under the move latch moves the selection by. */
const firstObject = (selection: readonly BlockRef[]): string | null =>
  selection.find((r) => r.kind === 'object')?.id ?? null;

/** The drag arm the move latch gives a waiting press: the selection moves from wherever it starts. */
function latchedMove(f: PressFacts): PressIntent[] {
  const anchor = f.moveLatched ? firstObject(f.selection) : null;
  return anchor ? [{ kind: 'move-selection', anchorId: anchor }] : [];
}

/**
 * A touch press under multi-select, which waits like any touch press: a tap adds or removes the
 * object under it, a drag from a member that can move moves the group, and any other drag draws
 * the band, as the modifier's drag does.
 */
function resolveMultiSelectPress(f: PressFacts): PressPlan {
  const onTap: PressIntent[] = f.hit ? [{ kind: 'toggle-select', block: { kind: 'object', id: f.hit.id } }] : [];
  let onDrag = latchedMove(f);
  if (onDrag.length === 0) {
    onDrag = f.hit && f.hit.draggable && isMember(f.selection, f.hit.id)
      ? [{ kind: 'move-selection', anchorId: f.hit.id }]
      : [{ kind: 'band-select', from: f.macro }];
  }
  return { down: [], onTap, onDrag, onHold: [], pending: true };
}

/**
 * A touch press that waits. A tap selects, or places the armed item; a drag moves the selection
 * when it starts on a member that can move or the move latch is on, previews the armed item, or
 * pans, so a pan never changes the selection; a long press previews the armed item, or opens the
 * menu of the object under it when nothing is armed. With nothing armed, a second tap on map where
 * no object stands zooms in one step instead of selecting.
 */
function resolvePendingPress(f: PressFacts): PressPlan {
  if (f.multiSelectHeld) return resolveMultiSelectPress(f);
  if (f.armedItemId) {
    const instead = armedPressSelects(f) ? f.hit : null;
    return {
      down: [],
      onTap: [instead ? { kind: 'select', block: { kind: 'object', id: instead.id } } : { kind: 'tool-stroke' }],
      onDrag: [{ kind: 'preview-placement' }],
      onHold: [{ kind: 'preview-placement' }],
      pending: true,
    };
  }
  const onTap: PressIntent[] = [];
  const onDrag: PressIntent[] = latchedMove(f);
  if (f.hit && isMember(f.selection, f.hit.id)) {
    onTap.push(f.selection.length > 1 ? { kind: 'collapse-select', id: f.hit.id } : { kind: 'deselect' });
    if (f.hit.draggable && onDrag.length === 0) onDrag.push({ kind: 'move-selection', anchorId: f.hit.id });
  } else if (!f.hit) {
    const sel = lone(f.selection);
    const same = !f.pick && sel?.kind === 'terrain' && sel.x === f.terrain.x && sel.y === f.terrain.y;
    onTap.push(same ? { kind: 'deselect' } : selectFor(f));
  } else {
    onTap.push({ kind: 'select', block: blockFor(f) });
  }
  if (onDrag.length === 0) onDrag.push(...leftDragPan(true));
  const onHold: PressIntent[] = f.hit || f.copyHeld ? [{ kind: 'context-menu', block: blockFor(f) }] : [];
  if (!f.hit) return { down: [], onTap, onDrag, onHold, onDoubleTap: [{ kind: 'zoom-in' }], pending: true };
  return { down: [], onTap, onDrag, onHold, pending: true };
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
    out.push(selectFor(f));
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
  if (touchPressWaits(f)) return resolvePendingPress(f);

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
  // A waiting press acts on its tap: that is what a press there would do.
  const acts = p.pending ? p.onTap : p.down;
  // A Ctrl press on a selected member toggles on its release, since its drag copies.
  const toggle = [...p.down, ...p.onTap].find((i) => i.kind === 'toggle-select' || i.kind === 'toggle-on-release');
  let ctrlHint: CursorFacts['ctrlHint'] = null;
  if (toggle && (toggle.kind === 'toggle-select' || toggle.kind === 'toggle-on-release') && toggle.block.kind === 'object' && !p.pending) {
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
    pressSelects: (acts.some((i) => i.kind === 'select' || i.kind === 'pick-cell') && !acts.some((i) => i.kind === 'tool-stroke'))
      || (f.toolSelects && f.toolSelectHit !== null && !f.toolGrabs && p.down.some((i) => i.kind === 'tool-stroke')),
    // A press that would pick something up: the machine's own move gesture, or a tool-owned grab
    // (the annotate select state's note) — the open hand promises the same closed hand either way.
    overSelected: p.onDrag.some((i) => i.kind === 'move-selection' || i.kind === 'copy-selection')
      || (f.toolGrabs && !f.multiSelectHeld && p.down.some((i) => i.kind === 'tool-stroke')),
  };
}
