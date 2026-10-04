// jsdom ships no declarations; this covers the surface the build scripts use.
declare module 'jsdom' {
  export interface ConstructorOptions {
    contentType?: string;
    url?: string;
  }
  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions);
    readonly window: Window & typeof globalThis;
  }
}
