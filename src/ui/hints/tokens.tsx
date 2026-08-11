/*
 * The drawn hint tokens. Keycap text arrives already resolved (catalogue.ts); the arrow cap and
 * the mouse are SVG because font glyphs for arrows and mice vary by OS and read too thin at 8px.
 */
import type { CSSProperties } from 'react';
import { colors, inkTint, radii } from '../design/styles';
import { useT } from '../../i18n/context';
import type { MouseButton, MouseMark, ResolvedToken } from './catalogue';

const INK = colors.frameDark;

const capStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  minWidth: 22, height: 22, padding: '0 6px', borderRadius: 6,
  background: colors.white, border: `1.5px solid ${inkTint(0.18)}`, borderBottomWidth: 3,
  fontSize: 12, fontWeight: 900, color: INK, lineHeight: 1, position: 'relative',
};

const badgeStyle: CSSProperties = {
  position: 'absolute', top: -6, right: -7, background: colors.tileYellow,
  border: `1.5px solid ${INK}`, borderRadius: radii.pill, fontSize: 9, fontWeight: 900,
  padding: '0 3px', lineHeight: 1.3,
};

export function KeyCap({ label, x2 }: { label: string; x2?: boolean }) {
  return (
    <span style={capStyle}>
      {label}
      {x2 && <span style={badgeStyle}>×2</span>}
    </span>
  );
}

function Arrow({ rot }: { rot: number }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" style={{ display: 'block', transform: `rotate(${rot}deg)` }} aria-hidden>
      <path d="M4 7 V1.4 M1.4 3.6 L4 1 L6.6 3.6" fill="none" stroke={INK} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowsCap() {
  return (
    <span style={{ ...capStyle, gap: 2.5 }}>
      <Arrow rot={0} /><Arrow rot={180} /><Arrow rot={270} /><Arrow rot={90} />
    </span>
  );
}

/** The live move letters over their fixed arrow aliases. One token, so the caps cost the row the
 *  width of the wider cap rather than both plus an "or". */
function PanStack({ letters }: { letters: string }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <KeyCap label={letters} />
      <ArrowsCap />
    </span>
  );
}

// Drawn 1:1 with its viewBox, so the strokes land on whole pixels. The scroll box is 28 rather
// than the 27 its chevrons reach: the tips sit AT x=27, and half of their 1.5px stroke would fall
// outside a box that ended there.
function MouseGlyph({ button, mark, x2 }: { button: MouseButton; mark?: MouseMark; x2?: boolean }) {
  const w = mark === 'drag' || mark === 'hscroll' ? 31 : mark === 'scroll' ? 28 : 20;
  return (
    <span style={{ display: 'inline-flex', position: 'relative' }}>
      <svg width={w} height={26} viewBox={`0 0 ${w} 26`} data-mouse={mark ? `${button}-${mark}` : button} aria-hidden style={{ display: 'block' }}>
        {button === 'left' && <path d="M9 3 H8.5 C5.4 3 3 5.4 3 8.5 V11 H9 Z" fill={colors.tileYellow} />}
        {button === 'right' && <path d="M11 3 H11.5 C14.6 3 17 5.4 17 8.5 V11 H11 Z" fill={colors.tileYellow} />}
        <rect x="3" y="3" width="14" height="20" rx="7" fill="none" stroke={INK} strokeWidth="1.6" />
        <path d="M10 3 V11 M3 11 H17" stroke={INK} strokeWidth="1.3" fill="none" />
        <rect x="8.8" y="5.5" width="2.4" height="5.5" rx="1.2" fill={button === 'wheel' || button === 'middle' ? colors.tileYellow : 'none'} stroke={INK} strokeWidth="1.3" />
        {mark === 'drag' && <g stroke={INK} strokeWidth="1.5" fill="none"><path d="M22 13 H29 M26.5 10.5 L29 13 L26.5 15.5 M24.5 10.5 L22 13 L24.5 15.5" /></g>}
        {mark === 'scroll' && <g stroke={INK} strokeWidth="1.5" fill="none"><path d="M23 9 L25 6.5 L27 9 M23 17 L25 19.5 L27 17" /></g>}
        {mark === 'hscroll' && <g stroke={INK} strokeWidth="1.5" fill="none"><path d="M24 10.5 L21.5 13 L24 15.5 M27 10.5 L29.5 13 L27 15.5" /></g>}
      </svg>
      {x2 && <span style={badgeStyle}>×2</span>}
    </span>
  );
}

export function HintTokens({ tokens }: { tokens: readonly ResolvedToken[] }) {
  const t = useT();
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, flex: 'none', minWidth: 20 }}>
      {tokens.map((tok, i) => {
        if (tok.kind === 'cap') return <KeyCap key={i} label={tok.label} x2={tok.x2} />;
        if (tok.kind === 'pan-stack') return <PanStack key={i} letters={tok.letters} />;
        if (tok.kind === 'mouse') return <MouseGlyph key={i} button={tok.button} mark={tok.mark} x2={tok.x2} />;
        const label = tok.sep === 'plus' ? '+' : t(`hint.sep.${tok.sep}`);
        return <span key={i} style={{ fontSize: 11, fontWeight: 800, color: colors.textSecondary, padding: '0 1px' }}>{label}</span>;
      })}
    </span>
  );
}
