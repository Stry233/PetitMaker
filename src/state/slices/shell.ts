/**
 * The mounted shell's own overlay/chrome state: which modals are open, the tour, the context menu /
 * delete popover / portrait guard / 3D-shots editor, and the shell's own furniture state (the
 * assistant's open flag). A shell replaces exactly this slice, so a field only one surface reads
 * still belongs here.
 *
 * Self-contained: every setter here reads at most its own fields (`setContextMenu`/
 * `setDeletePopover` read `tourRunning`, which lives in this same slice). No field holds an engine
 * handle, so this slice takes no cross-slice dependency and imports nothing from `engine`/`edit`.
 */
import type { StateCreator } from 'zustand';
import type { BlockRef } from '../../core/model/types';
import type { CameraAngle } from '../../canvas/map3d/capture';
import { detectPortraitBlocked } from '../../core/runtime/portrait-signals';
import { readPref, writePref } from '../../core/runtime/prefs';

/** Every overlay the editor can open. Adding a modal is one member here plus its component. */
export type ModalId =
  | 'help' | 'settings' | 'about' | 'newProject'
  | 'preview3d' | 'export' | 'exportJson' | 'import' | 'tourDone' | 'regionLoad'
  /** The save-and-share window, which carries `export` and `exportJson` as two of its three
   *  sections. Those two keep their own ids so an opener with no shell of its own (the agent's
   *  export tool, the new-map warning) can name the section it wants rather than the window. */
  | 'share';

export interface ShellSlice {
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
  /** Whether the assistant's panel is open. Its block in the mode row is the one toggle, and
   *  the choice is remembered across visits. */
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
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
}

export const createShellSlice: StateCreator<ShellSlice, [], [], ShellSlice> = (set) => ({
  modals: { help: false, settings: false, about: false, newProject: false, preview3d: false, export: false, exportJson: false, import: false, tourDone: false, share: false, regionLoad: false },
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
  assistantOpen: readPref('assistantOpen'),
  setAssistantOpen: (open) => set((st) => {
    if (st.assistantOpen === open) return st;
    writePref('assistantOpen', open);
    return { assistantOpen: open };
  }),
  export3dShots: [],
  setExport3dShots: (next) => set({ export3dShots: next }),
  preview3DEdit: null,
  setPreview3DEdit: (v) => set({ preview3DEdit: v }),
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
});
