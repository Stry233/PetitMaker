// @vitest-environment jsdom
/**
 * The house dropdown: the panel never makes room for a menu. Closed it is a row; open, a card in a
 * body-level layer, because the frame's `zoom` and entrance fade would otherwise become the card's
 * containing block and stacking context, keeping it from the viewport edges and the popover rung.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FloatMenu, type FloatMenuItem } from '../../../ui/primitives/FloatMenu';
import { UiPreviewProvider } from '../../../ui/design/preview';

afterEach(cleanup);

const LABEL = 'Past jobs';

const ITEMS: FloatMenuItem[] = [
  { id: 'sonnet', label: 'Claude Sonnet', sub: 'fast' },
  { id: 'opus', label: 'Claude Opus', sub: 'careful' },
];

function Menu(props: Partial<React.ComponentProps<typeof FloatMenu>> = {}) {
  return (
    <div data-testid="panel" style={{ width: 300 }}>
      <FloatMenu
        row="Claude Sonnet"
        aria-label={LABEL}
        items={ITEMS}
        open={false}
        activeId="sonnet"
        onOpen={() => {}}
        onClose={() => {}}
        onPick={() => {}}
        {...props}
      />
    </div>
  );
}

describe('the closed row', () => {
  it('is one row carrying the current value, and says it can open a menu', () => {
    render(<Menu />);
    const row = screen.getByRole('button');
    expect(row.textContent).toContain('Claude Sonnet');
    expect(row.getAttribute('aria-haspopup')).toBe('menu');
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });

  it('asks its host to open, rather than opening itself', () => {
    const onOpen = vi.fn();
    render(<Menu onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('asks to close when pressed while the list stands', () => {
    const onClose = vi.fn();
    render(<Menu open onClose={onClose} />);
    fireEvent.click(screen.getAllByRole('button')[0]!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the open card stands outside the panel', () => {
  it('renders into the document body, never into the row s own subtree', () => {
    render(<Menu open />);
    const card = screen.getByRole('menu');
    const panel = screen.getByTestId('panel');
    expect(panel.contains(card)).toBe(false);
    expect(document.body.contains(card)).toBe(true);
  });

  it('leaves the row s subtree exactly as it was', () => {
    const { rerender } = render(<Menu />);
    const panel = screen.getByTestId('panel');
    const row = screen.getByRole('button');
    const kids = panel.childElementCount;

    rerender(<Menu open />);
    expect(panel.childElementCount).toBe(kids);
    expect(screen.getAllByRole('button')[0]).toBe(row);
    expect(panel.querySelector('[role="menu"]')).toBeNull();
  });

});

describe('the list', () => {
  it('marks the current row', () => {
    render(<Menu open activeId="opus" />);
    const [sonnet, opus] = screen.getAllByRole('menuitemradio');
    expect(opus!.getAttribute('aria-checked')).toBe('true');
    expect(sonnet!.getAttribute('aria-checked')).toBe('false');
  });

  it('hands the pick back by id and closes', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<Menu open onPick={onPick} onClose={onClose} />);
    fireEvent.click(screen.getAllByRole('menuitemradio')[1]!);
    expect(onPick).toHaveBeenCalledWith('opus');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('carries a header where one is given', () => {
    render(<Menu open header="Pick a model" />);
    expect(screen.getByText('Pick a model')).toBeTruthy();
  });
});

describe('the two ways out', () => {
  it('closes on Escape, and does not let the press travel on to fold the panel', () => {
    const onClose = vi.fn();
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    render(<Menu open onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    window.removeEventListener('keydown', outer);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('closes on a press anywhere outside the card, and that press reaches nothing beneath it', () => {
    const onClose = vi.fn();
    const beneath = vi.fn();
    render(<><button type="button" onClick={beneath}>beneath</button><Menu open onClose={onClose} /></>);
    const outside = screen.getByRole('button', { name: 'beneath' });
    fireEvent.pointerDown(outside);
    fireEvent.click(outside);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(beneath).not.toHaveBeenCalled();
  });

  it('takes the listener away with it, so a closed menu answers nothing', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Menu open onClose={onClose} />);
    rerender(<Menu onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * A row with a second control cannot be a `menuitem` button, since a button cannot nest one, so
 * the past-jobs list brings its own rows into the same card.
 */
