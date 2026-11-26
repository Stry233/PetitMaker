/** The assistant's region as commands: its brush arms only beside an open panel and never over another surface's, and the painted region clears. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listCommands, runCommand } from '../../../editor/commands/run';
import { watchAgentRegionBrush } from '../../../editor/editing/region-brush';
import { createDefaultRegistry } from '../../../rules';
import { paintsRegion, regionOf } from '../../../state/editing/region';
import { useEditorStore } from '../../../state/store';
import { makeTemplate } from '../../_support/map-state';

const s = () => useEditorStore.getState();
const marking = () => listCommands().find((command) => command.id === 'assistant.region_marking')?.current;

beforeEach(() => {
  s().initMap(makeTemplate(30, 30), createDefaultRegistry());
  s().setAssistantOpen(true);
});

afterEach(() => {
  s().setSelectingRegion(false);
  s().setRegion([], 'agent');
  s().setAssistantOpen(false);
});

describe('assistant.region_marking', () => {
  it('switches the brush when run bare, sets it outright with `on`, and reports whether it paints', async () => {
    expect(marking()).toBe(false);
    expect(await runCommand('assistant.region_marking')).toMatchObject({ ok: true });
    expect(paintsRegion(s(), 'agent')).toBe(true);
    expect(marking()).toBe(true);
    expect(await runCommand('assistant.region_marking', { on: true })).toMatchObject({ ok: true });
    expect(paintsRegion(s(), 'agent')).toBe(true);
    expect(await runCommand('assistant.region_marking')).toMatchObject({ ok: true });
    expect(s().selectingRegion).toBe(false);
  });

  it('refuses while another surface marks its own region, and leaves that brush painting', async () => {
    s().setSelectingRegion(true, 'generator');
    expect(await runCommand('assistant.region_marking', { on: true })).toMatchObject({ ok: false });
    expect(await runCommand('assistant.region_marking')).toMatchObject({ ok: false });
    expect(s().selectingRegion).toBe(true);
    expect(paintsRegion(s(), 'agent')).toBe(false);
  });

  it('arms nothing behind a closed panel, where the session puts the brush down', async () => {
    const stop = watchAgentRegionBrush();
    s().setAssistantOpen(false);
    expect(await runCommand('assistant.region_marking', { on: true })).toMatchObject({ ok: false });
    expect(s().selectingRegion).toBe(false);
    stop();
  });
});

describe('assistant.region_clear', () => {
  it('clears the assistant\'s region and leaves Generate\'s scope', async () => {
    s().setRegion([{ x: 2, y: 2 }, { x: 3, y: 2 }], 'agent');
    s().setRegion([{ x: 8, y: 8 }], 'generator');
    expect(await runCommand('assistant.region_clear')).toMatchObject({ ok: true });
    expect(regionOf(s(), 'agent')).toEqual([]);
    expect(regionOf(s(), 'generator')).toHaveLength(1);
    s().setRegion([], 'generator');
  });
});
