/**
 * Resuming the session this browser saved: the offer read once as the page opens, the first edit
 * that says the visitor chose to work here instead, and the restore itself.
 */
import { readRestorableAutosave, type RestoredAutosave } from '../../io/storage/autosave';
import { adoptInstalledPlanet } from '../../io/storage/planet-library';
import { translate } from '../../i18n/context';
import { showToast } from '../../platform/channels/toast-bus';
import type { CommandExecutor } from '../../core/commands/command-executor';
import { useEditorStore } from '../../state/store';
import { host } from '../host/host';
import { loadMap } from '../operations/map';
import { watchUndoDepth } from '../operations/undo-depth';
import { editorPort } from './context';

/** The saved session worth offering back, or null. */
export function readRestoreOffer(): RestoredAutosave | null {
  return readRestorableAutosave();
}

/** Calls `onEdit` once the visitor's own work reaches the live map: its undo stack grew past the
 *  depth it had when watched, which opening a map never does. Follows the executor a map change
 *  installs; returns the stop. */
export function watchFirstEdit(onEdit: () => void): () => void {
  let executor: CommandExecutor | null = null;
  let off = (): void => {};
  const bind = (): void => {
    const s = useEditorStore.getState();
    if (s.commandExecutor === executor) return;
    off();
    off = () => {};
    executor = s.commandExecutor;
    if (!executor) return;
    const base = executor.historyDepth();
    off = watchUndoDepth(s.eventBus, executor, (depth) => { if (depth > base) onEdit(); });
  };
  const offStore = useEditorStore.subscribe(bind);
  bind();
  return () => { offStore(); off(); };
}

/** Restores `save` over the live map: the map with its planet adopted into the library, its undo
 *  history, its parked camera, and a notice when the restore cleared cells from under a landmark. */
export function restoreSession(save: RestoredAutosave): void {
  loadMap(editorPort, save.state);
  adoptInstalledPlanet(save.state);
  if (save.history?.length) useEditorStore.getState().commandExecutor?.restoreHistory(save.history);
  host.camera.queue(save.camera ?? null);
  if (save.cleared && save.cleared.objects + save.cleared.cells > 0) showToast(translate('import.warn_landmark'), 'info');
}
