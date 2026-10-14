// @vitest-environment jsdom
/**
 * Every text field is ringed as the shape it is drawn as, and the composer's text never leaves its
 * pill. An outline follows its own element's radius, so the ring moves from the bare input to the
 * rounded wrapper through `design/focus-source.ts`'s pair (`FIELD_WRAP_CLASS` on the box with the
 * radius, `FIELD_INPUT_CLASS` on the focused input); a wrapper without its input rings twice, an
 * input without its wrapper not at all. jsdom resolves no `:has()`, so this checks the classes and
 * the radius; the pixels are the fidelity rig's.
 *
 * The composer's corner is held at half the resting height rather than half the live height, so the
 * inset its lead-in must clear stays constant as the well grows past two lines.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { SetupScreen } from '../../../ui/agent/connection/SetupScreen';
import { ManageScreen } from '../../../ui/agent/connection/ManageScreen';
import {
  Composer, COMPOSER_HEIGHT, PILL_RADIUS, WELL_LEAD_IN, WELL_PAD,
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

/** The element the ring is supposed to land on: the nearest ancestor carrying the wrapper class. */
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

/**
 * The corner the text has to clear.
 *
 * A rounded corner of radius `r` cuts inward at every height above `r`: at `y` px from the top edge
 * the shape's own left boundary stands at `r - sqrt(r² - (r - y)²)`. The topmost text pixel in the
 * well is `WELL_PAD` down, so that is the height the lead-in has to cover.
 */
function cornerInsetAt(radius: number, y: number): number {
  if (y >= radius) return 0;
  return radius - Math.sqrt(radius * radius - (radius - y) * (radius - y));
}

describe('the composer\'s text stays inside the pill it is written in', () => {
  it('holds the corner at half the RESTING height, so it cannot grow with the box', () => {
    expect(PILL_RADIUS).toBe(COMPOSER_HEIGHT / 2);
  });

  it('covers the corner with the field\'s lead-in, at every height the well reaches', () => {
    expect(cornerInsetAt(PILL_RADIUS, WELL_PAD)).toBeLessThanOrEqual(WELL_LEAD_IN);
  });

  /** The defect, stated: a corner that tracks the box's height outgrows the lead-in as soon as the
   *  field takes a second line, and the opening characters of the first one are drawn outside it. */
  it('would not cover it if the corner tracked the box\'s height', () => {
    const twoLines = COMPOSER_HEIGHT * 2;
    expect(cornerInsetAt(twoLines / 2, WELL_PAD)).toBeGreaterThan(WELL_LEAD_IN);
  });
});
