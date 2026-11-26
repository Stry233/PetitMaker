// @vitest-environment jsdom
/**
 * The Xiaohongshu build's text check, which has no platform check: every text a player types, and every
 * such text a file or a saved map brings, passes the review run on the page, as the web edition's does.
 * The modules are the ones that build aliases (`scripts/edition-build.mts`), and the review's run is a
 * stand-in that refuses one marked word.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { createRef } from 'react';
import { spec } from '../../_support/spec';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { textVerdict, __resetTextVerdicts } from '../../../state/text-verdicts';
import NewTagCard from '../../../ui/shell/bars/annotation/NewTagCard';
import { useStencilReview } from '../../../ui/shell/bars/generate/use-stencil-review';
import { useTextReview } from '../../../ui/chrome/modals/export/review/use-text-review';
import { reviewCustomTags } from '../../../editor/review/edition-review';

const REFUSED = 'Refused word';
const run = vi.hoisted(() => ({ runReview: vi.fn() }));
vi.mock('../../../pipelines/moderation/text/review-run', () => run);
vi.mock('../../../pipelines/moderation/text/reviewer', () => import('../../../pipelines/moderation/text/reviewer-lite'));
vi.mock('../../../editor/review/edition-review', () => import('../../../editor/review/edition-review-lite'));
const edit = vi.hoisted(() => ({ addOrArmTag: vi.fn() }));
vi.mock('../../../editor/editing/annotation-edit', async (original) => ({
  ...(await original<typeof import('../../../editor/editing/annotation-edit')>()),
  addOrArmTag: edit.addOrArmTag,
}));

beforeEach(() => {
  useEditorStore.setState({ locale: 'en' });
  __resetTextVerdicts();
  edit.addOrArmTag.mockClear();
  run.runReview.mockReset();
  run.runReview.mockImplementation(async (parts: { field: string; text: string }[]) => {
    const refused = parts.filter((part) => part.text === REFUSED).map((part) => part.field);
    return refused.length ? { allowed: false, reason: 'content', fields: refused } : { allowed: true };
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 450)); });
/** The texts the review on the page heard, part by part. */
const reviewed = () => run.runReview.mock.calls.flatMap(([parts]) => parts as { field: string; text: string }[]);
const disabled = (el: HTMLElement) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';

function tagCard() {
  // The card stands on the Notes bar, so Notes is open.
  useEditorStore.getState().setEditMode({ mode: 'annotate' });
  const anchor = createRef<HTMLButtonElement>();
  render(
    <MotionConfig reducedMotion="always"><I18nProvider>
      <button ref={anchor}>Add a tag</button>
      <AnimatePresence><NewTagCard anchor={anchor} onClose={vi.fn()} /></AnimatePresence>
    </I18nProvider></MotionConfig>,
  );
  const field = screen.getByRole('textbox', { name: 'Tag name' });
  return { field, add: screen.getByRole('button', { name: 'Add' }) };
}

describe('the Xiaohongshu text check', () => {
  spec('UI-25', 'a typed tag passes the review on the page before it is added, and a refused one never is', async () => {
    const card = tagCard();
    fireEvent.change(card.field, { target: { value: 'Pond' } });
    await settle();
    await waitFor(() => expect(disabled(card.add)).toBe(false));
    fireEvent.click(card.add);
    await waitFor(() => expect(edit.addOrArmTag).toHaveBeenCalledWith('Pond', expect.any(Function), []));
    expect(reviewed()).toContainEqual({ field: 'tag', text: 'Pond' });

    fireEvent.change(card.field, { target: { value: REFUSED } });
    await settle();
    expect(await screen.findByText('This tag contains inappropriate words. Please choose another name.')).toBeTruthy();
    expect(disabled(card.add)).toBe(true);
    expect(edit.addOrArmTag).toHaveBeenCalledTimes(1);
  });

  spec('UI-25', 'a tag a saved map brings shows only once the review on the page approves it', async () => {
    useEditorStore.setState({ gridState: { annotations: { customTags: [{ text: 'Pond' }, { text: REFUSED }] } } as never });
    await reviewCustomTags();
    expect(textVerdict('Pond')).toBe('approved');
    expect(textVerdict(REFUSED)).toBe('refused');
    useEditorStore.setState({ gridState: null });
  });

  spec('UI-25', 'a picture\'s title passes the review on the page as it is typed', async () => {
    const { result, rerender } = renderHook(({ text }) => useTextReview(true, [{ field: 'title', text }], false), { initialProps: { text: 'My planet' } });
    await waitFor(() => expect(result.current.allowed).toBe(true));
    expect(reviewed()).toEqual([{ field: 'title', text: 'My planet' }]);
    rerender({ text: REFUSED });
    await waitFor(() => expect(result.current.issue).toMatchObject({ allowed: false, fields: ['title'] }));
    expect(result.current.allowed).toBe(false);
  });

  spec('UI-25', 'Letter\'s own words pass the review on the page once committed, and a refused word never builds', async () => {
    const { result, rerender } = renderHook(({ text, editing }) => useStencilReview(true, text, editing), {
      initialProps: { text: 'Hi' as string | null, editing: true },
      wrapper: ({ children }) => <I18nProvider>{children}</I18nProvider>,
    });
    await settle();
    expect(run.runReview).not.toHaveBeenCalled();
    expect(result.current.allowed).toBe(false);

    rerender({ text: 'Hi', editing: false });
    await waitFor(() => expect(result.current.allowed).toBe(true));
    expect(reviewed()).toEqual([{ field: 'stencil', text: 'Hi' }]);

    rerender({ text: REFUSED, editing: false });
    await waitFor(() => expect(result.current.note).toBe('This text contains inappropriate words. Please change it.'));
    expect(result.current.allowed).toBe(false);
  });
});
