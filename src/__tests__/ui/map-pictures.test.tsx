// @vitest-environment jsdom
/**
 * The map cards outside the planet windows picture their map with its plan notes: the import
 * confirmation, the restore offer and the assistant's shots of the live map.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../i18n/context';
import { useEditorStore } from '../../state/store';
import { makeState } from '../_support/map-state';
import { drawnNotes, installPictureRenderer, sampleNotes } from '../_support/picture-renderer';
import { ImportConfirm } from '../../ui/chrome/modals/import/ImportConfirm';
import { RestoreShelf } from '../../ui/shell/bars/generate/RestoreShelf';
import { MapShot } from '../../ui/agent/parts/map-shot';

let pictures: ReturnType<typeof installPictureRenderer>;
beforeEach(() => { pictures = installPictureRenderer(); });
afterEach(() => { cleanup(); pictures.uninstall(); });

/** A map holding one note of each kind. */
function noted() {
  const state = makeState(16, 12);
  state.annotations = sampleNotes();
  return state;
}

/** Waits for `state`'s picture and returns the notes it drew. */
async function notesPictured(state: object) {
  await waitFor(() => expect(pictures.calls.some((c) => c.state === state)).toBe(true));
  return drawnNotes(pictures.calls.find((c) => c.state === state)!);
}

describe('map cards', () => {
  it('confirm an import with the decoded map\'s notes', async () => {
    const state = noted();
    render(<I18nProvider><ImportConfirm preview={{ source: 'json', state, warnings: [] }} name="m.json" replacing={false} busy={false} onConfirm={() => {}} onCancel={() => {}} /></I18nProvider>);
    expect(await notesPictured(state)).toBe(state.annotations);
  });

  it('offer a restore with the saved map\'s notes', async () => {
    const state = noted();
    render(<I18nProvider><RestoreShelf state={state} onRestore={() => {}} onDismiss={() => {}} /></I18nProvider>);
    expect(await notesPictured(state)).toBe(state.annotations);
  });

  it('show the assistant the live map with its notes', async () => {
    const state = noted();
    act(() => { useEditorStore.setState({ gridState: state }); });
    render(<I18nProvider><MapShot box={undefined} width={160} height={90} whole /></I18nProvider>);
    expect(await notesPictured(state)).toBe(state.annotations);
  });
});
