/*
 * SetupScreen — the connect / configure screen (prototype .connect, spec §UI.5),
 * replacing the panel body below the header row. Screens:
 *
 *   idle       pass card "Not connected" + key badgefield (accent connect slot
 *              → ps.saveKey) + the 9-provider roster grid (pop-in, hover lift);
 *   detecting  spinner pass + spinner slot (tap = ps.skipDetection);
 *   pick       "Pick one" chooser grid for ambiguous keys (ps.commitKey);
 *   valid      "Connected" pass + masked key + green check, then the config
 *              reveal: endpoint (locked for known platforms / editable for
 *              Custom), model dropdown, Oversight 3-segment control, and the
 *              full-width accent "Start building" exit;
 *   incident   friendly error cards (invalid key 401 / rate limited) rendered
 *              INSTEAD of the connect content while `notice` is set.
 *
 * Reuses useProviderSettings UNCHANGED (ps owns keyDraft/detecting/chooser/
 * saveKey/commitKey/skipDetection); provider/key/model/oversight live in the
 * agent store. The key-help "?" disclosure (agent.key_help) is a small round
 * button beside the key field. No internal scrolling — everything
 * fits the locked height. Geometry = prototype css px × 2 through usePx().
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { colors as C, inkTint, font, springs, exitTransition, cursors } from '../../styles';
import { usePx } from '../scale';
import { useInstantLayout } from '../layout-settle';
import { squircleClip } from '../squircle';
import { FitText } from '../FitText';
import { useAgentStore } from '../../../agent/store';
import { PROVIDER_ACCENT, PROVIDER_IDS } from '../../../agent/providers/defaults';
import { baseUrlFor } from '../../../agent/providers';
import { Spinner } from '../../Spinner';
import { ProviderLogo } from './logos';
import { prettyModel, GoArrowIcon, CheckIcon, CaretDownIcon, FIELD_DEEP, HoverTip, OK_GREEN, REVERT_AMBER, CARD_LINE, pulseProps } from './atoms';
import { ModelDropdown } from './ModelDropdown';
import { ClickCatcher } from '../../chrome/ClickCatcher';
import type { ProviderSettings } from './useProviderSettings';
import type { ProviderId } from '../../../agent/types';
import type { Oversight } from '../../../agent/key-storage';

/** Roster geometry: the designed card is an 80px badge inside 42px of padding, three to a row. */
const ROSTER_ROW_H = 164;
const ROSTER_GAP = 16;
const ROSTER_ROWS = Math.ceil(PROVIDER_IDS.length / 3);

/** Where to get a key for each platform — the roster links OUT to these (the
 *  auto-detector owns platform selection; the cards are shortcuts to a key). */
const PLATFORM_URLS: Partial<Record<ProviderId, string>> = {
  claude: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  gemini: 'https://aistudio.google.com/app/apikey',
  openrouter: 'https://openrouter.ai/keys',
  zhipu: 'https://open.bigmodel.cn/usercenter/apikeys',
  qwen: 'https://bailian.console.aliyun.com/',
  moonshot: 'https://platform.moonshot.cn/console/api-keys',
};

/** Live masked display that still shows the last 4 characters. The dot run
 *  scales with the real length so an edit to the display maps back exactly.
 *  Under 5 chars there's nothing to hide (the tail reveals itself as you type
 *  past the 4th character). */
const maskLive = (k: string) => (k.length > 4 ? '•'.repeat(k.length - 4) + k.slice(-4) : k);

/** Reconstruct the REAL key after the user edits the masked display. Leading
 *  dots still stand for the old real prefix (edits land on the visible tail);
 *  everything from the first non-dot onward is the user's real input. A stray
 *  dot is dropped — a real key never contains one — so an edit inside the masked
 *  region can never corrupt the value with bullet characters. */
const applyMaskEdit = (oldReal: string, displayed: string) => {
  let lead = 0;
  while (displayed[lead] === '•') lead++;
  return (oldReal.slice(0, lead) + displayed.slice(lead)).replace(/•/g, '');
};

/** THE one key field, shared by every connect state (idle/detecting/pick/valid)
 *  so they behave identically. It shows the key through the live partial mask
 *  (maskLive) and rebuilds the real value from edits (applyMaskEdit), and keeps
 *  the tail scrolled into view so the last 4 characters stay visible even when a
 *  long key overflows the input. Read-only when no onChange is passed. */
function KeyField({ value, onChange, onEnter, style, readOnly }: {
  value: string;
  onChange?: (real: string) => void;
  onEnter?: () => void;
  style: React.CSSProperties;
  readOnly?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const shown = maskLive(value);
  useLayoutEffect(() => {
    // Always show the tail (the last characters), never the start: a controlled-
    // value update resets scrollLeft to 0, which would show the first characters
    // of a long key. Snapping to the end after every value change keeps the last
    // 4 in view whether the field is focused (typing/pasting) or just displayed.
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [shown]);
  return (
    <input
      ref={ref}
      type="text"
      value={shown}
      readOnly={readOnly}
      onChange={onChange ? (e) => onChange(applyMaskEdit(value, e.target.value)) : undefined}
      onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }}
      placeholder={t('agent2.paste_key')}
      aria-label={t('agent.api_key')}
      className="pw-field-input"
      style={style}
    />
  );
}

