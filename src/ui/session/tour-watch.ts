/**
 * What a Show me step watches while the visitor tries it on the live editor: the store's arming,
 * view, layer and windows, the map's undo depth and any edit still landing, and the camera of the
 * view showing, and when the visitor's own hand acts. Read here, beside the other map and store
 * signals ui listens to.
 */
import { useEffect, useRef } from 'react';
import { host } from '../../editor/host/host';
import { onMapEdited } from '../../core/commands/map-edits';
import { anyKeyHeld, onHeldKeysChange } from '../../platform/input/held-keys';
import { editsInFlight, onEditsInFlightChange } from '../../state/edits-in-flight';
import type { Arming, BuildMode } from '../../state/editing/edit-mode';
import type { ViewMode } from '../../state/slices/prefs';
import type { CameraAngle, View2dCamera } from '../../state/view-camera';
import { useEditorStore } from '../../state/store';

/** The live interface as a step's completion reads it. */
export interface TourWatch {
  view: ViewMode;
  mode: BuildMode;
  /** What the open mode has armed (`brush`, `erase`, `item` and the rest). */
  arming: Arming['kind'];
  layer: number;
  share: boolean;
  /** The map's undo depth: an edit that stands raises it, an undo lowers it. */
  edits: number;
  /** An edit is still landing over several frames (a Generate card's replay). */
  building: boolean;
  /** The 2D view's camera while 2D shows, else null. */
  camera2d: View2dCamera | null;
  /** The camera Fit lands on while 2D shows, else null. */
  fit2d: View2dCamera | null;
  /** The 3D view's camera while 3D shows and its scene stands, else null. */
  camera3d: CameraAngle | null;
}

export function readTourWatch(): TourWatch {
  const s = useEditorStore.getState();
  const view = s.viewMode;
  return {
    view,
    mode: s.editMode.mode,
    arming: s.editMode.arming.kind,
    layer: s.activeLayer,
    share: s.modals.share,
    edits: s.commandExecutor?.historyDepth() ?? 0,
    building: editsInFlight(),
    camera2d: view === '2d' ? host.camera.get2d() ?? null : null,
    fit2d: view === '2d' ? host.camera.fitted2d() ?? null : null,
    camera3d: view === '3d' ? host.camera.get3d() ?? null : null,
  };
}

interface TourWatchHandlers {
  /** Something the watch reads may have moved. */
  changed(): void;
  /** The visitor's hand acted: a press going down, moving or let go, the wheel, or a key going
   *  down or up (with no event). */
  input(event?: PointerEvent | WheelEvent): void;
  /** The view was asked to fit the map, which moves nothing on a view fitted already. */
  fit(): void;
}

/**
 * Follows the watch while `on`, calling the handlers as it moves. Returns whether a press or a key
 * is still down, so a step finishes when the gesture that did it lets go rather than in the middle
 * of it. Input is heard in the capture phase, ahead of the map that answers it.
 */
export function useTourWatch(on: boolean, handlers: TourWatchHandlers): () => boolean {
  const latest = useRef(handlers);
  latest.current = handlers;
  const down = useRef(new Set<number>());
  const bus = useEditorStore((s) => s.eventBus);
  useEffect(() => {
    if (!on) return;
    const pressed = down.current;
    const changed = () => latest.current.changed();
    const input = (e?: PointerEvent | WheelEvent) => latest.current.input(e);
    const fit = () => latest.current.fit();
    const press = (e: PointerEvent) => {
      pressed.add(e.pointerId);
      input(e);
    };
    const move = (e: PointerEvent) => {
      if (e.buttons === 0) return;
      pressed.add(e.pointerId);
      input(e);
    };
    const release = (e: PointerEvent) => {
      pressed.delete(e.pointerId);
      input(e);
    };
    // A window losing focus can swallow the release.
    const blur = () => {
      pressed.clear();
      input();
    };
    const offStore = useEditorStore.subscribe(changed);
    const offEdits = onMapEdited(bus, changed);
    const offLanding = onEditsInFlightChange(changed);
    const offKeys = onHeldKeysChange(() => input());
    bus.on('viewport-changed', changed);
    bus.on('camera-fit', fit);
    const capture = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', press, capture);
    window.addEventListener('pointermove', move, capture);
    window.addEventListener('pointerup', release, capture);
    window.addEventListener('pointercancel', release, capture);
    window.addEventListener('wheel', input, capture);
    window.addEventListener('blur', blur);
    return () => {
      offStore();
      offEdits();
      offLanding();
      offKeys();
      bus.off('viewport-changed', changed);
      bus.off('camera-fit', fit);
      window.removeEventListener('pointerdown', press, capture);
      window.removeEventListener('pointermove', move, capture);
      window.removeEventListener('pointerup', release, capture);
      window.removeEventListener('pointercancel', release, capture);
      window.removeEventListener('wheel', input, capture);
      window.removeEventListener('blur', blur);
      pressed.clear();
    };
  }, [on, bus]);
  return () => down.current.size > 0 || anyKeyHeld();
}
