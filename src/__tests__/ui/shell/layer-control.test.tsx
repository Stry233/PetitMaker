/**
 * The layer control, as the design source draws it: a tall dark plate carrying nothing but two
 * steps, and the count standing OUTSIDE it.
 *
 * That the figure is not on the plate is the whole shape of the thing and is easy to lose, since
 * every instinct says to put a stepper's number between its arrows. What these pin is the count
 * reading as a localized layer NAME rather than a bare digit with a caption, each step being its
 * own control that spends itself at its end of the range, and the plate holding no text at all.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EventBus } from '../../../core/commands/event-bus';
import { ELEVATION_MAX } from '../../../core/model/constants';
import type { EditorEvents } from '../../../core/model/types';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { Rail } from '../../../ui/shell/Rail';

const mount = () => render(<I18nProvider><Rail hidden={false} onHide={() => {}} /></I18nProvider>);
const step = (name: 'Add layer' | 'Remove layer') => screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => {
  useEditorStore.setState({
    locale: 'en', eventBus: new EventBus<EditorEvents>(), gridState: null, activeLayer: 0, displayLayer: null,
  });
});
afterEach(cleanup);

describe('the layer control', () => {
  /** And it names it the way the panel it opens does: `ui/shell/layer-name.ts` is the one rule, so the
   *  ground floor cannot read "Ground" on the plate and "Layer 0" on the readout one click apart. */
  it('names the layer rather than showing a bare figure, and the ground by its word', () => {
    mount();
    expect(screen.getByTestId('shell-layer-readout').textContent).toBe('Ground');
    fireEvent.click(step('Add layer'));
    expect(screen.getByTestId('shell-layer-readout').textContent).toBe('Layer 1');
  });

  it('keeps the count off the plate, which carries the two steps and nothing else', () => {
    mount();
    const readout = screen.getByTestId('shell-layer-readout');
    const plate = step('Add layer').parentElement!;
    expect(plate.contains(readout)).toBe(false);
    expect(plate.textContent).toBe('');
    expect(plate.querySelectorAll('button').length).toBe(2);
  });

  it('spends each step at its own end of the range', () => {
    mount();
    expect(step('Remove layer').disabled, 'nothing below the ground').toBe(true);
    expect(step('Add layer').disabled).toBe(false);

    for (let i = 0; i < ELEVATION_MAX; i++) fireEvent.click(step('Add layer'));
    expect(screen.getByTestId('shell-layer-readout').textContent).toBe(`Layer ${ELEVATION_MAX}`);
    expect(step('Add layer').disabled, 'and nothing above the top layer').toBe(true);
    expect(step('Remove layer').disabled).toBe(false);
  });

  it('shows the layer being previewed while one is, and the armed one otherwise', () => {
    useEditorStore.setState({ activeLayer: 3, displayLayer: 6 });
    mount();
    expect(screen.getByTestId('shell-layer-readout').textContent).toBe('Layer 6');
  });
});
