/**
 * One memoized loader per lazy window chunk. The `React.lazy` site and the startup warm schedule
 * (`shell/warm/schedule.ts`) call the same loader, so a chunk the schedule warmed is the module the
 * window renders, and a window opened before its turn starts the load the schedule then joins.
 */
import { memoLoad } from '../../platform/async/memo-load';

export const loadPreview3D = memoLoad(() => import('./modals/export/Preview3D'));
export const loadPlanetImportWindow = memoLoad(() => import('./modals/planet/PlanetImportWindow'));
export const loadLegalDocView = memoLoad(() => import('./modals/about/LegalDocView'));
/** The 2D renderer Help's demo figures draw with; its own chunk re-exports the boot bundle's renderer. */
export const loadMapRenderer = memoLoad(() => import('../../view/map2d/scene/map-renderer'));
