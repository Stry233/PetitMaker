import { describe, it, expect } from 'vitest';
import { iconUrl } from '../../assets/icon-urls';

// Guards the recursive icon glob (`./icons/**/*.png`): icons live in `catalog/`
// (item sprites) and `ui/` (chrome) subfolders, looked up by basename. If the
// glob ever stops resolving a subfolder, these fail instead of icons silently
// vanishing in the app.
describe('iconUrl', () => {
  it('resolves catalog item sprites (catalog/ subfolder)', () => {
    expect(iconUrl('tree-apple')).toBeTruthy();
    expect(iconUrl('bridge-iron')).toBeTruthy();
    expect(iconUrl('ramp-plank')).toBeTruthy();
  });

  it('resolves UI / chrome icons (ui/ subfolder)', () => {
    expect(iconUrl('brush-free')).toBeTruthy();
    expect(iconUrl('eye-open')).toBeTruthy();
    expect(iconUrl('mountain')).toBeTruthy();
    // The Generate panel's AI Agent tile names this one; the glob is what wires it, so a
    // rename or a move of the file would leave that tile blank with nothing else complaining.
    expect(iconUrl('agent')).toBeTruthy();
  });

  it('returns undefined for an unknown icon', () => {
    expect(iconUrl('does-not-exist')).toBeUndefined();
  });
});
