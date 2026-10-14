/**
 * The tool schemas the model sees, byte for byte, for the main loop and for a delegated helper. A
 * change to a name, a description, a parameter or their order changes what every provider is sent,
 * so it shows here as a snapshot difference to review rather than as a silent prompt change.
 */
import { describe, it, expect } from 'vitest';
import { wireSchemas } from '../../../agent/tools';

describe('agent wire schemas', () => {
  it('the main loop sends these tool schemas', async () => {
    await expect(`${JSON.stringify(wireSchemas(), null, 1)}\n`).toMatchFileSnapshot('__snapshots__/wire-schemas.json');
  });

  it('a delegated helper sends these tool schemas', async () => {
    await expect(`${JSON.stringify(wireSchemas({ subagent: true }), null, 1)}\n`).toMatchFileSnapshot('__snapshots__/wire-schemas-subagent.json');
  });
});
