// @vitest-environment jsdom
/** An object whose item the catalog does not know draws its box with a question mark, never a
 *  fragment of its raw catalog id. */
import '../../../_support/pixi-env';
import { describe, it, expect } from 'vitest';
import * as PIXI from 'pixi.js-legacy';
import { ObjectLayer } from '../../../../view/map2d/layers/object-layer';
import type { PlacedObject } from '../../../../core/model/types';

const bigRect = { left: 0, top: 0, right: 10000, bottom: 10000 };

describe('an object of an unknown item', () => {
  it('shows a question mark on its box', () => {
    const layer = new ObjectLayer({ state: () => null, requestRender: () => {} });
    layer.cull(bigRect);
    const ghost: PlacedObject = { id: 'u', catalogId: 'future-lantern', position: { x: 2, y: 2 }, rotation: 0, elevation: 0 };
    layer.addObjects([ghost]);
    const wrapper = (layer as unknown as { objectMap: Map<string, PIXI.Container> }).objectMap.get('u')!;
    const texts = wrapper.children.filter((c): c is PIXI.Text => c instanceof PIXI.Text).map((t) => t.text);
    expect(texts).toEqual(['?']);
  });
});
