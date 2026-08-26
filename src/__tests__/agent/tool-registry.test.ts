import { describe, it, expect } from 'vitest';
import { TOOL_SCHEMAS, TOOL_HANDLERS, WRITE_TOOLS, SUBAGENT_TOOL_SCHEMAS } from '../../agent/tools';

// Drift guard for the agent tool surface. The schema (what the model sees) and
// the dispatch registry (what runs) must describe exactly the same set of tools,
// and write-ness must be declared in the registry — otherwise a tool can be
// advertised with no handler, dispatched with no schema, or (the safety bug) a
// mutating tool can slip past the approval gate by being absent from WRITE_TOOLS.
describe('agent tool surface parity', () => {
  const schemaNames = TOOL_SCHEMAS.map((s) => s.name).sort();
  const handlerNames = Object.keys(TOOL_HANDLERS).sort();

  /** `update_plan` is the ONE advertised tool with no handler here, and it is answered rather than
   *  unimplemented: the loop intercepts the call before the executor and appends the `plan` event
   *  itself, because the plan is a fact of the LOG and the call is gated at plan scope
   *  (`core/loop.ts:handleUpdatePlan`). Named here so the exception cannot grow silently. */
  const LOOP_ANSWERED = ['update_plan'];

  it('every TOOL_SCHEMAS entry has a dispatch handler, bar the ones the loop answers', () => {
    expect(handlerNames).toEqual(schemaNames.filter((n) => !LOOP_ANSWERED.includes(n)));
  });

  it('every dispatch handler has a schema: nothing runs that the model was never offered', () => {
    for (const name of handlerNames) expect(schemaNames).toContain(name);
  });

  it('WRITE_TOOLS is exactly the registry entries flagged write', () => {
    const declaredWrite = Object.entries(TOOL_HANDLERS)
      .filter(([, def]) => def.write)
      .map(([name]) => name)
      .sort();
    expect([...WRITE_TOOLS].sort()).toEqual(declaredWrite);
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

  it('the subagent schema set is the full set minus the parent-only surfaces', () => {
    // delegate_task (no recursive delegation), update_plan (the plan is the
    // PARENT's progress surface), suggest_reply (subagents never speak to the user)
    const subNames = SUBAGENT_TOOL_SCHEMAS.map((s) => s.name).sort();
    expect(subNames).toEqual(schemaNames.filter((n) => !['delegate_task', 'update_plan', 'suggest_reply', 'export_map'].includes(n)));
  });
});
