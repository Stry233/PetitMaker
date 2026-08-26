import { describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { HUSHED, InlineConfirm } from '../../../ui/primitives/InlineConfirm';
import { UNAVAILABLE } from '../../../ui/design/styles';
import { CONFIRM_ARM } from '../../../ui/agent/motion';
import { CURVES } from '../../../ui/shell/motion/curves';
import { MOTIONS } from '../../../ui/shell/motion/registry';

afterEach(cleanup);

/** Where a node stands: its parent, its index among that parent's children, and its box. */
function seat(el: Element) {
  const kids = [...(el.parentElement?.children ?? [])];
  const r = el.getBoundingClientRect();
  return { parent: el.parentElement, index: kids.indexOf(el), rect: [r.left, r.top, r.width, r.height] };
}

/**
 * A destructive verb that BECOMES its own question: one press arms it, a second answers it.
 *
 * What the shape is FOR is a row with no slack, so the assertion that matters most is the negative
 * one: pressing it adds nothing to the row at all. jsdom lays nothing out, so a rect comparison here
 * is a comparison of zeroes and would pass for a component that moved everything — what IS checkable
 * is that the row's children are the same nodes, in the same order, never remounted and never
 * displaced. The rect snapshot is kept beside it as the statement of intent, and would catch a jsdom
 * that ever did lay out. The rest is the state machine: the second press answers, anything else
 * cancels, and Escape stops where it is answered.
 */
describe('a verb that becomes its own question', () => {
  function SelfRow({
    onConfirm = () => {}, onCancel = () => {},
  }: { onConfirm?: () => void; onCancel?: () => void }) {
    return (
      <div data-testid="row" style={{ display: 'flex', gap: 8 }}>
        <button type="button" data-testid="verb-a">Stop this job</button>
        <InlineConfirm question="Forget the key?" arm={CONFIRM_ARM} onConfirm={onConfirm} onCancel={onCancel}>
          {(armed) => (
            <button type="button" data-testid="trigger" data-armed={armed || undefined}>
              {armed ? 'Forget the key?' : 'Forget key'}
            </button>
          )}
        </InlineConfirm>
        <span data-testid="spacer" style={{ flex: 1 }} />
      </div>
    );
  }

  it('adds nothing to the row when it arms: the same nodes, in the same order', () => {
    render(<SelfRow />);
    const row = screen.getByTestId('row');
    const nodesBefore = [...row.children];
    const before = [...row.children].map(seat);

    fireEvent.click(screen.getByTestId('trigger'));

    expect(screen.getByTestId('trigger').textContent).toBe('Forget the key?');
    expect(screen.getByTestId('trigger').getAttribute('data-armed')).toBe('true');
    // One button before, one button after: no pair, no strip, no second control anywhere.
    expect(row.querySelectorAll('button')).toHaveLength(2);
    expect([...row.children]).toEqual(nodesBefore);
    expect([...row.children].map(seat)).toEqual(before);
  });

  it('answers on the second press of the same button, and only then', () => {
    const onConfirm = vi.fn();
    render(<SelfRow onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('trigger'));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('trigger'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // And it disarms behind itself, so a third press is a fresh question rather than a second answer.
    expect(screen.getByTestId('trigger').textContent).toBe('Forget key');
  });

  it('cancels on a press anywhere else, before that press reaches its own control', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<SelfRow onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('trigger'));

    fireEvent.pointerDown(screen.getByTestId('verb-a'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('trigger').textContent).toBe('Forget key');
  });

  /** A press INSIDE the seat is the answer, not a dismissal: the two listeners must not both fire on
   *  the one gesture that confirms. */
  it('does not read its own press as an outside one', () => {
    const onCancel = vi.fn();
    render(<SelfRow onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('trigger'));

    fireEvent.pointerDown(screen.getByTestId('trigger'));

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId('trigger').getAttribute('data-armed')).toBe('true');
  });

  /** ESCAPE ANSWERS THE INNERMOST THING AND STOPS THERE. The surfaces that carry these verbs fold on
   *  Escape themselves, so an armed question that let the key through would be dismissed and take the
   *  whole card with it. */
  it('cancels on Escape, and keeps the key from travelling further', () => {
    const onCancel = vi.fn();
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <SelfRow onCancel={onCancel} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('trigger'));

    fireEvent.keyDown(screen.getByTestId('trigger'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    expect(screen.getByTestId('trigger').getAttribute('data-armed')).toBeNull();
  });

  it('lets a host own the armed state, exactly as the pair does', () => {
    const onOpenChange = vi.fn();
    render(
      <InlineConfirm
        question="Forget the key?"
        arm={CONFIRM_ARM}
        open={false}
        onOpenChange={onOpenChange}
        onConfirm={() => {}}
      >
        {(armed) => <button type="button" data-testid="t">{armed ? 'armed' : 'rest'}</button>}
      </InlineConfirm>,
    );
    fireEvent.click(screen.getByTestId('t'));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('t').textContent, 'controlled: it did not arm itself').toBe('rest');
  });

  it('names the question to a screen reader, since the button has changed meaning under the pointer', () => {
    render(<SelfRow />);
    const seatEl = screen.getByTestId('inline-confirm-seat');
    expect(seatEl.getAttribute('aria-label')).toBeNull();
    fireEvent.click(screen.getByTestId('trigger'));
    expect(seatEl.getAttribute('aria-label')).toBe('Forget the key?');
    expect(seatEl.getAttribute('data-confirm-armed')).toBe('true');
  });

  /** WHAT A SIBLING WEARS while this one is asking: dimmed and deaf, at exactly the size and place it
   *  already had. Never `display: none` and never a width change, either of which reflows the row. */
  it('offers the one dimming a row applies, which takes the rect with it', () => {
    expect(HUSHED.opacity).toBe(UNAVAILABLE);
    expect(HUSHED.pointerEvents).toBe('none');
  });

  /**
   * ONE DECLARATION, IN BOTH SPELLINGS, and it is a TWEEN. The box's growth is Framer's and the fill's
   * crossing is a css transition, so the two halves of one morph cannot be retuned apart — and neither
   * carries overshoot, since a bounce reads as this button being swapped for a different one.
   */
  it('grows and crosses on the one declared beat, with no overshoot in it', () => {
    const declared = MOTIONS['panel.confirm.arm'];
    expect(declared.tier).toBe('inform');
    expect(declared.curve).toBe('punchy');
    expect(CONFIRM_ARM.transition).toEqual({ ...CURVES.punchy, duration: declared.duration });
    for (const property of ['background-color', 'color', 'border-color']) {
      expect(CONFIRM_ARM.paint).toContain(`${property} ${declared.duration}s`);
    }
    expect(CONFIRM_ARM).not.toHaveProperty('pulse');
  });

  /**
   * THE BOX IS WHAT MOVES, AND THE TRIGGER IS THE BOX. The seat is a grid so its tweened width is the
   * trigger's own width rather than a slot around it, and the trigger clips, so the question's words
   * are revealed behind the shape the caller drew instead of spilling out of a box still growing.
   */
  it('tweens the trigger\'s own width and hands it the crossing', () => {
    render(<SelfRow />);
    const seatEl = screen.getByTestId('inline-confirm-seat');
    expect(seatEl.style.display).toBe('inline-grid');
    const trigger = screen.getByTestId('trigger');
    expect(trigger.style.overflow).toBe('hidden');
    expect(trigger.style.transition).toBe(CONFIRM_ARM.paint);
    // And the crossing survives the arming, which is the frame it is for.
    fireEvent.click(trigger);
    expect(screen.getByTestId('trigger').style.transition).toBe(CONFIRM_ARM.paint);
  });
});
