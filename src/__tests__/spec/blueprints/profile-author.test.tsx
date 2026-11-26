// @vitest-environment jsdom
/**
 * The save step where the host forbids names a player makes up (Bilibili Toy): the author is the
 * player's nickname on the platform, asked for on a press, or Anonymous, and never typed. The bridge is
 * the one that build aliases (`scripts/edition-build.mts`), with a `window.toy` double.
 */
import { afterEach, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../_support/spec';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { writePref } from '../../../platform/storage/prefs';
import { openBlueprintSave, saveBlueprint } from '../../../editor/editing/blueprint';
import { SaveDock } from '../../../ui/shell/bars/blueprint/SaveDock';
import { blueprintEditor, open, scene } from './_blueprints';

vi.mock('../../../platform/build/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../platform/build/edition')>()),
  SUPPORTS_TYPED_AUTHOR: false,
}));
vi.mock('../../../platform/host/host-bridge', () => import('../../../platform/host/host-bridge-bilibili'));
vi.mock('../../../pipelines/moderation/text/reviewer', () => import('../../../pipelines/moderation/text/reviewer-lite'));
vi.mock('../../../editor/review/edition-review', () => import('../../../editor/review/edition-review-bilibili'));

const editor = blueprintEditor();
afterEach(() => { cleanup(); delete (window as { toy?: unknown }).toy; });

const OPEN_ID = 'toy-open-id-of-the-player';

function saveDock(profile: () => Promise<unknown>) {
  const getUserProfile = vi.fn(profile);
  const checkInputSafety = vi.fn(async () => ({ passed: true, status: 'ok' }));
  (window as { toy?: unknown }).toy = { getUserProfile, checkInputSafety };
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  act(() => { openBlueprintSave(sc.frame); });
  render(<MotionConfig reducedMotion="always"><I18nProvider><SaveDock /></I18nProvider></MotionConfig>);
  const dock = screen.getByRole('region', { name: 'Save blueprint' });
  const author = within(dock).getByRole('textbox', { name: 'Author' }) as HTMLInputElement;
  const anonymous = within(dock).getByRole('switch', { name: 'Anonymous' });
  const save = within(dock).getByRole('button', { name: 'Save blueprint' });
  return { getUserProfile, checkInputSafety, author, anonymous, save };
}

spec('BLUE-05', 'where names may not be made up, the author is the player\'s nickname, asked for on a press, or Anonymous', async () => {
  writePref('blueprintAuthor', null);
  const dock = saveDock(async () => ({ avatar: 'face.png', nickname: '  Toy Player ', toyOpenId: OPEN_ID }));
  // It starts anonymous, asks the platform nothing, and takes no typing.
  expect(dock.anonymous.getAttribute('aria-checked')).toBe('true');
  expect(dock.author.readOnly).toBe(true);
  fireEvent.change(dock.author, { target: { value: 'Made up' } });
  expect(dock.author.value).toBe('');
  expect(dock.getUserProfile).not.toHaveBeenCalled();
  // Turning Anonymous off asks the platform once, which may first ask the player's consent.
  fireEvent.click(dock.anonymous);
  await waitFor(() => expect(dock.author.value).toBe('Toy Player'));
  expect(dock.anonymous.getAttribute('aria-checked')).toBe('false');
  expect(dock.getUserProfile).toHaveBeenCalledTimes(1);
  fireEvent.click(dock.save);
  await waitFor(() => expect(editor.lib().records()).toHaveLength(1));
  expect(editor.lib().records()[0]).toMatchObject({ author: 'Toy Player' });
  // The platform's own nickname is no text the player typed, and the player's id is kept nowhere.
  expect(dock.checkInputSafety).not.toHaveBeenCalled();
  expect(JSON.stringify({ ...localStorage })).not.toContain(OPEN_ID);
  expect(JSON.stringify(editor.lib().records())).not.toContain(OPEN_ID);
});

spec('BLUE-05', 'where names may not be made up and the platform gives no nickname, the blueprint stays anonymous', async () => {
  writePref('blueprintAuthor', null);
  const dock = saveDock(async () => { throw new Error('[ToySDK] user denied'); });
  fireEvent.click(dock.anonymous);
  await waitFor(() => expect(dock.getUserProfile).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(dock.anonymous.getAttribute('aria-checked')).toBe('true'));
  expect(dock.author.value).toBe('');
  fireEvent.click(dock.save);
  await waitFor(() => expect(editor.lib().records()).toHaveLength(1));
  expect(editor.lib().records()[0]).toMatchObject({ author: null });
});

spec('BLUE-05', 'where names may not be made up, two presses while the platform is asked ask it once', async () => {
  writePref('blueprintAuthor', null);
  let answer: (profile: unknown) => void = () => {};
  const dock = saveDock(() => new Promise((resolve) => { answer = resolve; }));
  fireEvent.click(dock.anonymous);
  fireEvent.click(dock.anonymous);
  expect(dock.getUserProfile).toHaveBeenCalledTimes(1);
  await act(async () => { answer({ nickname: 'Toy Player' }); });
  await waitFor(() => expect(dock.author.value).toBe('Toy Player'));
  expect(dock.anonymous.getAttribute('aria-checked')).toBe('false');
});

spec('BLUE-05', 'where names may not be made up, a save naming an author the platform never gave stores nothing, whoever asks for it', async () => {
  writePref('blueprintAuthor', null);
  const sc = scene();
  open(sc.w);
  expect(await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: 'Made up', folder: null })).toBe('author');
  expect(editor.lib().records()).toHaveLength(0);
  expect(await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: null, folder: null })).toMatchObject({ author: null });
});
