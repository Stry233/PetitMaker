/**
 * The devtools banner: importing the module prints nothing (main.tsx decides when), the call
 * prints the island and the invitation, and the invitation carries the ONE repository URL.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { printConsoleBanner } from '../console-banner';
import { LEGAL } from '../legal/config';
import { APP_NAME } from '../version';

afterEach(() => vi.restoreAllMocks());

describe('printConsoleBanner', () => {
  it('prints the drawing and the invitation with the canonical repo URL', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printConsoleBanner();
    expect(log).toHaveBeenCalledTimes(2);
    const drawing = String(log.mock.calls[0]![0]);
    expect(drawing.split("\n").length).toBeGreaterThan(20);
    expect(drawing).toContain('█');
    const invite = String(log.mock.calls[1]![0]);
    expect(invite).toContain(APP_NAME);
    expect(invite).toContain(LEGAL.repoUrl);
  });

  it('prints nothing at import time', async () => {
    // main.tsx is the one caller; a module that printed on import would spam every test file that
    // touches anything importing it.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../console-banner');
    expect(log).not.toHaveBeenCalled();
  });
});
