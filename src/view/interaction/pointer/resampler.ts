/**
 * What re-samples a pointer that did not move: everything besides a pointer event that changes
 * what the pointer's position means. Map mutations and the tool layer bump the hover probe's
 * epochs; store inputs and the multi-select key are compared through `hoverInputs`.
 */
import type { EventBus } from '../../../core/commands/event-bus';
import type { EditorEvents } from '../../../state/editing/events';
import { useEditorStore } from '../../../state/store';
import { onCommandHeldChange } from '../../../state/keymap/held';
import { sameHoverInputs, type HoverProbe } from './hover-probe';

/** Subscribes `resample` to every non-pointer input; returns the unsubscribe. */
export function watchResampleTriggers(eventBus: EventBus<EditorEvents>, probe: HoverProbe, resample: () => void): () => void {
  /**
   * Coalesced re-sample, for the two sources that arrive in bursts: a generate places thousands
   * of objects and a fill paints thousands of cells, each announcing itself, and the answer only
   * needs recomputing once before the next frame is drawn. Everything else below re-samples
   * straight away — a tool switch or a selection is one discrete action, and deferring those
   * would put a frame between the user acting and the cursor agreeing.
   */
  let queuedResample = 0;
  const queueResample = (): void => {
    if (queuedResample) return;
    queuedResample = requestAnimationFrame(() => { queuedResample = 0; resample(); });
  };
  // Bumped by the map-mutation events, so `hoverInputs` covers them too: they change the answer
  // without changing anything the store subscription can see (the grid mutates in place).
  const onMapChanged = (): void => { probe.mapEpoch++; queueResample(); };
  eventBus.on('objects-changed', onMapChanged);
  eventBus.on('cells-changed', onMapChanged);
  // The tool layer once it matches the store, or a brush whose state the store does not show.
  // Straight away, not queued: one mode press is one discrete action, and the store's own
  // subscription has already re-sampled against the tool being left.
  const onToolSynced = (): void => { probe.toolEpoch++; resample(); };
  eventBus.on('tool-synced', onToolSynced);
  eventBus.on('pointer-resample', onToolSynced);
  // Every other non-pointer input: the armed item, the active tool, the selection, the pending
  // rotation, region mode. One subscription over `hoverInputs` rather than one per field.
  let lastInputs = probe.inputs();
  const unsubInputs = useEditorStore.subscribe((state) => {
    const next = probe.inputs(state);
    if (sameHoverInputs(lastInputs, next)) return;
    lastInputs = next;
    resample();
  });
  // A held key is not store state, so it announces itself rather than being subscribed to.
  const unsubMultiSelect = onCommandHeldChange('selection.multi', resample);
  return () => {
    eventBus.off('objects-changed', onMapChanged);
    eventBus.off('cells-changed', onMapChanged);
    eventBus.off('tool-synced', onToolSynced);
    eventBus.off('pointer-resample', onToolSynced);
    if (queuedResample) cancelAnimationFrame(queuedResample);
    unsubInputs();
    unsubMultiSelect();
  };
}
