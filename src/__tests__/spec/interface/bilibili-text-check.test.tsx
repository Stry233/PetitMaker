// @vitest-environment jsdom
/**
 * The Bilibili Toy build's text check: every text a player types passes the local review and then the
 * Toy SDK's `checkInputSafety`, once for each text committed, never while it is typed. The modules are
 * the ones that build aliases (`scripts/edition-build.mts`), with a `window.toy` double.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { createRef } from 'react';
import { spec } from '../../_support/spec';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import NewTagCard from '../../../ui/shell/bars/annotation/NewTagCard';
import { useStencilReview } from '../../../ui/shell/bars/generate/use-stencil-review';
import { useTextReview } from '../../../ui/chrome/modals/export/review/use-text-review';
import { checkHostText } from '../../../platform/host/host-bridge';

vi.mock('../../../pipelines/moderation/text/reviewer', () => import('../../../pipelines/moderation/text/reviewer-lite'));
vi.mock('../../../platform/host/host-bridge', () => import('../../../platform/host/host-bridge-bilibili'));
vi.mock('../../../editor/review/edition-review', () => import('../../../editor/review/edition-review-bilibili'));
const edit = vi.hoisted(() => ({ addOrArmTag: vi.fn() }));
vi.mock('../../../editor/editing/annotation-edit', async (original) => ({
  ...(await original<typeof import('../../../editor/editing/annotation-edit')>()),
  addOrArmTag: edit.addOrArmTag,
}));

type Status = 'ok' | 'rejected' | 'unavailable';
/** The `window.toy` double: answers each check with the next queued status, `ok` once none is queued. */
function toyDouble() {
  const answers: Status[] = [];
  const checkInputSafety = vi.fn(async (_req: { text: string; scene?: string }) => {
    const status = answers.shift() ?? 'ok';
    return { passed: status === 'ok', status };
  });
  (window as { toy?: unknown }).toy = { checkInputSafety };
  return { checkInputSafety, answer: (...next: Status[]) => { answers.push(...next); } };
}

let toy: ReturnType<typeof toyDouble>;
beforeEach(() => { toy = toyDouble(); useEditorStore.setState({ locale: 'en' }); edit.addOrArmTag.mockClear(); });
afterEach(() => { cleanup(); delete (window as { toy?: unknown }).toy; });

const disabled = (el: HTMLElement) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';

function tagCard() {
  // The card stands on the Notes bar, so Notes is open.
  useEditorStore.getState().setEditMode({ mode: 'annotate' });
  const anchor = createRef<HTMLButtonElement>();
  const onClose = vi.fn();
  render(
    <MotionConfig reducedMotion="always"><I18nProvider>
      <button ref={anchor}>Add a tag</button>
      <AnimatePresence><NewTagCard anchor={anchor} onClose={onClose} /></AnimatePresence>
    </I18nProvider></MotionConfig>,
  );
  const field = screen.getByRole('textbox', { name: 'Tag name' });
  const add = screen.getByRole('button', { name: 'Add' });
  /** Types `text` a letter at a time, letting the field stand still after each. */
  const type = async (text: string) => {
    for (let n = 1; n <= text.length; n++) {
      fireEvent.change(field, { target: { value: text.slice(0, n) } });
      await act(async () => { await new Promise((done) => setTimeout(done, 450)); });
    }
  };
  return { field, add, type, onClose };
}

