import { useState } from 'react';
import { useT } from '../../../i18n/context';
import { FloatMenu, type FloatMenuItem } from '../../primitives/FloatMenu';
import { prettyModel } from './pretty-model';

interface ModelPickerProps {
  model: string;
  items: readonly FloatMenuItem[];
  allowManual: boolean;
  listing: boolean;
  /** Whether the listing's spinner stands here; a card showing it in another field says false. */
  loader?: boolean;
  hint?: string;
  onPick(id: string): void;
}

/** The assistant's model choice: the house dropdown with its search, matched by friendly name too. */
export function ModelPicker({ model, items, allowManual, listing, loader = true, hint, onPick }: ModelPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <FloatMenu
      data-testid="manage-model-dd"
      aria-label={t('agent.setup_manage_model')}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      onPick={onPick}
      activeId={model}
      items={items.map((item) => ({ ...item, text: prettyModel(item.id) }))}
      search={{
        label: t(allowManual ? 'agent.setup_model_placeholder' : 'agent.setup_model_search'),
        noMatches: t('agent.setup_model_no_matches'),
        ...(allowManual ? { empty: t('agent.setup_models_unavailable'), manual: (id: string) => t('agent.setup_model_use', { id }) } : {}),
        'data-testid': 'manage-model-input',
      }}
      loading={listing && loader}
      note={hint}
      row={<span data-testid="manage-model-face">{model === '' ? t('agent.setup_model_pick') : prettyModel(model)}</span>}
    />
  );
}
