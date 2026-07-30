// The one place that wires `importFile` to the live store, so the modal's file
// picker/drop-zone and the window-level drag-drop overlay read/write the SAME accessors.
import { useEditorStore } from '../../../state/store';
import { petitWindow } from '../../../core/runtime/window-bridge';
import type { ImportFileDeps } from '../../../io/import-file';

export function getImportFileDeps(): ImportFileDeps {
  return {
    loadMap: (state, registry) => useEditorStore.getState().loadMap(state, registry),
    // Read fresh each call: applyOptionalSections needs the executor/state loadMap JUST
    // installed, not whatever was live before this import started.
    getSectionDeps: () => {
      const { commandExecutor, gridState, setLayerLocked } = useEditorStore.getState();
      return {
        executor: commandExecutor ?? null,
        state: gridState!,
        setLayerLocked,
        setCamera: (c) => petitWindow().__petitSetCamera?.(c),
      };
    },
  };
}
