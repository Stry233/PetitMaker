// The app's one autosave, reading the cameras from the view host and the undo stack from the store.
import { createAutosave } from '../../io/storage/autosave';
import { persistedCamera } from '../../io/save/camera';
import { host } from '../host/host';
import { useEditorStore } from '../../state/store';

export const autosave = createAutosave({
  camera: () => persistedCamera(host.camera.get2d(), host.camera.get3d()),
  history: (state) => {
    const { commandExecutor: executor, gridState } = useEditorStore.getState();
    if (!executor || (gridState && gridState !== state)) return undefined;
    return executor.getUndoEntries();
  },
});