const GUTTER_X = 172;
const GUTTER_W = 628;
const ERR_RED = '#D9534F'; // prototype --err (incident badges)

/** The endpoint row shows the URL the adapter calls, resolved for this key — including which
 *  deployment a region-split platform's key belongs to. These two SDKs carry their own default,
 *  so there is no base URL to read for them. */
const SDK_DEFAULT_BASE: Partial<Record<ProviderId, string>> = {
  claude: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
};

const OVERSIGHTS: { id: Oversight; labelKey: string; hintKey: string }[] = [
  { id: 'strict', labelKey: 'agent2.ov_strict', hintKey: 'agent2.ov_strict_hint' },
  { id: 'checkpoint', labelKey: 'agent2.ov_checkpoint', hintKey: 'agent2.ov_checkpoint_hint' },
  { id: 'yolo', labelKey: 'agent2.ov_yolo', hintKey: 'agent2.ov_yolo_hint' },
];

/* ── local glyphs the shared atoms don't carry (prototype paths) ── */

const svgBase = { viewBox: '0 0 24 24', 'aria-hidden': true as const, fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const };

function KeyGlyph({ size, color }: { size: number; color?: string }) {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={2} strokeLinejoin="round" style={{ display: 'block', color }}>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.85 12.15 20 3M18 5l2 2M16 7l1.5 1.5" />
    </svg>
  );
}

function LockGlyph({ size, color }: { size: number; color?: string }) {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={2} strokeLinejoin="round" style={{ display: 'block', color }}>
      <rect x="4" y="10.5" width="16" height="9.5" rx="2.2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

function PadlockGlyph({ size, color }: { size: number; color?: string }) {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={2.2} style={{ display: 'block', color }}>
      <path d="M12 15v2M7 10V8a5 5 0 0 1 10 0v2M5 10h14v10H5z" />
    </svg>
  );
}

function ClockGlyph({ size, color }: { size: number; color?: string }) {
  return (
    <svg {...svgBase} width={size} height={size} strokeWidth={2.2} style={{ display: 'block', color }}>
      <path d="M12 7v5l3 3M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />
    </svg>
  );
}

export interface SetupScreenProps {
  top: number;
  height: number;
  /** Provider / key / model handling from useProviderSettings (unchanged hook). */
  ps: ProviderSettings;
  notice: 'invalid_key' | 'rate_limited' | null;
  onClearNotice(): void;
  onStartBuilding(): void;
}

