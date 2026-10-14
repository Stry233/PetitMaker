import { toolbarContextOf, type ToolbarContext } from '../../state/keymap/toolbar';
import { useEditorStore } from '../../state/store';
import { useUiPreviewPose } from '../design/preview';

/** The toolbar whose keys are live; a preview pose shows its own mode's toolbar. */
export function useToolbarContext(): ToolbarContext {
  const live = useEditorStore(toolbarContextOf);
  const mode = useEditorStore(s => s.editMode.mode);
  const annotationTool = useEditorStore(s => s.annotationTool);
  const pose = useUiPreviewPose();
  return pose ? toolbarContextOf({ selectingRegion: false, editMode: { mode: pose.mode ?? mode }, annotationTool }) : live;
}
