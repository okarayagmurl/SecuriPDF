(function (global) {
  'use strict';

  function parse(raw, maxPages, allowAll) {
    var text = (raw || '').trim();
    if (!text) {
      return { error: 'Sayfa seçimi girin.' };
    }
    if (allowAll && /^all$/i.test(text)) {
      return { isAll: true, pages: [] };
    }

    var seen = {};
    var parts = text.split(',');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (!part) continue;
      var dash = part.indexOf('-');
      if (dash >= 0) {
        var a = parseInt(part.slice(0, dash).trim(), 10);
        var b = parseInt(part.slice(dash + 1).trim(), 10);
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
          return { error: 'Geçersiz aralık: ' + part };
        }
        var start = Math.min(a, b);
        var end = Math.max(a, b);
        for (var p = start; p <= end; p++) {
          if (p < 1) {
            return { error: 'Sayfa numarası en az 1 olmalı.' };
          }
          if (maxPages && p > maxPages) {
            return { error: 'Sayfa ' + p + ' belgede yok (toplam ' + maxPages + ' sayfa).' };
          }
          seen[p] = true;
        }
      } else {
        var n = parseInt(part, 10);
        if (!Number.isFinite(n)) {
          return { error: 'Geçersiz sayfa: ' + part };
        }
        if (n < 1) {
          return { error: 'Sayfa numarası en az 1 olmalı.' };
        }
        if (maxPages && n > maxPages) {
          return { error: 'Sayfa ' + n + ' belgede yok (toplam ' + maxPages + ' sayfa).' };
        }
        seen[n] = true;
      }
    }

    var pages = Object.keys(seen).map(Number).sort(function (x, y) { return x - y; });
    if (!pages.length) {
      return { error: 'En az bir sayfa seçin.' };
    }
    return { pages: pages };
  }

  function formatList(pages) {
    if (!pages || !pages.length) return '';
    var parts = [];
    var start = pages[0];
    var prev = pages[0];
    for (var i = 1; i <= pages.length; i++) {
      var cur = pages[i];
      if (cur === prev + 1) {
        prev = cur;
        continue;
      }
      parts.push(start === prev ? String(start) : start + '-' + prev);
      start = prev = cur;
    }
    return parts.join(',');
  }

  function validate(raw, options) {
    options = options || {};
    var maxPages = options.maxPages;
    if (!maxPages && !options.allowAll) {
      return 'Sayfa sayısı okunamadı — PDF dosyasını seçin ve sayfa bilgisi yüklenene kadar bekleyin.';
    }
    var parsed = parse(raw, maxPages, options.allowAll);
    if (parsed.error) return parsed.error;
    if (parsed.isAll) return '';
    var minKeep = options.minKeep != null ? options.minKeep : 0;
    if (maxPages && minKeep > 0 && parsed.pages.length > maxPages - minKeep) {
      var maxDel = maxPages - minKeep;
      return 'En az ' + minKeep + ' sayfa kalmalı — en fazla ' + maxDel + ' sayfa seçebilirsiniz (toplu: örn. 1-' + maxDel + ').';
    }
    return '';
  }

  global.SecuriPages = {
    parse: parse,
    formatList: formatList,
    validate: validate
  };
})(typeof window !== 'undefined' ? window : this);
