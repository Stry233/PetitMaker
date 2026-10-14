/*
 * Asking an endpoint which models a credential can run, as one mechanism for every connection form:
 * an optionally debounced probe, a newer probe aborting and outdating the one in flight, the model
 * list, a refusal counter a refused field shakes on, and the default-model fallback. Each form's
 * adapter makes the request and says what the answer meant.
 */

/** What a probe ended in: the models listed, an endpoint that will not enumerate, a refused
 *  credential, or no request made. */
export type ProbeAnswer = { models: readonly string[] } | 'unlisted' | 'refused' | 'skipped';

/** One connection form's model request. A throw is a failure the form may still generate through,
 *  so it settles as `unlisted`; an adapter that reports the failure catches it itself. */
export type ModelProbe<Req> = (request: Req, signal: AbortSignal, isCurrent: () => boolean) => Promise<ProbeAnswer>;

export type DiscoveryState = 'none' | 'loading' | 'ready' | 'unlisted' | 'refused';

export interface DiscoverySnapshot {
  state: DiscoveryState;
  models: readonly string[];
  /** Bumped by every refusal, so a second refusal of the same credential shakes again. */
  refusals: number;
  /** Bumped as a list lands, so the model row can mark the arrival once. */
  arrivals: number;
}

export interface ModelDiscovery<Req> {
  get(): DiscoverySnapshot;
  subscribe(listener: () => void): () => void;
  /** Asks after `debounceMs` (at once when 0), outdating every earlier probe. */
  probe(request: Req, debounceMs?: number): void;
  /** Outdates the probe in flight and keeps the state shown. */
  supersede(): void;
  /** Outdates the probe in flight and returns to `none`. */
  reset(): void;
  /** Shows a remembered answer without asking: the list, or null for a model typed by hand. */
  restore(models: readonly string[] | null): void;
  /** Counts a refusal that came from outside a probe, such as a failed save. */
  noteRefusal(): void;
}

/** Whether a probe has answered, either way. */
export const discoverySettled = (state: DiscoveryState): boolean => state === 'ready' || state === 'unlisted';

/** The model a form shows once its probe settles: the current one while the list still offers it,
 *  else the list's first; where the endpoint will not list, the typed model, else the provider's
 *  default. */
export function settledModel(current: string, snap: Pick<DiscoverySnapshot, 'state' | 'models'>, fallback: string | undefined): string {
  if (snap.state === 'ready') return snap.models.includes(current) ? current : snap.models[0] ?? current;
  if (snap.state === 'unlisted') return current || fallback || current;
  return current;
}

export function createModelDiscovery<Req>(ask: ModelProbe<Req>): ModelDiscovery<Req> {
  let snap: DiscoverySnapshot = { state: 'none', models: [], refusals: 0, arrivals: 0 };
  const listeners = new Set<() => void>();
  let generation = 0;
  let pending: { timer: ReturnType<typeof setTimeout> | undefined; abort: AbortController } | null = null;

  const set = (next: Partial<DiscoverySnapshot>) => {
    snap = { ...snap, ...next };
    for (const listener of [...listeners]) listener();
  };
  const outdate = () => {
    generation += 1;
    if (pending) { clearTimeout(pending.timer); pending.abort.abort(); pending = null; }
  };

  function run(request: Req, abort: AbortController, mine: number): void {
    const isCurrent = () => mine === generation;
    ask(request, abort.signal, isCurrent).then((answer) => {
      if (!isCurrent()) return;
      pending = null;
      if (answer === 'skipped') set({ state: 'none' });
      else if (answer === 'refused') set({ state: 'refused', refusals: snap.refusals + 1 });
      else if (answer === 'unlisted' || answer.models.length === 0) set({ state: 'unlisted' });
      else set({ state: 'ready', models: answer.models, arrivals: snap.arrivals + 1 });
    }, () => {
      if (!isCurrent()) return;
      pending = null;
      set({ state: 'unlisted' });
    });
  }

  return {
    get: () => snap,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    probe(request, debounceMs = 0) {
      outdate();
      const mine = generation;
      const abort = new AbortController();
      pending = { timer: undefined, abort };
      set({ state: 'loading', models: [] });
      if (debounceMs <= 0) { run(request, abort, mine); return; }
      pending.timer = setTimeout(() => run(request, abort, mine), debounceMs);
    },
    supersede: outdate,
    reset() {
      outdate();
      if (snap.state !== 'none' || snap.models.length > 0) set({ state: 'none', models: [] });
    },
    restore(models) {
      outdate();
      set(models && models.length > 0 ? { state: 'ready', models } : { state: 'unlisted', models: [] });
    },
    noteRefusal: () => set({ refusals: snap.refusals + 1 }),
  };
}
