import { framerMotion } from '../../../design/motion';
import { font, radii } from '../../../design/styles';
import { useChromeScale } from '../../../design/scale';
import { toolbarLabel } from '../../../../state/keymap/toolbar';
import { useToolbarContext } from '../../../session/use-toolbar-context';
/*
 * The keyboard window: the board tinted by command category at the engaged modifier layer, a search
 * over every command, and Record (taking the chord from its holder), Clear and Reset for the chosen one,
 * all read from the command registry and the override store.
 */
import { SUPPORTS_JSON_FILES } from '../../../../platform/build/edition';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../../i18n/context';
import { skin, windowInset } from '../../../design/window-skin';
import { Pill } from '../../../primitives/Pill';
import { roleFont } from '../../../design/text-weight';
import { ModalShell } from '../../../primitives/ModalShell';
import { KEYBOARD_H, KEYBOARD_W, KeyboardBoard } from './KeyboardBoard';
import { WindowHeader, windowFrame } from '../../../primitives/Window';
import { FloatMenu } from '../../../primitives/FloatMenu';
import { ChevronIcon } from '../../../primitives/line-glyphs';
import { useTransition } from '../../../design/motion/use-motion';
import { useWindow, type WindowProps } from '../use-window';
import { useScrollFadeBoth } from '../../../primitives/scroll-fade';
import { useWheelToHorizontal } from '../../../primitives/wheel-horizontal';
import { showToast } from '../../floating/Toast';
import { downloadKeymap, readKeymapFile } from '../../../../editor/export/files';
import { COMMANDS, COMMAND_BY_ID, type EditorCommand } from '../../../../editor/commands/commands';
import { aliasIndex, bindingIndex, effectiveCombo, detectPreset } from '../../../../state/keymap/resolve';
import { useKeybinds } from '../../../../state/keymap/store';
import { comboFromEvent, prettyCombo } from '../../../../platform/input/combo';
import { PRESETS } from '../../../../state/keymap/registry';
import { CATEGORY_COLOR, CATEGORY_ORDER, type Layer } from './layout';
import { useObservedSize } from '../../../primitives/use-observed-size';
import { boardZoomFor, BoardHBar } from './BoardHBar';

// Keycap metrics. Sized so the labels stay legible after the chrome zoom shrinks the card on a short
// viewport, and so keycap type sits in the same range as the rest of the chrome (the board simply gets
// wider; the 96vw cap + horizontal scroll already handle that).
const BASE_LAYER: Layer = { ctrl: false, alt: false, shift: false };

/* ── small styled atoms ──────────────────────────────────────────────────── */

// Border-box, so the shell's viewport caps bound the whole card and a phone keeps its backdrop rim.
const cardStyle: CSSProperties = { ...windowFrame, overflow: 'hidden', boxSizing: 'border-box' };
// Only the board scrolls, on both axes in one container so each bar stays at the visible edge; safe
// centring holds the board in the middle while it fits. Its two-axis fade replaces the platform bars
// (`pw-noscroll`), and the drawn bar below it is the horizontal handle.
const kbdRegion: CSSProperties = {
  display: 'flex', justifyContent: 'safe center', alignItems: 'flex-start',
  flex: '0 1 auto', minHeight: 0, overflowX: 'auto', overflowY: 'auto',
};


// This page's pills are a step roomier than Settings'; the active yellow marks the action that takes
// the next keypress.
const pillPad: CSSProperties = { padding: '8px 16px' };

// Layer chips read as a filled segmented control: the engaged layer is the dark ink pill.
function chip(active: boolean): CSSProperties {
  return { padding: '6px 16px', ...(active ? { background: skin.ink, color: skin.plate } : {}) };
}

const comboChip: CSSProperties = {
  fontFamily: font.family, ...roleFont('chip'), color: skin.plate,
  background: skin.ink, padding: '4px 12px', borderRadius: radii.chip, whiteSpace: 'nowrap',
};

/** The preset menu's width, in css px: the longest preset name with its check. */
const PRESET_MENU_W = 196;

/* ── entrance ─────────────────────────────────────────────────────────────────
 * A grid this dense reads heavy if it simply scales up with the card, so the board assembles itself
 * just after the card lands: the three clusters are staggered, and within the main block each row
 * settles, so the eye follows it coming together instead of being handed all ~100 keys at once.
 * One short cascade (~0.3s total), spring physics, and no movement at all under reduced motion.
 */
