/*
 * How the interface points into the Help Center: a surface marks itself with `helpTargetAttr`, and
 * `openHelp` is the one deep link.
 */
import { pressCommand } from '../../editor/commands/run';
import type { HelpPageId } from '../../editor/help/page-schema';

import { helpAttributes, inheritedHelpTarget } from '../primitives/help-target';

/** Spread onto the element a help page describes. Typed by the page union, so a marker cannot
 *  name a page that does not exist. */
export function helpTargetAttr(page: HelpPageId, anchor?: string): Record<string, string> {
  return helpAttributes({ page, anchor });
}

/** The one door into the Help Center: presses `window.open` for Help at `page`, and at `anchor` on it. */
export function openHelp(page: HelpPageId, anchor?: string): void {
  pressCommand('window.open', anchor ? { window: 'help', page, anchor } : { window: 'help', page });
}

/** Resolve the foreground surface only; an unmarked panel must not expose controls behind it. */
export function helpTargetAt(x: number, y: number, layer: HTMLElement): { page: string; anchor?: string; el: Element } | null {
  const foreground = document.elementsFromPoint(x, y).find(el => el !== layer && !layer.contains(el));
  if (!foreground) return null;
  const target = inheritedHelpTarget(foreground);
  if (!target) return null;
  return { ...target, el: foreground.closest('[data-help]')! };
}
