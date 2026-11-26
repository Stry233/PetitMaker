/**
 * A map the page was opened with through a link, offered through the import confirmation every
 * import shows: read once the saved-session question is settled, so the map it would replace is the
 * one the visitor is on, and installed only on their word.
 */
import { createSignal } from '../../core/base/signal';
import { inspectMapLink } from '../../io/import/file';
import { useEditorStore } from '../../state/store';
import { reportImport } from '../editing/import-report';
import { commitImport, type PendingMap } from './import-flow';
import { shownPlanetName } from './planet-names';
import { restoreOffer, subscribeRestoreOffer } from './restore';

/** Decodes the map a link carried to wait for the visitor's word, named by its planet where it has no
 *  title; a link that opens no map is reported and yields nothing. */
async function readMapLink(code: string): Promise<PendingMap | null> {
  const inspection = await inspectMapLink(code);
  if (inspection.status === 'ready') {
    return { inspection, name: shownPlanetName(inspection.preview.state.template, useEditorStore.getState().locale) };
  }
  reportImport(inspection);
  return null;
}

/** The page's arriving link, as an external store its confirmation reads. */
interface LinkImport {
  /** Waits for the saved-session question, started once the shell has stood its offer; the link is
   *  read once, by whichever watch first finds no offer standing. Returns the stop. */
  watch(): () => void;
  /** Installs the linked map; nothing when none waits. */
  confirm(): void;
  /** Puts the linked map away. */
  dismiss(): void;
  subscribe(listener: () => void): () => void;
  /** The linked map waiting for the visitor's word, or null. */
  snapshot(): PendingMap | null;
}

/** `arriving` yields the map code the page was opened with, or null. */
export function createLinkImport(arriving: () => string | null): LinkImport {
  const pending = createSignal<PendingMap | null>(null);
  let read = false;
  const readOnceSettled = (): void => {
    if (read || restoreOffer()) return;
    read = true;
    const code = arriving();
    if (code) void readMapLink(code).then((map) => { pending.emit(map); });
  };
  return {
    watch() {
      const stop = subscribeRestoreOffer(readOnceSettled);
      readOnceSettled();
      return stop;
    },
    confirm() {
      const waiting = pending.get();
      if (!waiting) return;
      pending.emit(null);
      commitImport(waiting);
    },
    dismiss() {
      if (pending.get()) pending.emit(null);
    },
    subscribe: (listener) => pending.subscribe(() => listener()),
    snapshot: () => pending.get(),
  };
}
