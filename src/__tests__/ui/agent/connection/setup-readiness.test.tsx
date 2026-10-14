// @vitest-environment jsdom
/** Setup validates credentials; management owns every model choice and completion. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import { useEditorStore } from '../../../../state/store';
import { translations } from '../../../../i18n/translations';
import { SetupScreen } from '../../../../ui/agent/connection/SetupScreen';
import { ManageScreen } from '../../../../ui/agent/connection/ManageScreen';
import { PanelShell } from '../../../../ui/agent/PanelShell';
import { forgetRosters } from '../../../../agent/connection/model-roster';
import {
  connectionGaps, connectionReady, useAgentConnection, type AgentConnectionState,
} from '../../../../agent/connection/store';
import { PROVIDER_IDS, PROVIDER_META, type ProviderId } from '../../../../agent/providers/defaults';
import type { PanelView } from '../../../../agent/core/project-view';
import { panelProps, Wrapper } from '../../../_support/agent-panel';

const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
};

const renderWithI18n = (node: React.ReactElement) => render(node, { wrapper: Wrapper });

const emptyModels = () =>
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) as Record<ProviderId, string>;

/** A key of each shape the machine tells apart, so no test spells one inline and drifts from
 *  `readKeyShape`. The gateway key is the reported shape: a bare
 *  `sk-<32hex>`, the shape DeepSeek and every self-hosted gateway share. */
const KEY = {
  claude: 'sk-ant-api03-abcdefghijkl',
  gateway: 'sk-9f2c0123456789abcdef0123456789ab',
  perplexity: 'pplx-abcdef0123456789',
  unknown: 'my-gateway-token-2f8a91',
  partial: 'sk-9f2c0123',
};

const IDLE = 900;
const GATEWAY_URL = 'https://gateway.example/v1';

const store = () => useAgentConnection.getState();
const phaseOf = () => screen.queryByTestId('manage-screen') ? 'manage' : screen.getByTestId('setup-screen').getAttribute('data-phase');
const pickDefault = () => {
  press('manage-model-dd');
  fireEvent.click(screen.getAllByRole('menuitemradio')[0]!);
};
const has = (id: string) => screen.queryByTestId(id) !== null;

beforeEach(() => {
  backing.clear();
  forgetRosters();
  useEditorStore.setState({ locale: 'en' });
  useAgentConnection.setState({
    provider: 'claude', model: emptyModels(), oversight: 'checkpoint',
    customBaseUrl: '', keyed: [], providerPinned: false, hydrated: true,
  });
  // The keyring is a module global and no test may inherit another's key: the store's own verb is
  // the only way in or out of it.
  for (const id of PROVIDER_IDS) store().forgetKey(id);
  useAgentConnection.setState({ provider: 'claude', providerPinned: false, customBaseUrl: '' });
  backing.clear();
});

/**
 * Nothing here reaches the network, and the two panel-level cases are why this is a stub rather than
 * an injected prop: `PanelShell` mounts both connection surfaces itself, so the request they make on
 * a mount over a half-made connection is the real adapter's. It answers an empty catalogue, which is
 * the gateway case those cases are about.
 */
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (() => Promise.resolve(new Response(
    JSON.stringify({ object: 'list', data: [] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ))) as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
});

/** Lets a request that reaches an adapter land: the module is imported dynamically, so the answer is
 *  two macrotasks away rather than one microtask. */
const settle = async () => {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); });
  }
};


/** The panel at rest, for the two assertions that are about the panel's own choice of surface. */
const IDLE_VIEW: PanelView = {
  phase: 'idle', jobs: [], queuedSteers: [],
  vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 }, suggestion: null, lastEventAt: 0,
};
const VERBS = { onSend: () => {}, onStop: () => {}, onPause: () => {}, onGateAnswer: () => {} };

/* ── the custom-provider walk ──────────────────────────────── */

/**
 * The walk, end to end. The settings card's provider row names `custom`, which arms a
 * provider with no address anywhere behind it; the panel drops back to the connection screen; the
 * gateway key goes in. The walk must end at the connection screen asking for the address, never at
 * idle: a pin read as the answer files the key against a server nobody has named, sends the model
 * request to whatever host the SDK defaults to, and offers Done over three quarters of a connection.
 */
