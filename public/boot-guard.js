/*
 * boot-guard.js — the message a visitor gets when the app itself cannot speak.
 *
 * A classic ES5 script, served as a file so the page's script-src stays 'self' with no inline
 * allowance. It runs before the module entry and covers the three cases the bundle cannot report
 * from inside: a browser with no module support, an entry module that fails to parse or load, and
 * a browser without CSS zoom, which the interface is scaled with. Its copy and the download
 * addresses are kept in step with src/i18n/locales/ and src/legal/deploy-targets.ts by
 * src/__tests__/boot/boot-guard.test.ts.
 */
(function () {
  'use strict';

  var BOOT_ID = 'petit-boot';
  var GUARD_ID = 'petit-boot-guard';
  var CONTINUE_ID = 'petit-boot-continue';

  var CREAM = '#FFFBE1';
  var INK = '#574935';
  var SURFACE = '#F3EEE8';
  var MUTED = '#747474';
  var EDGE = 'rgba(87, 73, 53, 0.62)';
  // The application faces ship inside the bundle, so the notice wears the platform's own.
  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", '
    + '"Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif';

  var DOWNLOADS = {
    global: { chrome: 'https://www.google.com/chrome/', firefox: 'https://www.mozilla.org/firefox/new/' },
    cn: { chrome: 'https://www.google.cn/chrome/', firefox: 'https://www.firefox.com.cn/' }
  };

  var COPY = {
    en: {
      title: 'Your browser is out of date',
      body: 'PetitMaker needs a newer browser with JavaScript enabled, such as the latest Chrome or Firefox.',
      chrome: 'Get Chrome',
      firefox: 'Get Firefox',
      proceed: 'Continue anyway'
    },
    zh: {
      title: '浏览器版本过旧',
      body: '谷地工坊需要已启用 JavaScript 的新版浏览器，例如最新版 Chrome 或 Firefox。',
      chrome: '获取 Chrome',
      firefox: '获取 Firefox',
      proceed: '仍要继续'
    },
    ja: {
      title: 'ブラウザのバージョンが古すぎます',
      body: 'PetitMaker のご利用には、JavaScript が有効な最新の Chrome や Firefox などの新しいブラウザが必要です。',
      chrome: 'Chrome を入手',
      firefox: 'Firefox を入手',
      proceed: 'このまま続ける'
    },
    ru: {
      title: 'Ваш браузер устарел',
      body: 'Для PetitMaker нужен более новый браузер с включённым JavaScript, например последняя версия Chrome или Firefox.',
      chrome: 'Скачать Chrome',
      firefox: 'Скачать Firefox',
      proceed: 'Всё равно продолжить'
    },
    th: {
      title: 'เบราว์เซอร์ของคุณเก่าเกินไป',
      body: 'PetitMaker ต้องใช้เบราว์เซอร์รุ่นใหม่ที่เปิดใช้งาน JavaScript เช่น Chrome หรือ Firefox เวอร์ชันล่าสุด',
      chrome: 'ดาวน์โหลด Chrome',
      firefox: 'ดาวน์โหลด Firefox',
      proceed: 'ใช้งานต่อไป'
    },
    id: {
      title: 'Browser Anda sudah usang',
      body: 'PetitMaker memerlukan browser yang lebih baru dengan JavaScript aktif, misalnya Chrome atau Firefox versi terbaru.',
      chrome: 'Unduh Chrome',
      firefox: 'Unduh Firefox',
      proceed: 'Tetap lanjutkan'
    },
    fr: {
      title: 'Votre navigateur est trop ancien',
      body: 'PetitMaker nécessite un navigateur plus récent avec JavaScript activé, par exemple la dernière version de Chrome ou Firefox.',
      chrome: 'Télécharger Chrome',
      firefox: 'Télécharger Firefox',
      proceed: 'Continuer quand même'
    }
  };

  var LOCALES = ['zh', 'ja', 'ru', 'th', 'id', 'fr', 'en'];

  function pageLang() {
    var el = document.documentElement;
    return ((el && el.getAttribute('lang')) || '').toLowerCase();
  }

  /** A language tag by prefix, as the application resolves it. */
  function match(tag) {
    for (var i = 0; i < LOCALES.length; i += 1) {
      if (tag.indexOf(LOCALES[i]) === 0) return LOCALES[i];
    }
    return null;
  }

  /** The page language decides only when a deployment sets one; the default `en` says nothing
   *  about the visitor, so the browser's language speaks next. */
  function locale() {
    var page = pageLang();
    var browser = (navigator && navigator.language ? navigator.language : '').toLowerCase();
    return (page !== 'en' && match(page)) || match(browser) || 'en';
  }

  function downloads() {
    return pageLang() === 'zh-cn' ? DOWNLOADS.cn : DOWNLOADS.global;
  }

  function booting() {
    return !!document.getElementById(BOOT_ID);
  }

  function styled(tag, css) {
    var el = document.createElement(tag);
    el.setAttribute('style', css);
    return el;
  }

  function pill(href, label) {
    var a = styled('a', 'display:inline-block;margin:8px 5px 0;padding:9px 16px;border:1px solid ' + EDGE
      + ';border-radius:999px;background:' + SURFACE + ';color:' + INK + ';font-size:14px;text-decoration:none');
    a.setAttribute('href', href);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
    a.appendChild(document.createTextNode(label));
    return a;
  }

  function remove() {
    var cover = document.getElementById(GUARD_ID);
    if (cover && cover.parentNode) cover.parentNode.removeChild(cover);
  }

  function cover(canProceed) {
    var lang = locale();
    var text = COPY[lang];
    var urls = downloads();
    // Longhand edges rather than `inset`: the engines this notice exists for predate the shorthand.
    var box = styled('div', 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;overflow:auto;'
      + 'background:' + CREAM + ';color:' + INK + ';font-family:' + FONT);
    box.setAttribute('id', GUARD_ID);
    // The copy can be in a language the page does not declare.
    box.setAttribute('lang', lang);
    var card = styled('div', 'box-sizing:border-box;max-width:420px;margin:0 auto;padding:16vh 24px 48px;text-align:center');
    var title = styled('h1', 'margin:0 0 12px;font-size:20px;font-weight:700;line-height:1.3');
    title.appendChild(document.createTextNode(text.title));
    var body = styled('p', 'margin:0 0 18px;font-size:15px;line-height:1.6');
    body.appendChild(document.createTextNode(text.body));
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(pill(urls.chrome, text.chrome));
    card.appendChild(pill(urls.firefox, text.firefox));
    if (canProceed) {
      var proceed = styled('button', 'display:block;margin:22px auto 0;padding:4px;border:0;background:none;'
        + 'color:' + MUTED + ';font-family:inherit;font-size:14px;text-decoration:underline;cursor:pointer');
      proceed.setAttribute('id', CONTINUE_ID);
      proceed.setAttribute('type', 'button');
      proceed.appendChild(document.createTextNode(text.proceed));
      proceed.onclick = function () { remove(); };
      card.appendChild(proceed);
    }
    box.appendChild(card);
    return box;
  }

  function draw(canProceed) {
    var standing = document.getElementById(GUARD_ID);
    if (standing) {
      // A notice offering to continue was raised first, and the app then failed to start.
      if (!canProceed) withdrawProceed(standing);
      return;
    }
    var box = cover(canProceed);
    var loading = document.getElementById(BOOT_ID);
    // Nothing further is coming, so the loading screen gives way to the message. The zoom notice
    // instead stands outside #root, which React empties on its first render.
    if (!canProceed && loading) {
      loading.innerHTML = '';
      loading.appendChild(box);
    } else if (document.body) {
      document.body.appendChild(box);
    }
  }

  function withdrawProceed(standing) {
    var proceed = document.getElementById(CONTINUE_ID);
    if (proceed && proceed.parentNode) proceed.parentNode.removeChild(proceed);
    var loading = document.getElementById(BOOT_ID);
    if (loading && loading !== standing.parentNode) loading.innerHTML = '';
  }

  /** This script runs in the head, ahead of the entry module, so the page it writes into may not
   *  exist yet. */
  function show(canProceed) {
    if (document.body) draw(canProceed);
    else document.addEventListener('DOMContentLoaded', function () { draw(canProceed); });
  }

  function modulesRun() {
    return typeof HTMLScriptElement !== 'undefined' && 'noModule' in HTMLScriptElement.prototype;
  }

  function zoomScales() {
    try {
      return !!(window.CSS && window.CSS.supports && window.CSS.supports('zoom', '1'));
    } catch (e) {
      return false;
    }
  }

  /** A parse failure reports a SyntaxError at the window; a fetch failure hits the element. */
  function fromEntry(event) {
    var error = event && event.error;
    if (error && error.name === 'SyntaxError') return true;
    var target = event && event.target;
    return !!(target && target !== window && target.nodeName === 'SCRIPT');
  }

  if (!modulesRun()) show(false);
  else if (!zoomScales()) show(true);

  if (window.addEventListener) {
    // Capture: a failed script's error event is fired at the element and does not bubble.
    window.addEventListener('error', function (event) {
      if (booting() && fromEntry(event)) show(false);
    }, true);
  }
})();
