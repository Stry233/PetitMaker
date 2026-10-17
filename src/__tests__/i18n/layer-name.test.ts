import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/locales/en';
import { helpEn } from '../../i18n/locales/help/en';
import { LAYER_PARAMS, type Translate } from '../../i18n/keys';
import { layerName, layerNumeral, layerTileName } from '../../i18n/terms/layer-name';
import { translateFor, translatorFor } from '../../i18n/context';
import { ruleToast } from '../../i18n/terms/rule-copy';
import { ELEVATION_MAX, layerNumber } from '../../core/game/profile';
import type { Fail } from '../../rules/define';

/** The `{param}` written straight after the word "layer" or "layers", as a layer number is. */
const LAYER_TOKEN = /\blayers? \{(\w+)\}/gi;
const layerTokens = (text: string): string[] => [...text.matchAll(LAYER_TOKEN)].map((m) => m[1]!);

describe('the one way a layer is named', () => {
  it('numbers the ground layer 1 and the top layer one past its elevation, in prose, on tiles and bare', () => {
    const t = translatorFor('en');
    expect(layerName(t, 0)).toBe('Layer 1');
    expect(layerName(t, ELEVATION_MAX)).toBe(`Layer ${ELEVATION_MAX + 1}`);
    expect(layerNumeral(ELEVATION_MAX)).toBe(String(ELEVATION_MAX + 1));
    expect(layerTileName(t, 0)).toBe('Layer 1');
    // zh names a layer with its ordinal in prose and without it on the panel's tiles.
    expect(layerName(translatorFor('zh'), 3)).toBe('第 4 层');
    expect(layerTileName(translatorFor('zh'), 3)).toBe('4 层');
  });

  /** Every interface string naming a layer by number is listed, by the param carrying it, so its
   *  callers can pass only a `LayerNumber`; a new string naming a layer fails here until it is. */
  it('lists every interface string that names a layer by its number', () => {
    const named = Object.entries(en).flatMap(([key, text]) => layerTokens(text).map((param) => [key, param] as const));
    expect(Object.fromEntries(named)).toEqual(LAYER_PARAMS);
    expect(named).toHaveLength(Object.keys(LAYER_PARAMS).length);
  });

  /** Help fills a layer number from a fact ending in `Layer` (a `LayerNumber` by type) or `Layers`
   *  (a list of them), so no page names a layer by a raw elevation or a count. */
  it('fills every layer number in Help from a layer fact', () => {
    const misnamed = Object.entries(helpEn).flatMap(([key, text]) => layerTokens(text).filter((token) => !/Layers?$/.test(token)).map((token) => `${key}: {${token}}`));
    expect(misnamed).toEqual([]);
  });

  it('takes a layer number, never a raw elevation, wherever copy names a layer', () => {
    // Type checks only: `npm run lint` compiles this body, and each marked line must stay an error.
    const unused = (t: Translate, fail: Fail) => {
      // @ts-expect-error an elevation is not a layer number
      t('layer.name', { n: 3 });
      // @ts-expect-error an elevation is not a layer number
      translateFor('en', 'agent.dc_wall', { w: 1, h: 1, crest: 3, flood: '' });
      // @ts-expect-error an elevation is not a layer number
      ruleToast(t, 'error.water_only_layer', { layer: 3 });
      // @ts-expect-error an elevation is not a layer number
      fail('error.elevation_limit', { grid: 'terrain', cells: [] } as never, { messageParams: { max: ELEVATION_MAX } });
      t('layer.name', { n: layerNumber(3) });
    };
    expect(typeof unused).toBe('function');
  });
});