describe('the walk must not reach idle with no endpoint and no model', () => {
  it('arms custom from the settings card with no address behind it', () => {
    store().connectKey('claude', KEY.claude);
    store().setModel('claude-sonnet-4-5');
    renderWithI18n(<ManageScreen jobCount={0} listModels={() => Promise.resolve([])} />);

    fireEvent.click(screen.getByTestId('manage-prov-row'));
    fireEvent.click(screen.getByText(PROVIDER_META.custom.name));

    // The trap: a pinned provider whose address is nowhere on this card.
    expect(store().provider).toBe('custom');
    expect(store().providerPinned).toBe(true);
    expect(store().customBaseUrl).toBe('');
    expect(connectionGaps(store())).toEqual(['key', 'endpoint', 'model']);
  });

  it('asks the gateway for its address instead of filing the key against no server', async () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const listModels = vi.fn(() => Promise.resolve<string[]>([]));
    store().pinProvider('custom');
    renderWithI18n(<SetupScreen listModels={listModels} onDone={onDone} onLeave={() => {}} />);

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.gateway } });
    await act(async () => { vi.advanceTimersByTime(IDLE * 4); });

    // Nothing was filed and nothing was asked. There was no host to ask, and the key is still the
    // user's to place.
    expect(phaseOf(), 'the quiet must not commit a server nobody named').toBe('key');
    expect(listModels).not.toHaveBeenCalled();
    expect(store().keyed).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();

    // And the step says so, with the address as its own verb. The key stays in the field.
    expect(screen.getByTestId('setup-note').textContent).toBe(translations.en['agent.setup_say_custom']);
    expect(screen.getByTestId('setup-act-address').textContent).toBe(translations.en['agent.setup_give_address']);
    expect(screen.getByTestId('setup-prov-sub').textContent).toBe(translations.en['agent.setup_row_pinned']);
    expect((screen.getByTestId('setup-key-input') as HTMLInputElement).value).toBe(KEY.gateway);
  });

  it('finishes the same walk once the address is given', async () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const listModels = vi.fn(() => Promise.resolve(['qwen3:32b']));
    store().pinProvider('custom');
    renderWithI18n(<SetupScreen listModels={listModels} onDone={onDone} />);

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.gateway } });
    fireEvent.click(screen.getByTestId('setup-act-address'));
    expect(phaseOf()).toBe('custom');
    fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: GATEWAY_URL } });
    fireEvent.click(screen.getByTestId('setup-endpoint-save'));
    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });

    expect(listModels).toHaveBeenCalledWith({ provider: 'custom', apiKey: KEY.gateway, customBaseUrl: GATEWAY_URL });
    expect(phaseOf()).toBe('manage');
    expect(connectionReady(store())).toBe(false);
    pickDefault();
    fireEvent.click(screen.getByTestId('manage-done'));
    expect(connectionReady(store())).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  /** And the gateway that names nothing goes to the card that takes a typed ID, by itself: setup
   *  keeps no dead-end step for a listless endpoint, so the flow routes to the card whose model row
   *  already handles the state, with no press in between and no way out to idle. */
  it('hands a gateway that lists no model to the settings card, and never to idle', async () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const onManage = vi.fn();
    store().setCustomBaseUrl(GATEWAY_URL);
    store().pinProvider('custom');
    renderWithI18n(
      <SetupScreen
        listModels={() => Promise.resolve<string[]>([])}
        onDone={onDone}
        onManage={onManage}
      />,
    );

    fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value: KEY.gateway } });
    await act(async () => { vi.advanceTimersByTime(IDLE + 50); });
    await act(async () => {});

    expect(phaseOf()).toBe('manage');
    expect(store().model.custom).toBe('');
    expect(has('setup-done'), 'no way out into a panel with no model').toBe(false);
    expect(has('setup-models-unavailable'), 'no dead-end note').toBe(false);
    expect(has('setup-need-model'), 'no dead-end control').toBe(false);
    expect(onManage).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});

/* ── the traversal, as a table ─────────────────────────────── */

