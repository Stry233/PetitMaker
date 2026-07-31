import { create } from 'zustand';
import {
  type GridState,
  type MapTemplate,
  type EditorEvents,
  type PlacedObject,
  ToolType,
  type Locale,
  type AutoEdgeCut,
  type DesignMode,
  type RegionTool,
} from '../core/model/types';
import { createGrid, createPlazaObject } from '../core/model/grid-model';
import type { CameraAngle } from '../canvas/map3d/capture';
import { CommandExecutor } from '../core/commands/command-executor';
import { EventBus } from '../core/commands/event-bus';
import { detectPortraitBlocked } from '../core/runtime/portrait-signals';
import type { RuleRegistry } from '../rules/registry';
import { sameRef } from './selection';

export type BlockRef =
  | { kind: 'object'; id: string }
  | { kind: 'terrain'; x: number; y: number };

/** All UI locales, ordered most- to least-specific for prefix matching. */
const SUPPORTED_LOCALES: Locale[] = ['zh', 'ja', 'ru', 'th', 'id', 'fr', 'en'];

/**
 * Resolve the startup locale: an explicit saved choice wins, otherwise match the
 * browser language by prefix (e.g. `fr-CA` → `fr`, `zh-Hant` → `zh`), defaulting
 * to English.
 */
function detectLocale(): Locale {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('petit-planet-locale');
    if (saved && (SUPPORTED_LOCALES as string[]).includes(saved)) return saved as Locale;
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    const lang = navigator.language.toLowerCase();
    const match = SUPPORTED_LOCALES.find((loc) => lang.startsWith(loc));
    if (match) return match;
  }
  return 'en';
}

/** UI zoom is a per-device taste setting (monitors differ in physical px size),
 *  so it persists like the locale — set once on the big desktop, it sticks. */
function detectUiZoom(): number {
  if (typeof localStorage !== 'undefined') {
    const saved = Number(localStorage.getItem('petit-planet-ui-zoom'));
    if (Number.isFinite(saved) && saved >= 0.6 && saved <= 1.8) return saved;
  }
  return 1;
}

export const SYSTEM_CURSORS_STORAGE_KEY = 'petit-planet-system-cursors';

/** Whether to hand the pointer back to the operating system, an accessibility choice: a custom
 *  CSS cursor is an image, so it cannot honour the cursor size or theme the user configured.
 *  Persisted. */
function detectSystemCursors(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(SYSTEM_CURSORS_STORAGE_KEY) === '1';
}

/** Every overlay the editor can open. Adding a modal is one member here plus its component. */
export type ModalId =
  | 'help' | 'settings' | 'about' | 'newProject'
  | 'preview3d' | 'export' | 'exportJson' | 'import' | 'tourDone';

export type ViewMode = '2d' | '3d';
export const VIEW_MODE_STORAGE_KEY = 'petit-planet-view-mode';

/** The map view mode persists like the locale: a per-device preference the
 *  editor reopens in. Anything unrecognized falls back to the 2D map. */
export function detectViewMode(): ViewMode {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(VIEW_MODE_STORAGE_KEY) === '3d') return '3d';
  return '2d';
}

