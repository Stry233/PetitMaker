/**
 * The road picker: the catalog's path art on its swatches, the hovered surface's name, and the two
 * soft edges — the strip's own, and the one inside a name too long for its bubble.
 *
 * jsdom lays nothing out, so every scroll metric it reports is zero and both of those resolve to
 * "nothing to fade". `stubMetrics` gives the whole document a box and a content width, which is what
 * puts the two measuring paths in the state a browser would.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { SCROLL_FADE } from '../../../ui/primitives/scroll-fade';
import { I18nProvider } from '../../../i18n/context';
import { ScaleProvider } from '../../../ui/design/scale';
import { RoadStyles } from '../../../ui/shell/bars/RoadStyles';
import { useEditorStore } from '../../../state/store';

function Providers({ children, reduced }: { children: React.ReactNode; reduced?: boolean }) {
  return (
    <I18nProvider>
      <ScaleProvider value={0.5}>
        <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
          {children}
        </MotionConfig>
      </ScaleProvider>
    </I18nProvider>
  );
}

/** Every element is 100 wide and holds 300 of content, so anything that measures its own overrun
 *  finds one. Restored by `afterEach`. */
function stubMetrics(): () => void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const was = {
    clientWidth: Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth'),
    scrollWidth: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth'),
  };
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => 100 });
  Object.defineProperty(proto, 'scrollWidth', { configurable: true, get: () => 300 });
  return () => {
    delete proto.clientWidth;
    delete proto.scrollWidth;
    if (was.clientWidth) Object.defineProperty(Element.prototype, 'clientWidth', was.clientWidth);
    if (was.scrollWidth) Object.defineProperty(Element.prototype, 'scrollWidth', was.scrollWidth);
  };
}

/** The bubble's two boxes: the window the name runs through, and the name itself. */
function nameBoxes(): { box: HTMLElement; text: HTMLElement } {
  const box = screen.getByTestId('shell-card-name').firstElementChild as HTMLElement;
  return { box, text: box.firstElementChild as HTMLElement };
}

afterEach(() => {
  cleanup();
  useEditorStore.setState({ locale: 'en' });
});

describe('the road picker', () => {
  it('shows the hovered surface name and the icon art', async () => {
    render(<Providers><RoadStyles /></Providers>);
    const cobble = screen.getByRole('button', { name: 'Cobblestone Path' });
    expect(cobble.querySelector('img')?.getAttribute('src')).toContain('path-cobblestone');
    fireEvent.pointerEnter(cobble);
    expect((await screen.findByTestId('shell-card-name')).textContent).toBe('Cobblestone Path');
    fireEvent.pointerLeave(cobble);
  });

  it('offers the in-game paths and nothing else, every swatch wearing its own tile', () => {
    // The plain colour surfaces are retired, so a swatch with no art is a swatch
    // for an item the catalog should not be holding.
    render(<Providers><RoadStyles /></Providers>);
    const swatches = screen.getAllByRole('button');
    expect(swatches).toHaveLength(28);
    for (const s of swatches) {
      expect(s.querySelector('img')?.getAttribute('src'), s.getAttribute('aria-label') ?? '').toContain('path-');
    }
  });

  it('reaches the bubble from the keyboard too, mirroring pointer hover', async () => {
    render(<Providers><RoadStyles /></Providers>);
    const cobble = screen.getByRole('button', { name: 'Cobblestone Path' });
    fireEvent.focus(cobble);
    expect((await screen.findByTestId('shell-card-name')).textContent).toBe('Cobblestone Path');
    fireEvent.blur(cobble);
    await waitFor(() => expect(screen.queryByTestId('shell-card-name')).toBeNull());
  });
});

describe('the strip fades where it can still travel', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('shades the end it can reach, leaves the stop it is standing at alone, and does it a swatch at a time', async () => {
    restore = stubMetrics();
    render(<Providers><RoadStyles /></Providers>);
    const row = screen.getByRole('group', { name: 'Road Surface' });
    fireEvent.scroll(row);

    // The shade GROWS IN over a few frames (`scroll-fade.ts` chases the measured width), so what is
    // waited for is the settled width: a whole swatch, well past the shelf rows' default, so the
    // shade begins earlier along the row.
    const width = (): number => Number(
      /calc\(100% - ([0-9.]+)px\)/.exec(row.style.maskImage)?.[1],
    );
    await waitFor(() => expect(width()).toBeGreaterThan(SCROLL_FADE));

    // At the left stop (scrollLeft 0) the first swatch and its grown plate meet the edge squarely.
    expect(row.style.maskImage).toContain('linear-gradient(to right,');
    expect(row.style.maskImage).not.toContain('transparent 0');
    expect(row.style.maskImage).toContain('transparent 100%');
  });
});

/**
 * A NAME LONGER THAN ITS BUBBLE. The Russian names run past forty characters, and a bubble that grew
 * to hold one would reach across half the strip.
 */
describe('the hovered name, when it does not fit', () => {
  let restore = () => {};
  afterEach(() => restore());

  const hover = () => fireEvent.pointerEnter(
    screen.getByRole('button', { name: 'Cobblestone Path' }),
  );

  it('runs the whole name through a window, softened at both ends', async () => {
    restore = stubMetrics();
    render(<Providers><RoadStyles /></Providers>);
    hover();

    await screen.findByTestId('shell-card-name');
    await waitFor(() => expect(nameBoxes().box.style.maskImage).toContain('linear-gradient'));
    const { box, text } = nameBoxes();
    expect(box.style.overflow).toBe('hidden');
    expect(box.style.maskImage).toContain('transparent 0');
    expect(box.style.maskImage).toContain('transparent 100%');
    expect(text.style.whiteSpace).toBe('nowrap');
    // Clipped, never shortened: what is on screen is the whole name, travelling.
    expect(text.textContent).toBe('Cobblestone Path');
  });

  it('wraps instead of travelling where motion is reduced', async () => {
    restore = stubMetrics();
    render(<Providers reduced><RoadStyles /></Providers>);
    hover();

    await screen.findByTestId('shell-card-name');
    const { box, text } = nameBoxes();
    expect(text.style.whiteSpace).toBe('normal');
    expect(box.style.maskImage).toBe('');
    expect(box.style.overflow).toBe('');
  });

  /** A name that fits keeps exactly the bubble it always had: no window, no shade, no travel. */
  it('leaves a name that fits alone', async () => {
    render(<Providers><RoadStyles /></Providers>);
    hover();

    await screen.findByTestId('shell-card-name');
    const { box } = nameBoxes();
    expect(box.style.maskImage).toBe('');
  });
});
