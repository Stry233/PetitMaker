// @vitest-environment jsdom
/**
 * The layer control: the localized name of the layer shown beside the arrow plate, which opens the layer
 * panel. It chooses no layer: a stroke takes its layer from where it starts (EDIT-79).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { spec } from '../../../_support/spec';
import { EventBus } from '../../../../core/commands/event-bus';
import type { EditorEvents } from '../../../../state/editing/events';
import { I18nProvider } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import { Rail } from '../../../../ui/shell/Rail';

const mount = () => render(<I18nProvider><Rail hidden={false} onHide={() => {}} /></I18nProvider>);

beforeEach(() => {
  useEditorStore.setState({
    locale: 'en', eventBus: new EventBus<EditorEvents>(), gridState: null, displayLayer: null,
  });
});
afterEach(cleanup);

describe('the layer control', () => {
  /** And it names it the way the panel it opens does: `i18n/terms/layer-name.ts` is the one rule, so the
   *  readout and the panel number a layer alike, the game's way, the ground as layer 1. */
  it('names the layer rather than showing a bare figure, the ground as layer 1', () => {
    mount();
    expect(screen.getByTestId('shell-layer-readout').textContent).toBe('Layer 1');
  });

  spec('EDIT-79', 'offers no control that chooses a layer', () => {
    mount();
    expect(screen.queryByRole('button', { name: /add layer|remove layer/i })).toBeNull();
    expect(screen.getAllByRole('button').filter((b) => b.closest('[data-testid="shell-layer-control"]')).map((b) => b.getAttribute('aria-label'))).toEqual(['Layers']);
  });

  spec('EDIT-79', 'opens the layer panel from its arrow plate, stepping no layer', () => {
    useEditorStore.setState({ displayLayer: 2 });
    mount();
    expect(screen.queryByTestId('shell-layer-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('shell-layer-plate'));
    expect(screen.getByTestId('shell-layer-panel')).toBeTruthy();
    expect(useEditorStore.getState().displayLayer).toBe(2);
  });

  it('shows the layer a stroke works on', () => {
    useEditorStore.setState({ displayLayer: 6 });
    mount();
    expect(screen.getByTestId('shell-layer-readout').textContent).toBe('Layer 7');
  });
});
