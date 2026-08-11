/*
 * ModelDropdown — the ONE model picker menu, shared by the header row's model
 * pill and the setup screen's model row so both look and behave identically.
 *
 * Rendered through a PORTAL to document.body with fixed positioning measured
 * from the anchor: the panel this menu opens in clips its own overflow, which
 * would otherwise cut the menu off. The menu sizes to the anchor,
 * flips upward when the space below is short, and closes on backdrop click.
 * (The menu subtree is scaled via px() multiplication, not css zoom, so
 * client rects are real screen pixels — no divide-out needed.)
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../i18n/context';
import { colors as C, inkTint, font, springs, exitTransition, cursors } from '../design/styles';
import { usePx } from '../design/scale';
import { ClickCatcher } from '../primitives/ClickCatcher';
import { useScrollFade } from '../primitives/scroll-fade';
import { prettyModel, CARD_LINE } from './atoms';

export interface ModelDropdownProps {
  open: boolean;
  onClose(): void;
  anchor: RefObject<HTMLElement>;
  models: string[];
  model: string;
  onPick(m: string): void;
  /** Optional trailing row (the header pill's "Change platform…"). */
  footer?: ReactNode;
}

/** One dropdown option row: quiet by default, field-tint on hover, pale
 *  yellow when selected. Exported so every menu in the agent UI shares it. */
export function MenuRow({ selected, onClick, children }: { selected?: boolean; onClick(): void; children: ReactNode }) {
  const reduced = useReducedMotionConfig();
  const { px } = usePx();
  return (
    <motion.button
      type="button"
      role="option"
      aria-selected={selected ?? false}
      onClick={onClick}
      initial={false}
      animate={{ backgroundColor: selected ? C.tilePaleYellow : 'rgba(243,238,232,0)' }}
      whileHover={selected ? undefined : { backgroundColor: C.surfaceSecondary }}
      whileTap={reduced ? undefined : { scale: 0.985 }}
      transition={{ duration: 0.12 }}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', textAlign: 'left',
        border: 'none', appearance: 'none',
        borderRadius: px(20), padding: `${px(14)}px ${px(22)}px`, cursor: cursors.clickable,
        fontFamily: font.family, boxSizing: 'border-box',
      }}
    >
      {children}
    </motion.button>
  );
}

export function ModelDropdown({ open, onClose, anchor, models, model, onPick, footer }: ModelDropdownProps) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listFade = useScrollFade(listRef, 'y');

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const measure = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const maxH = px(520);
      const up = r.bottom + px(12) + maxH > window.innerHeight && r.top > window.innerHeight - r.bottom;
      const next = { left: r.left, top: up ? r.top - px(12) : r.bottom + px(12), width: r.width, up };
      setPos((p) => (p && p.left === next.left && p.top === next.top && p.width === next.width && p.up === next.up ? p : next));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, anchor, px]);

  if (!open || !pos || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <ClickCatcher onDismiss={onClose} zIndex={400} />
      <motion.div
        ref={listRef}
        initial={reduced ? false : { opacity: 0, y: px(pos.up ? 8 : -8), scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, transition: exitTransition }}
        transition={springs.stiff}
        className="pw-noscroll"
        role="listbox"
        aria-label={t('agent2.model')}
        style={{
          position: 'fixed', left: pos.left, width: pos.width, zIndex: 401,
          ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
          background: C.white, border: `1px solid ${CARD_LINE}`, borderRadius: px(28),
          boxShadow: `0 ${px(24)}px ${px(56)}px ${inkTint(0.22)}`, padding: px(12),
          display: 'flex', flexDirection: 'column', gap: px(6),
          maxHeight: px(520), overflowY: 'auto', boxSizing: 'border-box',
          transformOrigin: pos.up ? 'bottom center' : 'top center',
          ...listFade,
        }}
      >
        {models.map((m) => (
          <MenuRow key={m} selected={m === model} onClick={() => { onPick(m); onClose(); }}>
            <span style={{ fontWeight: fw(800), fontSize: pxf(28), color: C.inkText }}>{prettyModel(m)}</span>
            <span style={{ fontSize: pxf(22), fontWeight: 700, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{m}</span>
          </MenuRow>
        ))}
        <input
          type="text"
          placeholder={t('agent2.custom_model_ph')}
          className="pw-field-input"
          aria-label={t('agent2.model')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = (e.target as HTMLInputElement).value.trim();
              if (v) { onPick(v); onClose(); }
            }
          }}
          style={{
            width: '100%', boxSizing: 'border-box', marginTop: px(4), padding: `${px(12)}px ${px(22)}px`,
            borderRadius: px(20), border: `1px solid ${C.trackOff}`, outline: 'none', background: 'transparent',
            fontFamily: font.family, fontWeight: 700, fontSize: pxf(25), color: C.inkText,
          }}
        />
        {footer}
      </motion.div>
    </>,
    document.body,
  );
}