describe('a caller that brings its own rows', () => {
  it('renders them in the card as a labelled GROUP, not as a menu of items', () => {
    render(
      <Menu
        open
        items={[]}
        body={(
          <div data-testid="own-row">
            <button type="button" data-testid="own-action">roll back</button>
          </div>
        )}
      />,
    );
    // A menu role over rows that are not menuitems would announce an empty menu.
    expect(screen.queryByRole('menu')).toBeNull();
    const card = screen.getByRole('group');
    expect(card.getAttribute('aria-label')).toBe(LABEL);
    expect(card.contains(screen.getByTestId('own-row'))).toBe(true);
    expect(screen.getByTestId('panel').contains(card)).toBe(false);
    expect(screen.getByTestId('own-action').tagName).toBe('BUTTON');
    expect(screen.getAllByRole('button')[0]!.getAttribute('aria-haspopup')).toBe('true');
  });

  it('still closes on Escape and on an outside click', () => {
    const onClose = vi.fn();
    render(<Menu open items={[]} body={<div data-testid="own-row" />} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * A Help figure's containment (`inert`, `pointer-events: none`) covers only its DOM subtree, so a
 * portal, click catcher or window Escape capture would escape it over the live app. Pictured, the
 * card renders inline under its row.
 */
describe('a pictured menu', () => {
  const pictured = (props: Partial<React.ComponentProps<typeof FloatMenu>> = {}) => (
    <UiPreviewProvider><Menu {...props} /></UiPreviewProvider>
  );

  it('renders the open card inline in the row s own subtree, never at the body', () => {
    render(pictured({ open: true }));
    const card = screen.getByRole('menu');
    expect(screen.getByTestId('panel').contains(card)).toBe(true);
  });

  it('lets Escape travel on and closes nothing', () => {
    const onClose = vi.fn();
    const outer = vi.fn();
    render(pictured({ open: true, onClose }));
    window.addEventListener('keydown', outer);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    window.removeEventListener('keydown', outer);
    expect(outer).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the closed picture a bare row, exactly as live', () => {
    render(pictured());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('a menu hung from an element of the caller', () => {
  function Anchored({ onPick = () => {}, highlightId }: { onPick?: (id: string) => void; highlightId?: string }) {
    const ref = { current: null as HTMLInputElement | null };
    return (
      <>
        <input aria-label="Search" ref={(el) => { ref.current = el; }} />
        <FloatMenu row={null} anchor={ref} keepFocus open aria-label={LABEL} items={ITEMS} highlightId={highlightId}
          onOpen={() => {}} onClose={() => {}} onPick={onPick} />
      </>
    );
  }

  it('draws no row of its own and leaves focus in the field', () => {
    render(<Anchored />);
    const field = screen.getByRole('textbox', { name: 'Search' });
    field.focus();
    expect(screen.queryByRole('button', { name: LABEL })).toBeNull();
    expect(screen.getByRole('menu', { name: LABEL })).toBeTruthy();
    expect(document.activeElement).toBe(field);
  });

  it('reports a pick from a row the keys stand on', () => {
    const onPick = vi.fn();
    render(<Anchored onPick={onPick} highlightId="opus" />);
    const opus = screen.getByRole('menuitemradio', { name: /Claude Opus/ });
    fireEvent.click(opus);
    expect(onPick).toHaveBeenCalledWith('opus');
  });
});

describe('a menu with a search field', () => {
  const SEARCH = { label: 'Search models', noMatches: 'Nothing matches', empty: 'No models yet', 'data-testid': 'search' };

  it('narrows its rows to what is typed, matching a row by its id or its search text', () => {
    render(<Menu open items={[...ITEMS, { id: 'haiku', label: 'Claude Haiku', text: 'small quick' }]} search={SEARCH} />);
    const card = screen.getByRole('group', { name: LABEL });
    const field = within(card).getByRole('searchbox', { name: 'Search models' });
    fireEvent.change(field, { target: { value: 'quick' } });
    expect(within(card).getAllByRole('menuitemradio').map((row) => row.textContent)).toEqual(['Claude Haiku']);
    fireEvent.change(field, { target: { value: 'gpt' } });
    expect(within(card).queryAllByRole('menuitemradio')).toEqual([]);
    expect(within(card).getByRole('status').textContent).toBe('Nothing matches');
  });

  it('offers a typed id the list lacks as a choice of its own, and Enter takes it', () => {
    const onPick = vi.fn();
    render(<Menu open onPick={onPick} search={{ ...SEARCH, manual: (id) => `Use ${id}` }} />);
    const field = screen.getByRole('searchbox', { name: 'Search models' });
    fireEvent.change(field, { target: { value: 'my-model' } });
    expect(screen.getAllByRole('menuitemradio').map((row) => row.textContent)).toEqual(['Use my-model']);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('my-model');
  });

  it('says the list is empty, or still arriving, and carries its note', () => {
    const view = render(<Menu open items={[]} search={SEARCH} note="Pick an image model" />);
    expect(screen.getByRole('status').textContent).toBe('No models yet');
    expect(screen.getByText('Pick an image model')).toBeTruthy();
    view.rerender(<Menu open items={[]} search={SEARCH} loading />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
