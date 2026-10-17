/**
 * The mounted shell's own overlay/chrome state: which modals are open, the tour, the context menu /
 * delete popover / portrait guard / 3D-shots editor, and the shell's own furniture state (the
 * assistant's open flag). A shell replaces exactly this slice, so a field only one surface reads
 * still belongs here.
 *
 * Every setter here reads at most its own fields (`setContextMenu`/`setDeletePopover` read
 * `tourRunning`, which lives in this same slice). No field holds an engine handle and nothing here
 * imports `engine`; the one cross-slice call is `enterTourStep`, which applies a step through the
 * edit and prefs slices' own setters.
 */
import type { StateCreator } from 'zustand';
import type { DocId } from '../../legal/registry';
import type { BlockRef } from '../selection';
import type { CameraAngle } from '../view-camera';
import { detectPortraitBlocked } from '../../platform/device/portrait-signals';
import { BLOCKS_PORTRAIT } from '../../platform/build/edition';
import { readPref, writePref, type DockSide } from '../../platform/storage/prefs';
import type { ImportKind } from '../../io/import/kind';
import type { BuildMode } from '../editing/edit-mode';
import type { EditSlice } from './edit';
import type { PrefsSlice, ViewMode } from './prefs';

/** The save-and-share window's sections: the save file, the share picture, the build checklist. */
export type ShareSection = 'keep' | 'friend' | 'game';

/** Every overlay the editor can open. Adding a modal is one member here plus its component. */
const MODAL_IDS = [
  'help', 'keyboard', 'settings', 'about', 'newProject',
  'preview3d', 'import', 'tourDone', 'regionLoad',
  // The save-and-share window; `openShare` names the section it opens at.
  'share',
  // The dedicated stylize window, reached from the export controls' own entry group.
  'stylize',
  // The release notes a returning browser has not read yet.
  'whatsNew',
  // Import planet's window over Change Planet: from a planet file or from a game video.
  'planetImport',
  // How to move what a just-opened map held under the planet's landmarks.
  'landmarkRepair',
] as const;
export type ModalId = typeof MODAL_IDS[number];

/** Whether any window other than `except` is open. The one reading of "a modal is up"; the
 *  keyboard gate's lock in `platform/channels/overlay-state.ts` also counts the tour, the portrait guard
 *  and the what's-this layer, which are not windows. */
export function anyModalOpen(s: { modals: Record<ModalId, boolean> }, except?: ModalId): boolean {
  return MODAL_IDS.some((id) => id !== except && s.modals[id]);
}

/** A file one import surface hands to the window that reads its kind. */
export interface HandedImport { kind: Exclude<ImportKind, 'unknown'>; file: File }

/** The windows each handed kind opens over the map, all others among them closed: a map goes to
 *  Import map, a planet file to Change Planet (which reads it as From a planet file does), a video
 *  to Import planet's window over Change Planet. */
const HAND_DESTINATION: Record<HandedImport['kind'], Partial<Record<ModalId, boolean>>> = {
  map: { import: true, newProject: false, planetImport: false },
  planet: { import: false, newProject: true, planetImport: false },
  video: { import: false, newProject: true, planetImport: true },
};

