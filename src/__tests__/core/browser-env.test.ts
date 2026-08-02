/**
 * In-app browser detection. It is a user-agent guess, so the tests that matter most are the
 * NEGATIVE ones: a false positive puts a notice in front of someone who does not need it, and the
 * portrait guard leans on the same signal.
 */
import { describe, it, expect } from 'vitest';
import { isInAppBrowserUA } from '../../core/runtime/browser-env';

const IN_APP = {
  wechat: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40(0x18002832) NetType/WIFI Language/zh_CN',
  androidWebView: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 302.0.0.23.113',
  facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS;FBDV/iPhone14,3]',
  bareIosWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  douyin: 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/107.0.0.0 Mobile Safari/537.36 aweme_1.0',
};

const REAL = {
  desktopChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  desktopFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  desktopSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  desktopEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
  iosFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 FxiOS/121.0 Mobile/15E148 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36',
};

describe('isInAppBrowserUA', () => {
  for (const [name, ua] of Object.entries(IN_APP)) {
    it(`spots ${name}`, () => expect(isInAppBrowserUA(ua)).toBe(true));
  }

  for (const [name, ua] of Object.entries(REAL)) {
    it(`leaves ${name} alone`, () => expect(isInAppBrowserUA(ua)).toBe(false));
  }

  it('tells an Android WebView from Android Chrome, which differ only by the wv token', () => {
    expect(isInAppBrowserUA(IN_APP.androidWebView)).toBe(true);
    expect(isInAppBrowserUA(REAL.androidChrome)).toBe(false);
  });

  it('tells a bare iOS WKWebView from every real iOS browser', () => {
    // On iOS every engine is WebKit, so the only signature is the ABSENCE of a browser token.
    expect(isInAppBrowserUA(IN_APP.bareIosWebView)).toBe(true);
    expect(isInAppBrowserUA(REAL.iosSafari)).toBe(false);
    expect(isInAppBrowserUA(REAL.iosChrome)).toBe(false);
    expect(isInAppBrowserUA(REAL.iosFirefox)).toBe(false);
  });

  it('is case-insensitive and survives an empty agent', () => {
    expect(isInAppBrowserUA(IN_APP.wechat.toUpperCase())).toBe(true);
    expect(isInAppBrowserUA('')).toBe(false);
  });
});
