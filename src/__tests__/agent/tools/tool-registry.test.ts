import { describe, it, expect } from 'vitest';
import { PROTOCOL } from '../../../agent/core/protocol';
import { writesMap } from '../../../agent/core/tool-facts';
import { executeToolCall, TOOLS, TOOL_FACTS, TOOL_NAMES, wireSchemas, type AgentToolDeps } from '../../../agent/tools';

/** The spec a name declares, read off the registry's own table. */
const toolSpec = (name: string) => (TOOLS as Partial<Record<string, { run?: unknown; access?: unknown; parentOnly?: boolean }>>)[name];
const parentOnly = (name: string): boolean => toolSpec(name)?.parentOnly === true;

// Drift guard for the agent tool surface. Every derived view reads the one spec per tool, so these
// pin what the specs must agree on: a tool either runs here or is a protocol tool, and write-ness is
// declared on the spec, so a mutating tool cannot slip past the approval gate.
describe('agent tool surface parity', () => {
  const schemaNames = wireSchemas().map((s) => s.name).sort();

  /** The advertised tools with no `run` are the protocol tools the loop or the executor answers. */
  const EXECUTOR_ANSWERED = [PROTOCOL.delegate];

  it('names every spec once, in wire order', () => {
    expect(Object.keys(TOOLS)).toEqual([...TOOL_NAMES]);
    expect(wireSchemas().map((s) => s.name)).toEqual([...TOOL_NAMES]);
  });

  it('every spec runs here unless it is a protocol tool, which never runs here', () => {
    const protocol: ReadonlySet<string> = new Set(Object.values(PROTOCOL));
    for (const name of TOOL_NAMES) expect(Boolean(toolSpec(name)!.run), name).toBe(!protocol.has(name));
    for (const name of protocol) expect(TOOL_NAMES as readonly string[], name).toContain(name);
  });

  it('the tool facts read each spec\'s declared access, so wide tools and delegation write', () => {
    for (const name of TOOL_NAMES) expect(TOOL_FACTS.access(name), name).toBe(toolSpec(name)!.access);
    for (const name of EXECUTOR_ANSWERED) expect(writesMap(TOOL_FACTS, name), name).toBe(true);
    expect(TOOL_FACTS.access('no_such_tool')).toBeUndefined();
  });

  /**
   * The one budget a model is given, and the UI that has to hold it.
   *
   * `suggest_reply`'s answer is the only model-authored string in the panel with a hard clip: it
   * stands inside the composer's field under `nowrap` + ellipsis, so characters past the field's
   * width are lost — where the says line expands on a tap and a stage label wraps. The field holds
   * about 30 characters in a Latin script and about 15 in CJK, on the same line that also asks for
   * the user's own language. The number is what the model obeys, so it is pinned: 60 must not appear
   * anywhere in the licence, and the licence must name both scripts.
   */
  it('licenses suggest_reply the room the field actually has, in both scripts', () => {
    const schema = wireSchemas().find((s) => s.name === 'suggest_reply')!;
    const said = `${schema.description} ${JSON.stringify(schema.parameters)}`;
    expect(said).not.toMatch(/\b60\b/);
    expect(said).toMatch(/\b30\b/);
    expect(said).toMatch(/\b15\b/);
    // And it says why the number matters, rather than only stating one: a clip is not a wrap.
    expect(schema.description).toMatch(/cuts off/i);
  });

  it('offers a subagent every tool but the parent-only ones, and no way to delegate again', () => {
    const subNames = wireSchemas({ subagent: true }).map((s) => s.name);
    for (const name of schemaNames) expect(subNames.includes(name), name).toBe(!parentOnly(name));
    expect(subNames).not.toContain('delegate_task');
  });

  it('keeps every protocol tool, and the user-facing export, parent-only', () => {
    for (const name of Object.values(PROTOCOL)) expect(parentOnly(name), name).toBe(true);
    // export_map opens a dialog for the user to confirm, which a subagent never speaks to.
    const exportMap = wireSchemas().find((s) => s.name === 'export_map')!;
    expect(exportMap.description).toMatch(/for the user/i);
    expect(parentOnly(exportMap.name)).toBe(true);
  });
});

describe('a tool that throws', () => {
  it('answers with the redacted crash message the loop also uses', async () => {
    const deps = {
      getState: () => { throw new Error('read failed with sk-abcdefghijklmnopqrstuvwx'); },
      getExecutor: () => { throw new Error('unused'); },
      getRegion: () => [],
    } as unknown as AgentToolDeps;
    const r = await executeToolCall({ id: 'c1', name: 'inspect_region', input: { x1: 0, y1: 0, x2: 2, y2: 2 } }, deps);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/^\(system\) The tool crashed: /);
    expect(r.content).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });
});