interface Row {
  /** The case, as the table reads it. */
  name: string;
  /** The store before the screen mounts: a previous session, a pick made elsewhere. */
  before?: () => void;
  list?: () => Promise<string[]>;
  /** The events, in order. */
  drive: () => Promise<void> | void;
  /** The face that must be standing at the end: the phase, the step reported to the desk, and the
   *  one foot control the step offers. */
  face: { phase: string; step: string | null; control: string };
  /** Whether the walk may have left setup, and what must be true of the connection if it did. */
  exit: 'left' | 'stayed' | 'manage';
}

const type = (value: string) => {
  fireEvent.change(screen.getByTestId('setup-key-input'), { target: { value } });
};
const enter = async () => {
  await act(async () => { fireEvent.keyDown(screen.getByTestId('setup-key-input'), { key: 'Enter' }); });
};
const quiet = async (times = 1) => {
  await act(async () => { vi.advanceTimersByTime(IDLE * times + 50); });
};
const press = (id: string) => { fireEvent.click(screen.getByTestId(id)); };
/** The chooser, by the entry's own row: the label also stands on the face of the closed row, so a
 *  plain text query finds two of it the moment the key's shape names the same platform. */
const pick = (label: string) => {
  // The row toggles, so a press on an already-open one puts the list away.
  if (screen.getByTestId('setup-prov-row').getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(screen.getByTestId('setup-prov-row'));
  }
  const entry = screen.getAllByRole('menuitemradio').find((el) => el.textContent?.startsWith(label));
  if (!entry) throw new Error(`no roster entry for ${label}`);
  fireEvent.click(entry);
};
const address = (url: string) => {
  fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: url } });
  press('setup-endpoint-save');
};

const LISTS = {
  named: () => Promise.resolve(['qwen3:32b', 'llama3.2']),
  empty: () => Promise.resolve<string[]>([]),
  unreachable: () => Promise.reject(new Error('Failed to fetch')),
  refused: () => Promise.reject(Object.assign(new Error('Unauthorized'), { status: 401 })),
};

