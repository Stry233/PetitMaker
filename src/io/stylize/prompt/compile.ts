/**
 * Assembles one prompt string from: which condition images this call sends (role labels for the
 * model to read them by), the preserve-list contract, the chosen direction's own language, and
 * the map's own scene clauses. The wire order that actually places these images (dialects/*) is
 * style, layout, source last — the labels here describe them in that same order.
 */
import { CUSTOM_DIRECTION_ID, STYLE_PACKS, type DirectionId } from '../presets';
import { BASE_CONTRACT, CUSTOM_PROMPT_MAX } from '../prompt';
import { quotePromptData } from '../../../core/runtime/prompt-data';
import trust from './trust.md?raw';
import policy from './policy.md?raw';

/** Boundaries and content policy travel together: Gemini receives them as the system instruction, other dialects inline. */
export const STYLIZE_TRUST = `${trust.trim()}\n\n${policy.trim()}`;
export const MAX_VISUAL_FEEDBACK = 6;
export const MAX_FEEDBACK_LENGTH = 240;
const FINAL_TASK = 'Apply only compatible visual preferences and layout corrections. Preserve the original map and follow the application contract above.';

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
  feedback?: readonly string[];
}): PromptPlan {
  const { direction, customText, scene, presentCategories, images } = args;
  const parts: string[] = [];

  const roleLabels: string[] = [];
  if (images.style) roleLabels.push(images.style === 'take' ? STYLE_LABEL_TAKE : STYLE_LABEL_PACK);
  if (images.layout) roleLabels.push(LAYOUT_LABEL);
  roleLabels.push(SOURCE_LABEL);
  parts.push(roleLabels.join(' '));

  parts.push(STYLIZE_TRUST, BASE_CONTRACT);

  const pack = direction === CUSTOM_DIRECTION_ID ? null : STYLE_PACKS.find((p) => p.id === direction) ?? null;
  if (pack) {
    parts.push(pack.fragment);
  } else if (customText) {
    parts.push(`<style_preferences>${quotePromptData(customText.trim().slice(0, CUSTOM_PROMPT_MAX))}</style_preferences>`);
  }

  if (pack) {
    const clauses = Object.entries(pack.elementStyles)
      .filter((entry): entry is [string, string] => entry[1] !== undefined && presentCategories.has(entry[0]))
      .map(([category, clause]) => `${categoryLabel(category)}: ${clause}.`);
    if (clauses.length > 0) parts.push(clauses.join(' '));
  }

  if (scene.length > 0) parts.push(`The map contains: <scene_data>${quotePromptData(scene)}</scene_data>.`);

  const feedback = args.feedback?.filter((line) => typeof line === 'string' && line.trim())
    .slice(0, MAX_VISUAL_FEEDBACK).map((line) => line.trim().slice(0, MAX_FEEDBACK_LENGTH));
  if (feedback?.length) parts.push(`<visual_feedback>${quotePromptData(feedback)}</visual_feedback>`);
  parts.push(FINAL_TASK);

  return { text: parts.join(' ').trim() };
}
