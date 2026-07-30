// src/io/share/glyph/rs.ts — systematic Reed–Solomon over GF(256), FCR=0, generator
// root α^0..α^(nsym-1). Supports combined erasure + error correction (Berlekamp–Massey error
// locator seeded by the erasure locator, Chien search, Forney magnitudes). Returns the
// corrected DATA (parity stripped), or null when the codeword is uncorrectable.
import { gfMul, gfDiv, gfInv, gfPow } from './gf256';

// Polynomials are big-endian: index 0 = highest degree (Horner-friendly).
function polyScale(p: number[], x: number): number[] { return p.map((c) => gfMul(c, x)); }
function polyAdd(a: number[], b: number[]): number[] {
  const r = new Array(Math.max(a.length, b.length)).fill(0);
  for (let i = 0; i < a.length; i++) r[i + r.length - a.length] = a[i]!;
  for (let i = 0; i < b.length; i++) r[i + r.length - b.length] ^= b[i]!;
  return r;
}
function polyMul(a: number[], b: number[]): number[] {
  const r = new Array(a.length + b.length - 1).fill(0);
  for (let j = 0; j < b.length; j++) for (let i = 0; i < a.length; i++) r[i + j] ^= gfMul(a[i]!, b[j]!);
  return r;
}
function polyEval(p: number[], x: number): number { let y = p[0]!; for (let i = 1; i < p.length; i++) y = gfMul(y, x) ^ p[i]!; return y; }

function generator(nsym: number): number[] { let g = [1]; for (let i = 0; i < nsym; i++) g = polyMul(g, [1, gfPow(2, i)]); return g; }

export function rsEncode(data: Uint8Array, nsym: number): Uint8Array {
  const gen = generator(nsym);
  const buf = Array.from(data).concat(new Array(nsym).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = buf[i]!;
    if (coef !== 0) for (let j = 1; j < gen.length; j++) buf[i + j] = buf[i + j]! ^ gfMul(gen[j]!, coef);
  }
  const out = new Uint8Array(data.length + nsym);
  out.set(data, 0);
  for (let i = 0; i < nsym; i++) out[data.length + i] = buf[data.length + i]!;
  return out;
}

function syndromes(msg: number[], nsym: number): number[] {
  // [0, S0, S1, ...]; leading 0 simplifies the polynomial math below.
  const s = [0];
  for (let i = 0; i < nsym; i++) s.push(polyEval(msg, gfPow(2, i)));
  return s;
}

/** Erasure/error locator from coefficient-degree positions (measured from the right). */
function errataLocator(coefPos: number[]): number[] {
  let e = [1];
  for (const p of coefPos) e = polyMul(e, polyAdd([1], [gfPow(2, p), 0]));
  return e;
}

function errorEvaluator(synd: number[], errLoc: number[], nsym: number): number[] {
  const r = polyMul(synd, errLoc);
  return r.slice(r.length - (nsym + 1)); // = (synd · errLoc) mod x^(nsym+1)
}

/** Forney: given known error positions (msg indices), compute + apply magnitudes. */
function correctErrata(msg: number[], synd: number[], errPos: number[]): number[] | null {
  const coefPos = errPos.map((p) => msg.length - 1 - p);
  const errLoc = errataLocator(coefPos);
  const rsynd = synd.slice().reverse();
  const errEval = errorEvaluator(rsynd, errLoc, errLoc.length - 1); // big-endian; eval directly
  const X = coefPos.map((p) => gfPow(2, p));
  const E = new Array(msg.length).fill(0);
  for (let i = 0; i < X.length; i++) {
    const xiInv = gfInv(X[i]!);
    let locPrime = 1;
    for (let j = 0; j < X.length; j++) if (j !== i) locPrime = gfMul(locPrime, 1 ^ gfMul(xiInv, X[j]!));
    if (locPrime === 0) return null;
    let y = polyEval(errEval, xiInv);
    y = gfMul(X[i]!, y); // FCR=0 → multiply by X_i
    E[errPos[i]!] = gfDiv(y, locPrime);
  }
  return polyAdd(msg, E);
}

/** Berlekamp–Massey error locator over the Forney syndromes (erasure contribution removed). */
function findErrorLocator(fsynd: number[], nsym: number, eraseCount: number): number[] | null {
  let errLoc = [1];
  let oldLoc = [1];
  const syndShift = fsynd.length - nsym; // 0 for Forney syndromes (length nsym)
  for (let i = 0; i < nsym - eraseCount; i++) {
    const K = i + syndShift;
    let delta = fsynd[K]!;
    for (let j = 1; j < errLoc.length; j++) delta ^= gfMul(errLoc[errLoc.length - 1 - j]!, fsynd[K - j]!);
    oldLoc = oldLoc.concat([0]);
    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = polyScale(oldLoc, delta);
        oldLoc = polyScale(errLoc, gfInv(delta));
        errLoc = newLoc;
      }
      errLoc = polyAdd(errLoc, polyScale(oldLoc, delta));
    }
  }
  while (errLoc.length && errLoc[0] === 0) errLoc.shift();
  const errs = errLoc.length - 1;
  if ((errs - eraseCount) * 2 + eraseCount > nsym) return null; // too many to correct
  return errLoc;
}

/** Chien search over the full field: a root α^i of the locator means X_k = α^{-i} = α^{255-i};
 *  that is coefficient degree `coefPos`, i.e. byte index `nmess-1-coefPos`. */
function findErrors(errLoc: number[], nmess: number): number[] | null {
  const errs = errLoc.length - 1;
  const pos: number[] = [];
  for (let i = 0; i < 255; i++) {
    if (polyEval(errLoc, gfPow(2, i)) === 0) {
      const coefPos = (255 - i) % 255;
      if (coefPos < nmess) pos.push(nmess - 1 - coefPos);
    }
  }
  if (pos.length !== errs) return null;
  return pos;
}

export function rsDecode(codeword: Uint8Array, nsym: number, erasurePos: number[] = []): Uint8Array | null {
  if (erasurePos.length > nsym) return null;
  const msg = Array.from(codeword);
  const n = msg.length;
  const synd = syndromes(msg, nsym);
  if (synd.every((s) => s === 0)) return codeword.slice(0, n - nsym);

  // Forney syndromes (shift out the erasure contribution) for the BM error search.
  const fsynd = forneySyndromes(synd, erasurePos, n);
  const errLoc = findErrorLocator(fsynd, nsym, erasurePos.length);
  if (!errLoc) return null;
  const errPos = findErrors(errLoc, n);
  if (!errPos) return null;

  const allPos = erasurePos.concat(errPos);
  if (allPos.length > nsym) return null;
  const corrected = correctErrata(msg, synd, allPos);
  if (!corrected) return null;
  // Verify: a corrected codeword must have all-zero syndromes (else fail — never a wrong map).
  const check = syndromes(corrected, nsym);
  if (!check.every((s) => s === 0)) return null;
  return Uint8Array.from(corrected.slice(0, n - nsym));
}

function forneySyndromes(synd: number[], erasurePos: number[], n: number): number[] {
  // synd is [0, S0..]; drop the leading 0, then shift out each erasure. Length = nsym, no leading 0.
  const fsynd = synd.slice(1);
  for (const p of erasurePos) {
    const x = gfPow(2, n - 1 - p);
    for (let i = 0; i < fsynd.length - 1; i++) fsynd[i] = gfMul(fsynd[i]!, x) ^ fsynd[i + 1]!;
  }
  return fsynd;
}
