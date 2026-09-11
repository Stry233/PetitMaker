/*
 * The keyboard-shortcuts page. A DaVinci-Resolve-style interactive board: a rendered ANSI keyboard + numeric keypad whose keys show each command tinted
 * by category at the active modifier layer; a search field to reach any command (incl. unmapped ones
 * with no key); click a key to select its command, then Record a new chord (steals from the prior
 * holder), Clear, or Reset. Everything reads from the command REGISTRY (kit/commands) +
 * the user OVERRIDE store (core/runtime/keybindings) — adding a command anywhere makes it appear +
 * bindable here, no per-command wiring. Fully DOM, so it is verifiable via the headless-Firefox
 * screenshot loop.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { motion, AnimatePresence, useReducedMotionConfig, type Variants } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import { font, radii, inkTint, springs, buttonMotion, cursors } from '../../../design/styles';
import {
  skin, windowCard, windowInset, windowMenu, windowMenuItem, windowMenuItemHover, windowPill,
  windowTitle, type WindowSurface,
} from '../../../design/window-skin';
import { roleFont, TEXT_ROLES } from '../../../design/text-weight';
import { ModalShell } from '../../../primitives/ModalShell';
import { useScrollFadeBoth } from '../../../primitives/scroll-fade';
import { useWheelToHorizontal } from '../../../primitives/wheel-horizontal';
import { showToast } from '../../floating/Toast';
import { downloadBlob } from '../../../../io/image-export';
import { COMMANDS, COMMAND_BY_ID, type EditorCommand } from '../../../../kit/commands';
import {
  aliasIndex, bindingIndex, effectiveCombo, useKeybinds, prettyCombo, PRESETS, detectPreset, serializeKeybinds, parseKeybinds,
} from '../../../../core/runtime/keybindings';
import {
  KEY_ROWS, NUMPAD, NUMPAD_COLS, NUMPAD_ROWS_N, NAV, NAV_COLS, NAV_ROWS_N,
  CATEGORY_COLOR, CATEGORY_ORDER, comboFor, comboFromEvent, type KeyDef, type Layer,
} from './layout';

export interface KeyboardModalProps { open?: boolean; onClose: () => void }

// Keycap metrics. Sized so the labels stay legible after the chrome zoom shrinks the card on a short
// viewport, and so keycap type sits in the same range as the rest of the chrome (the board simply gets
// wider; the 96vw cap + horizontal scroll already handle that).
const UNIT = 60;
const GAP = 6;
const KEY_H = 58;
const BOARD_GAP = 24;
const BASE_LAYER: Layer = { ctrl: false, alt: false, shift: false };

/* ── small styled atoms ──────────────────────────────────────────────────── */

const cardStyle: CSSProperties = { ...windowCard, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 24 };
// ONLY the keyboard region scrolls (header + footer stay pinned). ONE container scrolls BOTH axes, so
// each bar anchors to the visible scrollport — the h-bar stays at the region's bottom edge and the
// v-bar at its right, both reachable regardless of scroll position. Do NOT nest a second scroller
// for the other axis: its h-bar would sit at the bottom of the tall inner content, out of reach
// until the v-bar is scrolled down. overflow:auto with safe-center centers the board when it fits and
// left-aligns it when it scrolls; flexShrink lets it absorb a height squeeze. It is the app's one
// BOTH-axis scroller, so it wears `useScrollFadeBoth`'s intersected mask (see the ref below) — and
// each cozy bar sits inside the OTHER axis's 24px ramp, so a two-axis mask washes both bars out along
// their whole length rather than fading their ends. `pw-noscroll` hides the platform bars here: the
// fade is the one continuation signal for both axes, replacing them rather than fighting them.
const kbdRegion: CSSProperties = {
  display: 'flex', justifyContent: 'safe center', alignItems: 'flex-start',
  flex: '0 1 auto', minHeight: 0, overflowX: 'auto', overflowY: 'auto',
};

/**
 * The board's horizontal bar: the region hides the platform bars (`pw-noscroll`) and the edge fade
 * says "more", but a fade cannot be grabbed — this draws a thumb over the same native scroller and
 * writes back. Mounted only while the board actually overflows. It wears the app's cozy scrollbar
 * look (`animations.css`: a thin warm pill on a transparent lane, the modals' own bars), drawn out
 * here only because the region's two-axis fade mask would wash a bar INSIDE the scroller along its
 * whole length.
 */
