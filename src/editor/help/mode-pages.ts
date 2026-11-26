/** Which Help page teaches what the hand holds: the one map from a build mode, and the tool armed in it, to its page. */
import { isContentMode, type BuildMode } from '../../state/editing/edit-mode';
import type { HelpPageId } from './page-schema';

/** The page each build mode's surface teaches; the three terrain surfaces share one. */
export const MODE_HELP_PAGE: Readonly<Record<Exclude<BuildMode, null>, HelpPageId>> = {
  object: 'objects',
  road: 'terrain',
  mountain: 'terrain',
  water: 'terrain',
  blueprint: 'blueprint',
  generate: 'generate',
  annotate: 'notes',
};

/** The page for an edit state: the mode's own, the trim's or Smart Build's where a terrain surface
 *  arms that tool, and the camera's with no mode armed. */
export function pageForEditState(edit: { mode: BuildMode; tool: string }): HelpPageId {
  const { mode, tool } = edit;
  if (mode === null) return 'camera';
  if (isContentMode(mode)) {
    if (tool === 'trim') return 'trim';
    if (tool === 'smart') return 'smart';
  }
  return MODE_HELP_PAGE[mode];
}
