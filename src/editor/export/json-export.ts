/**
 * The save file's export from the live map: which sections the choices carry, their sizes measured
 * once over the undo entries, and the file written and downloaded. The window keeps its choices,
 * the responsibility notice and the map check, and the paint before a long history is serialized.
 */
import type { MapNotes } from '../../core/model/types';
import { isCustomTemplate } from '../../core/model/planet';
import { needsTextReview, type TextPart } from '../../pipelines/moderation/facts';
import { persistedCamera } from '../../io/save/camera';
import { serializeWithSections, sectionSizeFormats, type ExportJsonOptions, type SectionSizes } from '../../io/save/sections';
import { downloadJSON, exportFileName, safeName } from '../../io/export/download';
import { exportableState } from '../../io/export/exportable';
import {
  exportOptionsFor, historyDepthSteps, measuringOptions, type HistoryDepth, type JsonSectionAvailability, type JsonSections,
} from '../../io/export/json-sections';
import { showToast } from '../../platform/channels/toast-bus';
import { translate } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { host } from '../host/host';
import { planetNaming, shownPlanetName } from '../session/planet-names';

export {
  estimatedTotal, initialSections, sectionsReducer, RECENT_HISTORY_STEPS,
  type HistoryDepth, type JsonSectionAvailability, type JsonSectionKey, type JsonSections,
} from '../../io/export/json-sections';

/** The locked layers and both views' camera poses the session section writes. */
function liveSession(): NonNullable<ExportJsonOptions['session']> {
  const state = useEditorStore.getState().gridState;
  return { lockedLayers: state ? [...state.lockedLayers] : [], camera: persistedCamera(host.camera.get2d(), host.camera.get3d()) };
}

/** The choices as the file carries them: an attributed title or description travels whatever the
 *  notes switch says. */
export function effectiveSections(chosen: JsonSections, notesLocked: boolean): JsonSections {
  return notesLocked && !chosen.notes ? { ...chosen, notes: true } : chosen;
}

/** The notes the text check must approve before they travel: none while the notes stay home. */
export function jsonReviewParts(notes: MapNotes, carried: boolean): TextPart[] {
  return carried
    ? (['title', 'description'] as const).map((field) => ({ field, text: notes[field] ?? '' })).filter((part) => needsTextReview(part.text))
    : [];
}

/** Every section's size in both formats over the live map and its undo entries, measured once; the
 *  notes are measured as they are typed. Null before a map loads. */
export function measureJsonSections(depth: HistoryDepth): { sizes: { compact: SectionSizes; pretty: SectionSizes }; historySteps: number } | null {
  const { gridState, commandExecutor, locale } = useEditorStore.getState();
  if (!gridState || !commandExecutor) return null;
  const entries = commandExecutor.getUndoEntries();
  const sizes = sectionSizeFormats(exportableState(gridState, planetNaming(locale)),
    measuringOptions({ entries, depth: historyDepthSteps(depth) }, liveSession()));
  return { sizes, historySteps: entries.length };
}

/** Writes and downloads the save file the choices make, raising the result's notice; whether it was
 *  written. Run after the notice was confirmed and the map check passed. */
export function writeJsonExport(sections: JsonSections, available: JsonSectionAvailability, notes: MapNotes | null): boolean {
  const { gridState: state, commandExecutor: executor, locale } = useEditorStore.getState();
  if (!state || !executor) return false;
  try {
    const opts = exportOptionsFor(sections, available, notes, { history: () => executor.getUndoEntries(), session: liveSession });
    const json = serializeWithSections(exportableState(state, planetNaming(locale)), opts);
    downloadJSON(json, exportFileName([isCustomTemplate(state.template) ? safeName(shownPlanetName(state.template, locale)) : state.template.id, Date.now()], 'json'));
    useEditorStore.getState().markExported();
    showToast(translate('toast.exported_json'), 'info');
    return true;
  } catch (e) {
    showToast(translate('toast.export_failed', { detail: e instanceof Error ? e.message : translate('error.unknown') }), 'error');
    return false;
  }
}
