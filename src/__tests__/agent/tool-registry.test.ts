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

  it('every TOOL_SCHEMAS entry has a dispatch handler and vice versa', () => {
    expect(handlerNames).toEqual(schemaNames);
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

  it('the subagent schema set is the full set minus the parent-only surfaces', () => {
    // delegate_task (no recursive delegation), update_plan (the plan is the
    // PARENT's progress surface), suggest_reply (subagents never speak to the user)
    const subNames = SUBAGENT_TOOL_SCHEMAS.map((s) => s.name).sort();
    expect(subNames).toEqual(schemaNames.filter((n) => !['delegate_task', 'update_plan', 'suggest_reply', 'export_map'].includes(n)));
  });
});
