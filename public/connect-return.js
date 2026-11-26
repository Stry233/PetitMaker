/* The page a provider returns the user to after sign-in. It hands the address's `code` and `state`
 * to the editor that opened it, on the channel `src/platform/remote/sign-in-window.ts` listens on,
 * and closes. It stays an ES5 classic script and keeps nothing. */
(function () {
  var query = new URLSearchParams(window.location.search);
  var answer = { state: query.get('state') || '' };
  var code = query.get('code');
  if (code) answer.code = code;
  else answer.error = query.get('error') || 'denied';
  // The code leaves the address bar and the history entry before anything else can read it.
  window.history.replaceState(null, '', window.location.pathname);
  try {
    var channel = new BroadcastChannel('petit-sign-in');
    channel.postMessage(answer);
    channel.close();
  } catch (error) { /* A browser without BroadcastChannel leaves the editor to its time limit. */ }
  window.close();
  // A browser may refuse to close a window that has visited another site; the line below then shows.
  var words = {
    en: 'You can close this window.',
    zh: '可以关闭此窗口。',
    ja: 'このウィンドウは閉じてかまいません。',
    ru: 'Это окно можно закрыть.',
    th: 'ปิดหน้าต่างนี้ได้',
    id: 'Jendela ini bisa ditutup.',
    fr: 'Vous pouvez fermer cette fenêtre.'
  };
  var locale = (navigator.language || 'en').slice(0, 2).toLowerCase();
  var line = document.createElement('p');
  line.textContent = words[locale] || words.en;
  line.style.cssText = 'font: 16px/1.5 system-ui, sans-serif; margin: 32px; color: #544833;';
  document.body.appendChild(line);
})();
