/*
 * tour-steps.ts — what the tour says about THIS interface.
 *
 * The machinery is `ui/chrome/tour/`: the step type, the overlay, the measurement and the bubble
 * placement. Only the content is here, because a step can point at nothing the interface does not
 * draw.
 *
 * Every step points at something LIVE. The right-hand rail is drawn art with no handlers yet, so
 * there is no step about it: a spotlight on a control that does not answer teaches the wrong thing.
 *
 * `mode` is the host action a step can ask for: the bottom bar belongs to the selected mode, so the
 * step about the tools selects one, and the last step clears it so the run ends with the interface
 * at rest. Generate is deliberately never selected — its bar photographs
 * three candidate maps the moment it appears, which is not something a tour should set running.
 */
import type { TourStep } from '../chrome/tour/steps';

export const SHELL_TOUR_STEPS: readonly TourStep[] = [
  { id: 'welcome',      titleKey: 'tour.welcome_title',      bodyKey: 'tour.welcome_body',                                  side: 'below', brand: true },
  { id: 'camera',       titleKey: 'tour.camera_title',       bodyKey: 'tour.camera_body',                                   side: 'below' },
  { id: 'modes',     titleKey: 'tour.modes_title',         bodyKey: 'tour.modes_body',         target: 'modes',         side: 'below' },
  { id: 'bar',       titleKey: 'tour.tools_title',       bodyKey: 'tour.tools_body',       target: 'bar',           side: 'above', mode: 'mountain' },
  { id: 'assistant', titleKey: 'tour.assistant_title', bodyKey: 'tour.assistant_body', target: 'assistant',     side: 'below' },
  { id: 'share',     titleKey: 'tour.share_title',     bodyKey: 'tour.share_body',     target: 'share',         side: 'below' },
  { id: 'menu',      titleKey: 'tour.menu_title',      bodyKey: 'tour.menu_body',      target: 'menu',          side: 'below', mode: null },
];
