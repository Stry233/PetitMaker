/**
 * One file's way into the editor: it is classified, a file of another window's kind is routed to
 * that window (a redirect card, or handed straight on), and a map is decoded to wait for the
 * surface's confirmation, then installed once. Every import surface takes its files through
 * `ui/chrome/modals/import/use-import-flow.ts`, which keeps the busy, pending and redirect state.
 */
import { inspectImportFile, type ImportInspection } from '../../io/import/file';
import { classifyImportFile } from '../../io/import/kind';
import type { HandedImport } from '../../state/slices/shell';
import { useEditorStore } from '../../state/store';
import { reportImport } from '../editing/import-report';
import { getImportFileDeps } from './import-deps';

/** A decoded map waiting for the user's word. */
export interface PendingMap { inspection: Extract<ImportInspection, { status: 'ready' }>; name: string }

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
export type ImportRoute =
  | { to: 'card'; redirect: HandedImport }
  | { to: 'handed' }
  | { to: 'refused' }
  | { to: 'video'; file: File }
  | { to: 'pending'; pending: PendingMap }
  | { to: 'done' };

/** Classifies `file` and takes it the way `routing` says for its kind. */
export async function routeImport(file: File | Blob, name: string, routing: ImportRouting): Promise<ImportRoute> {
  const kind = await classifyImportFile(file, name);
  const how = routing[kind];
  if (how === 'card' || how === 'hand') {
    if (kind === 'unknown' || !(file instanceof File)) return { to: 'done' };
    if (how === 'card') return { to: 'card', redirect: { kind, file } };
    useEditorStore.getState().handImport({ kind, file });
    return { to: 'handed' };
  }
  if (how === 'refuse') return { to: 'refused' };
  if (kind === 'video') return file instanceof File ? { to: 'video', file } : { to: 'done' };
  const inspection = await inspectImportFile(file, name);
  if (inspection.status === 'ready') return { to: 'pending', pending: { inspection, name } };
  reportImport(inspection);
  return { to: 'done' };
}

/** Installs a confirmed map and reports how the import went. */
export function commitImport(pending: PendingMap): void {
  reportImport(pending.inspection.commit(getImportFileDeps()));
}
