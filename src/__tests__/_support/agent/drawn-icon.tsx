/** Which assistant mark an element draws: a sprite symbol by its `<use>`, a set mark by its drawing. */
import { renderToStaticMarkup } from 'react-dom/server';
import { Icon, type SetMarkId } from '../../../ui/agent/parts/sprite';

/** Every set mark id, as a runtime list `tsc` keeps complete. */
const SET_MARK_IDS: Record<SetMarkId, true> = {
  'pw-check': true, 'pw-cross': true, 'pw-chevron': true, 'pw-question': true, 'pw-warning': true, 'pw-link-out': true,
};
export const setMarkIds = Object.keys(SET_MARK_IDS) as SetMarkId[];

const shapes = (markup: string): string => [...markup.matchAll(/<(path|circle|rect)\b[^>]*>/g)].map((m) => m[0].replace(/\s*\/?>$/, '')).join('|');

/** The id of the first mark inside `root` (or `root` itself), or null where it draws none. */
export function drawnIcon(root: Element | null | undefined): string | null {
  if (!root) return null;
  const use = root.querySelector('use');
  if (use) return use.getAttribute('href')?.replace(/^#/, '') ?? null;
  const svg = root instanceof SVGSVGElement ? root : root.querySelector('svg');
  if (!svg) return null;
  const drawn = shapes(svg.innerHTML);
  return setMarkIds.find((id) => shapes(renderToStaticMarkup(<Icon id={id} />)) === drawn) ?? null;
}