export interface EditorStore {
  gridState: GridState | null;
  eventBus: EventBus<EditorEvents>;
  commandExecutor: CommandExecutor | null;
  activeTool: ToolType;
  // The current UI tool/mode (brush/line/.../eraser/hand/edge-cut). Single source
  // of truth — PixiCanvas derives DrawingTool.mode from this for drawing modes.
  designMode: DesignMode;
  contentType: 'mountain' | 'water' | 'tile';
  tileMaterial: 'dirt' | 'stone';
  autoEdgeCut: AutoEdgeCut;     // auto corner-trim mode for the build brushes
  activeLayer: number;          // build floor: the layer the user explicitly selected
  displayLayer: number | null;  // transient pill highlight while auto-stacking (null → activeLayer)
  layerVisibility: Record<number, boolean>;
  layerLocked: Record<number, boolean>;
  brushSize: number;
  uiZoom: number;  // UI scale multiplier (Ctrl +/-), independent of the map zoom
  locale: Locale;
  showGrid: boolean;
  showChunkBounds: boolean;
  showLayerNumbers: boolean;
  /** Which renderer shows the map: the 2D PixiJS view or the 3D editor. */
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  /** Which overlays are open. One home for every modal, so opening one from a place that has no
   *  React tree (a keyboard command, an agent tool) is the same call as opening it from a button.
   *  Several can be open at once: About opens over Settings and closing it returns there. */
  modals: Record<ModalId, boolean>;
  setModal: (id: ModalId, open: boolean) => void;
  /** Whether the "please rotate" overlay covers the app right now, including its dismiss. Single-
   *  sourced here (rather than each caller running its own `usePortraitGuard()`) so a "continue
   *  anyway" tap and the tour's own gate always agree — two independent hook instances each hold
   *  their own dismiss state and can disagree about it forever. `PortraitGuard` is the one writer;
   *  everything else reads the store. */
  portraitBlocked: boolean;
  setPortraitBlocked: (v: boolean) => void;
  /** Whether the first-launch tour is running. Beside `modals` because it is an overlay like any
   *  other, and because Settings and the startup check both open it from outside a React tree. */
  tourRunning: boolean;
  setTourRunning: (running: boolean) => void;
  /** Whether the phone card is the collapsed icon rather than the open menu. The app opens
   *  collapsed. It lives here rather than in the menu's own hook because two systems read it now:
   *  the host renders from it, and the tour advances its "tap the phone" / "press the bar" steps
   *  when the visitor actually does it. */
  menuCollapsed: boolean;
  setMenuCollapsed: (collapsed: boolean) => void;
  /** Export "3D shots" menu: the session's chosen camera angles (1..5). Seeded lazily. */
  export3dShots: CameraAngle[];
  /** When set, Preview3D opens in edit mode to set shot `index`, seeded at `angle`. */
  preview3DEdit: { index: number; angle: CameraAngle } | null;
  /** Animation preference. 'system' follows the OS prefers-reduced-motion; the
   *  others override it. */
  motionPref: 'system' | 'reduced' | 'full';
  /** Draw the pointer with the OS cursors instead of the app's own set, everywhere: the DOM
   *  reads it through `ui/cursors/cursor-vars`, the canvas through the cursor controller. */
  systemCursors: boolean;
  selectingRegion: boolean;
  regionTool: RegionTool;
  regionBrushSize: number;
  setSelectingRegion: (v: boolean) => void;
  setRegionTool: (t: RegionTool) => void;
  setRegionBrushSize: (s: number) => void;
  initMap: (template: MapTemplate, registry: RuleRegistry) => void;
  loadMap: (state: GridState, registry: RuleRegistry) => void;
  setActiveTool: (tool: ToolType) => void;
  setDesignMode: (mode: DesignMode) => void;
  setContentType: (type: 'mountain' | 'water' | 'tile') => void;
  setTileMaterial: (m: 'dirt' | 'stone') => void;
  setAutoEdgeCut: (m: AutoEdgeCut) => void;
  setActiveLayer: (layer: number) => void;
  setDisplayLayer: (layer: number | null) => void;
  setLayerVisibility: (layer: number, visible: boolean) => void;
  setLayerLocked: (layer: number, locked: boolean) => void;
  setBrushSize: (size: number) => void;
  setUiZoom: (zoom: number) => void;
  setLocale: (locale: Locale) => void;
  setShowGrid: (show: boolean) => void;
  setShowChunkBounds: (show: boolean) => void;
  setShowLayerNumbers: (show: boolean) => void;
  setExport3dShots: (next: CameraAngle[]) => void;
  setPreview3DEdit: (v: { index: number; angle: CameraAngle } | null) => void;
  setMotionPref: (p: 'system' | 'reduced' | 'full') => void;
  setSystemCursors: (on: boolean) => void;
  selectedItemId: string | null;
  setSelectedItemId: (id: string | null) => void;
  /** The armed item's PENDING rotation — turned by the rotate shortcuts while its ghost is showing,
   *  read by the ghost preview and the placement it lands. Lives here (not the placer tool instance)
   *  because the shortcut engine, the ghost preview, and the placement command are three separate
   *  call sites that all need it, and only two of those touch a tool at all. Reset by
   *  `setSelectedItemId` — a fresh item starts at its natural orientation, and it doesn't matter what
   *  it reads while nothing is armed. */
  placementRotation: 0 | 90 | 180 | 270;
  setPlacementRotation: (r: 0 | 90 | 180 | 270) => void;
  /**
   * The selected blocks, in the order they were added. `[]` is the ONE representation of
   * "nothing selected"; there is no scalar beside this list. A consumer that can only express one
   * member reads `selection.singleSelection`.
   */
  selection: BlockRef[];
  setSelection: (next: BlockRef[]) => void;
  toggleSelection: (ref: BlockRef) => void;
  clearSelection: () => void;
  contextMenu: { x: number; y: number; target: BlockRef } | null;
  setContextMenu: (menu: { x: number; y: number; target: BlockRef } | null) => void;
  /** The block targeted by the delete-confirmation popover; null hides it. */
  deletePopover: BlockRef | null;
  setDeletePopover: (sel: BlockRef | null) => void;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  gridState: null,
  eventBus: new EventBus<EditorEvents>(),
  commandExecutor: null,
  activeTool: ToolType.Hand,
  designMode: 'hand' as DesignMode,
  contentType: 'mountain' as const,
  tileMaterial: 'dirt' as const,
  autoEdgeCut: 'off' as AutoEdgeCut,
  activeLayer: 0,   // Ground selected by default — an empty map shows only Ground (build floors to 1)
  displayLayer: null,
  layerVisibility: {} as Record<number, boolean>,
  layerLocked: {} as Record<number, boolean>,
  brushSize: 1,
  uiZoom: detectUiZoom(),
  motionPref: 'system',
  systemCursors: detectSystemCursors(),
  locale: detectLocale(),
  showGrid: true,
  showChunkBounds: true,
  showLayerNumbers: false,
  viewMode: detectViewMode(),
  modals: { help: false, settings: false, about: false, newProject: false, preview3d: false, export: false, exportJson: false, import: false, tourDone: false },
  setModal: (id, open) => set((st) => (st.modals[id] === open ? st : { modals: { ...st.modals, [id]: open } })),
  // Seeded from the live device signals, not from `false`: passive effects flush children-first,
  // so PortraitGuard's mirror-write and the tour's first-launch check land in the SAME flush and
  // the check would read the pre-mount default, latch its once-only ref and start the tour under
  // the rotate overlay.
  portraitBlocked: detectPortraitBlocked(),
  // No-ops when unchanged: a resize storm re-evaluates the same boolean many times a second, and
  // publishing each identical read would re-render the whole tree on every tick.
  setPortraitBlocked: (v) => set((st) => (st.portraitBlocked === v ? st : { portraitBlocked: v })),
  tourRunning: false,
  setTourRunning: (running) => set({ tourRunning: running }),
  menuCollapsed: true,
  setMenuCollapsed: (collapsed) => set((st) => (st.menuCollapsed === collapsed ? st : { menuCollapsed: collapsed })),
  export3dShots: [],
  preview3DEdit: null,
  selectingRegion: false,
  regionTool: 'brush' as const,
  regionBrushSize: 3,
  setSelectingRegion: (v) => set({ selectingRegion: v }),
  setRegionTool: (t) => set({ regionTool: t }),
  setRegionBrushSize: (s) => set({ regionBrushSize: s }),

