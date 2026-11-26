/** What a surface reads about the stored preferences without reading or writing storage: the UI
 *  scale's range, defaults, profiles and stops, the 3D quality choices, the grid tile's order and
 *  what a motion preference resolves to. */
export {
  QUALITIES_3D, TOUCH_UI_ZOOM_DEFAULT, TOUCH_WIDE_UI_ZOOM_DEFAULT, UI_SCALE_STEP, UI_ZOOM_DEFAULT, UI_ZOOM_DEFAULTS, UI_ZOOM_MAX, UI_ZOOM_MIN,
  nextGridMode, resolveReducedMotion, scaleLattice, scaleProfileOf, uiZoomStep,
} from './prefs';
