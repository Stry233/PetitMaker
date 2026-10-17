/**
 * The save file's export from the live map: which sections the choices carry, their sizes measured
 * once over the undo entries, and the file written and downloaded. The window keeps its choices,
 * the responsibility notice and the map check, and the paint before a long history is serialized.
 */
import type { GridState, MapNotes } from '../../core/model/types';
import type { Locale } from '../../core/model/locale';
import { isCustomTemplate } from '../../core/model/planet';
import { needsTextReview, type TextPart } from '../../pipelines/moderation/facts';
import { persistedCamera } from '../../io/save/camera';
import { carrying, serializeWithSections, sectionSizeFormats, type ExportJsonOptions, type SectionSizes } from '../../io/save/sections';
import { downloadBlob, downloadJSON, exportFileName, safeName } from '../../io/export/download';
import { exportableState } from '../../io/export/exportable';
import {
  exportOptionsFor, historyDepthSteps, measuringOptions, type HistoryDepth, type JsonSectionAvailability, type JsonSections,
} from '../../io/export/json-sections';
import { showToast } from '../../platform/channels/toast-bus';
import { translate } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import type { LoadedOriginal } from '../../state/slices/repair-session';
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

/** The name a save file of `state` downloads under: its planet and the moment of the download. */
export function saveFileName(state: GridState, locale: Locale): string {
  return exportFileName([isCustomTemplate(state.template) ? safeName(shownPlanetName(state.template, locale)) : state.template.id, Date.now()], 'json');
}

/** Downloads the map a load brought, unrepaired (`LoadedOriginal`): a file as it was read, else the
 *  map as a save file carrying its own notes, annotations, recipe and provenance; whether it was
 *  written. Reads nothing of the live map and leaves its exported mark alone. Run after the notice
 *  was confirmed. */
export function downloadOriginal(original: LoadedOriginal): boolean {
  try {
    if (original.kind === 'file') {
      const ext = original.format === 'json' ? 'json' : original.file.type.split('/')[1] || 'png';
      downloadBlob(original.file, original.name || exportFileName(['map', Date.now()], ext));
    } else {
      const { state } = original;
      const locale = useEditorStore.getState().locale;
      const carry = carrying('annotations', 'notes', ...(state.generation ? ['generation' as const] : []), ...(state.provenance ? ['provenance' as const] : []));
      downloadJSON(serializeWithSections(exportableState(state, planetNaming(locale)), { carry, pretty: false }), saveFileName(state, locale));
    }
    const image = original.kind === 'file' && original.format === 'image';
    showToast(translate(image ? 'toast.exported_image' : 'toast.exported_json'), 'info');
    return true;
  } catch (e) {
    showToast(translate('toast.export_failed', { detail: e instanceof Error ? e.message : translate('error.unknown') }), 'error');
    return false;
  }
}

/** Writes and downloads the save file the choices make, raising the result's notice; whether it was
 *  written. Run after the notice was confirmed and the map check passed. */
export function writeJsonExport(sections: JsonSections, available: JsonSectionAvailability, notes: MapNotes | null): boolean {
  const { gridState: state, commandExecutor: executor, locale } = useEditorStore.getState();
  if (!state || !executor) return false;
  try {
    const opts = exportOptionsFor(sections, available, notes, { history: () => executor.getUndoEntries(), session: liveSession });
    const json = serializeWithSections(exportableState(state, planetNaming(locale)), opts);
    downloadJSON(json, saveFileName(state, locale));
    useEditorStore.getState().markExported();
    showToast(translate('toast.exported_json'), 'info');
    return true;
  } catch (e) {
    showToast(translate('toast.export_failed', { detail: e instanceof Error ? e.message : translate('error.unknown') }), 'error');
    return false;
  }
}
