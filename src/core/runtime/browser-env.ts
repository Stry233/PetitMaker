/**
 * Whether the page is running inside an app's built-in browser rather than a real one.
 *
 * These WebViews (the in-app browsers of messaging and social apps) ship cut-down engines: some
 * lack WebGL2 or the File System Access API, some block downloads, some never fire
 * `screen.orientation`. The editor leans on all of that, so a visitor arriving through one should
 * be told to open the page properly before they hit a feature that silently does nothing.
 *
 * Detection is by USER AGENT, which is a guess and nothing more — agents are freely spoofed, and
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
 * carries the OS string and NO browser token at all, which is the signature used here.
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

/** Pure predicate over a user-agent string, so the decision is testable without a browser. */
export function isInAppBrowserUA(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  if (IN_APP_TOKENS.some((token) => ua.includes(token))) return true;
  return isAndroidWebView(ua) || isBareIosWebView(ua);
}

/** The live answer for this page, false where there is no navigator (SSR / tests). */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined' || !navigator.userAgent) return false;
  return isInAppBrowserUA(navigator.userAgent);
}

