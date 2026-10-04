import { useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../../i18n/context';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../design/focus-source';
import { ACTIVE, INSET } from '../design/tokens';
import { ActionButton } from '../primitives/ActionButton';
import { FLOAT_MENU_CONTENT_RADIUS, FloatMenu, floatMenuItemStyle, type FloatMenuItem } from '../primitives/FloatMenu';
import { ScrollArea } from '../primitives/ScrollArea';
import { Spinner } from '../primitives/Spinner';
import { CONTROL_CLEARANCE } from '../primitives/use-scroll-row';
import { prettyModel } from './pretty-model';
import { FIELD_STYLE, INPUT_STYLE, NOTE_STYLE } from './setup-parts';

interface ModelPickerProps {
  model: string;
  items: readonly FloatMenuItem[];
  allowManual: boolean;
  listing: boolean;
  zoom: number;
  hint?: string;
  onPick(id: string): void;
}

export function ModelPicker({ model, items, allowManual, listing, zoom, hint, onPick }: ModelPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const typed = query.trim();
  const search = typed.toLocaleLowerCase();
  const matches = items.filter(({ id }) => `${id} ${prettyModel(id)}`.toLocaleLowerCase().includes(search));
  const custom = allowManual && typed !== '' && !items.some(({ id }) => id === typed);
  const choices = custom ? [...matches, { id: typed, label: t('agent3.setup_model_use', { id: typed }) }] : matches;

  const close = () => { setOpen(false); setQuery(''); };
  const pick = (id: string) => { onPick(id); close(); };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && ['Home', 'End'].includes(event.key)) return;
    const controls = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? []);
    const at = controls.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1
      : (at + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
    event.preventDefault();
    controls[next]?.focus();
  };

  return (
    <FloatMenu
      data-testid="manage-model-dd"
      aria-label={t('agent3.setup_manage_model')}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={close}
      zoom={zoom}
      row={<span data-testid="manage-model-face">{model === '' ? t('agent3.setup_model_pick') : prettyModel(model)}</span>}
      body={(
        <div ref={bodyRef} onKeyDown={navigate} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 6 }}>
          <label className={FIELD_WRAP_CLASS} style={{ ...FIELD_STYLE, borderRadius: FLOAT_MENU_CONTENT_RADIUS, flexShrink: 0 }}>
            <input
              type="search"
              data-testid="manage-model-input"
              className={FIELD_INPUT_CLASS}
              aria-label={t(allowManual ? 'agent3.setup_model_placeholder' : 'agent3.setup_model_search')}
              placeholder={t(allowManual ? 'agent3.setup_model_placeholder' : 'agent3.setup_model_search')}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              enterKeyHint="done"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
                event.preventDefault();
                const exact = items.find(({ id }) => id === typed);
                const id = exact?.id ?? (custom ? typed : matches.length === 1 ? matches[0]?.id : undefined);
                if (id) pick(id);
              }}
              style={{ ...INPUT_STYLE, letterSpacing: 0 }}
            />
            {listing && <Spinner size={13} />}
          </label>
          {hint && <p style={{ ...NOTE_STYLE, padding: '0 8px' }}>{hint}</p>}
          <ScrollArea role="menu" aria-label={t('agent3.setup_manage_model')} gutter="stable" fade="both" style={{ flex: '1 1 auto' }} contentStyle={{ display: 'flex', flexDirection: 'column', gap: 2, padding: CONTROL_CLEARANCE }}>
            {choices.map((item) => (
              <ActionButton
                key={item.id}
                role="menuitemradio"
                aria-checked={item.id === model}
                interaction="row"
                hoverFill={item.id === model ? ACTIVE : INSET}
                onClick={() => pick(item.id)}
                style={{ ...floatMenuItemStyle(item.id === model), flexShrink: 0, overflowWrap: 'anywhere' }}
              >
                <span style={{ minWidth: 0 }}>{item.label}</span>
                {item.sub && <span style={{ ...NOTE_STYLE, marginLeft: 'auto' }}>{item.sub}</span>}
              </ActionButton>
            ))}
            {choices.length === 0 && !listing && (
              <p role="status" style={{ ...NOTE_STYLE, padding: '8px 14px' }}>
                {t(typed === '' && allowManual ? 'agent3.setup_models_unavailable' : 'agent3.setup_model_no_matches')}
              </p>
            )}
          </ScrollArea>
        </div>
      )}
    />
  );
}
