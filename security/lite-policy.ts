/** The offline container permits packaged resources and in-memory images only. */
export const LITE_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";
/** The policy for a host whose entry page loads its SDK: `LITE_CSP`, letting scripts come from exactly that address too. */
export function liteCsp(sdkScript: string | null): string {
  return sdkScript ? LITE_CSP.replace("script-src 'self'", `script-src 'self' ${sdkScript}`) : LITE_CSP;
}