const ROWS: Row[] = [
  {
    name: 'a named provider, typed, listing its models',
    list: LISTS.named,
    drive: async () => { type(KEY.claude); await quiet(); },
    face: { phase: 'manage', step: null, control: 'manage-done' },
    exit: 'manage',
  },
  {
    name: 'a named provider, released by Enter rather than by the quiet',
    list: LISTS.named,
    drive: async () => { type(KEY.claude); await enter(); },
    face: { phase: 'manage', step: null, control: 'manage-done' },
    exit: 'manage',
  },
  {
    name: 'the tenth provider\'s own prefix',
    list: LISTS.named,
    drive: async () => { type(KEY.perplexity); await quiet(); },
    face: { phase: 'manage', step: null, control: 'manage-done' },
    exit: 'manage',
  },
  {
    name: 'a key still being typed',
    drive: () => { type(KEY.partial); },
    face: { phase: 'key', step: 'typing', control: 'setup-leave' },
    exit: 'stayed',
  },
  {
    name: 'a shape nobody claims: the quiet asks',
    drive: async () => { type(KEY.unknown); await quiet(); },
    face: { phase: 'key', step: 'unknown', control: 'setup-act-reenter' },
    exit: 'stayed',
  },
  {
    name: 'an ambiguous key awaiting provider selection',
    drive: async () => { type(KEY.gateway); await enter(); },
    face: { phase: 'key', step: 'unknown', control: 'setup-act-reenter' },
    exit: 'stayed',
  },
  {
    name: 'an ambiguous key explicitly assigned to DeepSeek',
    list: LISTS.named,
    drive: async () => { type(KEY.gateway); await enter(); await act(async () => { fireEvent.click(screen.getByText(PROVIDER_META.deepseek.name)); }); },
    face: { phase: 'manage', step: null, control: 'manage-done' },
    exit: 'manage',
  },
  {
    name: 'a key the provider refuses',
    list: LISTS.refused,
    drive: async () => { type(KEY.claude); await enter(); },
    face: { phase: 'key', step: 'refused', control: 'setup-act-recheck' },
    exit: 'stayed',
  },
  {
    // The custom journey's end is the manage card, never a confirmation of its own: the address and
    // the model are both that card's, and a step reporting a model beside a provider name is read as
    // the step that chose it.
    name: 'the endpoint filed, then listing: the card takes over',
    list: LISTS.named,
    drive: async () => {
      type(KEY.unknown);
      pick(translations.en['agent.setup_custom_endpoint']!);
      address(GATEWAY_URL);
      await quiet();
    },
    face: { phase: 'manage', step: null, control: 'manage-done' },
    exit: 'manage',
  },
  {
    name: 'a custom endpoint explicitly configured without authentication',
    list: LISTS.named,
    drive: async () => {
      pick(translations.en['agent.setup_custom_endpoint']!);
      address(GATEWAY_URL);
      await quiet();
    },
    face: { phase: 'manage', step: null, control: 'manage-done' },
    exit: 'manage',
  },
  {
    name: 'an unauthenticated custom endpoint that requires a key',
    list: LISTS.refused,
    drive: async () => {
      pick(translations.en['agent.setup_custom_endpoint']!);
      address(GATEWAY_URL);
      await quiet();
    },
    face: { phase: 'key', step: 'refused', control: 'setup-act-recheck' },
    exit: 'stayed',
  },
  {
    // Naming nothing is not a step: the model row on the settings card owns that state, so the flow
    // routes there with the model as the one thing owed.
    name: 'the endpoint filed, naming nothing',
    list: LISTS.empty,
    drive: async () => {
      type(KEY.unknown);
      pick(translations.en['agent.setup_custom_endpoint']!);
      address(GATEWAY_URL);
      await quiet();
    },
    face: { phase: 'manage', step: null, control: 'manage-done' },
    exit: 'manage',
  },
  {
    // A check nothing answered still hands the connection to the card: an unavailable list proves
    // nothing about generation, so the model stays enterable by hand.
    name: 'the endpoint filed, unreachable',
    list: LISTS.unreachable,
    drive: async () => {
      type(KEY.unknown);
      pick(translations.en['agent.setup_custom_endpoint']!);
      address(GATEWAY_URL);
      await quiet();
    },
    face: { phase: 'manage', step: null, control: 'manage-done' },
    exit: 'manage',
  },
  {
    name: 'an address the app cannot use, refused in place',
    drive: () => {
      type(KEY.unknown);
      pick(translations.en['agent.setup_custom_endpoint']!);
      address('https://[');
    },
    face: { phase: 'custom', step: 'endpoint', control: 'setup-act-reenter' },
    exit: 'stayed',
  },
  {
    name: 'custom armed elsewhere, no address anywhere',
    before: () => { store().pinProvider('custom'); },
    drive: async () => { type(KEY.gateway); await quiet(2); },
    face: { phase: 'key', step: 'endpoint', control: 'setup-act-address' },
    exit: 'stayed',
  },
  {
    name: 'custom armed elsewhere with an address already filed',
    before: () => { store().setCustomBaseUrl(GATEWAY_URL); store().pinProvider('custom'); },
    list: LISTS.named,
    drive: async () => { type(KEY.gateway); await quiet(); },
    face: { phase: 'manage', step: null, control: 'manage-done' },
    exit: 'manage',
  },
  {
    // The pin does not survive a page load and the armed provider does. Read off the shape alone, the
    // typed gateway key went to whichever platform its format matched (or to a probe of platforms
    // that never held it) and the address was never asked for at all.
    name: 'a session that comes back armed on custom, with the pin gone and no address',
    before: () => {
      store().pinProvider('custom');
      useAgentConnection.setState({ providerPinned: false });
    },
    drive: async () => { type(KEY.gateway); await quiet(2); },
    face: { phase: 'key', step: 'endpoint', control: 'setup-act-address' },
    exit: 'stayed',
  },
  {
    // And the same session with an address filed reads the key again, which is what keeps a user on a
    // configured gateway from being unable to paste a platform's key: the address is the standing
    // question, and it has an answer.
    name: 'a session that comes back armed on custom with its address, pin gone',
    before: () => {
      store().setCustomBaseUrl(GATEWAY_URL);
      store().pinProvider('custom');
      useAgentConnection.setState({ providerPinned: false });
    },
    list: LISTS.named,
    drive: async () => { type(KEY.claude); await quiet(); },
    face: { phase: 'manage', step: null, control: 'manage-done' },
    exit: 'manage',
  },
  {
    name: 'Back at the waiting step: the reading stops, the key stays',
    drive: async () => { type(KEY.claude); press('setup-act-reenter'); await quiet(2); },
    face: { phase: 'key', step: 'shaped', control: 'setup-leave' },
    exit: 'stayed',
  },
  {
    // The key stands where it was and the reading is off: stepping back off a pick is not the shape
    // being read again, so the desk says the field is being typed into rather than that anyone is
    // being asked.
    name: 'Back off the endpoint step',
    drive: () => {
      type(KEY.unknown);
      pick(translations.en['agent.setup_custom_endpoint']!);
      press('setup-act-reenter');
    },
    face: { phase: 'key', step: 'typing', control: 'setup-leave' },
    exit: 'stayed',
  },
  {
    name: 'a provider picked by hand, keyed and modelled already: the walk is over',
    before: () => {
      store().connectKey('claude', KEY.claude);
      store().setModel('claude-sonnet-4-5');
      store().pinProvider('openai');
    },
    drive: () => { pick(PROVIDER_META.claude.name); },
    face: { phase: '', step: '', control: '' },
    exit: 'manage',
  },
  {
    name: 'a session that comes back holding a key and no model',
    before: () => { store().connectKey('claude', KEY.claude); },
    list: LISTS.named,
    drive: async () => { await act(async () => {}); },
    face: { phase: 'manage', step: null, control: 'manage-done' },
    exit: 'manage',
  },
  {
    name: 'a session that comes back holding a key against a server it cannot name',
    before: () => {
      store().pinProvider('custom');
      store().connectKey('custom', KEY.gateway);
      store().setModel('qwen3:32b');
    },
    drive: async () => { await act(async () => {}); },
    face: { phase: 'custom', step: 'endpoint', control: 'setup-endpoint-save' },
    exit: 'stayed',
  },
];

