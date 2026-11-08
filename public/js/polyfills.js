// Polyfills para navegadores de TV antigos (webOS 4+ / Chromium 53+). Só entram na versão "legacy".
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
})();
