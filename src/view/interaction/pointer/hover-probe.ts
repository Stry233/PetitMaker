/**
 * The idle pointer's answers: the grey would-select box, and the positional cursor facts (whether
 * the active tool would refuse this cell, whether the pointer is over the already-selected object,
 * the modifier hint, whether a press selects). The facts rerun only when what the pointer is over
 * or one of their non-positional inputs changes, never per pointer move.
 */
import { clientPoint } from '../../../platform/device/viewport-space';
import { useEditorStore, type EditorStore } from '../../../state/store';
import { getActiveView } from '../../active-view';
import { toolDeclares } from '../../../tools/pointer/runtime';
import { armingInputs, armingOf } from '../../../state/editing/arming';
import { isCommandHeld } from '../../../state/keymap/held';
import { selectionHoverBox } from '../selection-hover';
import { cursorFactsFor } from '../press/press-plan';
import { pressFactsAt, probePointer } from './press-facts';
import { PRIMARY_BUTTON } from '../press/pointer-buttons';
import {
  setCursorForbidden, setCursorOverSelected, setCursorCtrlHint, setCursorPressSelects,
} from '../cursor-controller';
import { activeToolOf } from '../../../state/editing/edit-mode';

/**
 * Non-positional inputs that invalidate hover previews and cursors, compared by identity so a large
 * selection is never serialized on pointer movement. A tool's answers read the store only through
 * its arming (`state/editing/arming.ts`), so the arming is the tool's whole declaration; the rest is
 * what the press facts and the box read beside the tool. The map epoch stands for in-place map
 * mutations; the tool epoch waits for the canvas tool to catch up with the store.
 */
export type HoverInputs = readonly unknown[];

export function hoverInputs(
  s: EditorStore, mapEpoch: number, toolEpoch: number, multiSelectHeld: boolean,
): HoverInputs {
  return [
    ...armingInputs(armingOf(s)),
    s.selection, s.selectingRegion, s.viewMode, s.regionTool, s.regionBrushSize, s.regionDimensions,
    s.annotationsEpoch, s.locale,
    mapEpoch, toolEpoch, multiSelectHeld,
  ];
}

export function sameHoverInputs(a: HoverInputs | null, b: HoverInputs): boolean {
  if (a === null || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Enough of a pointer position to resolve a hover/target check. Real PointerEvents satisfy this
 *  structurally; the resampler constructs one from the last known screen position for a pointer
 *  that never moved but whose cell (or ghost orientation) did — the camera panned under it, or the
 *  armed item's rotation flipped — since there is no real event to read at that moment. */
export type PointerSample = { clientX: number; clientY: number; pointerType: string; target: EventTarget | null };

/** Turns every positional cursor fact off. */
export function clearCursorFacts(): void {
  setCursorForbidden(false);
  setCursorOverSelected(false);
  setCursorCtrlHint(null);
  setCursorPressSelects(false);
}

export class HoverProbe {
  /** What the pointer was over when the facts were last computed: placement cell, terrain cell,
   *  hit object, the tool's own cell and the rendered-label hit. */
  cell: string | null = null;
  /** The `hoverInputs` signature the current answer was computed from. */
  inputsKey: HoverInputs | null = null;
  /** Bumped on every map mutation — see `hoverInputs`. */
  mapEpoch = 0;
  /** Bumped every time the canvas finishes writing the tool layer — see `hoverInputs`. */
  toolEpoch = 0;

  constructor(private readonly isCanvasTarget: (e: { target: EventTarget | null }) => boolean) {}

  /** The current non-positional inputs. */
  inputs(state = useEditorStore.getState()): HoverInputs {
    return hoverInputs(state, this.mapEpoch, this.toolEpoch, isCommandHeld('selection.multi'));
  }

  /** Forgets the computed answer, so the next sample re-probes. */
  forget(): void {
    this.cell = null;
    this.inputsKey = null;
  }

  /** Show/clear the grey would-select preview for an idle mouse position, and (the same hovered
   *  cell) publish the positional cursor facts. Only the instance whose canvas is under the pointer
   *  may touch the hover state — both canvases run the machine, and the hidden one must not clear
   *  what the visible one draws (its own pointerleave handles departures). */
  update(e: PointerSample): void {
    if (!this.isCanvasTarget(e)) return;
    const hoverView = getActiveView();
    if (!hoverView) return;
    if (e.pointerType === 'touch') {
      // Touch has no cursor and no Ctrl: never leave a stale probe result behind.
      this.cell = null;
      clearCursorFacts();
      hoverView.overlay.clearHover();
      return;
    }
    const { x: sx, y: sy } = clientPoint(e);
    const probe = probePointer(sx, sy);
    // The box is the press's own target, so what the box shows is what a click selects.
    const box = probe
      ? selectionHoverBox(probe.gridState, probe.target, toolDeclares(activeToolOf(probe.store)).selectMode(armingOf(probe.store)), probe.store.selectingRegion)
      : null;
    if (box) hoverView.overlay.showHover(box, box.grid);
    else hoverView.overlay.clearHover();
    if (!probe) return;

    // The rule pipeline runs when one of its inputs changes, not per pointer-move: what the
    // pointer is over, the multi-select key, and everything `hoverInputs` names.
    const inputs = this.inputs(probe.store);
    const { macro, target, toolCoord, ctx } = probe;
    const over = [macro.x, macro.y, target.terrain.x, target.terrain.y, target.hit?.id, toolCoord.x, toolCoord.y, ctx?.annotationLabelHit].join(',');
    if (over !== this.cell || !sameHoverInputs(this.inputsKey, inputs)) {
      this.cell = over;
      this.inputsKey = inputs;
      const f = pressFactsAt(PRIMARY_BUTTON, probe);
      const c = cursorFactsFor(f);
      // The forbidden badge answers a question about the tool, not about the press: whether this
      // cell would be refused. `placementAllowed` is that same probe, run once for both.
      setCursorForbidden(!f.placementAllowed);
      setCursorCtrlHint(c.ctrlHint);
      setCursorOverSelected(c.overSelected);
      setCursorPressSelects(c.pressSelects);
    }
  }
}
