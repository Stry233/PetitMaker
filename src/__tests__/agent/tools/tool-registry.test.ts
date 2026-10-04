import { describe, it, expect } from 'vitest';
import { TOOL_SCHEMAS, TOOL_HANDLERS, WRITE_TOOLS, SUBAGENT_TOOL_SCHEMAS, PARENT_ONLY_TOOLS } from '../../../agent/tools';

// Drift guard for the agent tool surface. The schema (what the model sees) and
// the dispatch registry (what runs) must describe exactly the same set of tools,
// and write-ness must be declared in the registry — otherwise a tool can be
// advertised with no handler, dispatched with no schema, or (the safety bug) a
// mutating tool can slip past the approval gate by being absent from WRITE_TOOLS.
describe('agent tool surface parity', () => {
  const schemaNames = TOOL_SCHEMAS.map((s) => s.name).sort();
  const handlerNames = Object.keys(TOOL_HANDLERS).sort();

  /** The advertised tools with no handler here are answered rather than unimplemented. The loop
   *  intercepts `update_plan` and appends the `plan` event itself, because the plan is a fact of the
   *  LOG and the call is gated at plan scope (`core/loop.ts:handleUpdatePlan`), and it acknowledges
   *  `suggest_reply` in place. `exec/executor.ts` answers `delegate_task` with the job's adapter.
   *  Named here so the exceptions cannot grow silently. */
  const LOOP_ANSWERED = ['update_plan', 'suggest_reply'];
  const EXECUTOR_ANSWERED = ['delegate_task'];

  it('every TOOL_SCHEMAS entry has a dispatch handler, bar the ones the loop or executor answers', () => {
    expect(handlerNames).toEqual(schemaNames.filter((n) => !LOOP_ANSWERED.includes(n) && !EXECUTOR_ANSWERED.includes(n)));
  });

  it('every dispatch handler has a schema: nothing runs that the model was never offered', () => {
    for (const name of handlerNames) expect(schemaNames).toContain(name);
  });

  it('WRITE_TOOLS is exactly the registry entries flagged write, plus delegation', () => {
    const declaredWrite = Object.entries(TOOL_HANDLERS)
      .filter(([, def]) => def.write)
      .map(([name]) => name);
    expect([...WRITE_TOOLS].sort()).toEqual([...declaredWrite, ...EXECUTOR_ANSWERED].sort());
  });

  it('every write tool has a schema (gated tools are real tools)', () => {
    for (const name of WRITE_TOOLS) expect(schemaNames).toContain(name);
  });

  /**
   * THE ONE BUDGET A MODEL IS GIVEN, AND THE UI THAT HAS TO HOLD IT.
   *
   * `suggest_reply`'s answer is the only model-authored string in the panel with a HARD clip: it
   * stands inside the composer's field under `nowrap` + ellipsis, so characters past the field's
   * width are lost — where the says line expands on a tap and a stage label wraps. The field holds
   * about 30 characters in a Latin script and about 15 in CJK, on the same line that also asks for
   * the user's own language. The number is what the model obeys, so it is pinned: 60 must not appear
   * anywhere in the licence, and the licence must name both scripts.
   */
  it('licenses suggest_reply the room the field actually has, in both scripts', () => {
    const schema = TOOL_SCHEMAS.find((s) => s.name === 'suggest_reply')!;
    const said = `${schema.description} ${JSON.stringify(schema.inputSchema)}`;
    expect(said).not.toMatch(/\b60\b/);
    expect(said).toMatch(/\b30\b/);
    expect(said).toMatch(/\b15\b/);
    // And it says WHY the number matters, rather than only stating one: a clip is not a wrap.
    expect(schema.description).toMatch(/cuts off/i);
  });

  it('offers a subagent every tool but the parent-only ones, and no way to delegate again', () => {
    const subNames = SUBAGENT_TOOL_SCHEMAS.map((s) => s.name);
    for (const name of PARENT_ONLY_TOOLS) expect(schemaNames, name).toContain(name);
    for (const name of schemaNames) expect(subNames.includes(name), name).toBe(!PARENT_ONLY_TOOLS.has(name));
    expect(subNames).not.toContain('delegate_task');
  });

  it('keeps every loop- and executor-answered tool, and the user-facing export, parent-only', () => {
    for (const name of [...LOOP_ANSWERED, ...EXECUTOR_ANSWERED]) expect(PARENT_ONLY_TOOLS.has(name), name).toBe(true);
    // export_map opens a dialog for the user to confirm, which a subagent never speaks to.
    const exportMap = TOOL_SCHEMAS.find((s) => s.name === 'export_map')!;
    expect(exportMap.description).toMatch(/for the user/i);
    expect(PARENT_ONLY_TOOLS.has(exportMap.name)).toBe(true);
  });
});