describe('every case the machine can be in', () => {
  for (const row of ROWS) {
    it(row.name, async () => {
      vi.useFakeTimers();
      const onDone = vi.fn();
      const onManage = vi.fn();
      row.before?.();
      const seen: (string | null)[] = [];
      renderWithI18n(
        <SetupScreen
          listModels={row.list ?? LISTS.named}
          onDone={onDone}
          onLeave={() => {}}
          onManage={onManage}
          onFace={(face) => { seen.push(face?.step ?? null); }}
        />,
      );
      await row.drive();
      await act(async () => {});

      if (row.exit === 'left') {
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(connectionReady(store()), 'a door out of setup leaves a connection that works').toBe(true);
        return;
      }
      expect(onDone, 'this walk has not finished the connection').not.toHaveBeenCalled();
      if (row.exit === 'manage') {
        expect(onManage, 'a custom connection is reviewed on the card, not confirmed here').toHaveBeenCalled();
        // The hand-off leaves nothing the card cannot repair: at most the model, which its own row
        // takes as a typed id, so the two screens cannot pass the panel back and forth.
        const owed = connectionGaps(store());
        expect(owed.every((gap) => gap === 'model'), `handed over owing ${owed.join('+')}`).toBe(true);
        expect(screen.queryByTestId('manage-screen'), 'the parent mounts management once').toBeNull();
        return;
      } else {
        expect(onManage, 'nothing handed the panel over').not.toHaveBeenCalled();
      }
      if (!row.face.phase) return;
      expect(phaseOf()).toBe(row.face.phase);
      expect(seen[seen.length - 1], 'the desk describes the screen that is standing').toBe(row.face.step);
      expect(has(row.face.control), `the step's own control: ${row.face.control}`).toBe(true);
    });
  }
});

/* ── no door out lands on a panel that cannot carry an order ── */

