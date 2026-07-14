(function (global) {
  'use strict';

  function isPdfFile(file) {
    if (!file) return false;
    if (file.type === 'application/pdf') return true;
    return /\.pdf$/i.test(file.name || '');
  }

  function mount(container, form, opts) {
    opts = opts || {};
    var showNav = opts.showNav !== false;
    var minHeight = opts.minHeight != null ? opts.minHeight : 280;
    var onPageChange = opts.onPageChange || null;
    var fileInputName = opts.fileInputName || 'fileInput';
    var rotationEl = opts.rotationSelector || null;

    var wrap = document.createElement('div');
    wrap.className = 'ui-pdf-preview-wrap';
    if (minHeight) wrap.style.minHeight = minHeight + 'px';

    var nav = null;
    var pageNum = 1;
    var blobUrl = '';
    var loadToken = 0;

    if (showNav) {
      nav = document.createElement('div');
      nav.className = 'ui-pdf-preview-nav';
      nav.innerHTML =
        '<button type="button" class="btn btn-sm btn-secondary ui-pdf-prev" disabled aria-label="Önceki sayfa">‹</button>' +
        '<span class="ui-pdf-page-label">Sayfa <strong class="ui-pdf-page-num">1</strong> / <span class="ui-pdf-page-total">1</span></span>' +
        '<button type="button" class="btn btn-sm btn-secondary ui-pdf-next" disabled aria-label="Sonraki sayfa">›</button>';
      wrap.appendChild(nav);
    }

    var stage = document.createElement('div');
    stage.className = 'ui-pdf-preview-stage';
    var empty = document.createElement('p');
    empty.className = 'ui-pdf-preview-empty hint';
    empty.textContent = 'PDF seçildiğinde önizleme burada görünür.';
    var rotator = document.createElement('div');
    rotator.className = 'ui-pdf-preview-rotator';
    var iframe = document.createElement('iframe');
    iframe.className = 'ui-pdf-preview-frame';
    iframe.title = 'PDF önizleme';
    rotator.appendChild(iframe);
    stage.appendChild(empty);
    stage.appendChild(rotator);
    wrap.appendChild(stage);
    container.appendChild(wrap);

    function pageCount() {
      var meta = form._pdfFileMeta;
      return meta && meta.pageCount ? meta.pageCount : 1;
    }

    function syncRotation() {
      var deg = 0;
      if (rotationEl) {
        var el = typeof rotationEl === 'string' ? form.querySelector(rotationEl) : rotationEl;
        if (el && el.value) deg = parseInt(el.value, 10) || 0;
      }
      rotator.style.transform = deg ? 'rotate(' + deg + 'deg)' : '';
    }

    function syncNav() {
      if (!nav) return;
      var total = pageCount();
      nav.querySelector('.ui-pdf-page-num').textContent = String(pageNum);
      nav.querySelector('.ui-pdf-page-total').textContent = String(total);
      nav.querySelector('.ui-pdf-prev').disabled = pageNum <= 1;
      nav.querySelector('.ui-pdf-next').disabled = pageNum >= total;
    }

    function syncIframe() {
      if (!blobUrl) {
        iframe.removeAttribute('src');
        rotator.hidden = true;
        empty.hidden = false;
        return;
      }
      empty.hidden = true;
      rotator.hidden = false;
      syncRotation();
      var base = blobUrl.split('#')[0];
      // Hash-only src degisimi bazi tarayicilarda yenilenmez; about:blank ile zorla.
      var target = base + '#page=' + pageNum + '&zoom=page-width&nav=' + pageNum;
      if (iframe.getAttribute('data-page') === String(pageNum) && iframe.src.indexOf(base) === 0) {
        iframe.removeAttribute('src');
        iframe.src = 'about:blank';
        setTimeout(function () {
          iframe.setAttribute('data-page', String(pageNum));
          iframe.src = target;
        }, 0);
        return;
      }
      iframe.setAttribute('data-page', String(pageNum));
      iframe.src = target;
    }

    function goPage(n) {
      var total = pageCount();
      pageNum = Math.max(1, Math.min(total, n));
      syncNav();
      syncIframe();
      if (onPageChange) onPageChange(pageNum, total);
    }

    function revoke() {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = '';
      }
    }

    function loadFile() {
      var fileIn = form.querySelector('[name="' + fileInputName + '"]');
      var token = ++loadToken;
      if (!fileIn || !fileIn.files || !fileIn.files.length || !isPdfFile(fileIn.files[0])) {
        revoke();
        pageNum = 1;
        syncNav();
        syncIframe();
        return;
      }
      var file = fileIn.files[0];
      revoke();
      blobUrl = URL.createObjectURL(file);
      if (token !== loadToken) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = '';
        return;
      }
      pageNum = 1;
      syncNav();
      syncIframe();
    }

    function onMetaRefresh() {
      syncNav();
      if (pageNum > pageCount()) goPage(pageCount());
    }

    if (nav) {
      nav.querySelector('.ui-pdf-prev').addEventListener('click', function () { goPage(pageNum - 1); });
      nav.querySelector('.ui-pdf-next').addEventListener('click', function () { goPage(pageNum + 1); });
    }

    var fileIn = form.querySelector('[name="' + fileInputName + '"]');
    if (fileIn) fileIn.addEventListener('change', loadFile);

    var rotEl = rotationEl
      ? (typeof rotationEl === 'string' ? form.querySelector(rotationEl) : rotationEl)
      : null;
    if (rotEl) {
      rotEl.addEventListener('change', syncRotation);
      rotEl.addEventListener('input', syncRotation);
    }

    var prevRefresh = form._refreshPdfPageMeta;
    form._refreshPdfPageMeta = function () {
      if (typeof prevRefresh === 'function') prevRefresh();
      onMetaRefresh();
    };

    loadFile();

    form._pdfPreviewGetPage = function () { return pageNum; };

    return function cleanup() {
      if (form._pdfPreviewGetPage) delete form._pdfPreviewGetPage;
      revoke();
      if (fileIn) fileIn.removeEventListener('change', loadFile);
      if (rotEl) {
        rotEl.removeEventListener('change', syncRotation);
        rotEl.removeEventListener('input', syncRotation);
      }
      form._refreshPdfPageMeta = prevRefresh;
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    };
  }

  global.SecuriPdfPreview = { mount: mount };
})(typeof window !== 'undefined' ? window : this);
