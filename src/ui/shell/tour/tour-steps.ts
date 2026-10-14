/*
 * What the tour says about this interface; the machinery is `ui/chrome/tour/`. `mode` asks the host for a
 * mode (never Generate, whose bar would start building), the last step clearing it. `view` flips to 3D for
 * the three 3D steps in the middle, the step after them laying the map flat again.
 */
import { forEdition, type EditionVariant } from '../../../platform/build/edition';
import type { TourStep } from '../../chrome/tour/steps';

/** A step with the facts that decide where it is shown: `needsWebGL2` for a step about the 3D view,
 *  `lite` for the offline edition, which has no assistant and saves through the share window. */
type ShellTourEntry = TourStep & EditionVariant<TourStep> & { needsWebGL2?: true };

const STEPS = [
  { id: 'welcome',      titleKey: 'tour.welcome_title',      bodyKey: 'tour.welcome_body',                                  side: 'below', brand: true },
  { id: 'camera',       titleKey: 'tour.camera_title',       bodyKey: 'tour.camera_body',                                   side: 'below' },
  { id: 'modes',     titleKey: 'tour.modes_title',         bodyKey: 'tour.modes_body',         target: 'modes',         side: 'below' },
  { id: 'bar',       titleKey: 'tour.tools_title',       bodyKey: 'tour.tools_body',       target: 'bar',           side: 'above', mode: 'mountain' },
  { id: 'view3d',    titleKey: 'tour.view3d_title',    bodyKey: 'tour.view3d_body',    target: 'view3d',        side: 'left', view: '3d', needsWebGL2: true },
  { id: 'orbit',     titleKey: 'tour.orbit_title',     bodyKey: 'tour.orbit_body',                              side: 'below', needsWebGL2: true },
  { id: 'build3d',   titleKey: 'tour.build3d_title',   bodyKey: 'tour.build3d_body',                             side: 'below', needsWebGL2: true },
  { id: 'assistant', titleKey: 'tour.assistant_title', bodyKey: 'tour.assistant_body', target: 'assistant',     side: 'below', view: '2d', lite: false },
  { id: 'share',     titleKey: 'tour.share_title',     bodyKey: 'tour.share_body',     target: 'share',         side: 'below', lite: { view: '2d', bodyKey: 'lite.save_hint' } },
  { id: 'menu',      titleKey: 'tour.menu_title',      bodyKey: 'tour.menu_body',      target: 'menu',          side: 'below', mode: null, lite: { bodyKey: 'lite.tour_menu' } },
] as const satisfies readonly ShellTourEntry[];

/** A step of this tour, named by its entry above: the one list of step ids. */
export type TourStepId = (typeof STEPS)[number]['id'];

const SHELL_TOUR: readonly ShellTourEntry[] = STEPS;

const bare = ({ needsWebGL2: _needs, lite: _lite, ...step }: ShellTourEntry): TourStep => step;

/** Every step of the web edition's run on a device with WebGL2. */
export const SHELL_TOUR_STEPS: readonly TourStep[] = SHELL_TOUR.map(bare);

const RUNS = {
  webgl2: forEdition<TourStep & { needsWebGL2?: true }>(SHELL_TOUR).map(bare),
  flat: forEdition<TourStep & { needsWebGL2?: true }>(SHELL_TOUR.filter((s) => !s.needsWebGL2)).map(bare),
};

/** The steps this device can show: without WebGL2 the 3D block is left out. */
export function shellTourSteps(webgl2: boolean): readonly TourStep[] {
  return webgl2 ? RUNS.webgl2 : RUNS.flat;
}
