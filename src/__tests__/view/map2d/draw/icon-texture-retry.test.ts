// @vitest-environment jsdom
import '../../../_support/pixi-env';
import { afterEach, describe, expect, it } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { getIconTexture } from '../../../../view/map2d/draw/icon-texture';
import { __resetHeldImages, imagesHeld, retryHeldImages } from '../../../../platform/async/art-retry';

/** The element a Pixi texture loads its picture through. */
const source = (texture: PIXI.Texture): HTMLImageElement => (texture.baseTexture.resource as unknown as { source: HTMLImageElement }).source;

/** Lands a picture on `image` as a browser does once its bytes decode. */
function land(image: HTMLImageElement, width: number, height: number): void {
  Object.defineProperty(image, 'complete', { configurable: true, value: true });
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: height });
  image.dispatchEvent(new Event('load'));
}

afterEach(() => __resetHeldImages());

describe('a map icon whose picture failed to load', () => {
  it('appears on the texture already handed out once a retry loads it', () => {
    const url = 'https://package.test/assets/retry-icon.webp';
    const texture = getIconTexture(url, 64);
    const image = source(texture);
    image.dispatchEvent(new Event('error'));
    expect(texture.baseTexture.valid).toBe(false);
    expect(imagesHeld()).toBe(true);

    const requested: string[] = [];
    const set = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!.set!;
    Object.defineProperty(image, 'src', { configurable: true, get: () => url, set: (value: string) => { requested.push(value); set.call(image, value); } });
    retryHeldImages();
    expect(requested).toEqual([url]);
    land(image, 64, 64);
    expect(texture.baseTexture.valid).toBe(true);
    expect(imagesHeld()).toBe(false);
  });

  it('waits for the next retry when the retried load fails again', () => {
    const texture = getIconTexture('https://package.test/assets/retry-twice.webp', 64);
    const image = source(texture);
    image.dispatchEvent(new Event('error'));
    retryHeldImages();
    expect(imagesHeld()).toBe(false);
    image.dispatchEvent(new Event('error'));
    expect(imagesHeld()).toBe(true);
  });
});
