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
 *
 * `view` is the second host action, and the THREE 3D STEPS sit in the middle of the run rather than
 * in a tour of their own: the 3D editor is the same map and the same tools, so it belongs where the
 * tools were just shown, not behind a second first-launch offer nobody would meet twice. The flip
 * rides `view3d`, the step that points AT the toggle — its card is anchored to a rail button, which
 * stands over either canvas, so the scene can build and fly in behind a bubble that is never
 * measured against it. The step AFTER the block lays the map flat again, the way the last step
 * clears the build mode: a novice should end the run in the view the editor opens in.
 */
import type { TourStep } from '../chrome/tour/steps';

export const SHELL_TOUR_STEPS: readonly TourStep[] = [
  { id: 'welcome',      titleKey: 'tour.welcome_title',      bodyKey: 'tour.welcome_body',                                  side: 'below', brand: true },
  { id: 'camera',       titleKey: 'tour.camera_title',       bodyKey: 'tour.camera_body',                                   side: 'below' },
  { id: 'modes',     titleKey: 'tour.modes_title',         bodyKey: 'tour.modes_body',         target: 'modes',         side: 'below' },
  { id: 'bar',       titleKey: 'tour.tools_title',       bodyKey: 'tour.tools_body',       target: 'bar',           side: 'above', mode: 'mountain' },
  { id: 'view3d',    titleKey: 'tour.view3d_title',    bodyKey: 'tour.view3d_body',    target: 'view3d',        side: 'left', view: '3d' },
  { id: 'orbit',     titleKey: 'tour.orbit_title',     bodyKey: 'tour.orbit_body',                              side: 'below' },
  { id: 'build3d',   titleKey: 'tour.build3d_title',   bodyKey: 'tour.build3d_body',                             side: 'below' },
  { id: 'assistant', titleKey: 'tour.assistant_title', bodyKey: 'tour.assistant_body', target: 'assistant',     side: 'below', view: '2d' },
  { id: 'share',     titleKey: 'tour.share_title',     bodyKey: 'tour.share_body',     target: 'share',         side: 'below' },
  { id: 'menu',      titleKey: 'tour.menu_title',      bodyKey: 'tour.menu_body',      target: 'menu',          side: 'below', mode: null },
];

/** The steps this device can actually be shown. three needs WebGL2: where there is none the 3D
 *  block would spend three cards on a view that cannot build, so the run keeps the 2D interface it
 *  is about and the toggle says the rest itself. */
export function shellTourSteps(webgl2: boolean): readonly TourStep[] {
  if (webgl2) return SHELL_TOUR_STEPS;
  return SHELL_TOUR_STEPS.filter((s) => s.id !== 'view3d' && s.id !== 'orbit' && s.id !== 'build3d');
}
