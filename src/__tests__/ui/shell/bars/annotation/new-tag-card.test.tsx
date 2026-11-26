// @vitest-environment jsdom
/** The Notes bar's new tag card: a name under the text check, added only once approved. */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { createRef } from 'react';
import { I18nProvider } from '../../../../../i18n/context';
import { createDefaultRegistry } from '../../../../../rules';
import { useEditorStore } from '../../../../../state/store';
import { makeTemplate } from '../../../../_support/map-state';
import { resetStore } from '../../../../_support/store';
import NewTagCard from '../../../../../ui/shell/bars/annotation/NewTagCard';

vi.mock('../../../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...(await original<typeof import('../../../../../pipelines/moderation/text/reviewer')>()),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));
afterEach(cleanup);

it('adds a typed tag name to the map\'s tags once the check approves it, arms it, and closes', async () => {
  resetStore();
  useEditorStore.setState({ locale: 'en' });
  useEditorStore.getState().initMap(makeTemplate(20, 20), createDefaultRegistry());
  useEditorStore.getState().setEditMode({ mode: 'annotate' });
  const anchor = createRef<HTMLButtonElement>();
  const onClose = vi.fn();
  render(
    <MotionConfig reducedMotion="always"><I18nProvider>
      <button ref={anchor}>Add a tag</button>
      <AnimatePresence><NewTagCard anchor={anchor} onClose={onClose} /></AnimatePresence>
    </I18nProvider></MotionConfig>,
  );
  const add = screen.getByRole('button', { name: 'Add' });
  expect(add.hasAttribute('disabled') || add.getAttribute('aria-disabled') === 'true').toBe(true);
  fireEvent.change(screen.getByRole('textbox', { name: 'Tag name' }), { target: { value: '  Pond ' } });
  await waitFor(() => expect(add.hasAttribute('disabled') || add.getAttribute('aria-disabled') === 'true').toBe(false));
  fireEvent.click(add);
  const tags = useEditorStore.getState().gridState!.annotations!.customTags!;
  expect(tags.map((tag) => tag.text)).toEqual(['Pond']);
  expect(useEditorStore.getState().annotationTag).toBe(tags[0]!.id);
  expect(onClose).toHaveBeenCalled();
});
