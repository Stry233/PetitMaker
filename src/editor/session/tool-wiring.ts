/*
 * The live editor as a tool manager reads it: the arming, the locale, toasts, held keys, the
 * annotation slice, what follows a blueprint placement, the drag of a selected placement and the
 * worker pool's macro runners, each read when a tool asks. `tools/` knows none of these channels; the session's manager, and any test
 * that drives one against the store, take them here.
 */
import type { ToolManagerDeps } from '../../tools/pointer/runtime';
import { onMapEdited } from '../../core/commands/map-edits';
import { getActiveView, onActiveViewChange } from '../../view/active-view';
import { CurveSessions, curveArmingKey } from '../../tools/pointer/paint';
import { armingOf } from '../../state/editing/arming';
import { useEditorStore } from '../../state/store';
import { isCommandHeld } from '../../state/keymap/held';
import { quantityParams, translateFor } from '../../i18n/context';
import type { TextKey } from '../../i18n/keys';
import { tagLabel } from '../../i18n/terms/annotation-tags';
import { showToast } from '../../platform/channels/toast-bus';
import { poolAvailable, runMacroBuildInPool, runPreviewInPool } from '../../tools/generation/run';
import { armedBlueprintPlaced, selectedGroupDrag } from '../editing/blueprint';

/** The editor's curve adjust phase, one per page: every map's tool manager shares it, the curve
 *  handles read it, and the command keys and the annotation bars close it here. */
export const editorCurves = new CurveSessions();

/**
 * The rules that close the editor's open curve besides its tool, and its footprint: the curve ends
 * when the arming it was drawn under is gone (`curveArmingKey`) and when an undo or redo lands on the
 * map, and a footprint it keeps visible is drawn on the active view's overlay, again after a view
 * swap and after each edit of the map under it. Returns the stop, which ends the curve.
 */
export function watchCurveSession(): () => void {
  const bus = useEditorStore.getState().eventBus;
  const close = (): void => editorCurves.end();
  const closeStale = (): void => {
    const key = editorCurves.get()?.armingKey;
    if (key !== undefined && key !== curveArmingKey(armingOf(useEditorStore.getState()))) close();
  };
  const offStore = useEditorStore.subscribe(closeStale);
  const offSession = editorCurves.subscribe(closeStale);
  bus.on('history-applied', close);
  const offFootprint = editorCurves.showFootprintOn(() => getActiveView()?.overlay, (tell) => {
    const offView = onActiveViewChange(tell);
    const offEdits = onMapEdited(bus, tell);
    return () => { offView(); offEdits(); };
  });
  return () => {
    offFootprint();
    bus.off('history-applied', close);
    offSession();
    offStore();
    close();
  };
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
    blueprintPlaced: armedBlueprintPlaced,
    placementDrag: selectedGroupDrag,
    tagLabel: (tag) => { const s = store(); return tagLabel(tag, s.locale, s.gridState?.annotations?.customTags); },
    // Smart Build runs in the worker pool where there is one; each manager gets its own port, which a
    // pool that stops answering clears.
    ...(poolAvailable() ? { offThread: { build: runMacroBuildInPool, preview: runPreviewInPool } } : {}),
  };
}
