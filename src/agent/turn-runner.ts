/**
 * Site Log turn runner — the framework-free heart of the agent mode
 * (spec §5 "Mapping the loop to entries"). Wraps the provider-agnostic
 * `runAgentTurn` loop and translates its events into session entries:
 *
 * - assistant text streams into agent notes;
 * - consecutive write tool calls of a planless turn share ONE build ticket
 *   (rail ticks + card-back steps), checkpointed at the first write;
 * - `update_plan` becomes the blueprint lifecycle: draft → the user's go
 *   (oversight gate) → stage bookkeeping (checkpoints, per-stage notes) →
 *   done with a recap;
 * - wide/destructive steps ask "May I?" through the dock (module-level
 *   resolvers hold the pending answer, one run at a time);
 * - a queued user message mid-run is delivered to the model appended to the
 *   next tool result (real steering, no restart);
 * - REVERTED feedback stays model-facing; the UI sees friendly revert copy.
 *
 * React never imports the loop directly — useSiteLogTurn wraps this.
 */
import { runAgentTurn } from './loop';
import { executeToolCall, WRITE_TOOLS, type AgentToolDeps } from './tools';
import {
  verbIconFor, tileColorFor, ticketTitleFor, resultToTick, revertCopy,
  stepFromResult, vitalsDelta, shouldGate, USER_SKIP, type Translate,
} from './feed';
import { useAgentSession, type BlueprintEntry, type Tick, type Vitals } from './session';
import type { Oversight } from './key-storage';
import type { AgentMessage, PlanStage, ProviderAdapter, ToolCall, ToolResult, ToolSchema } from './types';

export type GateAct = 'allow' | 'allow-all' | 'deny';

export interface RunnerCtx {
  adapter: ProviderAdapter;
  model: string;
  system: string;
  tools: ToolSchema[];
  history: AgentMessage[];
  userText: string;
  mapContext: string;
  deps: AgentToolDeps;
  oversight: Oversight;
  signal: AbortSignal;
  t: Translate;
  /** Resume a paused blueprint instead of opening a fresh one. */
  resumeBpId?: number;
  /** Seam for tests / future op layer; defaults to the real tool executor. */
  execToolImpl?: (call: ToolCall, deps: AgentToolDeps) => Promise<ToolResult>;
  /** Fresh-context sub-agent runner (needs the adapter); wired by the hook. */
  runDelegate?: (task: string) => Promise<string>;
}

/* ── module-level control surface (one run at a time) ── */

let gateResolver: ((act: GateAct) => void) | null = null;
let bpGateResolver: ((go: boolean) => void) | null = null;
let pauseRequested = false;
let queuedSteering: string | null = null;
let runActive = false;

/** True for the whole lifetime of a runSiteLogTurn, including gate waits where the
 *  session's `running` flag is deliberately false (the dock shows "waiting on you").
 *  Callers must route new input through steering while this holds — a second
 *  concurrent run would clobber the resolvers above and strand the first run's
 *  parked gate promise forever. */
export function isRunActive(): boolean { return runActive; }

export function answerGate(act: GateAct): void {
  const r = gateResolver;
  gateResolver = null;
  r?.(act);
}
export function answerBlueprintGate(go: boolean): void {
  const r = bpGateResolver;
  bpGateResolver = null;
  r?.(go);
}
export function requestPause(): void { pauseRequested = true; }
export function queueSteering(text: string): void { queuedSteering = text; }
/** Deny anything pending (Stop / screen change) so promises never dangle. */
export function cancelPending(): void {
  answerGate('deny');
  answerBlueprintGate(false);
  pauseRequested = false;
  queuedSteering = null;
}

/* ── checkpoint helpers ──────────────────────────────────────────────── */

const S = () => useAgentSession.getState();

/** Undo the editor back to a checkpoint watermark; returns steps undone. */
export function undoToCheckpoint(deps: AgentToolDeps, undoIndex: number): number {
  const exec = deps.getExecutor();
  let n = 0;
  while (exec.getUndoStackSize() > undoIndex && exec.undo()) n++;
  return n;
}

