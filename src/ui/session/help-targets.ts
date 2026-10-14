/*
 * How the interface points into the Help Center: a surface marks itself with `helpTargetAttr`, `openHelp`
 * is the one deep link, and a pick on the bare map answers with the page for what the hand holds.
 */
import { useEditorStore } from '../../state/store';
import { isContentMode, type BuildMode } from '../../state/editing/edit-mode';
import type { HelpPageId } from '../help/page-schema';

import { helpAttributes, inheritedHelpTarget } from '../primitives/help-target';

/** Spread onto the element a help page describes. Typed by the page union, so a marker cannot
 *  name a page that does not exist. */
export function helpTargetAttr(page: HelpPageId, anchor?: string): Record<string, string> {
  return helpAttributes({ page, anchor });
}

/** The one door into the Help Center: sets where it opens, then opens it. */
export function openHelp(page: HelpPageId, anchor?: string): void {
  useEditorStore.getState().openHelpAt(anchor ? { page, anchor } : { page });
}

/** What a pick-mode click on the bare map means: the page for the thing the hand holds. A marked
 *  control answers with its own `data-help` before this is consulted. */
export function pageForEditState(edit: { mode: BuildMode; tool: string }): HelpPageId {
  const { mode, tool } = edit;
  if (mode === 'annotate') return 'notes';
  if (mode === 'generate') return 'generate';
  if (mode === 'object') return 'objects';
  if (isContentMode(mode)) {
    if (tool === 'trim') return 'trim';
    if (tool === 'smart') return 'smart';
    return 'terrain';
  }
  return 'camera';
}

/** Resolve the foreground surface only; an unmarked panel must not expose controls behind it. */
export function helpTargetAt(x: number, y: number, layer: HTMLElement): { page: string; anchor?: string; el: Element } | null {
  const foreground = document.elementsFromPoint(x, y).find(el => el !== layer && !layer.contains(el));
  if (!foreground) return null;
  const target = inheritedHelpTarget(foreground);
  if (!target) return null;
  return { ...target, el: foreground.closest('[data-help]')! };
}
