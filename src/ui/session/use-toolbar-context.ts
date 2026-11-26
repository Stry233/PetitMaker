import { toolbarContextOf, type ToolbarContext } from '../../state/keymap/toolbar';
import { REST_STEP } from '../../state/slices/blueprint';
import { useEditorStore } from '../../state/store';
import { useUiPreviewPose } from '../design/preview';

/** A picture's bar as nothing stands in its place. */
const UNCOVERED = { blueprintStep: REST_STEP, selectingRegion: false, regionSelectionOwner: null, objectBrushBar: false } as const;

/** The toolbar whose keys are live; a preview pose shows its own mode's toolbar. */
export function useToolbarContext(): ToolbarContext {
  const live = useEditorStore(toolbarContextOf);
  const mode = useEditorStore(s => s.editMode.mode);
  const annotationTool = useEditorStore(s => s.annotationTool);
  const pose = useUiPreviewPose();
  return pose ? toolbarContextOf({ ...UNCOVERED, editMode: { mode: pose.mode ?? mode }, annotationTool }) : live;
}