export interface ShellSlice {
  /** Which overlays are open; a keyboard command, an agent tool and a button open one with the same
   *  call. Several can be open at once: About opens over Settings and closing it returns there. */
  modals: Record<ModalId, boolean>;
  setModal: (id: ModalId, open: boolean) => void;
  /** The section the save-and-share window opens at next, consumed as it opens; null opens the first. */
  shareTarget: ShareSection | null;
  setShareTarget: (section: ShareSection | null) => void;
  /** Opens the save-and-share window at `section`. */
  openShare: (section: ShareSection) => void;
  /** The document About drills into on its next open, consumed as it opens. */
  aboutTarget: DocId | null;
  setAboutTarget: (id: DocId | null) => void;
  /** Opens About at the document `target`. */
  openAbout: (target: DocId) => void;
  /** The document About opens at, cleared as it is read. */
  takeAboutTarget: () => DocId | null;
  /** Where the Help Center opens next: a page (and optionally a section anchor). Written by every
   *  deep link (`openHelp`), consumed and cleared by the modal itself, so a plain menu open (null
   *  target) lands on the page the reader last had. */
  helpTarget: { page: string; anchor?: string } | null;
  setHelpTarget: (target: { page: string; anchor?: string } | null) => void;
  /** Opens the Help Center at `target`, ending the what's-this pick. */
  openHelpAt: (target: { page: string; anchor?: string }) => void;
  /** Whether the "what's this?" pick mode covers the app: a question cursor, and the next click on
   *  a marked part of the interface opens its help page instead of acting. One flag here so the
   *  help modal's button, the overlay and Escape all speak about the same state. */
  whatsThis: boolean;
  setWhatsThis: (on: boolean) => void;
  /** Turns the what's-this pick on, closing the Help Center under it, or off. */
  toggleWhatsThis: () => void;
  /** Whether the "please rotate" overlay covers the app right now, including its dismiss.
   *  `PortraitGuard` is the one writer; the tour's gate and every other reader read it here, so a
   *  "continue anyway" tap holds for all of them. */
  portraitBlocked: boolean;
  setPortraitBlocked: (v: boolean) => void;
  /** Whether the first-launch tour is running. Settings and the startup check open it from outside
   *  a React tree. */
  tourRunning: boolean;
  setTourRunning: (running: boolean) => void;
  /** The map view the running tour borrowed; null outside a run. */
  tourView: ViewMode | null;
  /** Runs the tour from its first step and records it as seen. The view is persisted, so the run
   *  borrows the one it starts in. */
  startTour: () => void;
  /** Ends a run, recorded as seen, and gives back the borrowed view; a completed run opens the send-off. */
  finishTour: (completed: boolean) => void;
  /** Applies the build mode and map view a tour step asks for. */
  enterTourStep: (step: { mode?: BuildMode; view?: ViewMode }) => void;
  /** Whether the assistant's panel is open. Its block in the mode row is the one toggle. */
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  /**
   * Whether the panel is docked to a side edge of the window, with the rest of the interface standing
   * in what is left of the window (`ui/shell/panel-frame.ts`'s docked half).
   *
   * It is an intent, and the layout is derived from it rather than equal to it: the dock needs a
   * window wide enough for the interface beside it (`hasPinRoom`), so a narrow window stands the
   * panel free without forgetting that it was asked to dock. Persisted, unlike `assistantOpen`.
   */
  assistantPinned: boolean;
  setAssistantPinned: (pinned: boolean) => void;
  /** Which end of the window it docks at, which is part of the same intent and remembered with it:
   *  the dock's own switch control writes this, and the next session opens at the side it was left
   *  at. Read while the panel is free too, since that is the side the next dock takes. */
  assistantDockSide: DockSide;
  setAssistantDockSide: (side: DockSide) => void;
  /** Export "3D shots" menu: the session's chosen camera angles (1..5). Seeded lazily. */
  export3dShots: CameraAngle[];
  setExport3dShots: (next: CameraAngle[]) => void;
  /** When set, Preview3D opens in edit mode to set shot `index`, seeded at `angle`. */
  preview3DEdit: { index: number; angle: CameraAngle } | null;
  setPreview3DEdit: (v: { index: number; angle: CameraAngle } | null) => void;
  contextMenu: { x: number; y: number; target: BlockRef } | null;
  setContextMenu: (menu: { x: number; y: number; target: BlockRef } | null) => void;
  /** The block targeted by the delete-confirmation popover; null hides it. */
  deletePopover: BlockRef | null;
  setDeletePopover: (sel: BlockRef | null) => void;
  /**
   * The planet Change Planet shows chosen after a planet session: the saved or edited entry, or null
   * for a new planet left unsaved. Held while the window it reopened stands; closing the window drops it.
   */
  planetReturn: { chosen: string | null } | null;
  /** Ends a planet session's way back: reopens Change Planet with `chosen` selected. */
  returnToPlanets: (chosen: string | null) => void;
  /** A file waiting for the window that reads its kind; that window takes it as it opens. */
  handedImport: HandedImport | null;
  /** Opens the window that reads `hand.kind` and leaves the file there for it. */
  handImport: (hand: HandedImport) => void;
  /** The handed file if it is of `kind`, cleared as it is taken; null otherwise. */
  takeHandedImport: (kind: HandedImport['kind']) => File | null;
}

/** Records the tour as offered; a refused write leaves it to offer itself again next time. */
export function markTourSeen(): void {
  writePref('tourSeen', '1');
}

