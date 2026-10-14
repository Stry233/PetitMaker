/**
 * The Help Center's two lazy chunks, each with one memoized loader that the `React.lazy` site and the
 * warm schedule share. Help ranks above the frame, so the frame reaches these through its edition
 * seam (`shell/edition-surfaces.tsx`).
 */
import { memoLoad } from '../../platform/async/memo-load';
import { loadHelpTables } from '../../i18n/translations';
import { useEditorStore } from '../../state/store';

/** Help's prose for the editor's locale arrives with its window, so the first frame is never bare keys. */
const withHelpTables = <T,>(load: Promise<T>): Promise<T> =>
  Promise.all([load, loadHelpTables(useEditorStore.getState().locale)]).then(([module]) => module);

export const loadHelpModal = memoLoad(() => withHelpTables(import('./HelpModal')));
export const loadWhatsThisLayer = memoLoad(() => withHelpTables(import('./WhatsThisLayer')));
