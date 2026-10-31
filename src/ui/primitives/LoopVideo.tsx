/**
 * A muted, looping clip in its frame: its sources in the order offered, its poster while it loads.
 * It plays on its own unless the reader reduces motion or the caller holds it (`autoplay` false, as
 * for a visitor saving data), and then rests on its poster under a play control until asked. A clip
 * none of whose sources plays shows its poster and nothing else. A pictured subtree shows the poster.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { useUiPreview } from '../design/preview';
import { skin } from '../design/window-skin';
import { ActionButton } from './ActionButton';
import { PlayIcon } from './line-glyphs';
import { useNameReveal } from './use-name-reveal';

export interface VideoSource { src: string; type: string }

/** What a caller can do with a standing clip. */
export interface LoopVideoHandle {
  /** The element, while one stands (not under its failure or in a picture). */
  video(): HTMLVideoElement | null;
  /** Plays from `seconds`, which counts as asking to play. */
  playFrom(seconds: number): void;
}

const mediaStyle: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const PLAY_SIZE = 56;
const playStyle: CSSProperties = {
  position: 'absolute', insetInlineStart: '50%', top: '50%', width: PLAY_SIZE, height: PLAY_SIZE, marginTop: -PLAY_SIZE / 2,
  marginInlineStart: -PLAY_SIZE / 2, borderRadius: '50%', border: 'none',
  background: skin.active, color: skin.ink, display: 'grid', placeItems: 'center', padding: 0, WebkitTapHighlightColor: 'transparent',
  // It takes its presses even over a clip a caller lets presses through.
  pointerEvents: 'auto',
};

export const LoopVideo = forwardRef<LoopVideoHandle, {
  sources: readonly VideoSource[];
  poster: string | null;
  /** The clip's accessible name. */
  label: string;
  /** The play control's name. */
  playLabel: string;
  /** False holds the clip on its poster until asked; reduced motion always does. */
  autoplay?: boolean;
  /** True stands a clip that plays on its own at its start, loading but unplayed and with no play
   *  control, until it turns false, when the clip plays from its start. */
  waiting?: boolean;
  /** The poster shows only while the clip rests on it, never while a clip about to play loads: for a
   *  poster of the clip's end, which would stand for a moment before the clip starts from its start. */
  posterAtRest?: boolean;
  /** The frame the clip fills. */
  style: CSSProperties;
  onPlaying?: () => void;
  /** The clip stopped playing (paused, or put away). */
  onPause?: () => void;
  onFailed?: () => void;
  testId?: string;
}>(function LoopVideo({
  sources, poster, label, playLabel, autoplay = true, waiting = false, posterAtRest = false, style, onPlaying, onPause, onFailed, testId,
}, handle) {
  const pictured = useUiPreview();
  const reduced = useReducedMotionConfig() === true;
  const ref = useRef<HTMLVideoElement>(null);
  const [asked, setAsked] = useState(false);
  const [failed, setFailed] = useState(false);
  const allowed = autoplay && !reduced;
  const playing = allowed || asked;
  const playName = useNameReveal(playLabel);
  const play = (): void => {
    setAsked(true);
    void ref.current?.play().catch(() => setAsked(false));
  };
  useImperativeHandle(handle, () => ({
    video: () => ref.current,
    playFrom: (seconds) => {
      const v = ref.current;
      if (!v) return;
      v.currentTime = seconds;
      play();
    },
  }));
  // A clip released from waiting plays from its start, whatever loading moved its time to.
  const waited = useRef(waiting);
  useEffect(() => {
    const was = waited.current;
    waited.current = waiting;
    const v = ref.current;
    if (!was || waiting || !allowed || !v) return;
    v.currentTime = 0;
    void Promise.resolve(v.play()).catch(() => {});
  }, [waiting, allowed]);
  // The last source's failure is the clip's: an earlier one only hands over to the next.
  const fail = (): void => { setFailed(true); onFailed?.(); };
  const still = pictured || failed || sources.length === 0;
  return (
    <div style={{ position: 'relative', overflow: 'hidden', ...style }} data-testid={testId}>
      {still ? (
        poster ? <img src={poster} alt={label} style={mediaStyle} data-testid={testId && `${testId}-poster`} /> : null
      ) : (
        <video ref={ref} style={mediaStyle} muted loop playsInline autoPlay={allowed && !waiting} preload={allowed ? 'auto' : 'none'}
          poster={(posterAtRest && playing ? null : poster) ?? undefined} aria-label={label} data-testid={testId && `${testId}-video`}
          onPlaying={onPlaying} onPause={onPause} onError={fail}>
          {sources.map((s, i) => <source key={s.src} src={s.src} type={s.type} onError={i === sources.length - 1 ? fail : undefined} />)}
        </video>
      )}
      {!still && !playing && (
        <ActionButton interaction="tile" data-testid={testId && `${testId}-play`} {...playName.bind} aria-label={playLabel}
          style={playStyle} onClick={play}>
          <PlayIcon size={26} />
          {playName.bubble}
        </ActionButton>
      )}
    </div>
  );
});
