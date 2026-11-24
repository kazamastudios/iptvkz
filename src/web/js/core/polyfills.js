// Polyfills para navegadores antigos. O piso é o Chromium 51: WebView do Android 7.0 (TV box) e webOS 4 (53).
// Só entram na versão "legacy". scripts/test-old-browser.js abre o app sem o que o Chromium 51 não tem.
/* eslint-disable no-extend-native */
if (!Array.prototype.flat) {
  Object.defineProperty(Array.prototype, 'flat', {
    configurable: true,
    writable: true,
    value: function flat(depth) {
      var d = depth === undefined ? 1 : Number(depth);
      var out = [];
      (function walk(arr, level) {
        for (var i = 0; i < arr.length; i++) {
          if (Array.isArray(arr[i]) && level > 0) walk(arr[i], level - 1);
          else out.push(arr[i]);
        }
      })(this, d);
      return out;
    },
  });
}
if (!Array.prototype.flatMap) {
  Object.defineProperty(Array.prototype, 'flatMap', {
    configurable: true,
    writable: true,
    value: function flatMap(fn, self) { return this.map(fn, self).flat(1); },
  });
}
if (!String.prototype.padStart) {
  String.prototype.padStart = function (len, fill) {
    var s = String(this);
    fill = fill === undefined ? ' ' : String(fill);
    while (s.length < len) s = fill + s;
    return s.slice(s.length - Math.max(len, String(this).length));
  };
}
if (!String.prototype.padEnd) {
  String.prototype.padEnd = function (len, fill) {
    var s = String(this);
    fill = fill === undefined ? ' ' : String(fill);
    while (s.length < len) s += fill;
    return s.slice(0, Math.max(len, String(this).length));
  };
}
// Chromium 52/53 (WebView de TV box com Android 7, webOS 4): sem Object.values/entries o app parava na abertura
// Chromium 54: o esbuild usa em { ...a, b } (helper __spreadProps)
if (!Object.getOwnPropertyDescriptors) {
  Object.getOwnPropertyDescriptors = function (o) {
    var r = {};
    Object.getOwnPropertyNames(o).forEach(function (k) { r[k] = Object.getOwnPropertyDescriptor(o, k); });
    if (Object.getOwnPropertySymbols) {
      Object.getOwnPropertySymbols(o).forEach(function (k) { r[k] = Object.getOwnPropertyDescriptor(o, k); });
    }
    return r;
  };
}
if (!Object.values) {
  Object.values = function (o) { return Object.keys(o).map(function (k) { return o[k]; }); };
}
if (!Object.entries) {
  Object.entries = function (o) { return Object.keys(o).map(function (k) { return [k, o[k]]; }); };
}
// Chromium < 66: sem AbortController. O substituto só marca "aborted"; o fetch antigo ignora o sinal e o prazo
// de quem usa vem do próprio setTimeout.
if (typeof window.AbortController === 'undefined') {
  window.AbortController = function () {
    var signal = { aborted: false, onabort: null, addEventListener: function () {}, removeEventListener: function () {} };
    this.signal = signal;
    this.abort = function () { signal.aborted = true; if (signal.onabort) signal.onabort(); };
  };
}
if (!Object.fromEntries) {
  Object.fromEntries = function (it) {
    var o = {};
    Array.from(it).forEach(function (kv) { o[kv[0]] = kv[1]; });
    return o;
  };
}
if (typeof Promise !== 'undefined' && !Promise.prototype.finally) {
  Promise.prototype.finally = function (fn) {
    return this.then(
      function (v) { return Promise.resolve(fn()).then(function () { return v; }); },
      function (e) { return Promise.resolve(fn()).then(function () { throw e; }); },
    );
  };
}
(function () {
  function toNodes(args) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      frag.appendChild(a instanceof Node ? a : document.createTextNode(String(a)));
    }
    return frag;
  }
  [Element.prototype, DocumentFragment.prototype].forEach(function (p) {
    if (!p.append) p.append = function () { this.appendChild(toNodes(arguments)); };
    if (!p.prepend) p.prepend = function () { this.insertBefore(toNodes(arguments), this.firstChild); };
  });
  if (!Element.prototype.before) Element.prototype.before = function () { if (this.parentNode) this.parentNode.insertBefore(toNodes(arguments), this); };
  if (!Element.prototype.after) Element.prototype.after = function () { if (this.parentNode) this.parentNode.insertBefore(toNodes(arguments), this.nextSibling); };
  if (window.NodeList && !NodeList.prototype.forEach) NodeList.prototype.forEach = Array.prototype.forEach;
  // Chromium 61: scrollTo em elementos (com { left, top }); sem rolagem suave
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = function (a, b) {
      if (a && typeof a === 'object') {
        if (a.left != null) this.scrollLeft = a.left;
        if (a.top != null) this.scrollTop = a.top;
      } else {
        this.scrollLeft = a;
        this.scrollTop = b;
      }
    };
  }
})();
