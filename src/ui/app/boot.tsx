/**
 * Mounting an edition: the first map opens before the first render, so the views mount over a map
 * rather than installing one themselves. Both editions open a fresh map; a saved session is offered
 * by the shell from its own card and restored on request.
 */
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { prepareEditor } from '../../editor/session/install';
import { loadLocale } from '../../i18n/translations';
import { useEditorStore } from '../../state/store';

/** Readies the editor (`editor/session/install.ts:prepareEditor`), then renders `app` into `root`
 *  once the saved locale's strings have arrived; a failed load renders in English, the fallback of
 *  every string. */
export function mountApp(root: HTMLElement, app: ReactNode): void {
  prepareEditor();
  const render = () => { createRoot(root).render(<StrictMode>{app}</StrictMode>); };
  loadLocale(useEditorStore.getState().locale).then(render, render);
}
