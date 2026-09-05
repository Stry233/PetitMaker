/**
 * Assembles one prompt string from: which condition images this call sends (role labels for the
 * model to read them by), the preserve-list contract, the chosen direction's own language, and
 * the map's own scene clauses. The wire order that actually places these images (dialects/*) is
 * style, layout, source last — the labels here describe them in that same order.
 */
import { CUSTOM_DIRECTION_ID, STYLE_PACKS, type DirectionId } from '../presets';
import { BASE_CONTRACT } from '../prompt';

/** `style` names WHAT the style image is: a pack's own sample ('pack', whose content must never
 *  leak) or an earlier take of this very map ('take', whose whole treatment is to be matched). */
export interface ConditionImages { source: true; style?: 'pack' | 'take' | false; layout?: boolean }
export interface PromptPlan { text: string }

const SOURCE_LABEL = 'The last image is the planning map to redraw.';
const STYLE_LABEL_PACK =
  'Image 1 is a style sample drawn in the desired style: take its palette, brushwork, lighting and overall treatment; never copy any object, shape or composition from it.';
const STYLE_LABEL_TAKE =
  'Image 1 is an earlier illustration of the SAME map in the desired style: match its palette, brushwork, lighting and overall treatment exactly, so the two read as one artist\'s work. Where it and the last image disagree about content, the last image wins.';
const LAYOUT_LABEL =
  'One image is a flat-color layout legend of the same map: green means trees, blue water, red buildings, tan roads, cream open ground; follow its regions exactly.';

/** 'water-feature' -> 'Water feature'; the plain English label a clause is filed under. */
function categoryLabel(category: string): string {
  const spaced = category.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function compilePrompt(args: {
  direction: DirectionId;
  customText?: string;
  scene: string[];
  presentCategories: ReadonlySet<string>;
  images: ConditionImages;
}): PromptPlan {
  const { direction, customText, scene, presentCategories, images } = args;
  const parts: string[] = [];

  const roleLabels: string[] = [];
  if (images.style) roleLabels.push(images.style === 'take' ? STYLE_LABEL_TAKE : STYLE_LABEL_PACK);
  if (images.layout) roleLabels.push(LAYOUT_LABEL);
  roleLabels.push(SOURCE_LABEL);
  parts.push(roleLabels.join(' '));

  parts.push(BASE_CONTRACT);

  const pack = direction === CUSTOM_DIRECTION_ID ? null : STYLE_PACKS.find((p) => p.id === direction) ?? null;
  if (pack) {
    parts.push(pack.fragment);
  } else if (customText) {
    parts.push(`Style: ${customText}`);
  }

  if (pack) {
    const clauses = Object.entries(pack.elementStyles)
      .filter((entry): entry is [string, string] => entry[1] !== undefined && presentCategories.has(entry[0]))
      .map(([category, clause]) => `${categoryLabel(category)}: ${clause}.`);
    if (clauses.length > 0) parts.push(clauses.join(' '));
  }

  if (scene.length > 0) parts.push(`The map contains: ${scene.join('; ')}.`);

  return { text: parts.join(' ').trim() };
}