describe('the Bilibili text check', () => {
  spec('UI-25', 'a typed tag is sent to the Toy check once, when it is added, under its own scene', async () => {
    const card = tagCard();
    await card.type('Pond');
    expect(toy.checkInputSafety).not.toHaveBeenCalled();
    await waitFor(() => expect(disabled(card.add)).toBe(false));
    fireEvent.click(card.add);
    await waitFor(() => expect(edit.addOrArmTag).toHaveBeenCalledWith('Pond', expect.any(Function), []));
    expect(toy.checkInputSafety.mock.calls.map(([req]) => req)).toEqual([{ text: 'Pond', scene: 'tag' }]);
    expect(card.onClose).toHaveBeenCalled();
  }, 15_000);

  spec('UI-25', 'a text the Toy check rejects is refused and never added', async () => {
    toy.answer('rejected');
    const card = tagCard();
    await card.type('Pd');
    fireEvent.click(card.add);
    expect(await screen.findByText('This tag contains inappropriate words. Please choose another name.')).toBeTruthy();
    expect(edit.addOrArmTag).not.toHaveBeenCalled();
    expect(toy.checkInputSafety).toHaveBeenCalledTimes(1);
    expect(disabled(card.add)).toBe(true);
  });

  spec('UI-25', 'a Toy check that could not run holds the text and offers to check again', async () => {
    toy.answer('unavailable');
    const card = tagCard();
    await card.type('Pd');
    fireEvent.click(card.add);
    expect(await screen.findByText('The tag check could not finish. Try again.')).toBeTruthy();
    expect(edit.addOrArmTag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(toy.checkInputSafety).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('The tag check could not finish. Try again.')).toBeNull());
    expect(edit.addOrArmTag).not.toHaveBeenCalled();
    fireEvent.click(card.add);
    await waitFor(() => expect(edit.addOrArmTag).toHaveBeenCalledWith('Pd', expect.any(Function), []));
    // The approval of the exact text is kept, so adding it asks no third time.
    expect(toy.checkInputSafety).toHaveBeenCalledTimes(2);
  });

  spec('UI-25', 'Letter\'s own words are checked once when committed, under their own scene', async () => {
    const { result, rerender } = renderHook(({ text, editing }) => useStencilReview(true, text, editing), {
      initialProps: { text: null as string | null, editing: true },
      wrapper: ({ children }) => <I18nProvider>{children}</I18nProvider>,
    });
    rerender({ text: 'Hi', editing: true });
    await act(async () => { await new Promise((done) => setTimeout(done, 450)); });
    expect(toy.checkInputSafety).not.toHaveBeenCalled();
    rerender({ text: 'Hi', editing: false });
    await waitFor(() => expect(result.current.allowed).toBe(true));
    expect(toy.checkInputSafety.mock.calls.map(([req]) => req)).toEqual([{ text: 'Hi', scene: 'stencil' }]);

    toy.answer('unavailable');
    rerender({ text: 'Hello', editing: false });
    await waitFor(() => expect(result.current.note).toBe('The text check could not finish. Click to try again.'));
    expect(result.current.allowed).toBe(false);
    act(() => { result.current.retry?.(); });
    await waitFor(() => expect(result.current.allowed).toBe(true));
    expect(toy.checkInputSafety).toHaveBeenCalledTimes(3);
  });

  spec('UI-25', 'a picture\'s title and description wait for the export, then each is checked once under its own scene', async () => {
    const parts = [{ field: 'title', text: 'My planet' }, { field: 'description', text: 'Built by the river' }] as const;
    const { result } = renderHook(() => useTextReview(true, [...parts], false));
    await act(async () => { await new Promise((done) => setTimeout(done, 450)); });
    expect(toy.checkInputSafety).not.toHaveBeenCalled();
    expect(result.current.allowed).toBe(false);
    expect(result.current.ready).toBe(true);
    toy.answer('ok', 'rejected');
    await expect(act(() => result.current.check([...parts]))).resolves.toEqual({ allowed: false, reason: 'content', fields: ['description'] });
    expect(toy.checkInputSafety.mock.calls.map(([req]) => req)).toEqual([
      { text: 'My planet', scene: 'title' }, { text: 'Built by the river', scene: 'description' },
    ]);
  });

  spec('UI-25', 'a text past the Toy check\'s 16384 bytes is never sent', async () => {
    await expect(checkHostText!('é'.repeat(8193), 'description')).resolves.toBe('too-long');
    expect(toy.checkInputSafety).not.toHaveBeenCalled();
    await expect(checkHostText!('é'.repeat(8192), 'description')).resolves.toBe('ok');
  });
});