export function SetupScreen({ top, height, ps, notice, onClearNotice, onStartBuilding }: SetupScreenProps) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();
  const agent = useAgentStore();
  const provider = agent.settings.provider;
  const apiKey = agent.settings.keys[provider] ?? '';
  const model = agent.settings.model[provider] ?? '';
  // Only ever list models from a successful live fetch. No fallback/placeholder
  // list: a wrong key or bad config must show nothing (the custom-model input in
  // the dropdown still lets the user type one by hand).
  const models = agent.modelList[provider] ?? [];
  const accent = PROVIDER_ACCENT[provider];
  /** Localized platform name (company/brand), consistent across the UI. */
  const provName = (id: ProviderId) => t(`agent2.prov_${id}`);
  // Ready to build only with a real model AND a reachable endpoint. A Custom
  // provider with no base URL can't verify its (possibly typed) model, so block it.
  const canStart = !!model && !(provider === 'custom' && !agent.settings.customBaseUrl);
  const oversight = agent.settings.oversight;
  const [showKeyHelp, setShowKeyHelp] = useState(false);
  /** null = untouched (masked-with-last-4 shown); a string = replacement draft. */
  const [keyEdit, setKeyEdit] = useState<string | null>(null);
  const hairline = Math.max(1, px(2));

  /** Re-run auto-detection on the edited key (or re-validate the stored one). */
  const recheckKey = async () => {
    const k = keyEdit?.trim() || apiKey;
    if (!k) return;
    setKeyEdit(null);
    await ps.saveKey(false, k);
    void ps.refreshModels();
  };

  const connect: 'idle' | 'detecting' | 'pick' | 'valid' =
    ps.detecting ? 'detecting' : ps.chooserOpen ? 'pick' : apiKey ? 'valid' : 'idle';

  // Connect states slide like the setup <-> chat screens: advancing
  // (greeting -> detecting -> configured) enters from the right, going back
  // (key cleared) from the left. The first render is pre-centered so the
  // roster's own card entrances stay visible.
  const STATE_ORDER = { idle: 0, detecting: 1, pick: 2, valid: 3 } as const;
  const prevConnect = useRef(connect);
  const stateDir = STATE_ORDER[connect] >= STATE_ORDER[prevConnect.current] ? 1 : -1;
  useEffect(() => { prevConnect.current = connect; });
  const firstState = useRef(true);
  useEffect(() => { firstState.current = false; }, []);
  // Switching providers drops any in-progress key edit so the field reflects the new provider's key.
  useEffect(() => { setKeyEdit(null); }, [provider]);
  const stateSlide = {
    enter: (dir: number) => (reduced ? { opacity: 0 } : { x: dir * px(180), opacity: 0 }),
    center: { x: 0, opacity: 1, transition: reduced ? { duration: 0 } : springs.stiff },
    exit: (dir: number) => (reduced ? { opacity: 0, transition: { duration: 0 } } : { x: -dir * px(180), opacity: 0, transition: exitTransition }),
  };

  // Row titles match the system's label voice: bold sentence case, secondary
  // ink; no uppercase tracking.
  const kickerStyle: React.CSSProperties = {
    fontFamily: font.family, fontWeight: fw(800), fontSize: pxf(25), color: C.textSecondary,
  };
  const hintStyle: React.CSSProperties = {
    fontFamily: font.family, fontWeight: 700, fontSize: pxf(23), color: C.textSecondary, lineHeight: 1.4,
  };

  /* ── pass card — ONE persistent shell shared by every connect state; the
        status line and identity block crossfade in place (they never slide,
        the card itself never remounts) ── */
  const passCard = (
    status: { cls: 'idle' | 'detecting' | 'ready'; label: string },
    badge: ReactNode,
    name: string,
    sub: string,
    onClick?: () => void,
  ) => {
    const statusColor = status.cls === 'ready' ? OK_GREEN : status.cls === 'detecting' ? REVERT_AMBER : C.textSecondary;
    // A clickable card lifts on hover, the shared card idiom (cf. the roster /
    // platform-grid cards). The column reserves PAD of top room so this
    // top-most card's lift clears the overflow clip.
    return (
      <motion.div
        {...(onClick
          ? {
              onClick,
              onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } },
              role: 'button', tabIndex: 0, 'aria-label': t('agent2.key_unplaced'), title: t('agent2.key_unplaced'),
            }
          : {})}
        whileHover={onClick && !reduced ? { y: px(-4) } : undefined}
        whileTap={onClick && !reduced ? { scale: 0.99 } : undefined}
        transition={springs.stiff}
        style={{
          background: C.white, border: `${hairline}px solid ${CARD_LINE}`, borderRadius: px(36),
          padding: px(28), boxShadow: `0 ${px(8)}px ${px(20)}px ${inkTint(0.06)}`,
          display: 'flex', flexDirection: 'column', gap: px(26), boxSizing: 'border-box',
          cursor: onClick ? cursors.clickable : cursors.default,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: px(16) }}>
          <span style={kickerStyle}>{t('agent2.connection')}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: px(12), fontFamily: font.family, fontWeight: fw(800), fontSize: pxf(25), color: statusColor, whiteSpace: 'nowrap' }}>
            <motion.span
              {...pulseProps(status.cls === 'detecting' && !reduced)}
              style={{ width: px(18), height: px(18), borderRadius: '50%', background: 'currentColor', flexShrink: 0 }}
            />
            {status.label}
          </span>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={connect}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1, transition: springs.gentle }}
            exit={{ opacity: 0, transition: exitTransition }}
            style={{ display: 'flex', alignItems: 'center', gap: px(28) }}
          >
            {badge}
            <div style={{ display: 'flex', flexDirection: 'column', gap: px(6), minWidth: 0 }}>
              <b style={{ fontFamily: font.family, fontWeight: fw(800), fontSize: pxf(34), color: C.inkText }}>{name}</b>
              <span style={{ ...hintStyle, fontSize: pxf(27) }}>{sub}</span>
            </div>
          </motion.div>
        </AnimatePresence>
      </motion.div>
    );
  };

  const idleBadge = (
    <span style={{ width: px(120), height: px(120), borderRadius: px(36), background: C.surfaceSecondary, border: `${Math.max(2, px(4))}px dashed #ddceb0`, color: C.textSecondary, display: 'grid', placeItems: 'center', flexShrink: 0, boxSizing: 'border-box' }}>
      <KeyGlyph size={px(52)} />
    </span>
  );

  /* ── key badgefield (+ the surviving key-help "?" disclosure) ── */
  const helpBtn = (
    <motion.button
      type="button"
      onClick={() => setShowKeyHelp((v) => !v)}
      whileHover={reduced ? undefined : { scale: 1.1 }}
      whileTap={reduced ? undefined : { scale: 0.9 }}
      transition={springs.stiff}
      aria-label={t('agent.key_help')}
      style={{
        width: px(46), height: px(46), borderRadius: '50%', flexShrink: 0,
        background: showKeyHelp ? C.frameDark : FIELD_DEEP, color: showKeyHelp ? C.white : C.inkText,
        border: 'none', appearance: 'none', cursor: cursors.clickable, padding: 0,
        display: 'grid', placeItems: 'center',
        fontFamily: font.family, fontWeight: fw(900), fontSize: pxf(28), lineHeight: 1,
      }}
    >
      ?
    </motion.button>
  );

  const badgefield = (input: ReactNode, slot: ReactNode) => (
    <div style={{ position: 'relative' }}>
      <div className="pw-field-wrap" style={{ display: 'flex', alignItems: 'center', gap: px(16), background: C.surfaceSecondary, borderRadius: px(32), padding: `${px(14)}px ${px(14)}px ${px(14)}px ${px(28)}px`, boxSizing: 'border-box' }}>
        {input}
        {helpBtn}
        <AnimatePresence mode="wait" initial={false}>
          {slot && (
            <motion.span
              key={connect}
              initial={reduced ? false : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1, transition: springs.stiff }}
              exit={{ opacity: 0, transition: exitTransition }}
              style={{ display: 'flex', flexShrink: 0 }}
            >
              {slot}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {showKeyHelp && (
        <>
          <ClickCatcher onDismiss={() => setShowKeyHelp(false)} zIndex={28} />
          <motion.div
            initial={reduced ? false : { opacity: 0, y: px(-8) }}
            animate={{ opacity: 1, y: 0 }}
            transition={springs.stiff}
            onClick={() => setShowKeyHelp(false)}
            className="pw-noscroll"
            style={{
              position: 'absolute', left: 0, right: 0, top: `calc(100% + ${px(12)}px)`, zIndex: 30,
              maxHeight: px(640), overflowY: 'auto', background: C.frameDark, color: C.white,
              borderRadius: px(28), padding: `${px(24)}px ${px(30)}px`, fontFamily: font.family,
              fontWeight: 700, fontSize: pxf(29), lineHeight: 1.5, whiteSpace: 'pre-line',
              boxShadow: `0 ${px(6)}px ${px(18)}px ${inkTint(0.32)}`, cursor: cursors.clickable, boxSizing: 'border-box',
            }}
          >
            {t('agent.key_help')}
          </motion.div>
        </>
      )}
    </div>
  );

  const keyInputStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none',
    fontFamily: font.family, fontWeight: 700, fontSize: pxf(32), color: C.inkText,
  };

  /** Emptying the key field forgets the key and returns to the greeting page. */
  const clearKey = () => {
    setKeyEdit(null);
    ps.setKeyDraft('');
    agent.setKey(provider, '');
  };

  /** Per-state wiring around the shared KeyField. idle/pick edit the draft and
   *  re-detect on Enter; valid edits the stored key in place (clearing forgets
   *  it and returns to the greeting); detecting is read-only. */
  const keyInput = (mode: 'idle' | 'detecting' | 'pick' | 'valid') => {
    const style = { ...keyInputStyle, letterSpacing: '0.04em' };
    if (mode === 'detecting') {
      return <KeyField value={ps.keyDraft} readOnly style={{ ...style, color: C.textSecondary }} />;
    }
    if (mode === 'valid') {
      const real = keyEdit ?? apiKey;
      return (
        <KeyField
          value={real}
          onChange={(v) => (v === '' ? clearKey() : setKeyEdit(v))}
          onEnter={() => void recheckKey()}
          style={style}
        />
      );
    }
    // idle + pick: edit the draft, Enter re-runs detection
    return <KeyField value={ps.keyDraft} onChange={ps.setKeyDraft} onEnter={() => void ps.saveKey(false)} style={style} />;
  };

  /* ── incident cards (rendered INSTEAD of the connect content) ── */
  if (notice) {
    const stop = notice === 'invalid_key';
    return (
      <div
        style={{
          position: 'absolute', left: px(GUTTER_X), top: px(top), width: px(GUTTER_W), height: px(height),
          boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden', pointerEvents: 'auto',
        }}
      >
        <motion.div
          initial={reduced ? false : { opacity: 0, y: px(14) }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.bouncy}
          style={{
            margin: 'auto 0', background: C.white, borderRadius: px(40), padding: px(40),
            display: 'flex', flexDirection: 'column', gap: px(24), alignItems: 'center', textAlign: 'center',
            boxShadow: `0 ${px(12)}px ${px(36)}px ${inkTint(0.10)}`, border: `${hairline}px solid #f0e6d5`, boxSizing: 'border-box',
          }}
        >
          <span style={{ width: px(104), height: px(104), borderRadius: px(32), display: 'grid', placeItems: 'center', color: C.white, background: stop ? ERR_RED : REVERT_AMBER, flexShrink: 0 }}>
            {stop ? <PadlockGlyph size={px(56)} /> : <ClockGlyph size={px(56)} />}
          </span>
          <h3 style={{ margin: 0, fontFamily: font.family, fontWeight: fw(800), fontSize: pxf(36), color: C.inkText }}>
            {t(stop ? 'agent2.err_key_title' : 'agent2.err_rate_title')}
          </h3>
          <p style={{ margin: 0, fontFamily: font.family, fontWeight: 700, fontSize: pxf(29), color: C.textSecondary, lineHeight: 1.5, maxWidth: '30ch' }}>
            {t(stop ? 'agent2.err_key_body' : 'agent2.err_rate_body', { name: provName(provider) })}
          </p>
          <div style={{ display: 'flex', gap: px(16), flexWrap: 'wrap', justifyContent: 'center', marginTop: px(4) }}>
            <motion.button
              type="button"
              onClick={onClearNotice}
              whileTap={reduced ? undefined : { scale: 0.96 }}
              transition={springs.stiff}
              style={{
                border: 'none', appearance: 'none', borderRadius: px(26), padding: `${px(20)}px ${px(32)}px`,
                fontFamily: font.family, fontWeight: fw(800), fontSize: pxf(28), cursor: cursors.clickable,
                color: C.white, background: C.frameDark,
              }}
            >
              {t(stop ? 'agent2.reenter_key' : 'agent2.retry_now')}
            </motion.button>
          </div>
        </motion.div>
      </div>
    );
  }

  /* ── per-state pass card + key field + below content ── */
  let pass: ReactNode;
  let field: ReactNode;
  let below: ReactNode = null;

  if (connect === 'detecting') {
    pass = passCard(
      { cls: 'detecting', label: t('agent2.connecting') },
      <span style={{ width: px(120), height: px(120), borderRadius: px(36), background: C.utilTaupe, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Spinner size={px(48)} color={C.white} trackColor="rgba(255,255,255,0.4)" />
      </span>,
      t('agent2.reading_key'),
      t('agent2.matching'),
    );
    field = badgefield(
      keyInput('detecting'),
      <button
        type="button"
        onClick={ps.skipDetection}
        title={t('agent.choose_manually')}
        aria-label={t('agent.choose_manually')}
        style={{ width: px(108), height: px(88), clipPath: squircleClip(px(108), px(88), px(24)), background: C.utilTaupe, border: 'none', appearance: 'none', cursor: cursors.clickable, display: 'grid', placeItems: 'center', flexShrink: 0, padding: 0 }}
      >
        <Spinner size={px(40)} color={C.white} trackColor="rgba(255,255,255,0.4)" />
      </button>,
    );
  } else if (connect === 'pick') {
    pass = passCard(
      { cls: 'idle', label: t('agent2.pick_one') },
      idleBadge,
      t('agent2.key_unplaced'),
      t('agent2.pick_sub'),
    );
    field = badgefield(
      keyInput('pick'),
      <HoverTip label={t('agent2.recheck')}>
        <motion.button
          type="button"
          onClick={() => void ps.saveKey(false)}
          aria-label={t('agent2.recheck')}
          whileHover={reduced ? undefined : { scale: 1.06 }}
          whileTap={reduced ? undefined : { scale: 0.94 }}
          transition={springs.stiff}
          style={{ width: px(108), height: px(88), clipPath: squircleClip(px(108), px(88), px(24)), background: OK_GREEN, border: 'none', appearance: 'none', cursor: cursors.clickable, display: 'grid', placeItems: 'center', flexShrink: 0, padding: 0 }}
        >
          <CheckIcon size={px(44)} color={C.white} />
        </motion.button>
      </HoverTip>,
    );
    below = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: px(14) }}>
        <span style={hintStyle}>{t('agent2.shared_format')}</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: px(16) }}>
          {PROVIDER_IDS.map((id) => (
            <motion.button
              key={id}
              type="button"
              onClick={() => ps.commitKey(id, ps.keyDraft.trim(), false)}
              whileHover={reduced ? undefined : { y: px(-4) }}
              whileTap={reduced ? undefined : { scale: 0.97 }}
              transition={springs.stiff}
              style={{
                display: 'flex', alignItems: 'center', gap: px(20), background: C.white,
                border: `${hairline}px solid ${CARD_LINE}`, borderRadius: px(32), padding: `${px(18)}px ${px(22)}px`,
                cursor: cursors.clickable, appearance: 'none', fontFamily: font.family, textAlign: 'left', boxSizing: 'border-box',
              }}
            >
              <span style={{ width: px(64), height: px(64), borderRadius: px(20), background: PROVIDER_ACCENT[id], display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <ProviderLogo provider={id} size={px(34)} fill={C.white} />
              </span>
              <b style={{ fontWeight: fw(800), fontSize: pxf(29), color: C.inkText }}>{provName(id)}</b>
            </motion.button>
          ))}
        </div>
      </div>
    );
  } else if (connect === 'valid') {
    // Tapping the connection card opens the platform chooser (seeded with the
    // current key), so a wrongly-guessed or Custom-defaulted platform can be
    // switched by hand.
    pass = passCard(
      { cls: 'ready', label: t('agent2.connected') },
      <span style={{ width: px(120), height: px(120), borderRadius: px(36), background: accent, color: C.white, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <ProviderLogo provider={provider} size={px(64)} fill={C.white} />
      </span>,
      provName(provider),
      t('agent2.ready_sub'),
      () => { ps.setKeyDraft(keyEdit ?? apiKey); ps.setChooserOpen(true); },
    );
    // The key stays editable after connecting: masked-with-last-4 until the
    // user types a replacement; the check slot RE-CHECKS (auto-detect again)
    // the edited key, or the stored one when untouched.
    field = badgefield(
      keyInput('valid'),
      <HoverTip label={t('agent2.recheck')}>
        <motion.button
          type="button"
          onClick={() => void recheckKey()}
          aria-label={t('agent2.recheck')}
          whileHover={reduced ? undefined : { scale: 1.06 }}
          whileTap={reduced ? undefined : { scale: 0.94 }}
          transition={springs.stiff}
          style={{ width: px(108), height: px(88), clipPath: squircleClip(px(108), px(88), px(24)), background: keyEdit ? accent : OK_GREEN, border: 'none', appearance: 'none', cursor: cursors.clickable, display: 'grid', placeItems: 'center', flexShrink: 0, padding: 0 }}
        >
          <CheckIcon size={px(44)} color={C.white} />
        </motion.button>
      </HoverTip>,
    );
    below = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: px(26) }}>
        {/* endpoint */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: px(14) }}>
          <span style={kickerStyle}>{t('agent2.endpoint')}</span>
          {provider === 'custom' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: px(16), background: C.surfaceSecondary, borderRadius: px(28), padding: `${px(22)}px ${px(26)}px`, boxSizing: 'border-box' }}>
                <input
                  type="url"
                  defaultValue={agent.settings.customBaseUrl ?? ''}
                  placeholder="https://your-endpoint/v1"
                  aria-label={t('agent2.endpoint')}
                  onKeyDown={(e) => { if (e.key === 'Enter') agent.setCustomBaseUrl((e.target as HTMLInputElement).value); }}
                  onBlur={(e) => agent.setCustomBaseUrl(e.target.value)}
                  style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontFamily: font.family, fontWeight: 700, fontSize: pxf(28), color: C.inkText }}
                />
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: px(16), background: C.surfaceSecondary, borderRadius: px(28), padding: `${px(22)}px ${px(26)}px`, opacity: 0.7, boxSizing: 'border-box' }}>
              <input
                disabled
                value={baseUrlFor(provider, agent.settings) ?? SDK_DEFAULT_BASE[provider] ?? ''}
                aria-label={t('agent2.endpoint')}
                style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontFamily: font.family, fontWeight: 700, fontSize: pxf(28), color: C.inkText }}
              />
              <LockGlyph size={px(30)} color={C.textSecondary} />
            </div>
          )}
        </div>

        {/* model */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: px(14) }}>
          <span style={kickerStyle}>{t('agent2.model')}</span>
          <ModelMenu models={models} model={model} onPick={(m) => agent.setModel(provider, m)} />
        </div>

        {/* oversight — the app's segmented-switch behavior (SegmentedControl's
            persistent sliding pill, springs.stiff) in this panel's geometry */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: px(14) }}>
          <span style={kickerStyle}>{t('agent2.oversight')}</span>
          <OversightSegs value={oversight} onChange={agent.setOversight} />
          <span style={hintStyle}>{t(OVERSIGHTS.find((o) => o.id === oversight)?.hintKey ?? 'agent2.ov_checkpoint_hint')}</span>
        </div>

        {/* start building — needs a real, live-verified model AND (for Custom) a
            non-empty endpoint. An empty endpoint means a custom model id can't be
            verified, so it could be fake; both must be set before a chat can start. */}
        <motion.button
          type="button"
          disabled={!canStart}
          onClick={() => { if (canStart) onStartBuilding(); }}
          whileHover={reduced || !canStart ? undefined : { y: px(-2) }}
          whileTap={reduced || !canStart ? undefined : { scale: 0.98 }}
          transition={springs.stiff}
          style={{
            width: px(GUTTER_W), height: px(92), clipPath: squircleClip(px(GUTTER_W), px(92), px(30)),
            border: 'none', appearance: 'none',
            cursor: canStart ? cursors.clickable : cursors.blocked, color: C.white, background: accent, opacity: canStart ? 1 : 0.4,
            display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: px(14), boxSizing: 'border-box', padding: 0,
          }}
        >
          <GoArrowIcon size={px(36)} />
          <FitText flow maxW={480} size={30} color={C.white}>{t('agent2.start_building')}</FitText>
        </motion.button>
      </div>
    );
  } else {
    // idle: bring your own key + the roster grid
    pass = passCard(
      { cls: 'idle', label: t('agent2.not_connected') },
      idleBadge,
      t('agent2.byok_title'),
      t('agent2.byok_sub'),
    );
    field = badgefield(
      keyInput('idle'),
      <motion.button
        type="button"
        onClick={() => void ps.saveKey(false)}
        title={t('agent2.connect')}
        aria-label={t('agent2.connect')}
        whileTap={reduced ? undefined : { scale: 0.94 }}
        transition={springs.stiff}
        style={{ width: px(108), height: px(88), clipPath: squircleClip(px(108), px(88), px(24)), background: accent, border: 'none', appearance: 'none', cursor: cursors.clickable, display: 'grid', placeItems: 'center', flexShrink: 0, padding: 0, color: C.white }}
      >
        <GoArrowIcon size={px(44)} />
      </motion.button>,
    );
    below = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: px(22), height: '100%', minHeight: 0 }}>
        <span style={{ ...kickerStyle, textAlign: 'center', flexShrink: 0 }}>{t('agent2.roster_lbl')}</span>
        {/* Each card links OUT to its platform's key page (auto-detection owns
            platform selection); custom has no page and just selects itself.
            Hover = the prototype's lift: -4px, 1.03, accent border, deeper
            shadow, an accent tint wash, and the badge tilting up. The name
            is a hover bubble instead of a caption. */}
        {/* The rows are CAPPED at their designed height and share whatever the cards above leave
            them. The intro card and the key field grow with the language against a locked panel
            height, so a language that needs the room takes it out of the roster; one that does
            not keeps the designed card and the breathing space under it. */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridAutoRows: '1fr',
          gap: px(ROSTER_GAP), flex: 1, minHeight: 0,
          maxHeight: px(ROSTER_ROW_H * ROSTER_ROWS + ROSTER_GAP * (ROSTER_ROWS - 1)),
        }}>
          {PROVIDER_IDS.map((id, i) => {
            const url = PLATFORM_URLS[id];
            const cardStyle: React.CSSProperties = {
              position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '100%', height: '100%',
              background: C.white, border: `${Math.max(1, px(3))}px solid ${CARD_LINE}`,
              borderRadius: px(32), padding: `0 ${px(12)}px`, cursor: cursors.clickable, appearance: 'none',
              textDecoration: 'none', boxShadow: `0 ${px(4)}px ${px(12)}px ${inkTint(0.05)}`, boxSizing: 'border-box',
            };
            const inner = (
              <>
                <motion.span
                  variants={reduced ? undefined : { hover: { scale: 1.12, rotate: -5 } }}
                  transition={springs.stiff}
                  style={{ width: px(80), height: px(80), borderRadius: px(24), background: PROVIDER_ACCENT[id], display: 'grid', placeItems: 'center', boxShadow: `0 ${px(6)}px ${px(16)}px ${inkTint(0.14)}` }}
                >
                  <ProviderLogo provider={id} size={px(44)} fill={C.white} />
                </motion.span>
                {/* accent tint wash — painted LAST (an absolutely-positioned sibling
                    paints above static content, so first-child order would bury the
                    badge); opacity lives in style so it holds without an animation */}
                <motion.span
                  aria-hidden
                  variants={{ hover: { opacity: 0.08 } }}
                  style={{ position: 'absolute', inset: 0, background: PROVIDER_ACCENT[id], pointerEvents: 'none', opacity: 0 }}
                />
              </>
            );
            const hoverFx = reduced ? undefined : {
              y: px(-8), scale: 1.03,
              borderColor: PROVIDER_ACCENT[id],
              boxShadow: `0 ${px(24)}px ${px(48)}px ${inkTint(0.15)}`,
            };
            // same entrance recipe as the generator's terrain toggles (grow
            // from half size on springs.bouncy) with a tighter stagger, so the
            // 9-card grid lands quickly instead of trickling in
            const popIn = {
              initial: reduced ? false : ({ opacity: 0, scale: 0.5 } as const),
              animate: { opacity: 1, scale: 1, transition: { ...springs.bouncy, delay: reduced ? 0 : i * 0.03 } },
            };
            return (
              <HoverTip key={id} label={provName(id)} style={{ display: 'flex' }}>
                {url ? (
                  <motion.a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`roster-${id}`}
                    aria-label={provName(id)}
                    {...popIn}
                    whileHover={hoverFx && 'hover'}
                    whileTap={reduced ? undefined : { scale: 0.95 }}
                    variants={{ hover: hoverFx ?? {} }}
                    style={cardStyle}
                  >
                    {inner}
                  </motion.a>
                ) : (
                  <motion.button
                    type="button"
                    data-testid={`roster-${id}`}
                    aria-label={provName(id)}
                    onClick={() => agent.setProvider(id)}
                    {...popIn}
                    whileHover={hoverFx && 'hover'}
                    whileTap={reduced ? undefined : { scale: 0.95 }}
                    variants={{ hover: hoverFx ?? {} }}
                    style={{ ...cardStyle, fontFamily: font.family }}
                  >
                    {inner}
                  </motion.button>
                )}
              </HoverTip>
            );
          })}
        </div>
      </div>
    );
  }

  // The column is widened by PAD on each side and padded back in, so children
  // keep the exact x172..800 layout while hover lift/scale/shadow has room
  // before the overflow clip (the roster cards grow on hover).
  const PAD = 32;
  return (
    <div
      style={{
        position: 'absolute', left: px(GUTTER_X - PAD), top: px(top - PAD), width: px(GUTTER_W + PAD * 2), height: px(height + PAD),
        boxSizing: 'border-box', overflow: 'hidden', pointerEvents: 'auto',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: px(24), height: '100%', padding: `${px(PAD)}px ${px(PAD)}px 0`, boxSizing: 'border-box' }}>
        {/* the connection card and the key field are SHARED elements: they hold
            their place through every state (their content crossfades in situ) */}
        {pass}
        {field}
        {/* only the state-specific content below them slides */}
        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <AnimatePresence mode="wait" custom={stateDir}>
            <motion.div
              key={connect}
              custom={stateDir}
              variants={stateSlide}
              initial={firstState.current ? 'center' : 'enter'}
              animate="center"
              exit="exit"
              style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}
            >
              {below}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/* ── model row (config reveal) — trigger button + the shared floating menu ── */

