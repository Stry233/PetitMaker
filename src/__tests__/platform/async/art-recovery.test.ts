// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installArtRecovery } from '../../../platform/async/art-recovery';
import { __resetHeldImages, holdFailedImage } from '../../../platform/async/art-retry';

let uninstall: () => void = () => {};
const requests: string[] = [];

/** A picture on the page, recording each time its address is asked for. */
function picture(src: string): HTMLImageElement {
  const image = document.createElement('img');
  image.setAttribute('src', src);
  const set = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!.set!;
  Object.defineProperty(image, 'src', {
    configurable: true,
    get: () => new URL(image.getAttribute('src')!, document.baseURI).href,
    set: (value: string) => { requests.push(value); set.call(image, value); },
  });
  document.body.appendChild(image);
  return image;
}

const fail = (image: HTMLImageElement): void => { image.dispatchEvent(new Event('error')); };
const packaged = (name: string): string => new URL(`./assets/${name}`, document.baseURI).href;

beforeEach(() => {
  vi.useFakeTimers();
  requests.length = 0;
  uninstall = installArtRecovery();
});

afterEach(() => {
  uninstall();
  __resetHeldImages();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('[UI-25] a packaged picture that fails to load in Lite', () => {
  it('shows a placeholder until it loads again', () => {
    const image = picture('./assets/card.webp');
    fail(image);
    expect(image.hasAttribute('data-art-missing')).toBe(true);
    image.dispatchEvent(new Event('load'));
    expect(image.hasAttribute('data-art-missing')).toBe(false);
  });

  it('loads again when the connection returns', () => {
    const image = picture('./assets/card.webp');
    fail(image);
    window.dispatchEvent(new Event('online'));
    expect(requests).toEqual([packaged('card.webp')]);
  });

  it('loads again when the page comes back to the front', () => {
    const image = picture('./assets/card.webp');
    fail(image);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(requests).toEqual([packaged('card.webp')]);
  });

  it('loads again on its own at widening intervals while it keeps failing', () => {
    const image = picture('./assets/card.webp');
    fail(image);
    vi.advanceTimersByTime(1999);
    expect(requests).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(requests).toHaveLength(1);
    fail(image);
    vi.advanceTimersByTime(2000);
    expect(requests).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(requests).toHaveLength(2);
  });

  it('retries map art that failed outside the page with it', () => {
    const offPage = new Image();
    offPage.src = packaged('tree.webp');
    const asked = vi.fn();
    Object.defineProperty(offPage, 'src', { configurable: true, get: () => packaged('tree.webp'), set: asked });
    holdFailedImage(offPage);
    window.dispatchEvent(new Event('online'));
    expect(asked).toHaveBeenCalledWith(packaged('tree.webp'));
  });

  it('forgets a picture that left the page', () => {
    const image = picture('./assets/card.webp');
    fail(image);
    image.remove();
    window.dispatchEvent(new Event('online'));
    expect(requests).toHaveLength(0);
  });

  it('leaves pictures that are not in the package alone', () => {
    const image = picture('data:image/webp;base64,AAAA');
    fail(image);
    expect(image.hasAttribute('data-art-missing')).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(requests).toHaveLength(0);
  });
});
