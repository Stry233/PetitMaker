export interface HelpTarget { page: string; anchor?: string }
export const HELP_ATTR = 'data-help';
export const HELP_ANCHOR_ATTR = 'data-help-anchor';

export function helpAttributes(target?: HelpTarget): Record<string, string> {
  return target ? { [HELP_ATTR]: target.page, ...(target.anchor ? { [HELP_ANCHOR_ATTR]: target.anchor } : {}) } : {};
}

/** Portaled controls inherit the help destination of their trigger. */
export function inheritedHelpTarget(element: Element | null): HelpTarget | undefined {
  const owner = element?.closest(`[${HELP_ATTR}]`);
  const page = owner?.getAttribute(HELP_ATTR);
  return page ? { page, anchor: owner?.getAttribute(HELP_ANCHOR_ATTR) || undefined } : undefined;
}
