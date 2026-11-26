/** Whether the generate shelf offers the visitor's own card for a kind, which Help's pages follow. */
import { IS_DEV_BUILD } from '../../platform/build/build-info';
import type { GenerateKind } from '../../tools/generation/facts';

/** Whether released builds offer the visitor's own card. Development builds offer every card. */
const CUSTOM_CARD_RELEASED: Readonly<Record<GenerateKind, boolean>> = { maze: true, text: true, image: false, island: true };

/** Whether the shelf offers the visitor's own card for `kind`. */
export function hasCustomCard(kind: GenerateKind, devBuild: boolean = IS_DEV_BUILD): boolean {
  return devBuild || CUSTOM_CARD_RELEASED[kind];
}
