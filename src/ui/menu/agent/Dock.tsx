/**
 * Dock.tsx — the one state-colored live tile between the header row and the
 * site log (spec §UI.3). Renders a DockView (derived by dock-state.ts) and
 * owns the METRO FLIP between states:
 *
 *   Real state (kind) change = a two-phase turn on the horizontal center axis,
 *   so both states read as two sides of one card:
 *     phase 1 (220ms, cubic-bezier(.55,0,.85,.36)): the OLD face + OLD
 *       background rotateX 0→88°, scale→.96, opacity→.85 (accelerating away);
 *     swap content at edge-on;
 *     phase 2 (480ms, cubic-bezier(.22,.9,.3,1)): the NEW face arrives from
 *       −88° and settles with a small overshoot (+10°@.62 → −5°@.82 →
 *       +2°@.93 → 0).
 *   Same-kind data updates (key change) = a 180ms content crossfade only.
 *   Reduced motion = instant swap.
 *
 * The flip needs the OLD face after React has committed the new one, so each
 * effect pass snapshots the settled innerHTML + background; on a kind change
 * the snapshot becomes a pointer-transparent OVERLAY (our own markup, verbatim)
 * that hides the live face for phase 1, then it is removed and phase 2 lands
 * on the live face. All imperative WAAPI in the effect, never render-phase
 * state: React may discard a render pass under batching, which silently
 * drops any freeze-frame state set during render.
 */
import { useEffect, useRef } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { useAgentSession } from '../../../agent/session';
import { useT } from '../../../i18n/context';
import { colors as C, inkTint, font, cursors } from '../../styles';
import { usePx } from '../scale';
import { DOCK_BG, type DockChipAct, type DockKind, type DockView } from './dock-state';
import { GBtn, Segs, StripeBar, VerbGlyph, VITAL_GREEN } from './atoms';

const VITAL_KEYS = ['water', 'tree', 'build', 'flower'] as const;

const PHASE1: Keyframe[] = [
  { transform: 'perspective(700px) rotateX(0deg) scale(1)', opacity: 1 },
  { transform: 'perspective(700px) rotateX(88deg) scale(0.96)', opacity: 0.85 },
];
const PHASE2: Keyframe[] = [
  { transform: 'perspective(700px) rotateX(-88deg) scale(0.96)', opacity: 0.85 },
  { transform: 'perspective(700px) rotateX(10deg) scale(1.01)', opacity: 1, offset: 0.62 },
  { transform: 'perspective(700px) rotateX(-5deg)', offset: 0.82 },
  { transform: 'perspective(700px) rotateX(2deg)', offset: 0.93 },
  { transform: 'perspective(700px) rotateX(0deg) scale(1)' },
];

interface Face { kind: DockKind; key: string; bg: string; html: string; pad: string; gap: string }

export interface DockProps {
  view: DockView;
  onChip: (act: DockChipAct) => void;
  /** Tap anywhere that is not a chip: scroll the log to the live blueprint. */
  onJump: () => void;
}

