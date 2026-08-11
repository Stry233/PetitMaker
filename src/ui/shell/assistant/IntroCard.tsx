/*
 * IntroCard — the assistant's not-connected face, which is the one state the design draws.
 *
 * Two white plates inside the bubble (the intro line's and the key field's) and a yellow button
 * under them. Pasting a key is the only required action: `saveKey` identifies the platform from the
 * key's own format, probes for it when the format is shared, and files it encrypted. The card never
 * names a platform to pick, which is why the design gives it no roster.
 *
 * Laid out as a COLUMN of the drawn boxes and the gaps between them rather than at four absolute
 * rects. The design's Chinese is three lines and lands exactly where it is drawn; a language that
 * needs a fourth takes it, and the plate behind grows by that much. Fixing the boxes instead would
 * have to lose something — clip the sentence, or shrink it past reading.
 *
 * Everything the card cannot answer — an ambiguous key that needs a human choice, a custom
 * endpoint, the oversight setting — is the full setup screen's, and the card hands over to it.
 *
 * This file is in the MAIN bundle, which is what the panel's whole not-connected state costs. It
 * can be, because nothing here reaches an SDK: the platform metadata is `providers/defaults`, and
 * `useProviderSettings` imports the adapters only inside the handlers that call one.
 */
import { useEffect, useState } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useAgentStore } from '../../../agent/store';
import { PROVIDER_IDS } from '../../../agent/providers/defaults';
import { useT } from '../../../i18n/context';
import { usePx } from '../../design/scale';
import { Spinner } from '../../primitives/Spinner';
import { btnReset, cursors, font, springs } from '../../design/styles';
import { ACTIVE, INK, MUTED_INK, PLATE_INK } from '../../design/tokens';
import { BarText } from '../bars/bar-atoms';
import { useProviderSettings, type ProviderSettings } from '../../agent/useProviderSettings';
import { TEXT } from '../units';
import { CONNECT, INTRO } from './assistant-frame';

/**
 * The card with the hook that drives it, which is what the panel mounts.
 *
 * It is its own component so that only ONE face of the panel holds a `useProviderSettings`: the
 * hook fetches the provider's model list, and a second live copy would ask for it twice.
 */
export function IntroFace({ onOpenSetup }: { onOpenSetup(): void }) {
  const setSetupOpen = useAgentStore((s) => s.setSetupOpen);
  // The hook wants somewhere to report "this provider has no key, open setup". This card IS that
  // screen, so the ask is already answered and nothing acts on it; the card hands over to the full
  // setup screen itself, for the questions it cannot put (an ambiguous key, a custom endpoint).
  const ps = useProviderSettings(() => {});
  // Handing over has to SAY so: `setupOpen` is session state, and a user who closed setup once
  // would otherwise land back on the log.
  return <IntroCard ps={ps} onOpenSetup={() => { setSetupOpen(true); onOpenSetup(); }} />;
}

export interface IntroCardProps {
  ps: ProviderSettings;
  /** Hand over to the full setup screen: the user asked for it, or the key needs a human choice. */
  onOpenSetup(): void;
}

export function IntroCard({ ps, onOpenSetup }: IntroCardProps) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, fw } = usePx();
  const [draft, setDraft] = useState('');

  // An ambiguous key is a question only the chooser can ask, and the chooser is the setup screen's.
  useEffect(() => {
    if (ps.chooserOpen) onOpenSetup();
  }, [ps.chooserOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = () => {
    const k = draft.trim();
    if (!k || ps.detecting) return;
    void ps.saveKey(true, k);
  };

  const plate = {
    alignSelf: 'stretch' as const,
    borderRadius: px(INTRO.radius),
    background: '#FFFFFF',
    boxSizing: 'border-box' as const,
  };

  return (
    <div
      data-testid="shell-assistant-intro"
      style={{
        // The card takes the plate's width rather than the drawn 637, because the plate has two of
        // them: the panel widens when the drawn one leaves the introduction taller than the room,
        // and it is the paragraph's LINE COUNT that has to come down for that to help.
        margin: `0 ${px(INTRO.padRight)}px 0 ${px(INTRO.x)}px`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <div style={{ ...plate, padding: `${px(INTRO.textPad.top)}px ${px(INTRO.textPad.x)}px ${px(INTRO.textPad.bottom)}px` }}>
        <p
          style={{
            margin: 0,
            fontFamily: font.family,
            fontWeight: fw(700),
            fontSize: TEXT.label,
            lineHeight: 1.55,
            color: PLATE_INK,
          }}
        >
          {t('assistant.intro', { n: PROVIDER_IDS.length })}
        </p>
      </div>

      {/* The input turns its own ring off, so the plate it is laid over has to take it: the pair
          `animations.css` moves a focus ring up for. Without the wrapper's half of it the field is
          focusable with nothing to show for it. */}
      <div
        className="pw-field-wrap"
        style={{
          ...plate,
          minHeight: px(INTRO.keyH),
          marginTop: px(INTRO.gapToKey),
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') connect(); }}
          placeholder={t('agent2.paste_key')}
          aria-label={t('agent.api_key')}
          className="pw-field-input"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            padding: `8px ${px(INTRO.textPad.x)}px`,
            fontFamily: font.family,
            fontWeight: fw(700),
            fontSize: TEXT.label,
            color: PLATE_INK,
          }}
        />
      </div>

      <div
        style={{
          marginTop: px(INTRO.gapToButton),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: px(40),
          height: px(CONNECT.h),
        }}
      >
        <motion.button
          type="button"
          onClick={connect}
          disabled={ps.detecting}
          whileHover={reduced || ps.detecting ? undefined : { scale: 1.04 }}
          whileTap={reduced || ps.detecting ? undefined : { scale: 0.95 }}
          transition={springs.stiff}
          style={{
            ...btnReset,
            minWidth: px(CONNECT.w),
            height: px(CONNECT.h),
            padding: '0 14px',
            borderRadius: 999,
            background: ACTIVE,
            cursor: ps.detecting ? cursors.blocked : cursors.clickable,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {ps.detecting
            ? <Spinner size={TEXT.tab} color={INK} />
            : <BarText size={TEXT.label} color={INK} weight={800}>{t('agent2.connect')}</BarText>}
        </motion.button>

        <button
          type="button"
          onClick={onOpenSetup}
          style={{
            ...btnReset,
            height: px(CONNECT.h),
            // A word beside a pill: focus rings it as the pill's own shape rather than as a box.
            borderRadius: 999,
            cursor: cursors.clickable,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <BarText size={TEXT.label} color={MUTED_INK} weight={700}>{t('agent2.setup')}</BarText>
        </button>
      </div>
    </div>
  );
}
