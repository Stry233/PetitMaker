/**
 * An import surface's file flow (`editor/session/import-flow.ts:createImportFlow`), one per mounted
 * surface: the Import window, the page-level drop overlay, Import planet's window and the blueprint
 * shelf each take their files through this hook.
 */
import { useRef, useState, useSyncExternalStore } from 'react';
import {
  createImportFlow, type ImportFlow, type ImportFlowOptions, type ImportFlowState, type ImportRouting,
} from '../../../../editor/session/import-flow';

export type { ImportRouting };

/** The flow's state as of this render, with its verbs; `idle` answers between renders. */
type ImportFlowView = ImportFlowState & Pick<ImportFlow, 'idle' | 'take' | 'confirm' | 'dismiss'>;

/** `routing` is read as the surface mounts; the handlers are the latest render's. */
export function useImportFlow(options: ImportFlowOptions): ImportFlowView {
  const latest = useRef(options);
  latest.current = options;
  const [flow] = useState(() => createImportFlow({
    routing: options.routing,
    onVideo: (file) => latest.current.onVideo?.(file),
    onRefused: () => latest.current.onRefused?.(),
    onCommitted: () => latest.current.onCommitted?.(),
  }));
  const state = useSyncExternalStore(flow.subscribe, flow.snapshot);
  return { ...state, idle: flow.idle, take: flow.take, confirm: flow.confirm, dismiss: flow.dismiss };
}
