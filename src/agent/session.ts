/**
 * Site Log session store: the agent conversation as a log of paper cards.
 *
 * Structure is opt-in, never imposed: the store records whatever the turn
 * engine produces — order slips, notes, build tickets, sketches, blueprints —
 * and the optional structures (a blueprint, a pending gate) hang off entries,
 * not the other way around. Checkpoints are ambient: any write entry carries
 * the undo-stack watermark it started at, so per-card undo and per-stage
 * rewind need no special mode.
 *
 * Persistence: the log (minus transient flags), vitals and the resume summary
 * survive reloads in localStorage next to the map autosave. A blueprint that
 * was mid-run when the page closed hydrates as PAUSED, holding its place.
 */
import { create } from 'zustand';
import { PREFS } from '../core/runtime/prefs';

export type VerbIcon = 'terrain' | 'water' | 'tree' | 'road' | 'build' | 'flower' | 'eval' | 'plan';
export interface Tick { s: 'ok' | 'run' | 'revert'; i: VerbIcon; t: string }
export interface Step { s: 'ok' | 'revert'; t: string }
export interface Checkpoint { undoIndex: number }
export interface Helper { icon: VerbIcon; color: string; name: string; task: string; done: boolean }
export type Oversight = 'strict' | 'checkpoint' | 'yolo';
export interface Vitals { water: number; tree: number; build: number; flower: number }

interface EntryBase { id: number; undone?: boolean }
export interface OrderSlipEntry extends EntryBase { kind: 'oslip'; text: string }
export interface NoteEntry extends EntryBase {
  kind: 'note'; text: string; busy?: boolean; icon?: VerbIcon;
  findings?: { icon: VerbIcon; t: string }[];
}
export interface TicketEntry extends EntryBase {
  kind: 'ticket'; icon: VerbIcon; tile: string; title: string; sub?: string;
  working?: boolean; rail: Tick[]; steps?: Step[]; now?: string | null;
  revertnote?: string | null; undoable?: boolean; flipped?: boolean;
  checkpoint?: Checkpoint;
  /** The model's closing prose for this card; collapsible under it. */
  summary?: string;
  /** User override for the summary fold (default: open only while latest). */
  summaryOpen?: boolean;
}
export interface SketchesEntry extends EntryBase {
  kind: 'sketches';
  opts: { icon: VerbIcon; tile: string; name: string; sub: string }[];
  picked: number | null;
}
export interface BlueprintEntry extends EntryBase {
  kind: 'bp'; goal: string; stages: string[]; draft: boolean; paused: boolean;
  done: boolean; doneCount: number; currentIdx: number; notes: Record<number, string>;
  /** The model's free narration WHILE each stage was active, keyed by stage
   *  index; rendered as a per-stage collapsed disclosure (not a loose note). */
  stageProse?: Record<number, string>;
  rail?: Tick[] | null; now?: string | null; revertnote?: string | null;
  helpers?: Helper[] | null; queued?: string | null; steps: number;
  checkpoints: Checkpoint[]; startCheckpoint?: Checkpoint;
  /** The model's closing prose for this card; collapsible under it. */
  summary?: string;
  summaryOpen?: boolean;
}
export type LogEntry = OrderSlipEntry | NoteEntry | TicketEntry | SketchesEntry | BlueprintEntry;

/** Omit that distributes over the LogEntry union (plain Omit collapses it). */
type NewEntry = LogEntry extends infer E ? (E extends LogEntry ? Omit<E, 'id'> : never) : never;

export const SESSION_LS_KEY = PREFS.agentSession.key;

/** Forget the stored session entirely (the user chose to start fresh at the
 *  welcome-back bubble; the agent's history starts fresh with the map). */
export function discardStoredSession(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(PREFS.agentSession.key); } catch { /* best-effort */ }
}
const PERSIST_DEBOUNCE_MS = 500;

interface AgentSession {
  log: LogEntry[];
  running: boolean;
  thinking: boolean;
  /** A "May I?" request awaiting the user's answer in the dock. */
  gate: { sub: string } | null;
  vitals: Vitals;
  resumeSummary: string;
  /** The model's predicted next user reply (suggest_reply tool), shown as the
   *  composer ghost. Transient, never persisted. */
  suggestion: string | null;

