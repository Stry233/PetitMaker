/* Shared job-phase copy and clock calculations for the open dock and folded character chip. */
import { useEffect, useRef, useState } from 'react';
import type { JobView, PanelView, SessionPhase } from '../../agent/core/project-view';

/** The phases in which a job is proceeding under its own power. */
export const RUNNING: ReadonlySet<SessionPhase> = new Set<SessionPhase>(['thinking', 'streaming', 'executing']);

/** Session phase to localized dock status key. Literal keys remain visible to the i18n drift check. */
export const WORD_FOR_PHASE: Record<SessionPhase, string> = {
  idle: 'agent3.dock_idle',
  thinking: 'agent3.dock_thinking',
  streaming: 'agent3.dock_writing',
  executing: 'agent3.dock_executing',
  gated: 'agent3.dock_gated',
  retrying: 'agent3.dock_retry_again',
  pausing: 'agent3.dock_pausing',
  paused: 'agent3.dock_paused',
  aborted: 'agent3.dock_aborted',
  incident: 'agent3.dock_incident',
};

/** Counts operations the executor classified as reads. */
export function readCount(job: JobView): number {
  return job.ops.filter((op) => op.isRead).length;
}

/** `M:SS` from a second count, or null where there is nothing to show. */
export function fmtClock(secs: number | null): string | null {
  if (secs === null || secs < 0) return null;
  const whole = Math.floor(secs);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Clock interval in ms; displayed times use whole seconds. */
const TICK_MS = 1000;

/** Provides a one-second render clock only while a caller is displaying elapsed time. */
export function useSecondClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now()); // Refresh immediately when counting begins.
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Silence threshold for an informational stalled status, not a failure classification, in ms. */
export const STALL_MS = 90_000;

/** Signature of streaming progress that can advance without a persisted log event. */
function liveSignature(view: PanelView): string {
  const job = view.current;
  if (!job) return '';
  return `${job.thought?.chars ?? 0}|${job.says?.length ?? 0}|${job.ops.length}|${String(job.saysStreaming)}`;
}

/**
 * Returns the newer of the persisted event time and observed streaming movement. Initial observation
 * does not reset restored-session silence, and `now` comes from the caller's shared clock.
 */
export function useLastActivity(view: PanelView, now: number): number {
  const sig = liveSignature(view);
  const seen = useRef<string | null>(null);
  const [movedAt, setMovedAt] = useState(0);
  useEffect(() => {
    if (seen.current === null) { seen.current = sig; return; }
    if (seen.current === sig) return;
    seen.current = sig;
    setMovedAt(now);
  }, [sig, now]);
  return Math.max(view.lastEventAt, movedAt);
}

/** What the hero chip says, or null where there is nothing for it to say. */
export interface HeroChipFace { wordKey: string; clock: string }

/** Returns folded-character status only while a job is actively progressing. */
export function heroChipFace(view: PanelView, now: number): HeroChipFace | null {
  if (!RUNNING.has(view.phase) || !view.current) return null;
  const clock = fmtClock((now - view.current.orderAt) / 1000);
  if (clock === null) return null;
  return { wordKey: WORD_FOR_PHASE[view.phase], clock };
}
