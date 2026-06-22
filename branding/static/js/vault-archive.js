/**
 * Eski sablon uyumlulugu — guncel arsiv modulu securipdf-archive.js
 */
(function () {
  if (window.__securipdfVaultArchiveLoaded || window.__securipdfVaultArchiveRequested) {
    return;
  }
  window.__securipdfVaultArchiveRequested = true;
  var script = document.createElement('script');
  script.src = '/js/securipdf-archive.js?v=9';
  script.async = true;
  document.head.appendChild(script);
})();
