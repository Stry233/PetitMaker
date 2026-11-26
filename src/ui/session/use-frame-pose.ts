import { useEditorStore } from '../../state/store';
import { framePose, type FramePose } from '../../state/frame-pose';

/** The store's frame pose (`state/frame-pose.ts`). */
export function useFramePose(): FramePose {
  return useEditorStore(framePose);
}
