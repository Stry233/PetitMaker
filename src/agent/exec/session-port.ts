/**
 * The session the runner and the tool wiring read and publish to. The runner takes it as a port so a
 * job is driven against whatever session its caller hands in; `agentSessionPort` is the page's store.
 */
import type { SessionLog } from '../core/log';
import type { ChildProgress, Part } from '../core/types';
import { useAgentSession } from '../session/store';

export interface SessionPort {
  /** The session's current log; replaced only by an explicit erasure or a restored map. */
  log(): SessionLog;
  /** Calls `listener` after every session change; returns the unsubscribe. */
  watch(listener: () => void): () => void;
  /** Whether the order was filed out of the active job area. */
  isFiled(orderSeq: number): boolean;
  /** Publishes the in-flight turn's parts, or clears them. */
  setLive(parts: readonly Part[] | null): void;
  /** Publishes a delegated helper's progress, or clears it. */
  setChildLive(progress: ChildProgress | null): void;
}

/** The page's assistant session store as a port. */
export const agentSessionPort: SessionPort = {
  log: () => useAgentSession.getState().log,
  watch: (listener) => useAgentSession.subscribe(listener),
  isFiled: (orderSeq) => useAgentSession.getState().filed.has(orderSeq),
  setLive: (parts) => useAgentSession.getState().setLive(parts),
  setChildLive: (progress) => useAgentSession.getState().setChildLive(progress),
};
