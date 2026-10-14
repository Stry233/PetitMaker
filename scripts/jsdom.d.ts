// Declarations for jsdom, which ships none: the surface the build scripts and tests use.
declare module 'jsdom' {
  export interface ConstructorOptions {
    contentType?: string;
    url?: string;
    runScripts?: 'dangerously' | 'outside-only';
  }
  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions);
    readonly window: Window & typeof globalThis;
  }
}