const HBAR_H = 12;
// The visible pill: the cozy bar's 12px lane minus its 3px transparent inset each side.
const HBAR_THUMB = 6;
const HBAR_FILL = 'var(--sb-thumb, rgba(130, 96, 66, 0.40))';
const HBAR_FILL_HOVER = 'var(--sb-thumb-hover, rgba(130, 96, 66, 0.62))';
function BoardHBar({ left, vw, cw, label, onScrollTo }: {
  left: number; vw: number; cw: number; label: string;
  onScrollTo: (left: number, glide: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** The pointer's offset into the thumb while a drag holds it, in track px. */
  const grab = useRef<number | null>(null);
  const [hover, setHover] = useState(false);
  const room = Math.max(0, cw - vw);
  // The floor keeps the thumb grabbable on a very wide board; percentage of the track, so it
  // follows the window without a measured width.
  const thumbFrac = Math.max(0.08, cw > 0 ? vw / cw : 1);
  const posFrac = room > 0 ? left / room : 0;

  const scrollFor = (clientX: number): number | null => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const thumbW = rect.width * thumbFrac;
    const travel = rect.width - thumbW;
    if (travel <= 0) return 0;
    const thumbLeft = clientX - rect.left - (grab.current ?? thumbW / 2);
    return Math.min(room, Math.max(0, (thumbLeft / travel) * room));
  };
  const down = (e: ReactPointerEvent<HTMLElement>, onThumb: boolean): void => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const thumbW = rect.width * thumbFrac;
    // Grabbing the thumb keeps the point under the pointer; pressing the track jumps the thumb's
    // centre there, so the press lands where the user aimed rather than a thumb-width away.
    grab.current = onThumb ? e.clientX - rect.left - (rect.width - thumbW) * posFrac : thumbW / 2;
    const to = scrollFor(e.clientX);
    if (to !== null) onScrollTo(to, !onThumb);
  };

  return (
    <div
      ref={ref}
      role="scrollbar"
      aria-label={label}
      aria-controls="kbd-region"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(room)}
      aria-valuenow={Math.round(left)}
      onPointerDown={(e) => down(e, false)}
      onPointerMove={(e) => {
        if (!e.buttons || grab.current === null) return;
        const to = scrollFor(e.clientX);
        if (to !== null) onScrollTo(to, false);
      }}
      onPointerUp={() => { grab.current = null; }}
      style={{ position: 'relative', height: HBAR_H, margin: '6px 6px 0', flexShrink: 0, cursor: cursors.clickable, touchAction: 'none' }}
    >
      <span
        data-testid="kbd-hbar-thumb"
        onPointerDown={(e) => { e.stopPropagation(); down(e, true); }}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        style={{
          position: 'absolute', top: (HBAR_H - HBAR_THUMB) / 2, height: HBAR_THUMB,
          left: `${posFrac * (1 - thumbFrac) * 100}%`, width: `${thumbFrac * 100}%`,
          borderRadius: radii.pill, background: hover ? HBAR_FILL_HOVER : HBAR_FILL,
          transition: 'background-color 0.15s ease',
        }}
      />
    </div>
  );
}
const titleStyle: CSSProperties = { ...windowTitle, marginBottom: 16, flexShrink: 0 };

// The window pill, at this page's own size (its rows are denser than Settings'). `primary` is the
// design's active yellow: on this page it marks the action that is about to take the next keypress.
// `on` is the cream the pill stands on — the detail strip is an inset, the rest of the page a plate.
function pill(variant: 'quiet' | 'primary' | 'danger', disabled = false, on: WindowSurface = 'plate'): CSSProperties {
  const base = windowPill(variant === 'primary' ? 'active' : variant, disabled, on);
  return { ...base, padding: '8px 16px' };
}

// Layer chips = a filled segmented control: active is the dark ink pill, inactive the quiet fill.
function chip(active: boolean): CSSProperties {
  return {
    ...pill('quiet'), padding: '7px 16px',
    ...(active ? { background: skin.ink, color: skin.plate } : {}),
  };
}

const comboChip: CSSProperties = {
  fontFamily: font.family, ...roleFont('chip'), color: skin.plate,
  background: skin.ink, padding: '5px 12px', borderRadius: 8, whiteSpace: 'nowrap',
};

