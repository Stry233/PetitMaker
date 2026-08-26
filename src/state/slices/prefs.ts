/**
 * Display/session preferences. Persisted ones delegate to `core/runtime/prefs`'s `PREFS` table
 * (the only declaration site for a storage key); `showLayerNumbers` is the one session-only
 * toggle beside them — a LayerPanel inspection aid rather than a Settings choice, so a fresh
 * session starting with it off is the expected state, not a lost preference.
 *
 * Self-contained: no field here is read by `initMap`/`setEditMode`/any shell action, so this slice
 * takes no cross-slice dependency and imports nothing from `engine`/`edit`/`shell`.
 */
import type { StateCreator } from 'zustand';
import type { Locale } from '../../core/model/types';
import { readPref, writePref, type HintLevel, type MotionPref, type Quality3d, type ViewMode } from '../../core/runtime/prefs';

export type { HintLevel, Quality3d, ViewMode };

export interface PrefsSlice {
  uiZoom: number;  // UI scale multiplier (Ctrl +/-), independent of the map zoom
  setUiZoom: (zoom: number) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Which renderer shows the map: the 2D PixiJS view or the 3D editor. */
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  /** Animation preference. 'system' follows the OS prefers-reduced-motion; the
   *  others override it. */
  motionPref: MotionPref;
  setMotionPref: (p: MotionPref) => void;
  /** Draw the pointer with the OS cursors instead of the app's own set, everywhere: the DOM
   *  reads it through `ui/design/cursors/cursor-vars`, the canvas through the cursor controller. */
  systemCursors: boolean;
  setSystemCursors: (on: boolean) => void;
  /** How verbose the quick-hints panel is, 'off' hiding it entirely. */
  hintLevel: HintLevel;
  setHintLevel: (level: HintLevel) => void;
  /** The 3D scene's quality: 'auto' lets the GL probe decide (a software rasterizer renders
   *  lite), the others pin it — for a misread GPU, or a software-GL user who will pay the
   *  seconds a full frame costs there. */
  quality3d: Quality3d;
  setQuality3d: (q: Quality3d) => void;
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
  showChunkBounds: boolean;
  setShowChunkBounds: (show: boolean) => void;
  showLayerNumbers: boolean;
  setShowLayerNumbers: (show: boolean) => void;
}

export const createPrefsSlice: StateCreator<PrefsSlice, [], [], PrefsSlice> = (set) => ({
  uiZoom: readPref('uiZoom'),
  setUiZoom: (zoom) => {
    const z = Math.max(0.6, Math.min(1.8, +zoom.toFixed(2)));
    set({ uiZoom: z });
    writePref('uiZoom', z);
  },
  locale: readPref('locale'),
  setLocale: (locale) => {
    set({ locale });
    writePref('locale', locale);
  },
  viewMode: readPref('viewMode'),
  setViewMode: (mode) => {
    set({ viewMode: mode });
    writePref('viewMode', mode);
  },
  motionPref: readPref('motionPref'),
  setMotionPref: (p) => {
    set({ motionPref: p });
    writePref('motionPref', p);
  },
  systemCursors: readPref('systemCursors'),
  setSystemCursors: (on) => {
    set({ systemCursors: on });
    writePref('systemCursors', on);
  },
  hintLevel: readPref('hintLevel'),
  setHintLevel: (level) => {
    set({ hintLevel: level });
    writePref('hintLevel', level);
  },
  quality3d: readPref('quality3d'),
  setQuality3d: (q) => {
    set({ quality3d: q });
    writePref('quality3d', q);
  },
  showGrid: readPref('showGrid'),
  setShowGrid: (show) => {
    set({ showGrid: show });
    writePref('showGrid', show);
  },
  showChunkBounds: readPref('showChunkBounds'),
  setShowChunkBounds: (show) => {
    set({ showChunkBounds: show });
    writePref('showChunkBounds', show);
  },
  showLayerNumbers: false,
  setShowLayerNumbers: (show) => set({ showLayerNumbers: show }),
});