/** Last sentence of the model's narration, tidied for the gate line. */
export function proseTail(text: string): string | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const parts = clean.split(/(?<=[.!?\u3002\uff01\uff1f])\s+/).filter(Boolean);
  let tail = (parts[parts.length - 1] ?? clean).trim();
  if (tail.length < 8 && parts.length > 1) tail = `${parts[parts.length - 2]} ${tail}`.trim();
  if (tail.length > 140) tail = `${tail.slice(0, 137).trimEnd()}...`;
  return tail || null;
}

const DENIAL = 'User denied this action. Adjust the approach or ask them what they prefer.';
const PLAN_SET_ASIDE = 'The user set this plan aside for now. Stop and ask what they would like instead.';

/* ── the run ─────────────────────────────────────────────────────────── */

export async function runSiteLogTurn(ctx: RunnerCtx): Promise<AgentMessage[]> {
  if (runActive) {
    throw new Error('An agent run is already active; queue the input as steering instead.');
  }
  runActive = true;
  const exec = () => ctx.deps.getExecutor();
  const execTool = ctx.execToolImpl ?? executeToolCall;
  const t = ctx.t;
  pauseRequested = false;

  let allowAll = false;
  let bpId: number | null = ctx.resumeBpId ?? null;
  let ticketId: number | null = null;      // the planless burst ticket
  let noteId: number | null = null;        // streaming assistant note
  let stageTicks: string[] = [];           // titles feeding the stage note
  let prose = '';                          // the assistant's words, streaming
  let lastProse = '';                      // last completed narration (gate copy)
  let suggested: string | null = null;     // the model's suggest_reply, applied at turn end
  let suggestNudged = false;               // one shot only
  let wroteAnything = false;               // any write landed this turn
  let muteNote = false;                    // swallow the SKIP reply to the nudge

  if (bpId !== null) S().patchEntry(bpId, { paused: false, now: null });
  S().setSuggestion(null);
  S().setRunning(true);
  S().setThinking(true);

  const bp = (): BlueprintEntry | null => {
    const e = bpId === null ? undefined : S().getEntry(bpId);
    return e && e.kind === 'bp' ? e : null;
  };
  const bpActive = (): BlueprintEntry | null => {
    const b = bp();
    return b && !b.draft && !b.paused && !b.done && !b.undone ? b : null;
  };

  const finishTicket = () => {
    if (ticketId === null) return;
    const e = S().getEntry(ticketId);
    if (e?.kind === 'ticket') {
      const undoable = !!e.checkpoint && exec().getUndoStackSize() > e.checkpoint.undoIndex;
      S().patchEntry(ticketId, { working: false, now: null, undoable });
    }
    ticketId = null;
  };

  const syncBlueprint = async (stages: PlanStage[]): Promise<ToolResult | null> => {
    const titles = stages.map((s) => s.title);
    const doneCount = stages.filter((s) => s.status === 'done').length;
    const activeIdx = stages.findIndex((s) => s.status === 'active');
    const cur = bp();

    if (!cur) {
      finishTicket();
      const needsGate = ctx.oversight !== 'yolo';
      bpId = S().pushEntry({
        kind: 'bp', goal: ctx.userText.slice(0, 80), stages: titles,
        draft: needsGate, paused: false, done: false,
        doneCount: 0, currentIdx: needsGate ? -1 : Math.max(activeIdx, 0),
        notes: {}, rail: null, now: null, steps: 0,
        checkpoints: [], startCheckpoint: { undoIndex: exec().getUndoStackSize() },
      });
      if (needsGate) {
        S().setRunning(false);
        const go = await new Promise<boolean>((r) => { bpGateResolver = r; });
        S().setRunning(true);
        if (ctx.signal.aborted) return { toolCallId: '', content: PLAN_SET_ASIDE, isError: true };
        if (!go) {
          S().patchEntry(bpId!, { paused: true });
          S().pushEntry({ kind: 'note', text: t('agent2.set_aside') });
          return { toolCallId: '', content: PLAN_SET_ASIDE, isError: true };
        }
        S().patchEntry(bpId!, {
          draft: false, currentIdx: 0,
          startCheckpoint: { undoIndex: exec().getUndoStackSize() },
          checkpoints: [{ undoIndex: exec().getUndoStackSize() }],
        });
      }
      return null;
    }

    // stage bookkeeping on an existing blueprint
    const patch: Partial<BlueprintEntry> = { stages: titles, doneCount };
    if (doneCount > cur.doneCount) {
      const notes = { ...cur.notes };
      for (let i = cur.doneCount; i < doneCount; i++) {
        notes[i] = stageTicks.length ? [...new Set(stageTicks)].join(', ') : titles[i]!;
      }
      patch.notes = notes;
      patch.rail = null;
      patch.now = null;
      patch.revertnote = null;
      stageTicks = [];
    }
    if (activeIdx >= 0 && activeIdx !== cur.currentIdx) {
      patch.currentIdx = activeIdx;
      const cps = [...cur.checkpoints];
      cps[activeIdx] = { undoIndex: exec().getUndoStackSize() };
      patch.checkpoints = cps;
    }
    if (doneCount === titles.length && titles.length > 0) {
      patch.done = true;
      patch.currentIdx = -1;
      patch.rail = null;
      patch.now = null;
      patch.steps = exec().getUndoStackSize() - (cur.startCheckpoint?.undoIndex ?? 0);
    }
    S().patchEntry(cur.id, patch);
    return null;
  };

  const recordWrite = (call: ToolCall, phase: 'start' | 'done', result?: ToolResult) => {
    const input = call.input ?? {};
    const { title, sub } = ticketTitleFor({ name: call.name, input }, t);
    const icon = verbIconFor(call.name, input);
    const active = bpActive();
    if (active) {
      if (phase === 'start') {
        const rail: Tick[] = [...(active.rail ?? []), { s: 'run', i: icon, t: title }];
        S().patchEntry(active.id, { rail, now: sub ? `${title}, ${sub}` : title });
      } else if (result) {
        const tick = resultToTick(call.name, result, input, t);
        const rail: Tick[] = [...(active.rail ?? [])];
        const runIdx = rail.findIndex((x) => x.s === 'run');
        if (runIdx >= 0) rail[runIdx] = tick; else rail.push(tick);
        const patch: Partial<BlueprintEntry> = { rail, now: null };
        if (result.isError) patch.revertnote = revertCopy(result.content, t);
        S().patchEntry(active.id, patch);
        if (!result.isError) stageTicks.push(title);
      }
      return;
    }
    if (phase === 'start') {
      if (ticketId === null) {
        ticketId = S().pushEntry({
          kind: 'ticket', icon, tile: tileColorFor(icon), title, sub,
          working: true, rail: [{ s: 'run', i: icon, t: title }], steps: [],
          now: null, checkpoint: { undoIndex: exec().getUndoStackSize() },
        });
      } else {
        const e = S().getEntry(ticketId);
        if (e?.kind === 'ticket') S().patchEntry(ticketId, { rail: [...e.rail, { s: 'run', i: icon, t: title }] });
      }
    } else if (result && ticketId !== null) {
      const e = S().getEntry(ticketId);
      if (e?.kind === 'ticket') {
        const tick = resultToTick(call.name, result, input, t);
        const rail = [...e.rail];
        const runIdx = rail.findIndex((x) => x.s === 'run');
        if (runIdx >= 0) rail[runIdx] = tick; else rail.push(tick);
        S().patchEntry(ticketId, {
          rail,
          steps: [...(e.steps ?? []), stepFromResult(call.name, result, input, t)],
          revertnote: result.isError ? revertCopy(result.content, t) : e.revertnote,
        });
      }
    }
  };

  const bumpFrom = (call: ToolCall, ok: boolean, resultContent?: string) => {
    const delta = vitalsDelta(call.name, call.input ?? {}, ok, resultContent);
    for (const [k, n] of Object.entries(delta)) S().bumpVitals(k as keyof Vitals, n as number);
  };

  try {
    const history = await runAgentTurn({
      adapter: ctx.adapter,
      model: ctx.model,
      system: ctx.system,
      tools: ctx.tools,
      history: ctx.history,
      userText: ctx.userText,
      mapContext: ctx.mapContext,
      signal: ctx.signal,
      onTextDelta: (d) => {
        S().setThinking(false);
        if (muteNote) return; // the SKIP/bookkeeping reply to the sign-off nudge
        prose += d;
        const bpCur = bpId === null ? undefined : S().getEntry(bpId);
        // 1) closing prose folds into the DONE card's summary (collapsed once a
        //    newer turn exists); the planless-burst ticket takes it too.
        const cardId = ticketId ?? (bpCur?.kind === 'bp' && bpCur.done ? bpCur.id : null);
        if (cardId !== null) {
          const e = S().getEntry(cardId);
          if (e && (e.kind === 'ticket' || e.kind === 'bp')) {
            S().patchEntry(cardId, { summary: (e.summary ?? '') + d });
            return;
          }
        }
        // 2) mid-run narration of a LIVE blueprint attaches to its current
        //    stage (a per-stage collapsed disclosure), not a loose note below.
        if (bpCur?.kind === 'bp' && !bpCur.draft && !bpCur.done && !bpCur.paused) {
          const i = Math.max(bpCur.currentIdx, 0);
          const sp = { ...(bpCur.stageProse ?? {}) };
          sp[i] = (sp[i] ?? '') + d;
          S().patchEntry(bpCur.id, { stageProse: sp });
          return;
        }
        // 3) otherwise (no card yet) a plain streaming note.
        if (noteId === null) noteId = S().pushEntry({ kind: 'note', text: '' });
        const e = S().getEntry(noteId);
        if (e?.kind === 'note') S().patchEntry(noteId, { text: e.text + d });
      },
      onAssistantDone: () => {
        noteId = null;
        // done fires BEFORE this message's tool calls run: carry the words over
        if (prose.trim()) lastProse = prose;
        prose = '';
        // The mute covers exactly one message (the bookkeeping reply to the sign-off
        // nudge). A model that keeps working instead must stay audible.
        muteNote = false;
      },
      onToolEvent: () => { /* rail state is driven directly from execTool below */ },
      // The model signs off with stages unfinished -> send it back to work
      // (its own plan is the contract; the loop bounds this to two nudges).
      unfinishedWork: () => {
        const b = bpActive();
        if (b && b.stages.length - b.doneCount > 0) {
          const left = b.stages.length - b.doneCount;
          return `(system) Your blueprint still has ${left} of ${b.stages.length} stage(s) unfinished. Do not stop here: complete the remaining stage(s) now and mark each done via update_plan — or if the work is truly already built, update the plan statuses to reflect that before you finish.`;
        }
        // Sign-off check after a working turn: the model decides whether one
        // reply is obvious; its bookkeeping answer never reaches the log.
        if (wroteAnything && !suggested && !suggestNudged) {
          suggestNudged = true;
          muteNote = true;
          return '(system) Before finishing: if exactly one user reply to your last message is obvious (e.g. accepting an offer you made), respond with ONLY a suggest_reply call carrying that short reply in their language, no other text. Otherwise respond with the single word SKIP.';
        }
        return null;
      },
      execTool: async (call): Promise<ToolResult> => {
        S().setThinking(false);
        noteId = null;

        if (call.name === 'suggest_reply') {
          const res = await execTool(call, ctx.deps);
          if (!res.isError) {
            const reply = String((call.input as { reply?: string })?.reply ?? '').trim();
            if (reply) suggested = reply.slice(0, 80);
          }
          return res;
        }

        if (call.name === 'update_plan') {
          const stages = ((call.input as { stages?: PlanStage[] })?.stages ?? []) as PlanStage[];
          const veto = await syncBlueprint(stages);
          if (veto) return { ...veto, toolCallId: call.id };
          const res = await execTool(call, ctx.deps);
          return res;
        }

        // Oversight gate FIRST — before the delegate interception below, so a
        // delegated helper (which runs its writes ungated in a fresh context) is
        // itself subject to the user's oversight mode. The approval covers the
        // helper's whole task; its text is the gate copy.
        const isWrite = WRITE_TOOLS.has(call.name);
        if (isWrite && shouldGate(call.name, ctx.oversight, { planApproved: !!bpActive(), allowAll })) {
          // "May I?" speaks the model's own words: the tail of its latest
          // narration, never the parameter dump (title-only fallback).
          const { title } = ticketTitleFor({ name: call.name, input: call.input ?? {} }, t);
          const delegatedTask = call.name === 'delegate_task'
            ? String((call.input as { task?: string })?.task ?? '').trim().slice(0, 140) : null;
          S().setGate({ sub: delegatedTask || (proseTail(prose || lastProse) ?? title) });
          const act = await new Promise<GateAct>((r) => { gateResolver = r; });
          S().setGate(null);
          if (act === 'deny') {
            if (call.name !== 'delegate_task') {
              recordWrite(call, 'start');
              recordWrite(call, 'done', { toolCallId: call.id, isError: true, content: USER_SKIP });
            }
            return { toolCallId: call.id, isError: true, content: DENIAL };
          }
          if (act === 'allow-all') allowAll = true;
        }

        if (call.name === 'delegate_task' && ctx.runDelegate) {
          const task = String((call.input as { task?: string })?.task ?? '').trim();
          if (!task) return { toolCallId: call.id, isError: true, content: 'delegate_task needs a self-contained task description.' };
          wroteAnything = true;
          const active = bpActive();
          let helperIdx = -1;
          if (active) {
            const helpers = [...(active.helpers ?? [])];
            helperIdx = helpers.push({ icon: 'build', color: '#C98A5B', name: t('agent2.helper'), task: task.slice(0, 60), done: false }) - 1;
            S().patchEntry(active.id, { helpers });
          } else {
            S().pushEntry({ kind: 'note', text: t('agent2.helper_started', { task: task.slice(0, 80) }) });
          }
          const report = await ctx.runDelegate(task);
          const after = bpId === null ? null : S().getEntry(bpId);
          if (after?.kind === 'bp' && helperIdx >= 0 && after.helpers?.[helperIdx]) {
            const helpers = after.helpers.map((h, i) => (i === helperIdx ? { ...h, done: true } : h));
            S().patchEntry(after.id, { helpers });
          }
          return { toolCallId: call.id, isError: false, content: report };
        }

        if (isWrite) {
          recordWrite(call, 'start');
          wroteAnything = true;
          // this write consumed the narration; a later gate quotes fresh words
          prose = '';
          lastProse = '';
        } else {
          ctx.deps.getExecutor().noteAnalysisOnly?.();
        }

        const result = await execTool(call, ctx.deps);
        if (isWrite) {
          recordWrite(call, 'done', result);
          bumpFrom(call, !result.isError, result.content);
        }

        // steering: fold a queued user note into the model's next observation
        if (queuedSteering) {
          const extra = queuedSteering;
          queuedSteering = null;
          return { ...result, content: `${result.content}\n(user, mid-run) ${extra}` };
        }
        if (pauseRequested) {
          // soft stop honored between tools by aborting; the hook owns the controller
          return { ...result, content: `${result.content}\n(system) The user paused the run. Stop after this message and wait.` };
        }
        return result;
      },
    });

    return history;
  } finally {
    runActive = false;
    finishTicket();
    const cur = bp();
    if (cur && !cur.done && !cur.draft && (pauseRequested || ctx.signal.aborted)) {
      S().patchEntry(cur.id, { paused: true, rail: null, now: null });
      S().pushEntry({ kind: 'note', text: t('agent2.paused_note') });
    } else if (cur && !cur.done && !cur.draft && !cur.paused) {
      // The model ended the run with stages open even after the nudges: pause
      // the blueprint so the card shows an honest Resume instead of a
      // progress state that never completes.
      S().patchEntry(cur.id, { paused: true, rail: null, now: null });
    }
    pauseRequested = false;
    S().setThinking(false);
    S().setRunning(false);
    S().setGate(null);
    gateResolver = null;
    bpGateResolver = null;
    const done = cur?.done ? `${cur.goal}, ${t('agent2.finished_in', { n: cur.steps })}` : ctx.userText.slice(0, 80);
    S().setResumeSummary(done);
    // The model decides when the next prompt is obvious (suggest_reply tool);
    // its own words become the composer ghost, applied only once the turn is
    // over so nothing flashes mid-run.
    if (!ctx.signal.aborted && suggested) S().setSuggestion(suggested);
  }
}
