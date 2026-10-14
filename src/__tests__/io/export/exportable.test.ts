// @vitest-environment jsdom
/**
 * What an export may carry: a custom planet under its shown name and only approved custom tags,
 * decided once in io so every exporter receives the same map.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exportableState, shownCustomPlanetName } from '../../../io/export/exportable';
import { buildShareCode } from '../../../io/share/export';
import { carrying, serializeWithSections } from '../../../io/save/sections';
import { adoptPlanet, settlePlanetName } from '../../../io/storage/planet-library';
import { __resetTextVerdicts, recordTextVerdict } from '../../../state/text-verdicts';
import { createGridState } from '../../../core/model/template';
import { getMapTemplate } from '../../../config/maps';
import { planetFixture } from '../../_support/planet';
import { TEST_NAMING } from '../../_support/exportable';

const OPTIONS = { carry: carrying('annotations', 'notes'), pretty: false };

beforeEach(() => localStorage.clear());
afterEach(() => __resetTextVerdicts());

describe('exportableState', () => {
  it('hands a built-in map without custom tags on as it is', () => {
    const state = createGridState(getMapTemplate('hexia'));
    expect(exportableState(state, TEST_NAMING)).toBe(state);
  });

  it('names a custom planet by its default name until its name is approved', () => {
    const template = { ...planetFixture(), name: { en: 'Bay' } };
    const state = createGridState(template);
    const entry = adoptPlanet(template);
    expect(exportableState(state, TEST_NAMING).template.name).toEqual({ en: 'My planet 1' });
    settlePlanetName(entry.entryId, 'Bay', null);
    expect(shownCustomPlanetName(template, TEST_NAMING)).toBe('Bay');
    expect(exportableState(state, TEST_NAMING).template).toBe(template);
    expect(state.template.name.en).toBe('Bay');
  });

  it('keeps only the custom tags the text check approved', () => {
    const state = createGridState(getMapTemplate('hexia'));
    state.annotations = {
      items: [], visible: true, locked: false,
      customTags: [{ id: 'custom:a', text: 'Orchard row' }, { id: 'custom:b', text: 'North pier' }],
    };
    recordTextVerdict('Orchard row', true);
    recordTextVerdict('North pier', false);
    expect(exportableState(state, TEST_NAMING).annotations?.customTags).toEqual([{ id: 'custom:a', text: 'Orchard row' }]);
    expect(state.annotations.customTags).toHaveLength(2);
  });

  it('is the only way into either exporter', () => {
    const state = createGridState(getMapTemplate('hexia'));
    // @ts-expect-error a raw map has not passed the export policy
    void (() => serializeWithSections(state, OPTIONS));
    // @ts-expect-error a raw map has not passed the export policy
    void (() => buildShareCode(state, null, { appVersion: 'test', saveVersion: 1 }, 1600));
    expect(serializeWithSections(exportableState(state, TEST_NAMING), OPTIONS)).toContain('"templateId":"hexia"');
  });
});
