// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../../../i18n/context';
import { CustomCard } from '../../../../../ui/shell/bars/generate/CustomCard';

import { TEXT_MAX_CHARS } from '../../../../../ui/shell/bars/generate/generate-shelf';

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
  it('limits pasted text at complete grapheme boundaries', () => {
    const { input } = mount();
    const atLimit = 'A'.repeat(TEXT_MAX_CHARS - 6) + '\u{1f469}\u200d\u{1f33e}\u{1f44d}\u{1f3fd}\u{1f1e8}\u{1f1f3}1\ufe0f\u20e3e\u0301\u8c37';
    fireEvent.change(input, { target: { value: atLimit + 'A' } });
    expect(input.value).toBe(atLimit);
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
    expect(input.value).toBe('\u661f\u5e03\u8c37\u5730\u8c37\u5730\u5de5\u574a');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
