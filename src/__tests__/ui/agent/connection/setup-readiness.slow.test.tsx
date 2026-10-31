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
 *  `readKeyShape`. The gateway key is a bare `sk-<32hex>`, the shape DeepSeek and every
 *  self-hosted gateway share. */
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
  // The keyring is a module global; the store's own verb is the only way to empty it.
  for (const id of PROVIDER_IDS) store().forgetKey(id);
  useAgentConnection.setState({ provider: 'claude', providerPinned: false, customBaseUrl: '' });
  backing.clear();
});

/** A fetch stub rather than an injected prop, because `PanelShell` mounts the connection surfaces
 *  itself and their requests go through the real adapter. It answers an empty catalogue. */
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

/** Lets an adapter request land: the module is imported dynamically, so the answer takes macrotasks. */
const settle = async () => {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); });
  }
};


/** The panel at rest. */
const IDLE_VIEW: PanelView = {
  phase: 'idle', jobs: [], queuedSteers: [],
  vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 }, suggestion: null, lastEventAt: 0,
};
const VERBS = { onSend: () => {}, onStop: () => {}, onPause: () => {}, onGateAnswer: () => {} };

/** The settings card arms `custom` with no address; the panel drops back to the connection screen
 *  and the gateway key goes in. The walk ends asking for the address, never at idle, or the key
 *  would be filed against a server nobody named. */
describe('the walk must not reach idle with no endpoint and no model', () => {
  it('arms custom from the settings card with no address behind it', () => {
    store().connectKey('claude', KEY.claude);
    store().setModel('claude-sonnet-4-5');
    renderWithI18n(<ManageScreen jobCount={0} listModels={() => Promise.resolve([])} />);

    fireEvent.click(screen.getByTestId('manage-prov-row'));
    fireEvent.click(screen.getByText(PROVIDER_META.custom.name));

    // A pinned provider with no address.
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

    // Nothing is filed and no host is asked.
    expect(phaseOf(), 'the quiet must not commit a server nobody named').toBe('key');
    expect(listModels).not.toHaveBeenCalled();
    expect(store().keyed).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();

    // The step asks for the address as its own action; the key stays in the field.
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

  /** Setup has no step for an endpoint that lists no model; the flow routes by itself to the settings
   *  card, whose model row takes a typed id. */
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

interface Row {
  /** The case, as the table reads it. */
  name: string;
  /** The store before the screen mounts: a previous session, a pick made elsewhere. */
  before?: () => void;
  list?: () => Promise<string[]>;
  /** The events, in order. */
  drive: () => Promise<void> | void;
  /** What stands at the end: the phase, the step reported to the desk, and the step's foot control. */
  face: { phase: string; step: string | null; control: string };
  /** Whether the walk left setup, stayed, or handed over to the manage card. */
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
/** Picks a provider by its menu entry; a plain text query would also find the closed row's label. */
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
    // A custom connection ends on the manage card, which owns the address and the model.
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
    // The settings card's model row owns this state, so the flow routes there owing the model.
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
    // An unavailable list proves nothing about generation, so the card still takes a typed model.
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
    // The armed provider survives a page load and the pin does not. Read off its shape alone, a
    // gateway key would go to whichever platform its format matched and the address would never be asked.
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
    // With an address filed the key's shape is read again, so a platform key can still be pasted.
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
    // Stepping back off a pick does not re-read the key's shape, so the desk reports typing.
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
        // At most the model is owed, which the card's own row takes, so the screens cannot ping-pong.
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

  /** A reload can leave a sealed key with no model filed, which no walk through the screen produces. */
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

  /** The panel swaps the form for the card with no press, the card takes the typed id, and its Done
   *  gives the session back. */
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

    // The form checks the endpoint by itself; an empty catalogue leaves the model owed and routes to
    // the card.
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

/** A seeded generator, so a failing walk reproduces. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every move the screen offers at this moment; the walk takes nothing else, so a stuck state is real. */
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
  // Opening the row and picking an entry stay two moves, so the state between them is checked too.
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

/** Claims on screen that the store contradicts. */
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
 * Each run picks its gateway answers and starting store, then walks the offered moves one at a time,
 * checking after each: (a) idle is reached only with nothing missing, (b) every face offers a live
 * control, (c) every claim on screen matches the store.
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

  // The whole sweep is one long test, so it carries its own timeout.
  it('never leaves for idle unready, never strands, never lies', async () => {
    /** The faces the walk stood on; coverage is asserted at the end. */
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

    // Coverage: all three steps, a hand-off to the card, a dead end, a way back, a finished walk.
    for (const face of ['phase:key', 'phase:custom', 'phase:manage', 'manage-done', 'managed',
      'setup-act-address', 'setup-row-cross', 'setup-leave', 'left']) {
      expect([...visited], `the sweep never reached ${face}`).toContain(face);
    }
  }, 60_000);
});
