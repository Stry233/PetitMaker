// The one place that wires `importFile` to the live store, so the modal's file
// picker/drop-zone and the window-level drag-drop overlay read/write the same accessors.
import { useEditorStore } from '../../state/store';
import { host } from '../host/host';
import { loadMap } from '../operations';
import { editorPort } from './context';
import type { ImportFileDeps } from '../../io/import/file';

export function getImportFileDeps(): ImportFileDeps {
  return {
    // Routed through editor/operations so an import forgets the previous map's generation scope
    // (see editor/operations/map.ts) — loadMap builds its own default RuleRegistry.
    loadMap: (state) => loadMap(editorPort, state),
    // Read fresh each call: applyOptionalSections needs the executor/state loadMap just
    // installed, not whatever was live before this import started.
    getSectionDeps: () => {
      const { commandExecutor, gridState, setLayerLocked } = useEditorStore.getState();
      return {
        executor: commandExecutor ?? null,
        state: gridState!,
        setLayerLocked,
        setCamera: (c) => host.camera.queue(c),
      };
    },
  };
}
