/**
 * badges.tsx — the character's shoulder badge, one per `PoseSpec.badge` (poses.ts). Two are the
 * PSD-extracted PNG art beside `base.png` (idea/ask); the other six are drawn as SVG, transcribed
 * verbatim from the normative prototype's `SVG_BADGES` table — including its stroke tables
 * `BST`/`BSG` (the two outline treatments every drawn badge uses) and each drawing's own rotation,
 * which the prototype bakes into the artwork rather than the pose's transform.
 *
 * REFRESH IS ONE DRAWN LOOP, NOT A PNG. It was classified with the two PNGs and rendered from
 * `badge-refresh.png`, which depicts a TWO-arrow sync mark; the prototype's own art table has no
 * `refresh` entry at all, so every working pose it drives showed two overlapping circular arrows
 * where the design has one arc with one arrowhead. Its path data is the prototype's, like the other
 * five drawn badges'.
 */
import { characterArt } from '../../../assets/agent/agent-art';

export type BadgeId = 'idea' | 'refresh' | 'ask' | 'zzz' | 'pause' | 'exclaim' | 'spark' | 'note';

/** Prototype `BST` — the warm-tan outline the yellow (`#FFDA7E`) badges draw. */
const BST = { stroke: '#B5884F', strokeWidth: 2.6, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
/** Prototype `BSG` — the grey outline the taupe (`#C9C2B4`) badges draw. */
const BSG = { stroke: '#8F8778', strokeWidth: 2.4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

/** Prototype `.badge img,.badge svg{max-width:100%;max-height:100%}`. */
const FIT: React.CSSProperties = { maxWidth: '100%', maxHeight: '100%', display: 'block' };

function RefreshBadge() {
  return (
    <svg viewBox="0 0 40 40" data-badge="refresh" style={FIT}>
      <g transform="rotate(-6 20 20)">
        <path
          d="M 32.80 23.26 A 13 13 0 1 1 23.14 8.39 L 21.65 14.40 A 6.8 6.8 0 1 0 26.70 22.18 Z"
          fill="#FFDA7E" {...BST}
        />
        <path d="M 24.09 4.60 L 31.61 13.69 L 20.70 18.19 Z" fill="#FFDA7E" {...BST} />
      </g>
    </svg>
  );
}
/**
 * The sleeper's zzz: three marks rising off her shoulder, and they LIGHT IN SEQUENCE — the smallest
 * one last, the three going out together and starting over. It is the only thing on the disconnected
 * screen that is not the board turning over, so a static trio reads as a drawing of sleep rather than
 * as sleep. The beat is `animations.css`'s `pw-zzzfade` (2.1s, the marks 0.35s apart), which carries
 * the reduced-motion gate with it: the three then stand lit.
 */
function ZzzBadge() {
  return (
    <svg viewBox="0 0 44 40" data-badge="zzz" style={FIT}>
      <g className="pw-zzz-mark" transform="rotate(-8 12 26)"><path d="M5 18 h13 v4 l-7.4 7 h7.4 v4 H5 v-4 l7.4-7 H5 z" fill="#C9C2B4" {...BSG} /></g>
      <g className="pw-zzz-mark pw-zzz-mark-2" transform="rotate(6 28 14)"><path d="M21 8 h10 v3.2 l-5.6 5.4 h5.6 v3.2 H21 v-3.2 l5.6-5.4 H21 z" fill="#C9C2B4" {...BSG} /></g>
      <g className="pw-zzz-mark pw-zzz-mark-3" transform="rotate(-4 39 6)"><path d="M34 2 h7 v2.4 l-3.9 3.8 h3.9 v2.4 h-7 v-2.4 l3.9-3.8 h-3.9 z" fill="#D8D2C5" {...BSG} /></g>
    </svg>
  );
}
function PauseBadge() {
  return (
    <svg viewBox="0 0 40 40" data-badge="pause" style={FIT}>
      <g transform="rotate(-5 20 20)">
        <rect x="10" y="9" width="8" height="22" rx="4" fill="#C9C2B4" {...BSG} />
        <rect x="23" y="10" width="8" height="21" rx="4" fill="#C9C2B4" {...BSG} />
      </g>
    </svg>
  );
}
function ExclaimBadge() {
  return (
    <svg viewBox="0 0 40 40" data-badge="exclaim" style={FIT}>
      <g transform="rotate(6 20 20)">
        <path
          d="M20 4 c4 0 6 2.4 5.6 6 l-1.8 13 c-.3 2.3-1.7 3.4-3.8 3.4 s-3.5-1.1-3.8-3.4 l-1.8-13 C14 6.4 16 4 20 4 z"
          fill="#FFDA7E" {...BST}
        />
        <circle cx="20" cy="34" r="3.6" fill="#FFDA7E" {...BST} />
      </g>
    </svg>
  );
}
function SparkBadge() {
  return (
    <svg viewBox="0 0 44 40" data-badge="spark" style={FIT}>
      <g transform="rotate(-6 22 20)">
        <path d="M22 3 l4.4 12.2 L38 20 l-11.6 4.8 L22 37 l-4.4-12.2 L6 20 l11.6-4.8 z" fill="#FFDA7E" {...BST} />
      </g>
      <circle cx="38" cy="8" r="2.6" fill="#FFDA7E" {...BST} />
      <circle cx="6" cy="32" r="2.2" fill="#FFDA7E" {...BST} />
    </svg>
  );
}
function NoteBadge() {
  return (
    <svg viewBox="0 0 40 40" data-badge="note" style={FIT}>
      <g transform="rotate(-8 20 20)">
        <rect x="8" y="6" width="24" height="28" rx="6" fill="#FFF7DF" {...BST} />
        <path d="M14 15 h12 M14 21 h12 M14 27 h7" fill="none" {...BST} />
      </g>
    </svg>
  );
}

/** One badge, by id. The two PNG ones carry `data-badge` on the `<img>` itself so a test (or a
 *  future caption) can identify which is mounted without inspecting `src`. */
export function Badge({ id }: { id: BadgeId }) {
  switch (id) {
    case 'idea': return <img draggable={false} src={characterArt('badge-idea')} alt="" data-badge="idea" style={FIT} />;
    case 'refresh': return <RefreshBadge />;
    case 'ask': return <img draggable={false} src={characterArt('badge-ask')} alt="" data-badge="ask" style={FIT} />;
    case 'zzz': return <ZzzBadge />;
    case 'pause': return <PauseBadge />;
    case 'exclaim': return <ExclaimBadge />;
    case 'spark': return <SparkBadge />;
    case 'note': return <NoteBadge />;
  }
}
