// Context-model residual coder for the cell token grid.
// Legality priors: cells match the predictor / their W/N neighbours overwhelmingly often; explicit
// cells are rare and bounded.
//
// Coding model: per-cell fields are coded with adaptive binary models driven by a range coder.
// Contexts key on whether the west/north neighbours matched their predictions (samePred is indexed
// by whether the PREVIOUS cell matched), so runs of correct predictions cost a fraction of a bit
// each. When a cell must be spelled out, its elevation is delta-coded (zigzag) against the
// W/N-predicted elevation, and the corner codes, patchOnly flag and patchBase tier ride the same
// per-field adaptive models. Encoder and decoder walk identical model state, so no side
// information is needed.
import { RangeEncoder, RangeDecoder, BitModel, TreeModel, UintModel, encodeTree, decodeTree, encodeUint, decodeUint, zigzag, unzigzag } from './bitio';
import { parseToken, tokenOf, type CellFields } from './grid-io';

const CORNERS = 'SF1234E';

class Models {
  samePred = [new BitModel(), new BitModel()];
  sameW = new BitModel();
  sameN = new BitModel();
  hasTerrain = new BitModel();
  type = new TreeModel(2);
  elevDelta = new UintModel();
  hasCorners = new BitModel();
  corner = [new TreeModel(3), new TreeModel(3), new TreeModel(3), new TreeModel(3)];
  patchOnly = new BitModel();
  hasPatchBase = new BitModel();
  patchBase = new TreeModel(4);
}

function predElev(tokens: string[], i: number, width: number): number {
  const x = i % width;
  const w = x > 0 ? parseToken(tokens[i - 1]!) : null;
  if (w) return w.elevation;
  const n = i >= width ? parseToken(tokens[i - width]!) : null;
  return n ? n.elevation : 1;
}

export function encodeTerrain(enc: RangeEncoder, tokens: string[], predicted: string[], width: number): void {
  const M = new Models();
  let prevMatched = 1;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!, x = i % width;
    const matches = tok === predicted[i] ? 1 : 0;
    enc.encodeBit(M.samePred[prevMatched]!, matches === 1 ? 0 : 1); // 0 = matches (skewed)
    prevMatched = matches;
    if (matches) continue;
    if (x > 0) { const s = tok === tokens[i - 1] ? 0 : 1; enc.encodeBit(M.sameW, s as 0 | 1); if (s === 0) continue; }
    if (i >= width) { const s = tok === tokens[i - width] ? 0 : 1; enc.encodeBit(M.sameN, s as 0 | 1); if (s === 0) continue; }
    const f = parseToken(tok);
    enc.encodeBit(M.hasTerrain, f ? 1 : 0);
    if (!f) continue;
    encodeTree(enc, M.type, f.type);
    encodeUint(enc, M.elevDelta, zigzag(f.elevation - predElev(tokens, i, width)));
    enc.encodeBit(M.hasCorners, f.corners ? 1 : 0);
    if (f.corners) for (let k = 0; k < 4; k++) encodeTree(enc, M.corner[k]!, CORNERS.indexOf(f.corners[k]!));
    // Γ-patch fields: patchOnly marks a cosmetic corner fillet; patchBase is its real support tier.
    enc.encodeBit(M.patchOnly, f.patchOnly ? 1 : 0);
    enc.encodeBit(M.hasPatchBase, f.patchBase !== null ? 1 : 0);
    if (f.patchBase !== null) encodeTree(enc, M.patchBase, f.patchBase);
  }
}

export function decodeTerrain(dec: RangeDecoder, predicted: string[], width: number): string[] {
  const M = new Models();
  const tokens: string[] = new Array(predicted.length);
  let prevMatched = 1;
  for (let i = 0; i < predicted.length; i++) {
    const x = i % width;
    const differs = dec.decodeBit(M.samePred[prevMatched]!);
    prevMatched = differs ? 0 : 1;
    if (!differs) { tokens[i] = predicted[i]!; continue; }
    if (x > 0 && dec.decodeBit(M.sameW) === 0) { tokens[i] = tokens[i - 1]!; continue; }
    if (i >= width && dec.decodeBit(M.sameN) === 0) { tokens[i] = tokens[i - width]!; continue; }
    if (dec.decodeBit(M.hasTerrain) === 0) { tokens[i] = '_'; continue; }
    const type = decodeTree(dec, M.type);
    // predElev needs decoded W/N — tokens[] is filled left-to-right so this mirrors the encoder.
    const elevation = unzigzag(decodeUint(dec, M.elevDelta)) + predElev(tokens, i, width);
    const f: CellFields = { type, elevation, corners: null, patchOnly: false, patchBase: null };
    if (dec.decodeBit(M.hasCorners) === 1) {
      let cs = '';
      for (let k = 0; k < 4; k++) cs += CORNERS[decodeTree(dec, M.corner[k]!)]!;
      f.corners = cs;
    }
    f.patchOnly = dec.decodeBit(M.patchOnly) === 1;
    if (dec.decodeBit(M.hasPatchBase) === 1) f.patchBase = decodeTree(dec, M.patchBase);
    tokens[i] = tokenOf(f);
  }
  return tokens;
}
