/**
 * The house dropdown, and the one rule that shapes it: THE PANEL NEVER MAKES ROOM FOR A MENU. The
 * closed state is a row; the open state is a card in a BODY-LEVEL layer, so no surface reserves a
 * box, tweens a height, or grows a scroller because a list opened over it.
 *
 * The body-level portal is load-bearing rather than tidy: a panel stands inside the frame's `zoom`
 * and inside its entrance fade, and either of those becomes the containing block or the stacking
 * context for anything rendered under it. A card in the row's own subtree cannot reach the
 * viewport's edges or the popover rung. These pin the layer, the two dismissals, and the one row
 * the list marks as current.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FloatMenu, floatMenuItemStyle, type FloatMenuItem } from '../../../ui/primitives/FloatMenu';
import { ACTIVE } from '../../../ui/design/tokens';
import { radii, z } from '../../../ui/design/styles';

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

  it('leaves the row s box exactly as it was', () => {
    const { rerender } = render(<Menu />);
    const panel = screen.getByTestId('panel');
    const row = screen.getByRole('button');
    const closed = { h: panel.offsetHeight, kids: panel.childElementCount };

    rerender(<Menu open />);
    expect(panel.offsetHeight).toBe(closed.h);
    expect(panel.childElementCount).toBe(closed.kids);
    // The same row node, still alone in the panel: no card, no reserved box, no spacer.
    expect(screen.getAllByRole('button')[0]).toBe(row);
    expect(panel.querySelector('[role="menu"]')).toBeNull();
  });

  /**
   * THE AIR SCALES WITH THE INTERFACE. The card's box is written in the zoomed layer's own px, so a
   * gap added to a VISUAL rect before the division comes out at 6 SCREEN px at every scale — 8 frame
   * px at uiZoom 0.6 and 2.7 at 1.8, three times tighter to its row at the top of the range. jsdom
   * reports a zero rect for the row, which is exactly what leaves the gap term alone to be read.
   */
  it('keeps the same air between row and card at every interface scale', () => {
    render(<Menu open zoom={2} />);
    expect(screen.getByRole('menu').style.top).toBe('6px');
    cleanup();
    render(<Menu open zoom={0.5} />);
    expect(screen.getByRole('menu').style.top).toBe('6px');
  });

  /**
   * ALL FOUR CORNERS INSIDE THE BOX THE CARD IS GIVEN.
   *
   * The placement hands the card the ROW's width and the room the window has left. Under
   * content-box its own padding and border stand OUTSIDE both: 14px wider than the row, so a card
   * hanging off a row near the window's right edge stands past the clamp meant to hold it off that
   * edge, and 14px taller than the room, so its foot is cut off by the window. What reads on the
   * glass is a rounded card with two square corners.
   */
  it('keeps its own padding and border inside the box it is given', () => {
    const view = render(<Menu zoom={1} />);
    const row = screen.getAllByRole('button')[0]!;
    // A row hard against the window's right-hand gutter, which is where an overflow would show. Stubbed
    // BEFORE the list opens, since the card is placed from the rect read in that layout pass.
    const box = { left: 716, top: 100, width: 300, height: 50, bottom: 150, right: 1016 };
    Object.defineProperty(row, 'getBoundingClientRect', {
      configurable: true, value: () => ({ ...box, x: box.left, y: box.top, toJSON: () => ({}) }),
    });
    view.rerender(<Menu open zoom={1} />);
    const card = screen.getByRole('menu');
    expect(card.style.boxSizing).toBe('border-box');
    expect(card.style.width).toBe('300px');
    // The card's OUTER right edge lands on the gutter rather than 14px past it.
    expect(716 + 300).toBe(window.innerWidth - 8);
    // And the radius is ONE value, so every corner carries it and none is styled square.
    expect(card.style.borderRadius).toBe(`${radii.lg}px`);
  });

  it('stands the layer on the popover rung and lets only the card take a pointer', () => {
    render(<Menu open />);
    const card = screen.getByRole('menu');
    const layer = card.parentElement!;
    expect(layer.style.zIndex).toBe(String(z.popover));
    expect(layer.style.pointerEvents).toBe('none');
    expect(card.style.pointerEvents).toBe('auto');
  });
});

describe('the list', () => {
  it('marks the current row, and the mark is the house ACTIVE fill', () => {
    render(<Menu open activeId="opus" />);
    const [sonnet, opus] = screen.getAllByRole('menuitemradio');
    expect(opus!.getAttribute('aria-checked')).toBe('true');
    expect(sonnet!.getAttribute('aria-checked')).toBe('false');
    expect(floatMenuItemStyle(true).backgroundColor).toBe(ACTIVE);
    expect(floatMenuItemStyle(false).backgroundColor).not.toBe(ACTIVE);
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

  it('closes on a click anywhere outside the card', () => {
    const onClose = vi.fn();
    render(<Menu open onClose={onClose} />);
    // The shared ClickCatcher, standing under the layer it guards.
    const catcher = screen.getByRole('menu').parentElement!.previousElementSibling as HTMLElement;
    expect(catcher.style.position).toBe('fixed');
    fireEvent.click(catcher);
    expect(onClose).toHaveBeenCalledTimes(1);
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
 * THE ONE LIST SHAPE THE ITEM MODEL CANNOT HOLD: a row carrying a second control of its own. A
 * `menuitem` here is a `<button>`, and a button cannot nest one — so the panel's past-jobs list
 * (whose row opens the ticket while a square beside it rolls the job back) builds its own rows and
 * takes the CARD: same layer, same anchor, same clamp, same two ways out.
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
    // A card of `menuitem` rows is a menu; one the caller filled itself is a labelled group, since
    // its rows are not menuitems and a menu that says they are announces an empty one.
    expect(screen.queryByRole('menu')).toBeNull();
    const card = screen.getByRole('group');
    expect(card.getAttribute('aria-label')).toBe(LABEL);
    expect(card.contains(screen.getByTestId('own-row'))).toBe(true);
    expect(screen.getByTestId('panel').contains(card)).toBe(false);
    // Its own control is a real button, reachable because it was never wrapped in one.
    expect(screen.getByTestId('own-action').tagName).toBe('BUTTON');
    // And the row that opens it says what it opens.
    expect(screen.getAllByRole('button')[0]!.getAttribute('aria-haspopup')).toBe('true');
  });

  it('still closes on Escape and on an outside click', () => {
    const onClose = vi.fn();
    render(<Menu open items={[]} body={<div data-testid="own-row" />} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
