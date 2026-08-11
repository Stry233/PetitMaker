/*
 * The first-launch tour's SHAPE: what a step is, and how an element says it can be pointed at.
 *
 * A step names an i18n key pair and a TARGET, never a position: the overlay measures the target
 * element at runtime, because the menu scale, the chrome zoom and the persisted uiZoom each move
 * this chrome independently. The MACHINERY is here and in `TourOverlay`/`use-tour`; the CONTENT is
 * the shell's, since what a step can point at is whatever the interface draws (`ui/shell/tour-steps`).
 * Adding a step is one entry there plus its keys in the seven locales.
 */
import type { BuildMode } from '../../../core/model/edit-mode';

export type TourStepId =
  | 'welcome' | 'camera'
  | 'modes' | 'bar' | 'assistant' | 'share' | 'menu';

/** The elements a step can point at. Each is carried by exactly one element, via `tourTargetAttr`. */
export type TourTargetId =
  | 'modes' | 'bar' | 'assistant' | 'share' | 'menu';

export interface TourStep {
  id: TourStepId;
  titleKey: string;
  bodyKey: string;
  /** The element this step points at. OMITTED for a step about the app as a whole: the map fills
   *  the viewport, and a spotlight on everything is a spotlight on nothing (it would leave the dim
   *  entirely off screen and push the bubble past the edge). Such a step dims the whole app and
   *  centres its bubble instead. */
  target?: TourTargetId;
  /** Which side of the target the bubble prefers, for a step that HAS a target. The overlay honours
   *  it only where the bubble actually fits beside the spotlight; otherwise it places the bubble on
   *  a side that does fit (see `place-bubble`). */
  side: 'left' | 'right' | 'above' | 'below';
  /** The build mode the shell selects as this step becomes current, applied by the shell's host.
   *  The bottom bar IS the selected mode's, so a step about the tools has nothing in the DOM to
   *  point at until the mode is on; `null` clears it, which is how the run ends with the interface
   *  at rest. Absent means leave it alone, so the two states are distinct. */
  mode?: BuildMode;
  /** The step shows the brand lockup above its title: the tour's opening step is the app introducing
   *  itself. The logo alone, without the name (see `BrandLockup`'s `logoOnly`). */
  brand?: boolean;
}

/** Mark an element as a tour target. Spread onto the element: `<div {...tourTargetAttr('menu')} />`. */
export function tourTargetAttr(id: TourTargetId): { 'data-tour-target': TourTargetId } {
  return { 'data-tour-target': id };
}
