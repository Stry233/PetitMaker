/** The deployment target id Vite injected into this bundle, or undefined where no build define ran
 *  (unit tests, Node-based generators). Read at call time, so a test may stub the global. */
export function bundledTargetId(): string | undefined {
  return typeof __PETIT_TARGET__ === 'string' ? __PETIT_TARGET__ : undefined;
}
