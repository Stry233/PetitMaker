import { useSyncExternalStore } from 'react';
import { AnimatePresence, useIsPresent } from 'framer-motion';
import {
  catalogVersion, modelCapabilities, subscribeCatalog, thinkingChoiceKey, thinkingChoices,
} from '../../../agent/panel';
import { useT } from '../../../i18n/context';
import { INK } from '../../design/tokens';
import { roleFont } from '../../design/text-weight';
import { NOTE_STYLE } from './setup-parts';
import { effortKey, useAgentConnection } from '../../../agent/boot';
import { Disclosure } from '../../primitives/Disclosure';
import type { I18nKey } from '../../../i18n/keys';

const LEVEL_KEYS: Record<string, I18nKey> = {
  none: 'agent.effort_none', minimal: 'agent.effort_minimal', low: 'agent.effort_low',
  medium: 'agent.effort_medium', high: 'agent.effort_high', xhigh: 'agent.effort_xhigh', max: 'agent.effort_max',
};

export function EffortControl({ onChange }: { onChange: () => void }) {
  const t = useT();
  const settings = useAgentConnection();
  useSyncExternalStore(subscribeCatalog, catalogVersion);
  const caps = modelCapabilities(settings.provider, settings.model[settings.provider], settings.customBaseUrl);
  const choices = thinkingChoices(caps, settings.provider);
  const current = choices.findIndex((choice) => thinkingChoiceKey(choice) === settings.effort[effortKey(settings)]) + 1;
  const label = current === 0 ? t('agent.effort_auto') : choices[current - 1]?.effort
    ? t(LEVEL_KEYS[choices[current - 1]!.effort!] ?? 'agent.effort_level', { n: current })
    : t((['agent.effort_low', 'agent.effort_medium', 'agent.effort_high'] as const)[current - 1] ?? 'agent.effort_high');
  return (
    <AnimatePresence initial={false}>
      {choices.length > 0 && (
        <Disclosure key="effort" testId="manage-effort-reveal" spaceAfter={14}>
          <EffortFields label={label} current={current} count={choices.length}
            onPick={(value) => {
              const choice = choices[value - 1];
              settings.setEffort(choice ? thinkingChoiceKey(choice) : 'auto');
              onChange();
            }} />
        </Disclosure>
      )}
    </AnimatePresence>
  );
}

function EffortFields({ label, current, count, onPick }: {
  label: string; current: number; count: number; onPick: (value: number) => void;
}) {
  const t = useT();
  const present = useIsPresent();
  return (
    <div data-testid="manage-effort" aria-hidden={!present || undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor="agent-effort" style={{ ...roleFont('label'), color: INK, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span>{t('agent.effort_label')}</span><span data-testid="manage-effort-value">{label}</span>
      </label>
      <input id="agent-effort" data-testid="manage-effort-slider" type="range" min={0} max={count} step={1}
        disabled={!present}
        value={current} aria-valuetext={label}
        onChange={(e) => { if (present) onPick(Number(e.target.value)); }}
        style={{ width: '100%', accentColor: INK, margin: 0 }} />
      <p style={NOTE_STYLE}>{t('agent.effort_hint')}</p>
    </div>
  );
}
