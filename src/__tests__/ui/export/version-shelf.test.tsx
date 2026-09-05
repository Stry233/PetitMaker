// The shelf's row mechanics: growth brings the new card into view, loss never moves the row, and
// the six footprints hold whatever mix of cards, painting slot and ghosts fills them.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../../../i18n/context';
import { VersionShelf } from '../../../ui/chrome/modals/export/stylize/VersionShelf';
import type { StylizeVersion } from '../../../io/stylize';

function fakeVersion(no: number): StylizeVersion {
  return {
    id: `v${no}`, no, kind: 'proc', direction: 'aquarelle',
    image: { src: `data:image/png;base64,V${no}` } as unknown as HTMLImageElement,
    fingerprint: 0,
  };
}

const noop = () => {};
function shelf(versions: StylizeVersion[], running = false) {
  return (
    <I18nProvider>
      <VersionShelf
        versions={versions} selectedId={null} running={running} runningBand="#123456"
        originalSrc={null} onTry={noop} onPick={noop} onRetire={noop}
      />
    </I18nProvider>
  );
}

describe('VersionShelf row mechanics', () => {
  const scrollTo = vi.fn();
  beforeEach(() => {
    scrollTo.mockClear();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  });

  it('scrolls to the end when the row gains a card, and stays put when it loses one', () => {
    const { rerender } = render(shelf([fakeVersion(1)]));
    const afterMount = scrollTo.mock.calls.length;
    rerender(shelf([fakeVersion(1), fakeVersion(2)]));
    expect(scrollTo.mock.calls.length).toBe(afterMount + 1);
    rerender(shelf([fakeVersion(1)]));
    expect(scrollTo.mock.calls.length).toBe(afterMount + 1);
  });

  it('the painting slot counts as growth too', () => {
    const { rerender } = render(shelf([fakeVersion(1)]));
    const afterMount = scrollTo.mock.calls.length;
    rerender(shelf([fakeVersion(1)], true));
    expect(scrollTo.mock.calls.length).toBe(afterMount + 1);
  });

  it('a hidden retire square refuses the pointer; a revealed one retires', () => {
    const onRetire = vi.fn();
    render(
      <I18nProvider>
        <VersionShelf
          versions={[fakeVersion(1)]} selectedId={null} running={false} runningBand="#123456"
          originalSrc={null} onTry={noop} onPick={noop} onRetire={onRetire}
        />
      </I18nProvider>,
    );
    const retire = screen.getByRole('button', { name: 'Remove this picture' });
    expect((retire as HTMLElement).style.pointerEvents).toBe('none');
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Take 1' }).parentElement!);
    expect((retire as HTMLElement).style.pointerEvents).toBe('auto');
    fireEvent.click(retire);
    expect(onRetire).toHaveBeenCalledWith('v1');
  });
});
