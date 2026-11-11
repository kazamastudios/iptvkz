// IPTVKZ: identifica o aparelho de quem visita, para a página inicial e o suporte.
(function () {
  'use strict';
  var ua = navigator.userAgent;
  function detect() {
    if (/web0s|webos|netcast/i.test(ua)) return 'lg';
    if (/android/i.test(ua)) return /android tv|bravia|aft[a-z]|mibox|shield|googletv|\btv\b/i.test(ua) ? 'atv' : 'android';
    if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'browser';
    if (/windows/i.test(ua)) return 'win';
    if (/macintosh|mac os x/i.test(ua)) return 'mac';
    if (/linux|x11/i.test(ua) && !/cros/i.test(ua)) return 'linux';
    return 'browser';
  }
  window.iptvkzDevice = detect();
  window.iptvkzIsTv = /web0s|webos|smart-?tv|netcast|tizen|hbbtv|appletv|crkey|aft[a-z]|android tv|bravia|googletv|mibox/i.test(ua) || /[?&]tv=1\b/.test(location.search);
})();