  initMap: (template, registry) => {
    const cells = createGrid(template);
    const objects = new Map<string, PlacedObject>();
    const plaza = createPlazaObject(template);
    if (plaza) objects.set(plaza.id, plaza);
    const gridState: GridState = {
      template,
      cells,
      objects,
      lockedLayers: new Set(),
    };
    const { eventBus } = get();
    const executor = new CommandExecutor(gridState, eventBus, registry);
    set({
      gridState,
      commandExecutor: executor,
      activeLayer: 0,      // a fresh map opens with Ground selected, not an empty Layer 1
      displayLayer: null,
      // Per-map layer state: carrying the old map's locks/hidden layers over would
      // show a lock the rules don't enforce (the gridState mirror only re-syncs on
      // change) and hide fresh paint with no visible cause.
      layerVisibility: {},
      layerLocked: {},
    });
  },

  loadMap: (gridState, registry) => {
    const { eventBus } = get();
    const executor = new CommandExecutor(gridState, eventBus, registry);
    set({
      gridState,
      commandExecutor: executor,
      layerVisibility: {},
      layerLocked: {},
    });
  },

  setActiveTool: (tool) => {
    set({ activeTool: tool, displayLayer: null });
    get().eventBus.emit('tool-changed', { tool });
  },
  setDesignMode: (mode) => set({ designMode: mode, displayLayer: null }),
  setContentType: (type) => set({ contentType: type, displayLayer: null }),
  setTileMaterial: (m) => set({ tileMaterial: m }),
  setAutoEdgeCut: (m) => set({ autoEdgeCut: m }),
  setActiveLayer: (layer) => set({ activeLayer: layer, displayLayer: null }),
  setDisplayLayer: (layer) => set((s) => (s.displayLayer === layer ? s : { displayLayer: layer })),
  setLayerVisibility: (layer, visible) => set((s) => ({
    layerVisibility: { ...s.layerVisibility, [layer]: visible },
  })),
  setLayerLocked: (layer, locked) => set((s) => ({
    layerLocked: { ...s.layerLocked, [layer]: locked },
  })),
  setBrushSize: (size) => set({ brushSize: size }),
  setUiZoom: (zoom) => {
    const z = Math.max(0.6, Math.min(1.8, +zoom.toFixed(2)));
    set({ uiZoom: z });
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petit-planet-ui-zoom', String(z));
    }
  },
  setMotionPref: (p) => set({ motionPref: p }),
  setSystemCursors: (on) => {
    set({ systemCursors: on });
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SYSTEM_CURSORS_STORAGE_KEY, on ? '1' : '0');
    }
  },

  setLocale: (locale) => {
    set({ locale });
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petit-planet-locale', locale);
    }
  },

  setShowGrid: (show) => set({ showGrid: show }),
  setShowChunkBounds: (show) => set({ showChunkBounds: show }),
  setShowLayerNumbers: (show) => set({ showLayerNumbers: show }),
  setViewMode: (mode) => {
    set({ viewMode: mode });
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    }
  },
  setExport3dShots: (next) => set({ export3dShots: next }),
  setPreview3DEdit: (v) => set({ preview3DEdit: v }),
  selectedItemId: null,
  setSelectedItemId: (id) => set({ selectedItemId: id, placementRotation: 0 }),
  placementRotation: 0,
  setPlacementRotation: (r) => set({ placementRotation: r }),
  selection: [],
  setSelection: (next) => set({ selection: next }),
  toggleSelection: (ref) => set((s) => ({
    selection: s.selection.some((r) => sameRef(r, ref))
      ? s.selection.filter((r) => !sameRef(r, ref))
      : [...s.selection, ref],
  })),
  // Guarded so clearing an already-empty selection publishes no store update: subscribers to
  // `selection` would otherwise see a fresh `[]` identity on every menu navigation and tool switch.
  clearSelection: () => { if (get().selection.length > 0) set({ selection: [] }); },
  // Neither floating surface OPENS while the tour runs. The tour is not modal — its dim takes no
  // pointer events, and working the real controls under it is how two steps advance — but both of
  // these sit at z.contextMenu, three orders of magnitude above z.tour, so either would paint over
  // the walkthrough it interrupted. Closing is always allowed. The gate is here rather than at the
  // call sites because they are a right-click, a selection corner handle and a keybinding, and the
  // next one to be added would not know to carry it.
  contextMenu: null,
  // A refusal returns `s` itself, not `{}`: zustand notifies every subscriber of a new state
  // object either way, but `Object.is(s, s)` lets `set` skip that notification entirely.
  setContextMenu: (menu) => set((s) => (menu && s.tourRunning ? s : { contextMenu: menu })),
  deletePopover: null,
  setDeletePopover: (sel) => set((s) => (sel && s.tourRunning ? s : { deletePopover: sel })),
}));
