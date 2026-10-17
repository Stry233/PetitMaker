// @vitest-environment jsdom
/**
 * The planet windows picture the open map with its plan notes, as the map shows them: Change
 * Planet's preview of the current planet and the still the nameplate and the planet list draw.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../../../../i18n/context';
import { useEditorStore } from '../../../../../state/store';
import { createDefaultRegistry } from '../../../../../rules';
import { createExecutor } from '../../../../../state/executor';
import { createGridState } from '../../../../../core/model/template';
import { MAP_TEMPLATES } from '../../../../../config/maps';
import type { AnnotationsState } from '../../../../../core/model/annotations';
import { ChangePlanetModal } from '../../../../../ui/chrome/modals/planet/ChangePlanetModal';
import { PlanetStill } from '../../../../../ui/chrome/modals/planet/PlanetStill';
import { drawnNotes, installPictureRenderer, sampleNotes } from '../../../../_support/picture-renderer';

const HEXIA = MAP_TEMPLATES['hexia']!;

let pictures: ReturnType<typeof installPictureRenderer>;
beforeEach(() => { pictures = installPictureRenderer(); localStorage.clear(); });
afterEach(() => { cleanup(); pictures.uninstall(); });

/** The live editor on Hexia, holding `notes`. */
function world(notes: AnnotationsState) {
  const state = createGridState(HEXIA);
  state.annotations = notes;
  act(() => { useEditorStore.setState({ commandExecutor: createExecutor(state, createDefaultRegistry()), gridState: state, locale: 'en', tourRunning: false }); });
  return state;
}

const callsOf = (state: object) => pictures.calls.filter((c) => c.state === state);

describe('the planet windows\' pictures', () => {
  it('show the current planet in Change Planet with its notes', async () => {
    const state = world(sampleNotes());
    render(<I18nProvider><ChangePlanetModal open onSwitch={() => {}} onClose={() => {}} /></I18nProvider>);
    await waitFor(() => expect(callsOf(state).length).toBeGreaterThan(0));
    expect(callsOf(state).every((c) => drawnNotes(c) === state.annotations)).toBe(true);
    await waitFor(() => expect(screen.getAllByTestId('planet-preview')[0]!.getAttribute('aria-busy')).toBeNull());
  });

  it('draw the still with the notes, and again once they are hidden', async () => {
    const state = world(sampleNotes());
    render(<I18nProvider><PlanetStill template={HEXIA} state={state} margin={12} style={{ width: 120, height: 80 }} testId="still" /></I18nProvider>);
    await waitFor(() => expect(screen.getByTestId('still').getAttribute('data-picture')).toBe('ready'));
    expect(drawnNotes(callsOf(state).at(-1)!)).toBe(state.annotations);
    act(() => { useEditorStore.getState().setAnnotationsVisible(false); });
    await waitFor(() => expect(callsOf(state).length).toBe(2));
    expect(drawnNotes(callsOf(state).at(-1)!)).toBeNull();
  });
});