  pushEntry(e: NewEntry): number;
  patchEntry(id: number, patch: Partial<LogEntry>): void;
  getEntry(id: number): LogEntry | undefined;
  setRunning(v: boolean): void;
  setThinking(v: boolean): void;
  setGate(g: { sub: string } | null): void;
  setResumeSummary(s: string): void;
  setSuggestion(s: string | null): void;
  bumpVitals(k: keyof Vitals, n: number): void;
  markUndone(id: number): void;
  /** Clears the conversation ONLY — the map (and its vitals) is never touched. */
  clearLog(): void;
  hydrateFromStorage(): void;
}

let entryId = 0;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Strip per-frame transients so a hydrated session reads as settled paper:
 *  busy notes calm down, tickets stop "working", a mid-run blueprint holds its
 *  place as PAUSED (the map state it refers to is the autosaved one). */
function toStored(e: LogEntry): LogEntry {
  if (e.kind === 'note') {
    const { busy: _b, ...rest } = e;
    return rest;
  }
  if (e.kind === 'ticket') {
    return { ...e, working: false, now: null };
  }
  if (e.kind === 'bp' && !e.done && !e.draft) {
    return { ...e, paused: true, rail: null, now: null, revertnote: null, helpers: null };
  }
  return e;
}

function persist(s: Pick<AgentSession, 'log' | 'vitals' | 'resumeSummary'>): void {
  if (typeof localStorage === 'undefined') return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        PREFS.agentSession.key,
        JSON.stringify({ v: 1, log: s.log.map(toStored), vitals: s.vitals, resumeSummary: s.resumeSummary }),
      );
    } catch {
      /* quota / private mode — session persistence is best-effort */
    }
  }, PERSIST_DEBOUNCE_MS);
}

const VALID_KINDS = new Set(['oslip', 'note', 'ticket', 'sketches', 'bp']);

export const useAgentSession = create<AgentSession>((set, get) => ({
  log: [],
  running: false,
  thinking: false,
  gate: null,
  vitals: { water: 0, tree: 0, build: 0, flower: 0 },
  resumeSummary: '',
  suggestion: null,

  pushEntry: (e) => {
    const id = ++entryId;
    set((s) => {
      const log = [...s.log, { ...e, id } as LogEntry];
      persist({ ...s, log });
      return { log };
    });
    return id;
  },
  patchEntry: (id, patch) =>
    set((s) => {
      const log = s.log.map((e) => (e.id === id ? ({ ...e, ...patch } as LogEntry) : e));
      persist({ ...s, log });
      return { log };
    }),
  getEntry: (id) => get().log.find((e) => e.id === id),
  setRunning: (running) => set({ running }),
  setThinking: (thinking) => set({ thinking }),
  setGate: (gate) => set({ gate }),
  setSuggestion: (suggestion) => set({ suggestion }),
  setResumeSummary: (resumeSummary) =>
    set((s) => {
      persist({ ...s, resumeSummary });
      return { resumeSummary };
    }),
  bumpVitals: (k, n) =>
    set((s) => {
      const vitals = { ...s.vitals, [k]: s.vitals[k] + n };
      persist({ ...s, vitals });
      return { vitals };
    }),
  markUndone: (id) =>
    set((s) => {
      const log = s.log.map((e) => {
        if (e.id !== id) return e;
        const next = { ...e, undone: true } as LogEntry;
        if (next.kind === 'ticket') next.undoable = false;
        if (next.kind === 'bp') next.paused = false;
        return next;
      });
      persist({ ...s, log });
      return { log };
    }),
  clearLog: () =>
    set((s) => {
      persist({ ...s, log: [] });
      return { log: [], gate: null, thinking: false };
    }),

  hydrateFromStorage: () => {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(PREFS.agentSession.key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { v?: number; log?: unknown; vitals?: Vitals; resumeSummary?: string };
      if (parsed.v !== 1 || !Array.isArray(parsed.log)) return;
      const log = (parsed.log as LogEntry[])
        .filter((e) => e && typeof e === 'object' && VALID_KINDS.has(e.kind))
        .map(toStored);
      for (const e of log) if (e.id > entryId) entryId = e.id;
      const v = parsed.vitals;
      const vitals: Vitals =
        v && ['water', 'tree', 'build', 'flower'].every((k) => Number.isFinite((v as unknown as Record<string, unknown>)[k] as number))
          ? v
          : { water: 0, tree: 0, build: 0, flower: 0 };
      set({ log, vitals, resumeSummary: typeof parsed.resumeSummary === 'string' ? parsed.resumeSummary : '' });
    } catch {
      /* corrupt payload — start clean */
    }
  },
}));
