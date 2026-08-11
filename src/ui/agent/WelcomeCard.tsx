/*
 * WelcomeCard — the Site Log's empty state (prototype .blank): a sky-to-land
 * gradient card with two soft color pools slowly wandering beneath the content
 * (.pw-blankdrift in animations.css, 9s ease alternate, reduced-motion-gated),
 * the wavy "What should we ~build~?" title, and three starter rows that fire
 * onStarter(label). Without an API key the starters give way to a single
 * "connect a provider" line.
 *
 * All geometry = prototype css px × 2 (design px, spec §UI.0) through usePx().
 */
import { useState } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../i18n/context';
import { colors as C, inkTint, font, springs, pressable, cursors } from '../design/styles';
import { usePx } from '../design/scale';
import { Wavy } from '../primitives/Wavy';
import { VerbGlyph, ChevronRightIcon, HoverTip, RestartIcon } from './atoms';
import { sampleInspirations } from './inspirations';

export interface WelcomeCardProps {
  hasKey: boolean;
  onStarter(text: string): void;
}

export function WelcomeCard({ hasKey, onStarter }: WelcomeCardProps) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();
  // Three ideas sampled from the 96-phrase pool, held stable for this visit
  // (a re-render must not reshuffle under the pointer); the reroll button
  // below draws a new hand, with the shown three held out of it. `gen` keys
  // the rows so their pop-in replays.
  const [starters, setStarters] = useState(() => sampleInspirations(3));
  const [gen, setGen] = useState(0);
  const hairline = Math.max(1, px(2));
  return (
    <div
      data-testid="welcome-card"
      style={{
        flex: 1,
        minHeight: 0,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: px(36),
        border: `${hairline}px solid #e5ecd7`,
        background: 'linear-gradient(180deg, #FFFDF6 0%, #ECF4E4 100%)',
        boxShadow: `0 ${px(8)}px ${px(24)}px ${inkTint(0.06)}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: px(24),
        textAlign: 'center',
        padding: px(36),
        boxSizing: 'border-box',
      }}
    >
      {/* drifting color pools (the prototype's ::before) */}
      <div
        className="pw-blankdrift"
        aria-hidden
        style={{
          position: 'absolute',
          inset: '-45%',
          pointerEvents: 'none',
          background:
            'radial-gradient(38% 30% at 32% 30%, rgba(255,218,126,.45), transparent 70%), ' +
            'radial-gradient(34% 28% at 68% 66%, rgba(206,215,121,.5), transparent 70%), ' +
            'radial-gradient(24% 20% at 55% 42%, rgba(255,231,147,.30), transparent 70%)',
        }}
      />
      <h3
        style={{
          position: 'relative',
          margin: 0,
          fontFamily: font.family,
          fontWeight: fw(800),
          fontSize: pxf(42),
          color: C.inkText,
        }}
      >
        {t('agent2.build_q_a')}
        <Wavy>{t('agent2.build_q_b')}</Wavy>?
      </h3>
      {hasKey ? (
        <>
          <p
            style={{
              position: 'relative',
              margin: `${px(-8)}px 0 ${px(4)}px`,
              color: C.textSecondary,
              fontFamily: font.family,
              fontSize: pxf(27),
              fontWeight: 700,
            }}
          >
            {t('agent2.build_sub')}
          </p>
          <div
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              gap: px(16),
              width: '100%',
              maxWidth: px(512),
            }}
          >
            {starters.map((s, i) => {
              const label = t(s.key);
              return (
                <motion.button
                  key={`${gen}-${s.key}`}
                  type="button"
                  onClick={() => onStarter(label)}
                  initial={reduced ? false : { opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1, transition: { ...springs.bouncy, delay: reduced ? 0 : i * 0.06 } }}
                  whileHover={reduced ? undefined : { y: px(-4) }}
                  whileTap={reduced ? undefined : { scale: 0.97 }}
                  transition={springs.stiff}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: px(20),
                    background: C.white,
                    border: `${hairline}px solid #eadfca`,
                    borderRadius: px(28),
                    padding: `${px(20)}px ${px(24)}px`,
                    fontFamily: font.family,
                    fontWeight: fw(800),
                    fontSize: pxf(27),
                    color: C.inkText,
                    cursor: cursors.clickable,
                    appearance: 'none',
                    textAlign: 'left',
                    boxShadow: `0 ${px(4)}px ${px(12)}px ${inkTint(0.06)}`,
                  }}
                >
                  <span
                    style={{
                      width: px(56),
                      height: px(56),
                      borderRadius: px(18),
                      background: s.tile,
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                      color: C.inkText,
                    }}
                  >
                    <VerbGlyph icon={s.icon} size={px(32)} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
                  <ChevronRightIcon size={px(32)} color={C.textSecondary} />
                </motion.button>
              );
            })}
          </div>
          <HoverTip label={t('agent2.reroll')}>
            <motion.button
              type="button"
              onClick={() => { setStarters((prev) => sampleInspirations(3, prev)); setGen((g) => g + 1); }}
              aria-label={t('agent2.reroll')}
              {...(reduced ? {} : pressable)}
              style={{
                position: 'relative',
                width: px(64), height: px(64), borderRadius: '50%',
                border: `${hairline}px solid #eadfca`, background: C.white,
                color: C.textSecondary, cursor: cursors.clickable, appearance: 'none', padding: 0,
                display: 'grid', placeItems: 'center',
                boxShadow: `0 ${px(4)}px ${px(12)}px ${inkTint(0.06)}`,
              }}
            >
              <RestartIcon size={px(30)} />
            </motion.button>
          </HoverTip>
        </>
      ) : (
        <p
          style={{
            position: 'relative',
            margin: 0,
            color: C.textSecondary,
            fontFamily: font.family,
            fontSize: pxf(27),
            fontWeight: 700,
          }}
        >
          {t('agent2.need_key_line')}
        </p>
      )}
    </div>
  );
}
