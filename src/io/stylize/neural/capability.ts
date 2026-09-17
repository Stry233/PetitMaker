/*
 * capability.ts — whether this engine can run the on-device students at all.
 *
 * The ONNX runtime ships here in its SIMD build only, so a WebAssembly engine without SIMD cannot
 * load the models however willing it is. That is a fixed fact about the engine, so it is probed
 * once and remembered.
 */
import { simd } from 'wasm-feature-detect';

let known: boolean | null = null;
let probe: Promise<boolean> | null = null;

/** Whether the on-device neural packs can run here. */
export function neuralPacksUsable(): Promise<boolean> {
  probe ??= Promise.resolve()
    .then(() => (typeof WebAssembly === 'undefined' ? false : simd()))
    .catch(() => false)
    .then((ok) => (known = ok));
  return probe;
}

/** The remembered answer, or null while the probe is still running. */
export function neuralPacksUsableNow(): boolean | null {
  return known;
}
