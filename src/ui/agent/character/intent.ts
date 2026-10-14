/*
 * The one channel every surface drives the live character through. She lives in an eager layer
 * outside the panel's lazy chunk, so surfaces publish what they ask of her here rather than reaching
 * for her element: a standing intent (a pose, the dream plume, a shoulder badge) and one-shot cues.
 * A standing value is cleared by the surface that set it when it goes.
 */
import { useSyncExternalStore } from 'react';
import { createSignal } from '../../../core/base/signal';
import type { IconId } from '../parts/sprite';
import type { BadgeId } from './badges';
import type { BodyPart, PoseName } from './poses';

/** The dream plume: none, the sleeping zzz, or the glyph of the order she is dreaming. */
export type DreamBadge = 'off' | 'zzz' | IconId;

export interface CharacterIntent {
  /** A surface's own pose, outranking the session phase; null hands her back to the phase. */
  pose: PoseName | null;
  dream: DreamBadge;
}

/** A one-shot played over whatever pose she wears; it ends at identity with no forwards fill. */
export interface Garnish {
  part: Exclude<BodyPart, 'flip'>;
  dur: number;
  easing: string;
  delay?: number;
  composite?: CompositeOperation;
  keyframes: Keyframe[];
}

export type CharacterCue =
  /** Connect's rise out of the sleeping rest; nothing where she is awake. */
  | { kind: 'wake' }
  /** The body squash her own press plays, for a press she cannot hear herself. */
  | { kind: 'acknowledge' }
  /** Gestures over the worn pose, and a shoulder badge for a while where one is named. */
  | { kind: 'garnish'; moves: readonly Garnish[]; badge?: { id: BadgeId; ms: number } };

const REST: CharacterIntent = { pose: null, dream: 'off' };
const intent = createSignal<CharacterIntent>(REST);
const cues = createSignal<CharacterCue | null>(null);

function patch(next: Partial<CharacterIntent>): void {
  const was = intent.get();
  const merged = { ...was, ...next };
  if (merged.pose !== was.pose || merged.dream !== was.dream) intent.emit(merged);
}

/** Publishes the pose the standing surface calls for, or null to hand her back to the phase. */
export function setIntentPose(pose: PoseName | null): void { patch({ pose }); }

/** Publishes the dream plume the keyless rest shows. */
export function setIntentDream(dream: DreamBadge): void { patch({ dream }); }

/** Plays a one-shot on the live character, if one is listening. */
export function cueCharacter(cue: CharacterCue): void { cues.emit(cue); }

/** Listens for cues; returns the unsubscribe. */
export function onCharacterCue(listener: (cue: CharacterCue) => void): () => void {
  return cues.subscribe((cue) => { if (cue) listener(cue); });
}

function subscribe(listener: () => void): () => void {
  return intent.subscribe(listener);
}

/** The standing intent; the first paint reads the rest. */
export function useCharacterIntent(): CharacterIntent {
  return useSyncExternalStore(subscribe, intent.get, () => REST);
}
