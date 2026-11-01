// @vitest-environment jsdom
/**
 * Help's pictured interface presses its own controls to show what they do; those presses come from a
 * script, never from the reader's device, so they must not switch the reader's input mode.
 */
import { afterEach, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { watchInputMode } from '../../../platform/device/input-mode';

const press = (el: Element) => {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

spec('UI-64', 'a press a pictured figure makes on its own inert controls leaves a touch reader in touch mode', () => {
  vi.useFakeTimers();
  const pictured = document.createElement('div');
  pictured.setAttribute('inert', '');
  const button = document.createElement('button');
  pictured.append(button);
  const live = document.createElement('button');
  document.body.append(pictured, live);
  const changes: string[] = [];
  const stop = watchInputMode((mode) => changes.push(mode), 'touch');
  press(button);
  vi.runAllTimers();
  expect(changes).toEqual([]);
  // The same press on the live interface is the reader's mouse.
  press(live);
  vi.runAllTimers();
  expect(changes).toEqual(['pc']);
  stop();
});
