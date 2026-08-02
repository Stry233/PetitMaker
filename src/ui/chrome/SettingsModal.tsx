import { useState, useRef, useEffect, useLayoutEffect, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useT } from '../../i18n/context';
import { font, colors, inkTint, springs, exitTransition, modalTitle, modalRow, radii, shadows, primaryButton, buttonMotion, cursors } from '../styles';
import { BUILD_NUMBER } from '../../version';
import type { Locale } from '../../core/model/types';
import { SegmentedControl } from './SegmentedControl';
import { ModalShell } from './ModalShell';
import { Switch } from './Switch';
import { resetAllLocalData } from '../../io/local-reset';
import { Spinner } from '../Spinner';
import { useEditorStore, type HintLevel } from '../../state/store';
import { startTour } from './tour/use-tour';

// UI-scale slider bounds — mirror the Ctrl+(+/−) shortcut exactly: the store's
// setUiZoom clamps to [0.6, 1.8] and the shortcut bumps by 0.1, so this slider
// shares the same clamps/step (there is only ONE persistence path — setUiZoom).
const UI_SCALE_MIN = 0.6;
const UI_SCALE_MAX = 1.8;
const UI_SCALE_STEP = 0.1;
const roundStep = (z: number) => Math.round(z / UI_SCALE_STEP) * UI_SCALE_STEP;