// The window's dropdown menu, anchored under its trigger.
const menuStyle: CSSProperties = {
  ...windowMenu,
  position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 172, zIndex: 6,
  transformOrigin: 'top left',
};
function menuItem(active: boolean): CSSProperties {
  return {
    ...windowMenuItem(active),
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%',
    textAlign: 'left',
  };
}

/* ── entrance ─────────────────────────────────────────────────────────────────
 * A grid this dense reads heavy if it simply scales up with the card, so the board assembles itself
 * just after the card lands: the three clusters are staggered, and within the main block each ROW
 * settles, so the eye follows it coming together instead of being handed all ~100 keys at once.
 * One short cascade (~0.3s total), spring physics, and no movement at all under reduced motion.
 */
const BOARD_IN: Variants = { hidden: {}, show: { transition: { delayChildren: 0.05, staggerChildren: 0.045 } } };
const CLUSTER_IN: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.028 } } };
const ROW_IN: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 520, damping: 34, mass: 0.6 } },
};
/** Reduced motion keeps the cascade's ORDER but drops the travel, so nothing slides. */
const ROW_IN_REDUCED: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.12 } },
};

/* ── component ────────────────────────────────────────────────────────────── */

export function KeyboardModal({ open = true, onClose }: KeyboardModalProps) {
  const t = useT();
  const overrides = useKeybinds((s) => s.overrides);
  const rebind = useKeybinds((s) => s.rebind);
  const clear = useKeybinds((s) => s.clear);
  const resetAll = useKeybinds((s) => s.resetAll);
  const applyBinds = useKeybinds((s) => s.applyBinds);

  const [layer, setLayer] = useState<Layer>(BASE_LAYER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const reduced = useReducedMotionConfig();
  const rowIn = reduced ? ROW_IN_REDUCED : ROW_IN;
  const [presetOpen, setPresetOpen] = useState(false);
  const presetRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const kbdRef = useRef<HTMLDivElement>(null);
  const kbdFade = useScrollFadeBoth(kbdRef);
  // When the window is short enough that only sideways travel remains, a mouse's vertical
  // notches drive it; with vertical room the hook stands aside and the wheel scrolls as usual.
  useWheelToHorizontal(kbdRef);

  // The board region's live scroll geometry, feeding the drawn horizontal bar below it.
  const [hbar, setHbar] = useState({ left: 0, vw: 0, cw: 0 });
  const measureHbar = useCallback(() => {
    const el = kbdRef.current;
    if (!el) return;
    setHbar((p) => (p.left === el.scrollLeft && p.vw === el.clientWidth && p.cw === el.scrollWidth)
      ? p
      : { left: el.scrollLeft, vw: el.clientWidth, cw: el.scrollWidth });
  }, []);
  useEffect(() => {
    measureHbar();
    const el = kbdRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measureHbar);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, measureHbar]);

  const activePreset = useMemo(() => detectPreset(overrides), [overrides]);

  // Preset dropdown: close on outside click.
  useEffect(() => {
    if (!presetOpen) return;
    const onDoc = (e: MouseEvent): void => { if (presetRef.current && !presetRef.current.contains(e.target as Node)) setPresetOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [presetOpen]);

  const onExport = (): void => {
    const blob = new Blob([serializeKeybinds(overrides)], { type: 'application/json' });
    downloadBlob(blob, 'petitmaker-keybinds.json');
  };
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    const res = parseKeybinds(await file.text());
    if (res.ok && res.binds) { applyBinds(res.binds); setSelectedId(null); showToast(t('kbd.imported'), 'info'); }
    else showToast(t('kbd.import_failed'), 'error');
  };

  const index = useMemo(() => bindingIndex(overrides), [overrides]);
  const aliases = useMemo(() => aliasIndex(), []);
  const selected = selectedId ? COMMAND_BY_ID.get(selectedId) : undefined;
  const label = (id: string): string => { const c = COMMAND_BY_ID.get(id); return c ? t(c.labelKey) : id; };

  // Reset transient state whenever the page closes/reopens.
  useEffect(() => { if (!open) { setSelectedId(null); setSearch(''); setRecording(false); setNote(null); setLayer(BASE_LAYER); setPresetOpen(false); } }, [open]);

  // Chord capture while recording. Capture phase + preventDefault so the chord never fires a command.
  useEffect(() => {
    if (!recording || !selectedId) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setRecording(false); return; }
      const combo = comboFromEvent(e);
      if (!combo) return; // bare modifier / space — keep listening
      const r = rebind(selectedId, combo);
      // The one refusal a recorded chord can hit: a shifted twin of a live UI-scale binding, which
      // the UI-scale listener answers on the same keycap.
      if (!r.ok) setNote(t('kbd.reserved'));
      else setNote(r.displaced ? `${t('kbd.reassigned_from')} ${label(r.displaced)}` : null);
      setRecording(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, selectedId, rebind, t]);

  const pick = (id: string): void => { setSelectedId(id); setRecording(false); setNote(null); };
  const toggleMod = (mod: 'ctrl' | 'alt' | 'shift'): void => setLayer((l) => ({ ...l, [mod]: !l[mod] }));

  const searchHits: EditorCommand[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return COMMANDS.filter((c) => t(c.labelKey).toLowerCase().includes(q)).slice(0, 7);
  }, [search, t]);

  /* ── keyboard grid ──────────────────────────────────────────────────────── */
  const renderKey = (key: KeyDef, ri: number, ki: number) => {
    const w = key.w ?? 1;
    const width = w * UNIT + (w - 1) * GAP;
    if (key.spacer) return <div key={`${ri}-${ki}`} style={{ width, height: KEY_H, flex: '0 0 auto' }} />;
    const grid = key.col != null;
    const combo = comboFor(key, layer);
    const cmdId = combo ? (index.get(combo) ?? aliases.get(combo)) : undefined;
    const cmd = cmdId ? COMMAND_BY_ID.get(cmdId) : undefined;
    // An alias key (arrow→pan, backspace→delete, ctrl+y→redo) shows its command but isn't the
    // command's editable PRIMARY binding — mark it with a dashed border.
    const isAlias = !!combo && !!cmd && !index.has(combo);
    const isSelected = !!cmd && cmd.id === selectedId;
    // A key that REPRESENTS a modifier layer lights up while that layer is engaged, whether or not it
    // also carries a command: `mod` (Ctrl/Alt, which toggle on click) and `layerOf` (Shift, which
    // holds the constrain binding and stays selectable) both count, in every combination.
    const layerKeyOf = key.mod ?? key.layerOf;
    const modActive = layerKeyOf ? layer[layerKeyOf] : false;
    const interactive = !!key.mod || (!key.fixed);

    const st: CSSProperties = {
      position: 'relative',
      width: grid ? '100%' : width, height: grid ? '100%' : KEY_H, flex: grid ? undefined : '0 0 auto',
      gridColumn: grid ? `${key.col} / span ${key.colSpan ?? 1}` : undefined,
      gridRow: grid ? `${key.row} / span ${key.rowSpan ?? 1}` : undefined,
      borderRadius: 10, boxSizing: 'border-box', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '2px 4px', textAlign: 'center', userSelect: 'none', fontFamily: font.family,
      cursor: interactive ? cursors.clickable : cursors.default,
      border: isAlias ? `1.5px dashed ${inkTint(0.35)}` : `1.5px solid ${inkTint(0.18)}`,
      // INK, not the active yellow the rest of the window marks a choice in: two of the ten
      // category tints ARE that yellow, so a ring in it disappears on exactly the keys a visitor
      // reaches for most (every tool and every brush).
      boxShadow: isSelected ? `0 0 0 3px ${skin.ink}` : undefined,
      zIndex: isSelected ? 2 : undefined,
    };

    // The fill is ANIMATED rather than set in `style`, so switching modifier layer eases the tint in
    // place instead of snapping. An engaged modifier layer wins it, so Shift reads the same as
    // Ctrl/Alt; otherwise a fixed key is muted and a bound key takes its category tint.
    const bg = modActive
      ? skin.active
      : key.fixed ? inkTint(0.07)
        : cmd ? CATEGORY_COLOR[cmd.category] : skin.plate;

    const onClick = (): void => {
      if (key.mod) { toggleMod(key.mod); return; }
      if (key.fixed) return;
      if (cmd) pick(cmd.id);
    };

    return (
      <motion.div
        key={`${ri}-${ki}`}
        style={st}
        onClick={onClick}
        title={cmd ? t(cmd.labelKey) : undefined}
        animate={{ backgroundColor: bg }}
        whileHover={interactive ? { y: -2 } : undefined}
        whileTap={interactive ? { scale: 0.93 } : undefined}
        transition={{ default: springs.stiff, backgroundColor: { duration: 0.18, ease: 'easeOut' } }}
      >
        {/* The engraved glyph never changes with the layer, so it stays put and is not animated. */}
        <span style={{ position: 'absolute', top: 4, left: 6, ...roleFont('small'), color: inkTint(key.fixed ? 0.55 : 0.5) }}>
          {key.label}
        </span>
        {/* Only the COMMAND label differs per layer, so it cross-fades inside a fixed box: the
            outgoing and incoming labels are both absolute, hence they overlap and dissolve into each
            other in place. */}
        <div style={{ position: 'absolute', left: 3, right: 3, top: 19, bottom: 2 }}>
          <AnimatePresence initial={false}>
            {cmd && (
              <motion.span
                key={cmd.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {/* clamped INSIDE the centred fader, so a long label still ellipsizes at two lines */}
                <span style={{
                  ...roleFont('caption'), lineHeight: 1.12, color: skin.ink, textAlign: 'center',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden', wordBreak: 'break-word',
                }}>
                  {t(cmd.labelKey)}
                </span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    );
  };

  const board = (rows: KeyDef[][]) => (
    <motion.div variants={CLUSTER_IN} style={{ display: 'flex', flexDirection: 'column', gap: GAP, alignItems: 'flex-start' }}>
      {rows.map((row, ri) => (
        <motion.div key={ri} variants={rowIn} style={{ display: 'flex', gap: GAP }}>
          {row.map((k, ki) => renderKey(k, ri, ki))}
        </motion.div>
      ))}
    </motion.div>
  );

  // The nav + numpad clusters settle as ONE unit each — staggering their individual keys as well
  // would turn a short cascade into a shimmer.
  const gridBoard = (keys: KeyDef[], cols: number, rows: number, tag: number, topOffset = 0) => (
    <motion.div variants={rowIn} style={{
      display: 'grid', gap: GAP, marginTop: topOffset,
      gridTemplateColumns: `repeat(${cols}, ${UNIT}px)`,
      gridTemplateRows: `repeat(${rows}, ${KEY_H}px)`,
    }}>
      {keys.map((k, i) => renderKey(k, tag, i))}
    </motion.div>
  );

  /* ── detail strip ───────────────────────────────────────────────────────── */
  const selCombo = selectedId ? effectiveCombo(overrides, selectedId) : null;
  const detail = (() => {
    if (!selected) return <span style={{ ...roleFont('body'), color: skin.muted, fontFamily: font.family }}>{t('kbd.hint')}</span>;
    const clearOff = !selCombo;
    const resetOff = effectiveCombo({}, selected.id) === selCombo;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ width: 13, height: 13, borderRadius: 4, background: CATEGORY_COLOR[selected.category], flex: '0 0 auto' }} />
        <span style={{ ...roleFont('head'), color: skin.ink, fontFamily: font.family }}>{t(selected.labelKey)}</span>
        <span style={recording ? { ...comboChip, background: skin.active, color: skin.ink } : comboChip}>
          {recording ? t('kbd.recording') : selCombo ? prettyCombo(selCombo) : t('kbd.unbound')}
        </span>
        <motion.button {...buttonMotion} style={pill('primary')} onClick={() => { setNote(null); setRecording(true); }}>{t('kbd.record')}</motion.button>
        <motion.button {...(clearOff ? {} : buttonMotion)} style={pill('quiet', clearOff, 'inset')} disabled={clearOff} onClick={() => { clear(selected.id); setNote(null); }}>{t('kbd.clear')}</motion.button>
        <motion.button
          {...(resetOff ? {} : buttonMotion)}
          style={pill('quiet', resetOff, 'inset')} disabled={resetOff}
          onClick={() => { if (selected.defaultCombo) rebind(selected.id, selected.defaultCombo); else clear(selected.id); setNote(null); }}
        >{t('kbd.reset')}</motion.button>
        {note && <span style={{ ...roleFont('caption'), color: skin.muted, fontFamily: font.family }}>{note}</span>}
      </div>
    );
  })();

  /* ── render ─────────────────────────────────────────────────────────────── */
  // EXACT keyboard width, so the card padding stays symmetric. A flex row renders to
  // units*UNIT + (units-1)*GAP regardless of how many keys make up those units, so summing WIDTHS
  // (not counting keys) is what matches the DOM; the widest main row sets the board.
  const clusterW = (units: number): number => units * UNIT + (units - 1) * GAP;
  const boardUnits = Math.max(...KEY_ROWS.map((r) => r.reduce((s, k) => s + (k.w ?? 1), 0)));
  const keyboardW = clusterW(boardUnits) + BOARD_GAP * 2 + clusterW(NAV_COLS) + clusterW(NUMPAD_COLS);
  // Card must fit the board + card padding (48) + the vertical region's both-edges gutter (24, always
  // reserved) + the board row's ring padding (12) + a small buffer, else the horizontal bar shows even
  // when the board fits. 96vw still caps it, so a narrow viewport / high zoom scrolls instead.
  const width = keyboardW + 48 + 24 + 12 + 8;
  // Height of the tallest cluster (all three are KEY_ROWS.length rows tall) — the x-scroll box is
  // fixed to this + a strip for the horizontal bar, so the bar never shifts the legend below it.
  const keyboardH = KEY_ROWS.length * KEY_H + (KEY_ROWS.length - 1) * GAP;

  return (
    <ModalShell open={open} onClose={onClose} width={width} maxVwPct={96} maxVh={92} cardStyle={cardStyle} ariaLabel={t('modal.keyboard_title')}>
      <div style={titleStyle}>{t('modal.keyboard_title')}</div>

      {/* search (left) + reset-all (right), the same two ends the modifier row below hangs its own
          controls from. The field is a READING width rather than the board's: a search box a metre
          wide is a metre of empty paper, and its results list would inherit that span. */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: '0 1 460px' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('kbd.search')}
            style={{
              width: '100%', boxSizing: 'border-box', fontFamily: font.family, ...roleFont('field'),
              padding: '10px 16px', borderRadius: radii.pill, border: `1.5px solid ${skin.line}`,
              background: skin.inset, color: skin.ink, outline: 'none',
            }}
          />
          <AnimatePresence>
            {searchHits.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4 }}
                transition={springs.stiff}
                style={{ ...menuStyle, left: 0, right: 0, minWidth: undefined, zIndex: 5 }}
              >
                {searchHits.map((c) => {
                  const combo = effectiveCombo(overrides, c.id);
                  return (
                    <motion.button
                      key={c.id}
                      onClick={() => { pick(c.id); setSearch(''); }}
                      whileHover={{ backgroundColor: windowMenuItemHover(false) }}
                      whileTap={{ scale: 0.97 }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: 'none', background: windowMenuItem(false).background, borderRadius: radii.md, padding: '9px 14px', cursor: cursors.clickable }}
                    >
                      <span style={{ width: 11, height: 11, borderRadius: 3, background: CATEGORY_COLOR[c.category], flex: '0 0 auto' }} />
                      <span style={{ flex: '1 1 auto', textAlign: 'left', ...roleFont('label'), color: skin.ink, fontFamily: font.family }}>{t(c.labelKey)}</span>
                      <span style={{ ...roleFont('caption'), color: skin.muted, fontFamily: font.family }}>{combo ? prettyCombo(combo) : t('kbd.unbound')}</span>
                    </motion.button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div style={{ flex: '1 1 auto' }} />
        <motion.button {...buttonMotion} style={pill('danger')} onClick={() => { resetAll(); setNote(null); }}>{t('kbd.reset_all')}</motion.button>
      </div>

      {/* modifier-layer chips (left) + shortcut-style preset picker & JSON import/export (right) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexShrink: 0, alignItems: 'center' }}>
        <motion.button {...buttonMotion} style={chip(!layer.ctrl && !layer.alt && !layer.shift)} onClick={() => setLayer(BASE_LAYER)}>{t('kbd.layer.base')}</motion.button>
        <motion.button {...buttonMotion} style={chip(layer.shift)} onClick={() => toggleMod('shift')}>Shift</motion.button>
        <motion.button {...buttonMotion} style={chip(layer.ctrl)} onClick={() => toggleMod('ctrl')}>Ctrl</motion.button>
        <motion.button {...buttonMotion} style={chip(layer.alt)} onClick={() => toggleMod('alt')}>Alt</motion.button>

        <div style={{ flex: '1 1 auto' }} />

        <div ref={presetRef} style={{ position: 'relative' }}>
          <motion.button {...buttonMotion} onClick={() => setPresetOpen((o) => !o)} style={{ ...pill('quiet'), display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span style={{ color: skin.muted }}>{t('kbd.preset')}</span>
            {activePreset === 'custom' ? t('kbd.preset.custom') : t(PRESETS.find((p) => p.id === activePreset)!.labelKey)}
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden style={{ transition: 'transform 0.18s ease', transform: presetOpen ? 'rotate(180deg)' : 'none' }}>
              <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke={skin.ink} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
          <AnimatePresence>
            {presetOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4 }} transition={springs.stiff}
                style={menuStyle}
              >
                {PRESETS.map((p) => (
                  <motion.button
                    key={p.id}
                    onClick={() => { applyBinds(p.binds); setSelectedId(null); setPresetOpen(false); }}
                    whileHover={{ backgroundColor: windowMenuItemHover(activePreset === p.id) }}
                    whileTap={{ scale: 0.97 }}
                    style={menuItem(activePreset === p.id)}
                  >
                    {t(p.labelKey)}
                    {activePreset === p.id && <span style={{ fontSize: TEXT_ROLES.caption.px }}>✓</span>}
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <motion.button {...buttonMotion} style={pill('quiet')} onClick={() => fileRef.current?.click()}>{t('kbd.import')}</motion.button>
        <motion.button {...buttonMotion} style={pill('quiet')} onClick={onExport}>{t('kbd.export')}</motion.button>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImportFile} style={{ display: 'none' }} />
      </div>

      {/* ONLY the keyboard scrolls (header above + footer below stay pinned). One region scrolls both
          axes; its height = board + 6px top room (hover lift + selection ring) + 14px bottom strip so
          the horizontal bar has room without spuriously triggering the vertical one. It shrinks under
          height pressure (high UI zoom) and scrolls; the fade says "more", and the drawn bar below
          the region is the grabbable handle for the horizontal axis. */}
      <div ref={kbdRef} id="kbd-region" data-testid="kbd-region" className="pw-noscroll" onScroll={measureHbar} style={{ ...kbdRegion, height: keyboardH + 20, ...kbdFade }}>
        {/* Must NOT be keyed by the active layer: keying it remounts every keycap on each
            Ctrl/Shift/Alt press, which replays the entrance instead of switching layer. The container
            stays stable and each key cross-fades its own label + eases its own tint. `initial/animate`
            are fixed labels, so the entrance cascade runs once per open, never on a layer switch. */}
        <motion.div
          variants={BOARD_IN}
          initial="hidden"
          animate="show"
          style={{ display: 'flex', gap: BOARD_GAP, alignItems: 'flex-start', width: 'max-content', flex: '0 0 auto', padding: '6px 6px 0' }}
        >
          {board(KEY_ROWS)}
          {gridBoard(NAV, NAV_COLS, NAV_ROWS_N, 98)}
          {/* numpad's NumLk row starts at the number-row level (one row down) so its bottom aligns */}
          {gridBoard(NUMPAD, NUMPAD_COLS, NUMPAD_ROWS_N, 99, KEY_H + GAP)}
        </motion.div>
      </div>

      {hbar.cw > hbar.vw + 1 && (
        <BoardHBar
          left={hbar.left}
          vw={hbar.vw}
          cw={hbar.cw}
          label={t('kbd.scrollbar')}
          onScrollTo={(l, glide) => kbdRef.current?.scrollTo({ left: l, behavior: glide && !reduced ? 'smooth' : 'auto' })}
        />
      )}

      {/* detail strip — the hint when nothing is selected, else the selected command's
          record / clear / reset controls. Pinned (always visible) below the scrolling board. */}
      <div style={{ ...windowInset, marginTop: 16, flexShrink: 0, minHeight: 44, display: 'flex', alignItems: 'center', padding: '11px 16px' }}>
        <motion.div key={selectedId ?? 'hint'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }} style={{ width: '100%' }}>
          {detail}
        </motion.div>
      </div>

      {/* category legend — pinned (always visible) at the bottom */}
      <div style={{ marginTop: 14, flexShrink: 0, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {CATEGORY_ORDER.map((cat) => (
          <span key={cat} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...roleFont('caption'), color: skin.muted, fontFamily: font.family }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: CATEGORY_COLOR[cat] }} />
            {t(`kbd.cat.${cat}`)}
          </span>
        ))}
      </div>
    </ModalShell>
  );
}
