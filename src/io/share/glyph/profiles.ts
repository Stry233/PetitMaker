import { codedBits } from './convolution';
import { CURRENT_GRID_ROWS, CURRENT_TOP_ROWS, GRID_COLS, RS_N } from './geometry';
import { PRODUCT_FOUR, type RGB } from './palette';

export interface GlyphProfile {
  readonly id: number;
  readonly name: string;
  readonly bits: 2;
  readonly colors: 4;
  readonly div: 1 | 2 | 3 | 4 | 6;
  readonly dataCols: number;
  readonly palette: readonly RGB[];
}

export interface GlyphPlan {
  readonly profile: GlyphProfile;
  readonly blocks: number;
  readonly dataBytes: number;
  readonly codewordBytes: number;
  readonly parityBytes: number;
  readonly streamBytes: number;
  readonly symbolCount: number;
  readonly moduleCount: number;
  readonly dataRows: number;
}

/** The outer code repairs bursts left by the soft convolutional decoder. */
export function parityPolicyFor(_profile: GlyphProfile): { target: number; minimum: number } {
  return { target: 0.125, minimum: 0.125 };
}

function profile(id: number, div: GlyphProfile['div']): GlyphProfile {
  return { id, name: `4-tone/${div}`, bits: 2, colors: 4, div, dataCols: GRID_COLS * div, palette: PRODUCT_FOUR };
}

export const GLYPH_PROFILES: readonly GlyphProfile[] = [profile(32, 1), profile(33, 2), profile(34, 3), profile(35, 4), profile(36, 6)];

export function planFor(payloadLen: number, profile: GlyphProfile): GlyphPlan | null {
  if (!Number.isInteger(payloadLen) || payloadLen < 1 || payloadLen > 12_000) return null;
  const target = parityPolicyFor(profile).target;
  const blocks = Math.ceil(payloadLen / Math.floor(RS_N * (1 - target)));
  const dataBytes = Math.ceil(payloadLen / blocks);
  const parityBytes = Math.ceil(dataBytes * target / (1 - target));
  const codewordBytes = dataBytes + parityBytes;
  const streamBytes = blocks * codewordBytes;
  const symbolCount = Math.ceil(codedBits(streamBytes) / profile.bits);
  const dataRows = (CURRENT_GRID_ROWS - CURRENT_TOP_ROWS) * profile.div;
  if (symbolCount > dataRows * profile.dataCols) return null;
  return { profile, blocks, dataBytes, codewordBytes, parityBytes, streamBytes, symbolCount,
    dataRows, moduleCount: dataRows * profile.dataCols };
}

export function choosePlan(payloadLen: number): GlyphPlan | null {
  for (const profile of GLYPH_PROFILES) {
    const plan = planFor(payloadLen, profile);
    if (plan) return plan;
  }
  return null;
}

/** Center the active rows without spending parity on empty capacity. */
export function dataCellAt(k: number, plan: GlyphPlan): { col: number; row: number } {
  const cols = plan.profile.dataCols;
  const row = Math.floor(k / cols);
  const rowLength = Math.min(cols, plan.symbolCount - row * cols);
  return {
    col: k % cols + Math.floor((cols - rowLength) / 2),
    row: row + Math.floor((plan.dataRows - Math.ceil(plan.symbolCount / cols)) / 2),
  };
}
