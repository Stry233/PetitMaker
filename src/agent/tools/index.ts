// Barrel: the agent tool surface (registry, dispatch, map context and the dependency contract).
export {
  TOOLS, TOOL_FACTS,
  checkToolArgs, executeToolCall, wireSchemas,
} from './registry';
export { TOOL_NAMES } from './names';
export { buildMapContext } from './inspect';
export type { AgentToolDeps } from './deps';
