/**
 * SecuriPDF Vault — arsiv modal, view-pdf ve ana sayfa
 */
(function () {
  if (window.__securipdfVaultArchiveLoaded) {
    return;
  }
  window.__securipdfVaultArchiveLoaded = true;

  const VAULT_API = '/api/vault/v1';
  const WELCOME_MARKER = 'Welcome.pdf';
  const PENDING_VAULT_KEY = 'securipdfPendingVault';

  window.__securipdfLastFilename = '';

  function sanitizeFilename(name) {
    if (!name) {
      return '';
    }
    var cleaned = String(name).replace(/[\\/:*?"<>|]/g, '_').trim();
    if (!cleaned.toLowerCase().endsWith('.pdf')) {
      cleaned += '.pdf';
    }
    return cleaned;
  }

  function filenameFromUrl(url) {
    if (!url || url.indexOf('blob:') === 0) {
      return '';
    }
    try {
      var part = decodeURIComponent(url.split('/').pop().split('?')[0].split('#')[0]);
      if (part && part.toLowerCase().endsWith('.pdf') && part !== WELCOME_MARKER) {
        return sanitizeFilename(part);
      }
    } catch (e) {
      return '';
    }
    return '';
  }

  function getCurrentPdfFilename() {
    var app = window.PDFViewerApplication;
    if (window.__securipdfLastFilename) {
      return sanitizeFilename(window.__securipdfLastFilename);
    }
    if (app) {
      var fromDisposition = app._contentDispositionFilename || app.contentDispositionFilename;
      if (fromDisposition) {
        return sanitizeFilename(fromDisposition);
      }
      var fromUrl = filenameFromUrl(app.url || '');
      if (fromUrl) {
        return fromUrl;
      }
    }
    var input = document.querySelector('input[type="file"][accept*="pdf"]') ||
      document.querySelector('input[type="file"]');
    if (input && input.files && input.files[0] && input.files[0].name) {
      return sanitizeFilename(input.files[0].name);
    }
    return sanitizeFilename('belge-' + new Date().toISOString().slice(0, 10) + '.pdf');
  }

  function rememberFilename(name) {
    if (name) {
      window.__securipdfLastFilename = sanitizeFilename(name);
    }
  }

  async function getCurrentPdfBlob() {
    if (window.PDFViewerApplication && PDFViewerApplication.pdfDocument) {
      var data = await PDFViewerApplication.pdfDocument.getData();
      return new Blob([data], { type: 'application/pdf' });
    }
    var input = document.querySelector('input[type="file"][accept*="pdf"]') ||
      document.querySelector('input[type="file"]');
    if (input && input.files && input.files[0]) {
      rememberFilename(input.files[0].name);
      return input.files[0];
    }
    return null;
  }

  async function archiveCurrentPdf() {
    var blob = await getCurrentPdfBlob();
    if (!blob) {
      throw new Error('Arsivlenecek PDF bulunamadi');
    }
    var filename = getCurrentPdfFilename();
    var form = new FormData();
    form.append('file', blob, filename);
    var res = await fetch(VAULT_API + '/documents', { method: 'POST', body: form });
    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      throw new Error(err.detail || err.message || res.statusText);
    }
    rememberFilename(filename);
    return res.json();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatBytes(bytes) {
    if (!bytes) {
      return '0 B';
    }
    var units = ['B', 'KB', 'MB', 'GB'];
    var value = bytes;
    var unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return value.toFixed(unit === 0 ? 0 : 1) + ' ' + units[unit];
  }

  function formatDate(iso) {
    if (!iso) {
      return '';
    }
    try {
      return new Date(iso).toLocaleString('tr-TR');
    } catch (e) {
      return iso;
    }
  }

  function viewPdfUrl(docId) {
    return '/view-pdf?vault=' + encodeURIComponent(docId);
  }

  async function fetchUserProfile() {
    var res = await fetch(VAULT_API + '/me', { credentials: 'same-origin' });
    if (!res.ok) {
      return null;
    }
    return res.json();
  }

  async function emailArchivedDocument(docId, name) {
    var profile = await fetchUserProfile();
    var confirmMsg = profile && profile.email
      ? ('"' + (name || 'belge') + '" dosyasi ' + profile.email + ' adresine gonderilsin mi?')
      : ('"' + (name || 'belge') + '" dosyasi kayitli e-posta adresinize gonderilsin mi?');
    if (!window.confirm(confirmMsg)) {
      return null;
    }
    var res = await fetch(VAULT_API + '/documents/' + encodeURIComponent(docId) + '/email', {
      method: 'POST',
      credentials: 'same-origin'
    });
    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      var detail = err.detail;
      if (Array.isArray(detail)) {
        detail = detail.map(function (item) { return item.msg || item; }).join(', ');
      }
      throw new Error(detail || err.message || res.statusText);
    }
    return res.json();
  }

  async function emailCurrentPdf() {
    var params = new URLSearchParams(window.location.search);
    var vaultId = params.get('vault');
    var filename = getCurrentPdfFilename();
    if (vaultId) {
      return emailArchivedDocument(vaultId, filename);
    }
    var profile = await fetchUserProfile();
    var confirmMsg = profile && profile.email
      ? ('"' + filename + '" dosyasi ' + profile.email + ' adresine gonderilsin mi?')
      : ('"' + filename + '" dosyasi kayitli e-posta adresinize gonderilsin mi?');
    if (!window.confirm(confirmMsg)) {
      return null;
    }
    var blob = await getCurrentPdfBlob();
    if (!blob) {
      throw new Error('Gonderilecek PDF bulunamadi');
    }
    var form = new FormData();
    form.append('file', blob, filename);
    var res = await fetch(VAULT_API + '/documents/email', {
      method: 'POST',
      body: form,
      credentials: 'same-origin'
    });
    if (!res.ok) {
      var err = await res.json().catch(function () { return {}; });
      var detail = err.detail;
      if (Array.isArray(detail)) {
        detail = detail.map(function (item) { return item.msg || item; }).join(', ');
      }
      throw new Error(detail || err.message || res.statusText);
    }
    return res.json();
  }

  function rememberPendingVault(docId, name) {
    if (!docId) {
      return;
    }
    try {
      sessionStorage.setItem(PENDING_VAULT_KEY, JSON.stringify({
        id: docId,
        name: name || '',
        ts: Date.now()
      }));
    } catch (e) {
      /* ignore */
    }
  }

  function peekPendingVault() {
    try {
      var raw = sessionStorage.getItem(PENDING_VAULT_KEY);
      if (!raw) {
        return null;
      }
      var data = JSON.parse(raw);
      if (!data || !data.id || Date.now() - (data.ts || 0) > 300000) {
        sessionStorage.removeItem(PENDING_VAULT_KEY);
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  function clearPendingVault() {
    try {
      sessionStorage.removeItem(PENDING_VAULT_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function decodeDataAttr(value) {
    if (!value) {
      return '';
    }
    var el = document.createElement('textarea');
    el.innerHTML = value;
    return el.value;
  }

  async function waitForPdfViewer(maxWaitMs) {
    var deadline = Date.now() + (maxWaitMs || 45000);
    while (Date.now() < deadline) {
      var app = window.PDFViewerApplication;
      if (app && app.initializedPromise) {
        await app.initializedPromise;
        return app;
      }
      await new Promise(function (resolve) { setTimeout(resolve, 120); });
    }
    throw new Error('PDF goruntuleyici hazir degil');
  }

  async function loadArchiveList() {
    var res = await fetch(VAULT_API + '/documents?size=100', { credentials: 'same-origin' });
    if (!res.ok) {
      throw new Error('Arsiv listesi alinamadi');
    }
    return res.json();
  }

  async function resolveVaultTarget() {
    var params = new URLSearchParams(window.location.search);
    var vaultId = params.get('vault');
    var name = '';
    var pending = peekPendingVault();

    if (!vaultId && pending) {
      vaultId = pending.id;
    }
    if (!vaultId) {
      return null;
    }
    if (pending && pending.id === vaultId && pending.name) {
      name = pending.name;
    }
    if (!name) {
      var data = await loadArchiveList();
      var item = (data.items || []).find(function (row) { return row.id === vaultId; });
      name = item && item.name;
    }
    return { id: vaultId, name: name || '' };
  }

  function whenPdfViewerReady(callback) {
    if (window.PDFViewerApplication && window.PDFViewerApplication.initializedPromise) {
      window.PDFViewerApplication.initializedPromise.then(callback).catch(function () {
        setTimeout(callback, 500);
      });
      return;
    }
    var done = false;
    function runOnce() {
      if (done) {
        return;
      }
      if (!window.PDFViewerApplication || !window.PDFViewerApplication.initializedPromise) {
        return;
      }
      done = true;
      window.PDFViewerApplication.initializedPromise.then(callback).catch(function () {
        setTimeout(callback, 500);
      });
    }
    window.addEventListener('webviewerloaded', runOnce, { once: true });
    var poll = setInterval(function () {
      runOnce();
      if (done) {
        clearInterval(poll);
      }
    }, 100);
    setTimeout(function () { clearInterval(poll); }, 60000);
  }

  function iconButton(action, id, name, title, icon, extraClass, linkHref) {
    var safeName = escapeHtml(name || id + '.pdf');
    var safeId = escapeHtml(id);
    var cls = 'securipdf-archive-action' + (extraClass ? ' ' + extraClass : '');
    var inner = '<span class="material-symbols-rounded">' + icon + '</span>';
    if (linkHref) {
      return '<a class="' + cls + '" href="' + linkHref + '" title="' + escapeHtml(title) + '">' + inner + '</a>';
    }
    return (
      '<button type="button" class="' + cls + '" data-action="' + action + '" data-id="' + safeId +
      '" data-name="' + safeName + '" title="' + escapeHtml(title) + '">' + inner + '</button>'
    );
  }

  function renderPanelItem(item) {
    var safeName = escapeHtml(item.name || item.id + '.pdf');
    var meta = formatBytes(item.sizeBytes) + ' · ' + formatDate(item.modifiedAt || item.createdAt);
    var openAction =
      '<a class="securipdf-archive-action" href="' + viewPdfUrl(item.id) + '" data-action="edit" data-id="' +
      escapeHtml(item.id) + '" data-name="' + safeName + '" title="Duzenle">' +
      '<span class="material-symbols-rounded">edit_document</span></a>';
    return (
      '<article class="securipdf-archive-item" data-doc-id="' + escapeHtml(item.id) + '">' +
        '<div class="securipdf-archive-item-main">' +
          '<strong class="securipdf-archive-name" title="' + safeName + '">' + safeName + '</strong>' +
          '<span class="securipdf-archive-meta">' + meta + '</span>' +
        '</div>' +
        '<div class="securipdf-archive-actions">' +
          openAction +
          iconButton('email', item.id, item.name, 'E-posta gonder', 'mail') +
          iconButton('download', item.id, item.name, 'Indir', 'download') +
          iconButton('delete', item.id, item.name, 'Sil', 'delete', 'securipdf-archive-action-danger') +
        '</div>' +
      '</article>'
    );
  }

  function renderQuotaHtml(data) {
    var used = data.usedBytes || 0;
    var max = data.quotaBytes || 1;
    var pct = Math.min(100, Math.round((used / max) * 100));
    return (
      '<div class="securipdf-archive-quota-bar"><span style="width:' + pct + '%"></span></div>' +
      '<span>' + formatBytes(used) + ' / ' + formatBytes(max) + ' kullaniliyor</span>'
    );
  }

  async function renderArchiveModal() {
    var listEl = document.getElementById('securipdfArchiveItems');
    var quotaEl = document.getElementById('securipdfArchiveQuota');
    if (!listEl) {
      return null;
    }
    listEl.innerHTML = '<p class="securipdf-archive-empty">Yukleniyor...</p>';
    try {
      var data = await loadArchiveList();
      var items = data.items || [];
      if (!items.length) {
        listEl.innerHTML = '<p class="securipdf-archive-empty">Arsivde belge yok. PDF duzenlerken <strong>Arsive kaydet</strong> ile ekleyebilirsiniz.</p>';
      } else {
        listEl.innerHTML = items.map(renderPanelItem).join('');
      }
      if (quotaEl) {
        quotaEl.innerHTML = renderQuotaHtml(data);
      }
      updateHomeSummary(data);
      return data;
    } catch (e) {
      listEl.innerHTML = '<p class="securipdf-archive-empty securipdf-archive-error">' + escapeHtml(e.message) + '</p>';
      return null;
    }
  }

  function getArchiveOverlay() {
    return document.getElementById('securipdfArchiveOverlay');
  }

  function setArchiveModalOpen(open) {
    var overlay = getArchiveOverlay();
    if (!overlay) {
      return;
    }
    overlay.classList.toggle('hidden', !open);
    overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('securipdf-archive-modal-open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    var toggleBtn = document.getElementById('securipdfArchiveList');
    if (toggleBtn) {
      toggleBtn.classList.toggle('toggled', open);
    }
  }

  function dismissViewerOverlays() {
    window.__securipdfVaultDocumentLoaded = true;
    setArchiveModalOpen(false);
    if (typeof window.securipdfHideUploadPrompt === 'function') {
      window.securipdfHideUploadPrompt();
    } else {
      var uploadPrompt = document.getElementById('securipdfUploadPrompt');
      if (uploadPrompt) {
        uploadPrompt.classList.add('hidden');
      }
    }
    if (typeof window.securipdfRefreshUploadPrompt === 'function') {
      window.securipdfRefreshUploadPrompt();
    }
  }

  async function openArchiveModal() {
    injectArchiveModal();
    setArchiveModalOpen(true);
    await renderArchiveModal();
  }

  async function openArchivedDocument(docId, name) {
    if (!docId) {
      throw new Error('Belge kimligi bulunamadi');
    }

    if (!isViewPdfPage()) {
      rememberPendingVault(docId, name);
      rememberFilename(name || docId + '.pdf');
      window.location.href = viewPdfUrl(docId);
      return;
    }

    var res = await fetch(VAULT_API + '/documents/' + encodeURIComponent(docId), { credentials: 'same-origin' });
    if (!res.ok) {
      throw new Error('Belge acilamadi (' + res.status + ')');
    }
    var blob = await res.blob();
    var displayName = sanitizeFilename(name || docId + '.pdf');
    rememberFilename(displayName);
    dismissViewerOverlays();

    var app = await waitForPdfViewer();
    var uint8 = new Uint8Array(await blob.arrayBuffer());

    try {
      await app.open({ data: uint8, originalUrl: displayName });
    } catch (e1) {
      var blobUrl = URL.createObjectURL(blob);
      try {
        await app.open({ url: blobUrl, originalUrl: displayName });
      } finally {
        setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 120000);
      }
    }

    clearPendingVault();
    dismissViewerOverlays();
  }

  async function downloadArchivedDocument(docId, name) {
    var res = await fetch(VAULT_API + '/documents/' + encodeURIComponent(docId));
    if (!res.ok) {
      throw new Error('Indirme basarisiz');
    }
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name || docId + '.pdf';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function deleteArchivedDocument(docId) {
    if (!window.confirm('Bu belge arsivden silinsin mi?')) {
      return;
    }
    var res = await fetch(VAULT_API + '/documents/' + encodeURIComponent(docId), { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      throw new Error('Silme basarisiz');
    }
  }

  function bindArchiveModalEvents() {
    var overlay = getArchiveOverlay();
    if (!overlay || overlay.dataset.bound === '1') {
      return;
    }
    overlay.dataset.bound = '1';

    var modal = overlay.querySelector('.securipdf-archive-modal');

    document.getElementById('securipdfArchiveClose')?.addEventListener('click', function (evt) {
      evt.preventDefault();
      setArchiveModalOpen(false);
    });

    overlay.addEventListener('click', function (evt) {
      if (evt.target === overlay) {
        setArchiveModalOpen(false);
      }
    });

    var actionRoot = modal || overlay;
    actionRoot.addEventListener('click', async function (evt) {
      var btn = evt.target.closest('[data-action]');
      if (!btn) {
        return;
      }
      var action = btn.getAttribute('data-action');
      var id = btn.getAttribute('data-id');
      var name = decodeDataAttr(btn.getAttribute('data-name'));

      if (action === 'open' || action === 'edit') {
        rememberPendingVault(id, name);
        if (!isViewPdfPage()) {
          return;
        }
        evt.preventDefault();
        evt.stopPropagation();
        try {
          await openArchivedDocument(id, name);
        } catch (e) {
          alert(e.message);
        }
        return;
      }

      if (action === 'email') {
        evt.preventDefault();
        evt.stopPropagation();
        try {
          var sent = await emailArchivedDocument(id, name);
          if (sent) {
            alert('E-posta gonderildi: ' + sent.sentTo);
          }
        } catch (e) {
          alert(e.message);
        }
        return;
      }

      evt.preventDefault();
      evt.stopPropagation();
      try {
        if (action === 'download') {
          await downloadArchivedDocument(id, name);
        } else if (action === 'delete') {
          await deleteArchivedDocument(id);
          await renderArchiveModal();
        }
      } catch (e) {
        alert(e.message);
      }
    });

    document.addEventListener('keydown', function (evt) {
      if (evt.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) {
        setArchiveModalOpen(false);
      }
    });
  }

  function cleanupLegacyArchiveNodes() {
    document.querySelectorAll(
      '#outerContainer #securipdfArchivePanel, #outerContainer #securipdfArchiveOverlay, ' +
      '#sidebarContainer #securipdfArchiveOverlay, #sidebarContainer #securipdfArchivePanel, ' +
      '#securipdfArchivePanel:not(#securipdfArchiveOverlay #securipdfArchivePanel)'
    ).forEach(function (node) {
      node.remove();
    });
    var overlay = document.getElementById('securipdfArchiveOverlay');
    if (overlay && overlay.parentElement !== document.body) {
      overlay.remove();
    }
  }

  function injectCriticalArchiveStyles() {
    if (document.getElementById('securipdfArchiveCriticalStyles')) {
      return;
    }
    var style = document.createElement('style');
    style.id = 'securipdfArchiveCriticalStyles';
    style.textContent =
      '#securipdfArchiveOverlay{position:fixed!important;inset:0!important;z-index:2147483000!important;' +
      'display:flex!important;align-items:center!important;justify-content:center!important;' +
      'padding:1.25rem!important;background:rgba(15,23,42,.72)!important;}' +
      '#securipdfArchiveOverlay.hidden{display:none!important;}' +
      '#securipdfArchiveOverlay .securipdf-archive-modal{width:min(640px,100%);max-height:min(82vh,760px);' +
      'display:flex;flex-direction:column;background:#fff!important;color:#0f172a!important;' +
      'border:1px solid #94a3b8;border-radius:16px;overflow:hidden;box-shadow:0 24px 64px rgba(15,23,42,.35);}' +
      '#securipdfArchiveOverlay .securipdf-archive-name{color:#0f172a!important;font-weight:700!important;}' +
      '#securipdfArchiveOverlay .securipdf-archive-meta{color:#475569!important;}' +
      '#securipdfArchiveOverlay .securipdf-archive-empty{color:#334155!important;}';
    document.head.appendChild(style);
  }

  function injectNavbarArchiveLink() {
    if (document.getElementById('securipdfNavArchive')) {
      return;
    }
    var viewPdfItem = document.querySelector('a[href*="view-pdf"]')?.closest('.nav-item');
    if (!viewPdfItem || !viewPdfItem.parentNode) {
      return;
    }
    var li = document.createElement('li');
    li.className = 'nav-item';
    li.innerHTML =
      '<a class="nav-link" href="/?archive=1" id="securipdfNavArchive" title="Arsivim">' +
        '<span class="material-symbols-rounded">inventory_2</span>' +
        '<span class="icon-text" data-text="Arşivim">Arşivim</span>' +
      '</a>';
    viewPdfItem.parentNode.insertBefore(li, viewPdfItem.nextSibling);
  }

  function injectArchiveModal() {
    if (document.getElementById('securipdfArchiveOverlay')) {
      return;
    }
    var overlay = document.createElement('div');
    overlay.id = 'securipdfArchiveOverlay';
    overlay.className = 'hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Arsivim');
    overlay.innerHTML =
      '<div class="securipdf-archive-modal">' +
        '<header class="securipdf-archive-header">' +
          '<h2>Arsivim</h2>' +
          '<button type="button" id="securipdfArchiveClose" class="securipdf-archive-close" title="Kapat">' +
            '<span class="material-symbols-rounded" aria-hidden="true">close</span>' +
          '</button>' +
        '</header>' +
        '<div id="securipdfArchiveItems" class="securipdf-archive-items"></div>' +
        '<footer id="securipdfArchiveQuota" class="securipdf-archive-quota"></footer>' +
      '</div>';
    document.body.appendChild(overlay);
    bindArchiveModalEvents();
  }

  function createToolbarButton(id, title, icon) {
    var btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.className = 'toolbarButton hiddenMediumView';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML =
      '<span class="material-symbols-rounded securipdf-vault-tb-icon" aria-hidden="true">' + icon + '</span>' +
      '<span class="securipdf-tb-label">' + title + '</span>';
    return btn;
  }

  function injectToolbarButtons() {
    if (document.getElementById('securipdfArchiveSave')) {
      return;
    }
    var downloadBtn = document.getElementById('download');
    if (!downloadBtn) {
      return;
    }

    var saveBtn = createToolbarButton('securipdfArchiveSave', 'Arsive kaydet', 'archive');
    saveBtn.addEventListener('click', async function () {
      try {
        var meta = await archiveCurrentPdf();
        alert('Arsive kaydedildi: ' + (meta.name || meta.id));
        if (getArchiveOverlay() && !getArchiveOverlay().classList.contains('hidden')) {
          await renderArchiveModal();
        }
        updateHomeSummary(await loadArchiveList().catch(function () { return null; }));
      } catch (e) {
        alert('Arsiv hatasi: ' + e.message);
      }
    });

    var listBtn = createToolbarButton('securipdfArchiveList', 'Arsivim', 'folder_open');
    listBtn.addEventListener('click', function () {
      openArchiveModal();
    });

    var emailBtn = createToolbarButton('securipdfArchiveEmail', 'E-posta gonder', 'mail');
    emailBtn.addEventListener('click', async function () {
      try {
        var sent = await emailCurrentPdf();
        if (sent) {
          alert('E-posta gonderildi: ' + sent.sentTo);
        }
      } catch (e) {
        alert('E-posta hatasi: ' + e.message);
      }
    });

    downloadBtn.insertAdjacentElement('afterend', saveBtn);
    saveBtn.insertAdjacentElement('afterend', listBtn);
    listBtn.insertAdjacentElement('afterend', emailBtn);
  }

  function bindPdfJsFilenameTracking() {
    waitForPdfViewer().then(function (app) {
      app.eventBus.on('fileinputchange', function (evt) {
        if (evt.fileInput && evt.fileInput.files && evt.fileInput.files[0]) {
          rememberFilename(evt.fileInput.files[0].name);
          dismissViewerOverlays();
        }
      });
      app.eventBus.on('documentloaded', function () {
        var name = app._contentDispositionFilename || app.contentDispositionFilename || filenameFromUrl(app.url || '');
        if (name) {
          rememberFilename(name);
        }
        if (window.__securipdfLastFilename && window.__securipdfLastFilename.indexOf(WELCOME_MARKER) < 0) {
          dismissViewerOverlays();
        }
      });
    }).catch(function () {
      setTimeout(bindPdfJsFilenameTracking, 300);
    });
  }

  var vaultQueryHandled = false;
  var vaultQueryInProgress = false;

  function clearVaultQueryParam() {
    try {
      var url = new URL(window.location.href);
      if (!url.searchParams.has('vault')) {
        return;
      }
      url.searchParams.delete('vault');
      var next = url.pathname + url.search + url.hash;
      window.history.replaceState({}, '', next);
    } catch (e) {
      /* ignore */
    }
  }

  async function openVaultFromQuery() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('archive') === '1') {
      await openArchiveModal();
    }

    var target = await resolveVaultTarget();
    if (!target || vaultQueryHandled || vaultQueryInProgress) {
      return;
    }
    if (!isViewPdfPage()) {
      return;
    }

    window.__securipdfVaultDocumentLoaded = false;
    vaultQueryInProgress = true;
    var lastError = null;
    try {
      for (var attempt = 0; attempt < 30; attempt += 1) {
        try {
          await openArchivedDocument(target.id, target.name);
          vaultQueryHandled = true;
          clearVaultQueryParam();
          return;
        } catch (e) {
          lastError = e;
          await new Promise(function (resolve) { setTimeout(resolve, 500); });
        }
      }
      if (lastError) {
        alert('Arsiv belgesi acilamadi: ' + lastError.message);
      }
    } finally {
      vaultQueryInProgress = false;
    }
  }

  function isHomePage() {
    return !!document.getElementById('searchBar') || !!document.getElementById('page-container');
  }

  function isViewPdfPage() {
    return window.location.pathname.indexOf('view-pdf') >= 0;
  }

  function updateHomeSummary(data) {
    var summary = document.getElementById('securipdfHomeArchiveSummary');
    if (!summary || !data) {
      return;
    }
    var total = data.total || (data.items ? data.items.length : 0);
    if (!total) {
      summary.textContent = 'Henuz kayitli belge yok';
      return;
    }
    summary.textContent = total + ' belge · ' + formatBytes(data.usedBytes || 0) + ' kullaniliyor';
  }

  function injectHomeArchiveCard() {
    if (document.getElementById('securipdfHomeArchiveCard')) {
      return;
    }
    if (!isHomePage() || isViewPdfPage()) {
      return;
    }

    var anchor = document.getElementById('searchBar') || document.querySelector('.features-container');
    if (!anchor || !anchor.parentNode) {
      return;
    }

    var card = document.createElement('section');
    card.id = 'securipdfHomeArchiveCard';
    card.className = 'securipdf-home-archive-cta';
    card.innerHTML =
      '<div class="securipdf-home-archive-cta-main">' +
        '<span class="material-symbols-rounded securipdf-home-archive-cta-icon" aria-hidden="true">inventory_2</span>' +
        '<div>' +
          '<h3>Arsivim</h3>' +
          '<p>Kaydettiginiz PDF belgelerine buradan erisin, indirin veya duzenleyin.</p>' +
          '<span id="securipdfHomeArchiveSummary" class="securipdf-home-archive-cta-summary">Yukleniyor...</span>' +
        '</div>' +
      '</div>' +
      '<button type="button" id="securipdfOpenArchiveBtn" class="securipdf-home-archive-open-btn">' +
        '<span class="material-symbols-rounded" aria-hidden="true">folder_open</span>' +
        'Belgelerimi Goster' +
      '</button>';

    if (anchor.id === 'searchBar') {
      anchor.parentNode.insertBefore(card, anchor.nextSibling);
    } else {
      anchor.parentNode.insertBefore(card, anchor);
    }

    document.getElementById('securipdfOpenArchiveBtn')?.addEventListener('click', function () {
      openArchiveModal();
    });

    loadArchiveList().then(updateHomeSummary).catch(function () {
      var summary = document.getElementById('securipdfHomeArchiveSummary');
      if (summary) {
        summary.textContent = 'Arsiv bilgisi alinamadi';
      }
    });
  }

  function initViewPdf() {
    injectToolbarButtons();
    bindPdfJsFilenameTracking();

    var params = new URLSearchParams(window.location.search);
    if (params.get('vault') || peekPendingVault()) {
      window.__securipdfVaultDocumentLoaded = false;
    }

    function scheduleVaultOpen() {
      openVaultFromQuery().catch(function () { /* retry loop icinde hata gosterilir */ });
    }

    whenPdfViewerReady(scheduleVaultOpen);
    setTimeout(scheduleVaultOpen, 1500);
    setTimeout(scheduleVaultOpen, 4000);
    setTimeout(scheduleVaultOpen, 8000);
  }

  function initHome() {
    injectHomeArchiveCard();
    var params = new URLSearchParams(window.location.search);
    if (params.get('archive') === '1') {
      openArchiveModal();
    }
  }

  function bindNavbarArchiveLink() {
    var link = document.getElementById('securipdfNavArchive');
    if (!link || link.dataset.bound === '1') {
      return;
    }
    link.dataset.bound = '1';
    link.addEventListener('click', function (evt) {
      evt.preventDefault();
      openArchiveModal();
    });
  }

  function init() {
    injectCriticalArchiveStyles();
    cleanupLegacyArchiveNodes();
    injectArchiveModal();
    bindNavbarArchiveLink();
    injectNavbarArchiveLink();
    bindNavbarArchiveLink();

    if (isViewPdfPage()) {
      initViewPdf();
    }
    if (isHomePage() && !isViewPdfPage()) {
      initHome();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
  setTimeout(init, 800);
  setTimeout(init, 2500);

  window.securipdfOpenPendingVault = openVaultFromQuery;
})();
