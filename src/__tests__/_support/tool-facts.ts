/** Tool facts for a stub executor: the named tools write or reach wide, the rest read, and the
 *  shipped registry decides which calls review the map. */
import type { ToolFacts } from '../../agent/core/tool-facts';
import { TOOL_FACTS } from '../../agent/tools';

export function stubFacts(write: Iterable<string> = [], wide: Iterable<string> = []): ToolFacts {
  const writes = new Set(write);
  const wides = new Set(wide);
  return {
    access: (name) => (wides.has(name) ? 'wide' : writes.has(name) ? 'write' : 'read'),
    verifies: TOOL_FACTS.verifies,
    footprint: TOOL_FACTS.footprint,
    guides: TOOL_FACTS.guides,
  };
}
