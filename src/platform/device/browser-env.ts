/**
 * What kind of browser the page runs in: an app's built-in browser rather than a real one, and an
 * engine older than the CSS zoom the interface is measured against.
 *
 * These WebViews (the in-app browsers of messaging and social apps) ship cut-down engines: some
 * lack WebGL2 or the File System Access API, some block downloads, some never fire
 * `screen.orientation`. The editor leans on all of that, so a visitor arriving through one should
 * be told to open the page properly before they hit a feature that silently does nothing.
 *
 * Detection is by user agent, which is a guess and nothing more — agents are freely spoofed, and
 * new WebViews appear constantly. So the only thing built on this is a dismissible notice. Nothing
 * is blocked, nothing is disabled, and a false positive costs the user one dismissal.
 */

/** Tokens that identify a known in-app WebView. Lowercase; matched as substrings. */
const IN_APP_TOKENS: readonly string[] = [
  'micromessenger',   // WeChat
  'qq/',              // QQ
  'weibo',
  'douyin', 'aweme',  // Douyin / TikTok
  'bytedancewebview',
  'xiaohongshu',
  'alipayclient',
  'dingtalk',
  'baiduboxapp',
  'ucbrowser',
  'quark',
  'kakaotalk',
  'line/',
  'fban', 'fbav', 'fb_iab', // Facebook
  'instagram',
  'twitter',
  'snapchat',
  'linkedinapp',
  'pinterest',
];

/**
 * iOS makes this harder: every browser there is WebKit, so the engine tells you nothing. A real
 * iOS browser identifies itself (Safari, CriOS, FxiOS, EdgiOS…); a WKWebView embedded in an app
 * carries the OS string and no browser token at all, which is the signature used here.
 */
function isBareIosWebView(ua: string): boolean {
  const isIos = /iphone|ipad|ipod/.test(ua);
  if (!isIos) return false;
  return !/(safari|crios|fxios|edgios|opios|chrome)/.test(ua);
}

/** Android's WebView says so directly, via the `; wv` build token. */
function isAndroidWebView(ua: string): boolean {
  return /android/.test(ua) && /;\s*wv\)/.test(ua);
}

/** The decision over a user-agent string. */
function isInAppBrowserUA(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  if (IN_APP_TOKENS.some((token) => ua.includes(token))) return true;
  return isAndroidWebView(ua) || isBareIosWebView(ua);
}

/** The live answer for this page, false where there is no navigator (SSR / tests). */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
  return isInAppBrowserUA(navigator.userAgent);
}


const PROBE_WIDTH = 200;
const PROBE_ZOOM = 0.5;

let rectsInScreenPx: boolean | null = null;

/** A 200px box under zoom 0.5 measures 100 on a standardized engine and 200 on a legacy one; a
 *  reading with no layout (jsdom) counts as screen pixels. */
function probeZoomedRects(): boolean {
  if (typeof document === 'undefined' || !document.body) return true;
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;left:0;top:0;width:${PROBE_WIDTH}px;height:10px;zoom:${PROBE_ZOOM};visibility:hidden;pointer-events:none`;
  document.documentElement.appendChild(box);
  const width = box.getBoundingClientRect().width;
  box.remove();
  return Math.abs(width - PROBE_WIDTH) > 1;
}

/** Whether this engine reports a zoomed subtree's rects in screen pixels, as the standard has it;
 *  Chromium before 128 reports them in the subtree's own CSS pixels. Probed once, at first use. */
export function zoomedRectsAreVisual(): boolean {
  if (rectsInScreenPx === null) rectsInScreenPx = probeZoomedRects();
  return rectsInScreenPx;
}

/** Clears the cached probe so a test can pose another engine. */
export function __resetZoomedRectsProbe(): void {
  rectsInScreenPx = null;
}
