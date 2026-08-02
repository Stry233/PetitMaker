/*
 * HeaderRow — the Site Log's top strip (prototype .hrow):
 * [model pill] [region] [setup gear] [start fresh], 16-design-px gaps.
 *
 * - Model pill: provider mark on an accent squircle + friendly model name
 *   (prettyModel) + caret; tap opens the model dropdown (.ddpop): model rows
 *   (name + mono id, selected = tileYellow), a custom-id input row (Enter
 *   commits), and a divider row "Change platform…" → onSetup.
 * - Region button: 76×76 square; with an active region it expands in place to
 *   [frame] N cells on tileYellow, and the pill yields the space.
 * - Start fresh is ALWAYS rendered, disabled while the log is empty; tapping
 *   opens the confirm card (Clear / Keep) owned here.
 *
 * Provider/model values live in the agent store; the parent owns region state,
 * screen switching (onSetup) and the actual clear (onReset).
 * Geometry = prototype css px × 2 (design px, spec §UI.0) through usePx().
 */
import { useRef, useState } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { colors as C, inkTint, font, springs, cursors } from '../../styles';
import { usePx } from '../scale';
import { useInstantLayout } from '../layout-settle';
import { useAgentStore } from '../../../agent/store';
import { PROVIDER_ACCENT } from '../../../agent/providers/defaults';
import { ProviderLogo } from './logos';
import { prettyModel, GBtn, CaretDownIcon, GearIcon, RestartIcon, RegionFrameIcon, HoverTip } from './atoms';
import { MenuRow, ModelDropdown } from './ModelDropdown';
import { ClickCatcher } from '../../chrome/ClickCatcher';

const GUTTER_X = 172;
const GUTTER_W = 628;

export interface HeaderRowProps {
  top: number;
  /** Cells in the active region selection; 0 = whole map. */
  regionCells: number;
  onRegionToggle(): void;
  onSetup(): void;
  onReset(): void;
  canReset: boolean;
}