// Compact modal-row slider that speaks the same visual language as the
// GeneratePanel Slider (dark track, sliderYellow fill + knob, soft knob shadow, and a
// value bubble that pops over the knob) but laid out for a fixed-width settings
// row: a full-width track under the label and a reset pill.
//
// APPLY-ON-RELEASE (pointer): dragging only moves LOCAL visual state (`dragZoom`
// → knob / fill / bubble); the store's setUiZoom fires ONLY on pointer release
// (pointerup / lostpointercapture / cancel). This kills the mid-drag re-zoom
// feedback loop — committing uiZoom while dragging re-applies the chrome CSS
// `zoom`, which rescaled the slider under the cursor and made the drag jump.
// KEYBOARD applies IMMEDIATELY per key press: steps are discrete (0.1) and each
// press is a deliberate commit, so there is no continuous feedback loop to break;
// applying at once keeps aria-valuenow and the reset pill in lockstep with the
// key. Double-click reset + the reset pill also apply immediately.
function UiScaleSlider({ label }: { label: string }) {
  const uiZoom = useEditorStore((s) => s.uiZoom);
  const setUiZoom = useEditorStore((s) => s.setUiZoom);
  const ref = useRef<HTMLDivElement>(null);
  // While dragging, `dragZoom` holds the un-committed value; null otherwise. `dragRef`
  // mirrors it so `commitDrag` can read the pending value without a stale closure and
  // without calling setUiZoom from inside a setState updater.
  const [dragZoom, setDragZoom] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);
  const [hover, setHover] = useState(false);
  const dragging = dragZoom !== null;
  const setDrag = (v: number) => { dragRef.current = v; setDragZoom(v); };
  // What the knob/fill/bubble show — the live drag value while dragging, else the store value.
  const shownZoom = dragZoom ?? uiZoom;
  const pct = Math.round(shownZoom * 100);
  const ratio = (shownZoom - UI_SCALE_MIN) / (UI_SCALE_MAX - UI_SCALE_MIN);
  const isDefault = Math.round(uiZoom * 100) === 100;

  const zoomFromClientX = (clientX: number): number => {
    const el = ref.current;
    if (!el) return uiZoom;
    const r = el.getBoundingClientRect();
    const frac = r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
    return roundStep(UI_SCALE_MIN + frac * (UI_SCALE_MAX - UI_SCALE_MIN));
  };
  // Commit the pending drag value to the store on release (idempotent — a no-op if not dragging).
  const commitDrag = () => {
    if (dragRef.current !== null) setUiZoom(dragRef.current);
    dragRef.current = null;
    setDragZoom(null);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = uiZoom + UI_SCALE_STEP;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = uiZoom - UI_SCALE_STEP;
    else if (e.key === 'Home') next = UI_SCALE_MIN;
    else if (e.key === 'End') next = UI_SCALE_MAX;
    if (next !== null) { e.preventDefault(); setUiZoom(roundStep(next)); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, minHeight: 26 }}>
        <span style={labelStyle}>{label}</span>
        <AnimatePresence>
          {!isDefault && (
            <motion.button
              type="button"
              style={resetChipStyle}
              onClick={() => setUiZoom(1)}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={springs.stiff}
              whileTap={{ scale: 0.92 }}
              whileHover={{ scale: 1.05 }}
              aria-label={`${label} 100%`}
            >
              {'↺ 100%'}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={Math.round(UI_SCALE_MIN * 100)}
        aria-valuemax={Math.round(UI_SCALE_MAX * 100)}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%`}
        onKeyDown={onKeyDown}
        onDoubleClick={() => { dragRef.current = null; setDragZoom(null); setUiZoom(1); }}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrag(zoomFromClientX(e.clientX)); }}
        onPointerMove={(e) => { if (e.buttons) setDrag(zoomFromClientX(e.clientX)); }}
        onPointerUp={commitDrag}
        onPointerCancel={commitDrag}
        onLostPointerCapture={commitDrag}
        style={{ position: 'relative', height: 24, cursor: cursors.clickable, touchAction: 'none', outline: 'none' }}
      >
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 10, transform: 'translateY(-50%)', background: colors.loadDark, borderRadius: 999, opacity: 0.9 }} />
        <div style={{ position: 'absolute', top: '50%', left: 0, width: `${ratio * 100}%`, height: 10, transform: 'translateY(-50%)', background: colors.sliderYellow, borderRadius: 999 }} />
        <div style={{ position: 'absolute', top: '50%', left: `${ratio * 100}%`, width: 20, height: 20, transform: 'translate(-50%, -50%)', borderRadius: '50%', background: colors.sliderYellow, boxShadow: `0 2px 6px ${inkTint(0.3)}` }} />
        {/* Value bubble over the knob — same visual language as the GeneratePanel Slider
            (dark fill, white bold %, soft shadow, down-pointing tail; Framer x:'-50%' centering,
            NEVER a CSS transform on the animated element). Shows on hover OR drag, matching it. */}
        <AnimatePresence>
          {(hover || dragging) && (
            <motion.div key="bubble"
              initial={{ opacity: 0, scale: 0.6, x: '-50%', y: 4 }}
              animate={{ opacity: 1, scale: 1, x: '-50%', y: 0 }}
              exit={{ opacity: 0, scale: 0.6, x: '-50%', y: 4 }}
              transition={springs.stiff}
              style={{ position: 'absolute', left: `${ratio * 100}%`, bottom: '100%', marginBottom: 12, transformOrigin: 'bottom center', background: colors.frameDark, color: colors.white, fontFamily: font.family, fontWeight: 900, fontSize: 14, lineHeight: 1, padding: '5px 11px', borderRadius: 10, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: `0 4px 12px ${inkTint(0.32)}` }}>
              {`${pct}%`}
              <span style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: `6px solid ${colors.frameDark}` }} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Language picker options — native endonyms so each is recognizable in its own
// script. Order matches the translation source spreadsheet (zh first).
const LOCALES: { code: Locale; label: string }[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ru', label: 'Русский' },
  { code: 'th', label: 'ไทย' },
  { code: 'id', label: 'Indonesia' },
  { code: 'fr', label: 'Français' },
];

export interface SettingsModalProps {
  /** Drives the shared `ModalShell` open/close choreography. Defaults to `true`
   *  so tests can mount the modal directly; App passes `open={showSettings}`
   *  and keeps the component mounted so the card exit animates as one unit. */
  open?: boolean;
  locale: Locale;
  showGrid: boolean;
  showChunks: boolean;
  motionPref: 'system' | 'reduced' | 'full';
  systemCursors: boolean;
  hintLevel: HintLevel;
  classicCursors: boolean;
  onLocaleChange: (locale: Locale) => void;
  onShowGridChange: (show: boolean) => void;
  onShowChunksChange: (show: boolean) => void;
  onMotionPrefChange: (p: 'system' | 'reduced' | 'full') => void;
  onSystemCursorsChange: (on: boolean) => void;
  onHintLevelChange: (level: HintLevel) => void;
  onClassicCursorsChange: (on: boolean) => void;
  onAbout: () => void;
  onClose: () => void;
}

// Shared with the erase-confirm panel's exit `marginTop` below (see there) so
// the two can never drift apart — a corner canonicalized to a bare number
// (never a string like '22px') so it's directly usable in that arithmetic.
export const CARD_ROW_GAP = 22;

const cardStyle: CSSProperties = {
  padding: 28,
  display: 'flex',
  flexDirection: 'column',
  gap: CARD_ROW_GAP,
};

const titleStyle: CSSProperties = { ...modalTitle };

// Each row pairs a label with a content-sized control (switch/chip/segmented-control) via
// space-between. Several controls (the Motion segmented control, the About/Reset chips) size to
// their own untranslated-length content rather than shrinking, so a long language (ru, fr, …) can
// make label + control together wider than the fixed 380px card. `flexWrap` lets the control drop
// to its own line below the label instead of overflowing the card edge or wrapping mid-word inside
// a pill — it only engages when the natural width doesn't fit; en/zh always fit on one line today,
// so this is a no-op for the baseline locales.
const rowStyle: CSSProperties = { ...modalRow, flexWrap: 'wrap', rowGap: 8 };

const labelStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: colors.frameDark,
  fontFamily: font.family,
};

// Seven languages would overflow a beside-the-label segmented control, so the
// picker is a compact dropdown: a pill trigger (right-aligned like the About
// chip) that opens a floating menu of endonyms.
const langTriggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  minWidth: 124,
  fontSize: 14,
  fontWeight: 800,
  fontFamily: font.family,
  border: 'none',
  cursor: cursors.clickable,
  padding: '7px 14px',
  borderRadius: radii.pill,
  background: colors.surfaceSecondary,
  color: colors.frameDark,
};

const dropdownPanelStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  zIndex: 10,
  background: colors.surfacePrimary,
  borderRadius: radii.lg,
  boxShadow: shadows.s2,
  padding: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 150,
  transformOrigin: 'top right',
};

const dropdownItemStyle = (active: boolean): CSSProperties => ({
  fontSize: 14,
  fontWeight: active ? 800 : 700,
  fontFamily: font.family,
  border: 'none',
  cursor: cursors.clickable,
  textAlign: 'left',
  padding: '8px 14px',
  borderRadius: radii.md,
  // Inactive items match the panel fill (invisible) so the whileHover tint
  // animates cleanly instead of flashing in from transparent.
  background: active ? colors.tileYellow : colors.surfacePrimary,
  color: active ? colors.frameDark : colors.textSecondary,
  whiteSpace: 'nowrap',
});

// Pill chip on the About row's right side — surfaces the build number and opens
// the About page on click. Styled like the segmented control buttons.
const aboutChipStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  fontFamily: font.family,
  border: 'none',
  cursor: cursors.clickable,
  padding: '7px 14px',
  borderRadius: 999,
  background: colors.surfaceSecondary,
  color: colors.frameDark,
};

// Reset-to-100% pill on the UI-scale row — same pill shape as the About chip,
// sized down for a secondary in-row action.
const resetChipStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  fontFamily: font.family,
  border: 'none',
  cursor: cursors.clickable,
  padding: '5px 11px',
  borderRadius: 999,
  background: colors.surfaceSecondary,
  color: colors.frameDark,
  whiteSpace: 'nowrap',
};

// Danger chip (reset local data) — same shape as the About chip, tinted.
const dangerChipStyle: CSSProperties = {
  ...aboutChipStyle,
  background: colors.dangerBg,
  color: colors.dangerText,
};

const dangerConfirmStyle: CSSProperties = {
  ...aboutChipStyle,
  background: colors.statusError,
  color: colors.white,
};

export function SettingsModal({
  open = true,
  locale,
  showGrid,
  showChunks,
  motionPref,
  systemCursors,
  hintLevel,
  classicCursors,
  onLocaleChange,
  onShowGridChange,
  onShowChunksChange,
  onMotionPrefChange,
  onSystemCursorsChange,
  onHintLevelChange,
  onClassicCursorsChange,
  onAbout,
  onClose,
}: SettingsModalProps) {
  const t = useT();
  const [langOpen, setLangOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const currentLabel = LOCALES.find((l) => l.code === locale)?.label ?? locale;

  // The erase-confirm panel measures its own natural height via `scrollHeight`
  // (never getBoundingClientRect or Framer's `height: 'auto'`): the modal card
  // sits inside `ModalShell`'s chrome-scale CSS `zoom` (see ui/menu/scale.tsx),
  // and rect-derived values are already multiplied by that zoom, so the spring
  // would converge on an inflated height that the zoomed ancestor scales AGAIN.
  // `scrollHeight` is in the same local CSS-px space inline `height` values are
  // interpreted in, so it feeds `height` directly. A `ResizeObserver` keeps it
  // in sync with content that can reflow while open (a locale swap changes
  // warn-text length; the resetting spinner swaps in for the button row).
  const confirmContentRef = useRef<HTMLDivElement>(null);
  const [confirmHeight, setConfirmHeight] = useState(0);
  useLayoutEffect(() => {
    const el = confirmContentRef.current;
    if (!el || !confirmReset) return;
    const measure = () => setConfirmHeight(el.scrollHeight);
    measure();
    // Guard for environments without ResizeObserver (jsdom in tests) — the
    // one-shot measure above still runs, so the state transition is exercised.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [confirmReset, locale, resetting]);

  // Close the dropdown on any pointer-down outside it (clicks elsewhere in the
  // modal, or on the overlay — which also closes the modal).
  useEffect(() => {
    if (!langOpen) return;
    const onDown = (e: PointerEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [langOpen]);

  // Fresh start each time the modal opens (the component stays mounted between
  // opens now, so reset the language dropdown + reset-confirm flow here rather
  // than relying on unmount).
  useEffect(() => {
    if (open) {
      setLangOpen(false);
      setConfirmReset(false);
      setResetting(false);
    }
  }, [open]);

  return (
    <ModalShell open={open} onClose={onClose} width={380} cardStyle={cardStyle} ariaLabel={t('modal.settings_title')}>
        <div style={titleStyle}>{t('modal.settings_title')}</div>

        {/* Language — compact dropdown (right-aligned, like the About chip) */}
        <div style={rowStyle}>
          <span style={labelStyle}>{t('modal.settings_language')}</span>
          <div ref={langRef} style={{ position: 'relative' }}>
            <motion.button
              type="button"
              style={langTriggerStyle}
              onClick={() => setLangOpen((o) => !o)}
              whileTap={{ scale: 0.97 }}
              aria-haspopup="listbox"
              aria-expanded={langOpen}
            >
              <span>{currentLabel}</span>
              <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden style={{ transition: 'transform 0.18s ease', transform: langOpen ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
                <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.button>
            <AnimatePresence>
              {langOpen && (
                <motion.div
                  style={dropdownPanelStyle}
                  role="listbox"
                  initial={{ opacity: 0, y: -6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  transition={springs.stiff}
                >
                  {LOCALES.map(({ code, label }) => (
                    <motion.button
                      key={code}
                      type="button"
                      role="option"
                      aria-selected={locale === code}
                      style={dropdownItemStyle(locale === code)}
                      whileHover={{ backgroundColor: locale === code ? colors.tileYellow : colors.surfaceSecondary }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => { onLocaleChange(code); setLangOpen(false); }}
                    >
                      {label}
                    </motion.button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* UI scale — slider bound to the same store field as Ctrl+(+/−) zoom */}
        <UiScaleSlider label={t('modal.settings_ui_scale')} />

        {/* Grid lines toggle */}
        <div style={rowStyle}>
          <span style={labelStyle}>{t('modal.settings_grid')}</span>
          <Switch on={showGrid} onClick={() => onShowGridChange(!showGrid)} label={t('modal.settings_grid')} />
        </div>

        {/* Chunk boundaries toggle */}
        <div style={rowStyle}>
          <span style={labelStyle}>{t('modal.settings_chunks')}</span>
          <Switch on={showChunks} onClick={() => onShowChunksChange(!showChunks)} label={t('modal.settings_chunks')} />
        </div>

        {/* Replay the first-launch tour. A button, not a Switch: it performs an action rather than
            holding a setting. Closes Settings before starting the tour so the modal does not sit
            on top of the overlay it just launched. */}
        <div style={rowStyle}>
          <span style={labelStyle}>{t('modal.settings_tour')}</span>
          <motion.button
            type="button"
            style={aboutChipStyle}
            onClick={() => { onClose(); startTour(); }}
            whileTap={{ scale: 0.95 }}
            whileHover={{ scale: 1.03 }}
          >
            {t('modal.settings_tour_action')}
          </motion.button>
        </div>

        {/* Motion preference — System follows the OS reduce-motion setting; the
            others override it. */}
        <div style={rowStyle}>
          <span style={labelStyle}>{t('modal.settings_motion')}</span>
          <SegmentedControl
            idPrefix="settings-motion"
            value={motionPref}
            options={['system', 'reduced', 'full'] as const}
            onChange={onMotionPrefChange}
            render={(p) => t(`modal.settings_motion_${p}`)}
            stretch={false}
          />
        </div>

        {/* Quick hints — how much the on-canvas hint panel says, 'off' hiding it. */}
        <div style={rowStyle}>
          <span style={labelStyle}>{t('modal.settings_hints')}</span>
          <SegmentedControl
            idPrefix="settings-hints"
            value={hintLevel}
            options={['full', 'concise', 'off'] as const}
            onChange={onHintLevelChange}
            render={(l) => t(`modal.settings_hints_${l}`)}
            stretch={false}
          />
        </div>

        {/* System cursors — the accessibility opt-out. A custom CSS cursor is an image, so it
            cannot honour the pointer size or theme the OS is configured with; a user who relies
            on those needs a way back to them, and the app's coverage is now app-wide. */}
        <div style={rowStyle}>
          <span style={labelStyle}>{t('modal.settings_system_cursors')}</span>
          <Switch on={systemCursors} onClick={() => onSystemCursorsChange(!systemCursors)} label={t('modal.settings_system_cursors')} />
        </div>

        {/* Classic cursors — the drawn SVG set the app shipped before its pixel art. Off is the
            shipped set; the row does nothing while the OS is drawing the pointer above. */}
        <div style={rowStyle}>
          <span style={labelStyle}>{t('modal.settings_classic_cursors')}</span>
          <Switch on={classicCursors} onClick={() => onClassicCursorsChange(!classicCursors)} label={t('modal.settings_classic_cursors')} />
        </div>

        {/* About — opens the About page; the chip shows the current build number */}
        <div style={rowStyle}>
          <span style={labelStyle}>{t('modal.settings_about')}</span>
          <motion.button style={aboutChipStyle} onClick={onAbout} whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.03 }}>
            {`${t('about.build')} ${BUILD_NUMBER} ›`}
          </motion.button>
        </div>

        {/* Reset local data — two-step confirm, then full wipe + reload. */}
        <div style={rowStyle}>
          <span style={labelStyle}>{t('modal.settings_reset')}</span>
          {!confirmReset && (
            <motion.button style={dangerChipStyle} onClick={() => setConfirmReset(true)} whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.03 }}>
              {t('modal.settings_reset_btn')}
            </motion.button>
          )}
        </div>
        <AnimatePresence>
          {confirmReset && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: -12 }}
              animate={{ opacity: 1, height: confirmHeight, marginTop: -12 }}
              // EXIT-ONLY: `marginTop` rides down to -CARD_ROW_GAP (fully
              // cancelling the card's flex `gap`) IN STEP with `height` going to
              // 0, on the no-overshoot `exitTransition` (see styles.ts) rather
              // than the bouncy entrance spring. At steady state, `marginTop:
              // -12` only cancels 12 of the parent's CARD_ROW_GAP-px gap — the
              // other (CARD_ROW_GAP-12)px is the resting "tight" gap under the
              // row above, and it's invisible to entrance (initial/animate hold
              // it constant at -12, byte-identical to before). But that slack is
              // OUTSIDE the height-animated box, so it survived every frame down
              // to height:0 and only vanished the instant AnimatePresence
              // unmounted the element and the flex `gap` collapsed to a single
              // CARD_ROW_GAP — the reported jump. Ending the exit at
              // marginTop:-CARD_ROW_GAP makes the box's own occupied span (gap +
              // marginTop + height) reach EXACTLY the post-unmount single-gap
              // baseline before removal, so unmount changes nothing.
              exit={{ opacity: 0, height: 0, marginTop: -CARD_ROW_GAP, transition: exitTransition }}
              transition={springs.stiff}
              style={{ overflow: 'hidden' }}
            >
              <div ref={confirmContentRef} style={{ background: colors.dangerBg, borderRadius: radii.lg, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, fontFamily: font.family, color: colors.dangerDeep, lineHeight: 1.45 }}>
                  {t('modal.settings_reset_warn')}
                </span>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                  {resetting ? (
                    <Spinner size={22} color={colors.statusError} />
                  ) : (
                    <>
                      <motion.button style={aboutChipStyle} onClick={() => setConfirmReset(false)} {...buttonMotion}>
                        {t('delete.cancel')}
                      </motion.button>
                      <motion.button
                        style={dangerConfirmStyle}
                        onClick={() => { setResetting(true); void resetAllLocalData(); }}
                        {...buttonMotion}
                      >
                        {t('modal.settings_reset_confirm')}
                      </motion.button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button style={primaryButton} onClick={onClose} {...buttonMotion}>
          {t('modal.settings_ok')}
        </motion.button>
    </ModalShell>
  );
}
