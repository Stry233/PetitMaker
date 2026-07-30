/**
 * HelpersBlock — parallel sub-agents inside a blueprint's current stage
 * (spec §UI.2): field-bg card with the "Helpers on it together" kicker and a
 * row per helper — colored round avatar (pulsing while running, joined by a
 * green check when done) + name + task line.
 */
import { motion, useReducedMotionConfig } from 'framer-motion';
import type { Helper } from '../../../../agent/session';
import { useT } from '../../../../i18n/context';
import { colors as C, font } from '../../../styles';
import { usePx } from '../../scale';
import { CheckIcon, OK_GREEN, VerbGlyph, pulseProps } from '../atoms';

export function HelpersBlock({ helpers }: { helpers: Helper[] }) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();
  return (
    <div
      data-testid="helpers"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: px(12),
        background: C.surfaceSecondary,
        borderRadius: px(24),
        padding: `${px(16)}px ${px(20)}px`,
      }}
    >
      <span
        style={{
          fontSize: pxf(19),
          fontWeight: fw(800),
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: C.textSecondary,
          fontFamily: font.family,
        }}
      >
        {t('agent2.helpers_kicker')}
      </span>
      {helpers.map((h, i) => (
        <div key={i} data-testid="helper" data-done={h.done} style={{ display: 'flex', alignItems: 'center', gap: px(18) }}>
          <motion.span
            {...pulseProps(!h.done && !reduced)}
            style={{
              width: px(48),
              height: px(48),
              borderRadius: '50%',
              background: h.color,
              display: 'grid',
              placeItems: 'center',
              color: C.white,
              flex: '0 0 auto',
            }}
          >
            <VerbGlyph icon={h.icon} size={px(26)} />
          </motion.span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: pxf(24),
              fontWeight: fw(800),
              color: C.inkText,
              fontFamily: font.family,
            }}
          >
            {h.name}
            <span style={{ display: 'block', fontSize: pxf(22), fontWeight: fw(700), color: C.textSecondary }}>
              {h.task}
            </span>
          </span>
          {h.done && (
            <span
              data-testid="helper-check"
              style={{
                width: px(36),
                height: px(36),
                borderRadius: '50%',
                background: OK_GREEN,
                color: C.white,
                display: 'grid',
                placeItems: 'center',
                flex: '0 0 auto',
              }}
            >
              <CheckIcon size={px(22)} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
