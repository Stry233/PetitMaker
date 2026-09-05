import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { CustomCard } from '../../../ui/shell/bars/CandidateCard';

afterEach(cleanup);

function mount() {
  const commit = vi.fn();
  function Field() {
    const [draft, setDraft] = useState('');
    return <CustomCard field="glyph" seed={null} draft={draft} shot={null} selected={false} onDraft={setDraft} onCommit={commit} onEdit={() => {}} onSelect={() => {}} />;
  }
  render(<I18nProvider><Field /></I18nProvider>);
  return { input: screen.getByRole('textbox') as HTMLInputElement, commit };
}

describe('custom text input', () => {
  it('limits pasted text to six complete graphemes', () => {
    const { input } = mount();
    const six = '👩‍🌾👍🏽🇨🇳1️⃣e\u0301谷';
    fireEvent.change(input, { target: { value: six + 'A' } });
    expect(input.value).toBe(six);
  });

  it('preserves IME preedit and uses Enter to select a character before confirming text', () => {
    const { input, commit } = mount();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'xingbugudi' } });
    expect(input.value).toBe('xingbugudi');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '星布谷地谷地工坊' } });
    fireEvent.compositionEnd(input);
    expect(input.value).toBe('星布谷地谷地');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
