import { useEditorStore, type EditorStore } from '../../state/store';

/** What the frame is reduced to: the whole map editor, a planet session's, or a hand repair's, whose
 *  row offers no modes (`state/editing/edit-mode.ts:modesInSession`, where a hand repair wins too). */
type FramePose = 'map' | 'planet' | 'repair';

function framePose(s: Pick<EditorStore, 'planetSession' | 'repairSession'>): FramePose {
  if (s.repairSession?.phase === 'hand') return 'repair';
  return s.planetSession !== null ? 'planet' : 'map';
}

/** The store's frame pose. */
export function useFramePose(): FramePose {
  return useEditorStore(framePose);
}
