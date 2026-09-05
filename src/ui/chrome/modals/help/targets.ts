/*
 * targets.ts — how the rest of the interface points INTO the Help Center.
 *
 * A surface marks itself with `helpTargetAttr(page)` (the tour's `data-tour-target` pattern): the
 * text stays in the help tables, the pointing stays local to the control it describes. `openHelp`
 * is the one deep link every "?" and pick-mode click goes through, and the pick mode resolves a
 * click on the bare map through the live edit state, so the canvas answers with the page for what
 * the hand is actually holding.
 */
import { useEditorStore } from '../../../../state/store';
import type { HelpPageId } from './page-schema';

export const HELP_ATTR = 'data-help';

/** Spread onto the element a help page describes. Typed by the page union, so a marker cannot
 *  name a page that does not exist. */
export function helpTargetAttr(page: HelpPageId): Record<string, string> {
  return { [HELP_ATTR]: page };
}

/** The one door into the Help Center: sets where it opens, then opens it. */
export function openHelp(page: HelpPageId, anchor?: string): void {
  const store = useEditorStore.getState();
  store.setHelpTarget(anchor ? { page, anchor } : { page });
  store.setWhatsThis(false);
  store.setModal('help', true);
}

/** What a pick-mode click on the BARE MAP means: the page for the thing the hand holds. A marked
 *  control answers with its own `data-help` before this is consulted. */
export function pageForEditState(edit: { mode: string | null; tool: string }): HelpPageId {
  const { mode, tool } = edit;
  if (mode === 'annotate') return 'notes';
  if (mode === 'generate') return 'generate';
  if (mode === 'object') return 'objects';
  if (mode === 'road' || mode === 'mountain' || mode === 'water') {
    if (tool === 'trim') return 'trim';
    if (tool === 'smart') return 'smart';
    return 'terrain';
  }
  return 'camera';
}
