import { parseLegalMarkdown } from '../../legal/markdown';

/** What the legal parser makes of a link to `href`: the link it renders, or null when it renders
 *  the link's text alone. */
export function renderedLink(href: string): { href: string; external: boolean } | null {
  const [node] = parseLegalMarkdown(`[x](${href})`);
  const first = node?.t === 'p' ? node.children[0] : undefined;
  return first?.t === 'link' ? { href: first.href, external: first.external } : null;
}
