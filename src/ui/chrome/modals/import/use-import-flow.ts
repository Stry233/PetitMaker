/**
 * An import surface's file flow over `editor/session/import-flow.ts`: busy while a file is classified
 * or decoded, a decoded map waiting on the confirmation card, a file of another window's kind waiting
 * on its redirect card. The Import window, the page-level drop overlay and Import planet's window each
 * take their files through this hook.
 */
import { useCallback, useRef, useState } from 'react';
import type { HandedImport } from '../../../../state/slices/shell';
import { commitImport, routeImport, type ImportRouting, type PendingMap } from '../../../../editor/session/import-flow';

export type { ImportRouting, PendingMap };

export interface ImportFlowOptions {
  routing: ImportRouting;
  /** Reads a video this surface takes itself. */
  onVideo?: (file: File) => void;
  /** A file this surface refuses. */
  onRefused?: () => void;
  /** After a decoded map was installed. */
  onCommitted?: () => void;
}

export interface ImportFlow {
  /** A file is being classified or decoded. */
  busy: boolean;
  pending: PendingMap | null;
  /** A file of another window's kind, waiting on its redirect card. */
  redirect: HandedImport | null;
  /** Whether nothing is being read and nothing waits on a card, read synchronously. */
  idle: () => boolean;
  take: (file: File | Blob, name?: string) => Promise<void>;
  /** Installs the pending map; a second press does nothing. */
  confirm: () => void;
  /** Puts away the pending map and the redirect card. */
  dismiss: () => void;
}

export function useImportFlow({ routing, onVideo, onRefused, onCommitted }: ImportFlowOptions): ImportFlow {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingMap | null>(null);
  const [redirect, setRedirect] = useState<HandedImport | null>(null);
  // Window listeners and quick double presses read the flow between renders, so it is mirrored here.
  const live = useRef({ busy: false, pending: null as PendingMap | null, redirect: null as HandedImport | null });
  const set = useCallback((next: Partial<typeof live.current>) => {
    Object.assign(live.current, next);
    if ('busy' in next) setBusy(live.current.busy);
    if ('pending' in next) setPending(live.current.pending);
    if ('redirect' in next) setRedirect(live.current.redirect);
  }, []);
  const options = useRef({ routing, onVideo, onRefused, onCommitted });
  options.current = { routing, onVideo, onRefused, onCommitted };

  const idle = useCallback(() => !live.current.busy && !live.current.pending && !live.current.redirect, []);

  const take = useCallback(async (file: File | Blob, name = file instanceof File ? file.name : '') => {
    if (!idle()) return;
    const { routing: route, onVideo: video, onRefused: refused } = options.current;
    set({ busy: true });
    try {
      const routed = await routeImport(file, name, route);
      if (routed.to === 'card') set({ redirect: routed.redirect });
      else if (routed.to === 'refused') refused?.();
      else if (routed.to === 'video') video?.(routed.file);
      else if (routed.to === 'pending') set({ pending: routed.pending });
    } finally {
      set({ busy: false });
    }
  }, [idle, set]);

  const confirm = useCallback(() => {
    const waiting = live.current.pending;
    if (!waiting || live.current.busy) return;
    set({ pending: null, busy: true });
    try {
      commitImport(waiting);
    } finally {
      set({ busy: false });
    }
    options.current.onCommitted?.();
  }, [set]);

  const dismiss = useCallback(() => set({ pending: null, redirect: null }), [set]);

  return { busy, pending, redirect, idle, take, confirm, dismiss };
}
