/*
 * Composer — the Site Log's order pad (prototype .orderpad): a paper pad slip
 * (#F3EEE8) holding a borderless textarea + the Go / Pause squircle button.
 * Go carries the provider accent; while a job runs the button turns into the
 * red Pause (statusError) with pause bars. Enter (without shift) sends.
 *
 * The textarea is deliberately never animated: a text input must not move or
 * fade under the user's hands. Placeholder copy is chosen by the caller
 * (empty log / has log / running). Everything dims to 50% without an API key.
 *
 * Geometry = prototype css px × 2 (design px, spec §UI.0) through usePx().
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../i18n/context';
import { colors as C, inkTint, font, springs, exitTransition, cursors } from '../design/styles';
import { usePx } from '../design/scale';
import { useAgentFrame } from './frame';
import { squircleClip } from '../primitives/squircle';
import { FitText } from '../primitives/FitText';
import { useAgentStore } from '../../agent/store';
import { PROVIDER_ACCENT } from '../../agent/providers/defaults';
import { CollapseIcon, ExpandIcon, FIELD_DEEP, GoArrowIcon, HoverTip, PauseIcon } from './atoms';

export interface ComposerProps {
  top: number;
  draft: string;
  setDraft(v: string): void;
  running: boolean;
  hasKey: boolean;
  placeholder: string;
  /** Predicted next prompt, shown as ghost text while the field is empty:
   *  Enter/Go sends it, Tab drops it into the field for editing. */
  suggestion?: string | null;
  onSend(): void;
  onPause(): void;
}

