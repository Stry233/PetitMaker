/**
 * One file's way into the editor: it is classified, a file of another window's kind is routed to
 * that window (a redirect card, or handed straight on), a blueprint file goes to the library
 * and opens Blueprint on it whatever the surface, and a map is decoded to wait for the
 * surface's confirmation, then installed once. Every import surface takes its files through its own
 * `createImportFlow`, one file at a time, and taking a file declines the saved-session offer. While
 * the map is held (`state/frame-pose.ts:mapHeld`) no file is taken and no decoded map installed.
 */
import { createSignal } from '../../core/base/signal';
import { inspectImportFile, type ImportInspection } from '../../io/import/file';
import { openThroughRepair } from './landmark-repair';
import { classifyImport } from '../../io/import/kind';
import { mapHeld } from '../../state/frame-pose';
import type { HandedImport } from '../../state/slices/shell';
import { useEditorStore } from '../../state/store';
import { reportImport } from '../editing/import-report';
import { importBlueprintFile } from '../editing/blueprint';
import { getImportFileDeps } from './import-deps';
import { declineRestoreOffer } from './restore';

/** A decoded map waiting for the user's word, with the file it was read from; a map a link carried
 *  has none. */
export interface PendingMap { inspection: Extract<ImportInspection, { status: 'ready' }>; name: string; file?: File | Blob }

/** What a surface does with a file of each kind: read it itself (`read`), show the card offering the
 *  window that reads it (`card`), hand it straight to that window (`hand`), or refuse it (`refuse`). */
export interface ImportRouting {
  map: 'read' | 'card' | 'hand';
  planet: 'card' | 'hand';
  video: 'read' | 'card' | 'hand';
  unknown: 'read' | 'refuse';
}

/** Where a file went: to a redirect card, on to its window, refused, back to the surface as a video
 *  it reads, waiting as a decoded map, or nowhere (a refusal already reported). */
type ImportRoute =
  | { to: 'card'; redirect: HandedImport }
  | { to: 'handed' }
  | { to: 'refused' }
  | { to: 'video'; file: File }
  | { to: 'pending'; pending: PendingMap }
  | { to: 'done' };

/** Classifies `file` and takes it the way `routing` says for its kind; a held map refuses every file
 *  unread. Handing a file over is choosing to work on something else, so the saved-session offer is
 *  declined before the file is read: its countdown would otherwise land over the import. */
export async function routeImport(file: File | Blob, name: string, routing: ImportRouting): Promise<ImportRoute> {
  if (mapHeld(useEditorStore.getState())) return { to: 'refused' };
  declineRestoreOffer();
  const classified = await classifyImport(file, name);
  const { kind } = classified;
  if (kind === 'blueprint') {
    if (await importBlueprintFile(classified.text ?? '')) useEditorStore.getState().setEditMode({ mode: 'blueprint' });
    return { to: 'done' };
  }
  const how = routing[kind];
  if (how === 'card' || how === 'hand') {
    if (kind === 'unknown' || !(file instanceof File)) return { to: 'done' };
    if (how === 'card') return { to: 'card', redirect: { kind, file } };
    useEditorStore.getState().handImport({ kind, file });
    return { to: 'handed' };
  }
  if (how === 'refuse') return { to: 'refused' };
  if (kind === 'video') return file instanceof File ? { to: 'video', file } : { to: 'done' };
  const inspection = await inspectImportFile(file, name, classified);
  if (inspection.status === 'ready') return { to: 'pending', pending: { inspection, name, file } };
  reportImport(inspection);
  return { to: 'done' };
}

/** Installs a confirmed map and reports how the import went, through the repair's gate: a map whose
 *  load changes what stood under a landmark waits for the visitor's choice, the open map untouched.
 *  False, with nothing installed or asked, while the map is held. */
export function commitImport(pending: PendingMap): boolean {
  if (mapHeld(useEditorStore.getState())) return false;
  const { preview } = pending.inspection;
  const format = preview.source === 'json' ? 'json' : 'image';
  openThroughRepair(preview.report, preview.state, () => reportImport(pending.inspection.commit(getImportFileDeps())),
    pending.file ? { kind: 'file', file: pending.file, name: pending.name, format } : { kind: 'map', state: preview.state });
  return true;
}

/** What an import surface shows of its flow. */
export interface ImportFlowState {
  /** A file is being classified or decoded. */
  busy: boolean;
  pending: PendingMap | null;
  /** A file of another window's kind, waiting on its redirect card. */
  redirect: HandedImport | null;
}

export interface ImportFlowOptions {
  routing: ImportRouting;
  /** Reads a video this surface takes itself. */
  onVideo?: (file: File) => void;
  /** A file this surface refuses. */
  onRefused?: () => void;
  /** After a decoded map was installed. */
  onCommitted?: () => void;
}

/** One import surface's file flow, as an external store the surface reads. */
export interface ImportFlow {
  /** Takes `file` the surface's way; nothing while another is being read or waits on a card. */
  take(file: File | Blob, name?: string): Promise<void>;
  /** Installs the pending map; a second press does nothing, and a held map puts it away uninstalled. */
  confirm(): void;
  /** Puts away the pending map and the redirect card. */
  dismiss(): void;
  /** Whether nothing is being read and nothing waits on a card, as of this call. */
  idle(): boolean;
  subscribe(listener: () => void): () => void;
  snapshot(): ImportFlowState;
}

const IDLE: ImportFlowState = { busy: false, pending: null, redirect: null };

export function createImportFlow({ routing, onVideo, onRefused, onCommitted }: ImportFlowOptions): ImportFlow {
  const flow = createSignal<ImportFlowState>(IDLE);
  const set = (next: Partial<ImportFlowState>): void => {
    const now = flow.get();
    const moved = { ...now, ...next };
    if (moved.busy !== now.busy || moved.pending !== now.pending || moved.redirect !== now.redirect) flow.emit(moved);
  };
  const idle = (): boolean => {
    const now = flow.get();
    return !now.busy && !now.pending && !now.redirect;
  };
  return {
    async take(file, name = file instanceof File ? file.name : '') {
      if (!idle()) return;
      set({ busy: true });
      let waits: Partial<ImportFlowState> = {};
      try {
        const routed = await routeImport(file, name, routing);
        if (routed.to === 'card') waits = { redirect: routed.redirect };
        else if (routed.to === 'refused') onRefused?.();
        else if (routed.to === 'video') onVideo?.(routed.file);
        else if (routed.to === 'pending') waits = { pending: routed.pending };
      } finally {
        set({ ...waits, busy: false });
      }
    },
    confirm() {
      const waiting = flow.get().pending;
      if (!waiting || flow.get().busy) return;
      set({ pending: null, busy: true });
      let installed = false;
      try {
        installed = commitImport(waiting);
      } finally {
        set({ busy: false });
      }
      if (installed) onCommitted?.();
    },
    dismiss: () => set({ pending: null, redirect: null }),
    idle,
    subscribe: (listener) => flow.subscribe(() => listener()),
    snapshot: () => flow.get(),
  };
}
