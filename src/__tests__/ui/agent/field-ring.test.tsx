/**
 * field-ring.test.tsx — EVERY TEXT FIELD IS RINGED AS THE SHAPE IT IS DRAWN AS, and the composer's
 * text never leaves the pill it is written in.
 *
 * An outline follows its OWN element's `border-radius`. Every field in this panel is a rounded
 * wrapper with a bare input laid inside it, so the house focus ring landed on the input and was drawn
 * as a rectangle within the rounded box, corners and all. `design/focus-source.ts` names the pair
 * that moves it up (`FIELD_WRAP_CLASS` on the box that has the radius, `FIELD_INPUT_CLASS` on the
 * input that has the focus) and this file holds every field to it, both halves: a wrapper marked
 * without its input rings twice, an input marked without its wrapper rings not at all.
 *
 * WHAT THIS CANNOT SEE is the ring itself: jsdom paints nothing and resolves no `:has()`, so what is
 * checkable is that the two classes sit on the two right elements and that the box they name carries
 * a radius for the outline to follow. The pixels are the fidelity rig's.
 *
 * THE COMPOSER'S CORNER IS ARITHMETIC, for the same reason. A pill radius is half the box's height,
 * so a well that grows grows its corners with it, and past two lines the arc reached further in than
 * the field's lead-in: the first line's opening characters were drawn outside the rounded shape. The
 * corner is held at half the RESTING height instead, which makes the inset the lead-in has to cover
 * a constant — and that constant is what is asserted, against the height-proportional radius that
 * would not clear it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { SetupScreen } from '../../../ui/agent/SetupScreen';
import { ManageScreen } from '../../../ui/agent/ManageScreen';
import {
  Composer, COMPOSER_HEIGHT, PILL_RADIUS, WELL_LEAD_IN, WELL_PAD,
} from '../../../ui/agent/Composer';
import { useAgentPanelSettings } from '../../../ui/agent/settings';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../../../ui/design/focus-source';
import { PROVIDER_IDS, type ProviderId } from '../../../agent/providers/defaults';

const backing = new Map<string, string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="always">
      <I18nProvider>{children}</I18nProvider>
    </MotionConfig>
  );
}
const mount = (node: React.ReactElement) => render(node, { wrapper: Wrapper });

const emptyModels = () =>
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;

function reset(): void {
  backing.clear();
  useEditorStore.setState({ locale: 'en' });
  useAgentPanelSettings.setState({
    provider: 'claude', model: emptyModels(), oversight: 'checkpoint',
    customBaseUrl: '', keyed: [], providerPinned: false, hydrated: true,
  });
  for (const id of PROVIDER_IDS) useAgentPanelSettings.getState().forgetKey(id);
  useAgentPanelSettings.setState({ provider: 'claude', providerPinned: false, customBaseUrl: '' });
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
    useAgentPanelSettings.getState().setCustomBaseUrl('https://gw.example/v1');
    useAgentPanelSettings.getState().pinProvider('custom');
    useAgentPanelSettings.getState().connectKey('custom', 'sk-9f2c0123456789abcdef0123456789ab');
    await act(async () => { mount(<ManageScreen jobCount={0} listModels={pending} />); });
    ringedAsItsBox('manage-endpoint-input');
  });

  it('the manage card\'s typed model id', async () => {
    reset();
    useAgentPanelSettings.getState().connectKey('claude', 'sk-ant-api03-abcdefghijkl');
    await act(async () => { mount(<ManageScreen jobCount={0} listModels={() => Promise.resolve([])} />); });
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
 * THE CORNER THE TEXT HAS TO CLEAR.
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