export function Composer({ top, draft, setDraft, running, hasKey, placeholder, suggestion, onSend, onPause }: ComposerProps) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();
  const frame = useAgentFrame();
  const provider = useAgentStore((s) => s.settings.provider);
  const accent = PROVIDER_ACCENT[provider];
  const [focused, setFocused] = useState(false);
  const [atCap, setAtCap] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Auto-grow: the textarea hugs its content (1 line when empty) and the row
  // centers it, so short text and the placeholder sit MID-pad, not at the top.
  // Growth CAPS below the panel's foot; past the cap the field scrolls —
  // unbounded growth would push the pad out of the card's bottom edge.
  const MAX_H = px(84); // exactly 2 lines at fs30/1.4 — no half-cut line at the fold
  const taRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const capped = el.scrollHeight > MAX_H;
    el.style.height = `${Math.min(el.scrollHeight, MAX_H)}px`;
    el.style.overflowY = capped ? 'auto' : 'hidden';
    setAtCap(capped);
  }, [draft, MAX_H]);

  const bigRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const el = bigRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  return (
    <div
      style={{
        position: 'absolute',
        left: px(frame.x),
        top: px(top),
        width: px(frame.w),
        boxSizing: 'border-box',
        pointerEvents: 'auto',
      }}
    >
      {/* pad slip */}
      <div
        className="pw-field-wrap"
        style={{
          background: frame.pad,
          borderRadius: px(36),
          padding: `${px(20)}px ${px(26)}px`,
          boxSizing: 'border-box',
          boxShadow: focused ? `inset 0 0 0 ${Math.max(2, px(4))}px #e4d7ae` : 'none',
          transition: 'box-shadow 0.18s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: px(20), minHeight: px(88) }}>
          {/* the placeholder is an overlay (not the native one) so it can
              CENTER vertically and wrap without stretching the textarea */}
          <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
            <textarea
              ref={taRef}
              value={draft}
              rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                } else if (e.key === 'Tab' && !draft && suggestion && !running) {
                  e.preventDefault();
                  setDraft(suggestion);
                }
              }}
              disabled={!hasKey}
              aria-label={placeholder}
              className="pw-field-input"
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                resize: 'none',
                outline: 'none',
                fontFamily: font.family,
                fontWeight: 700,
                fontSize: pxf(30),
                color: C.inkText,
                lineHeight: 1.4,
                maxHeight: px(140),
                padding: 0,
                overflowY: 'hidden',
                opacity: hasKey ? 1 : 0.5,
              }}
            />
            {!draft && (
              <span
                aria-hidden
                style={{
                  position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)',
                  color: suggestion && !running ? C.inkText : C.textSecondary,
                  opacity: !hasKey ? 0.5 : suggestion && !running ? 0.55 : 0.85,
                  pointerEvents: 'none',
                  fontFamily: font.family, fontWeight: 700, fontSize: pxf(30), lineHeight: 1.4,
                }}
              >
                {suggestion && !running ? suggestion : placeholder}
              </span>
            )}
          </div>
          <AnimatePresence>
            {atCap && !expanded && (
              <HoverTip label={t('agent2.expand_editor')}>
                <motion.button
                  type="button"
                  onClick={() => setExpanded(true)}
                  aria-label={t('agent2.expand_editor')}
                  initial={reduced ? false : { opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, transition: exitTransition }}
                  whileHover={reduced ? undefined : { scale: 1.08 }}
                  whileTap={reduced ? undefined : { scale: 0.92 }}
                  transition={springs.stiff}
                  style={{
                    width: px(56), height: px(56), borderRadius: px(18), flexShrink: 0,
                    border: 'none', appearance: 'none', cursor: cursors.clickable, padding: 0,
                    background: FIELD_DEEP, color: C.inkText, display: 'grid', placeItems: 'center',
                  }}
                >
                  <ExpandIcon size={px(28)} />
                </motion.button>
              </HoverTip>
            )}
          </AnimatePresence>
          <motion.button
            type="button"
            onClick={() => (running ? onPause() : onSend())}
            disabled={!hasKey}
            aria-label={running ? t('agent2.pause') : t('agent2.go')}
            whileHover={hasKey && !reduced ? { y: px(-2), scale: 1.02 } : undefined}
            whileTap={hasKey && !reduced ? { scale: 0.95 } : undefined}
            transition={springs.stiff}
            style={{
              flexShrink: 0,
              width: px(156),
              height: px(88),
              clipPath: squircleClip(px(156), px(88), px(30)),
              border: 'none',
              appearance: 'none',
              cursor: hasKey ? cursors.clickable : cursors.blocked,
              color: C.white,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: px(10),
              padding: 0,
              boxSizing: 'border-box',
              background: running ? C.statusError : accent,
              opacity: hasKey ? 1 : 0.5,
            }}
          >
            {running ? <PauseIcon size={px(36)} /> : <GoArrowIcon size={px(36)} />}
            <FitText flow maxW={86} size={29} color={C.white}>{running ? t('agent2.pause') : t('agent2.go')}</FitText>
          </motion.button>
        </div>
      </div>

      {/* ── the floating big editor: a portal card over everything, same draft ── */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {expanded && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: exitTransition }}
                  onClick={() => setExpanded(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 440, background: inkTint(0.35) }}
                />
                {/* centering wrapper (flex) so framer's y offset never fights a
                    translate(-50%) centering transform */}
                <div style={{ position: 'fixed', inset: 0, zIndex: 441, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <motion.div
                  role="dialog"
                  aria-label={t('agent2.expand_editor')}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: px(24), scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, transition: exitTransition }}
                  transition={springs.stiff}
                  style={{
                    pointerEvents: 'auto',
                    width: Math.min(px(880), window.innerWidth * 0.92),
                    display: 'flex', flexDirection: 'column', gap: px(20),
                    background: C.surfacePrimary, borderRadius: px(40), padding: px(28),
                    boxShadow: `0 ${px(30)}px ${px(80)}px ${inkTint(0.35)}`, boxSizing: 'border-box',
                  }}
                >
                  <textarea
                    ref={bigRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    aria-label={placeholder}
                    className="pw-field-input"
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      height: Math.min(px(560), window.innerHeight * 0.5),
                      resize: 'none', border: 'none', outline: 'none',
                      background: C.surfaceSecondary, borderRadius: px(28), padding: px(24),
                      fontFamily: font.family, fontWeight: 700, fontSize: pxf(30),
                      lineHeight: 1.5, color: C.inkText,
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: px(16) }}>
                    <span style={{ flex: 1, fontFamily: font.family, fontWeight: 700, fontSize: pxf(23), color: C.textSecondary }}>
                      {t('agent2.expand_hint')}
                    </span>
                    <motion.button
                      type="button"
                      onClick={() => setExpanded(false)}
                      whileTap={reduced ? undefined : { scale: 0.95 }}
                      transition={springs.stiff}
                      style={{
                        border: 'none', appearance: 'none', cursor: cursors.clickable,
                        display: 'flex', alignItems: 'center', gap: px(12),
                        background: accent, color: C.white, borderRadius: px(24),
                        padding: `${px(16)}px ${px(28)}px`, fontFamily: font.family,
                        fontWeight: fw(800), fontSize: pxf(27),
                      }}
                    >
                      <CollapseIcon size={px(26)} />
                      {t('agent2.expand_done')}
                    </motion.button>
                  </div>
                </motion.div>
                </div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
