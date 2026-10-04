import { toolbarContext } from '../../core/runtime/toolbar-bindings';
import { useEditorStore } from '../../state/store';
import { useUiPreviewPose } from '../primitives/ui-preview';

export function useToolbarContext() {
  const mode = useEditorStore(s => s.editMode.mode);
  const annotationTool = useEditorStore(s => s.annotationTool);
  const selectingRegion = useEditorStore(s => s.selectingRegion);
  const pose = useUiPreviewPose();
  return selectingRegion && !pose ? 'region' : toolbarContext(pose?.mode ?? mode, annotationTool);
}