export function HeaderRow({ top, regionCells, onRegionToggle, onSetup, onReset, canReset }: HeaderRowProps) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();
  // Layout animations stand down while the UI zoom eases OR the window is being resized:
  // both move everything at once, and animating toward a target that is still moving lags visibly.
  const zooming = useInstantLayout();
  const agent = useAgentStore();
  const provider = agent.settings.provider;
  const model = agent.settings.model[provider] ?? '';
  // Only list models from a live fetch; no placeholder fallback (see useProviderSettings).
  const models = agent.modelList[provider] ?? [];
  const accent = PROVIDER_ACCENT[provider];
  const [ddOpen, setDdOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const regionOn = regionCells > 0;

  const popIn = reduced ? false : { opacity: 0, y: px(-12), scale: 0.94 };

  /** Shared square header button (prototype .hbtn): field bg, ink icon. */
  const squareStyle = (disabled?: boolean): React.CSSProperties => ({
    width: px(76),
    height: px(76),
    borderRadius: px(24),
    background: C.surfaceSecondary,
    border: 'none',
    appearance: 'none',
    // flex longhands, never the placeItems shorthand: the region button's
    // active state overrides these same properties, and React warns (and
    // mis-centers) when a shorthand and a longhand fight over one value
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: disabled ? cursors.blocked : cursors.clickable,
    color: C.inkText,
    flexShrink: 0,
    padding: 0,
    opacity: disabled ? 0.35 : 1,
  });
  const hover = reduced ? undefined : { scale: 1.08 };
  const tap = reduced ? undefined : { scale: 0.9 };

  return (
    <div
      style={{
        position: 'absolute',
        left: px(GUTTER_X),
        top: px(top),
        width: px(GUTTER_W),
        display: 'flex',
        alignItems: 'center',
        gap: px(16),
        zIndex: 40,
        pointerEvents: 'auto',
      }}
    >
      {/* ── model pill ── */}
      <motion.button
        ref={pillRef}
        type="button"
        layout={!zooming}
        title={t('agent.model')}
        onClick={() => { setDdOpen((v) => !v); setConfirmOpen(false); }}
        whileHover={reduced ? undefined : { y: px(-2) }}
        transition={reduced ? { layout: { duration: 0 } } : { ...springs.stiff, layout: springs.stiff }}
        style={{
          flex: 1,
          minWidth: 0,
          height: px(76),
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: px(16),
          background: `color-mix(in srgb, ${accent} 11%, #F3EEE8)`,
          border: 'none',
          appearance: 'none',
          borderRadius: 999,
          padding: `${px(10)}px ${px(24)}px ${px(10)}px ${px(10)}px`,
          cursor: cursors.clickable,
          fontFamily: font.family,
        }}
      >
        <span
          style={{
            width: px(56),
            height: px(56),
            borderRadius: '50%',
            background: accent,
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          <ProviderLogo provider={provider} size={px(30)} fill={C.white} />
        </span>
        <span
          style={{
            fontWeight: fw(800),
            fontSize: pxf(28),
            color: C.inkText,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {prettyModel(model)}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', flexShrink: 0 }}>
          <CaretDownIcon size={px(30)} color={C.textSecondary} />
        </span>
      </motion.button>

      {/* ── region button (expands in place when a region is active) ── */}
      <HoverTip label={t('agent2.select_region')}>
      <motion.button
        type="button"
        layout={!zooming}
        onClick={onRegionToggle}
        aria-pressed={regionOn}
        aria-label={t('agent2.select_region')}
        whileHover={hover}
        whileTap={tap}
        transition={reduced ? { layout: { duration: 0 } } : { ...springs.stiff, layout: springs.stiff }}
        style={{
          ...squareStyle(),
          ...(regionOn
            ? {
                width: 'auto',
                gap: px(12),
                padding: `0 ${px(24)}px`,
                background: C.tileYellow,
                fontFamily: font.family,
                fontWeight: fw(900),
                fontSize: pxf(25),
                whiteSpace: 'nowrap',
              }
            : null),
        }}
      >
        <RegionFrameIcon size={px(36)} />
        {regionOn && (
          <motion.span
            initial={reduced ? false : { opacity: 0, x: px(-8) }}
            animate={{ opacity: 1, x: 0 }}
            transition={springs.stiff}
          >
            {t('agent2.n_cells', { n: regionCells })}
          </motion.span>
        )}
      </motion.button>
      </HoverTip>

      {/* ── setup gear ── */}
      <HoverTip label={t('agent2.setup')}>
      <motion.button
        type="button"
        layout={!zooming}
        onClick={onSetup}
        aria-label={t('agent2.setup')}
        whileHover={hover}
        whileTap={tap}
        transition={springs.stiff}
        style={squareStyle()}
      >
        <GearIcon size={px(36)} />
      </motion.button>
      </HoverTip>

      {/* ── start fresh (always rendered; disabled on an empty log) ── */}
      <HoverTip label={t('agent2.start_fresh')}>
      <motion.button
        type="button"
        layout={!zooming}
        onClick={() => { setConfirmOpen(true); setDdOpen(false); }}
        disabled={!canReset}
        aria-label={t('agent2.start_fresh')}
        whileHover={canReset ? hover : undefined}
        whileTap={canReset ? tap : undefined}
        transition={springs.stiff}
        style={squareStyle(!canReset)}
      >
        <RestartIcon size={px(36)} />
      </motion.button>
      </HoverTip>

      {/* ── model dropdown (shared floating menu; escapes the panel clip) ── */}
      <ModelDropdown
        open={ddOpen}
        onClose={() => setDdOpen(false)}
        anchor={pillRef}
        models={models}
        model={model}
        onPick={(m) => agent.setModel(provider, m)}
        footer={
          <div style={{ borderTop: '1px solid #efe8d8', marginTop: px(6), paddingTop: px(6) }}>
            <MenuRow onClick={() => { setDdOpen(false); onSetup(); }}>
              <span style={{ fontWeight: fw(900), fontSize: pxf(27), color: C.inkText, fontFamily: font.family }}>
                {t('agent2.change_platform')}
              </span>
            </MenuRow>
          </div>
        }
      />

      {/* ── start-fresh confirm card ── */}
      {confirmOpen && (
        <>
          <ClickCatcher onDismiss={() => setConfirmOpen(false)} zIndex={65} />
          <motion.div
            initial={popIn}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={springs.stiff}
            style={{
              position: 'absolute',
              left: px(20),
              right: px(20),
              top: px(194),
              zIndex: 70,
              background: C.white,
              borderRadius: px(36),
              padding: px(32),
              boxShadow: `0 ${px(28)}px ${px(68)}px ${inkTint(0.28)}`,
              display: 'flex',
              flexDirection: 'column',
              gap: px(20),
              textAlign: 'center',
              transformOrigin: 'top',
            }}
          >
            <div style={{ fontFamily: font.family, fontWeight: fw(900), fontSize: pxf(32), color: C.inkText }}>
              {t('agent2.start_fresh_q')}
            </div>
            <div style={{ fontFamily: font.family, fontWeight: 700, fontSize: pxf(25), color: C.textSecondary }}>
              {t('agent2.start_fresh_body')}
            </div>
            <div style={{ display: 'flex', gap: px(16), justifyContent: 'center' }}>
              <GBtn label={t('agent2.clear')} kind="yes" onClick={() => { setConfirmOpen(false); onReset(); }} />
              <GBtn label={t('agent2.keep')} kind="" onClick={() => setConfirmOpen(false)} />
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
}
