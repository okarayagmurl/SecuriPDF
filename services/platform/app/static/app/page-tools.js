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
      return 'En az ' + minKeep + ' sayfa kalmalı — en fazla ' + maxDel + ' sayfa seçebilirsiniz.';
    }
    return '';
  }

  function modeLabels(mode) {
    if (mode === 'remove') {
      return {
        action: 'silinecek',
        keep: 'kalacak',
        pickHint: 'Silmek istediğiniz sayfalara tıklayın',
        tileTitle: 'Sayfa {n} — silmek için tıklayın',
        selectedClass: 'is-remove'
      };
    }
    if (mode === 'extract') {
      return {
        action: 'çıkarılacak',
        keep: 'dokümanda kalacak',
        pickHint: 'Çıkarmak istediğiniz sayfalara tıklayın',
        tileTitle: 'Sayfa {n} — çıkarmak için tıklayın',
        selectedClass: 'is-extract'
      };
    }
    if (mode === 'number') {
      return {
        action: 'numaralandırılacak',
        keep: 'numarasız kalacak',
        pickHint: 'Numara eklenecek sayfalara tıklayın',
        tileTitle: 'Sayfa {n}',
        selectedClass: 'is-number'
      };
    }
    return {
      action: 'seçili',
      keep: 'dışarıda',
      pickHint: 'Sayfalara tıklayarak seçin',
      tileTitle: 'Sayfa {n}',
      selectedClass: 'is-pick'
    };
  }

  function pagesMatching(predicate, maxPages) {
    var out = [];
    for (var p = 1; p <= maxPages; p++) {
      if (predicate(p)) out.push(p);
    }
    return out;
  }

  function identityOrder(maxPages) {
    var out = [];
    for (var p = 1; p <= maxPages; p++) out.push(p);
    return out;
  }

  function orderToCsv(order) {
    return (order || []).join(',');
  }

  function csvToOrder(raw, maxPages) {
    var parsed = parse(raw, maxPages, false);
    if (parsed.error) return { error: parsed.error };
    var pages = parsed.pages;
    if (!maxPages) return { error: 'Sayfa sayısı bilinmiyor.' };
    if (pages.length !== maxPages) {
      return { error: 'Özel sırada tam ' + maxPages + ' sayfa (her biri bir kez) olmalı.' };
    }
    var seen = {};
    for (var i = 0; i < pages.length; i++) {
      if (seen[pages[i]]) {
        return { error: 'Sayfa ' + pages[i] + ' yinelenemez.' };
      }
      seen[pages[i]] = true;
    }
    return { order: pages };
  }

  function validateOrder(order, maxPages) {
    if (!maxPages) {
      return 'Sayfa sayısı okunamadı — PDF dosyasını seçin.';
    }
    if (!order || order.length !== maxPages) {
      return 'Tüm ' + maxPages + ' sayfa yeni sırada bir kez yer almalı.';
    }
    var seen = {};
    for (var i = 0; i < order.length; i++) {
      var p = order[i];
      if (p < 1 || p > maxPages) {
        return 'Geçersiz sayfa numarası: ' + p + ' (belge ' + maxPages + ' sayfa).';
      }
      if (seen[p]) return 'Sayfa ' + p + ' yalnızca bir kez kullanılabilir.';
      seen[p] = true;
    }
    return '';
  }

  global.SecuriPages = {
    parse: parse,
    formatList: formatList,
    validate: validate,
    modeLabels: modeLabels,
    pagesMatching: pagesMatching,
    identityOrder: identityOrder,
    orderToCsv: orderToCsv,
    csvToOrder: csvToOrder,
    validateOrder: validateOrder,
    MAX_VISUAL: 120
  };
})(typeof window !== 'undefined' ? window : this);
