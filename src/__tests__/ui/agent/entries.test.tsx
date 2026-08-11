import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { OrderSlip } from '../../../ui/agent/entries/OrderSlip';
import { AgentNote } from '../../../ui/agent/entries/AgentNote';
import { BuildTicket } from '../../../ui/agent/entries/BuildTicket';
import type { NoteEntry, OrderSlipEntry, TicketEntry } from '../../../agent/session';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

const slip = (over: Partial<OrderSlipEntry> = {}): OrderSlipEntry => ({
  id: 1,
  kind: 'oslip',
  text: 'Add a pond by the big tree',
  ...over,
});

const note = (over: Partial<NoteEntry> = {}): NoteEntry => ({
  id: 2,
  kind: 'note',
  text: 'On it. Small enough to just do, no plan needed.',
  ...over,
});

const ticket = (over: Partial<TicketEntry> = {}): TicketEntry => ({
  id: 7,
  kind: 'ticket',
  icon: 'water',
  tile: '#FFE196',
  title: 'Pond by the old tree',
  sub: '38 cells, south bank',
  rail: [
    { s: 'ok', i: 'water', t: 'Painted' },
    { s: 'ok', i: 'flower', t: 'Reeds' },
  ],
  undoable: true,
  ...over,
});

describe('OrderSlip', () => {
  it('renders the user text right-aligned', () => {
    render(<OrderSlip entry={slip()} />, { wrapper: Wrapper });
    expect(screen.getByText('Add a pond by the big tree')).toBeTruthy();
    expect(screen.getByTestId('oslip').style.alignSelf).toBe('flex-end');
  });

  it('undone: dims and stamps', () => {
    render(<OrderSlip entry={slip({ undone: true })} />, { wrapper: Wrapper });
    expect(screen.getByTestId('undone-stamp')).toBeTruthy();
    expect(screen.getByTestId('oslip').dataset.undone).toBe('true');
  });
});

describe('AgentNote', () => {
  it('plain note: no avatar, no pulsering', () => {
    render(<AgentNote entry={note()} />, { wrapper: Wrapper });
    expect(screen.getByText(/no plan needed/)).toBeTruthy();
    expect(screen.queryByTestId('pulsering')).toBeNull();
  });

  it('busy note: pulsing ring with the verb glyph', () => {
    render(<AgentNote entry={note({ busy: true, icon: 'eval', text: 'Walking the site…' })} />, { wrapper: Wrapper });
    const ring = screen.getByTestId('pulsering');
    expect(ring.querySelector('[data-verb="eval"]')).toBeTruthy();
  });

  it('findings chips render with their glyphs', () => {
    render(
      <AgentNote
        entry={note({
          findings: [
            { icon: 'terrain', t: 'A ridge on the west' },
            { icon: 'water', t: 'Water on the east edge' },
          ],
        })}
      />,
      { wrapper: Wrapper },
    );
    const chips = screen.getAllByTestId('finding');
    expect(chips).toHaveLength(2);
    expect(chips[0]!.textContent).toContain('A ridge on the west');
    expect(chips[1]!.querySelector('[data-verb="water"]')).toBeTruthy();
  });
});

describe('BuildTicket', () => {
  it('done ticket shows check, undo chip and flip button', () => {
    const onUndo = vi.fn();
    const onFlip = vi.fn();
    render(<BuildTicket entry={ticket()} onUndo={onUndo} onFlip={onFlip} />, { wrapper: Wrapper });
    expect(screen.getByTestId('ticket-check')).toBeTruthy();
    fireEvent.click(screen.getByTestId('undochip'));
    expect(onUndo).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getAllByTestId('flipbtn')[0]!);
    expect(onFlip).toHaveBeenCalledWith(7);
  });

  it('working ticket hides check, undo and flip', () => {
    render(
      <BuildTicket
        entry={ticket({ working: true, rail: [{ s: 'run', i: 'water', t: 'Painting' }], now: 'Painting the water…' })}
        onUndo={() => {}}
        onFlip={() => {}}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.queryByTestId('ticket-check')).toBeNull();
    expect(screen.queryByTestId('undochip')).toBeNull();
    expect(screen.queryAllByTestId('flipbtn')).toHaveLength(1); // back face only
    expect(screen.getByText('Painting the water…')).toBeTruthy();
  });

  it('undone ticket hides the undo chip and shows the stamp', () => {
    render(<BuildTicket entry={ticket({ undone: true })} onUndo={() => {}} onFlip={() => {}} />, { wrapper: Wrapper });
    expect(screen.queryByTestId('undochip')).toBeNull();
    expect(screen.getByTestId('undone-stamp')).toBeTruthy();
  });

  it('flipped state is reflected on the card inner', () => {
    const { rerender } = render(<BuildTicket entry={ticket()} onUndo={() => {}} onFlip={() => {}} />, {
      wrapper: Wrapper,
    });
    expect(screen.getByTestId('ticket-inner').dataset.flipped).toBe('false');
    rerender(<BuildTicket entry={ticket({ flipped: true })} onUndo={() => {}} onFlip={() => {}} />);
    expect(screen.getByTestId('ticket-inner').dataset.flipped).toBe('true');
  });

  it('back face lists the steps, amber for adjusted approaches', () => {
    render(
      <BuildTicket
        entry={ticket({
          steps: [
            { s: 'ok', t: 'Painted 38 cells of water' },
            { s: 'revert', t: 'First shape touched a path, rolled back and shifted south' },
          ],
        })}
        onUndo={() => {}}
        onFlip={() => {}}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText('How it was built')).toBeTruthy();
    const steps = screen.getAllByTestId('bk-step');
    expect(steps).toHaveLength(2);
    expect(steps[1]!.textContent).toContain('rolled back and shifted south');
    expect(steps[1]!.textContent).toContain('!'); // the amber mark
  });

  it('revert note renders in amber copy on the front', () => {
    render(
      <BuildTicket
        entry={ticket({ revertnote: 'Rolled back automatically, trying another way.' })}
        onUndo={() => {}}
        onFlip={() => {}}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText(/trying another way/)).toBeTruthy();
  });
});
