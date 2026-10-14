/*
 * The stylize window's connection, kept by `editor/export/stylize-connection.ts`; this hook holds one
 * controller per window and tells it whether the connection page stands.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  createStylizeConnection, type StylizeConnectionState, type StylizeConnectionVerbs, type StylizeListModels,
} from '../../../../../editor/export/stylize-connection';

export type { StylizeListModels };
export type StylizeConnection = StylizeConnectionState & StylizeConnectionVerbs;

export function useStylizeConnection(opts: {
  listModels?: StylizeListModels;
  /** Whether the connection page is the one standing. */
  probing: boolean;
}): StylizeConnection {
  // The window's first listing source serves its whole life.
  const [conn] = useState(() => createStylizeConnection(opts.listModels));
  const state = useSyncExternalStore(conn.subscribe, conn.get);
  useEffect(() => conn.boot(), [conn]);
  useEffect(() => { conn.setProbing(opts.probing); }, [conn, opts.probing]);
  return {
    ...state,
    setProvider: conn.setProvider, setKey: conn.setKey, setBaseUrl: conn.setBaseUrl, setModel: conn.setModel, verify: conn.verify,
  };
}