function ModelMenu({ models, model, onPick }: { models: string[]; model: string; onPick(m: string): void }) {
  const t = useT();
  const { px, pxf, fw } = usePx();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-expanded={open}
        aria-label={t('agent2.model')}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: px(20), width: '100%', background: C.surfaceSecondary,
          border: 'none', appearance: 'none', borderRadius: px(28), padding: `${px(22)}px ${px(26)}px`,
          cursor: cursors.clickable, fontFamily: font.family, textAlign: 'left', boxSizing: 'border-box',
        }}
      >
        {/* Fixed two single-line rows: each clamps to one line (nowrap + ellipsis)
            and falls back to a non-breaking space when empty, so the button height
            never changes as model data loads (empty → id, or a long name that would
            otherwise wrap). */}
        <span style={{ display: 'flex', flexDirection: 'column', gap: px(2), minWidth: 0, flex: 1 }}>
          <span style={{ fontWeight: fw(800), fontSize: pxf(28), lineHeight: 1.2, color: model ? C.inkText : C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model ? prettyModel(model) : t('agent2.model_ph')}</span>
          <span style={{ fontSize: pxf(23), lineHeight: 1.2, fontWeight: 700, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model ? model : t('agent2.model_ph_sub')}</span>
        </span>
        <span style={{ display: 'flex', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.16s' }}>
          <CaretDownIcon size={px(30)} color={C.textSecondary} />
        </span>
      </button>
      <ModelDropdown open={open} onClose={() => setOpen(false)} anchor={anchorRef} models={models} model={model} onPick={onPick} />
    </>
  );
}

/* ── oversight segmented switch — SegmentedControl's persistent sliding pill
      (measured active-button box, springs.stiff, no layoutId) in panel px ── */

function OversightSegs({ value, onChange }: { value: Oversight; onChange(v: Oversight): void }) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const zooming = useInstantLayout(); // also stands down mid-resize — see layout-settle
  const { px, pxf, fw } = usePx();
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const pad = px(8);

  const idx = OVERSIGHTS.findIndex((o) => o.id === value);
  useLayoutEffect(() => {
    const btn = btnRefs.current[idx];
    if (!btn) return;
    const next = { x: btn.offsetLeft, w: btn.offsetWidth };
    setPill((p) => (p && p.x === next.x && p.w === next.w ? p : next));
  }, [idx, px]);

  return (
    <div
      ref={wrapRef}
      role="radiogroup"
      aria-label={t('agent2.oversight')}
      style={{ position: 'relative', display: 'flex', background: C.surfaceSecondary, borderRadius: px(26), padding: pad, gap: px(8), overflow: 'hidden' }}
    >
      {pill && (
        <motion.span
          aria-hidden
          initial={false}
          animate={{ x: pill.x, width: pill.w }}
          // Snap (no spring) while a UI-zoom is in flight: px re-measures the
          // pill's target every frame, so an animated pill would chase a moving
          // target and lag behind the segments. It still springs on a real
          // selection change (not zooming).
          transition={reduced || zooming ? { duration: 0 } : springs.stiff}
          style={{
            position: 'absolute', left: 0, top: pad, bottom: pad, width: pill.w,
            background: C.tileYellow, borderRadius: px(18), pointerEvents: 'none',
          }}
        />
      )}
      {OVERSIGHTS.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => { btnRefs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          style={{
            flex: 1, border: 'none', appearance: 'none', cursor: cursors.clickable,
            background: 'transparent', position: 'relative', zIndex: 1,
            borderRadius: px(18), padding: `${px(16)}px ${px(4)}px`,
            fontFamily: font.family, fontWeight: fw(800), fontSize: pxf(25),
            color: value === o.id ? C.inkText : C.textSecondary,
            transition: 'color .18s',
          }}
        >
          {t(o.labelKey)}
        </button>
      ))}
    </div>
  );
}
