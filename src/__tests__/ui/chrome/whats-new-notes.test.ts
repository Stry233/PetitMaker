import { describe, it, expect } from 'vitest';
import { compareVersions, notesSince, releaseSections, whatsNewDue } from '../../../ui/chrome/modals/whats-new/notes';

const LOG = `# Changelog

Intro line.

## [Unreleased]

### Added

- A new thing.

## [1.2.0] - 2026-09-20

### Changed

- Something changed.

## [1.1.15] - 2026-09-14

### Fixed

- A fix.

## [1.0.51] - 2026-09-01

### Added

- Old news.
`;

describe('release sections', () => {
  it('splits the changelog into its version sections, newest first, without the preamble', () => {
    const sections = releaseSections(LOG);
    expect(sections.map((s) => s.version)).toEqual(['unreleased', '1.2.0', '1.1.15', '1.0.51']);
    expect(sections[1]!.heading).toBe('[1.2.0] - 2026-09-20');
    expect(sections[1]!.body).toContain('- Something changed.');
    expect(sections[1]!.body).not.toContain('[1.1.15]');
  });

  it('reads the Chinese unreleased heading the same way', () => {
    expect(releaseSections('## [未发布]\n\n- 新内容\n')[0]!.version).toBe('unreleased');
  });
});

describe('version order', () => {
  it('orders numerically and ignores a development suffix', () => {
    expect(compareVersions('1.2.0', '1.1.15')).toBeGreaterThan(0);
    expect(compareVersions('1.1.15', '1.2.0')).toBeLessThan(0);
    expect(compareVersions('1.2.3-dev', '1.2.3')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
  });
});

describe('the notes a returning browser is owed', () => {
  it('shows every section newer than the version last seen, the unreleased one standing for the current build', () => {
    const notes = notesSince(LOG, '1.1.15', '1.2.26-dev');
    expect(notes.map((n) => n.version)).toEqual(['1.2.26-dev', '1.2.0']);
  });

  it('shows the newest section alone when no version was ever recorded', () => {
    expect(notesSince(LOG, null, '1.2.26-dev').map((n) => n.version)).toEqual(['1.2.26-dev']);
    const released = LOG.replace(/## \[Unreleased\][\s\S]*?(?=## \[1\.2\.0\])/, '');
    expect(notesSince(released, null, '1.2.0').map((n) => n.version)).toEqual(['1.2.0']);
  });

  it('drops sections with nothing to list, including an unreleased placeholder', () => {
    const quiet = LOG.replace('- A new thing.', '_Nothing yet._');
    expect(notesSince(quiet, '1.1.15', '1.2.26-dev').map((n) => n.version)).toEqual(['1.2.0']);
    expect(notesSince(quiet, '1.2.0', '1.2.26-dev')).toEqual([]);
  });

  it('shows nothing for the version already seen', () => {
    expect(notesSince(LOG, '1.2.26-dev', '1.2.26-dev')).toEqual([]);
  });
});

describe('whether the window is due', () => {
  const notes = notesSince(LOG, '1.1.15', '1.2.0');
  it('is due for a returning browser on a version it has not seen, with notes to show', () => {
    expect(whatsNewDue({ returning: true, lastSeen: '1.1.15', current: '1.2.0', notes })).toBe(true);
  });
  it('is never due on a first visit, on the same version, or with nothing to say', () => {
    expect(whatsNewDue({ returning: false, lastSeen: null, current: '1.2.0', notes })).toBe(false);
    expect(whatsNewDue({ returning: true, lastSeen: '1.2.0', current: '1.2.0', notes })).toBe(false);
    expect(whatsNewDue({ returning: true, lastSeen: '1.1.15', current: '1.2.0', notes: [] })).toBe(false);
  });
});