/* ── component ────────────────────────────────────────────────────────────── */

// Card must fit the board + card padding (48) + the vertical region's both-edges gutter (24, always
// reserved) + the board row's ring padding (12) + a small buffer, else the horizontal bar shows even
// when the board fits. The viewport caps leave a rim of backdrop on every side; inside them the board
// zooms down to its floor before it scrolls.
const CARD_WIDTH = KEYBOARD_W + 48 + 24 + 12 + 8;

export function KeyboardModal(props: WindowProps) {
  const t = useT();
  const { open, close } = useWindow('keyboard', props);
  return (
    <ModalShell helpTarget={{ page: 'shortcuts' }} open={open} onClose={close} size="board" width={CARD_WIDTH} cardStyle={cardStyle} ariaLabel={t('modal.keyboard_title')}>
      <KeyboardBody onClose={close} />
    </ModalShell>
  );
}

function KeyboardBody({ onClose }: { onClose: () => void }) {
  const t = useT();
  const toolbar = useToolbarContext();
  const overrides = useKeybinds((s) => s.overrides);
  const rebind = useKeybinds((s) => s.rebind);
  const clear = useKeybinds((s) => s.clear);
  const restoreDefault = useKeybinds((s) => s.restoreDefault);
  const resetAll = useKeybinds((s) => s.resetAll);
  const applyBinds = useKeybinds((s) => s.applyBinds);

  const [layer, setLayer] = useState<Layer>(BASE_LAYER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const reduced = useReducedMotionConfig();
  const [presetOpen, setPresetOpen] = useState(false);
  const presetRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const turn = useTransition('surface.arrive');
  const fileRef = useRef<HTMLInputElement>(null);
  const kbdRef = useRef<HTMLDivElement>(null);
  const kbdFade = useScrollFadeBoth(kbdRef);
  // When the window is short enough that only sideways travel remains, a mouse's vertical
  // notches drive it; with vertical room the hook stands aside and the wheel scrolls as usual.
  useWheelToHorizontal(kbdRef, { zoom: useChromeScale() });

  // The board region's live scroll geometry, feeding the drawn horizontal bar below it and the
  // board's own zoom.
  const [hbar, setHbar] = useState({ left: 0, vw: 0, cw: 0 });
  const [boardZoom, setBoardZoom] = useState(1);
  const measureHbar = useCallback(() => {
    const el = kbdRef.current;
    if (!el) return;
    // Room for the region at the card's height cap: the cap less every other row, which the card's
    // scroll height carries whether or not the cap is binding yet.
    const card = el.parentElement;
    const cap = card ? parseFloat(getComputedStyle(card).maxHeight) : NaN;
    const roomH = card && Number.isFinite(cap) ? cap - (card.scrollHeight - el.offsetHeight) - 20 : Infinity;
    setBoardZoom(boardZoomFor(el.clientWidth, KEYBOARD_W + 12, roomH, KEYBOARD_H));
    setHbar((p) => (p.left === el.scrollLeft && p.vw === el.clientWidth && p.cw === el.scrollWidth)
      ? p
      : { left: el.scrollLeft, vw: el.clientWidth, cw: el.scrollWidth });
  }, []);
  useObservedSize(() => kbdRef.current, measureHbar, [measureHbar], { layout: false });

  const activePreset = useMemo(() => detectPreset(overrides), [overrides]);

  const onExport = (): void => downloadKeymap(overrides);
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    const res = await readKeymapFile(file);
    if (res.ok && res.binds) { applyBinds(res.binds, res.overrides); setSelectedId(null); showToast(t('kbd.imported'), 'info'); }
    else showToast(t('kbd.import_failed'), 'error');
  };

  const index = useMemo(() => bindingIndex(overrides, toolbar), [overrides, toolbar]);
  const aliases = useMemo(() => aliasIndex(), []);
  const selected = selectedId ? COMMAND_BY_ID.get(selectedId) : undefined;
  const label = useCallback((id: string): string => {
    const c = COMMAND_BY_ID.get(id);
    return c ? t(toolbarLabel(toolbar, id) ?? c.labelKey) : id;
  }, [t, toolbar]);

  // Chord capture while recording. Capture phase + preventDefault so the chord never fires a command.
  const setRecordingFlag = useKeybinds((s) => s.setRecording);
  useEffect(() => {
    if (!recording || !selectedId) return undefined;
    setRecordingFlag(true);
    return () => setRecordingFlag(false);
  }, [recording, selectedId, setRecordingFlag]);
  useEffect(() => {
    if (!recording || !selectedId) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setRecording(false); return; }
      const combo = comboFromEvent(e);
      if (!combo) return; // bare modifier / space — keep listening
      const r = rebind(selectedId, combo, toolbar);
      // The one refusal a recorded chord can hit: a shifted twin of a live UI-scale binding, which
      // the UI-scale listener answers on the same keycap.
      if (!r.ok) setNote(t('kbd.reserved'));
      else setNote(r.displaced ? t('kbd.reassigned_from', { action: label(r.displaced) }) : null);
      setRecording(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, selectedId, rebind, t, toolbar, label]);

  const pick = (id: string): void => { setSelectedId(id); setRecording(false); setNote(null); };
  const toggleMod = (mod: 'ctrl' | 'alt' | 'shift'): void => setLayer((l) => ({ ...l, [mod]: !l[mod] }));

  const searchHits: EditorCommand[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return COMMANDS.filter((c) => (t(toolbarLabel(toolbar, c.id) ?? c.labelKey)).toLowerCase().includes(q)).slice(0, 7);
  }, [search, t, toolbar]);

  /* ── detail strip ───────────────────────────────────────────────────────── */
  const selCombo = selectedId ? effectiveCombo(overrides, selectedId, toolbar) : null;
  const detail = (() => {
    if (!selected) return <span style={{ ...roleFont('body'), color: skin.muted, fontFamily: font.family }}>{t('kbd.hint')}</span>;
    const clearOff = !selCombo;
    const resetOff = effectiveCombo({}, selected.id, toolbar) === selCombo;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ width: 13, height: 13, borderRadius: radii.sm, background: CATEGORY_COLOR[selected.category], flex: '0 0 auto' }} />
        <span style={{ ...roleFont('head'), color: skin.ink, fontFamily: font.family }}>{label(selected.id)}</span>
        <span style={recording ? { ...comboChip, background: skin.active, color: skin.ink } : comboChip}>
          {recording ? t('kbd.recording') : selCombo ? prettyCombo(selCombo) : t('kbd.unbound')}
        </span>
        <Pill variant="active" style={pillPad} onClick={() => { setNote(null); setRecording(true); }}>{t('kbd.record')}</Pill>
        <Pill on="inset" style={pillPad} disabled={clearOff} onClick={() => { clear(selected.id); setNote(null); }}>{t('kbd.clear')}</Pill>
        <Pill on="inset" style={pillPad} disabled={resetOff}
          onClick={() => { restoreDefault(selected.id, toolbar); setNote(null); }}
        >{t('kbd.reset')}</Pill>
        {note && <span style={{ ...roleFont('caption'), color: skin.muted, fontFamily: font.family }}>{note}</span>}
      </div>
    );
  })();

  return (
    <>
      <WindowHeader title={t('modal.keyboard_title')} close={{ label: t('hint.close'), onPress: onClose }} reserve style={{ marginBottom: 16, flexShrink: 0 }} />

      {/* search (left) + reset-all (right), the same two ends the modifier row below hangs its own
          controls from. The field is a reading width rather than the board's: a search box a metre
          wide is a metre of empty paper, and its results list would inherit that span. */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
        <div ref={searchRef} style={{ flex: '0 1 460px' }}>
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
          <FloatMenu
            row={null}
            anchor={searchRef}
            keepFocus
            open={searchHits.length > 0}
            onOpen={() => {}}
            onClose={() => setSearch('')}
            onPick={(id) => { pick(id); setSearch(''); }}
            items={searchHits.map((c) => {
              const combo = effectiveCombo(overrides, c.id, toolbar);
              return {
                id: c.id,
                label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><span style={{ width: 11, height: 11, borderRadius: radii.sm, background: CATEGORY_COLOR[c.category], flex: '0 0 auto' }} />{label(c.id)}</span>,
                sub: combo ? prettyCombo(combo) : t('kbd.unbound'),
              };
            })}
            aria-label={t('kbd.search')}
          />
        </div>
        <div style={{ flex: '1 1 auto' }} />
        <Pill variant="danger" style={pillPad} onClick={() => { resetAll(); setNote(null); }}>{t('kbd.reset_all')}</Pill>
      </div>

      {/* modifier-layer chips (left) + shortcut-style preset picker & JSON import/export (right) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexShrink: 0, alignItems: 'center' }}>
        <Pill style={chip(!layer.ctrl && !layer.alt && !layer.shift)} onClick={() => setLayer(BASE_LAYER)}>{t('kbd.layer.base')}</Pill>
        <Pill style={chip(layer.shift)} onClick={() => toggleMod('shift')}>Shift</Pill>
        <Pill style={chip(layer.ctrl)} onClick={() => toggleMod('ctrl')}>Ctrl</Pill>
        <Pill style={chip(layer.alt)} onClick={() => toggleMod('alt')}>Alt</Pill>

        <div style={{ flex: '1 1 auto' }} />

        <Pill ref={presetRef} aria-haspopup="menu" aria-expanded={presetOpen} onClick={() => setPresetOpen((o) => !o)} style={pillPad}>
          <span style={{ color: skin.muted }}>{t('kbd.preset')}</span>
          {activePreset === 'custom' ? t('kbd.preset.custom') : t(PRESETS.find((p) => p.id === activePreset)!.labelKey)}
          <motion.span aria-hidden animate={{ rotate: presetOpen ? 180 : 0 }} transition={turn} style={{ display: 'flex' }}><ChevronIcon size={10} /></motion.span>
        </Pill>
        <FloatMenu
          row={null}
          anchor={presetRef}
          width={PRESET_MENU_W}
          open={presetOpen}
          onOpen={() => setPresetOpen(true)}
          onClose={() => setPresetOpen(false)}
          activeId={activePreset}
          onPick={(id) => { const preset = PRESETS.find((p) => p.id === id); if (preset) { applyBinds(preset.binds); setSelectedId(null); } }}
          items={PRESETS.map((p) => ({ id: p.id, label: t(p.labelKey) }))}
          aria-label={t('kbd.preset')}
        />

        {SUPPORTS_JSON_FILES && <>
          <Pill style={pillPad} onClick={() => fileRef.current?.click()}>{t('kbd.import')}</Pill>
          <Pill style={pillPad} onClick={onExport}>{t('kbd.export')}</Pill>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImportFile} style={{ display: 'none' }} />
        </>}
      </div>

      {/* Only the keyboard scrolls (header above + footer below stay pinned). One region scrolls both
          axes; its height = board + 6px top room (hover lift + selection ring) + 14px bottom strip so
          the horizontal bar has room without spuriously triggering the vertical one. It shrinks under
          height pressure (high UI zoom) and scrolls; the fade says "more", and the drawn bar below
          the region is the grabbable handle for the horizontal axis. */}
      <div ref={kbdRef} id="kbd-region" data-testid="kbd-region" className="pw-noscroll" onScroll={measureHbar} style={{ ...kbdRegion, height: KEYBOARD_H * boardZoom + 20, ...kbdFade }}>
        {/* Must not be keyed by the active layer: keying it remounts every keycap on each
            Ctrl/Shift/Alt press, which replays the entrance instead of switching layer. The container
            stays stable and each key cross-fades its own label + eases its own tint. `initial/animate`
            are fixed labels, so the entrance cascade runs once per open, never on a layer switch. */}
        <KeyboardBoard layer={layer} index={index} aliases={aliases} selectedId={selectedId} label={label} zoom={boardZoom}
          onPick={pick} onToggleMod={toggleMod} />
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
      <div style={{ ...windowInset, marginTop: 16, flexShrink: 0, minHeight: 44, display: 'flex', alignItems: 'center', padding: '10px 16px' }}>
        <motion.div key={selectedId ?? 'hint'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={framerMotion('control.detail')} style={{ width: '100%' }}>
          {detail}
        </motion.div>
      </div>

      {/* category legend — pinned (always visible) at the bottom */}
      <div style={{ marginTop: 14, flexShrink: 0, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {CATEGORY_ORDER.map((cat) => (
          <span key={cat} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...roleFont('caption'), color: skin.muted, fontFamily: font.family }}>
            <span style={{ width: 12, height: 12, borderRadius: radii.sm, background: CATEGORY_COLOR[cat] }} />
            {t(`kbd.cat.${cat}`)}
          </span>
        ))}
      </div>
    </>
  );
}
