/**
 * Display/session preferences. Persisted ones delegate to `platform/storage/prefs`'s `PREFS` table
 * (the only declaration site for a storage key). Two fields are session-only: `showLayerNumbers`, a
 * LayerPanel inspection aid rather than a Settings choice, so a fresh session starting with it off
 * is the expected state, not a lost preference; and `lastGridMode`, the grid toggle's memory.
 *
 * No field here is read by `initMap`/`setEditMode`; the cross-slice reads are `setUiZoom` asking
 * the shell slice's `inputMode` which mode's scale it sets, and `setViewMode` asking whether a Show me
 * has the view on loan (`tourBorrow`).
 */
import type { StateCreator } from 'zustand';
import type { Locale } from '../../core/model/locale';
import { GRID_MODES, readPref, removePref, writePref, type GridMode, type HintLevel, type MotionPref, type PrefId, type Quality3d, type ValueOf, type ViewMode, clampUiZoom, scaleProfileOf, UI_ZOOM_PREFS } from '../../platform/storage/prefs';
import { readLayoutShape } from '../../platform/device/layout-shape';
import type { InputMode } from '../../platform/device/input-mode';
import type { ShellSlice } from './shell';

export type { GridMode, HintLevel, Quality3d, ViewMode };

export interface PrefsSlice {
  /** The UI scale in force (Ctrl +/-), independent of the map zoom: the current input mode's and
   *  arrangement's own preference (`UI_ZOOM_PREFS`), reloaded when either switches (`shell.ts`). */
  uiZoom: number;
  /** Sets the UI scale of the input mode and arrangement in force. */
  setUiZoom: (zoom: number) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Which renderer shows the map: the 2D PixiJS view or the 3D editor. While a Show me has it on
   *  loan the preference keeps the view it found, written when the loan ends. */
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
  /** Which grid the map draws (`view/shared/viewport/view-settings.ts:shownGridOf` resolves `auto`). */
  gridMode: GridMode;
  setGridMode: (mode: GridMode) => void;
  /** The Settings tile: the next mode in `GRID_MODES`, wrapping from the last to the first. */
  cycleGridMode: () => void;
  /** The grid shortcut: off, or back to the mode it last turned off (`auto` when none was shown). */
  toggleGrid: () => void;
  /** The mode `toggleGrid` brings back: the last mode other than `off`, for this session. */
  lastGridMode: Exclude<GridMode, 'off'>;
  showChunkBounds: boolean;
  setShowChunkBounds: (show: boolean) => void;
  showLayerNumbers: boolean;
  setShowLayerNumbers: (show: boolean) => void;
}

type PersistedField = Extract<keyof PrefsSlice, PrefId>;

/** `startMode` is the input mode the store starts in (`state/store.ts` reads the device once), whose
 *  UI scale is the one in force at boot. */
export const createPrefsSlice = (startMode: InputMode): StateCreator<PrefsSlice & Pick<ShellSlice, 'inputMode' | 'layoutShape' | 'tourBorrow'>, [], [], PrefsSlice> => (set, get) => {
  /** The setter for a field stored under the pref of the same name: the store first, then storage. */
  const persisted = <K extends PersistedField>(key: K) => (value: ValueOf<K> & PrefsSlice[K]): void => {
    set({ [key]: value } as Partial<PrefsSlice>);
    writePref(key, value);
  };
  const gridMode = readPref('gridMode');
  const setGridMode = (mode: GridMode): void => {
    set(mode === 'off' ? { gridMode: mode } : { gridMode: mode, lastGridMode: mode });
    if (writePref('gridMode', mode)) removePref('legacyShowGrid');
  };
  return {
    uiZoom: readPref(UI_ZOOM_PREFS[scaleProfileOf(startMode, readLayoutShape('landscape'))]),
    setUiZoom: (zoom) => {
      const next = clampUiZoom(zoom);
      set({ uiZoom: next });
      writePref(UI_ZOOM_PREFS[scaleProfileOf(get().inputMode, get().layoutShape)], next);
    },
    locale: readPref('locale'),
    setLocale: persisted('locale'),
    viewMode: readPref('viewMode'),
    setViewMode: (mode) => {
      set({ viewMode: mode });
      if (!get().tourBorrow) writePref('viewMode', mode);
    },
    motionPref: readPref('motionPref'),
    setMotionPref: persisted('motionPref'),
    systemCursors: readPref('systemCursors'),
    setSystemCursors: persisted('systemCursors'),
    hintLevel: readPref('hintLevel'),
    setHintLevel: persisted('hintLevel'),
    quality3d: readPref('quality3d'),
    setQuality3d: persisted('quality3d'),
    gridMode,
    setGridMode,
    cycleGridMode: () => setGridMode(GRID_MODES[(GRID_MODES.indexOf(get().gridMode) + 1) % GRID_MODES.length]!),
    toggleGrid: () => { const s = get(); setGridMode(s.gridMode === 'off' ? s.lastGridMode : 'off'); },
    lastGridMode: gridMode === 'off' ? 'auto' : gridMode,
    showChunkBounds: readPref('showChunkBounds'),
    setShowChunkBounds: persisted('showChunkBounds'),
    showLayerNumbers: false,
    setShowLayerNumbers: (show) => set({ showLayerNumbers: show }),
  };
};
