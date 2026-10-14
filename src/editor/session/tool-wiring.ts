/*
 * The live editor as a tool manager reads it: the arming, the locale, toasts, held keys, the
 * annotation slice and the worker pool's macro runners, each read when a tool asks. `tools/` knows
 * none of these channels; the session's manager, and any test that drives one against the store,
 * take them here.
 */
import type { ToolManagerDeps } from '../../tools/pointer/runtime';
import type { EventBus } from '../../core/commands/event-bus';
import type { EditorEvents } from '../../state/editing/events';
import { CurveSessions, curveArmingKey } from '../../tools/pointer/paint';
import { armingOf } from '../../state/editing/arming';
import { useEditorStore, type EditorStore } from '../../state/store';
import { isCommandHeld } from '../../state/keymap/held';
import { quantityParams, translateFor } from '../../i18n/context';
import type { TextKey } from '../../i18n/keys';
import { tagLabel } from '../../i18n/annotation-tags';
import { showToast } from '../../platform/channels/toast-bus';
import { poolAvailable, runMacroBuildInPool, runPreviewInPool } from '../../tools/generation/run';

/** The editor's curve adjust phase, one per page: every map's tool manager shares it, and the curve
 *  handles, the command keys and the annotation bars read and close it here. */
export const editorCurves = new CurveSessions();

/** The arming a curve session was opened under, as `state` arms now: a session whose key differs
 *  belongs to an arming that is gone. */
export function curveArmingKeyOf(state: EditorStore): string {
  return curveArmingKey(armingOf(state));
}

/** Ends the open curve when an undo or redo lands on `bus`; returns the unsubscribe. */
export function endCurveOnHistory(bus: EventBus<EditorEvents>): () => void {
  const close = () => editorCurves.end();
  bus.on('history-applied', close);
  return () => bus.off('history-applied', close);
}

export function editorToolWiring(): ToolManagerDeps {
  const store = useEditorStore.getState;
  return {
    arming: () => armingOf(store()),
    curve: editorCurves,
    // Quantities read in the locale's own number format, as every surface writes them; the locale is
    // read per call, so a language change reaches the next notice.
    t: Object.defineProperty((key: TextKey, params?: Record<string, string | number>) => {
      const locale = store().locale;
      return translateFor(locale, key, quantityParams(locale, params));
    }, 'locale', { get: () => store().locale }),
    notify: (text, tone) => showToast(text, tone),
    modifiers: {
      get constrain() { return isCommandHeld('tool.constrain'); },
      get multiSelect() { return isCommandHeld('selection.multi'); },
    },
    setDisplayLayer: (layer) => store().setDisplayLayer(layer),
    reportGroundClipped: () => store().eventBus.emit('ground-clipped', {}),
    annotationEdit: {
      begin: () => store().beginAnnotationStroke(),
      apply: (fn) => store().applyAnnotationEdit(fn),
      add: (a) => store().addAnnotation(a),
      remove: (id) => store().removeAnnotation(id),
      select: (ids) => store().setAnnotationSelection(ids),
      setDraft: (a) => store().setAnnotationDraft(a),
      commitDraft: () => store().commitAnnotationDraft(),
    },
    tagLabel: (tag) => { const s = store(); return tagLabel(tag, s.locale, s.gridState?.annotations?.customTags); },
    // Smart Build runs in the worker pool where there is one; each manager gets its own port, which a
    // pool that stops answering clears.
    ...(poolAvailable() ? { offThread: { build: runMacroBuildInPool, preview: runPreviewInPool } } : {}),
  };
}