export function Dock({ view, onChip, onJump }: DockProps) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();
  const vitals = useAgentSession((s) => s.vitals);

  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Snapshot of the last settled face (what a flip turns away from). */
  const last = useRef<Face | null>(null);
  /** True while a flip's phases are running (a newer flip clears the old). */
  const flipToken = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const canAnimate = typeof el.animate === 'function';
    // A flip that is still playing gets superseded: drop its overlay.
    for (const stale of el.querySelectorAll('[data-dock-flip]')) stale.remove();
    const liveHtml = el.innerHTML;
    const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    const p = last.current;

    if (p && p.kind !== view.kind && canAnimate && !reduced) {
      // Metro two-phase turn: the OLD face (an inert overlay clone) rides
      // phase 1 to edge-on, then the live NEW face arrives with phase 2.
      const token = ++flipToken.current;
      const ov = document.createElement('div');
      ov.setAttribute('data-dock-flip', '');
      ov.style.cssText =
        `position:absolute;inset:0;display:flex;align-items:center;box-sizing:border-box;` +
        `padding:${p.pad};gap:${p.gap};border-radius:inherit;background:${p.bg};` +
        `pointer-events:none;z-index:2;overflow:hidden;`;
      ov.innerHTML = p.html;
      el.appendChild(ov);
      el.animate(PHASE1, { duration: 220, easing: 'cubic-bezier(.55,0,.85,.36)' })
        .finished.then(() => {
          ov.remove();
          if (flipToken.current !== token) return;
          el.animate(PHASE2, { duration: 480, easing: 'cubic-bezier(.22,.9,.3,1)' });
        })
        .catch(() => ov.remove());
    } else if (p && p.kind === view.kind && p.key !== view.key && canAnimate && !reduced) {
      // Same-kind data update: crossfade the content only.
      const c = contentRef.current;
      if (c && typeof c.animate === 'function') {
        c.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 180, easing: 'cubic-bezier(.4,0,.2,1)' });
      }
    }
    last.current = {
      kind: view.kind, key: view.key, bg: DOCK_BG[view.kind], html: liveHtml,
      pad: cs?.padding ?? '', gap: cs?.gap ?? '',
    };
  });

  const glyphTile = (
    <span
      style={{
        width: px(68),
        height: px(68),
        borderRadius: px(22),
        background: 'rgba(255,255,255,.72)',
        display: 'grid',
        placeItems: 'center',
        color: C.inkText,
        flex: '0 0 auto',
      }}
    >
      <VerbGlyph icon={view.icon} size={px(38)} />
    </span>
  );

  const body = view.vitals ? (
    <div
      ref={contentRef}
      data-testid="dock-vitals"
      style={{ display: 'flex', gap: px(24), flex: 1, minWidth: 0, alignItems: 'center' }}
    >
      {VITAL_KEYS.map((k) => (
        <span
          key={k}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: px(8),
            fontSize: pxf(25),
            fontWeight: fw(800),
            color: C.inkText,
            fontFamily: font.family,
          }}
        >
          <span style={{ color: VITAL_GREEN, display: 'flex' }}>
            <VerbGlyph icon={k} size={px(28)} />
          </span>
          {vitals[k]}
        </span>
      ))}
      <span
        style={{
          marginLeft: 'auto',
          fontSize: pxf(23),
          fontWeight: fw(800),
          color: inkTint(0.5),
          fontFamily: font.family,
          whiteSpace: 'nowrap',
        }}
      >
        {t('agent2.on_the_map')}
      </span>
    </div>
  ) : (
    <>
      <div ref={contentRef} style={{ flex: 1, minWidth: 0 }}>
        <b
          style={{
            fontSize: pxf(30),
            display: 'block',
            color: C.inkText,
            fontFamily: font.family,
            fontWeight: fw(800),
          }}
        >
          {view.title}
        </b>
        {view.sub ? (
          <small
            style={{
              fontSize: pxf(24),
              fontWeight: fw(700),
              color: inkTint(0.6),
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: font.family,
            }}
          >
            {view.sub}
          </small>
        ) : null}
        {view.segs ? <Segs done={view.segs[0]} total={view.segs[1]} /> : null}
        {view.stripes ? <StripeBar /> : null}
        {view.chips ? (
          <div style={{ display: 'flex', gap: px(14), marginTop: px(18), flexWrap: 'wrap' }}>
            {view.chips.map((c, i) => (
              <GBtn key={c.act} label={c.label} kind={c.cls} delay={i * 0.05} onClick={() => onChip(c.act)} />
            ))}
          </div>
        ) : null}
      </div>
      {view.right ? (
        <span
          style={{
            fontSize: pxf(23),
            fontWeight: fw(900),
            color: inkTint(0.55),
            textAlign: 'right',
            flex: '0 0 auto',
            alignSelf: 'flex-start',
            paddingTop: px(4),
            fontFamily: font.family,
          }}
        >
          {view.right}
        </span>
      ) : null}
    </>
  );

  return (
    <div
      ref={ref}
      data-testid="dock"
      data-kind={view.kind}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return; // chips handle themselves
        onJump();
      }}
      style={{
        borderRadius: px(32),
        padding: `${px(22)}px ${px(26)}px`,
        display: 'flex',
        alignItems: 'center',
        gap: px(20),
        position: 'relative',
        overflow: 'hidden',
        cursor: cursors.clickable,
        transition: 'background .35s',
        transformOrigin: '50% 50%',
        background: DOCK_BG[view.kind],
      }}
    >
      {glyphTile}
      {body}
    </div>
  );
}