export const createShellSlice: StateCreator<ShellSlice & Pick<EditSlice, 'setEditMode'> & Pick<PrefsSlice, 'setViewMode' | 'viewMode'>, [], [], ShellSlice> = (set, get) => ({
  modals: Object.fromEntries(MODAL_IDS.map((id) => [id, false])) as Record<ModalId, boolean>,
  shareTarget: null,
  setShareTarget: (section) => set({ shareTarget: section }),
  openShare: (section) => set((st) => ({ shareTarget: section, modals: { ...st.modals, share: true } })),
  setModal: (id, open) => set((st) => (st.modals[id] === open ? st : {
    modals: { ...st.modals, [id]: open },
    ...(id === 'newProject' && !open ? { planetReturn: null } : null),
  })),
  planetReturn: null,
  returnToPlanets: (chosen) => set((st) => ({ planetReturn: { chosen }, modals: { ...st.modals, newProject: true } })),
  aboutTarget: null,
  setAboutTarget: (id) => set({ aboutTarget: id }),
  openAbout: (target) => set((st) => ({ aboutTarget: target, modals: st.modals.about ? st.modals : { ...st.modals, about: true } })),
  takeAboutTarget: () => {
    const target = get().aboutTarget;
    if (target) set({ aboutTarget: null });
    return target;
  },
  helpTarget: null,
  setHelpTarget: (target) => set({ helpTarget: target }),
  openHelpAt: (target) => set((st) => ({ helpTarget: target, whatsThis: false, modals: st.modals.help ? st.modals : { ...st.modals, help: true } })),
  whatsThis: false,
  setWhatsThis: (on) => set((st) => (st.whatsThis === on ? st : { whatsThis: on })),
  toggleWhatsThis: () => set((st) => (st.whatsThis ? { whatsThis: false } : {
    whatsThis: true,
    ...(st.modals.help ? { modals: { ...st.modals, help: false } } : null),
  })),
  // Seeded from the live device signals, not from `false`: passive effects flush children-first,
  // so PortraitGuard's mirror-write and the tour's first-launch check land in the same flush and
  // the check would read the pre-mount default, latch its once-only ref and start the tour under
  // the rotate overlay. An edition that turns its own body never blocks.
  portraitBlocked: BLOCKS_PORTRAIT && detectPortraitBlocked(),
  // No-ops when unchanged: a resize storm re-evaluates the same boolean many times a second, and
  // publishing each identical read would re-render the whole tree on every tick.
  setPortraitBlocked: (v) => set((st) => (st.portraitBlocked === v ? st : { portraitBlocked: v })),
  tourRunning: false,
  setTourRunning: (running) => set({ tourRunning: running }),
  tourView: null,
  startTour: () => {
    markTourSeen();
    set((st) => ({ tourRunning: true, tourView: st.tourRunning ? st.tourView : st.viewMode }));
  },
  // Seen is written again here, so a run opened any other way ends seen.
  finishTour: (completed) => {
    markTourSeen();
    const borrowed = get().tourView;
    set((st) => ({ tourRunning: false, tourView: null, ...(completed ? { modals: { ...st.modals, tourDone: true } } : null) }));
    if (borrowed && get().viewMode !== borrowed) get().setViewMode(borrowed);
  },
  enterTourStep: (step) => {
    if (step.mode !== undefined) get().setEditMode({ mode: step.mode });
    if (step.view !== undefined) get().setViewMode(step.view);
  },
  // Every session boots with the panel closed, docked or not: the open state is never persisted.
  // The pin remembers the shape the panel opens in (`useAssistantDocked`: asked for, open and room),
  // and the conversation comes back on its own (`agent/session/persist.ts`).
  assistantOpen: false,
  setAssistantOpen: (open) => set((st) => (st.assistantOpen === open ? st : { assistantOpen: open })),
  assistantPinned: readPref('assistantPinned'),
  setAssistantPinned: (pinned) => set((st) => {
    if (st.assistantPinned === pinned) return st;
    writePref('assistantPinned', pinned);
    return { assistantPinned: pinned };
  }),
  assistantDockSide: readPref('assistantDockSide'),
  setAssistantDockSide: (side) => set((st) => {
    if (st.assistantDockSide === side) return st;
    writePref('assistantDockSide', side);
    return { assistantDockSide: side };
  }),
  export3dShots: [],
  setExport3dShots: (next) => set({ export3dShots: next }),
  preview3DEdit: null,
  setPreview3DEdit: (v) => set({ preview3DEdit: v }),
  // Neither floating surface opens while the tour runs: the tour's dim takes no pointer events, and
  // both sit at z.contextMenu, above z.tour, so either would paint over the walkthrough. Closing is
  // always allowed. Every opener (a right-click, a selection corner handle, a keybinding) passes
  // through these two setters.
  contextMenu: null,
  // A refusal returns `s` itself, not `{}`: zustand notifies every subscriber of a new state
  // object either way, but `Object.is(s, s)` lets `set` skip that notification entirely.
  setContextMenu: (menu) => set((s) => (menu && s.tourRunning ? s : { contextMenu: menu })),
  deletePopover: null,
  setDeletePopover: (sel) => set((s) => (sel && s.tourRunning ? s : { deletePopover: sel })),
  handedImport: null,
  handImport: (hand) => set((st) => ({ handedImport: hand, modals: { ...st.modals, ...HAND_DESTINATION[hand.kind] } })),
  takeHandedImport: (kind) => {
    const hand = get().handedImport;
    if (hand?.kind !== kind) return null;
    set({ handedImport: null });
    return hand.file;
  },
});
