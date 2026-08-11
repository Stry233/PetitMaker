/*
 * frame.ts — where the Site Log stands, and what it is painted on.
 *
 * The five zone components (header row, dock, log, composer, setup screen) were written against one
 * panel's gutter: a 628-wide column at design x 172, with the composer at 946. The rect travels as
 * context rather than as a second copy of those numbers, so a component reads `useAgentFrame()` and
 * never has to know which surface is mounting it.
 *
 * The two surface colours ride along for the same reason. They are the only values a host repaints
 * (the log's paper and the pad behind the composer and the header's square buttons); everything
 * inside a card is fixed.
 */
import { createContext, useContext } from 'react';
import { colors } from '../design/styles';

export interface AgentFrame {
  /** Design x of the column's left edge, inside whatever box the section is mounted in. */
  x: number;
  /** Design width of the column. */
  w: number;
  /** Design px from the section's own top down to the composer's top. */
  composerTop: number;
  /** Design height of the whole section, which is what the setup screen fills. */
  height: number;
  /** The log's paper. */
  paper: string;
  /** The composer pad, and the header's square buttons. */
  pad: string;
}

/** The context's default: the gutter the five zone components were originally authored against.
 *  Every mounted section is inside a provider, so this is what a component measures against only in
 *  a test that renders one on its own. */
const DEFAULT_AGENT_FRAME: AgentFrame = {
  x: 172,
  w: 628,
  composerTop: 946,
  height: 1100,
  paper: '#F7F3EA',
  pad: colors.surfaceSecondary,
};

const AgentFrameContext = createContext<AgentFrame>(DEFAULT_AGENT_FRAME);

export const AgentFrameProvider = AgentFrameContext.Provider;

export function useAgentFrame(): AgentFrame {
  return useContext(AgentFrameContext);
}
