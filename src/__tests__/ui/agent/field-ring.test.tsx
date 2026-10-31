// @vitest-environment jsdom
/**
 * Every text field is ringed as the shape it is drawn as, and the composer's text never leaves its
 * pill. An outline follows its own element's radius, so the ring moves to the rounded wrapper through
 * `design/focus-source.ts`'s pair (`FIELD_WRAP_CLASS` on the box, `FIELD_INPUT_CLASS` on the input);
 * either half alone rings twice or not at all. jsdom resolves no `:has()`, so the classes and radius
 * are checked, not pixels.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { SetupScreen } from '../../../ui/agent/connection/SetupScreen';
import { ManageScreen } from '../../../ui/agent/connection/ManageScreen';
import {
  Composer, FIELD_MAX_LINES, PILL_RADIUS, WELL_LEAD_IN, WELL_PAD,
} from '../../../ui/agent/composer/Composer';
import { useAgentConnection } from '../../../agent/connection/store';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../../../ui/design/focus-source';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';
import { Wrapper } from '../../_support/agent-panel';

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

const mount = (node: React.ReactElement) => render(node, { wrapper: Wrapper });

const emptyModels = () =>
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;

function reset(): void {
  backing.clear();
  useEditorStore.setState({ locale: 'en' });
  useAgentConnection.setState({
    provider: 'claude', model: emptyModels(), oversight: 'checkpoint',
    customBaseUrl: '', keyed: [], providerPinned: false, hydrated: true,
  });
  for (const id of PROVIDER_IDS) useAgentConnection.getState().forgetKey(id);
  useAgentConnection.setState({ provider: 'claude', providerPinned: false, customBaseUrl: '' });
  backing.clear();
}

/** The nearest ancestor carrying the wrapper class, where the ring lands. */
function ringBox(input: HTMLElement): HTMLElement {
  const box = input.closest(`.${FIELD_WRAP_CLASS}`);
  if (!(box instanceof HTMLElement)) throw new Error('no ring box above this field');
  return box;
}

/** Both halves of the pair, and a radius for the outline to follow. */
function ringedAsItsBox(testId: string): void {
  const input = screen.getByTestId(testId);
  expect(input.classList.contains(FIELD_INPUT_CLASS), `${testId} keeps its own rectangular ring`).toBe(true);
  const box = ringBox(input);
  expect(box.style.borderRadius, `${testId}'s ring box has no corner to follow`).not.toBe('');
}

afterEach(cleanup);

describe('every text field is ringed as its own rounded box', () => {
  const pending = () => new Promise<never>(() => {});

  it('the key field', () => {
    reset();
    mount(<SetupScreen listModels={pending} />);
    ringedAsItsBox('setup-key-input');
  });

  it('the connection screen\'s address field', () => {
    reset();
    mount(<SetupScreen listModels={pending} entry="endpoint" />);
    ringedAsItsBox('setup-endpoint-input');
  });

  it('the manage card\'s address field', async () => {
    reset();
    useAgentConnection.getState().setCustomBaseUrl('https://gw.example/v1');
    useAgentConnection.getState().pinProvider('custom');
    useAgentConnection.getState().connectKey('custom', 'sk-9f2c0123456789abcdef0123456789ab');
    await act(async () => { mount(<ManageScreen jobCount={0} listModels={pending} />); });
    ringedAsItsBox('manage-endpoint-input');
  });

  it('the manage card\'s typed model id', async () => {
    reset();
    useAgentConnection.getState().connectKey('claude', 'sk-ant-api03-abcdefghijkl');
    await act(async () => { mount(<ManageScreen jobCount={0} listModels={() => Promise.resolve([])} />); });
    fireEvent.click(screen.getByTestId('manage-model-dd'));
    ringedAsItsBox('manage-model-input');
  });

  it('the composer, whose ring box is the well itself', () => {
    reset();
    mount(
      <Composer route="order" running={false} onSend={vi.fn()} onStop={vi.fn()} onDropSuggestion={vi.fn()} />,
    );
    const input = screen.getByTestId('composer-input');
    expect(input.classList.contains(FIELD_INPUT_CLASS)).toBe(true);
    expect(ringBox(input).dataset.testid, 'the well is the shape a reader sees').toBe('composer-well');
    expect(ringBox(input).style.borderRadius).toBe(`${PILL_RADIUS}px`);
  });
});

/** How far a corner of radius `r` cuts in at `y` px below the top edge: `r - sqrt(r² - (r - y)²)`. */
function cornerInsetAt(radius: number, y: number): number {
  if (y >= radius) return 0;
  return radius - Math.sqrt(radius * radius - (radius - y) * (radius - y));
}

describe('the composer\'s text stays inside the pill it is written in', () => {
  /** The corner stays at half the resting height, so the inset the lead-in clears is constant. jsdom
   *  lays nothing out, so the field's height is supplied through `scrollHeight`. */
  it('holds the corner at half the resting height while the field grows', () => {
    reset();
    mount(
      <Composer route="order" running={false} onSend={vi.fn()} onStop={vi.fn()} onDropSuggestion={vi.fn()} />,
    );
    const resting = Number.parseFloat(screen.getByTestId('composer-well').style.minHeight);
    expect(screen.getByTestId('composer-well').style.borderRadius).toBe(`${resting / 2}px`);

    const field = screen.getByTestId('composer-input');
    const line = Number.parseFloat(field.style.fontSize) * Number(field.style.lineHeight);
    const own = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
    Object.defineProperty(Element.prototype, 'scrollHeight', {
      configurable: true,
      get(this: Element) { return this.tagName === 'TEXTAREA' ? line * FIELD_MAX_LINES : 0; },
    });
    try {
      fireEvent.change(field, { target: { value: 'an order long enough to fill the field' } });
    } finally {
      if (own) Object.defineProperty(Element.prototype, 'scrollHeight', own);
    }
    expect(field.style.height).toBe(`${Math.ceil(line * FIELD_MAX_LINES)}px`);
    expect(screen.getByTestId('composer-well').style.borderRadius).toBe(`${resting / 2}px`);
  });

  // The topmost text pixel is `WELL_PAD` below the top edge.
  it('covers the corner with the field\'s lead-in, at every height the well reaches', () => {
    expect(cornerInsetAt(PILL_RADIUS, WELL_PAD)).toBeLessThanOrEqual(WELL_LEAD_IN);
  });
});
