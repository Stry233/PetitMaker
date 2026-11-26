// The map check of one export surface as an external store: which pictures a verdict belongs to,
// when a check starts by itself, the one run on its way that every caller shares, and whether the
// surface may show its preview. A surface says what it holds through `watch` and reads `snapshot`;
// its export runs `check` on the same store. An edition that checks no map automatically
// (`edition-review.ts:automaticExportReview`) never starts one and lets the preview through, since
// its export notice asks for the player's own review.
import { createSignal } from '../../core/base/signal';
import { automaticExportReview, liveMapCheck } from './edition-review';
import type { MapReview } from './map-review';

/** What an export surface holds under the map check. */
export interface MapReviewInput {
  open: boolean;
  /** The check starts by itself once the surface is open, as the picture's does; else it waits for `check`. */
  automatic: boolean;
  map: object | null;
  /** The map's edit revision (`core/model/grid-model.ts:mapRevisionOf`). */
  revision: string;
  /** The notes' epoch where the notes go out with the map, else null. */
  notes: number | null;
  /** The chosen illustration's id, empty for none, where an illustration goes out with the map, else null. */
  illustration: string | null;
  /** The surface is a picture of itself, which checks nothing and reads as clear. */
  pictured: boolean;
}

interface MapReviewState {
  result: MapReview | null;
  pending: boolean;
  /** The key of the pictures the surface holds: a verdict stands only for the key it was reached on. */
  revision: string;
  /** Whether the surface may show its preview: the map was checked and no finding blocks it. */
  previewReady: boolean;
}

interface MapReviewSession {
  /** Says what the surface holds now. A change of the pictures stops the check on its way. */
  watch(input: MapReviewInput): void;
  /** The state for what was last watched, or for `input` where a reader holds a newer one than it has said. */
  snapshot(input?: MapReviewInput): MapReviewState;
  subscribe(listener: () => void): () => void;
  /** The verdict on the watched pictures: the kept one, the run on its way, or a new run. */
  check(): Promise<MapReview>;
  /** Stops the check on its way. */
  cancel(): void;
  /** Drops the kept verdict, so the pictures are checked afresh. */
  retry(): void;
  /** Stops the check on its way, as a surface going away does. */
  release(): void;
}

const CLEAR: MapReview = { status: 'clear' };
const NOT_CHECKED: MapReview = { status: 'unavailable' };
const NOTHING_HELD: MapReviewInput = { open: false, automatic: false, map: null, revision: '', notes: null, illustration: null, pictured: false };

const keyOf = (input: MapReviewInput): string => `${input.revision}:${input.notes ?? 'off'}:${input.illustration ?? ''}`;

export function createMapReviewSession(): MapReviewSession {
  const checker = automaticExportReview ? liveMapCheck : null;
  const changed = createSignal();
  let watched: MapReviewInput = NOTHING_HELD;
  let kept: { map: object; key: string; result: MapReview } | null = null;
  let active: { controller: AbortController; promise: Promise<MapReview> } | null = null;
  let state: MapReviewState | null = null;

  const resultOf = (input: MapReviewInput): MapReview | null => {
    if (!checker) return null;
    if (input.pictured) return CLEAR;
    const key = keyOf(input);
    if (kept && kept.map === input.map && kept.key === key) return kept.result;
    return input.map ? checker.known({ map: input.map, key }) : null;
  };

  const stop = (): void => {
    if (!active) return;
    active.controller.abort();
    active = null;
    changed.emit();
  };

  const ended = (controller: AbortController): void => {
    if (active?.controller === controller) active = null;
    changed.emit();
  };

  const check = (): Promise<MapReview> => {
    if (!checker) return Promise.reject(new Error('This edition runs no automatic map check'));
    const input = watched;
    const map = input.map;
    if (!input.open || !map) return Promise.resolve(NOT_CHECKED);
    const result = resultOf(input);
    if (result) return Promise.resolve(result);
    if (active) return active.promise;
    const controller = new AbortController();
    const subject = { map, key: keyOf(input) };
    const promise = (async () => {
      try {
        const verdict = await checker.review({ illustration: input.illustration !== null, annotations: input.notes !== null }, controller.signal, subject);
        kept = { ...subject, result: verdict };
        return verdict;
      } finally {
        ended(controller);
      }
    })();
    active = { controller, promise };
    changed.emit();
    return promise;
  };

  const startIfAutomatic = (): void => {
    if (checker && watched.open && watched.automatic && !resultOf(watched)) void check().catch(() => {});
  };

  return {
    watch(input) {
      const before = watched;
      const samePictures = before.open === input.open && before.map === input.map && keyOf(before) === keyOf(input);
      if (samePictures && before.automatic === input.automatic && before.pictured === input.pictured
        && (before.illustration === null) === (input.illustration === null)) return;
      watched = input;
      if (!samePictures) stop();
      startIfAutomatic();
      changed.emit();
    },
    snapshot(input = watched) {
      const result = resultOf(input);
      const next: MapReviewState = {
        result, pending: active !== null, revision: keyOf(input),
        previewReady: checker ? !!result && result.status !== 'blocked' : true,
      };
      if (!state || state.result !== next.result || state.pending !== next.pending || state.revision !== next.revision
        || state.previewReady !== next.previewReady) state = next;
      return state;
    },
    subscribe: (listener) => changed.subscribe(() => listener()),
    check,
    cancel: stop,
    retry() {
      if (!checker) return;
      stop();
      checker.forget();
      kept = null;
      changed.emit();
      startIfAutomatic();
    },
    release() {
      stop();
      watched = NOTHING_HELD;
    },
  };
}
