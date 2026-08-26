/*
 * dock-face.ts — the few facts about a running job that TWO surfaces read, and the clock both of
 * them tick on.
 *
 * The dock says what the session is doing while the panel is open; the chip at the parked
 * character's shoulder says it while the panel is shut. They are the same sentence in two places, so
 * the sentence lives here rather than in either of them: a word table copied into the character's
 * layer would drift from the dock's the first time a phase was reworded, and a second 1Hz clock
 * beside the dock's would let the two read different seconds of the same job.
 *
 * THE TWO CLOCK FACTS LIVE HERE TOO, beside the tick they are read against: how long a session may
 * say nothing before the dock stops reassuring (`STALL_MS`), and when it was last SEEN to move
 * (`useLastActivity`) — which is not the same question as when it last logged something.
 *
 * IT IS THE LEAF ON PURPOSE. `CharacterHost` is EAGER (the character poses off the session whether
 * or not the panel has ever been opened), and `DeskHeader` stands behind the panel's lazy chunk with
 * the whole dock. Nothing here imports either, so the chip costs the first load these few lines and
 * not the dock.
 */
import { useEffect, useRef, useState } from 'react';
import type { JobView, PanelView, SessionPhase } from '../../agent/core/project-view';

/** The phases in which a job is proceeding under its own power. */
export const RUNNING: ReadonlySet<SessionPhase> = new Set<SessionPhase>(['thinking', 'streaming', 'executing']);

/** `SessionPhase` → its dock sentence's i18n key, held as DATA (not a literal `t(...)` argument) so
 *  one table both drives the render and, by carrying the key as a literal quoted string, keeps every
 *  entry visible to the i18n drift detector (mirrors `JobTicket.tsx`'s own `STAMP_META`).
 *
 *  THINKING AND WRITING SHARE A PAPER AND NOT A WORD. The paper is the same because a model
 *  streaming text is still working out what to say (`DeskHeader`'s own table), but the two are
 *  different things to be waiting on, and the ticket's caret was the only place the panel said which
 *  one was happening. */
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

/**
 * How many times a job LOOKED at the map: the count both the dock's answered face and the answer
 * paper's own reads line state.
 *
 * It lives here for this file's own reason — one job must not be described two ways by two surfaces
 * — and it reads the result's own stamp through `OpRow.isRead` rather than a tool-name list, so a
 * call the executor recorded as a read is a read wherever it is counted.
 */
export function readCount(job: JobView): number {
  return job.ops.filter((op) => op.isRead).length;
}

/** `M:SS` from a second count, or null where there is nothing to show. */
export function fmtClock(secs: number | null): string | null {
  if (secs === null || secs < 0) return null;
  const whole = Math.floor(secs);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** The clock the running faces read, in ms. One second: they count in whole seconds, so a faster
 *  tick re-renders for a number that has not changed. */
const TICK_MS = 1000;

/**
 * A ~1Hz clock, and ONLY while something is counting.
 *
 * An elapsed reading is derived from `now`, which is a render input — so with nothing else
 * re-rendering, the number froze at whatever second the job began and the wait read as a hang. It
 * stops the moment the caller says nothing is counting: an interval left running would re-render its
 * host once a second for the rest of the session, which is exactly the standing cost the renderer's
 * own budget forbids.
 */
export function useSecondClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now()); // the first tick is owed immediately, not a second late
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * How long the session may say nothing at all before the dock stops reassuring, in ms.
 *
 * NINETY SECONDS, and the number is the honest one rather than a patient one: past it the panel
 * genuinely cannot tell a model deliberating from a socket that died, and neither can the loop —
 * nothing in the harness or in either SDK bounds a silent stream (both SDKs' ten-minute default
 * bounds TIME TO HEADERS, which for a stream is before the first byte of it). A hidden-CoT model
 * legitimately thinks in silence for minutes, so the face does not claim a fault: it states what is
 * true, that nothing has been received for this long, and goes on counting.
 */
export const STALL_MS = 90_000;

/**
 * WHAT THE PANEL HAS ACTUALLY OBSERVED MOVING, as a signature: the live turn's own progress, which
 * is the half of the session that never reaches the log.
 *
 * A stream in flight is published through the store's live buffer, coalesced to one frame and then
 * gated on a digest that buckets reasoning by 256 characters — so a thinking model moves this string
 * a few times a second while `lastEventAt` stands still at the order that started the turn. Reading
 * the silence off the log alone would call every long think a stall.
 *
 * THE 256-CHARACTER BUCKET IS `session/store.ts`'s `REASONING_BUCKET_BITS`, and `STALL_MS` above is
 * COUPLED to it though neither file says so directly: this signature can only move as often as the
 * store republishes, so a false stall needs a reasoning stream slower than one bucket per `STALL_MS`
 * (today, under 256 chars / 90s). A reader changing either number should re-run that division.
 */
function liveSignature(view: PanelView): string {
  const job = view.current;
  if (!job) return '';
  return `${job.thought?.chars ?? 0}|${job.says?.length ?? 0}|${job.ops.length}|${String(job.saysStreaming)}`;
}

/**
 * WHEN THE SESSION WAS LAST SEEN TO MOVE: the newer of the last logged event and the last live
 * dribble this panel watched arrive.
 *
 * THE FIRST OBSERVATION STAMPS NOTHING, which is what lets a panel opened onto a session that has
 * been silent for four minutes say so instead of starting its own clock at zero. Only a signature
 * that CHANGES under this component's eyes is evidence that something arrived, and until one does
 * the log's own stamp is the whole answer.
 *
 * `now` IS THE CALLER'S OWN CLOCK, taken as an argument rather than read again with `Date.now()`
 * here: this file's own header exists to stop a second 1Hz clock from reading a different second of
 * the same job, and a live movement stamped off its own call would be exactly that — the dock's
 * `activeAt` and its `now` would agree in the app (both real time, a millisecond apart) and disagree
 * under a pinned clock, where a test cannot make the silence reading go stale on purpose.
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

/**
 * The chip's own reading: the running word and the job's elapsed clock.
 *
 * NULL UNLESS A JOB IS ACTUALLY UNDER WAY, which is narrower than "the session is not idle": a
 * settled receipt, a hold and an error all have the panel's own way back (the block, the character)
 * and nothing that needs watching from outside it. A chip standing over a finished job would claim
 * work that is not happening.
 */
export function heroChipFace(view: PanelView, now: number): HeroChipFace | null {
  if (!RUNNING.has(view.phase) || !view.current) return null;
  const clock = fmtClock((now - view.current.orderAt) / 1000);
  if (clock === null) return null;
  return { wordKey: WORD_FOR_PHASE[view.phase], clock };
}