describe('the exits', () => {
  it('keeps management open until the user chooses a model', async () => {
    const onDone = vi.fn();
    const onLeave = vi.fn();
    renderWithI18n(<SetupScreen listModels={LISTS.named} onDone={onDone} onLeave={onLeave} />);
    expect(has('setup-leave')).toBe(true);
    type(KEY.claude);
    await enter();
    expect(phaseOf()).toBe('manage');
    expect(connectionReady(store())).toBe(false);
    expect(has('setup-leave')).toBe(false);
    expect((screen.getByTestId('manage-done') as HTMLButtonElement).disabled).toBe(true);
    press('manage-done');
    expect(onDone).not.toHaveBeenCalled();
    expect(onLeave).not.toHaveBeenCalled();
    pickDefault();
    expect(connectionReady(store())).toBe(true);
    press('manage-done');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('keeps the key editable while checking and opens management when the list arrives', async () => {
    let settle: (ids: string[]) => void = () => {};
    const onDone = vi.fn();
    renderWithI18n(<SetupScreen
      listModels={() => new Promise<string[]>((resolve) => { settle = resolve; })} onDone={onDone} />);
    type(KEY.claude);
    await enter();
    expect(phaseOf()).toBe('checking');
    expect(has('setup-key-input')).toBe(true);
    expect(has('setup-act-reenter')).toBe(true);
    expect(has('setup-done')).toBe(false);
    await act(async () => { settle(['claude-sonnet-4-5']); });
    expect(phaseOf()).toBe('manage');
    expect((screen.getByTestId('manage-done') as HTMLButtonElement).disabled).toBe(true);
    pickDefault();
    press('manage-done');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  /** The panel asks the same question, and this is the state no walk through the screen can produce
   *  but a reload can: the key is sealed in the vault and the model was never filed. */
  it('puts the connection screen up over a panel that holds half a connection', () => {
    store().connectKey('claude', KEY.claude);

    const half = renderWithI18n(<PanelShell {...panelProps({ view: IDLE_VIEW, connected: true, ready: false, now: 0, ...VERBS })} />);
    expect(screen.queryByTestId('setup-screen'), 'no model: the panel is not idle, it is unable').toBeTruthy();
    expect(screen.queryByTestId('composer')).toBeNull();
    half.unmount();

    store().setModel('claude-sonnet-4-5');
    renderWithI18n(<PanelShell {...panelProps({ view: IDLE_VIEW, connected: true, ready: true, now: 0, ...VERBS })} />);
    expect(screen.queryByTestId('setup-screen')).toBeNull();
    expect(screen.queryByTestId('composer')).toBeTruthy();
  });

  /**
   * And the hand-off lands, which is the other half of the report: the words pointed at the settings
   * card and no press did. The panel takes the form down for the card, the card takes the typed id,
   * and its Done gives the session back — the connection screen returning only while something is
   * still owed.
   */
  it('hands the panel to the settings card and takes it back once the model stands', async () => {
    store().setCustomBaseUrl(GATEWAY_URL);
    store().pinProvider('custom');
    store().connectKey('custom', KEY.gateway);

    function Panel() {
      const ready = connectionReady(useAgentConnection());
      return (
        <PanelShell {...panelProps({
          view: IDLE_VIEW,
          connected: true,
          ready,
          now: 0,
          ...VERBS,
        })}
        />
      );
    }
    renderWithI18n(<Panel />);

    // The form stood up by itself over the half-made connection and asked the endpoint what it
    // runs: an empty catalogue leaves the model as the one thing owed, which routes the panel to the
    // card that takes a typed id — no press in between.
    expect(screen.getByTestId('setup-screen').getAttribute('data-phase')).toBe('checking');
    await settle();
    expect(screen.queryByTestId('setup-screen'), 'the card has the zone now').toBeNull();
    expect(screen.getByTestId('manage-screen')).toBeTruthy();

    press('manage-model-dd');
    fireEvent.change(screen.getByTestId('manage-model-input'), { target: { value: 'qwen3:32b' } });
    fireEvent.keyDown(screen.getByTestId('manage-model-input'), { key: 'Enter' });
    expect(store().model.custom).toBe('qwen3:32b');
    await act(async () => { press('manage-done'); });

    expect(screen.queryByTestId('manage-screen')).toBeNull();
    expect(screen.queryByTestId('setup-screen'), 'nothing is owed, so nothing stands in the way').toBeNull();
    expect(screen.getByTestId('composer')).toBeTruthy();
  });
});

/* ── the sweep ─────────────────────────────────────────────── */

/** A seeded generator, so a failing walk is a failing walk every time it is run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every event a user has at a given moment, read off what is actually on screen: the walk only ever
 *  takes moves the screen offers, which is what makes a stuck state a stuck state. */
function moves(next: () => number): { name: string; run: () => void | Promise<void> }[] {
  const out: { name: string; run: () => void | Promise<void> }[] = [];
  const keys = [KEY.claude, KEY.gateway, KEY.unknown, KEY.perplexity, KEY.partial, ''];
  if (has('setup-key-input')) {
    const value = keys[Math.floor(next() * keys.length)] ?? '';
    out.push({ name: `type ${value.slice(0, 8)}`, run: () => { type(value); } });
    out.push({ name: 'enter', run: enter });
  }
  if (has('setup-endpoint-input')) {
    const url = next() < 0.3 ? 'https://[' : GATEWAY_URL;
    out.push({
      name: `address ${url}`,
      run: () => {
        fireEvent.change(screen.getByTestId('setup-endpoint-input'), { target: { value: url } });
        if (!(screen.getByTestId('setup-endpoint-save') as HTMLButtonElement).disabled) press('setup-endpoint-save');
      },
    });
  }
  // The row and the entry are two presses, and they stay two here: a walk that opened the list and
  // picked from it inside one event would be asserting nothing about the state in between.
  const row = screen.queryByTestId('setup-prov-row');
  if (row && row.getAttribute('aria-expanded') !== 'true') {
    out.push({ name: 'open the roster', run: () => { fireEvent.click(row); } });
  }
  const entries = screen.queryAllByRole('menuitemradio');
  if (entries.length > 0) {
    const entry = entries[Math.floor(next() * entries.length)]!;
    out.push({ name: `pick ${entry.textContent ?? ''}`, run: () => { fireEvent.click(entry); } });
  }
  for (const id of ['setup-act-recheck', 'setup-act-manual', 'setup-act-address', 'setup-act-reenter',
    'manage-model-dd', 'manage-done']) {
    const el = screen.queryByTestId(id) as HTMLButtonElement | null;
    if (el && !el.disabled) out.push({ name: `press ${id}`, run: () => { press(id); } });
  }
  out.push({ name: 'quiet', run: () => quiet() });
  return out;
}

/** Whatever the screen is claiming, checked against what is actually standing. Returns the lies. */
function lies(): string[] {
  const bad: string[] = [];
  const state: AgentConnectionState = store();
  const gaps = connectionGaps(state);
  const phase = phaseOf();
  const enabled = (id: string): boolean => {
    const el = screen.queryByTestId(id) as HTMLButtonElement | null;
    return el !== null && !el.disabled;
  };

  if (enabled('manage-done') && gaps.length > 0) bad.push(`Done offered with ${gaps.join('+')} missing`);
  if (has('setup-need-address') && !gaps.includes('endpoint')) bad.push('the address door over an address that stands');
  if (has('setup-act-address') && !gaps.includes('endpoint')) bad.push('the address verb over an address that stands');
  if (has('setup-leave') && !(gaps.length === 0 || gaps.includes('key'))) {
    bad.push(`Back offered over ${gaps.join('+')}`);
  }
  if (phase === 'manage' && gaps.includes('key')) bad.push('management with no key filed');

  const sub = screen.queryByTestId('setup-prov-sub')?.textContent ?? '';
  const claimsCheck = sub === translations.en['agent.setup_row_checking']
    || sub === translations.en['agent.setup_row_pinned_checking']
    || sub === translations.en['agent.setup_row_asking'];
  if (claimsCheck && !has('setup-row-spin')) bad.push(`the row says "${sub}" with no reading in flight`);

  // Setup reports the selected model but leaves model choice to the settings card.
  for (const id of ['setup-rechoose', 'setup-retry-list', 'setup-need-model', 'setup-models-unavailable', 'setup-open-roster']) {
    if (has(id)) bad.push(`${id} may not render in setup`);
  }

  return bad;
}

/**
 * The sweep. Each run picks its own gateway answers and its own starting store, then walks the moves
 * the screen offers, one at a time, asserting all three properties after every single one of them.
 *
 * (a) idle is unreachable without a ready connection — the door fired only with nothing missing.
 * (b) no stuck state — every face standing offers at least one live control.
 * (c) no face lies — every claim on screen matches what the store actually holds.
 */
describe('a sweep over event sequences', () => {
  const STARTS: (() => void)[] = [
    () => {},
    () => { store().pinProvider('custom'); },
    () => { store().setCustomBaseUrl(GATEWAY_URL); store().pinProvider('custom'); },
    () => { store().connectKey('claude', KEY.claude); },
    () => { store().connectKey('claude', KEY.claude); store().setModel('claude-sonnet-4-5'); },
  ];
  const RUNS = 40;
  const STEPS = 16;

  // A walk per run and an assertion per event: the whole sweep is one test, and it is a long one by
  // construction, so it carries its own ceiling rather than the suite's five seconds.
  it('never leaves for idle unready, never strands, never lies', async () => {
    /** Which faces the walk actually stood on. A sweep that reached three of them would pass while
     *  proving nothing, so the ground it covers is asserted at the end. */
    const visited = new Set<string>();
    for (let run = 0; run < RUNS; run += 1) {
      const next = rng(run * 7919 + 13);
      const start = STARTS[run % STARTS.length]!;
      next();
      const listNames = Object.keys(LISTS) as (keyof typeof LISTS)[];
      const listName = listNames[Math.floor(next() * listNames.length)]!;

      backing.clear();
      useAgentConnection.setState({
        provider: 'claude', model: emptyModels(), customBaseUrl: '',
        keyed: [], providerPinned: false, hydrated: true,
      });
      for (const id of PROVIDER_IDS) store().forgetKey(id);
      useAgentConnection.setState({ provider: 'claude', providerPinned: false, customBaseUrl: '' });
      start();

      vi.useFakeTimers();
      const onDone = vi.fn();
      const trail: string[] = [`start ${run % STARTS.length}, list ${listName}`];
      const view = renderWithI18n(
        <SetupScreen
          listModels={LISTS[listName]}
          onDone={onDone}
          onLeave={() => {}}
        />,
      );

      for (let step = 0; step < STEPS; step += 1) {
        const options = moves(next);
        const chosen = options[Math.floor(next() * options.length)]!;
        trail.push(chosen.name);
        const before = onDone.mock.calls.length;
        await act(async () => { await chosen.run(); });
        await act(async () => {});

        const where = `run ${run} [${trail.join(' → ')}]`;
        if (onDone.mock.calls.length > before) {
          expect(connectionReady(store()), `${where}: left setup with ${connectionGaps(store()).join('+')} missing`)
            .toBe(true);
          visited.add('left');
          break;
        }
        visited.add(`phase:${phaseOf() ?? ''}`);
        if (phaseOf() === 'manage') visited.add('managed');
        for (const id of ['manage-done', 'setup-act-address',
          'setup-act-recheck', 'setup-leave', 'setup-row-cross']) {
          if (has(id)) visited.add(id);
        }
        const live = [...screen.getByTestId(phaseOf() === 'manage' ? 'manage-screen' : 'setup-screen').querySelectorAll('button, input')]
          .filter((el) => !(el as HTMLButtonElement).disabled);
        expect(live.length, `${where}: nothing on this face can be pressed`).toBeGreaterThan(0);
        expect(lies(), `${where}`).toEqual([]);
      }

      view.unmount();
      vi.useRealTimers();
    }

    // The ground the sweep has to have covered for its silence to mean anything: all three steps, a
    // hand-off to the card, a dead end, a way back, and at least one walk that finished.
    for (const face of ['phase:key', 'phase:custom', 'phase:manage', 'manage-done', 'managed',
      'setup-act-address', 'setup-row-cross', 'setup-leave', 'left']) {
      expect([...visited], `the sweep never reached ${face}`).toContain(face);
    }
  }, 60_000);
});
