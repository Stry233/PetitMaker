// The one place that wires `importFile` to the live store, so the modal's file
// picker/drop-zone and the window-level drag-drop overlay read/write the SAME accessors.
import { useEditorStore } from '../../../../state/store';
import { host } from '../../../../kit/host';
import { loadMap } from '../../../../kit/operations';
import type { ImportFileDeps } from '../../../../io/import-file';

export function getImportFileDeps(): ImportFileDeps {
  return {
    // Routed through kit/operations so an import forgets the PREVIOUS map's generation scope
    // (see kit/operations/map.ts) — loadMap builds its own default RuleRegistry.
    loadMap: (state) => loadMap(state),
    // Read fresh each call: applyOptionalSections needs the executor/state loadMap JUST
    // installed, not whatever was live before this import started.
    getSectionDeps: () => {
      const { commandExecutor, gridState, setLayerLocked } = useEditorStore.getState();
      return {
        executor: commandExecutor ?? null,
        state: gridState!,
        setLayerLocked,
        setCamera: (c) => host.camera.set2d(c),
      };
    },
  };
}
