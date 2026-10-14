/* Chrome 61 fallbacks for the APIs used by the offline editor and its render libraries. */
(function () {
  if (!window.CSS || !CSS.supports('selector(:focus-visible)')) document.documentElement.setAttribute('data-lite-focus-fallback', '');
  var define = function (target, name, value) {
    if (!target[name]) Object.defineProperty(target, name, { configurable: true, writable: true, value: value });
  };
  define(window, 'globalThis', window);
  define(window, 'queueMicrotask', function (callback) { Promise.resolve().then(callback).catch(function (error) { setTimeout(function () { throw error; }); }); });
  define(Object, 'fromEntries', function (entries) {
    var result = {};
    for (var entry of entries) Object.defineProperty(result, entry[0], { value: entry[1], writable: true, configurable: true, enumerable: true });
    return result;
  });
  define(Array.prototype, 'flat', function (depth) {
    depth = depth === undefined ? 1 : Math.max(0, Math.trunc(Number(depth)) || 0);
    return this.reduce(function (result, value) { return result.concat(Array.isArray(value) && depth > 0 ? value.flat(depth - 1) : [value]); }, []);
  });
  define(Array.prototype, 'flatMap', function (callback, context) { return this.map(callback, context).flat(); });
  define(Promise.prototype, 'finally', function (callback) {
    var P = this.constructor;
    if (typeof callback !== 'function') return this.then(callback, callback);
    return this.then(function (value) { return P.resolve(callback()).then(function () { return value; }); }, function (error) { return P.resolve(callback()).then(function () { throw error; }); });
  });
  if (!window.AbortController) {
    window.AbortController = function () {
      var listeners = document.createDocumentFragment();
      this.signal = {
        aborted: false,
        reason: undefined,
        addEventListener: listeners.addEventListener.bind(listeners),
        removeEventListener: listeners.removeEventListener.bind(listeners)
      };
      this.abort = function (reason) {
        if (this.signal.aborted) return;
        this.signal.aborted = true;
        this.signal.reason = reason || new DOMException('Cancelled', 'AbortError');
        listeners.dispatchEvent(new Event('abort'));
      };
    };
    var add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (options && options.signal) {
        var signal = options.signal;
        if (signal.aborted) return;
        var target = this;
        options = Object.assign({}, options);
        delete options.signal;
        signal.addEventListener('abort', function () { target.removeEventListener(type, listener, options); }, { once: true });
      }
      return add.call(this, type, listener, options);
    };
  }
})();

(function () {
  var probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px';
  probe.appendChild(document.createElement('div'));
  probe.appendChild(document.createElement('div'));
  document.body.appendChild(probe);
  var flexGap = probe.scrollHeight === 1;
  probe.remove();
  var ratioSupport = window.CSS && CSS.supports('aspect-ratio', '1');
  if (flexGap && ratioSupport) return;
  var margins = new WeakMap();
  var roots = new Set();
  var selector = '[style*="--lite-ratio"], [style*="--lite-gap"]';
  var pending = false;
  function update() {
    pending = false;
    var elements = new Set();
    roots.forEach(function (root) {
      if (!document.documentElement.contains(root)) return;
      if (root.matches(selector)) elements.add(root);
      root.querySelectorAll(selector).forEach(function (element) { elements.add(element); });
      var parent = root.parentElement;
      while (parent) { if (parent.matches(selector)) elements.add(parent); parent = parent.parentElement; }
    });
    roots.clear();
    if (!ratioSupport) elements.forEach(function (element) {
      if (!element.style.getPropertyValue('--lite-ratio')) return;
      var parts = element.style.getPropertyValue('--lite-ratio').split('/').map(Number);
      var ratio = parts[0] / (parts.length > 1 ? parts[1] : 1);
      if (!(ratio > 0)) return;
      var height = (element.clientWidth / ratio) + 'px';
      if (!element.style.height || Math.abs(parseFloat(element.style.height) - parseFloat(height)) > 0.5) element.style.height = height;
    });
    if (flexGap) return;
    elements.forEach(function (container) {
      var css = getComputedStyle(container);
      if (css.display !== 'flex' && css.display !== 'inline-flex') return;
      var gap = container.style.getPropertyValue('--lite-gap').trim();
      if (!gap) return;
      if (/^[\d.]+$/.test(gap)) gap += 'px';
      var column = css.flexDirection.indexOf('column') === 0;
      var children = Array.from(container.children).filter(function (child) { return getComputedStyle(child).position !== 'absolute' && getComputedStyle(child).display !== 'none'; });
      children.forEach(function (child, i) {
        if (!margins.has(child)) margins.set(child, { right: child.style.marginRight, bottom: child.style.marginBottom });
        var original = margins.get(child);
        var right = !column && i < children.length - 1 ? 'calc(' + (original.right || '0px') + ' + ' + gap + ')' : original.right;
        var bottom = (column && i < children.length - 1) || css.flexWrap === 'wrap' ? 'calc(' + (original.bottom || '0px') + ' + ' + gap + ')' : original.bottom;
        if (original.appliedRight !== right) { child.style.marginRight = right; original.appliedRight = right; }
        if (original.appliedBottom !== bottom) { child.style.marginBottom = bottom; original.appliedBottom = bottom; }
      });
    });
  }
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(update); } }
  window.addEventListener('resize', function () { roots.add(document.body); schedule(); });
  new MutationObserver(function (records) {
    records.forEach(function (record) { if (record.target.nodeType === 1) roots.add(record.target); });
    schedule();
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
})();
