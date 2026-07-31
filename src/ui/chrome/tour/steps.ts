/*
 * The first-launch tour's content, as data.
 *
 * A step names an i18n key pair and a TARGET, never a position: the overlay measures the target
 * element at runtime, because the menu scale, the chrome zoom and the persisted uiZoom each move
 * this chrome independently. Adding a step is one entry here plus its keys in the seven locales.
 */

export type TourStepId = 'welcome' | 'camera' | 'open' | 'menu' | 'collapse' | 'layers' | 'view';

/** The elements a step can point at. Each is carried by exactly one element, via `tourTargetAttr`. */
export type TourTargetId = 'menu-collapsed' | 'menu-tiles' | 'menu-home' | 'layer-numbers' | 'view-toggle';

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
  /** What the phone card does as this step becomes current, applied by the host. The step that
   *  explains the tiles expands the card (the app opens collapsed, so the tiles are not even in the
   *  DOM before that); the LAYERS step collapses it again, one step after the pill was explained,
   *  because collapsing on entry to `collapse` would pull the home pill out from under its own
   *  spotlight. The tour therefore ends collapsed, with opening it left to the visitor.
   *
   *  No step closes a card the visitor opened themselves: a replay is started from the Settings
   *  gear, which is ON the expanded card, so putting it away would undo what they just did. The
   *  step that teaches the gesture is left OUT of such a run instead (see `skipWhen`). */
  menu?: 'expand' | 'collapse';
  /** A condition that, if it ALREADY holds when the run STARTS, means this step has nothing to
   *  teach: it is left out of the run entirely rather than shown and then advanced past, so the
   *  counter numbers the tour the visitor is actually being given. Sampled once, at the start: a
   *  step that stops applying MID-run is one they are being walked through right now. */
  skipWhen?: 'menu-open';
  /** A thing the visitor can do that counts as pressing Next: the step advances the moment the
   *  store satisfies it. The dim never takes pointer events, so the control a step points at is
   *  live, and a step that says "click the phone" should not sit there once the phone is clicked.
   *  This is a SECOND way through, not a gate: Next stays on the card for anyone who cannot work
   *  the gesture out. */
  advanceWhen?: 'menu-open' | 'menu-closed';
  /** The step shows the brand lockup above its title: the tour's opening step is the app introducing
   *  itself. The logo alone, without the name (see `BrandLockup`'s `logoOnly`). */
  brand?: boolean;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'welcome',  titleKey: 'tour.welcome_title',  bodyKey: 'tour.welcome_body',                             side: 'below', brand: true },
  { id: 'camera',   titleKey: 'tour.camera_title',   bodyKey: 'tour.camera_body',                              side: 'below' },
  { id: 'open',     titleKey: 'tour.open_title',     bodyKey: 'tour.open_body',     target: 'menu-collapsed',  side: 'right', advanceWhen: 'menu-open', skipWhen: 'menu-open' },
  { id: 'menu',     titleKey: 'tour.menu_title',     bodyKey: 'tour.menu_body',     target: 'menu-tiles',      side: 'right', menu: 'expand' },
  { id: 'collapse', titleKey: 'tour.collapse_title', bodyKey: 'tour.collapse_body', target: 'menu-home',       side: 'right', advanceWhen: 'menu-closed' },
  { id: 'layers',   titleKey: 'tour.layers_title',   bodyKey: 'tour.layers_body',   target: 'layer-numbers',   side: 'left', menu: 'collapse' },
  { id: 'view',     titleKey: 'tour.view_title',     bodyKey: 'tour.view_body',     target: 'view-toggle',     side: 'left' },
];

/** The store facts a `skipWhen` is judged against, passed in rather than read here: this file is
 *  data, and the sampling moment belongs to whoever starts the run. */
export interface TourConditions {
  menuOpen: boolean;
}

/** The steps a run will show, given how the app stands as it starts. Dropping a step here rather
 *  than skipping it once it is current is what keeps the counter honest: a run that cannot use a
 *  step reads "1 of 6", not "1, 2, 4 of 7". */
export function planRun(conditions: TourConditions): readonly TourStep[] {
  return TOUR_STEPS.filter((s) => !(s.skipWhen === 'menu-open' && conditions.menuOpen));
}

/** Mark an element as a tour target. Spread onto the element: `<div {...tourTargetAttr('menu-home')} />`. */
export function tourTargetAttr(id: TourTargetId): { 'data-tour-target': TourTargetId } {
  return { 'data-tour-target': id };
}
