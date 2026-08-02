/*
 * useSiteLogTurn — the React bridge between the Site Log UI and the
 * framework-free turn runner (src/agent/turn-runner.ts). Owns the abort
 * controller, the neutral LLM history (still in useAgentStore), the plan
 * mirror the update_plan handler reads, error → incident-notice
 * classification, and the card actions (undo / rewind / resume / drop /
 * gate answers). All session entries are written by the runner; this hook
 * only adds the user's order slips and the undo/rewind follow-up notes.
 */
import { useEffect, useRef, useState } from 'react';
import { translate, useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { singleSelection } from '../../../state/selection';
import { useAgentStore } from '../../../agent/store';
import { PROVIDERS, baseUrlFor } from '../../../agent/providers';
import { supportsVision } from '../../../agent/providers/defaults';
import { takeMapSnapshot } from '../../../agent/snapshot';
import { buildSystemPrompt } from '../../../agent/system-prompt';
import { TOOL_SCHEMAS, SUBAGENT_TOOL_SCHEMAS, executeToolCall, buildMapContext, type AgentToolDeps } from '../../../agent/tools';
import { runAgentTurn } from '../../../agent/loop';
import { redactSecrets } from '../../../agent/redact';
import {
  runSiteLogTurn, answerGate, answerBlueprintGate, requestPause, queueSteering,
  cancelPending, undoToCheckpoint, isRunActive, type GateAct,
} from '../../../agent/turn-runner';
import type { AgentMessage } from '../../../agent/types';
import { useAgentSession } from '../../../agent/session';
import { petitWindow } from '../../../core/runtime/window-bridge';
import type { MacroCoord } from '../../../core/model/types';
import type { PlanStage } from '../../../agent/types';

export type IncidentKind = 'invalid_key' | 'rate_limited' | null;

export interface SiteLogTurn {
  send(preset?: string): Promise<void>;
  /** Pause a running job at the next step boundary (also the Stop action). */
  pause(): void;
  resumeBlueprint(id: number): void;
  undoEntry(id: number): void;
  rewindStage(id: number, stageIdx: number): void;
  gateAnswer(act: GateAct): void;
  blueprintGateAnswer(id: number, go: boolean): void;
  pickSketch(id: number, optIdx: number): void;
  incident: IncidentKind;
  clearIncident(): void;
  logRef: React.RefObject<HTMLDivElement>;
  nearBottomRef: React.MutableRefObject<boolean>;
}

function classifyIncident(err: unknown): IncidentKind {
  const msg = err instanceof Error ? err.message : String(err);
  if (/401|authentication|invalid.*key/i.test(msg)) return 'invalid_key';
  if (/429|rate.?limit/i.test(msg)) return 'rate_limited';
  return null;
}

export function useSiteLogTurn(args: { region: MacroCoord[]; draft: string; setDraft(v: string): void }): SiteLogTurn {
  const t = useT();
  const agent = useAgentStore();
  const session = useAgentSession;
  const provider = agent.settings.provider;
  const apiKey = agent.settings.keys[provider] ?? '';
  const model = agent.settings.model[provider];
  const oversight = agent.settings.oversight;

  const abortRef = useRef<AbortController | null>(null);
  const planRef = useRef<PlanStage[]>([]);
  const visionRejectedRef = useRef(false);
  const lastTurnHadImageRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [incident, setIncident] = useState<IncidentKind>(null);

  // follow new entries while the user is near the bottom
  const logLen = useAgentSession((s) => s.log.length);
  useEffect(() => {
    if (!nearBottomRef.current) return;
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logLen]);

  const runTurn = async (userText: string, opts: { resumeBpId?: number; slip?: boolean } = {}) => {
    const S = session.getState();
    const { gridState, commandExecutor } = useEditorStore.getState();
    if (!gridState || !commandExecutor) return;
    if (opts.slip !== false) S.pushEntry({ kind: 'oslip', text: userText });
    setIncident(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const deps: AgentToolDeps = {
      getState: () => gridState,
      getExecutor: () => commandExecutor,
      getRegion: () => args.region,
      // The agent's tool surface describes ONE clicked block ("this/it"); it has no vocabulary
      // for a group, so a plural selection reads as none rather than as an arbitrary member.
      getSelectedBlock: () => singleSelection(useEditorStore.getState().selection),
      onFlash: (cells) => petitWindow().__petitFlashCommit?.(cells),
      snapshot: !visionRejectedRef.current && supportsVision(provider, model)
        ? async () => { const url = await takeMapSnapshot(); lastTurnHadImageRef.current = !!url; return url; }
        : undefined,
      setPlan: (stages) => { planRef.current = stages; },
      getPlan: () => planRef.current,
      getProvenanceSource: () => ({ provider, model, userApproved: false }),
      requestExport: (kind) => {
        const st = useEditorStore.getState();
        if (kind === 'json') st.setModal('exportJson', true);
        else st.setModal('export', true);
      },
    };
    const system = buildSystemPrompt(commandExecutor.getRegistry(), { uiLocale: useEditorStore.getState().locale });
    const adapter = PROVIDERS[provider].create(apiKey, baseUrlFor(provider, agent.settings));

    const runDelegate = async (task: string): Promise<string> => {
      const before = commandExecutor.getUndoStackSize();
      const sub = await runAgentTurn({
        adapter, model, system, tools: SUBAGENT_TOOL_SCHEMAS,
        history: [], userText: task,
        mapContext: buildMapContext(gridState, args.region, deps),
        execTool: async (c) => executeToolCall(c, deps),
        onTextDelta: () => {}, onToolEvent: () => {},
        signal: ctrl.signal, maxTurns: 20,
      });
      const last = [...sub].reverse().find((m) => m.role === 'assistant');
      const steps = commandExecutor.getUndoStackSize() - before;
      return `Sub-agent finished (${steps} edit step(s)). Report:\n${last && last.role === 'assistant' && last.content ? last.content : '(no report)'}`;
    };

    lastTurnHadImageRef.current = false;
    try {
      const resumeLine = S.resumeSummary && opts.resumeBpId !== undefined
        ? `\nPrevious session: ${S.resumeSummary}` : '';
      const history = await runSiteLogTurn({
        adapter, model, system, tools: TOOL_SCHEMAS,
        history: useAgentStore.getState().history,
        userText,
        mapContext: buildMapContext(gridState, args.region, deps) + resumeLine,
        deps, oversight, signal: ctrl.signal, t,
        resumeBpId: opts.resumeBpId,
        runDelegate,
      });
      agent.setHistory(history);
    } catch (err) {
      // The turn's completed tool rounds are real work the model must remember even
      // when the turn ends in an error; the loop hands them back on the error itself.
      const partial = (err as { partialHistory?: AgentMessage[] }).partialHistory;
      if (partial) agent.setHistory(partial);
      // Disable vision only when the provider actually rejected the image payload.
      // A pause (abort) or a rate limit in a turn that happened to take a snapshot
      // says nothing about the model's vision support.
      const errMsg = err instanceof Error ? err.message : String(err);
      if (lastTurnHadImageRef.current && !ctrl.signal.aborted
        && /image|vision|multimodal|content[_ ]block/i.test(errMsg) && !/429|rate.?limit/i.test(errMsg)) {
        visionRejectedRef.current = true;
      }
      if (!ctrl.signal.aborted) {
        const kind = classifyIncident(err);
        if (kind) setIncident(kind);
        else {
          const msg = err instanceof Error ? err.message : String(err);
          session.getState().pushEntry({
            kind: 'note',
            text: translate('agent2.err_generic', { detail: redactSecrets(msg).slice(0, 160) }),
          });
        }
      }
    } finally {
      abortRef.current = null;
    }
  };

  const send = async (preset?: string) => {
    const text = (preset ?? args.draft).trim();
    if (!text || !apiKey) return;
    args.setDraft('');
    nearBottomRef.current = true;
    const S = session.getState();
    // `running` alone is not the run's lifetime: it goes false while a gate or draft
    // blueprint waits on the user, and starting a second run there would strand the
    // parked one. isRunActive covers the whole span; steering covers both cases.
    if (S.running || isRunActive()) {
      // steering: the note reaches the model appended to its next observation
      S.pushEntry({ kind: 'oslip', text });
      queueSteering(text);
      const bp = S.log.find((e) => e.kind === 'bp' && !e.done && !e.draft && !e.undone && !e.paused);
      if (bp?.kind === 'bp') S.patchEntry(bp.id, { queued: text });
      S.pushEntry({ kind: 'note', text: t('agent2.steer_ack') });
      return;
    }
    await runTurn(text);
  };

  const pause = () => {
    requestPause();
    cancelPending();
    abortRef.current?.abort();
  };

  const resumeBlueprint = (id: number) => {
    if (session.getState().running || isRunActive()) return;
    void runTurn(
      '(system) Resume the paused plan exactly where it left off. Re-check the current map state first, then continue with the next pending stage.',
      { resumeBpId: id, slip: false },
    );
  };

  const undoEntry = (id: number) => {
    const S = session.getState();
    const e = S.getEntry(id);
    const { commandExecutor } = useEditorStore.getState();
    if (!e || !commandExecutor) return;
    const cp = e.kind === 'ticket' ? e.checkpoint : e.kind === 'bp' ? e.startCheckpoint : undefined;
    if (!cp) return;
    const deps = { getExecutor: () => commandExecutor } as AgentToolDeps;
    const n = undoToCheckpoint(deps, cp.undoIndex);
    S.markUndone(id);
    S.pushEntry({ kind: 'note', text: e.kind === 'bp' ? t('agent2.undone_bp') : t('agent2.undone_ticket', { n }) });
  };

  const rewindStage = (id: number, stageIdx: number) => {
    const S = session.getState();
    const e = S.getEntry(id);
    const { commandExecutor } = useEditorStore.getState();
    if (!e || e.kind !== 'bp' || !commandExecutor) return;
    const cp = e.checkpoints[stageIdx];
    if (!cp) return;
    const deps = { getExecutor: () => commandExecutor } as AgentToolDeps;
    const n = undoToCheckpoint(deps, cp.undoIndex);
    const notes = { ...e.notes };
    for (let k = stageIdx; k < e.stages.length; k++) delete notes[k];
    S.patchEntry(id, { doneCount: stageIdx, currentIdx: -1, paused: true, done: false, notes, rail: null, now: null });
    S.pushEntry({ kind: 'note', text: t('agent2.rewound_stage', { stage: e.stages[stageIdx] ?? '', n }) });
  };

  const blueprintGateAnswer = (_id: number, go: boolean) => answerBlueprintGate(go);

  const pickSketch = (id: number, optIdx: number) => {
    const S = session.getState();
    const e = S.getEntry(id);
    if (!e || e.kind !== 'sketches' || e.picked !== null) return;
    S.patchEntry(id, { picked: optIdx });
    void send(t('agent2.pick_message', { name: e.opts[optIdx]?.name ?? '' }));
  };

  return {
    send, pause, resumeBlueprint, undoEntry, rewindStage,
    gateAnswer: answerGate, blueprintGateAnswer, pickSketch,
    incident, clearIncident: () => setIncident(null),
    logRef, nearBottomRef,
  };
}
