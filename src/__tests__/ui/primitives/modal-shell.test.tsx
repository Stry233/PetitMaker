// ModalShell — the shared cozy-modal boilerplate used by all 7 modals
// (About/Settings/Help/NewProject/Export/ExportJson/Import). It carries the
// accessibility floor every consumer inherits for free: Escape-to-close, a
// minimal sentinel-div focus trap, and focus restoration to the "opener" (the
// element that had focus at the moment the modal mounted/opened) on close.
//
// "Opener" in this file's harness = the real DOM button the test focuses
// before opening the modal, mirroring how App.tsx mounts a modal
// (`{showX && <XModal onClose={...} />}`) right after a menu button's
// onClick — the button is still focused (native post-click behavior) when
// the modal mounts, so ModalShell's own effect is the only thing that can
// send focus back to it later.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { ModalShell, SIZE_MORPH_TWEEN } from '../../../ui/primitives/ModalShell';

function Harness({ initialOpen = false }: { initialOpen?: boolean } = {}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Opener</button>
      <ModalShell open={open} onClose={() => setOpen(false)} width={300}>
        <button>First</button>
        <button>Second</button>
        <a href="https://example.com">Third link</a>
      </ModalShell>
    </div>
  );
}

describe('ModalShell — Escape to close', () => {
  it('calls onClose when Escape is pressed while open', () => {
    const onClose = vi.fn();
    render(
      <ModalShell open onClose={onClose} width={300}>
        <button>Only</button>
      </ModalShell>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose for Escape when closed', () => {
    const onClose = vi.fn();
    render(
      <ModalShell open={false} onClose={onClose} width={300}>
        <button>Only</button>
      </ModalShell>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores non-Escape keys', () => {
    const onClose = vi.fn();
    render(
      <ModalShell open onClose={onClose} width={300}>
        <button>Only</button>
      </ModalShell>,
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ModalShell — stacked Escape', () => {
  it('Escape closes only the TOP shell when two are stacked', () => {
    const onCloseLower = vi.fn();
    const onCloseUpper = vi.fn();
    render(
      <div>
        <ModalShell open onClose={onCloseLower} width={300}>
          <button>Lower</button>
        </ModalShell>
        <ModalShell open onClose={onCloseUpper} width={300}>
          <button>Upper</button>
        </ModalShell>
      </div>,
    );

    // First Escape: only the topmost (last-mounted) shell closes.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCloseUpper).toHaveBeenCalledTimes(1);
    expect(onCloseLower).not.toHaveBeenCalled();
  });

  it('once the top shell unmounts, Escape reaches the shell beneath it', () => {
    const onCloseLower = vi.fn();
    function Stacked() {
      const [upperOpen, setUpperOpen] = useState(true);
      return (
        <div>
          <ModalShell open onClose={onCloseLower} width={300}>
            <button>Lower</button>
          </ModalShell>
          {upperOpen && (
            <ModalShell open onClose={() => setUpperOpen(false)} width={300}>
              <button>Upper</button>
            </ModalShell>
          )}
        </div>
      );
    }
    render(<Stacked />);

    // Close the top layer first.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCloseLower).not.toHaveBeenCalled();
    // Now the lower shell is top; the next Escape reaches it.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCloseLower).toHaveBeenCalledTimes(1);
  });
});

describe('ModalShell — dialog semantics', () => {
  it('exposes role="dialog", aria-modal, and the accessible name from ariaLabel', () => {
    render(
      <ModalShell open onClose={() => {}} width={300} ariaLabel="Settings">
        <button>Only</button>
      </ModalShell>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('supports ariaLabelledBy pointing at an inner heading', () => {
    render(
      <ModalShell open onClose={() => {}} width={300} ariaLabelledBy="mytitle">
        <h2 id="mytitle">Import</h2>
      </ModalShell>,
    );
    expect(screen.getByRole('dialog', { name: 'Import' })).toBeTruthy();
  });
});

describe('ModalShell — focus trap', () => {
  it('wraps Tab from the last focusable element to the first', () => {
    render(
      <ModalShell open onClose={() => {}} width={300}>
        <button>First</button>
        <button>Second</button>
      </ModalShell>,
    );
    const second = screen.getByRole('button', { name: 'Second' });
    second.focus();
    expect(document.activeElement).toBe(second);
    // Simulate the browser's own Tab-forward wrap: after the last real
    // element, a native Tab press would land on the sentinel that follows the
    // content (jsdom does not run native Tab traversal, so the trap is driven
    // directly off the `focus` event a real Tab press would produce).
    const endSentinel = screen.getByTestId('modal-trap-end');
    endSentinel.focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
  });

  it('wraps Shift+Tab from the first focusable element to the last', () => {
    render(
      <ModalShell open onClose={() => {}} width={300}>
        <button>First</button>
        <button>Second</button>
      </ModalShell>,
    );
    const startSentinel = screen.getByTestId('modal-trap-start');
    startSentinel.focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Second' }));
  });

  it('skips the sentinels themselves when computing first/last', () => {
    render(
      <ModalShell open onClose={() => {}} width={300}>
        <a href="https://example.com">Only link</a>
      </ModalShell>,
    );
    const endSentinel = screen.getByTestId('modal-trap-end');
    endSentinel.focus();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Only link' }));
  });
});

// A `motionSize` morph (ShareWindow's mode switch, among others) used to spring the card's whole
// width/height by up to +420px — a fixed-damping spring's overshoot scales with travel, so a
// morph that size visibly pumped even though the same spring is imperceptible on a small control.
// The default morph transition is now a TWEEN, which has no overshoot term to scale.
describe('ModalShell — the default size-morph transition does not spring', () => {
  it('is a tween, not a spring', () => {
    expect(SIZE_MORPH_TWEEN.type).toBe('tween');
    expect(SIZE_MORPH_TWEEN).not.toHaveProperty('stiffness');
    expect(SIZE_MORPH_TWEEN).not.toHaveProperty('damping');
  });

  it('carries a duration and an ease curve, as a tween must', () => {
    expect(SIZE_MORPH_TWEEN.duration).toBeGreaterThan(0);
    expect(Array.isArray(SIZE_MORPH_TWEEN.ease)).toBe(true);
  });
});

describe('ModalShell — focus restoration to the opener', () => {
  it('returns focus to the button that opened the modal once it closes', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Opener' });
    opener.focus();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    // The modal is open; move focus somewhere inside it, then close via Escape.
    const first = screen.getByRole('button', { name: 'First' });
    first.focus();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  it('restores focus to the opener when the whole modal unmounts (App-level `{show && <Modal/>}` pattern)', () => {
    const onClose = vi.fn();
    function ConditionalHarness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button
            onClick={() => {
              setOpen(true);
            }}
          >
            Opener2
          </button>
          {open && (
            <ModalShell
              open
              onClose={() => {
                onClose();
                setOpen(false);
              }}
              width={300}
            >
              <button>Inside</button>
            </ModalShell>
          )}
        </div>
      );
    }
    render(<ConditionalHarness />);
    const opener = screen.getByRole('button', { name: 'Opener2' });
    opener.focus();
    fireEvent.click(opener);
    const inside = screen.getByRole('button', { name: 'Inside' });
    expect(inside).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });
});
