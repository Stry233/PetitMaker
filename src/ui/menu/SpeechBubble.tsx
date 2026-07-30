/*
 * SpeechBubble.tsx — the white speech-bubble shape (left-pointing tail + rounded
 * card) shared by the Build / Placement / Generate spoke panels. Kept on its OWN
 * drop-shadow caster: the shadow must sit on this static shape, never on an
 * ancestor of the hovering icons — a hover transform promotes an icon to its own
 * layer and Chromium would then shadow its rectangular PNG bounds.
 *
 * The tail extends past the card edge by `ovl` so the rounded-px seam (and its
 * shadow line) vanishes; tailBasePct is derived from that overlap. Generate
 * passes a pre-scaled card (sCard) so the standard-size tail and the scaled card
 * share one caster.
 */
import { squircleClip } from './squircle';
import { colors, inkTint } from '../styles';

interface Rect { x: number; y: number; w: number; h: number; }
interface Tail extends Rect { tipPct: number; ovl?: number; }
interface Card extends Rect { r: number; }

interface Props {
  px: (n: number) => number;
  tail: Tail;
  card: Card;
}

export function SpeechBubble({ px, tail, card }: Props) {
  const ovl = tail.ovl ?? 12;
  const basePct = ((tail.w / (tail.w + ovl)) * 100).toFixed(2);
  return (
    <div style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 ${px(16)}px ${px(24)}px ${inkTint(0.26)})` }}>
      {/* The shapes hit-test (pointerEvents auto) even if a parent is set pointer-transparent, so the
          VISIBLE bubble always catches clicks (and never lets them fall through to the map/panels
          behind), while the panel's transparent bounding box does NOT — see GeneratePanel. */}
      <div style={{ position: 'absolute', left: px(tail.x), top: px(tail.y), width: px(tail.w + ovl), height: px(tail.h), background: colors.white, clipPath: `polygon(${basePct}% 0%, 100% 0%, 100% 100%, ${basePct}% 100%, 0% ${tail.tipPct}%)`, pointerEvents: 'auto' }} />
      <div style={{ position: 'absolute', left: px(card.x), top: px(card.y), width: px(card.w), height: px(card.h), clipPath: squircleClip(px(card.w), px(card.h), px(card.r)), background: colors.white, pointerEvents: 'auto' }} />
    </div>
  );
}
