(function () {
  'use strict';

  var APP = '/api/app/v1';
  var VAULT = '/api/vault/v1';
  var JOBS_API = APP + '/jobs';

  var state = {
    me: null,
    branding: null,
    tools: [],
    categories: [],
    favoriteSet: {},
    fileScope: 'documents',
    folderId: null,
    documents: [],
    docSearchQuery: '',
    docSearchTimer: null,
    selectedDocIds: {},
    activeActivityDocId: null,
    uiConfig: { defaultDocumentList: 'all', documentsTtlValue: 7, documentsTtlUnit: 'days' },
    quota: { usedBytes: 0, quotaBytes: 0 },
    currentTool: null,
    activeToolId: null,
    toolsCategoryFilter: '',
    jobsPollTimer: null,
    activeJobId: null
  };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatBytes(n) {
    if (!n) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB'];
    var i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + u[i];
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
    } catch (e) {
      return iso;
    }
  }

  function toast(msg, isErr) {
    var host = $('toastHost');
    var el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  }

  function redirectToLogin() {
    var rd = window.location.pathname + window.location.search;
    if (rd === '/' || rd === '/app/' || rd === '/app') {
      rd = '/';
    }
    window.location.replace('/oauth2/start?rd=' + encodeURIComponent(rd || '/'));
  }

  function isAuthFailureResponse(r) {
    if (!r) return false;
    if (r.type === 'opaqueredirect') return true;
    var s = r.status;
    return s === 0 || s === 302 || s === 301 || s === 401 || s === 403;
  }

  function isAuthFetchError(err) {
    if (!err) return false;
    if (err.status === 401 || err.status === 403) return true;
    var msg = String((err && err.message) || err);
    return /failed to fetch|networkerror|network error|load failed|cors/i.test(msg);
  }

  function fetchJson(url, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.redirect = 'manual';
    return fetch(url, opts).then(function (r) {
      if (isAuthFailureResponse(r)) {
        redirectToLogin();
        return new Promise(function () {});
      }
      if (!r.ok) {
        return r.text().then(function (t) {
          var err = new Error(formatHttpError(t, r.status));
          err.status = r.status;
          if (r.status === 401 || r.status === 403) {
            redirectToLogin();
            return new Promise(function () {});
          }
          throw err;
        });
      }
      if (r.status === 204) return null;
      return r.json();
    }).catch(function (err) {
      if (isAuthFetchError(err)) {
        redirectToLogin();
        return new Promise(function () {});
      }
      throw err;
    });
  }

  function fetchJsonRetry(url, opts, attempt) {
    attempt = attempt || 0;
    return fetchJson(url, opts).catch(function (err) {
      var transient = err.status === 502 || err.status === 503 || err.status === 504;
      if (transient && attempt < 12) {
        return new Promise(function (resolve) { setTimeout(resolve, 1500); }).then(function () {
          return fetchJsonRetry(url, opts, attempt + 1);
        });
      }
      throw err;
    });
  }

  function formatHttpError(text, status) {
    if (!text) return status ? 'HTTP ' + status : 'Bilinmeyen hata';
    if (/<title>\s*502\s+Bad Gateway\s*<\/title>/i.test(text)) {
      return 'Geçici sunucu hatası (502). Platform yeniden başlıyor olabilir; işlem arka planda devam ediyorsa birkaç saniye bekleyin.';
    }
    if (text.charAt(0) === '<') {
      return (status ? 'HTTP ' + status + ' — ' : '') + 'Sunucu hatası (HTML yanıt)';
    }
    return text.length > 240 ? text.slice(0, 240) + '…' : text;
  }

  function formatFetchError(err) {
    var msg = (err && err.message) ? err.message : String(err);
    if (/failed to fetch|networkerror|network error|load failed/i.test(msg)) {
      return 'Sunucuya bağlanılamadı (oturum süresi veya PDF motoru). Sayfayı yenileyip tekrar deneyin.';
    }
    return msg;
  }

  function jobErrorLabel(code) {
    var map = {
      STIRLING_OCR_UNAVAILABLE: 'OCR motoru yanıt vermedi. Türkçe dil paketi (tur.traineddata) kurulu mu? scripts/setup-tessdata.sh çalıştırın.',
      STIRLING_REQUEST_FAILED: 'PDF motoruna istek gönderilemedi. Sayfayı yenileyip tekrar deneyin.',
      STIRLING_UNREACHABLE: 'PDF motoruna bağlanılamadı (entera-pdf çalışıyor mu?)',
      STIRLING_HTTP_400: 'PDF motoru isteği reddetti (400) — filigran metninde geçersiz karakter olabilir',
      STIRLING_HTTP_403: 'PDF motorunda bu araç devre dışı (403). Yönetici: config/custom_settings.yml içinde ilgili endpoint\'i etkinleştirin.',
      STIRLING_HTTP_502: 'PDF motoru geçici olarak kullanılamıyor (502)',
      STIRLING_HTTP_500: 'PDF motoru işlemi tamamlayamadı (500)',
      WATERMARK_RENDER_FAILED: 'Filigran uygulanamadı — dosyayı yeniden deneyin',
      COMPARE_INPUT_MISSING: 'Karşılaştırma için iki PDF gerekli',
      COMPARE_NO_TEXT: 'PDF\'lerde metin bulunamadı — taranmış belgeler için önce OCR uygulayın',
      COMPARE_FAILED: 'Karşılaştırma raporu oluşturulamadı',
      REDACTION_NO_MATCHES: 'Seçilen desenlerle eşleşme bulunamadı — önce Belgede tara veya OCR uygulayın',
      REDACTION_FAILED: 'Karartma uygulanamadı',
      REDACTION_NO_PATTERNS: 'Karartma deseni seçilmedi'
    };
    return map[code] || code || 'İş başarısız';
  }

  function applyBranding(b) {
    if (!b) return;
    var primary = b.primaryColor || '#1d4ed8';
    var accent = b.accentColor || '#0f766e';
    document.documentElement.style.setProperty('--primary', primary);
    document.documentElement.style.setProperty('--primary-dark', primary);
    document.documentElement.style.setProperty('--accent', accent);
    var name = b.appName || 'SecuriPDF';
    $('footerAppName').textContent = name;
    document.title = name;
    $('headerTagline').textContent = b.homeDescription || 'Kurumsal PDF işleme platformu';
    var logoUrl = b.platformLogoUrl || b.platformIconUrl || '/app/static/platform-logo.svg';
    var sidebarLogo = $('sidebarLogo');
    if (sidebarLogo) {
      sidebarLogo.src = logoUrl + '?t=' + Date.now();
      sidebarLogo.alt = name;
      sidebarLogo.removeAttribute('width');
      sidebarLogo.removeAttribute('height');
    }
    var wrap = $('customerLogoWrap');
    if (b.customerLogoUrl) {
      var cust = $('headerCustomerLogo');
      cust.src = b.customerLogoUrl + '?t=' + Date.now();
      cust.alt = (b.customerName || 'Müşteri') + ' logosu';
      wrap.hidden = false;
    } else {
      wrap.hidden = true;
    }
  }

  function applyMe(me) {
    state.me = me;
    var display = me.displayName || me.email || 'Kullanıcı';
    $('userDisplayName').textContent = display;
    $('userEmail').textContent = me.email || display;
    var initials = display.slice(0, 2).toUpperCase();
    $('userAvatar').textContent = initials;
    var adminWrap = $('sidebarAdminWrap');
    if (adminWrap) adminWrap.hidden = !me.isAdmin;
    $('profileDisplayName').value = me.displayName || '';
    $('profileEmail').value = me.email || '';
    $('profileUserId').value = me.userId || '';
    $('profileLocale').value = me.locale || 'tr-TR';
    state.favoriteSet = {};
    (me.favoriteTools || []).forEach(function (id) { state.favoriteSet[id] = true; });
  }

  function applyLicense(lic) {
    var box = $('profileLicense');
    if (!box) return;
    if (!lic) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.classList.remove('expired', 'valid');
    if (lic.expired) box.classList.add('expired');
    else if (lic.valid !== false) box.classList.add('valid');
    $('profileLicensePackage').textContent = lic.packageLabel || lic.package || '—';
    var toolCount = lic.enabledToolCount != null
      ? lic.enabledToolCount
      : ((lic.enabledTools || []).length);
    $('profileLicenseTools').textContent = toolCount + ' araç';
    var expEl = $('profileLicenseExpiry');
    var statusEl = $('profileLicenseStatus');
    var expRaw = lic.expiresAt;
    if (expRaw) {
      try {
        expEl.textContent = new Date(expRaw).toLocaleDateString('tr-TR', {
          year: 'numeric', month: 'long', day: 'numeric'
        });
      } catch (e) {
        expEl.textContent = expRaw;
      }
    } else {
      expEl.textContent = 'Süresiz';
    }
    if (statusEl) {
      if (lic.expired) {
        statusEl.textContent = 'Süresi dolmuş';
        statusEl.className = 'profile-license-status expired';
        statusEl.hidden = false;
      } else if (lic.valid === false) {
        statusEl.textContent = 'Geçersiz';
        statusEl.className = 'profile-license-status invalid';
        statusEl.hidden = false;
      } else {
        statusEl.textContent = 'Geçerli';
        statusEl.className = 'profile-license-status valid';
        statusEl.hidden = false;
      }
    }
  }

  function loadLicense() {
    return fetchJson(APP + '/license').then(function (lic) {
      applyLicense(lic);
      state.license = lic;
    }).catch(function () {
      applyLicense(null);
    });
  }

  var DOC_ICONS = {
    preview: { icon: '👁', title: 'Önizle' },
    download: { icon: '⬇', title: 'İndir' },
    email: { icon: '✉', title: 'E-posta' },
    edit: { icon: '✎', title: 'Düzenle' },
    archive: { icon: '🗄', title: 'Arşivle' },
    restore: { icon: '↩', title: 'Geri al' },
    share: { icon: '🔗', title: 'Paylaş' },
    history: { icon: '📋', title: 'İşlem geçmişi' },
    delete: { icon: '🗑', title: 'Sil', danger: true }
  };

  function docActionKeys() {
    return state.fileScope === 'archive'
      ? ['preview', 'download', 'email', 'restore', 'history', 'delete']
      : ['pin', 'preview', 'download', 'email', 'edit', 'archive', 'history', 'delete'];
  }

  function docActionMeta(action, doc) {
    if (action === 'pin') {
      var pinned = doc && doc.pinned;
      return { icon: pinned ? '📍' : '📌', title: pinned ? 'Sabitlemeyi kaldır' : 'Sabitle (arşive taşınmasın)' };
    }
    return DOC_ICONS[action];
  }

  function docActionButtons(doc) {
    return docActionKeys().map(function (action) {
      var meta = docActionMeta(action, doc);
      if (!meta) return '';
      var extra = action === 'pin' ? ' pin-btn' + (doc.pinned ? ' active' : '') : '';
      var cls = 'icon-btn' + extra + (meta.danger ? ' danger' : '') +
        (state.activeActivityDocId === doc.id && action === 'history' ? ' active' : '');
      return '<button type="button" class="' + cls + '" title="' + meta.title + '" data-doc-action="' + action + '" data-doc-id="' + escapeHtml(doc.id) + '">' + meta.icon + '</button>';
    }).join('');
  }

  function activityDetailText(detail, action) {
    if (!detail || !Object.keys(detail).length) return '';
    var parts = [];
    if (action === 'document.email' || detail.channel === 'email') {
      parts.push('Kanal: E-posta');
    }
    if (detail.size) parts.push('Boyut: ' + formatBytes(detail.size));
    if (detail.scope) parts.push('Alan: ' + (detail.scope === 'archive' ? 'Arşiv' : 'Belgeler'));
    return parts.join(' · ');
  }

  function formatArchiveRemaining(doc) {
    if (state.fileScope === 'archive') return '—';
    if (doc.pinned) return '<span class="retention-badge pinned">Sabitlendi</span>';
    if (!doc.archiveAt) return '—';
    var ms = new Date(doc.archiveAt).getTime() - Date.now();
    if (ms <= 0) return '<span class="retention-badge due">Arşivleniyor…</span>';
    var hours = ms / 3600000;
    if (hours < 48) return Math.max(1, Math.ceil(hours)) + ' sa';
    return Math.ceil(hours / 24) + ' gün';
  }

  function formatStatusCell(doc) {
    if (state.fileScope === 'archive') {
      return formatDate(doc.modifiedAt || doc.createdAt);
    }
    return formatArchiveRemaining(doc);
  }

  function statusColumnLabel() {
    return state.fileScope === 'archive' ? 'Arşivlenme' : 'Arşive kalan';
  }

  function docTableRowClass() {
    return 'doc-table-row doc-table-row--files';
  }

  function getSelectedDocIds() {
    return Object.keys(state.selectedDocIds).filter(function (id) { return state.selectedDocIds[id]; });
  }

  function clearDocSelection() {
    state.selectedDocIds = {};
    updateBulkBar();
    renderDocTable();
  }

  function toggleDocSelection(docId, checked) {
    if (checked) state.selectedDocIds[docId] = true;
    else delete state.selectedDocIds[docId];
    updateBulkBar();
    var card = document.querySelector('.doc-card[data-doc-id="' + docId + '"]');
    if (card) card.classList.toggle('selected', !!checked);
  }

  function updateBulkBar() {
    var bar = $('bulkActionBar');
    var countEl = $('bulkSelectedCount');
    if (!bar) return;
    var ids = getSelectedDocIds();
    var n = ids.length;
    bar.hidden = n === 0;
    if (countEl) countEl.textContent = n + ' seçili';
    var isArchive = state.fileScope === 'archive';
    var archiveBtn = $('btnBulkArchive');
    var restoreBtn = $('btnBulkRestore');
    var pinBtn = $('btnBulkPin');
    var unpinBtn = $('btnBulkUnpin');
    if (archiveBtn) archiveBtn.hidden = isArchive;
    if (restoreBtn) restoreBtn.hidden = !isArchive;
    if (pinBtn) pinBtn.hidden = isArchive;
    if (unpinBtn) unpinBtn.hidden = isArchive;
  }

  function allVisibleSelected() {
    if (!state.documents.length) return false;
    return state.documents.every(function (d) { return state.selectedDocIds[d.id]; });
  }

  function renderDocHeader() {
    var header = $('docListHeader');
    if (!header) return;
    header.setAttribute('aria-hidden', 'false');
    header.className = 'doc-list-header ' + docTableRowClass();
    var icons = docActionKeys().map(function (key) {
      var meta = key === 'pin' ? docActionMeta('pin', { pinned: false }) : DOC_ICONS[key];
      return '<span class="icon-legend" title="' + meta.title + '">' + meta.icon + '</span>';
    }).join('');
    var allChecked = allVisibleSelected();
    header.innerHTML =
      '<span class="col-select"><input type="checkbox" class="doc-row-check" id="docSelectAll" title="Tümünü seç"' +
      (allChecked ? ' checked' : '') + '></span>' +
      '<span class="col-name">Belge</span>' +
      '<span class="col-size">Boyut</span>' +
      '<span class="col-date">Yüklenme</span>' +
      '<span class="col-status">' + statusColumnLabel() + '</span>' +
      '<span class="col-actions doc-header-icons">' + icons + '</span>';
    var selectAll = $('docSelectAll');
    if (selectAll) {
      selectAll.indeterminate = !allChecked && getSelectedDocIds().length > 0;
      selectAll.addEventListener('change', function () {
        var checked = selectAll.checked;
        state.documents.forEach(function (d) {
          if (checked) state.selectedDocIds[d.id] = true;
          else delete state.selectedDocIds[d.id];
        });
        updateBulkBar();
        renderDocTable();
      });
    }
  }

  function showDocActionProgress(text, pct) {
    var panel = $('docActionPanel');
    if (!panel) return;
    panel.hidden = false;
    $('docActionProgressText').textContent = text || '';
    setProgressBar('docActionProgressBar', pct || 5);
  }

  function hideDocActionProgress() {
    var panel = $('docActionPanel');
    if (panel) panel.hidden = true;
    setProgressBar('docActionProgressBar', 0);
  }

  function jobTitle(job) {
    if (job.toolId === 'document-email') {
      var labels = job.inputLabels || {};
      var name = Object.keys(labels).map(function (k) { return labels[k]; })[0];
      return 'E-posta: ' + (name || 'Belge');
    }
    var tool = state.tools.find(function (t) { return t.id === job.toolId; });
    return tool ? tool.title : job.toolId;
  }

  function showDocumentActivity(doc) {
    state.activeActivityDocId = doc.id;
    var modal = $('docModal');
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    $('activityDocTitle').textContent = doc.name;
    $('activityDocGuid').textContent = doc.documentGuid || doc.id;
    $('activityTimeline').innerHTML = '<li class="empty-cell">Yükleniyor…</li>';
    fetchJson(VAULT + '/documents/' + encodeURIComponent(doc.id) + '/activity').then(function (data) {
      var events = data.events || [];
      if (!events.length) {
        $('activityTimeline').innerHTML = '<li>Henüz kayıtlı işlem yok.</li>';
        return;
      }
      $('activityTimeline').innerHTML = events.map(function (ev) {
        var meta = activityDetailText(ev.detail, ev.action);
        return '<li><span class="activity-time">' + formatDate(ev.timestamp) + '</span>' +
          '<div><span class="activity-label">' + escapeHtml(ev.label || ev.action) + '</span>' +
          (meta ? '<div class="activity-meta">' + escapeHtml(meta) + '</div>' : '') + '</div></li>';
      }).join('');
    }).catch(function () {
      $('activityTimeline').innerHTML = '<li>Geçmiş yüklenemedi.</li>';
    });
    renderDocTable();
  }

  function closeDocumentActivity() {
    state.activeActivityDocId = null;
    var modal = $('docModal');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
    renderDocTable();
  }

  function jobStatusLabel(status) {
    var map = {
      queued: 'Kuyrukta',
      running: 'İşleniyor',
      completed: 'Tamamlandı',
      failed: 'Hata'
    };
    return map[status] || status;
  }

  function setProgressBar(barId, pct) {
    var el = $(barId);
    if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function renderJobsTable(items) {
    var tbody = $('jobsTableBody');
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Henüz iş yok.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map(function (job) {
      var title = jobTitle(job);
      var dl = job.status === 'completed'
        ? '<button type="button" class="btn btn-sm" data-dl-job="' + escapeHtml(job.id) + '">İndir</button>'
        : '';
      return '<tr data-job-id="' + escapeHtml(job.id) + '">' +
        '<td>' + escapeHtml(title) + '</td>' +
        '<td>' + escapeHtml(jobStatusLabel(job.status)) + '</td>' +
        '<td class="job-progress-cell"><div class="progress-wrap"><div class="progress-bar" style="width:' + (job.progress || 0) + '%"></div></div></td>' +
        '<td>' + formatDate(job.createdAt) + '</td>' +
        '<td>' + dl + '</td></tr>';
    }).join('');
    tbody.querySelectorAll('[data-dl-job]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.location.href = JOBS_API + '/' + encodeURIComponent(btn.getAttribute('data-dl-job')) + '/result';
      });
    });
  }

  function loadJobs() {
    return fetchJson(JOBS_API + '?size=30').then(function (data) {
      renderJobsTable(data.items || []);
      var active = (data.items || []).find(function (j) {
        return j.status === 'queued' || j.status === 'running';
      });
      if (active) {
        showActiveJob(active);
        startJobsPoll(active.id);
      } else {
        $('activeJobPanel').hidden = true;
        stopJobsPoll();
      }
    }).catch(function () {
      $('jobsTableBody').innerHTML = '<tr><td colspan="5" class="empty-cell">İşler yüklenemedi.</td></tr>';
    });
  }

  function showActiveJob(job) {
    var panel = $('activeJobPanel');
    panel.hidden = false;
    $('activeJobTitle').textContent = jobTitle(job) + ' — ' + jobStatusLabel(job.status);
    setProgressBar('activeJobProgress', job.progress || 0);
    $('activeJobStatus').textContent = 'İş kimliği: ' + job.id;
  }

  function stopJobsPoll() {
    if (state.jobsPollTimer) {
      clearInterval(state.jobsPollTimer);
      state.jobsPollTimer = null;
    }
    state.activeJobId = null;
  }

  function startJobsPoll(jobId) {
    if (state.activeJobId === jobId && state.jobsPollTimer) return;
    stopJobsPoll();
    state.activeJobId = jobId;
    state.jobsPollTimer = setInterval(function () {
      fetchJsonRetry(JOBS_API + '/' + encodeURIComponent(jobId)).then(function (job) {
        showActiveJob(job);
        if (job.status === 'completed') {
          stopJobsPoll();
          toast('İş tamamlandı — indirebilirsiniz.');
          loadJobs();
        } else if (job.status === 'failed') {
          stopJobsPoll();
          toast('İş başarısız: ' + (job.errorCode || ''), true);
          loadJobs();
        }
      }).catch(function () { stopJobsPoll(); });
    }, 1200);
  }

  function pollJobUntilDone(jobId, onProgress) {
    return new Promise(function (resolve, reject) {
      function tick() {
        fetchJsonRetry(JOBS_API + '/' + encodeURIComponent(jobId)).then(function (job) {
          if (onProgress) onProgress(job);
          if (job.status === 'completed') resolve(job);
          else if (job.status === 'failed') reject(new Error(jobErrorLabel(job.errorCode)));
          else setTimeout(tick, 1000);
        }).catch(reject);
      }
      tick();
    });
  }

  function parseRoute() {
    var hash = (location.hash || '#/belgeler').replace(/^#\/?/, '');
    if (!hash) return { view: 'belgeler' };
    if (hash === 'belgeler') return { view: 'belgeler', scope: 'documents' };
    if (hash === 'arsiv') return { view: 'arsiv', scope: 'archive' };
    if (hash === 'araclar') return { view: 'araclar' };
    if (hash.indexOf('araclar/') === 0) {
      var rest = hash.slice(8);
      if (rest.indexOf('cat-') === 0) return { view: 'araclar' };
      return { view: 'araclar', toolId: rest };
    }
    if (hash.indexOf('arac/') === 0) return { view: 'araclar', toolId: hash.slice(5) };
    if (hash === 'favoriler') return { view: 'favoriler' };
    if (hash === 'isler') return { view: 'isler' };
    if (hash === 'profil') return { view: 'profil' };
    return { view: 'belgeler', scope: 'documents' };
  }

  function setActiveNav(route) {
    document.querySelectorAll('.nav-item').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-route') === route);
    });
  }

  function showView(name) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    var map = {
      belgeler: 'viewFiles',
      arsiv: 'viewFiles',
      araclar: 'viewTools',
      favoriler: 'viewFavorites',
      isler: 'viewJobs',
      profil: 'viewProfile'
    };
    var el = $(map[name] || 'viewFiles');
    if (el) el.classList.add('active');
  }

  function loadBranding() {
    return fetchJson(APP + '/branding').then(function (b) {
      state.branding = b;
      applyBranding(b);
    }).catch(function () {});
  }

  function loadMe() {
    return fetchJson(APP + '/me').then(function (me) {
      applyMe(me);
    });
  }

  function loadTools() {
    return fetchJson(APP + '/tools').then(function (data) {
      state.tools = data.tools || [];
      state.categories = data.categories || [];
      (data.favoriteTools || []).forEach(function (id) { state.favoriteSet[id] = true; });
      renderToolsPage();
      renderFavoritesPage();
    });
  }

  function toolCardHtml(t, showFav) {
    var fav = state.favoriteSet[t.id] ? ' active' : '';
    var favBtn = showFav !== false
      ? '<button type="button" class="fav-btn' + fav + '" data-fav="' + escapeHtml(t.id) + '" title="Favori">★</button>'
      : '';
    return '<article class="tool-card" data-tool-id="' + escapeHtml(t.id) + '">' +
      favBtn +
      '<h4>' + escapeHtml(t.title) + '</h4>' +
      '<p>' + escapeHtml(t.description) + '</p></article>';
  }

  function bindToolCards(container) {
    if (!container) return;
    container.querySelectorAll('.tool-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.fav-btn')) return;
        openTool(card.getAttribute('data-tool-id'));
      });
    });
    container.querySelectorAll('.fav-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleFavorite(btn.getAttribute('data-fav'), btn);
      });
    });
  }

  function renderToolsPage() {
    var nav = $('toolsCategoryNav');
    var host = $('toolsGrid');
    if (!host) return;
    if (!state.tools.length) {
      if (nav) nav.hidden = true;
      host.innerHTML = '<p class="hint">Aktif araç bulunamadı.</p>';
      return;
    }

    var categories = state.categories.length
      ? state.categories
      : [{ id: 'other', label: 'Diğer', tools: state.tools }];

    if (nav) {
      var tabs = '<button type="button" class="tools-cat-tab' +
        (!state.toolsCategoryFilter ? ' active' : '') +
        '" data-cat="">Tümü</button>';
      categories.forEach(function (cat) {
        var active = state.toolsCategoryFilter === cat.id ? ' active' : '';
        tabs += '<button type="button" class="tools-cat-tab' + active +
          '" data-cat="' + escapeHtml(cat.id) + '">' + escapeHtml(cat.label) +
          ' <span class="tools-cat-count">' + (cat.tools || []).length + '</span></button>';
      });
      nav.innerHTML = tabs;
      nav.hidden = categories.length < 2;
      nav.querySelectorAll('.tools-cat-tab').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.toolsCategoryFilter = btn.getAttribute('data-cat') || '';
          renderToolsPage();
        });
      });
    }

    var filter = state.toolsCategoryFilter;
    var sections = [];
    categories.forEach(function (cat) {
      if (filter && cat.id !== filter) return;
      var tools = cat.tools || [];
      if (!tools.length) return;
      var cards = tools.map(function (t) {
        var active = state.activeToolId === t.id ? ' active' : '';
        return toolCardHtml(t, true).replace('class="tool-card"', 'class="tool-card' + active + '"');
      }).join('');
      sections.push(
        '<section class="tool-category" data-category="' + escapeHtml(cat.id) + '">' +
        '<h3>' + escapeHtml(cat.label || cat.id) + '</h3>' +
        '<div class="tool-grid tool-grid-section">' + cards + '</div></section>'
      );
    });

    host.innerHTML = sections.length
      ? sections.join('')
      : '<p class="hint">Bu kategoride araç yok.</p>';
    bindToolCards(host);
    if (state.activeToolId) highlightToolCard(state.activeToolId);
  }

  function renderFavoritesPage() {
    var favs = state.tools.filter(function (t) { return state.favoriteSet[t.id]; });
    var grid = $('favoritesGrid');
    if (!favs.length) {
      grid.innerHTML = '<p class="hint">Henüz favori araç eklemediniz. Araçlar sayfasından yıldıza tıklayın.</p>';
      return;
    }
    grid.innerHTML = favs.map(function (t) { return toolCardHtml(t, true); }).join('');
    bindToolCards(grid);
  }

  function toggleFavorite(toolId, btnEl) {
    var ids = Object.keys(state.favoriteSet).filter(function (k) { return state.favoriteSet[k]; });
    var idx = ids.indexOf(toolId);
    if (idx >= 0) ids.splice(idx, 1);
    else ids.push(toolId);
    fetchJson(APP + '/tools/favorites', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favoriteTools: ids })
    }).then(function () {
      state.favoriteSet = {};
      ids.forEach(function (id) { state.favoriteSet[id] = true; });
      if (btnEl) btnEl.classList.toggle('active', state.favoriteSet[toolId]);
      renderFavoritesPage();
      renderToolsPage();
    }).catch(function (e) { toast('Favori kaydedilemedi', true); });
  }

  function setupFilesView(scope) {
    state.fileScope = scope;
    state.folderId = null;
    state.docSearchQuery = '';
    state.selectedDocIds = {};
    closeDocumentActivity();
    var searchInput = $('docSearchInput');
    if (searchInput) searchInput.value = '';
    updateBulkBar();
    var isArchive = scope === 'archive';
    $('filesTitle').textContent = isArchive ? 'Arşivim' : 'Belgelerim';
    $('filesSubtitle').textContent = isArchive
      ? 'Arşivlenmiş belgeler ayrı depoda tutulur.'
      : 'Belgeler admin süresi dolunca otomatik arşive taşınır. Sabitlemek için 📌 kullanın.';
    $('btnNewFolder').hidden = isArchive;
    $('folderRoot').classList.add('active');
    document.querySelectorAll('.folder-item').forEach(function (b) { b.classList.remove('active'); });
    renderDocHeader();
    loadFolders();
    loadDocuments();
  }

  function loadStorageConfig() {
    return fetchJson(APP + '/storage').then(function (data) {
      state.uiConfig.defaultDocumentList = data.defaultDocumentList || 'all';
      state.uiConfig.documentsTtlValue = data.documentsTtlValue || 7;
      state.uiConfig.documentsTtlUnit = data.documentsTtlUnit || 'days';
    }).catch(function () {});
  }

  function loadFolders() {
    return fetchJson(VAULT + '/folders?scope=' + encodeURIComponent(state.fileScope)).then(function (data) {
      renderFolderTree(data.folders || []);
    }).catch(function () {
      $('folderTree').innerHTML = '';
    });
  }

  function renderFolderTree(nodes, depth) {
    depth = depth || 0;
    if (!depth) {
      $('folderTree').innerHTML = '';
      nodes.forEach(function (n) { appendFolderNode($('folderTree'), n, depth); });
      return;
    }
  }

  function appendFolderNode(ul, node, depth) {
    var li = document.createElement('li');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'folder-item' + (state.folderId === node.id ? ' active' : '');
    btn.style.paddingLeft = (1 + depth * 0.75) + 'rem';
    btn.textContent = node.name;
    btn.setAttribute('data-folder-id', node.id);
    btn.addEventListener('click', function () {
      state.folderId = node.id;
      $('folderRoot').classList.remove('active');
      document.querySelectorAll('.folder-item').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      loadDocuments();
    });
    li.appendChild(btn);
    ul.appendChild(li);
    if (node.children && node.children.length) {
      node.children.forEach(function (ch) { appendFolderNode(ul, ch, depth + 1); });
    }
  }

  function loadDocuments() {
    var url = VAULT + '/documents?scope=' + encodeURIComponent(state.fileScope) + '&size=100';
    if (state.docSearchQuery) {
      url += '&q=' + encodeURIComponent(state.docSearchQuery);
    } else if (state.folderId) {
      url += '&folder_id=' + encodeURIComponent(state.folderId);
    }
    $('docList').innerHTML = '<p class="empty-cell">Yükleniyor…</p>';
    return fetchJson(url).then(function (data) {
      state.documents = data.items || [];
      var visibleIds = {};
      state.documents.forEach(function (d) { visibleIds[d.id] = true; });
      Object.keys(state.selectedDocIds).forEach(function (id) {
        if (!visibleIds[id]) delete state.selectedDocIds[id];
      });
      state.quota.usedBytes = data.usedBytes || 0;
      state.quota.quotaBytes = data.quotaBytes || 0;
      renderQuota();
      updateBulkBar();
      renderDocTable();
    }).catch(function () {
      $('docList').innerHTML = '<p class="empty-cell">Belgeler yüklenemedi.</p>';
    });
  }

  function scheduleDocSearch() {
    if (state.docSearchTimer) clearTimeout(state.docSearchTimer);
    state.docSearchTimer = setTimeout(function () {
      state.docSearchTimer = null;
      loadDocuments();
    }, 300);
  }

  function renderQuota() {
    var used = state.quota.usedBytes;
    var max = state.quota.quotaBytes || 1;
    var pct = Math.min(100, Math.round((used / max) * 100));
    $('quotaBar').hidden = false;
    $('quotaFill').style.width = pct + '%';
    $('quotaText').textContent = formatBytes(used) + ' / ' + formatBytes(max) + ' (' + pct + '%)';
    $('profileQuota').textContent = 'Depolama: ' + formatBytes(used) + ' / ' + formatBytes(max);
  }

  function renderDocTable() {
    renderDocHeader();
    var list = $('docList');
    if (!state.documents.length) {
      var emptyMsg = state.docSearchQuery
        ? 'Arama sonucu bulunamadı.'
        : (state.fileScope === 'archive'
          ? 'Arşivde belge yok.'
          : 'Bu konumda belge yok. Yüklemek için Yükle düğmesini kullanın.');
      list.innerHTML = '<p class="empty-cell">' + emptyMsg + '</p>';
      return;
    }
    var rowCls = docTableRowClass();
    list.innerHTML = state.documents.map(function (d) {
      var guid = d.documentGuid || d.id;
      var checked = !!state.selectedDocIds[d.id];
      return '<article class="doc-card' + (checked ? ' selected' : '') + '" data-doc-id="' + escapeHtml(d.id) + '">' +
        '<div class="' + rowCls + '">' +
        '<span class="col-select"><input type="checkbox" class="doc-row-check" data-doc-select="' + escapeHtml(d.id) + '"' +
        (checked ? ' checked' : '') + ' aria-label="Belge seç"></span>' +
        '<div class="col-name doc-name-cell"><span class="doc-title">' + escapeHtml(d.name) + '</span>' +
        '<span class="doc-guid" title="Belge GUID">' + escapeHtml(guid) + '</span></div>' +
        '<span class="col-size doc-card-meta">' + formatBytes(d.sizeBytes) + '</span>' +
        '<span class="col-date doc-card-meta">' + formatDate(d.createdAt) + '</span>' +
        '<span class="col-status doc-card-meta">' + formatStatusCell(d) + '</span>' +
        '<div class="col-actions doc-actions-inline">' + docActionButtons(d) + '</div>' +
        '</div></article>';
    }).join('');
    list.querySelectorAll('[data-doc-select]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        toggleDocSelection(cb.getAttribute('data-doc-select'), cb.checked);
      });
    });
    list.querySelectorAll('[data-doc-action]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        docAction(btn.getAttribute('data-doc-action'), btn.getAttribute('data-doc-id'));
      });
    });
  }

  function runBulkSequential(ids, requestFn, doneLabel) {
    if (!ids.length) return Promise.resolve();
    var failed = 0;
    var index = 0;
    function next() {
      if (index >= ids.length) {
        if (failed) toast(doneLabel + ' — ' + (ids.length - failed) + ' başarılı, ' + failed + ' hata', failed === ids.length);
        else toast(doneLabel + ' (' + ids.length + ' belge)');
        clearDocSelection();
        return loadDocuments();
      }
      var id = ids[index++];
      return requestFn(id).then(next).catch(function () {
        failed++;
        return next();
      });
    }
    return next();
  }

  function bulkArchive(ids) {
    if (!confirm(ids.length + ' belge arşivlensin mi?')) return;
    runBulkSequential(ids, function (id) {
      return fetchJson(VAULT + '/documents/' + encodeURIComponent(id) + '/archive', { method: 'POST' });
    }, 'Arşivleme');
  }

  function bulkRestore(ids) {
    if (!confirm(ids.length + ' belge belgelere geri alınsın mı?')) return;
    runBulkSequential(ids, function (id) {
      return fetchJson(VAULT + '/documents/' + encodeURIComponent(id) + '/restore', { method: 'POST' });
    }, 'Geri alma');
  }

  function bulkDelete(ids) {
    if (!confirm(ids.length + ' belge silinsin mi?')) return;
    runBulkSequential(ids, function (id) {
      return fetch(VAULT + '/documents/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); });
    }, 'Silme');
  }

  function bulkPin(ids, pinned) {
    runBulkSequential(ids, function (id) {
      return fetchJson(VAULT + '/documents/' + encodeURIComponent(id) + '/pin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: pinned })
      });
    }, pinned ? 'Sabitleme' : 'Sabitleme kaldırma');
  }

  function docAction(action, docId) {
    var doc = state.documents.find(function (d) { return d.id === docId; });
    if (!doc && action !== 'delete') return;
    if (action === 'preview') {
      if (doc && (doc.mimeType === 'application/zip' || (doc.name || '').toLowerCase().endsWith('.zip'))) {
        window.location.href = VAULT + '/documents/' + encodeURIComponent(docId);
        return;
      }
      window.open(VAULT + '/documents/' + encodeURIComponent(docId) + '/preview', '_blank');
    } else if (action === 'download') {
      window.location.href = VAULT + '/documents/' + encodeURIComponent(docId);
    } else if (action === 'email') {
      showDocActionProgress('E-posta kuyruğa alınıyor…', 5);
      fetchJson(VAULT + '/documents/' + encodeURIComponent(docId) + '/email', { method: 'POST' })
        .then(function (res) {
          var jobId = res.jobId;
          if (!jobId) {
            hideDocActionProgress();
            toast('E-posta gönderildi');
            if (doc) showDocumentActivity(doc);
            return;
          }
          showDocActionProgress('E-posta gönderiliyor…', 10);
          startJobsPoll(jobId);
          return pollJobUntilDone(jobId, function (j) {
            showDocActionProgress('E-posta — ' + jobStatusLabel(j.status) + ' (' + (j.progress || 0) + '%)', j.progress || 10);
          });
        })
        .then(function () {
          hideDocActionProgress();
          toast('E-posta gönderildi');
          if (doc) showDocumentActivity(doc);
        })
        .catch(function () {
          hideDocActionProgress();
          toast('E-posta gönderilemedi', true);
        });
    } else if (action === 'pin') {
      var newPinned = !doc.pinned;
      fetchJson(VAULT + '/documents/' + encodeURIComponent(docId) + '/pin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: newPinned })
      }).then(function () {
        toast(newPinned ? 'Belge sabitlendi — arşive taşınmayacak' : 'Sabitleme kaldırıldı');
        loadDocuments();
      }).catch(function () { toast('Sabitleme başarısız', true); });
    } else if (action === 'edit') {
      location.hash = '#/araclar';
      toast('Bir araç seçin ve belgeyi yükleyerek düzenleyin.');
    } else if (action === 'archive') {
      fetchJson(VAULT + '/documents/' + encodeURIComponent(docId) + '/archive', { method: 'POST' })
        .then(function () { toast('Belge arşivlendi'); closeDocumentActivity(); loadDocuments(); })
        .catch(function () { toast('Arşivleme başarısız', true); });
    } else if (action === 'restore') {
      fetchJson(VAULT + '/documents/' + encodeURIComponent(docId) + '/restore', { method: 'POST' })
        .then(function () { toast('Belge belgelere geri alındı'); closeDocumentActivity(); loadDocuments(); })
        .catch(function () { toast('Geri alma başarısız', true); });
    } else if (action === 'share') {
      toast('Paylaşım özelliği yakında. Şimdilik e-posta ile gönderebilirsiniz.');
    } else if (action === 'history') {
      if (doc) showDocumentActivity(doc);
    } else if (action === 'delete') {
      if (!confirm('Bu belge silinsin mi?')) return;
      fetch(VAULT + '/documents/' + encodeURIComponent(docId), { method: 'DELETE', credentials: 'same-origin' })
        .then(function () {
          toast('Silindi');
          if (state.activeActivityDocId === docId) closeDocumentActivity();
          loadDocuments();
        });
    }
  }

  function uploadFile(file) {
    if (!file) return;
    var fd = new FormData();
    fd.append('file', file);
    fd.append('scope', state.fileScope);
    if (state.folderId) fd.append('folder_id', state.folderId);
    fetch(VAULT + '/documents', { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            var err = new Error(formatHttpError(t, r.status));
            err.status = r.status;
            throw err;
          });
        }
        return r.json();
      })
      .then(function () { toast('Belge yüklendi'); loadDocuments(); })
      .catch(function (e) {
        var msg = formatFetchError(e);
        if (e && e.status === 500 && /latin-1|UnicodeEncodeError/i.test(msg)) {
          msg = 'Belge kaydedilmiş olabilir; önizleme Türkçe dosya adında hata veriyor. Platform güncellemesi gerekli.';
        }
        toast(msg || 'Yükleme başarısız', true);
      });
  }

  function createFolder() {
    var name = prompt('Klasör adı:');
    if (!name || !name.trim()) return;
    var fd = new FormData();
    fd.append('name', name.trim());
    fd.append('scope', state.fileScope);
    if (state.folderId) fd.append('parent_id', state.folderId);
    fetch(VAULT + '/folders', { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function () { toast('Klasör oluşturuldu'); loadFolders(); })
      .catch(function () { toast('Klasör oluşturulamadı', true); });
  }

  var ROTATION_HINTS = {
    '90': 'Saat yönü',
    '180': 'Baş aşağı',
    '270': 'Saat yönünün tersi'
  };

  var COMPRESS_LEVEL_HINTS = {
    '1': 'Minimum sıkıştırma — kalite büyük ölçüde korunur',
    '2': 'Hafif sıkıştırma — kalite neredeyse aynı kalır',
    '3': 'Hafif sıkıştırma — kalite büyük ölçüde korunur',
    '4': 'Orta sıkıştırma — kalitede hafif düşüş',
    '5': 'Orta sıkıştırma — kalitede ılımlı düşüş',
    '6': 'Güçlü sıkıştırma — görsel kalite belirgin şekilde azalır',
    '7': 'Yoğun sıkıştırma — görsel kalite belirgin şekilde azalır',
    '8': 'Maksimum sıkıştırma — görsel kalite ciddi şekilde düşer',
    '9': 'En yüksek sıkıştırma — maksimum boyut azaltma'
  };

  function appendToolSection(form, title) {
    var section = document.createElement('div');
    section.className = 'tool-section';
    if (title) {
      var head = document.createElement('div');
      head.className = 'tool-section-head';
      head.innerHTML = '<span class="tool-section-title">' + escapeHtml(title) + '</span>';
      section.appendChild(head);
    }
    var body = document.createElement('div');
    body.className = 'tool-section-body';
    section.appendChild(body);
    form.appendChild(section);
    return body;
  }

  function isPdfUpload(file) {
    if (!file) return false;
    var name = (file.name || '').toLowerCase();
    var type = (file.type || '').toLowerCase();
    return name.endsWith('.pdf') || type === 'application/pdf';
  }

  function countPdfPagesInBytes(bytes) {
    if (!bytes || !bytes.length) return null;
    var maxScan = Math.min(bytes.length, 25 * 1024 * 1024);
    var chunks = [];
    var chunkSize = 512 * 1024;
    for (var off = 0; off < maxScan; off += chunkSize) {
      var end = Math.min(maxScan, off + chunkSize);
      chunks.push(String.fromCharCode.apply(null, bytes.subarray(off, end)));
    }
    var text = chunks.join('');
    var pageMatches = text.match(/\/Type[\s\r\n\/]*\/Page(?![a-zA-Z])/g);
    if (pageMatches && pageMatches.length) return pageMatches.length;
    var countMatches = text.match(/\/Count[\s\r\n]+(\d+)/g);
    if (countMatches && countMatches.length) {
      var maxCount = 0;
      countMatches.forEach(function (part) {
        var m = /(\d+)/.exec(part);
        if (m) maxCount = Math.max(maxCount, parseInt(m[1], 10));
      });
      if (maxCount > 0) return maxCount;
    }
    return null;
  }

  function readPdfPageCountLocal(file) {
    return new Promise(function (resolve) {
      if (!isPdfUpload(file)) {
        resolve(null);
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        try {
          resolve(countPdfPagesInBytes(new Uint8Array(reader.result)));
        } catch (e) {
          resolve(null);
        }
      };
      reader.onerror = function () { resolve(null); };
      reader.readAsArrayBuffer(file);
    });
  }

  function fetchPdfPageCountRemote(file) {
    var fd = new FormData();
    fd.append('fileInput', file);
    return fetch(APP + '/redaction/metadata', { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var n = Number(data && data.pageCount);
        return Number.isFinite(n) && n > 0 ? n : null;
      })
      .catch(function () { return null; });
  }

  function resolvePdfPageCount(file) {
    return readPdfPageCountLocal(file).then(function (localCount) {
      if (localCount) return localCount;
      return fetchPdfPageCountRemote(file);
    });
  }

  function formatPageCount(count) {
    if (!count) return '';
    return count === 1 ? '1 sayfa' : count + ' sayfa';
  }

  function setFormPdfMeta(form, meta) {
    form._pdfFileMeta = meta || null;
    if (typeof form._refreshPdfPageMeta === 'function') {
      form._refreshPdfPageMeta();
    }
  }

  function updateFileMetaPanel(panel, meta) {
    if (!panel) return;
    var nameEl = panel.querySelector('.file-meta-name');
    var pagesEl = panel.querySelector('.file-meta-pages');
    if (!meta || !meta.fileName) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    if (nameEl) nameEl.textContent = meta.fileName;
    if (pagesEl) {
      if (meta.loading) {
        pagesEl.textContent = 'Sayfa sayısı okunuyor…';
        pagesEl.className = 'file-meta-pages loading';
      } else if (meta.pageCount) {
        pagesEl.textContent = formatPageCount(meta.pageCount);
        pagesEl.className = 'file-meta-pages';
      } else {
        pagesEl.textContent = 'Sayfa sayısı alınamadı';
        pagesEl.className = 'file-meta-pages err';
      }
    }
  }

  function appendFileInput(form, input) {
    var body = input.sectionTitle ? appendToolSection(form, input.sectionTitle) : form;
    var field = document.createElement('div');
    field.className = 'file-upload-field';
    var file = document.createElement('input');
    file.type = 'file';
    file.name = input.name;
    file.id = 'toolFile_' + input.name;
    if (input.accept) file.accept = input.accept;
    if (input.multiple) file.multiple = true;
    if (input.required) file.required = true;
    var browse = document.createElement('label');
    browse.className = 'btn btn-secondary file-browse-btn';
    browse.setAttribute('for', file.id);
    browse.textContent = input.label || 'Dosya seç';
    field.appendChild(browse);
    field.appendChild(file);
    body.appendChild(field);
    if (input.showSelection) {
      var metaPanel = document.createElement('div');
      metaPanel.className = 'file-selection-meta';
      metaPanel.hidden = true;
      metaPanel.innerHTML =
        '<p class="file-selected-hint">✓ <span class="file-meta-name"></span></p>' +
        '<p class="file-meta-pages loading">Sayfa sayısı okunuyor…</p>';
      body.appendChild(metaPanel);

      var loadToken = 0;
      function applyFileSelection(files) {
        if (!files || !files.length) {
          loadToken += 1;
          metaPanel.hidden = true;
          setFormPdfMeta(form, null);
          return;
        }
        var selected = Array.prototype.slice.call(files);
        var token = ++loadToken;
        if (selected.length === 1) {
          var one = selected[0];
          var meta = { fileName: one.name, pageCount: null, loading: isPdfUpload(one) };
          updateFileMetaPanel(metaPanel, meta);
          setFormPdfMeta(form, meta);
          if (!isPdfUpload(one)) return;
          resolvePdfPageCount(one).then(function (count) {
            if (token !== loadToken) return;
            var done = { fileName: one.name, pageCount: count, loading: false };
            updateFileMetaPanel(metaPanel, done);
            setFormPdfMeta(form, done);
          });
          return;
        }
        var pdfs = selected.filter(isPdfUpload);
        var multiMeta = {
          fileName: selected.length + ' dosya seçildi',
          pageCount: null,
          loading: pdfs.length === selected.length
        };
        updateFileMetaPanel(metaPanel, multiMeta);
        setFormPdfMeta(form, multiMeta);
        if (pdfs.length !== selected.length) return;
        Promise.all(pdfs.map(resolvePdfPageCount)).then(function (counts) {
          if (token !== loadToken) return;
          var total = counts.reduce(function (sum, c) { return sum + (c || 0); }, 0);
          var done = {
            fileName: selected.length + ' dosya seçildi',
            pageCount: total || null,
            loading: false
          };
          updateFileMetaPanel(metaPanel, done);
          setFormPdfMeta(form, done);
        });
      }

      file.addEventListener('change', function () {
        applyFileSelection(file.files);
      });
    }
  }

  function appendCompressInput(form, input) {
    var body = appendToolSection(form, 'Ayarlar');
    var defaultLevel = String(input.defaultLevel || 5);

    var optimizeLevel = document.createElement('input');
    optimizeLevel.type = 'hidden';
    optimizeLevel.name = 'optimizeLevel';
    optimizeLevel.value = defaultLevel;

    var expectedSize = document.createElement('input');
    expectedSize.type = 'hidden';
    expectedSize.name = 'expectedOutputSize';
    expectedSize.value = '';
    expectedSize.disabled = true;

    var grayscaleHidden = document.createElement('input');
    grayscaleHidden.type = 'hidden';
    grayscaleHidden.name = 'grayscale';
    grayscaleHidden.value = 'false';

    var linearizeHidden = document.createElement('input');
    linearizeHidden.type = 'hidden';
    linearizeHidden.name = 'linearize';
    linearizeHidden.value = 'false';

    var lineArtHidden = document.createElement('input');
    lineArtHidden.type = 'hidden';
    lineArtHidden.name = 'lineArt';
    lineArtHidden.value = 'false';

    var modeField = document.createElement('div');
    modeField.className = 'compress-field';
    modeField.innerHTML = '<span class="field-label">Sıkıştırma yöntemi</span>';
    var modeToggle = document.createElement('div');
    modeToggle.className = 'segment-toggle';
    modeToggle.setAttribute('role', 'group');
    modeToggle.setAttribute('aria-label', 'Sıkıştırma yöntemi');

    var qualityPanel = document.createElement('div');
    qualityPanel.className = 'compress-quality-panel';

    var levelField = document.createElement('div');
    levelField.className = 'compress-field compress-level-field';
    levelField.innerHTML = '<span class="field-label">Kalite ayarı</span>';

    var levelRow = document.createElement('div');
    levelRow.className = 'compress-level-row';

    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'compress-slider';
    slider.min = '1';
    slider.max = '9';
    slider.step = '1';
    slider.value = defaultLevel;
    slider.setAttribute('aria-label', 'Sıkıştırma seviyesi');

    var levelNum = document.createElement('input');
    levelNum.type = 'number';
    levelNum.className = 'compress-level-num';
    levelNum.min = '1';
    levelNum.max = '9';
    levelNum.step = '1';
    levelNum.value = defaultLevel;
    levelNum.setAttribute('aria-label', 'Sıkıştırma seviyesi sayısal');

    var levelHint = document.createElement('p');
    levelHint.className = 'compress-level-hint';
    levelHint.textContent = COMPRESS_LEVEL_HINTS[defaultLevel] || '';

    levelRow.appendChild(slider);
    levelRow.appendChild(levelNum);
    levelField.appendChild(levelRow);
    levelField.appendChild(levelHint);
    qualityPanel.appendChild(levelField);

    var sizePanel = document.createElement('div');
    sizePanel.className = 'compress-size-panel';
    sizePanel.hidden = true;
    sizePanel.innerHTML =
      '<div class="compress-field">' +
      '<span class="field-label">Hedef dosya boyutu</span>' +
      '<input type="text" class="compress-size-input" placeholder="örn. 25MB, 10.8MB, 25KB" autocomplete="off">' +
      '<p class="compress-size-hint">Kaliteyi otomatik ayarlayarak PDF\'i belirtilen boyuta yaklaştırır.</p>' +
      '</div>';
    var sizeInput = sizePanel.querySelector('.compress-size-input');

    var optionsField = document.createElement('div');
    optionsField.className = 'compress-options';

    function bindBoolCheckbox(labelText, hintText, hiddenInput) {
      var label = document.createElement('label');
      label.className = 'check-option compress-check';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', function () {
        hiddenInput.value = cb.checked ? 'true' : 'false';
      });
      label.appendChild(cb);
      var text = document.createElement('span');
      text.innerHTML = escapeHtml(labelText);
      label.appendChild(text);
      optionsField.appendChild(label);
      if (hintText) {
        var hint = document.createElement('p');
        hint.className = 'compress-option-hint';
        hint.textContent = hintText;
        optionsField.appendChild(hint);
      }
    }

    bindBoolCheckbox(
      'Sıkıştırma için gri ton uygula',
      null,
      grayscaleHidden
    );
    bindBoolCheckbox(
      'Hızlı web görüntüleme için PDF\'i linearize et',
      null,
      linearizeHidden
    );
    bindBoolCheckbox(
      'Görselleri çizgi sanatına dönüştür',
      'ImageMagick ile sayfaları yüksek kontrastlı siyah-beyaza indirger; maksimum boyut azaltma için uygundur.',
      lineArtHidden
    );

    function syncLevel(val) {
      var n = Math.max(1, Math.min(9, parseInt(val, 10) || 5));
      slider.value = String(n);
      levelNum.value = String(n);
      optimizeLevel.value = String(n);
      levelHint.textContent = COMPRESS_LEVEL_HINTS[String(n)] || '';
    }

    slider.addEventListener('input', function () { syncLevel(slider.value); });
    levelNum.addEventListener('input', function () { syncLevel(levelNum.value); });
    levelNum.addEventListener('change', function () { syncLevel(levelNum.value); });

    var currentMode = 'quality';
    function setMode(mode) {
      currentMode = mode;
      modeToggle.querySelectorAll('.segment-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
      });
      qualityPanel.hidden = mode !== 'quality';
      sizePanel.hidden = mode !== 'size';
      if (mode === 'quality') {
        optimizeLevel.disabled = false;
        optimizeLevel.name = 'optimizeLevel';
        expectedSize.disabled = true;
        expectedSize.name = '';
        expectedSize.value = '';
      } else {
        optimizeLevel.disabled = true;
        optimizeLevel.name = '';
        expectedSize.disabled = false;
        expectedSize.name = 'expectedOutputSize';
        expectedSize.value = (sizeInput.value || '').trim();
      }
    }

    [
      { id: 'quality', label: 'Kalite' },
      { id: 'size', label: 'Dosya boyutu' }
    ].forEach(function (m) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'segment-btn' + (m.id === 'quality' ? ' active' : '');
      btn.setAttribute('data-mode', m.id);
      btn.textContent = m.label;
      btn.addEventListener('click', function () { setMode(m.id); });
      modeToggle.appendChild(btn);
    });

    sizeInput.addEventListener('input', function () {
      if (currentMode === 'size') expectedSize.value = sizeInput.value.trim();
    });

    modeField.appendChild(modeToggle);
    body.appendChild(modeField);
    body.appendChild(qualityPanel);
    body.appendChild(sizePanel);
    body.appendChild(optionsField);
    form.appendChild(optimizeLevel);
    form.appendChild(expectedSize);
    form.appendChild(grayscaleHidden);
    form.appendChild(lineArtHidden);
    form.appendChild(linearizeHidden);
  }

  function setConvertParam(form, name, value) {
    var existing = form.querySelector('.convert-api-param[name="' + name + '"]');
    if (!existing) {
      existing = document.createElement('input');
      existing.type = 'hidden';
      existing.className = 'convert-api-param';
      existing.name = name;
      form.appendChild(existing);
    }
    existing.value = value == null ? '' : String(value);
  }

  function clearConvertParams(form) {
    form.querySelectorAll('.convert-api-param').forEach(function (el) { el.remove(); });
  }

  function appendConvertField(panel, label, innerHtml) {
    var field = document.createElement('div');
    field.className = 'convert-field';
    field.innerHTML = '<span class="field-label">' + escapeHtml(label) + '</span>' + innerHtml;
    panel.appendChild(field);
    return field;
  }

  function renderConvertOptionFields(form, fromExt, toExt, panel) {
    panel.innerHTML = '';
    clearConvertParams(form);
    var SC = window.SecuriConvert;
    if (!SC || !fromExt || !toExt) return;

    if (fromExt === 'pdf' && SC.isImageFormat(toExt)) {
      appendConvertField(panel, 'Görsel formatı', '<p class="compress-level-hint">Çıktı: ' + escapeHtml(toExt.toUpperCase()) + '</p>');
      appendConvertField(panel, 'Renk modu',
        '<select class="convert-opt" data-param="colorType">' +
        '<option value="color">Renkli</option><option value="grayscale">Gri ton</option><option value="blackwhite">Siyah-beyaz</option></select>');
      appendConvertField(panel, 'Çözünürlük (DPI)',
        '<input type="number" class="convert-opt compress-level-num" data-param="dpi" min="72" max="600" step="1" value="300">');
      appendConvertField(panel, 'Çıktı yapısı',
        '<select class="convert-opt" data-param="singleOrMultiple">' +
        '<option value="multiple">Her sayfa ayrı dosya (ZIP)</option><option value="single">Tek dosya</option></select>');
      setConvertParam(form, 'imageFormat', toExt);
      setConvertParam(form, 'colorType', 'color');
      setConvertParam(form, 'dpi', '300');
      setConvertParam(form, 'singleOrMultiple', 'multiple');
    } else if (fromExt === 'pdf' && (toExt === 'docx' || toExt === 'odt')) {
      setConvertParam(form, 'outputFormat', toExt);
      appendConvertField(panel, 'Word formatı', '<p class="compress-level-hint">' + escapeHtml(toExt.toUpperCase()) + '</p>');
    } else if (fromExt === 'pdf' && (toExt === 'pptx' || toExt === 'odp')) {
      setConvertParam(form, 'outputFormat', toExt);
      appendConvertField(panel, 'Sunum formatı', '<p class="compress-level-hint">' + escapeHtml(toExt.toUpperCase()) + '</p>');
    } else if (fromExt === 'pdf' && (toExt === 'txt' || toExt === 'rtf')) {
      setConvertParam(form, 'outputFormat', toExt);
      appendConvertField(panel, 'Metin formatı', '<p class="compress-level-hint">' + escapeHtml(toExt.toUpperCase()) + '</p>');
    } else if (SC.isImageFormat(fromExt) && toExt === 'pdf') {
      appendConvertField(panel, 'Sayfaya sığdırma',
        '<select class="convert-opt" data-param="fitOption">' +
        '<option value="maintainAspectRatio">En-boy oranını koru</option>' +
        '<option value="fitDocumentToPage">Belgeyi sayfaya sığdır</option>' +
        '<option value="fillPage">Sayfayı doldur</option></select>');
      appendConvertField(panel, 'Renk modu',
        '<select class="convert-opt" data-param="colorType">' +
        '<option value="color">Renkli</option><option value="grayscale">Gri ton</option><option value="blackwhite">Siyah-beyaz</option></select>');
      appendConvertField(panel, 'Otomatik döndür',
        '<label class="check-option compress-check"><input type="checkbox" class="convert-opt-bool" data-param="autoRotate" checked> EXIF yönelimine göre döndür</label>');
      appendConvertField(panel, 'Çoklu görsel',
        '<label class="check-option compress-check"><input type="checkbox" class="convert-opt-bool" data-param="combineImages" checked> Tüm görselleri tek PDF\'te birleştir</label>');
      setConvertParam(form, 'fitOption', 'maintainAspectRatio');
      setConvertParam(form, 'colorType', 'color');
      setConvertParam(form, 'autoRotate', 'true');
      setConvertParam(form, 'combineImages', 'true');
    } else if (fromExt === 'svg' && toExt === 'pdf') {
      appendConvertField(panel, 'Birleştirme',
        '<label class="check-option compress-check"><input type="checkbox" class="convert-opt-bool" data-param="combineIntoSinglePdf" checked> Tüm SVG\'leri tek PDF\'te birleştir</label>');
      setConvertParam(form, 'combineIntoSinglePdf', 'true');
    } else if ((fromExt === 'html' || fromExt === 'zip') && toExt === 'pdf') {
      appendConvertField(panel, 'Yakınlaştırma',
        '<input type="number" class="convert-opt compress-level-num" data-param="zoom" min="0.1" max="3" step="0.1" value="1">');
      setConvertParam(form, 'zoom', '1');
    } else if ((fromExt === 'eml' || fromExt === 'msg') && toExt === 'pdf') {
      appendConvertField(panel, 'Ekler',
        '<label class="check-option compress-check"><input type="checkbox" class="convert-opt-bool" data-param="includeAttachments" checked> E-posta eklerini dahil et</label>');
      appendConvertField(panel, 'Maks. ek boyutu (MB)',
        '<input type="number" class="convert-opt compress-level-num" data-param="maxAttachmentSizeMB" min="1" max="100" value="10">');
      appendConvertField(panel, 'HTML indir',
        '<label class="check-option compress-check"><input type="checkbox" class="convert-opt-bool" data-param="downloadHtml"> HTML olarak indir</label>');
      appendConvertField(panel, 'Alıcılar',
        '<label class="check-option compress-check"><input type="checkbox" class="convert-opt-bool" data-param="includeAllRecipients"> Tüm alıcıları göster</label>');
      setConvertParam(form, 'includeAttachments', 'true');
      setConvertParam(form, 'maxAttachmentSizeMB', '10');
      setConvertParam(form, 'downloadHtml', 'false');
      setConvertParam(form, 'includeAllRecipients', 'false');
    } else if (fromExt === 'pdf' && toExt === 'pdfa') {
      appendConvertField(panel, 'PDF/A seviyesi',
        '<select class="convert-opt" data-param="outputFormat">' +
        '<option value="pdfa-1b">PDF/A-1b</option><option value="pdfa-2b" selected>PDF/A-2b</option><option value="pdfa-3b">PDF/A-3b</option></select>');
      appendConvertField(panel, 'Doğrulama',
        '<label class="check-option compress-check"><input type="checkbox" class="convert-opt-bool" data-param="strict"> Katı PDF/A doğrulaması</label>');
      setConvertParam(form, 'outputFormat', 'pdfa-2b');
      setConvertParam(form, 'strict', 'false');
    } else if (fromExt === 'pdf' && toExt === 'pdfx') {
      setConvertParam(form, 'outputFormat', 'pdfx');
      appendConvertField(panel, 'PDF/X', '<p class="compress-level-hint">PDF/X arşiv formatına dönüştürülür.</p>');
    } else if (fromExt === 'pdf' && (toExt === 'csv' || toExt === 'xlsx')) {
      setConvertParam(form, 'pageNumbers', 'all');
      appendConvertField(panel, 'Sayfa kapsamı', '<p class="compress-level-hint">Tüm sayfalar işlenir.</p>');
    } else if (fromExt === 'cbr' && toExt === 'pdf') {
      appendConvertField(panel, 'e-Kitap optimizasyonu',
        '<label class="check-option compress-check"><input type="checkbox" class="convert-opt-bool" data-param="optimizeForEbook"> e-Kitap okuyucu için optimize et</label>');
      setConvertParam(form, 'optimizeForEbook', 'false');
    } else if (fromExt === 'pdf' && toExt === 'cbr') {
      appendConvertField(panel, 'Çözünürlük (DPI)',
        '<input type="number" class="convert-opt compress-level-num" data-param="dpi" min="72" max="600" value="150">');
      setConvertParam(form, 'dpi', '150');
    } else if (fromExt === 'cbz' && toExt === 'pdf') {
      appendConvertField(panel, 'e-Kitap optimizasyonu',
        '<label class="check-option compress-check"><input type="checkbox" class="convert-opt-bool" data-param="optimizeForEbook"> e-Kitap okuyucu için optimize et</label>');
      setConvertParam(form, 'optimizeForEbook', 'false');
    } else if (fromExt === 'pdf' && toExt === 'cbz') {
      appendConvertField(panel, 'Çözünürlük (DPI)',
        '<input type="number" class="convert-opt compress-level-num" data-param="dpi" min="72" max="600" value="150">');
      setConvertParam(form, 'dpi', '150');
    } else if (['epub', 'mobi', 'azw3', 'fb2'].indexOf(fromExt) >= 0 && toExt === 'pdf') {
      appendConvertField(panel, 'e-Kitap seçenekleri',
        '<label class="check-option compress-check"><input type="checkbox" class="convert-opt-bool" data-param="embedAllFonts"> Tüm fontları göm</label>' +
        '<label class="check-option compress-check"><input type="checkbox" class="convert-opt-bool" data-param="includeTableOfContents"> İçindekiler ekle</label>' +
        '<label class="check-option compress-check"><input type="checkbox" class="convert-opt-bool" data-param="includePageNumbers"> Sayfa numaraları</label>' +
        '<label class="check-option compress-check"><input type="checkbox" class="convert-opt-bool" data-param="optimizeForEbook"> e-Kitap optimizasyonu</label>');
      setConvertParam(form, 'embedAllFonts', 'false');
      setConvertParam(form, 'includeTableOfContents', 'false');
      setConvertParam(form, 'includePageNumbers', 'false');
      setConvertParam(form, 'optimizeForEbook', 'false');
    } else if (fromExt === 'pdf' && (toExt === 'epub' || toExt === 'azw3')) {
      appendConvertField(panel, 'Bölüm algılama',
        '<label class="check-option compress-check"><input type="checkbox" class="convert-opt-bool" data-param="detectChapters" checked> Bölümleri otomatik algıla</label>');
      appendConvertField(panel, 'Hedef cihaz',
        '<select class="convert-opt" data-param="targetDevice">' +
        '<option value="TABLET_PHONE_IMAGES">Tablet / telefon</option>' +
        '<option value="KINDLE">Kindle</option><option value="NOOK">Nook</option></select>');
      setConvertParam(form, 'detectChapters', 'true');
      setConvertParam(form, 'targetDevice', 'TABLET_PHONE_IMAGES');
      setConvertParam(form, 'outputFormat', toExt === 'azw3' ? 'AZW3' : 'EPUB');
    } else {
      appendConvertField(panel, 'Parametreler', '<p class="compress-level-hint">Bu dönüşüm için ek ayar gerekmez.</p>');
    }

    panel.querySelectorAll('.convert-opt').forEach(function (el) {
      el.addEventListener('change', function () {
        setConvertParam(form, el.getAttribute('data-param'), el.value);
      });
      el.addEventListener('input', function () {
        setConvertParam(form, el.getAttribute('data-param'), el.value);
      });
    });
    panel.querySelectorAll('.convert-opt-bool').forEach(function (el) {
      el.addEventListener('change', function () {
        setConvertParam(form, el.getAttribute('data-param'), el.checked ? 'true' : 'false');
      });
    });
  }

  function appendConvertInput(form, input) {
    var SC = window.SecuriConvert;
    if (!SC) return;
    var body = appendToolSection(form, 'Ayarlar');
    var fromExt = 'pdf';
    var toExt = 'docx';

    var formatRow = document.createElement('div');
    formatRow.className = 'convert-format-row';
    formatRow.innerHTML =
      SC.buildGroupedSelect('convertFromExt', SC.FROM_FORMAT_OPTIONS, fromExt, 'Kaynak format') +
      SC.buildGroupedSelect('convertToExt', SC.getAvailableToFormats(fromExt), toExt, 'Hedef format');
    body.appendChild(formatRow);

    var endpointHint = document.createElement('p');
    endpointHint.className = 'convert-endpoint-hint';
    endpointHint.id = 'convertEndpointHint';
    body.appendChild(endpointHint);

    var optionsPanel = document.createElement('div');
    optionsPanel.className = 'convert-options-panel';
    optionsPanel.id = 'convertOptionsPanel';
    body.appendChild(optionsPanel);

    var fromSelect = formatRow.querySelector('#convertFromExt');
    var toSelect = formatRow.querySelector('#convertToExt');

    function refreshToOptions() {
      var targets = SC.getAvailableToFormats(fromExt);
      toSelect.innerHTML = '';
      var groups = {};
      targets.forEach(function (opt) {
        if (!groups[opt.group]) groups[opt.group] = [];
        groups[opt.group].push(opt);
      });
      Object.keys(groups).forEach(function (group) {
        var og = document.createElement('optgroup');
        og.label = group;
        groups[group].forEach(function (opt) {
          var o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          if (opt.value === toExt) o.selected = true;
          og.appendChild(o);
        });
        toSelect.appendChild(og);
      });
      if (!targets.some(function (t) { return t.value === toExt; })) {
        toExt = targets.length ? targets[0].value : '';
        toSelect.value = toExt;
      }
    }

    function syncConvertState() {
      refreshToOptions();
      var apiPath = SC.getApiPath(fromExt, toExt);
      endpointHint.textContent = apiPath
        ? ('API: ' + apiPath.replace('/api/v1/convert/', '').replace('/', ' → '))
        : 'Bu format çifti desteklenmiyor.';
      endpointHint.className = 'convert-endpoint-hint' + (apiPath ? '' : ' err');
      renderConvertOptionFields(form, fromExt, toExt, optionsPanel);
      var fileInput = form.querySelector('input[type="file"][name="fileInput"]');
      if (fileInput) fileInput.accept = SC.acceptForFromFormat(fromExt);
    }

    fromSelect.addEventListener('change', function () {
      fromExt = fromSelect.value;
      syncConvertState();
    });
    toSelect.addEventListener('change', function () {
      toExt = toSelect.value;
      syncConvertState();
    });

    form._convertGetFormats = function () {
      return { fromExt: fromExt, toExt: toExt, apiPath: SC.getApiPath(fromExt, toExt) };
    };

    var fileInput = form.querySelector('input[type="file"][name="fileInput"]');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        if (!fileInput.files || !fileInput.files.length) return;
        var detected = SC.analyzeFiles(Array.prototype.slice.call(fileInput.files));
        fromExt = detected.fromExt;
        toExt = detected.toExt;
        fromSelect.value = fromExt;
        syncConvertState();
      });
    }

    syncConvertState();
  }

  var OCR_LANGUAGES = [
    { code: 'tur', label: 'Türkçe' },
    { code: 'eng', label: 'İngilizce' },
    { code: 'deu', label: 'Almanca' },
    { code: 'fra', label: 'Fransızca' },
    { code: 'por', label: 'Portekizce' },
    { code: 'chi_sim', label: 'Çince (Basit)' }
  ];

  function appendOcrInput(form) {
    var body = appendToolSection(form, 'Ayarlar');

    var langField = document.createElement('div');
    langField.className = 'convert-field ocr-lang-field';
    langField.innerHTML = '<span class="field-label">Diller</span><p class="compress-level-hint">Belgedeki dilleri işaretleyin (en az bir).</p>';
    var langGrid = document.createElement('div');
    langGrid.className = 'ocr-lang-grid';
    OCR_LANGUAGES.forEach(function (lang) {
      var label = document.createElement('label');
      label.className = 'check-option ocr-lang-option';
      var checked = lang.code === 'tur' || lang.code === 'eng';
      label.innerHTML = '<input type="checkbox" class="ocr-lang-cb" name="languages" value="' +
        escapeHtml(lang.code) + '"' + (checked ? ' checked' : '') + '> ' + escapeHtml(lang.label);
      langGrid.appendChild(label);
    });
    langField.appendChild(langGrid);
    body.appendChild(langField);

    var modeField = document.createElement('div');
    modeField.className = 'convert-field';
    modeField.innerHTML = '<span class="field-label">OCR modu</span>' +
      '<select class="convert-format-select" name="ocrType">' +
      '<option value="skip-text" selected>Otomatik — metinli sayfaları atla</option>' +
      '<option value="force-ocr">Zorla — tüm sayfaları yeniden OCR yap</option>' +
      '<option value="Normal">Katı — metin varsa hata ver</option></select>';
    body.appendChild(modeField);

    var renderField = document.createElement('div');
    renderField.className = 'convert-field';
    renderField.innerHTML = '<span class="field-label">Uyumluluk / render</span>' +
      '<select class="convert-format-select" name="ocrRenderType">' +
      '<option value="hocr" selected>Standart (hOCR)</option>' +
      '<option value="sandwich">Sandwich — eski yazılımlar için</option></select>' +
      '<p class="compress-level-hint">Sandwich modu dosyayı büyütür ancak uyumluluk artar.</p>';
    body.appendChild(renderField);

    var adv = document.createElement('div');
    adv.className = 'convert-options-panel ocr-advanced';
    adv.innerHTML = '<span class="field-label">Gelişmiş seçenekler</span>';
    [
      { name: 'deskew', label: 'Eğik taramayı düzelt (deskew)' },
      { name: 'clean', label: 'Girdi ön işleme (clean)' },
      { name: 'cleanFinal', label: 'Çıktı temizleme (cleanFinal)' },
      { name: 'sidecar', label: 'Metin dosyası oluştur (ZIP içinde .txt)' },
      { name: 'removeImagesAfter', label: 'OCR sonrası görselleri kaldır' }
    ].forEach(function (opt) {
      adv.innerHTML += '<label class="check-option compress-check"><input type="checkbox" class="ocr-bool" name="' +
        opt.name + '" value="true"> ' + escapeHtml(opt.label) + '</label>';
    });
    body.appendChild(adv);
  }

  var WM_STYLE_PRESETS = [
    {
      id: 'tiled',
      label: 'Tekrarlayan',
      hint: 'Sayfa boyutuna göre düzenli ızgara — döndürme ve aralık otomatik',
      fontSize: 30
    },
    {
      id: 'diagonal',
      label: 'Çapraz',
      hint: 'Sayfa diyagonaline hizalı tek filigran — boyut ve konum otomatik',
      fontSize: null
    },
    {
      id: 'dense',
      label: 'Her yerde',
      hint: 'Sık tekrar — sayfa alanına göre yoğun kaplama',
      fontSize: 16
    },
    {
      id: 'quad',
      label: 'Dörtlü çapraz',
      hint: 'Çapraz bant deseni — sayfa oranlarına göre otomatik',
      fontSize: 26
    }
  ];

  function appendWatermarkInput(form) {
    var body = appendToolSection(form, 'Ayarlar');

    var typeField = document.createElement('div');
    typeField.className = 'convert-field';
    typeField.innerHTML = '<span class="field-label">Filigran türü</span>';
    var typeToggle = document.createElement('div');
    typeToggle.className = 'segment-toggle';
    typeToggle.setAttribute('role', 'group');
    var wmType = document.createElement('input');
    wmType.type = 'hidden';
    wmType.name = 'watermarkType';
    wmType.value = 'text';
    var convertImgHidden = document.createElement('input');
    convertImgHidden.type = 'hidden';
    convertImgHidden.name = 'convertPDFToImage';
    convertImgHidden.value = 'false';
    var wmStyleHidden = document.createElement('input');
    wmStyleHidden.type = 'hidden';
    wmStyleHidden.name = 'watermarkStyle';
    wmStyleHidden.value = 'tiled';

    var textPanel = document.createElement('div');
    textPanel.className = 'watermark-text-panel';
    textPanel.innerHTML =
      '<div class="convert-field"><span class="field-label">Filigran metni <span class="field-optional">(isteğe bağlı)</span></span>' +
      '<input type="text" class="compress-size-input" data-wm-field="watermarkText" name="watermarkText" value="" maxlength="200" placeholder="Örn. GİZLİ — boş bırakılabilir">' +
      '</div>' +
      '<div class="convert-field wm-docno-field">' +
      '<label class="check-option compress-check"><input type="checkbox" id="wmIncludeDocNumber" name="includeDocumentNumber" value="true"> Sistemin atadığı belge numarasını filigrana ekle</label>' +
      '<p class="compress-level-hint">Belge numarası tek başına filigran olabilir; metin girerseniz numara metnin yanına eklenir.</p></div>' +
      '<div class="convert-field"><span class="field-label">Yazı boyutu (pt)</span>' +
      '<input type="number" class="compress-level-num wm-num-wide" data-wm-field="fontSize" name="fontSize" min="1" max="200" step="1" value="30">' +
      '<p class="compress-level-hint">Stil seçimi başlangıç boyutunu önerir; çapraz stilde boyut sayfaya göre otomatik ayarlanır.</p></div>' +
      '<div class="convert-field"><span class="field-label">Yazı tipi (alfabe)</span>' +
      '<select class="convert-format-select" data-wm-field="alphabet" name="alphabet">' +
      '<option value="roman" selected>Roman (Latin)</option><option value="arabic">Arapça</option>' +
      '<option value="japanese">Japonca</option><option value="korean">Korece</option>' +
      '<option value="chinese">Çince</option><option value="thai">Tayca</option></select>' +
      '<p class="compress-level-hint">Metninizin diline uygun alfabe seçin (ör. Arapça metin → Arapça).</p></div>' +
      '<div class="convert-field"><span class="field-label">Opaklık</span>' +
      '<div class="compress-level-row"><input type="range" class="compress-slider wm-opacity-slider" min="0" max="100" step="1" value="50">' +
      '<input type="number" class="compress-level-num" data-wm-field="opacity" name="opacity" min="0" max="1" step="0.05" value="0.5"></div></div>' +
      '<div class="convert-field"><span class="field-label">Metin rengi</span>' +
      '<input type="color" class="wm-color-input" data-wm-field="customColor" name="customColor" value="#d3d3d3"></div>';

    var imagePanel = document.createElement('div');
    imagePanel.className = 'watermark-image-panel';
    imagePanel.hidden = true;
    imagePanel.innerHTML =
      '<div class="convert-field file-upload-field">' +
      '<span class="field-label">Filigran görseli</span>' +
      '<label class="btn btn-secondary file-browse-btn" for="watermarkImageInput">Görsel seç</label>' +
      '<input type="file" id="watermarkImageInput" data-wm-field="watermarkImage" name="watermarkImage" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp">' +
      '</div>';

    var extraField = document.createElement('div');
    extraField.className = 'convert-field';
    extraField.innerHTML =
      '<label class="check-option compress-check"><input type="checkbox" id="wmConvertPdfToImage"> PDF\'i görsel katmanına dönüştür</label>' +
      '<p class="compress-level-hint">Arka plandaki metni gizlemek için filigran altına düz görsel uygular.</p>';

    var styleField = document.createElement('div');
    styleField.className = 'convert-field wm-style-field';
    styleField.innerHTML = '<span class="field-label">Uygulama stili</span>';
    var styleHint = document.createElement('p');
    styleHint.className = 'compress-level-hint wm-style-hint';
    styleHint.textContent = WM_STYLE_PRESETS[0].hint;
    var styleGrid = document.createElement('div');
    styleGrid.className = 'wm-style-grid';

    function applyWmPreset(presetId) {
      var preset = WM_STYLE_PRESETS.find(function (p) { return p.id === presetId; });
      if (!preset) return;
      wmStyleHidden.value = presetId;
      styleHint.textContent = preset.hint;
      styleGrid.querySelectorAll('.wm-style-card').forEach(function (card) {
        card.classList.toggle('active', card.getAttribute('data-preset') === presetId);
      });
      var fSz = textPanel.querySelector('[data-wm-field="fontSize"]');
      if (fSz && preset.fontSize != null) {
        fSz.value = String(preset.fontSize);
      }
    }

    WM_STYLE_PRESETS.forEach(function (preset) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'wm-style-card' + (preset.id === 'tiled' ? ' active' : '');
      card.setAttribute('data-preset', preset.id);
      card.innerHTML = '<span class="wm-style-card-title">' + escapeHtml(preset.label) + '</span>';
      card.addEventListener('click', function () { applyWmPreset(preset.id); });
      styleGrid.appendChild(card);
    });
    styleField.appendChild(styleGrid);
    styleField.appendChild(styleHint);

    function setWmFieldNames(container, enabled) {
      container.querySelectorAll('[data-wm-field]').forEach(function (el) {
        if (enabled) {
          el.name = el.getAttribute('data-wm-field');
          el.disabled = false;
        } else {
          el.removeAttribute('name');
          el.disabled = true;
        }
      });
    }

    function setWmMode(mode) {
      wmType.value = mode;
      typeToggle.querySelectorAll('.segment-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
      });
      textPanel.hidden = mode !== 'text';
      imagePanel.hidden = mode !== 'image';
      styleField.hidden = false;
      var docNoField = textPanel.querySelector('.wm-docno-field');
      if (docNoField) docNoField.hidden = mode !== 'text';
      setWmFieldNames(textPanel, mode === 'text');
      setWmFieldNames(imagePanel, mode === 'image');
    }

    [
      { id: 'text', label: 'Metin' },
      { id: 'image', label: 'Görsel' }
    ].forEach(function (m) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'segment-btn' + (m.id === 'text' ? ' active' : '');
      btn.setAttribute('data-mode', m.id);
      btn.textContent = m.label;
      btn.addEventListener('click', function () { setWmMode(m.id); });
      typeToggle.appendChild(btn);
    });
    typeField.appendChild(typeToggle);
    body.appendChild(typeField);
    body.appendChild(styleField);
    body.appendChild(textPanel);
    body.appendChild(imagePanel);
    body.appendChild(extraField);
    form.appendChild(wmType);
    form.appendChild(convertImgHidden);
    form.appendChild(wmStyleHidden);

    var opacitySlider = textPanel.querySelector('.wm-opacity-slider');
    var opacityNum = textPanel.querySelector('[name="opacity"]');
    if (opacitySlider && opacityNum) {
      opacitySlider.addEventListener('input', function () {
        opacityNum.value = String(Math.round(parseInt(opacitySlider.value, 10)) / 100);
      });
      opacityNum.addEventListener('input', function () {
        var v = Math.max(0, Math.min(1, parseFloat(opacityNum.value) || 0));
        opacitySlider.value = String(Math.round(v * 100));
      });
    }

    var convertCb = extraField.querySelector('#wmConvertPdfToImage');
    if (convertCb) {
      convertCb.addEventListener('change', function () {
        convertImgHidden.value = convertCb.checked ? 'true' : 'false';
      });
    }

    applyWmPreset('tiled');
    setWmMode('text');
    form._applyWmPreset = applyWmPreset;
  }

  function setPanelFieldNames(container, enabled) {
    container.querySelectorAll('[data-wm-field]').forEach(function (el) {
      if (enabled) {
        el.name = el.getAttribute('data-wm-field');
        el.disabled = false;
      } else {
        el.removeAttribute('name');
        el.disabled = true;
      }
    });
  }

  function bindOpacitySlider(panel) {
    var opacitySlider = panel.querySelector('.wm-opacity-slider');
    var opacityNum = panel.querySelector('[data-opacity-num]');
    if (!opacitySlider || !opacityNum) return;
    opacitySlider.addEventListener('input', function () {
      opacityNum.value = String(Math.round(parseInt(opacitySlider.value, 10)) / 100);
    });
    opacityNum.addEventListener('input', function () {
      var v = Math.max(0, Math.min(1, parseFloat(opacityNum.value) || 0));
      opacitySlider.value = String(Math.round(v * 100));
    });
  }

  function appendStampInput(form) {
    var body = appendToolSection(form, 'Ayarlar');

    body.innerHTML +=
      '<div class="convert-field"><span class="field-label">Sayfa aralığı</span>' +
      '<input type="text" class="compress-size-input" name="pageNumbers" value="all" placeholder="all, 1, 3-5, 1,3,7">' +
      '<p class="compress-level-hint">Damganın uygulanacağı sayfalar.</p></div>';

    var typeField = document.createElement('div');
    typeField.className = 'convert-field';
    typeField.innerHTML = '<span class="field-label">Damga türü</span>';
    var typeToggle = document.createElement('div');
    typeToggle.className = 'segment-toggle';
    var stampType = document.createElement('input');
    stampType.type = 'hidden';
    stampType.name = 'stampType';
    stampType.value = 'text';

    var textPanel = document.createElement('div');
    textPanel.className = 'watermark-text-panel';
    textPanel.innerHTML =
      '<div class="convert-field"><span class="field-label">Damga metni</span>' +
      '<input type="text" class="compress-size-input" data-wm-field="stampText" name="stampText" value="ONAYLI" maxlength="200" required></div>' +
      '<div class="convert-field"><span class="field-label">Alfabe</span>' +
      '<select class="convert-format-select" data-wm-field="alphabet" name="alphabet">' +
      '<option value="roman" selected>Roman</option><option value="arabic">Arapça</option>' +
      '<option value="japanese">Japonca</option><option value="korean">Korece</option>' +
      '<option value="chinese">Çince</option><option value="thai">Tayca</option></select></div>' +
      '<div class="convert-field"><span class="field-label">Yazı / görsel boyutu</span>' +
      '<input type="number" class="compress-level-num wm-num-wide" data-wm-field="fontSize" name="fontSize" min="1" max="200" step="1" value="40"></div>' +
      '<div class="convert-field"><span class="field-label">Döndürme (°)</span>' +
      '<input type="number" class="compress-level-num wm-num-wide" data-wm-field="rotation" name="rotation" min="0" max="360" step="1" value="0"></div>' +
      '<div class="convert-field"><span class="field-label">Opaklık</span>' +
      '<div class="compress-level-row"><input type="range" class="compress-slider wm-opacity-slider" min="0" max="100" step="1" value="50">' +
      '<input type="number" class="compress-level-num" data-wm-field="opacity" data-opacity-num name="opacity" min="0" max="1" step="0.05" value="0.5"></div></div>' +
      '<div class="convert-field"><span class="field-label">Kenar boşluğu</span>' +
      '<select class="convert-format-select" data-wm-field="customMargin" name="customMargin">' +
      '<option value="small">Küçük</option><option value="medium" selected>Orta</option>' +
      '<option value="large">Büyük</option><option value="x-large">Çok büyük</option></select></div>' +
      '<div class="convert-field"><span class="field-label">Metin rengi</span>' +
      '<input type="color" class="wm-color-input" data-wm-field="customColor" name="customColor" value="#d3d3d3"></div>';

    var imagePanel = document.createElement('div');
    imagePanel.className = 'watermark-image-panel';
    imagePanel.hidden = true;
    imagePanel.innerHTML =
      '<div class="convert-field file-upload-field">' +
      '<span class="field-label">Damga görseli</span>' +
      '<label class="btn btn-secondary file-browse-btn" for="stampImageInput">Görsel seç</label>' +
      '<input type="file" id="stampImageInput" data-wm-field="stampImage" name="stampImage" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp">' +
      '</div>';

    var posField = document.createElement('div');
    posField.className = 'convert-field stamp-position-field';
    posField.innerHTML = '<span class="field-label">Konum</span>';
    var posHidden = document.createElement('input');
    posHidden.type = 'hidden';
    posHidden.name = 'position';
    posHidden.value = '8';
    var posGrid = document.createElement('div');
    posGrid.className = 'stamp-position-grid';
    posGrid.setAttribute('role', 'group');
    posGrid.setAttribute('aria-label', 'Damga konumu');
    [
      { id: '7', label: 'Sol üst' }, { id: '8', label: 'Üst orta' }, { id: '9', label: 'Sağ üst' },
      { id: '4', label: 'Sol orta' }, { id: '5', label: 'Orta' }, { id: '6', label: 'Sağ orta' },
      { id: '1', label: 'Sol alt' }, { id: '2', label: 'Alt orta' }, { id: '3', label: 'Sağ alt' }
    ].forEach(function (pos) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stamp-pos-btn' + (pos.id === '8' ? ' active' : '');
      btn.setAttribute('data-pos', pos.id);
      btn.title = pos.label;
      btn.textContent = pos.id;
      btn.addEventListener('click', function () {
        posHidden.value = pos.id;
        posGrid.querySelectorAll('.stamp-pos-btn').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
      });
      posGrid.appendChild(btn);
    });
    posField.appendChild(posGrid);
    posField.appendChild(posHidden);

    var coordField = document.createElement('div');
    coordField.className = 'convert-field';
    coordField.innerHTML =
      '<span class="field-label">Koordinat geçersiz kılma (isteğe bağlı)</span>' +
      '<div class="wm-spacer-row">' +
      '<label>X <input type="number" class="compress-level-num" name="overrideX" value="-1" step="1"></label>' +
      '<label>Y <input type="number" class="compress-level-num" name="overrideY" value="-1" step="1"></label></div>' +
      '<p class="compress-level-hint">-1 bırakılırsa konum ızgarası kullanılır.</p>';

    function setStampMode(mode) {
      stampType.value = mode;
      typeToggle.querySelectorAll('.segment-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
      });
      textPanel.hidden = mode !== 'text';
      imagePanel.hidden = mode !== 'image';
      setPanelFieldNames(textPanel, mode === 'text');
      setPanelFieldNames(imagePanel, mode === 'image');
    }

    [{ id: 'text', label: 'Metin' }, { id: 'image', label: 'Görsel' }].forEach(function (m) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'segment-btn' + (m.id === 'text' ? ' active' : '');
      btn.setAttribute('data-mode', m.id);
      btn.textContent = m.label;
      btn.addEventListener('click', function () { setStampMode(m.id); });
      typeToggle.appendChild(btn);
    });
    typeField.appendChild(typeToggle);
    body.appendChild(typeField);
    body.appendChild(textPanel);
    body.appendChild(imagePanel);
    body.appendChild(posField);
    body.appendChild(coordField);
    form.appendChild(stampType);
    bindOpacitySlider(textPanel);
    setStampMode('text');
  }

  function appendAddPasswordInput(form) {
    var body = appendToolSection(form, 'Parola');
    body.innerHTML =
      '<div class="convert-field"><span class="field-label">Açma parolası</span>' +
      '<input type="password" class="compress-size-input" name="password" required autocomplete="new-password"></div>' +
      '<div class="convert-field"><span class="field-label">Sahip parolası (isteğe bağlı)</span>' +
      '<input type="password" class="compress-size-input" name="ownerPassword" autocomplete="new-password">' +
      '<p class="compress-level-hint">İzinleri değiştirmek için kullanılır; boş bırakılabilir.</p></div>' +
      '<div class="convert-field"><span class="field-label">Şifreleme anahtarı</span>' +
      '<select class="convert-format-select" name="keyLength">' +
      '<option value="256" selected>256 bit (AES, önerilen)</option>' +
      '<option value="128">128 bit</option><option value="40">40 bit (eski)</option></select></div>';

    var permSection = appendToolSection(form, 'İzin kısıtlamaları');
    var permHint = document.createElement('p');
    permHint.className = 'compress-level-hint';
    permHint.textContent = 'İşaretlenen işlemler engellenir.';
    permSection.appendChild(permHint);
    [
      { name: 'preventPrinting', label: 'Yazdırmayı engelle' },
      { name: 'preventPrintingFaithful', label: 'Yüksek kaliteli yazdırmayı engelle' },
      { name: 'preventModify', label: 'Düzenlemeyi engelle' },
      { name: 'preventModifyAnnotations', label: 'Not eklemeyi engelle' },
      { name: 'preventExtractContent', label: 'İçerik kopyalamayı engelle' },
      { name: 'preventExtractForAccessibility', label: 'Erişilebilirlik metnini engelle' },
      { name: 'preventFillInForm', label: 'Form doldurmayı engelle' },
      { name: 'preventAssembly', label: 'Sayfa birleştirmeyi engelle' }
    ].forEach(function (opt) {
      var label = document.createElement('label');
      label.className = 'check-option compress-check';
      label.innerHTML = '<input type="checkbox" name="' + opt.name + '" value="true"> ' + escapeHtml(opt.label);
      permSection.appendChild(label);
    });
  }

  function appendChangePermissionsInput(form) {
    var body = appendToolSection(form, 'Yetkilendirme');
    body.innerHTML =
      '<div class="convert-field"><span class="field-label">Sahip parolası</span>' +
      '<input type="password" class="compress-size-input" name="ownerPassword" required autocomplete="current-password">' +
      '<p class="compress-level-hint">Mevcut PDF sahip parolası; izinleri değiştirmek için gereklidir.</p></div>';

    var permSection = appendToolSection(form, 'İzin kısıtlamaları');
    var permHint = document.createElement('p');
    permHint.className = 'compress-level-hint';
    permHint.textContent = 'İşaretlenen işlemler engellenir.';
    permSection.appendChild(permHint);
    [
      { name: 'preventPrinting', label: 'Yazdırmayı engelle' },
      { name: 'preventPrintingFaithful', label: 'Yüksek kaliteli yazdırmayı engelle' },
      { name: 'preventModify', label: 'Düzenlemeyi engelle' },
      { name: 'preventModifyAnnotations', label: 'Not eklemeyi engelle' },
      { name: 'preventExtractContent', label: 'İçerik kopyalamayı engelle' },
      { name: 'preventExtractForAccessibility', label: 'Erişilebilirlik metnini engelle' },
      { name: 'preventFillInForm', label: 'Form doldurmayı engelle' },
      { name: 'preventAssembly', label: 'Sayfa birleştirmeyi engelle' }
    ].forEach(function (opt) {
      var label = document.createElement('label');
      label.className = 'check-option compress-check';
      label.innerHTML = '<input type="checkbox" name="' + opt.name + '" value="true"> ' + escapeHtml(opt.label);
      permSection.appendChild(label);
    });
  }

  function appendCertSignInput(form) {
    var body = appendToolSection(form, 'Sertifika');
    var typeField = document.createElement('div');
    typeField.className = 'convert-field';
    typeField.innerHTML =
      '<span class="field-label">Sertifika türü</span>' +
      '<select class="convert-format-select" name="certType" id="certTypeSelect">' +
      '<option value="PKCS12" selected>PKCS#12 (.p12 / .pfx)</option>' +
      '<option value="PEM">PEM (ayrı anahtar + sertifika)</option>' +
      '<option value="JKS">Java Keystore (.jks)</option></select>';
    body.appendChild(typeField);

    var pkcsPanel = document.createElement('div');
    pkcsPanel.className = 'cert-type-panel';
    pkcsPanel.setAttribute('data-cert-panel', 'PKCS12');
    pkcsPanel.innerHTML =
      '<div class="convert-field"><span class="field-label">PKCS#12 dosyası</span>' +
      '<input type="file" name="p12File" accept=".p12,.pfx,application/x-pkcs12"></div>';
    body.appendChild(pkcsPanel);

    var pemPanel = document.createElement('div');
    pemPanel.className = 'cert-type-panel';
    pemPanel.hidden = true;
    pemPanel.setAttribute('data-cert-panel', 'PEM');
    pemPanel.innerHTML =
      '<div class="convert-field"><span class="field-label">Özel anahtar (PEM)</span>' +
      '<input type="file" name="privateKeyFile" accept=".pem,.key,.der"></div>' +
      '<div class="convert-field"><span class="field-label">Sertifika (PEM)</span>' +
      '<input type="file" name="certFile" accept=".pem,.crt,.cer,.der"></div>';
    body.appendChild(pemPanel);

    var jksPanel = document.createElement('div');
    jksPanel.className = 'cert-type-panel';
    jksPanel.hidden = true;
    jksPanel.setAttribute('data-cert-panel', 'JKS');
    jksPanel.innerHTML =
      '<div class="convert-field"><span class="field-label">Keystore (.jks)</span>' +
      '<input type="file" name="jksFile" accept=".jks,.keystore"></div>';
    body.appendChild(jksPanel);

    var passField = document.createElement('div');
    passField.className = 'convert-field';
    passField.innerHTML =
      '<span class="field-label">Parola</span>' +
      '<input type="password" class="compress-size-input" name="password" autocomplete="current-password">' +
      '<p class="compress-level-hint">Sertifika/keystore parolası (varsa).</p>';
    body.appendChild(passField);

    var opts = appendToolSection(form, 'İmza görünümü');
    opts.innerHTML =
      '<label class="check-option compress-check"><input type="checkbox" name="showSignature" value="true" checked> İmzayı PDF üzerinde göster</label>' +
      '<label class="check-option compress-check"><input type="checkbox" name="showLogo" value="true"> Logo göster</label>' +
      '<div class="convert-field"><span class="field-label">Sayfa numarası</span>' +
      '<input type="number" class="compress-level-num" name="pageNumber" min="1" value="1"></div>' +
      '<div class="convert-field"><span class="field-label">Neden</span>' +
      '<input type="text" class="compress-size-input" name="reason" value="SecuriPDF ile imzalandı"></div>' +
      '<div class="convert-field"><span class="field-label">Konum</span>' +
      '<input type="text" class="compress-size-input" name="location" value=""></div>' +
      '<div class="convert-field"><span class="field-label">İmzalayan</span>' +
      '<input type="text" class="compress-size-input" name="name" value=""></div>';

    var certSelect = typeField.querySelector('#certTypeSelect');
    if (certSelect) {
      certSelect.addEventListener('change', function () {
        var val = certSelect.value;
        body.querySelectorAll('.cert-type-panel').forEach(function (panel) {
          panel.hidden = panel.getAttribute('data-cert-panel') !== val;
        });
      });
    }
  }

  function appendRotationInput(form, input) {
    var wrap = document.createElement('div');
    wrap.className = 'rotation-field';
    var title = document.createElement('span');
    title.textContent = input.label || input.name;
    wrap.appendChild(title);
    var picker = document.createElement('div');
    picker.className = 'rotation-picker';
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', input.label || 'Döndürme yönü');
    var hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = input.name;
    hidden.value = String(input.default || '90');
    (input.options || []).forEach(function (opt) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rotation-option' + (String(opt.value) === String(hidden.value) ? ' active' : '');
      btn.setAttribute('data-angle', opt.value);
      btn.innerHTML = '<span class="rotation-preview" aria-hidden="true"></span>' +
        '<span class="rotation-label">' + escapeHtml(opt.label || (opt.value + '°')) + '</span>' +
        '<span class="rotation-hint">' + escapeHtml(ROTATION_HINTS[String(opt.value)] || '') + '</span>';
      btn.addEventListener('click', function () {
        hidden.value = String(opt.value);
        picker.querySelectorAll('.rotation-option').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
      });
      picker.appendChild(btn);
    });
    wrap.appendChild(picker);
    wrap.appendChild(hidden);
    form.appendChild(wrap);
  }

  function appendSplitInput(form) {
    var SS = window.SecuriSplit;
    if (!SS) return;
    var body = appendToolSection(form, 'Bölme yöntemi');
    var modeId = 'byPages';

    var pageCountBar = document.createElement('div');
    pageCountBar.className = 'split-doc-pages-bar';
    pageCountBar.hidden = true;
    pageCountBar.innerHTML = '<span class="split-doc-pages-label">Belge:</span> <strong class="split-doc-pages-value"></strong>';
    body.appendChild(pageCountBar);

    var modeList = document.createElement('div');
    modeList.className = 'split-mode-list';
    modeList.setAttribute('role', 'listbox');
    modeList.setAttribute('aria-label', 'Bölme yöntemi');

    var paramsHost = document.createElement('div');
    paramsHost.className = 'split-params-host';

    var hint = document.createElement('p');
    hint.className = 'split-mode-hint compress-level-hint';

    function addField(parent, label, inputEl, extraHint) {
      var wrap = document.createElement('div');
      wrap.className = 'convert-field split-param-field';
      var lbl = document.createElement('span');
      lbl.className = 'field-label';
      lbl.textContent = label;
      wrap.appendChild(lbl);
      wrap.appendChild(inputEl);
      if (extraHint) {
        var h = document.createElement('p');
        h.className = 'compress-level-hint';
        h.textContent = extraHint;
        wrap.appendChild(h);
      }
      parent.appendChild(wrap);
    }

    function addTextInput(name, placeholder, def) {
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'split-text-input';
      input.name = name;
      if (placeholder) input.placeholder = placeholder;
      if (def) input.value = def;
      return input;
    }

    function addNumberInput(name, min, max, def) {
      var input = document.createElement('input');
      input.type = 'number';
      input.className = 'split-num-input';
      input.name = name;
      input.min = String(min);
      input.max = String(max);
      input.value = String(def);
      return input;
    }

    function addCheckbox(name, label, checked) {
      var wrap = document.createElement('label');
      wrap.className = 'check-option split-check-option';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.name = name;
      cb.value = 'true';
      if (checked) cb.checked = true;
      wrap.appendChild(cb);
      wrap.appendChild(document.createTextNode(' ' + label));
      return wrap;
    }

    function renderParams() {
      paramsHost.innerHTML = '';
      var mode = SS.getMode(modeId);
      hint.textContent = mode.hint || '';

      if (modeId === 'byPages') {
        var pagesHint = '';
        if (form._pdfFileMeta && form._pdfFileMeta.pageCount) {
          pagesHint = 'Belge toplam ' + formatPageCount(form._pdfFileMeta.pageCount) +
            '. Örn. 1,5 → sayfa 1-2, 3-5, 6+.';
        }
        addField(paramsHost, 'Ayrılacak sayfalar',
          addTextInput('pageNumbers', 'örn. 1,5,10'),
          pagesHint || 'Her numara o sayfadan sonra kesim yapar. Örn. 1,5 → sayfa 1-2, 3-5, 6+.');
      } else if (modeId === 'byChapters') {
        addField(paramsHost, 'Yer imi seviyesi',
          addNumberInput('bookmarkLevel', 0, 10, 0),
          '0 = en üst seviye, 1 = alt bölümler.');
        paramsHost.appendChild(addCheckbox('includeMetadata', 'Meta veriyi dahil et', false));
        paramsHost.appendChild(addCheckbox('allowDuplicates', 'Yinelenen yer imlerine izin ver', false));
      } else if (modeId === 'bySections') {
        addField(paramsHost, 'Yatay bölümler', addNumberInput('horizontalDivisions', 1, 50, 1));
        addField(paramsHost, 'Dikey bölümler', addNumberInput('verticalDivisions', 1, 50, 1));
        var splitSel = document.createElement('select');
        splitSel.className = 'convert-format-select';
        splitSel.name = 'splitMode';
        SS.SECTION_SPLIT_MODES.forEach(function (opt) {
          var o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          splitSel.appendChild(o);
        });
        addField(paramsHost, 'Sayfa kapsamı', splitSel);
        var customPages = addTextInput('pageNumbers', 'örn. 2,4-8');
        var customWrap = document.createElement('div');
        customWrap.className = 'split-custom-pages';
        customWrap.hidden = true;
        addField(customWrap, 'Sayfa seçimi', customPages);
        paramsHost.appendChild(customWrap);
        splitSel.addEventListener('change', function () {
          customWrap.hidden = splitSel.value !== 'CUSTOM';
        });
        paramsHost.appendChild(addCheckbox('merge', 'Tek PDF\'de birleştir', false));
      } else if (modeId === 'byFileSize') {
        var stHidden = document.createElement('input');
        stHidden.type = 'hidden';
        stHidden.name = 'splitType';
        stHidden.value = '0';
        paramsHost.appendChild(stHidden);
        addField(paramsHost, 'Maksimum dosya boyutu',
          addTextInput('splitValue', 'örn. 5MB, 2MB', '5MB'));
      } else if (modeId === 'byPageCount') {
        var stHidden2 = document.createElement('input');
        stHidden2.type = 'hidden';
        stHidden2.name = 'splitType';
        stHidden2.value = '1';
        paramsHost.appendChild(stHidden2);
        addField(paramsHost, 'Sayfa sayısı (dosya başına)',
          addNumberInput('splitValue', 1, 9999, 10));
      } else if (modeId === 'byDocCount') {
        var stHidden3 = document.createElement('input');
        stHidden3.type = 'hidden';
        stHidden3.name = 'splitType';
        stHidden3.value = '2';
        paramsHost.appendChild(stHidden3);
        addField(paramsHost, 'Oluşturulacak belge sayısı',
          addNumberInput('splitValue', 2, 9999, 5));
      } else if (modeId === 'byPageDivider') {
        paramsHost.appendChild(addCheckbox('duplexMode', 'Çift taraflı tarama (ayırıcıdan sonraki sayfayı da kaldır)', false));
      } else if (modeId === 'byPoster') {
        var psSel = document.createElement('select');
        psSel.className = 'convert-format-select';
        psSel.name = 'pageSize';
        SS.POSTER_PAGE_SIZES.forEach(function (sz) {
          var o = document.createElement('option');
          o.value = sz;
          o.textContent = sz;
          if (sz === 'A4') o.selected = true;
          psSel.appendChild(o);
        });
        addField(paramsHost, 'Hedef sayfa boyutu', psSel);
        addField(paramsHost, 'Yatay bölüm (xfactor)', addNumberInput('xfactor', 1, 10, 2));
        addField(paramsHost, 'Dikey bölüm (yfactor)', addNumberInput('yfactor', 1, 10, 2));
        paramsHost.appendChild(addCheckbox('rightToLeft', 'Sağdan sola böl', false));
      }
    }

    SS.SPLIT_MODES.forEach(function (mode) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'split-mode-btn' + (mode.id === modeId ? ' active' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', mode.id === modeId ? 'true' : 'false');
      btn.innerHTML = 'Böl <strong>' + escapeHtml(mode.shortLabel) + '</strong>';
      btn.addEventListener('click', function () {
        modeId = mode.id;
        modeList.querySelectorAll('.split-mode-btn').forEach(function (b) {
          var active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        renderParams();
      });
      modeList.appendChild(btn);
    });

    body.appendChild(modeList);
    body.appendChild(paramsHost);
    body.appendChild(hint);

    var zipNote = document.createElement('p');
    zipNote.className = 'split-zip-note compress-level-hint';
    zipNote.textContent = 'Çoğu bölme modu ZIP arşivi üretir. İşlem sonrası ZIP indirilir; içinden ayrı PDF dosyalarını çıkarın.';
    body.appendChild(zipNote);

    form._splitGetConfig = function () {
      return { modeId: modeId, apiPath: SS.getApiPath(modeId) };
    };

    function refreshSplitPageBar() {
      var meta = form._pdfFileMeta;
      if (!meta || !meta.pageCount || meta.loading) {
        pageCountBar.hidden = true;
      } else {
        pageCountBar.hidden = false;
        var val = pageCountBar.querySelector('.split-doc-pages-value');
        if (val) val.textContent = formatPageCount(meta.pageCount);
      }
      if (modeId === 'byPages') renderParams();
    }
    form._refreshPdfPageMeta = refreshSplitPageBar;
    refreshSplitPageBar();

    renderParams();
  }

  function appendCompareInput(form) {
    var body = appendToolSection(form, 'Vurgu renkleri');
    var colors = document.createElement('div');
    colors.className = 'compare-colors';
    colors.innerHTML =
      '<label class="compare-color-field"><span class="field-label">Belge 1 vurgusu</span>' +
      '<input type="color" name="highlightColor1" value="#ffcccc" aria-label="Belge 1 vurgu rengi"></label>' +
      '<label class="compare-color-field"><span class="field-label">Belge 2 vurgusu</span>' +
      '<input type="color" name="highlightColor2" value="#ccffcc" aria-label="Belge 2 vurgu rengi"></label>';
    body.appendChild(colors);
    var hint = document.createElement('p');
    hint.className = 'compress-level-hint';
    hint.textContent = 'Taranmış PDF\'lerde önce OCR uygulayın. Çıktı HTML rapor olarak indirilir.';
    body.appendChild(hint);
  }

  var REDACT_PATTERN_ICONS = {
    tckn: '🪪', vkn: '🏢', mobile_tr: '📱', phone_tr: '☎️', email: '✉️',
    passport: '🛂', iban_tr: '🏦', credit_card: '💳', postal_code_tr: '📮', address_tr: '📍'
  };
  var REDACT_CATEGORY_ICONS = {
    Kimlik: '🪪', İletişim: '📞', Finans: '💳', Adres: '📍', Diğer: '◇'
  };
  var REDACT_PATTERN_BUNDLES = [
    { label: '★ Önerilen', ids: ['tckn', 'mobile_tr', 'email', 'vkn', 'address_tr'] },
    { label: 'Kimlik', ids: ['tckn', 'vkn', 'passport'] },
    { label: 'İletişim', ids: ['mobile_tr', 'phone_tr', 'email'] },
    { label: 'Finans', ids: ['iban_tr', 'credit_card'] }
  ];

  function appendRedactInput(form) {
    var body = appendToolSection(form, '');

    var idsHidden = document.createElement('input');
    idsHidden.type = 'hidden';
    idsHidden.name = 'redactPatternIds';
    idsHidden.value = '[]';
    body.appendChild(idsHidden);

    var customHidden = document.createElement('input');
    customHidden.type = 'hidden';
    customHidden.name = 'customRedactRegex';
    customHidden.value = '';
    body.appendChild(customHidden);

    var selectionHidden = document.createElement('input');
    selectionHidden.type = 'hidden';
    selectionHidden.name = 'redactSelection';
    selectionHidden.value = '{"areas":[]}';
    body.appendChild(selectionHidden);

    var mount = document.createElement('div');
    mount.className = 'redact-pattern-mount';
    body.appendChild(mount);

    buildRedactWorkspaceVanilla(form, mount, idsHidden, customHidden, selectionHidden);
  }

  function buildRedactWorkspaceVanilla(form, mount, idsHidden, customHidden, selectionHidden) {
    var state = {
      patternIds: [],
      customRegex: '',
      scanResult: null,
      pageMeta: null,
      currentPage: 1,
      blobUrl: '',
      hasFile: false,
      categoryFilter: '',
      matchSelected: {},
      manualAreas: [],
      drawMode: false,
      drawStart: null
    };
    var manualIdSeq = 0;

    function syncHidden() {
      idsHidden.value = JSON.stringify(state.patternIds);
      customHidden.value = state.customRegex;
    }

    function patternIcon(id) {
      return REDACT_PATTERN_ICONS[id] || '◇';
    }

    function categoryIcon(cat) {
      return REDACT_CATEGORY_ICONS[cat] || '◇';
    }

    function presetById(id) {
      for (var i = 0; i < allPresets.length; i++) {
        if (allPresets[i].id === id) return allPresets[i];
      }
      return null;
    }

    function getPageInfo(pageNum) {
      if (state.scanResult && state.scanResult.pages) {
        var sp = state.scanResult.pages.find(function (p) { return p.page === pageNum; });
        if (sp) return sp;
      }
      if (state.pageMeta && state.pageMeta.pages) {
        var mp = state.pageMeta.pages.find(function (p) { return p.page === pageNum; });
        if (mp) return mp;
      }
      return { page: pageNum, width: 595, height: 842, matches: [] };
    }

    function pageCount() {
      if (state.scanResult) return state.scanResult.pageCount || 1;
      if (state.pageMeta) return state.pageMeta.pageCount || 1;
      return 1;
    }

    function allMatches() {
      if (!state.scanResult || !state.scanResult.pages) return [];
      var out = [];
      state.scanResult.pages.forEach(function (p) {
        (p.matches || []).forEach(function (m) {
          out.push({ page: p.page, match: m });
        });
      });
      return out;
    }

    function selectedAreaCount() {
      var n = 0;
      allMatches().forEach(function (item) {
        if (state.matchSelected[item.match.id] !== false) n++;
      });
      return n + state.manualAreas.length;
    }

    function syncSelectionHidden() {
      var areas = [];
      allMatches().forEach(function (item) {
        if (state.matchSelected[item.match.id] === false) return;
        areas.push({ page: item.page, rect: item.match.rect, id: item.match.id, source: 'auto' });
      });
      state.manualAreas.forEach(function (a) {
        areas.push({ page: a.page, rect: a.rect, id: a.id, source: 'manual' });
      });
      selectionHidden.value = JSON.stringify({ areas: areas });
      return areas;
    }

    mount.innerHTML =
      '<div class="redact-studio" data-phase="empty">' +
        '<div class="rs-bar">' +
          '<div class="rs-bar-group">' +
            '<button type="button" class="rs-btn" data-act="toggle-pattern-panel">Desen seçimi</button>' +
            '<button type="button" class="rs-btn rs-btn-primary" data-act="scan" disabled>Belgede tara</button>' +
          '</div>' +
          '<div class="rs-bar-group rs-bar-nav">' +
            '<button type="button" class="rs-btn rs-btn-icon" data-act="prev-page" disabled>‹</button>' +
            '<span class="rw-page-label">Sayfa <strong class="rw-page-num">1</strong>/<span class="rw-page-total">1</span></span>' +
            '<button type="button" class="rs-btn rs-btn-icon" data-act="next-page" disabled>›</button>' +
            '<button type="button" class="rs-btn rw-draw-toggle" data-act="toggle-draw" disabled>Alan çiz</button>' +
          '</div>' +
          '<div class="rs-bar-group rs-bar-meta">' +
            '<details class="rs-settings">' +
              '<summary class="rs-btn rs-btn-icon" title="Ayarlar">⚙</summary>' +
              '<div class="rs-settings-panel">' +
                '<div class="rw-setting-row"><label>Renk</label><input type="color" name="redactColor" value="#000000"></div>' +
                '<div class="rw-setting-row"><label>Dolgu</label>' +
                  '<input type="number" class="rw-num" name="customPadding" min="0" max="20" step="0.5" value="1"></div>' +
                '<label class="rw-check"><input type="checkbox" name="convertPDFToImage" value="true" checked> Görüntüye göm</label>' +
              '</div>' +
            '</details>' +
            '<span class="rs-selected-pill" hidden>0 seçili</span>' +
            '<span class="rs-file-pill rw-hint">PDF bekleniyor</span>' +
          '</div>' +
        '</div>' +
        '<section class="rs-pattern-panel" hidden>' +
          '<button type="button" class="rs-pattern-toggle" data-act="toggle-pattern-panel">' +
            '<span class="rs-pattern-toggle-title">Hassas veri desenleri</span>' +
            '<span class="rw-pattern-badge">0</span>' +
            '<span class="rs-pattern-chips"></span>' +
            '<span class="rs-chevron" aria-hidden="true">▾</span>' +
          '</button>' +
          '<div class="rs-pattern-body" hidden>' +
            '<div class="rp-bundles-host"></div>' +
            '<div class="rp-toolbar">' +
              '<input type="search" class="rp-search" placeholder="Desen ara…" aria-label="Desen ara">' +
              '<button type="button" class="rs-btn rs-btn-ghost" data-act="select-all-patterns">Tümünü seç</button>' +
              '<button type="button" class="rs-btn rs-btn-ghost" data-act="clear">Temizle</button>' +
            '</div>' +
            '<div class="rp-picker">' +
              '<nav class="rp-cat-tabs" aria-label="Kategori"></nav>' +
              '<div class="rw-patterns-host"><p class="rw-hint rw-loading">Yükleniyor…</p></div>' +
            '</div>' +
            '<details class="rp-regex-details">' +
              '<summary>Özel regex (isteğe bağlı)</summary>' +
              '<textarea class="rp-custom-regex" rows="2" placeholder="Örn. GİZLİ|ÇOK GİZLİ"></textarea>' +
            '</details>' +
          '</div>' +
        '</section>' +
        '<p class="rs-status" aria-live="polite"></p>' +
        '<div class="rs-viewport">' +
          '<div class="rw-empty-state">' +
            '<p><strong>PDF önizlemesi</strong></p>' +
            '<p class="rw-hint">Yukarıdan dosya seçin.</p>' +
          '</div>' +
          '<div class="rw-preview-stage" hidden>' +
            '<iframe class="rw-pdf-iframe" title="PDF önizleme"></iframe>' +
            '<div class="rw-overlay-layer"></div>' +
            '<div class="rw-draw-ghost" hidden></div>' +
          '</div>' +
        '</div>' +
        '<div class="rs-matches-panel" hidden>' +
          '<header class="rs-matches-head">' +
            '<h4>Eşleşmeler <span class="rw-selected-count"></span></h4>' +
            '<div class="rs-matches-actions">' +
              '<button type="button" class="rs-btn rs-btn-ghost" data-act="select-all">Tümü</button>' +
              '<button type="button" class="rs-btn rs-btn-ghost" data-act="select-none">Hiçbiri</button>' +
              '<button type="button" class="rs-btn rs-btn-ghost" data-act="toggle-matches">Gizle</button>' +
            '</div>' +
          '</header>' +
          '<div class="rw-match-list-host"></div>' +
        '</div>' +
      '</div>';

    var studio = mount.querySelector('.redact-studio');
    var iframe = mount.querySelector('.rw-pdf-iframe');
    var previewStage = mount.querySelector('.rw-preview-stage');
    var viewport = mount.querySelector('.rs-viewport');
    var overlayLayer = mount.querySelector('.rw-overlay-layer');
    var drawGhost = mount.querySelector('.rw-draw-ghost');
    var emptyState = mount.querySelector('.rw-empty-state');
    var filePill = mount.querySelector('.rs-file-pill');
    var patternPanel = mount.querySelector('.rs-pattern-panel');
    var patternBody = mount.querySelector('.rs-pattern-body');
    var patternChipsEl = mount.querySelector('.rs-pattern-chips');
    var patternBadge = mount.querySelector('.rw-pattern-badge');
    var patternBundlesHost = mount.querySelector('.rp-bundles-host');
    var catTabs = mount.querySelector('.rp-cat-tabs');
    var patternHost = mount.querySelector('.rw-patterns-host');
    var matchesPanel = mount.querySelector('.rs-matches-panel');
    var selectedPill = mount.querySelector('.rs-selected-pill');
    var matchListHost = mount.querySelector('.rw-match-list-host');
    var selectedCountEl = mount.querySelector('.rw-selected-count');
    var scanStatus = mount.querySelector('.rs-status');
    var scanBtn = mount.querySelector('[data-act="scan"]');
    var drawToggle = mount.querySelector('.rw-draw-toggle');
    var pageNumEl = mount.querySelector('.rw-page-num');
    var pageTotalEl = mount.querySelector('.rw-page-total');
    var searchInput = mount.querySelector('.rp-search');
    var customTa = mount.querySelector('.rp-custom-regex');
    var allPresets = [];
    var allCategories = [];
    var matchesPanelCollapsed = false;
    var patternPanelOpen = false;

    function setScanStatus(msg, ok) {
      scanStatus.textContent = msg || '';
      scanStatus.className = 'rs-status' + (ok === true ? ' rw-scan-ok' : (ok === false ? ' rw-scan-err' : ''));
    }

    function setPatternPanelOpen(open) {
      patternPanelOpen = !!open;
      patternBody.hidden = !patternPanelOpen;
      studio.classList.toggle('pattern-open', patternPanelOpen);
      var chev = mount.querySelector('.rs-chevron');
      if (chev) chev.textContent = patternPanelOpen ? '▴' : '▾';
    }

    function togglePatternPanel() {
      setPatternPanelOpen(!patternPanelOpen);
    }

    function renderPatternBundles() {
      var html = '<span class="rp-bundles-label">Hazır paketler:</span>';
      REDACT_PATTERN_BUNDLES.forEach(function (b, i) {
        html += '<button type="button" class="rp-bundle-btn" data-act="apply-bundle" data-bundle="' +
          i + '">' + escapeHtml(b.label) + '</button>';
      });
      patternBundlesHost.innerHTML = html;
    }

    function renderPatternChips() {
      if (!state.patternIds.length && !(state.customRegex || '').trim()) {
        patternChipsEl.innerHTML = '<span class="rs-pattern-empty">Henüz desen seçilmedi</span>';
        return;
      }
      var html = '';
      state.patternIds.forEach(function (id) {
        var p = presetById(id);
        html += '<span class="rp-chip-mini">' + patternIcon(id) + ' ' + escapeHtml(p ? p.title : id) + '</span>';
      });
      if ((state.customRegex || '').trim()) {
        html += '<span class="rp-chip-mini">+ regex</span>';
      }
      patternChipsEl.innerHTML = html;
    }

    function applyPatternBundle(index) {
      var bundle = REDACT_PATTERN_BUNDLES[index];
      if (!bundle) return;
      state.patternIds = bundle.ids.slice();
      state.scanResult = null;
      state.matchSelected = {};
      renderPatterns(searchInput.value);
      renderMatchList();
      setScanStatus(bundle.label + ' paketi seçildi — Belgede tara.', true);
      syncHidden();
    }

    function togglePatternId(id) {
      var idx = state.patternIds.indexOf(id);
      if (idx >= 0) state.patternIds.splice(idx, 1);
      else state.patternIds.push(id);
      state.scanResult = null;
      state.matchSelected = {};
      renderPatterns(searchInput.value);
      renderMatchList();
      setScanStatus('', null);
      syncHidden();
    }

    function updateStudioPhase() {
      var phase = 'empty';
      if (state.hasFile) {
        phase = (state.scanResult || state.manualAreas.length) ? 'review' : 'ready';
      }
      studio.setAttribute('data-phase', phase);
      viewport.classList.toggle('has-file', state.hasFile);
      patternPanel.hidden = !state.hasFile;
      var showMatches = !!(state.scanResult || state.manualAreas.length);
      matchesPanel.hidden = !showMatches;
      studio.classList.toggle('has-matches', showMatches && !matchesPanelCollapsed);
      var sel = selectedAreaCount();
      selectedPill.hidden = !sel;
      selectedPill.textContent = sel + ' seçili';
      renderPatternChips();
      updatePatternBadge();
    }

    function updatePatternBadge() {
      var n = state.patternIds.length + ((state.customRegex || '').trim() ? 1 : 0);
      patternBadge.textContent = String(n);
      patternBadge.classList.toggle('has-items', n > 0);
    }

    function updatePageNav() {
      var total = pageCount();
      pageNumEl.textContent = String(state.currentPage);
      pageTotalEl.textContent = String(total);
      var prevBtn = mount.querySelector('[data-act="prev-page"]');
      var nextBtn = mount.querySelector('[data-act="next-page"]');
      if (prevBtn) prevBtn.disabled = state.currentPage <= 1;
      if (nextBtn) nextBtn.disabled = state.currentPage >= total;
    }

    function syncIframePage() {
      if (!state.blobUrl) return;
      var base = state.blobUrl.split('#')[0];
      iframe.src = base + '#page=' + state.currentPage + '&zoom=page-width';
    }

    function rectStyle(rect, pageW, pageH) {
      var l = (rect[0] / pageW) * 100;
      var t = (rect[1] / pageH) * 100;
      var w = ((rect[2] - rect[0]) / pageW) * 100;
      var h = ((rect[3] - rect[1]) / pageH) * 100;
      return 'left:' + l + '%;top:' + t + '%;width:' + w + '%;height:' + h + '%';
    }

    function renderOverlay() {
      if (!state.hasFile) {
        overlayLayer.innerHTML = '';
        return;
      }
      var pageInfo = getPageInfo(state.currentPage);
      var pw = pageInfo.width || 595;
      var ph = pageInfo.height || 842;
      var html = '';
      (pageInfo.matches || []).forEach(function (m) {
        var on = state.matchSelected[m.id] !== false;
        html += '<div class="rw-box rw-box-auto' + (on ? ' selected' : ' off') + '" data-mid="' +
          escapeHtml(m.id) + '" style="' + rectStyle(m.rect, pw, ph) + '" title="' +
          escapeHtml(m.text || '') + '"></div>';
      });
      state.manualAreas.forEach(function (a) {
        if (a.page !== state.currentPage) return;
        html += '<div class="rw-box rw-box-manual selected" data-aid="' + escapeHtml(a.id) + '" style="' +
          rectStyle(a.rect, pw, ph) + '">' +
          '<button type="button" class="rw-box-del" data-act="del-manual" data-aid="' + escapeHtml(a.id) + '">×</button></div>';
      });
      overlayLayer.innerHTML = html;
      overlayLayer.classList.toggle('draw-mode', state.drawMode);
      drawToggle.classList.toggle('active', state.drawMode);
      viewport.classList.toggle('draw-active', state.drawMode);
    }

    function renderMatchList() {
      var items = allMatches();
      var total = items.length;
      var selected = selectedAreaCount();
      selectedCountEl.textContent = '(' + selected + '/' + (total + state.manualAreas.length) + ')';

      if (!total && !state.manualAreas.length) {
        matchListHost.innerHTML = '';
        syncSelectionHidden();
        updateStudioPhase();
        renderOverlay();
        return;
      }

      var byPage = {};
      items.forEach(function (item) {
        if (!byPage[item.page]) byPage[item.page] = [];
        byPage[item.page].push(item);
      });
      state.manualAreas.forEach(function (a) {
        if (!byPage[a.page]) byPage[a.page] = [];
        byPage[a.page].push({ manual: a });
      });

      var pages = Object.keys(byPage).map(Number).sort(function (a, b) { return a - b; });
      var html = '';
      pages.forEach(function (pg) {
        var isCurrent = pg === state.currentPage;
        html += '<section class="rs-match-page' + (isCurrent ? ' current' : '') + '">' +
          '<button type="button" class="rs-match-page-head" data-act="goto-page" data-page="' + pg + '">' +
          'Sayfa ' + pg + (isCurrent ? ' · şu an' : '') + '</button>';
        byPage[pg].forEach(function (item) {
          if (item.manual) {
            var a = item.manual;
            html += '<div class="rw-match-row manual on">' +
              '<span class="rw-match-tag">Elle</span>' +
              '<code class="rw-match-text">Özel alan</code>' +
              '<button type="button" class="rw-row-del" data-act="del-manual" data-aid="' + escapeHtml(a.id) + '">×</button></div>';
            return;
          }
          var m = item.match;
          var on = state.matchSelected[m.id] !== false;
          html += '<label class="rw-match-row' + (on ? ' on' : ' off') + '">' +
            '<input type="checkbox" class="rw-match-check" data-mid="' + escapeHtml(m.id) + '"' +
            (on ? ' checked' : '') + '>' +
            '<span class="rw-match-tag">' + escapeHtml(m.patternTitle || '') + '</span>' +
            '<code class="rw-match-text">' + escapeHtml(m.text || '') + '</code></label>';
        });
        html += '</section>';
      });
      matchListHost.innerHTML = html;
      syncSelectionHidden();
      updateStudioPhase();
      renderOverlay();
    }

    function initMatchSelection() {
      state.matchSelected = {};
      allMatches().forEach(function (item) {
        state.matchSelected[item.match.id] = true;
      });
    }

    function renderCategoryFilters() {
      if (!allCategories.length) {
        catTabs.innerHTML = '';
        return;
      }
      var html = '<button type="button" class="rp-cat-tab' + (!state.categoryFilter ? ' active' : '') +
        '" data-cat="">Tümü</button>';
      allCategories.forEach(function (cat) {
        var active = state.categoryFilter === cat;
        html += '<button type="button" class="rp-cat-tab' + (active ? ' active' : '') + '" data-cat="' +
          escapeHtml(cat) + '"><span class="rp-cat-tab-icon">' + categoryIcon(cat) + '</span>' +
          escapeHtml(cat) + '</button>';
      });
      catTabs.innerHTML = html;
    }

    function renderPatterns(filter) {
      var q = (filter || '').trim().toLowerCase();
      var list = allPresets.filter(function (p) {
        var cat = p.categoryLabel || p.category || 'Diğer';
        if (state.categoryFilter && cat !== state.categoryFilter) return false;
        if (q && p.title.toLowerCase().indexOf(q) < 0 &&
            (p.description || '').toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      if (!list.length) {
        patternHost.innerHTML = '<p class="rw-hint">Eşleşen desen yok.</p>';
        renderPatternChips();
        updatePatternBadge();
        return;
      }
      var html = '<div class="rp-tile-grid">';
      list.forEach(function (p) {
        var active = state.patternIds.indexOf(p.id) >= 0;
        var tip = p.description || '';
        if (p.example) tip += (tip ? ' — ' : '') + 'örn. ' + p.example;
        html += '<button type="button" class="rp-tile' + (active ? ' active' : '') + '" data-pid="' +
          escapeHtml(p.id) + '" title="' + escapeHtml(tip) + '">' +
          '<span class="rp-tile-icon">' + patternIcon(p.id) + '</span>' +
          '<span class="rp-tile-title">' + escapeHtml(p.title) + '</span>' +
          '<span class="rp-tile-check" aria-hidden="true">✓</span></button>';
      });
      html += '</div>';
      patternHost.innerHTML = html;
      renderPatternChips();
      updatePatternBadge();
    }

    function loadPageMeta(file) {
      var fd = new FormData();
      fd.append('fileInput', file);
      return fetch(APP + '/redaction/metadata', { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          state.pageMeta = data;
          updatePageNav();
        })
        .catch(function () { /* önizleme yine çalışır */ });
    }

    function setPreviewFile(file) {
      if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
      state.scanResult = null;
      state.pageMeta = null;
      state.matchSelected = {};
      state.manualAreas = [];
      state.currentPage = 1;
      state.drawMode = false;
      setPatternPanelOpen(false);
      renderMatchList();
      setScanStatus('', null);
      if (!file) {
        state.blobUrl = '';
        state.hasFile = false;
        iframe.removeAttribute('src');
        previewStage.hidden = true;
        emptyState.hidden = false;
        filePill.textContent = 'PDF bekleniyor';
        filePill.className = 'rs-file-pill rw-hint';
        scanBtn.disabled = true;
        drawToggle.disabled = true;
        updateStudioPhase();
        return;
      }
      state.blobUrl = URL.createObjectURL(file);
      state.hasFile = true;
      previewStage.hidden = false;
      emptyState.hidden = true;
      syncIframePage();
      filePill.textContent = file.name;
      filePill.className = 'rs-file-pill';
      scanBtn.disabled = false;
      drawToggle.disabled = false;
      if (!state.patternIds.length && !(state.customRegex || '').trim()) {
        setScanStatus('Desen paketi seçin veya tek tek işaretleyin, ardından Belgede tara.', null);
        setPatternPanelOpen(true);
      } else {
        setScanStatus('', null);
      }
      loadPageMeta(file).then(function () {
        updatePageNav();
        renderOverlay();
      });
      updateStudioPhase();
    }

    function screenToPdfRect(x1, y1, x2, y2) {
      var stageRect = previewStage.getBoundingClientRect();
      var pageInfo = getPageInfo(state.currentPage);
      var pw = pageInfo.width || 595;
      var ph = pageInfo.height || 842;
      var left = Math.min(x1, x2) - stageRect.left;
      var top = Math.min(y1, y2) - stageRect.top;
      var w = Math.abs(x2 - x1);
      var h = Math.abs(y2 - y1);
      var sx = pw / stageRect.width;
      var sy = ph / stageRect.height;
      if (w < 6 || h < 6) return null;
      return [
        Math.max(0, left * sx),
        Math.max(0, top * sy),
        Math.min(pw, (left + w) * sx),
        Math.min(ph, (top + h) * sy)
      ];
    }

    function bindFileInput() {
      var fileInput = form.querySelector('[name="fileInput"]');
      if (!fileInput) return;
      fileInput.addEventListener('change', function () {
        setPreviewFile(fileInput.files && fileInput.files[0] ? fileInput.files[0] : null);
      });
      if (fileInput.files && fileInput.files[0]) {
        setPreviewFile(fileInput.files[0]);
      }
    }

    previewStage.addEventListener('mousedown', function (e) {
      if (!state.drawMode || e.button !== 0) return;
      e.preventDefault();
      state.drawStart = { x: e.clientX, y: e.clientY };
      drawGhost.hidden = false;
      drawGhost.style.left = e.clientX - previewStage.getBoundingClientRect().left + 'px';
      drawGhost.style.top = e.clientY - previewStage.getBoundingClientRect().top + 'px';
      drawGhost.style.width = '0';
      drawGhost.style.height = '0';
    });

    window.addEventListener('mousemove', function (e) {
      if (!state.drawStart) return;
      var sr = previewStage.getBoundingClientRect();
      var x = Math.max(0, Math.min(e.clientX - sr.left, sr.width));
      var y = Math.max(0, Math.min(e.clientY - sr.top, sr.height));
      var sx = Math.min(state.drawStart.x - sr.left, x);
      var sy = Math.min(state.drawStart.y - sr.top, y);
      var sw = Math.abs(x - (state.drawStart.x - sr.left));
      var sh = Math.abs(y - (state.drawStart.y - sr.top));
      drawGhost.style.left = sx + 'px';
      drawGhost.style.top = sy + 'px';
      drawGhost.style.width = sw + 'px';
      drawGhost.style.height = sh + 'px';
    });

    window.addEventListener('mouseup', function (e) {
      if (!state.drawStart) return;
      var rect = screenToPdfRect(state.drawStart.x, state.drawStart.y, e.clientX, e.clientY);
      state.drawStart = null;
      drawGhost.hidden = true;
      if (rect) {
        manualIdSeq += 1;
        state.manualAreas.push({
          id: 'manual-' + manualIdSeq,
          page: state.currentPage,
          rect: rect
        });
        renderMatchList();
        setScanStatus('Elle çizilen alan eklendi (' + selectedAreaCount() + ' alan seçili)', true);
      }
    });

    mount.addEventListener('change', function (e) {
      if (e.target.classList.contains('rp-custom-regex')) {
        state.customRegex = e.target.value || '';
        state.scanResult = null;
        state.matchSelected = {};
        renderMatchList();
        updatePatternBadge();
        renderPatternChips();
        syncHidden();
      }
      if (e.target.matches('.rw-match-check')) {
        var mid = e.target.getAttribute('data-mid');
        state.matchSelected[mid] = e.target.checked;
        renderMatchList();
        setScanStatus(selectedAreaCount() + ' alan karartılacak', true);
      }
    });

    mount.addEventListener('input', function (e) {
      if (e.target.classList.contains('rp-search')) renderPatterns(e.target.value);
    });

    mount.addEventListener('click', function (e) {
      var tile = e.target.closest('.rp-tile');
      if (tile) {
        togglePatternId(tile.getAttribute('data-pid'));
        return;
      }
      var catBtn = e.target.closest('.rp-cat-tab');
      if (catBtn) {
        state.categoryFilter = catBtn.getAttribute('data-cat') || '';
        renderCategoryFilters();
        renderPatterns(searchInput.value);
        return;
      }
      var autoBox = e.target.closest('.rw-box-auto');
      if (autoBox && !state.drawMode) {
        var boxId = autoBox.getAttribute('data-mid');
        var curOn = state.matchSelected[boxId] !== false;
        state.matchSelected[boxId] = !curOn;
        renderMatchList();
        return;
      }
      var delBtn = e.target.closest('[data-act="del-manual"]');
      if (delBtn) {
        var aid = delBtn.getAttribute('data-aid');
        state.manualAreas = state.manualAreas.filter(function (a) { return a.id !== aid; });
        renderMatchList();
        return;
      }
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'toggle-pattern-panel') {
        togglePatternPanel();
        return;
      }
      if (act === 'apply-bundle') {
        applyPatternBundle(parseInt(btn.getAttribute('data-bundle'), 10));
        return;
      }
      if (act === 'select-all-patterns') {
        state.patternIds = allPresets.map(function (p) { return p.id; });
        state.scanResult = null;
        state.matchSelected = {};
        renderPatterns(searchInput.value);
        renderMatchList();
        syncHidden();
        return;
      }
      if (act === 'goto-page') {
        var pg = parseInt(btn.getAttribute('data-page'), 10);
        if (!isNaN(pg)) {
          state.currentPage = pg;
          syncIframePage();
          updatePageNav();
          renderMatchList();
        }
        return;
      }
      if (act === 'toggle-matches') {
        matchesPanelCollapsed = !matchesPanelCollapsed;
        studio.classList.toggle('has-matches', !matchesPanelCollapsed &&
          !!(state.scanResult || state.manualAreas.length));
        var tgl = mount.querySelector('[data-act="toggle-matches"]');
        if (tgl) tgl.textContent = matchesPanelCollapsed ? 'Göster' : 'Gizle';
        return;
      }
      if (act === 'clear') {
        state.patternIds = [];
        customTa.value = '';
        state.customRegex = '';
        renderPatterns(searchInput.value);
        renderMatchList();
        syncHidden();
        return;
      }
      if (act === 'select-all') {
        allMatches().forEach(function (item) { state.matchSelected[item.match.id] = true; });
        renderMatchList();
        return;
      }
      if (act === 'select-none') {
        allMatches().forEach(function (item) { state.matchSelected[item.match.id] = false; });
        renderMatchList();
        return;
      }
      if (act === 'prev-page') {
        state.currentPage = Math.max(1, state.currentPage - 1);
        syncIframePage();
        updatePageNav();
        renderMatchList();
        return;
      }
      if (act === 'next-page') {
        state.currentPage = Math.min(pageCount(), state.currentPage + 1);
        syncIframePage();
        updatePageNav();
        renderMatchList();
        return;
      }
      if (act === 'toggle-draw') {
        if (!state.hasFile) return;
        state.drawMode = !state.drawMode;
        renderOverlay();
        return;
      }
      if (act === 'scan') {
        var fileInput = form.querySelector('[name="fileInput"]');
        var file = fileInput && fileInput.files && fileInput.files[0];
        if (!file) {
          setScanStatus('Önce PDF dosyası seçin.', false);
          return;
        }
        if (!state.patternIds.length && !(customTa.value || '').trim()) {
          setScanStatus('En az bir desen veya özel regex seçin.', false);
          setPatternPanelOpen(true);
          return;
        }
        scanBtn.disabled = true;
        scanBtn.textContent = 'Taranıyor…';
        setScanStatus('Belge taranıyor…', null);
        var fd = new FormData();
        fd.append('fileInput', file);
        fd.append('redactPatternIds', JSON.stringify(state.patternIds));
        fd.append('customRedactRegex', customTa.value || '');
        fetch(APP + '/redaction/scan', { method: 'POST', body: fd, credentials: 'same-origin' })
          .then(function (r) { return r.text().then(function (t) { return { ok: r.ok, t: t }; }); })
          .then(function (res) {
            var data;
            try { data = JSON.parse(res.t); } catch (err) { data = null; }
            if (!res.ok) {
              var msg = (data && data.detail) ? (typeof data.detail === 'string' ? data.detail : data.detail[0]) : res.t;
              throw new Error(msg || 'Tarama başarısız');
            }
            state.scanResult = data;
            state.currentPage = 1;
            matchesPanelCollapsed = false;
            initMatchSelection();
            setPatternPanelOpen(false);
            syncIframePage();
            updatePageNav();
            renderMatchList();
            if (data.totalMatches === 0) {
              setScanStatus('Eşleşme yok — desenleri değiştirin veya Alan çiz ile işaretleyin.', null);
            } else {
              setScanStatus(data.totalMatches + ' eşleşme — yanlış olanların işaretini kaldırın', true);
            }
          })
          .catch(function (err) {
            state.scanResult = null;
            renderMatchList();
            setScanStatus(err.message || 'Tarama hatası', false);
          })
          .finally(function () {
            scanBtn.disabled = !state.hasFile;
            scanBtn.textContent = 'Belgede tara';
          });
      }
    });

    bindFileInput();
    customTa.addEventListener('input', function () {
      state.customRegex = customTa.value || '';
      state.scanResult = null;
      state.matchSelected = {};
      renderMatchList();
      renderPatternChips();
      updatePatternBadge();
      syncHidden();
    });

    form._redactSyncSelection = syncSelectionHidden;
    form._redactCleanup = function () {
      if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
    };

    fetchJson(APP + '/redaction-patterns').then(function (data) {
      allPresets = data.presets || [];
      var catSet = {};
      allPresets.forEach(function (p) {
        var cat = p.categoryLabel || p.category || 'Diğer';
        catSet[cat] = true;
      });
      allCategories = Object.keys(catSet).sort();
      renderPatternBundles();
      renderCategoryFilters();
      renderPatterns('');
      updateStudioPhase();
    }).catch(function () {
      patternHost.innerHTML = '<p class="rw-scan-err">Desenler yüklenemedi. Sayfayı yenileyin.</p>';
    });
  }

  function appendPageSelectionInput(form, input) {
    var SP = window.SecuriPages;
    var mode = input.selectionMode || 'pick';
    var labels = SP ? SP.modeLabels(mode) : { action: 'seçili', keep: 'kalan', pickHint: '', selectedClass: 'is-pick' };
    var body = input.sectionTitle ? appendToolSection(form, input.sectionTitle) : form;
    var wrap = document.createElement('div');
    wrap.className = 'convert-field page-selection-field page-selection-mode-' + mode;

    var textEl = document.createElement('input');
    textEl.type = 'text';
    textEl.className = 'split-text-input page-selection-input';
    textEl.name = input.name;
    textEl.setAttribute('data-page-selection', 'true');
    textEl.autocomplete = 'off';
    if (input.placeholder) textEl.placeholder = input.placeholder;
    if (input.default != null) textEl.value = String(input.default);
    if (input.required) textEl.required = true;

    var summary = document.createElement('div');
    summary.className = 'page-selection-summary';
    summary.innerHTML = '<span class="page-sum-action">—</span><span class="page-sum-sep"> · </span><span class="page-sum-keep">—</span>';
    wrap.appendChild(summary);

    var legend = document.createElement('div');
    legend.className = 'page-selection-legend';
    legend.innerHTML =
      '<span class="page-legend-item"><span class="page-legend-swatch is-selected"></span> ' + escapeHtml(labels.action) + '</span>' +
      '<span class="page-legend-item"><span class="page-legend-swatch"></span> ' + escapeHtml(labels.keep) + '</span>';
    wrap.appendChild(legend);

    var waitHint = document.createElement('p');
    waitHint.className = 'compress-level-hint page-selection-wait';
    waitHint.textContent = 'Önce PDF seçin; sayfa ızgarası yüklenecek.';
    wrap.appendChild(waitHint);

    var toolbar = document.createElement('div');
    toolbar.className = 'page-selection-toolbar';
    toolbar.hidden = true;
    wrap.appendChild(toolbar);

    var grid = document.createElement('div');
    grid.className = 'page-selection-grid';
    grid.hidden = true;
    wrap.appendChild(grid);

    var largeHint = document.createElement('p');
    largeHint.className = 'compress-level-hint page-selection-large';
    largeHint.hidden = true;
    wrap.appendChild(largeHint);

    var advanced = document.createElement('details');
    advanced.className = 'page-selection-advanced';
    advanced.innerHTML = '<summary>Manuel liste (virgül / aralık)</summary>';
    var advInner = document.createElement('div');
    advInner.className = 'page-selection-advanced-body';
    var advLbl = document.createElement('span');
    advLbl.className = 'field-label';
    advLbl.textContent = input.label || input.name;
    advInner.appendChild(advLbl);
    advInner.appendChild(textEl);
    var boundHint = document.createElement('p');
    boundHint.className = 'compress-level-hint page-selection-bound-hint';
    boundHint.textContent = input.hint || 'Örn. 2,4 veya 1-3';
    advInner.appendChild(boundHint);
    advanced.appendChild(advInner);
    wrap.appendChild(advanced);

    var errHint = document.createElement('p');
    errHint.className = 'compress-level-hint page-selection-err';
    errHint.hidden = true;
    wrap.appendChild(errHint);

    form._pageSelectionFields = form._pageSelectionFields || [];
    form._pageSelectionFields.push({
      name: input.name,
      allowAll: !!input.allowAll,
      minKeep: input.minKeep != null ? Number(input.minKeep) : 0
    });

    var syncing = false;
    var maxVisual = SP ? SP.MAX_VISUAL : 120;

    function selectionOptions() {
      var cfg = form._pageSelectionFields.find(function (f) { return f.name === input.name; }) || {};
      return {
        maxPages: form._pdfFileMeta && form._pdfFileMeta.pageCount,
        allowAll: cfg.allowAll,
        minKeep: cfg.minKeep
      };
    }

    function getMaxPages() {
      return form._pdfFileMeta && form._pdfFileMeta.pageCount;
    }

    function getSelectedPages() {
      var maxPages = getMaxPages();
      if (!SP || !maxPages) return [];
      var parsed = SP.parse(textEl.value, maxPages, !!input.allowAll);
      return parsed.pages || [];
    }

    function setSelectedPages(pages, skipValidate) {
      if (!SP) return;
      syncing = true;
      textEl.value = SP.formatList(pages);
      syncing = false;
      updateGridStates();
      updateSummary();
      if (!skipValidate) validateLive();
    }

    function updateSummary() {
      var maxPages = getMaxPages();
      if (!maxPages) {
        summary.querySelector('.page-sum-action').textContent = '—';
        summary.querySelector('.page-sum-keep').textContent = 'PDF bekleniyor';
        return;
      }
      var selected = getSelectedPages();
      var nSel = selected.length;
      var nKeep = maxPages - nSel;
      summary.querySelector('.page-sum-action').textContent =
        nSel ? (nSel + ' sayfa ' + labels.action) : ('Henüz sayfa ' + labels.action + ' değil');
      summary.querySelector('.page-sum-keep').textContent =
        nKeep + ' sayfa ' + labels.keep;
    }

    function updateGridStates() {
      if (grid.hidden) return;
      var selected = {};
      getSelectedPages().forEach(function (p) { selected[p] = true; });
      grid.querySelectorAll('.page-tile').forEach(function (btn) {
        var n = Number(btn.getAttribute('data-page'));
        var on = !!selected[n];
        btn.classList.toggle('is-selected', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    function addToolBtn(parent, label, handler) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-secondary btn-sm page-tool-btn';
      b.textContent = label;
      b.addEventListener('click', handler);
      parent.appendChild(b);
      return b;
    }

    function buildToolbar(maxPages) {
      toolbar.innerHTML = '';
      var rangeWrap = document.createElement('div');
      rangeWrap.className = 'page-range-quick';
      var fromIn = document.createElement('input');
      fromIn.type = 'number';
      fromIn.min = '1';
      fromIn.max = String(maxPages);
      fromIn.className = 'page-range-input';
      fromIn.placeholder = '1';
      var toIn = document.createElement('input');
      toIn.type = 'number';
      toIn.min = '1';
      toIn.max = String(maxPages);
      toIn.className = 'page-range-input';
      toIn.placeholder = String(maxPages);
      var rangeBtn = document.createElement('button');
      rangeBtn.type = 'button';
      rangeBtn.className = 'btn btn-secondary btn-sm';
      rangeBtn.textContent = 'Aralık ekle';
      rangeBtn.addEventListener('click', function () {
        var a = parseInt(fromIn.value, 10) || 1;
        var b = parseInt(toIn.value, 10) || maxPages;
        var start = Math.max(1, Math.min(a, b));
        var end = Math.min(maxPages, Math.max(a, b));
        var merged = {};
        getSelectedPages().forEach(function (p) { merged[p] = true; });
        for (var p = start; p <= end; p++) merged[p] = true;
        setSelectedPages(Object.keys(merged).map(Number).sort(function (x, y) { return x - y; }));
      });
      rangeWrap.appendChild(fromIn);
      rangeWrap.appendChild(document.createTextNode(' – '));
      rangeWrap.appendChild(toIn);
      rangeWrap.appendChild(rangeBtn);
      toolbar.appendChild(rangeWrap);

      var btnRow = document.createElement('div');
      btnRow.className = 'page-toolbar-btns';
      addToolBtn(btnRow, 'Temizle', function () { setSelectedPages([]); });
      if (SP) {
        addToolBtn(btnRow, 'Tek sayfalar', function () {
          setSelectedPages(SP.pagesMatching(function (p) { return p % 2 === 1; }, maxPages));
        });
        addToolBtn(btnRow, 'Çift sayfalar', function () {
          setSelectedPages(SP.pagesMatching(function (p) { return p % 2 === 0; }, maxPages));
        });
        addToolBtn(btnRow, 'İlk sayfa', function () { setSelectedPages([1]); });
        addToolBtn(btnRow, 'Son sayfa', function () { setSelectedPages([maxPages]); });
      }
      toolbar.appendChild(btnRow);
    }

    function buildGrid(maxPages) {
      grid.innerHTML = '';
      for (var p = 1; p <= maxPages; p++) {
        (function (pageNum) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'page-tile ' + labels.selectedClass;
          btn.setAttribute('data-page', String(pageNum));
          btn.setAttribute('aria-pressed', 'false');
          btn.title = labels.tileTitle.replace('{n}', String(pageNum));
          btn.innerHTML = '<span class="page-tile-num">' + pageNum + '</span>';
          btn.addEventListener('click', function () {
            if (syncing || !SP) return;
            var selected = getSelectedPages();
            var idx = selected.indexOf(pageNum);
            if (idx >= 0) {
              selected.splice(idx, 1);
            } else {
              selected.push(pageNum);
              selected.sort(function (a, b) { return a - b; });
            }
            setSelectedPages(selected);
          });
          grid.appendChild(btn);
        })(p);
      }
    }

    function renderVisualPicker() {
      var maxPages = getMaxPages();
      waitHint.hidden = !!maxPages;
      if (!maxPages) {
        toolbar.hidden = true;
        grid.hidden = true;
        largeHint.hidden = true;
        updateSummary();
        return;
      }
      updateSummary();
      if (maxPages > maxVisual) {
        toolbar.hidden = false;
        grid.hidden = true;
        largeHint.hidden = false;
        largeHint.textContent = maxPages + ' sayfa — ızgarada en fazla ' + maxVisual +
          ' sayfa gösterilir. Manuel liste veya aralık alanını kullanın.';
        buildToolbar(maxPages);
        advanced.open = true;
        return;
      }
      largeHint.hidden = true;
      toolbar.hidden = false;
      grid.hidden = false;
      buildToolbar(maxPages);
      buildGrid(maxPages);
      updateGridStates();
    }

    function validateLive() {
      if (!SP) return;
      var err = SP.validate(textEl.value, selectionOptions());
      if (err) {
        errHint.textContent = err;
        errHint.hidden = false;
        textEl.setAttribute('aria-invalid', 'true');
      } else {
        errHint.hidden = true;
        textEl.removeAttribute('aria-invalid');
      }
      updateSummary();
    }

    textEl.addEventListener('input', function () {
      if (syncing) return;
      validateLive();
      updateGridStates();
    });

    var prevRefresh = form._refreshPdfPageMeta;
    form._refreshPdfPageMeta = function () {
      if (typeof prevRefresh === 'function') prevRefresh();
      if (input.hint && !getMaxPages()) {
        boundHint.textContent = input.hint;
      }
      renderVisualPicker();
      validateLive();
    };

    body.appendChild(wrap);
    renderVisualPicker();
  }

  function appendRearrangeInput(form, input) {
    var SR = window.SecuriRearrange;
    var SP = window.SecuriPages;
    var modes = SR ? SR.MODES : [{ value: 'CUSTOM', label: 'Özel sıra', desc: '' }];
    var body = appendToolSection(form, (input && input.sectionTitle) || 'Sıralama');
    var wrap = document.createElement('div');
    wrap.className = 'convert-field rearrange-field';

    var modeLbl = document.createElement('span');
    modeLbl.className = 'field-label';
    modeLbl.textContent = 'Sıralama modu';
    wrap.appendChild(modeLbl);

    var modeSel = document.createElement('select');
    modeSel.className = 'convert-format-select';
    modeSel.name = 'customMode';
    modes.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.value;
      o.textContent = m.label;
      if (m.value === 'CUSTOM') o.selected = true;
      modeSel.appendChild(o);
    });
    wrap.appendChild(modeSel);

    var modeDesc = document.createElement('p');
    modeDesc.className = 'compress-level-hint rearrange-mode-desc';
    wrap.appendChild(modeDesc);

    var pageNumbersEl = document.createElement('input');
    pageNumbersEl.type = 'hidden';
    pageNumbersEl.name = 'pageNumbers';
    pageNumbersEl.value = 'all';
    wrap.appendChild(pageNumbersEl);

    var customPanel = document.createElement('div');
    customPanel.className = 'rearrange-custom-panel';
    wrap.appendChild(customPanel);

    var waitHint = document.createElement('p');
    waitHint.className = 'compress-level-hint rearrange-wait';
    waitHint.textContent = 'Özel sıra için önce PDF seçin.';
    customPanel.appendChild(waitHint);

    var explain = document.createElement('p');
    explain.className = 'rearrange-explain';
    explain.innerHTML =
      '<strong>Soldan sağa = yeni belge sırası.</strong> Her kutuda <em>orijinal</em> sayfa numarası yazar. ' +
      'Örnek: <code>3, 1, 2</code> → yeni 1. sayfa eski 3, yeni 2. sayfa eski 1.';
    customPanel.appendChild(explain);

    var flowPreview = document.createElement('div');
    flowPreview.className = 'rearrange-flow-preview';
    customPanel.appendChild(flowPreview);

    var toolbar = document.createElement('div');
    toolbar.className = 'rearrange-toolbar';
    customPanel.appendChild(toolbar);

    var orderList = document.createElement('div');
    orderList.className = 'rearrange-order-list';
    customPanel.appendChild(orderList);

    var errHint = document.createElement('p');
    errHint.className = 'compress-level-hint page-selection-err rearrange-err';
    errHint.hidden = true;
    customPanel.appendChild(errHint);

    var advanced = document.createElement('details');
    advanced.className = 'page-selection-advanced rearrange-advanced';
    advanced.innerHTML = '<summary>Gelişmiş: sayfa numaralarını yaz</summary>';
    var advBody = document.createElement('div');
    advBody.className = 'page-selection-advanced-body';
    var manualInput = document.createElement('input');
    manualInput.type = 'text';
    manualInput.className = 'split-text-input';
    manualInput.placeholder = 'örn. 3,1,2,4';
    advBody.appendChild(manualInput);
    var advHint = document.createElement('p');
    advHint.className = 'compress-level-hint';
    advHint.textContent = 'Virgülle ayırın. Her değer orijinal PDF\'ten bir sayfa; sıra = yeni çıktı sırası.';
    advBody.appendChild(advHint);
    advanced.appendChild(advBody);
    customPanel.appendChild(advanced);

    var order = [];
    var dragFrom = -1;
    var maxVisual = SP ? SP.MAX_VISUAL : 120;

    function getMaxPages() {
      return form._pdfFileMeta && form._pdfFileMeta.pageCount;
    }

    function updateModeDesc() {
      var m = SR ? SR.getMode(modeSel.value) : null;
      modeDesc.textContent = m ? m.desc : '';
    }

    function syncPageNumbersField() {
      if (modeSel.value !== 'CUSTOM') {
        pageNumbersEl.value = 'all';
        return;
      }
      pageNumbersEl.value = SP ? SP.orderToCsv(order) : order.join(',');
      if (manualInput.value !== pageNumbersEl.value) {
        manualInput.value = pageNumbersEl.value;
      }
    }

    function updateFlowPreview() {
      var maxPages = getMaxPages();
      if (!maxPages || modeSel.value !== 'CUSTOM' || !order.length) {
        flowPreview.textContent = '';
        return;
      }
      var parts = order.map(function (orig, idx) {
        return (idx + 1) + '←' + orig;
      });
      flowPreview.textContent = 'Yeni sıra: ' + parts.join('  ·  ');
    }

    function validateCustom() {
      if (modeSel.value !== 'CUSTOM') {
        errHint.hidden = true;
        return true;
      }
      var maxPages = getMaxPages();
      if (!SP) return false;
      var err = SP.validateOrder(order, maxPages);
      if (err) {
        errHint.textContent = err;
        errHint.hidden = false;
        return false;
      }
      errHint.hidden = true;
      return true;
    }

    function renderOrderList() {
      var maxPages = getMaxPages();
      waitHint.hidden = !!maxPages;
      orderList.innerHTML = '';
      toolbar.innerHTML = '';
      if (!maxPages) {
        order = [];
        syncPageNumbersField();
        updateFlowPreview();
        return;
      }
      if (order.length !== maxPages) {
        order = SP ? SP.identityOrder(maxPages) : [];
      }
      if (maxPages > maxVisual) {
        orderList.innerHTML = '<p class="hint">' + maxPages + ' sayfa — sürükle-bırak için en fazla ' +
          maxVisual + ' sayfa. Gelişmiş alanı kullanın.</p>';
        advanced.open = true;
        syncPageNumbersField();
        updateFlowPreview();
        validateCustom();
        return;
      }

      var resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'btn btn-secondary btn-sm';
      resetBtn.textContent = 'Orijinal sıra (1,2,3…)';
      resetBtn.addEventListener('click', function () {
        order = SP ? SP.identityOrder(maxPages) : [];
        renderOrderList();
      });
      var revBtn = document.createElement('button');
      revBtn.type = 'button';
      revBtn.className = 'btn btn-secondary btn-sm';
      revBtn.textContent = 'Ters çevir';
      revBtn.addEventListener('click', function () {
        order = order.slice().reverse();
        renderOrderList();
      });
      toolbar.appendChild(resetBtn);
      toolbar.appendChild(revBtn);

      order.forEach(function (origPage, idx) {
        var item = document.createElement('div');
        item.className = 'rearrange-order-item';
        item.setAttribute('draggable', 'true');
        item.setAttribute('data-idx', String(idx));

        var pos = document.createElement('span');
        pos.className = 'rearrange-pos';
        pos.textContent = String(idx + 1);
        item.appendChild(pos);

        var num = document.createElement('span');
        num.className = 'rearrange-orig';
        num.textContent = 'Sayfa ' + origPage;
        item.appendChild(num);

        var moves = document.createElement('div');
        moves.className = 'rearrange-moves';
        if (idx > 0) {
          var up = document.createElement('button');
          up.type = 'button';
          up.className = 'rearrange-nudge';
          up.title = 'Sola taşı';
          up.textContent = '‹';
          up.addEventListener('click', function (e) {
            e.stopPropagation();
            var t = order[idx];
            order[idx] = order[idx - 1];
            order[idx - 1] = t;
            renderOrderList();
          });
          moves.appendChild(up);
        }
        if (idx < order.length - 1) {
          var down = document.createElement('button');
          down.type = 'button';
          down.className = 'rearrange-nudge';
          down.title = 'Sağa taşı';
          down.textContent = '›';
          down.addEventListener('click', function (e) {
            e.stopPropagation();
            var t = order[idx];
            order[idx] = order[idx + 1];
            order[idx + 1] = t;
            renderOrderList();
          });
          moves.appendChild(down);
        }
        item.appendChild(moves);

        item.addEventListener('dragstart', function (e) {
          dragFrom = idx;
          item.classList.add('is-dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        item.addEventListener('dragend', function () {
          dragFrom = -1;
          item.classList.remove('is-dragging');
        });
        item.addEventListener('dragover', function (e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        });
        item.addEventListener('drop', function (e) {
          e.preventDefault();
          var toIdx = idx;
          if (dragFrom < 0 || dragFrom === toIdx) return;
          var moved = order.splice(dragFrom, 1)[0];
          order.splice(toIdx, 0, moved);
          renderOrderList();
        });

        orderList.appendChild(item);
      });

      syncPageNumbersField();
      updateFlowPreview();
      validateCustom();
    }

    function toggleCustomPanel() {
      var isCustom = modeSel.value === 'CUSTOM';
      customPanel.hidden = !isCustom;
      if (!isCustom) {
        pageNumbersEl.value = 'all';
        errHint.hidden = true;
      } else {
        renderOrderList();
      }
    }

    modeSel.addEventListener('change', function () {
      updateModeDesc();
      toggleCustomPanel();
    });

    manualInput.addEventListener('input', function () {
      if (modeSel.value !== 'CUSTOM' || !SP) return;
      var maxPages = getMaxPages();
      if (!maxPages) return;
      var parsed = SP.csvToOrder(manualInput.value, maxPages);
      if (parsed.order) {
        order = parsed.order;
        renderOrderList();
      } else {
        pageNumbersEl.value = manualInput.value;
        validateCustom();
      }
    });

    var prevRefresh = form._refreshPdfPageMeta;
    form._refreshPdfPageMeta = function () {
      if (typeof prevRefresh === 'function') prevRefresh();
      if (modeSel.value === 'CUSTOM') renderOrderList();
    };

    form._validateRearrange = function () {
      if (modeSel.value !== 'CUSTOM') return '';
      return SP ? SP.validateOrder(order, getMaxPages()) : '';
    };

    body.appendChild(wrap);
    updateModeDesc();
    toggleCustomPanel();
  }

  var PN_POSITIONS = [
    { value: '1', label: 'Üst sol', posClass: 'pn-pos-1' },
    { value: '2', label: 'Üst orta', posClass: 'pn-pos-2' },
    { value: '3', label: 'Üst sağ', posClass: 'pn-pos-3' },
    { value: '7', label: 'Alt sol', posClass: 'pn-pos-7' },
    { value: '8', label: 'Alt orta', posClass: 'pn-pos-8' },
    { value: '9', label: 'Alt sağ', posClass: 'pn-pos-9' }
  ];

  function appendAddPageNumbersInput(form, input) {
    var SP = window.SecuriPages;
    var labels = SP ? SP.modeLabels('number') : { selectedClass: 'is-number' };
    var body = appendToolSection(form, (input && input.sectionTitle) || 'Numaralandırma');
    var wrap = document.createElement('div');
    wrap.className = 'convert-field add-page-numbers-field';

    var layout = document.createElement('div');
    layout.className = 'pn-layout';

    var posPanel = document.createElement('div');
    posPanel.className = 'pn-position-panel';
    posPanel.innerHTML = '<span class="field-label">Numara konumu</span>';
    var posGrid = document.createElement('div');
    posGrid.className = 'pn-position-grid';
    posPanel.appendChild(posGrid);

    var previewPanel = document.createElement('div');
    previewPanel.className = 'pn-preview-panel';
    var previewPage = document.createElement('div');
    previewPage.className = 'pn-preview-page';
    var previewNum = document.createElement('span');
    previewNum.className = 'pn-preview-num pn-pos-8';
    previewNum.textContent = '1';
    previewPage.appendChild(previewNum);
    previewPanel.appendChild(previewPage);
    var previewHint = document.createElement('p');
    previewHint.className = 'compress-level-hint';
    previewHint.textContent = 'Önizleme — gerçek PDF\'teki konum yaklaşıktır.';
    previewPanel.appendChild(previewHint);

    layout.appendChild(posPanel);
    layout.appendChild(previewPanel);
    wrap.appendChild(layout);

    var positionInput = document.createElement('input');
    positionInput.type = 'hidden';
    positionInput.name = 'position';
    positionInput.value = '8';
    wrap.appendChild(positionInput);

    var optsRow = document.createElement('div');
    optsRow.className = 'pn-options-row';

    var startField = document.createElement('div');
    startField.className = 'convert-field pn-opt-field';
    startField.innerHTML = '<span class="field-label">Başlangıç numarası</span>';
    var startIn = document.createElement('input');
    startIn.type = 'number';
    startIn.className = 'split-num-input';
    startIn.name = 'startingNumber';
    startIn.min = '1';
    startIn.value = '1';
    startField.appendChild(startIn);
    var startHint = document.createElement('p');
    startHint.className = 'compress-level-hint';
    startHint.textContent = 'İlk numaralanan sayfa bu değerden başlar.';
    startField.appendChild(startHint);
    optsRow.appendChild(startField);

    var fontField = document.createElement('div');
    fontField.className = 'convert-field pn-opt-field';
    fontField.innerHTML = '<span class="field-label">Yazı boyutu (pt)</span>';
    var fontRow = document.createElement('div');
    fontRow.className = 'compress-level-row';
    var fontSlider = document.createElement('input');
    fontSlider.type = 'range';
    fontSlider.className = 'compress-slider';
    fontSlider.min = '6';
    fontSlider.max = '72';
    fontSlider.step = '1';
    fontSlider.value = '12';
    var fontIn = document.createElement('input');
    fontIn.type = 'number';
    fontIn.className = 'compress-level-num';
    fontIn.name = 'fontSize';
    fontIn.min = '6';
    fontIn.max = '72';
    fontIn.value = '12';
    fontRow.appendChild(fontSlider);
    fontRow.appendChild(fontIn);
    fontField.appendChild(fontRow);
    optsRow.appendChild(fontField);
    wrap.appendChild(optsRow);

    var scopeSection = document.createElement('div');
    scopeSection.className = 'pn-scope-section';
    scopeSection.innerHTML = '<span class="field-label">Hangi sayfalar?</span>';
    var allLabel = document.createElement('label');
    allLabel.className = 'check-option pn-all-pages';
    var allCb = document.createElement('input');
    allCb.type = 'checkbox';
    allCb.checked = true;
    allLabel.appendChild(allCb);
    allLabel.appendChild(document.createTextNode(' Tüm sayfalar'));
    scopeSection.appendChild(allLabel);

    var pagesToNumberIn = document.createElement('input');
    pagesToNumberIn.type = 'hidden';
    pagesToNumberIn.name = 'pagesToNumber';
    pagesToNumberIn.value = 'all';
    scopeSection.appendChild(pagesToNumberIn);

    var manualWrap = document.createElement('div');
    manualWrap.className = 'pn-scope-manual';
    manualWrap.hidden = true;
    var manualIn = document.createElement('input');
    manualIn.type = 'text';
    manualIn.className = 'split-text-input';
    manualIn.placeholder = 'Örn. 1-5 veya 2,4,6';
    manualWrap.appendChild(manualIn);
    var manualHint = document.createElement('p');
    manualHint.className = 'compress-level-hint';
    manualHint.textContent = 'Virgül veya aralık ile yazın (1-3, 5, 8).';
    manualWrap.appendChild(manualHint);
    scopeSection.appendChild(manualWrap);

    var scopeSummary = document.createElement('div');
    scopeSummary.className = 'page-selection-summary pn-scope-summary';
    scopeSummary.hidden = true;
    scopeSection.appendChild(scopeSummary);

    var scopeGrid = document.createElement('div');
    scopeGrid.className = 'page-selection-grid pn-scope-grid';
    scopeGrid.hidden = true;
    scopeSection.appendChild(scopeGrid);

    var scopeErr = document.createElement('p');
    scopeErr.className = 'compress-level-hint page-selection-err';
    scopeErr.hidden = true;
    scopeSection.appendChild(scopeErr);

    wrap.appendChild(scopeSection);
    body.appendChild(wrap);

    var selectedPos = '8';
    var scopePages = [];

    function getMaxPages() {
      return form._pdfFileMeta && form._pdfFileMeta.pageCount;
    }

    function updatePreview() {
      previewNum.textContent = String(startIn.value || '1');
      previewNum.style.fontSize = Math.max(8, Math.min(24, Number(fontIn.value) || 12)) * 0.85 + 'px';
      PN_POSITIONS.forEach(function (p) {
        previewNum.classList.toggle(p.posClass, p.value === selectedPos);
      });
    }

    function buildPositionGrid() {
      posGrid.innerHTML = '';
      PN_POSITIONS.forEach(function (p) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pn-pos-btn' + (p.value === selectedPos ? ' is-active' : '');
        btn.textContent = p.label;
        btn.addEventListener('click', function () {
          selectedPos = p.value;
          positionInput.value = p.value;
          buildPositionGrid();
          updatePreview();
        });
        posGrid.appendChild(btn);
      });
    }

    function syncScopeField() {
      if (allCb.checked) {
        pagesToNumberIn.value = 'all';
        scopeSummary.hidden = true;
        scopeGrid.hidden = true;
        manualWrap.hidden = true;
        scopeErr.hidden = true;
        return;
      }
      var maxPages = getMaxPages();
      var useManual = maxPages && maxPages > (SP ? SP.MAX_VISUAL : 120);
      if (useManual) {
        pagesToNumberIn.value = manualIn.value.trim();
      } else {
        pagesToNumberIn.value = SP ? SP.formatList(scopePages) : scopePages.join(',');
      }
      if (maxPages) {
        scopeSummary.hidden = false;
        var nSel = useManual && SP
          ? ((SP.parse(pagesToNumberIn.value, maxPages, false).pages) || []).length
          : scopePages.length;
        scopeSummary.innerHTML = '<span class="page-sum-action">' +
          (nSel ? nSel + ' sayfa ' + labels.action : 'Sayfa seçin veya liste yazın') +
          '</span><span class="page-sum-sep"> · </span><span class="page-sum-keep">' +
          (maxPages - nSel) + ' sayfa ' + labels.keep + '</span>';
      }
    }

    function renderScopeGrid() {
      var maxPages = getMaxPages();
      scopeGrid.innerHTML = '';
      if (allCb.checked || !maxPages) {
        manualWrap.hidden = true;
        syncScopeField();
        return;
      }
      var useManual = maxPages > (SP ? SP.MAX_VISUAL : 120);
      scopeGrid.hidden = useManual;
      manualWrap.hidden = !useManual;
      if (useManual) {
        scopeErr.hidden = true;
        syncScopeField();
        return;
      }
      scopeErr.hidden = true;
      var selected = {};
      scopePages.forEach(function (p) { selected[p] = true; });
      for (var p = 1; p <= maxPages; p++) {
        (function (pageNum) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'page-tile ' + labels.selectedClass + (selected[pageNum] ? ' is-selected' : '');
          btn.innerHTML = '<span class="page-tile-num">' + pageNum + '</span>';
          btn.addEventListener('click', function () {
            var idx = scopePages.indexOf(pageNum);
            if (idx >= 0) scopePages.splice(idx, 1);
            else {
              scopePages.push(pageNum);
              scopePages.sort(function (a, b) { return a - b; });
            }
            renderScopeGrid();
          });
          scopeGrid.appendChild(btn);
        })(p);
      }
      syncScopeField();
    }

    fontSlider.addEventListener('input', function () {
      fontIn.value = fontSlider.value;
      updatePreview();
    });
    fontIn.addEventListener('input', function () {
      var v = Math.max(6, Math.min(72, Number(fontIn.value) || 12));
      fontSlider.value = String(v);
      updatePreview();
    });
    startIn.addEventListener('input', updatePreview);

    allCb.addEventListener('change', function () {
      if (allCb.checked) {
        scopePages = [];
        manualIn.value = '';
      }
      renderScopeGrid();
    });

    manualIn.addEventListener('input', function () {
      syncScopeField();
    });

    var prevRefresh = form._refreshPdfPageMeta;
    form._refreshPdfPageMeta = function () {
      if (typeof prevRefresh === 'function') prevRefresh();
      renderScopeGrid();
    };

    form._validateAddPageNumbers = function () {
      if (allCb.checked) return '';
      var maxPages = getMaxPages();
      if (!maxPages) return 'Sayfa sayısı okunamadı — PDF seçin.';
      var val = pagesToNumberIn.value.trim();
      if (!val) return 'Numaralandırılacak en az bir sayfa seçin veya liste yazın.';
      return SP ? SP.validate(val, { maxPages: maxPages, allowAll: false, minKeep: 0 }) : '';
    };

    buildPositionGrid();
    updatePreview();
    renderScopeGrid();
  }

  function fetchPdfPageDimensions(file) {
    var fd = new FormData();
    fd.append('fileInput', file);
    return fetch(APP + '/redaction/metadata', { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var pages = data && data.pages;
        var first = pages && pages.length ? pages[0] : null;
        if (!first) return null;
        return {
          pageCount: Number(data.pageCount) || pages.length,
          width: Number(first.width) || 595,
          height: Number(first.height) || 842
        };
      })
      .catch(function () { return null; });
  }

  function appendCropInput(form, input) {
    var SC = window.SecuriCrop;
    var body = appendToolSection(form, (input && input.sectionTitle) || 'Kırpma alanı');
    var wrap = document.createElement('div');
    wrap.className = 'convert-field crop-field';

    var emptyState = document.createElement('div');
    emptyState.className = 'crop-empty-state';
    emptyState.innerHTML = '<p class="compress-level-hint">Kırpma alanını ayarlamak için önce PDF seçin.</p>';
    wrap.appendChild(emptyState);

    var workspace = document.createElement('div');
    workspace.className = 'crop-workspace';
    workspace.hidden = true;

    var presetRow = document.createElement('div');
    presetRow.className = 'crop-preset-row';
    [
      { id: 'full', label: 'Tam sayfa' },
      { id: 'margin5', label: '%5 kenar' },
      { id: 'margin10', label: '%10 kenar' },
      { id: 'center80', label: 'Ortala %80' }
    ].forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary btn-sm crop-preset-btn';
      btn.textContent = p.label;
      btn.setAttribute('data-preset', p.id);
      presetRow.appendChild(btn);
    });
    workspace.appendChild(presetRow);

    var previewWrap = document.createElement('div');
    previewWrap.className = 'crop-preview-wrap';
    var pageSizeLbl = document.createElement('p');
    pageSizeLbl.className = 'crop-page-size compress-level-hint';
    pageSizeLbl.textContent = 'Sayfa boyutu: —';
    previewWrap.appendChild(pageSizeLbl);

    var stage = document.createElement('div');
    stage.className = 'crop-preview-stage';
    var pageEl = document.createElement('div');
    pageEl.className = 'crop-preview-page';
    var shadeTop = document.createElement('div');
    shadeTop.className = 'crop-shade crop-shade-top';
    var shadeRight = document.createElement('div');
    shadeRight.className = 'crop-shade crop-shade-right';
    var shadeBottom = document.createElement('div');
    shadeBottom.className = 'crop-shade crop-shade-bottom';
    var shadeLeft = document.createElement('div');
    shadeLeft.className = 'crop-shade crop-shade-left';
    var cropBox = document.createElement('div');
    cropBox.className = 'crop-box';
    cropBox.innerHTML =
      '<span class="crop-handle crop-handle-nw" data-handle="nw"></span>' +
      '<span class="crop-handle crop-handle-ne" data-handle="ne"></span>' +
      '<span class="crop-handle crop-handle-sw" data-handle="sw"></span>' +
      '<span class="crop-handle crop-handle-se" data-handle="se"></span>' +
      '<span class="crop-handle crop-handle-n" data-handle="n"></span>' +
      '<span class="crop-handle crop-handle-s" data-handle="s"></span>' +
      '<span class="crop-handle crop-handle-w" data-handle="w"></span>' +
      '<span class="crop-handle crop-handle-e" data-handle="e"></span>' +
      '<span class="crop-box-label"></span>';
    pageEl.appendChild(shadeTop);
    pageEl.appendChild(shadeRight);
    pageEl.appendChild(shadeBottom);
    pageEl.appendChild(shadeLeft);
    pageEl.appendChild(cropBox);
    stage.appendChild(pageEl);
    previewWrap.appendChild(stage);
    var previewHint = document.createElement('p');
    previewHint.className = 'compress-level-hint';
    previewHint.textContent = 'Kırpma kutusunu sürükleyin veya köşelerden boyutlandırın. Koordinatlar pt cinsindendir (sol üst köşe).';
    previewWrap.appendChild(previewHint);
    workspace.appendChild(previewWrap);

    var marginRow = document.createElement('div');
    marginRow.className = 'crop-margin-row';
    marginRow.innerHTML = '<span class="field-label">Kenar boşlukları (pt)</span>';
    var marginGrid = document.createElement('div');
    marginGrid.className = 'crop-margin-grid';
    var marginFields = {};
    [
      { key: 'top', label: 'Üst' },
      { key: 'right', label: 'Sağ' },
      { key: 'bottom', label: 'Alt' },
      { key: 'left', label: 'Sol' }
    ].forEach(function (f) {
      var cell = document.createElement('label');
      cell.className = 'crop-margin-cell';
      cell.innerHTML = '<span class="crop-margin-lbl">' + f.label + '</span>';
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'split-num-input crop-margin-input';
      inp.min = '0';
      inp.step = '1';
      inp.value = '0';
      inp.setAttribute('data-margin', f.key);
      cell.appendChild(inp);
      marginGrid.appendChild(cell);
      marginFields[f.key] = inp;
    });
    marginRow.appendChild(marginGrid);
    workspace.appendChild(marginRow);

    var rectRow = document.createElement('div');
    rectRow.className = 'crop-rect-row';
    var rectFields = {};
    [
      { name: 'x', label: 'Sol (X)' },
      { name: 'y', label: 'Üst (Y)' },
      { name: 'width', label: 'Genişlik' },
      { name: 'height', label: 'Yükseklik' }
    ].forEach(function (f) {
      var cell = document.createElement('label');
      cell.className = 'crop-rect-cell';
      cell.innerHTML = '<span class="field-label">' + f.label + '</span>';
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'split-num-input';
      inp.name = f.name;
      inp.min = f.name === 'x' || f.name === 'y' ? '0' : '1';
      inp.step = '0.1';
      cell.appendChild(inp);
      rectRow.appendChild(cell);
      rectFields[f.name] = inp;
    });
    workspace.appendChild(rectRow);

    wrap.appendChild(workspace);
    body.appendChild(wrap);

    var pageMeta = null;
    var rect = SC ? SC.defaultRect(null) : { x: 0, y: 0, width: 595, height: 842 };
    var loadToken = 0;
    var syncing = false;
    var dragState = null;

    function pageSize() {
      return pageMeta || (SC ? SC.DEFAULT_PAGE : { width: 595, height: 842 });
    }

    function displayScale() {
      var ps = pageSize();
      var maxW = 320;
      return Math.min(1, maxW / ps.width);
    }

    function setRect(next, skipMargins) {
      rect = SC ? SC.clampRect(next, pageSize()) : next;
      syncAll(skipMargins ? 'rect' : null);
    }

    function syncHiddenFields() {
      rectFields.x.value = String(rect.x);
      rectFields.y.value = String(rect.y);
      rectFields.width.value = String(rect.width);
      rectFields.height.value = String(rect.height);
    }

    function syncMarginsFromRect() {
      if (!SC) return;
      var m = SC.rectToMargins(rect, pageSize());
      marginFields.top.value = String(m.top);
      marginFields.right.value = String(m.right);
      marginFields.bottom.value = String(m.bottom);
      marginFields.left.value = String(m.left);
    }

    function syncRectFromMargins() {
      if (!SC) return;
      setRect(SC.marginsToRect({
        top: marginFields.top.value,
        right: marginFields.right.value,
        bottom: marginFields.bottom.value,
        left: marginFields.left.value
      }, pageSize()), true);
    }

    function updateVisual() {
      var scale = displayScale();
      var ps = pageSize();
      pageEl.style.width = Math.round(ps.width * scale) + 'px';
      pageEl.style.height = Math.round(ps.height * scale) + 'px';
      pageSizeLbl.textContent = 'Sayfa boyutu: ' + Math.round(ps.width) + ' × ' + Math.round(ps.height) + ' pt';

      var left = rect.x * scale;
      var top = rect.y * scale;
      var w = rect.width * scale;
      var h = rect.height * scale;
      var pw = ps.width * scale;
      var ph = ps.height * scale;

      cropBox.style.left = left + 'px';
      cropBox.style.top = top + 'px';
      cropBox.style.width = w + 'px';
      cropBox.style.height = h + 'px';

      shadeTop.style.height = top + 'px';
      shadeLeft.style.top = top + 'px';
      shadeLeft.style.width = left + 'px';
      shadeLeft.style.height = h + 'px';
      shadeRight.style.top = top + 'px';
      shadeRight.style.left = (left + w) + 'px';
      shadeRight.style.width = Math.max(0, pw - left - w) + 'px';
      shadeRight.style.height = h + 'px';
      shadeBottom.style.top = (top + h) + 'px';
      shadeBottom.style.height = Math.max(0, ph - top - h) + 'px';

      var lbl = cropBox.querySelector('.crop-box-label');
      if (lbl) lbl.textContent = Math.round(rect.width) + ' × ' + Math.round(rect.height);
    }

    function syncAll(source) {
      if (syncing) return;
      syncing = true;
      syncHiddenFields();
      if (source !== 'margins') syncMarginsFromRect();
      updateVisual();
      syncing = false;
    }

    function applyPreset(id) {
      if (!SC) return;
      setRect(SC.presetRect(id, pageSize()));
    }

    function loadFromFile() {
      var fileIn = form.querySelector('[name="fileInput"]');
      if (!fileIn || !fileIn.files || !fileIn.files.length || !isPdfUpload(fileIn.files[0])) {
        pageMeta = null;
        emptyState.hidden = false;
        workspace.hidden = true;
        return;
      }
      var file = fileIn.files[0];
      emptyState.hidden = true;
      workspace.hidden = false;
      pageSizeLbl.textContent = 'Sayfa boyutu okunuyor…';
      var token = ++loadToken;
      fetchPdfPageDimensions(file).then(function (meta) {
        if (token !== loadToken) return;
        if (meta) {
          pageMeta = { width: meta.width, height: meta.height };
          setRect(SC ? SC.defaultRect(pageMeta) : { x: 0, y: 0, width: meta.width, height: meta.height });
        } else {
          pageMeta = SC ? SC.DEFAULT_PAGE : { width: 595, height: 842 };
          setRect(SC ? SC.defaultRect(pageMeta) : { x: 0, y: 0, width: 595, height: 842 });
          pageSizeLbl.textContent = 'Sayfa boyutu alınamadı — A4 varsayıldı (595 × 842 pt)';
        }
      });
    }

    function pointerToPagePt(clientX, clientY) {
      var box = pageEl.getBoundingClientRect();
      var scale = displayScale();
      return {
        x: (clientX - box.left) / scale,
        y: (clientY - box.top) / scale
      };
    }

    function startDrag(mode, handle, clientX, clientY) {
      dragState = {
        mode: mode,
        handle: handle,
        startPt: pointerToPagePt(clientX, clientY),
        startRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      };
    }

    function onDragMove(clientX, clientY) {
      if (!dragState || !SC) return;
      var pt = pointerToPagePt(clientX, clientY);
      var dx = pt.x - dragState.startPt.x;
      var dy = pt.y - dragState.startPt.y;
      var sr = dragState.startRect;
      var ps = pageSize();
      var next = { x: sr.x, y: sr.y, width: sr.width, height: sr.height };

      if (dragState.mode === 'move') {
        next.x = sr.x + dx;
        next.y = sr.y + dy;
      } else {
        var h = dragState.handle;
        if (h.indexOf('e') >= 0) next.width = sr.width + dx;
        if (h.indexOf('s') >= 0) next.height = sr.height + dy;
        if (h.indexOf('w') >= 0) {
          next.x = sr.x + dx;
          next.width = sr.width - dx;
        }
        if (h.indexOf('n') >= 0) {
          next.y = sr.y + dy;
          next.height = sr.height - dy;
        }
      }
      setRect(SC.clampRect(next, ps));
    }

    function endDrag() {
      dragState = null;
    }

    cropBox.addEventListener('mousedown', function (e) {
      if (e.target.classList.contains('crop-handle')) return;
      e.preventDefault();
      startDrag('move', null, e.clientX, e.clientY);
    });
    cropBox.querySelectorAll('.crop-handle').forEach(function (handle) {
      handle.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        startDrag('resize', handle.getAttribute('data-handle'), e.clientX, e.clientY);
      });
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragState) return;
      onDragMove(e.clientX, e.clientY);
    });
    document.addEventListener('mouseup', endDrag);

    presetRow.querySelectorAll('.crop-preset-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyPreset(btn.getAttribute('data-preset'));
      });
    });

    Object.keys(marginFields).forEach(function (key) {
      marginFields[key].addEventListener('input', function () {
        if (syncing) return;
        syncRectFromMargins();
      });
    });

    Object.keys(rectFields).forEach(function (key) {
      rectFields[key].addEventListener('input', function () {
        if (syncing) return;
        setRect({
          x: Number(rectFields.x.value) || 0,
          y: Number(rectFields.y.value) || 0,
          width: Number(rectFields.width.value) || 1,
          height: Number(rectFields.height.value) || 1
        });
      });
    });

    var prevRefresh = form._refreshPdfPageMeta;
    form._refreshPdfPageMeta = function () {
      if (typeof prevRefresh === 'function') prevRefresh();
      loadFromFile();
    };

    form._validateCrop = function () {
      if (!pageMeta && workspace.hidden) return 'Kırpma için PDF seçin.';
      if (!rect.width || !rect.height) return 'Kırpma genişliği ve yüksekliği girin.';
      var ps = pageSize();
      if (rect.x + rect.width > ps.width + 0.5 || rect.y + rect.height > ps.height + 0.5) {
        return 'Kırpma alanı sayfa sınırlarını aşıyor.';
      }
      return '';
    };

    loadFromFile();
    syncAll();
  }

  function appendGenericField(form, input) {
    var body = input.sectionTitle ? appendToolSection(form, input.sectionTitle) : form;
    var wrap = document.createElement('div');
    wrap.className = 'convert-field generic-param-field';

    if (input.type === 'checkbox') {
      var checkLabel = document.createElement('label');
      checkLabel.className = 'check-option generic-check-field';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.name = input.name;
      cb.value = 'true';
      if (input.default === true || input.default === 'true') cb.checked = true;
      checkLabel.appendChild(cb);
      checkLabel.appendChild(document.createTextNode(' ' + (input.checkboxLabel || input.label || input.name)));
      wrap.appendChild(checkLabel);
    } else {
      var lbl = document.createElement('span');
      lbl.className = 'field-label';
      lbl.textContent = input.label || input.name;
      wrap.appendChild(lbl);
      var el;
      if (input.type === 'select') {
        el = document.createElement('select');
        el.className = 'convert-format-select';
        (input.options || []).forEach(function (opt) {
          var o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          if (String(opt.value) === String(input.default)) o.selected = true;
          el.appendChild(o);
        });
      } else if (input.type === 'number') {
        el = document.createElement('input');
        el.type = 'number';
        el.className = 'split-num-input';
        if (input.min != null) el.min = String(input.min);
        if (input.max != null) el.max = String(input.max);
        if (input.step != null) el.step = String(input.step);
        if (input.default != null) el.value = String(input.default);
      } else if (input.type === 'textarea') {
        el = document.createElement('textarea');
        el.className = 'split-text-input split-textarea';
        el.rows = input.rows || 6;
        if (input.placeholder) el.placeholder = input.placeholder;
        if (input.default != null) el.value = String(input.default);
      } else {
        el = document.createElement('input');
        el.type = 'text';
        el.className = 'split-text-input';
        if (input.placeholder) el.placeholder = input.placeholder;
        if (input.default != null) el.value = String(input.default);
      }
      el.name = input.name;
      if (input.required) el.required = true;
      wrap.appendChild(el);
    }

    if (input.hint) {
      var hint = document.createElement('p');
      hint.className = 'compress-level-hint';
      hint.textContent = input.hint;
      wrap.appendChild(hint);
    }
    body.appendChild(wrap);
  }

  function appendToolInput(form, input) {
    if (input.type === 'rotation') {
      appendRotationInput(form, input);
      return;
    }
    if (input.type === 'compress') {
      appendCompressInput(form, input);
      return;
    }
    if (input.type === 'convert') {
      appendConvertInput(form, input);
      return;
    }
    if (input.type === 'ocr') {
      appendOcrInput(form);
      return;
    }
    if (input.type === 'watermark') {
      appendWatermarkInput(form);
      return;
    }
    if (input.type === 'stamp') {
      appendStampInput(form);
      return;
    }
    if (input.type === 'compare') {
      appendCompareInput(form);
      return;
    }
    if (input.type === 'split') {
      appendSplitInput(form);
      return;
    }
    if (input.type === 'redact-patterns') {
      appendRedactInput(form);
      return;
    }
    if (input.type === 'password') {
      appendAddPasswordInput(form);
      return;
    }
    if (input.type === 'change-permissions') {
      appendChangePermissionsInput(form);
      return;
    }
    if (input.type === 'cert-sign') {
      appendCertSignInput(form);
      return;
    }
    if (input.type === 'pageSelection') {
      appendPageSelectionInput(form, input);
      return;
    }
    if (input.type === 'rearrange') {
      appendRearrangeInput(form, input);
      return;
    }
    if (input.type === 'addPageNumbers') {
      appendAddPageNumbersInput(form, input);
      return;
    }
    if (input.type === 'crop') {
      appendCropInput(form, input);
      return;
    }
    if (input.type === 'file') {
      appendFileInput(form, input);
      return;
    }
    if (input.type === 'text' || input.type === 'number' || input.type === 'checkbox' || input.type === 'select' || input.type === 'textarea') {
      appendGenericField(form, input);
      return;
    }
    var label = document.createElement('label');
    label.textContent = input.label || input.name;
    var file = document.createElement('input');
    file.type = 'file';
    file.name = input.name;
    if (input.accept) file.accept = input.accept;
    if (input.multiple) file.multiple = true;
    if (input.required) file.required = true;
    label.appendChild(file);
    form.appendChild(label);
  }

  function appendOutputOptions(form) {
    var wrap = document.createElement('fieldset');
    wrap.className = 'tool-output-options';
    wrap.innerHTML =
      '<legend>İşlem sonrası</legend>' +
      '<label class="check-option"><input type="checkbox" id="outputDownload" checked> İndir</label>' +
      '<label class="check-option"><input type="checkbox" id="outputSaveDocuments"> Belgelerde listele</label>';
    form.appendChild(wrap);
  }

  function buildToolForm() {
    var tool = state.currentTool;
    if (!tool) return;
    $('toolTitle').textContent = tool.title;
    $('toolDesc').textContent = tool.description;
    var form = $('toolForm');
    if (form._redactCleanup) {
      form._redactCleanup();
      form._redactCleanup = null;
    }
    form.innerHTML = '';
    form._pageSelectionFields = [];
    (tool.inputs || []).forEach(function (input) { appendToolInput(form, input); });
    appendOutputOptions(form);
    var submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    submit.textContent = 'İşle';
    form.appendChild(submit);
    $('toolStatus').hidden = true;
    $('toolProgressWrap').hidden = true;
    setProgressBar('toolProgressBar', 0);
  }

  function highlightToolCard(id) {
    document.querySelectorAll('.tool-card').forEach(function (card) {
      card.classList.toggle('active', id && card.getAttribute('data-tool-id') === id);
    });
  }

  function closeToolWorkspace() {
    state.currentTool = null;
    state.activeToolId = null;
    var ws = $('toolWorkspace');
    if (ws) ws.hidden = true;
    highlightToolCard(null);
    renderToolsPage();
  }

  function selectTool(id, updateHash) {
    state.currentTool = state.tools.find(function (t) { return t.id === id; });
    if (!state.currentTool) return;
    state.activeToolId = id;
    if (updateHash !== false) {
      var h = '#/araclar/' + id;
      if (location.hash !== h) location.hash = h;
    }
    buildToolForm();
    var ws = $('toolWorkspace');
    if (ws) {
      ws.hidden = false;
      ws.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    highlightToolCard(id);
    renderToolsPage();
  }

  function openTool(id) {
    showView('araclar');
    setActiveNav('araclar');
    selectTool(id, true);
  }

  function setToolStatus(msg, ok) {
    var el = $('toolStatus');
    el.hidden = false;
    el.className = 'status ' + (ok ? 'ok' : 'err');
    el.textContent = msg;
  }

  function filenameFromDisposition(header, fallback) {
    var fb = fallback || 'output.pdf';
    if (!header) return fb;
    var m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(header);
    return m ? decodeURIComponent(m[1]) : fb;
  }

  function downloadFallbackFilename(toolId) {
    var names = {
      compare: 'karsilastirma-raporu.html',
      'split-pages': 'bolunmus-belgeler.zip',
      'pdf-to-img': 'pdf-gorseller.zip',
      'extract-images': 'cikarilan-gorseller.zip',
      'get-info-on-pdf': 'pdf-bilgisi.json',
      'validate-signature': 'imza-dogrulama.json',
      'pdf-to-text': 'pdf-metin.txt',
      'pdf-to-html': 'pdf-sayfa.html',
      'pdf-to-markdown': 'pdf-icerik.md',
      'pdf-to-xml': 'pdf-yapi.xml',
      'pdf-to-csv': 'pdf-tablo.csv',
      'pdf-to-xlsx': 'pdf-tablo.xlsx',
      'pdf-to-epub': 'pdf-kitap.epub',
      'pdf-to-cbz': 'pdf-sayfalar.cbz',
      'pdf-to-cbr': 'pdf-sayfalar.cbr',
      'extract-attachments': 'pdf-ekleri.zip',
      'extract-image-scans': 'tarama-gorselleri.zip',
      'verify-pdf': 'pdf-dogrulama.json'
    };
    return names[toolId] || 'output.pdf';
  }

  function syncGenericCheckboxFields(form, fd) {
    if (!state.currentTool || !state.currentTool.inputs) return;
    state.currentTool.inputs.forEach(function (input) {
      if (input.type !== 'checkbox' || !input.name) return;
      var el = form.querySelector('[name="' + input.name + '"]');
      if (el && el.type === 'checkbox') {
        fd.set(input.name, el.checked ? 'true' : 'false');
      }
    });
  }

  function onToolSubmit(e) {
    e.preventDefault();
    if (!state.currentTool) return;
    var form = e.target;
    var doDownload = !!form.querySelector('#outputDownload') && form.querySelector('#outputDownload').checked;
    var doSave = !!form.querySelector('#outputSaveDocuments') && form.querySelector('#outputSaveDocuments').checked;
    if (!doDownload && !doSave) {
      setToolStatus('En az bir çıktı seçeneği işaretleyin.', false);
      return;
    }
    if (form._pageSelectionFields && window.SecuriPages) {
      for (var psi = 0; psi < form._pageSelectionFields.length; psi++) {
        var pCfg = form._pageSelectionFields[psi];
        var pEl = form.querySelector('[name="' + pCfg.name + '"]');
        if (!pEl) continue;
        var pErr = window.SecuriPages.validate(pEl.value, {
          maxPages: form._pdfFileMeta && form._pdfFileMeta.pageCount,
          allowAll: pCfg.allowAll,
          minKeep: pCfg.minKeep
        });
        if (pErr) {
          setToolStatus(pErr, false);
          return;
        }
      }
    }
    if (state.currentTool.id === 'compress-pdf') {
      var visibleSize = form.querySelector('.compress-size-input');
      var sizeField = form.querySelector('input[name="expectedOutputSize"]');
      if (visibleSize && sizeField && sizeField.name === 'expectedOutputSize') {
        sizeField.value = visibleSize.value.trim();
      }
      if (sizeField && sizeField.name === 'expectedOutputSize' && !sizeField.value) {
        setToolStatus('Hedef dosya boyutu girin (örn. 10MB, 25KB).', false);
        return;
      }
    }
    if (state.currentTool.id === 'convert') {
      if (!form._convertGetFormats) {
        setToolStatus('Dönüştürme ayarları yüklenemedi.', false);
        return;
      }
      var convertFormats = form._convertGetFormats();
      if (!convertFormats.apiPath) {
        setToolStatus('Seçilen kaynak/hedef format çifti desteklenmiyor.', false);
        return;
      }
    }
    if (state.currentTool.id === 'ocr-pdf') {
      if (!form.querySelectorAll('input[name="languages"]:checked').length) {
        setToolStatus('En az bir OCR dili seçin.', false);
        return;
      }
    }
    if (state.currentTool.id === 'add-watermark') {
      var wmTypeVal = (form.querySelector('[name="watermarkType"]') || {}).value;
      if (wmTypeVal === 'text') {
        var wmText = ((form.querySelector('[name="watermarkText"]') || {}).value || '').trim();
        var wmDocNo = form.querySelector('#wmIncludeDocNumber');
        var includeDocNo = wmDocNo && wmDocNo.checked;
        if (!wmText && !includeDocNo) {
          setToolStatus('Filigran metni girin veya belge numarası seçeneğini işaretleyin.', false);
          return;
        }
      } else if (wmTypeVal === 'image') {
        var wmImg = form.querySelector('[name="watermarkImage"]');
        if (!wmImg || !wmImg.files || !wmImg.files.length) {
          setToolStatus('Filigran görseli seçin.', false);
          return;
        }
      }
    }
    if (state.currentTool.id === 'add-stamp') {
      var stTypeVal = (form.querySelector('[name="stampType"]') || {}).value;
      if (stTypeVal === 'text') {
        if (!((form.querySelector('[name="stampText"]') || {}).value || '').trim()) {
          setToolStatus('Damga metni girin.', false);
          return;
        }
      } else if (stTypeVal === 'image') {
        var stImg = form.querySelector('[name="stampImage"]');
        if (!stImg || !stImg.files || !stImg.files.length) {
          setToolStatus('Damga görseli seçin.', false);
          return;
        }
      }
    }
    if (state.currentTool.id === 'add-password') {
      if (!((form.querySelector('[name="password"]') || {}).value || '').trim()) {
        setToolStatus('Açma parolası girin.', false);
        return;
      }
    }
    if (state.currentTool.id === 'change-permissions') {
      if (!((form.querySelector('[name="ownerPassword"]') || {}).value || '').trim()) {
        setToolStatus('Sahip parolası girin.', false);
        return;
      }
    }
    if (state.currentTool.id === 'url-to-pdf') {
      var urlVal = ((form.querySelector('[name="urlInput"]') || {}).value || '').trim();
      if (!urlVal) {
        setToolStatus('Web adresi (URL) girin.', false);
        return;
      }
      if (!/^https?:\/\//i.test(urlVal)) {
        setToolStatus('URL http:// veya https:// ile başlamalıdır.', false);
        return;
      }
    }
    if (state.currentTool.id === 'add-image') {
      var addImgPdf = form.querySelector('[name="fileInput"]');
      var addImgFile = form.querySelector('[name="imageFile"]');
      if (!addImgPdf || !addImgPdf.files || !addImgPdf.files.length) {
        setToolStatus('PDF dosyası seçin.', false);
        return;
      }
      if (!addImgFile || !addImgFile.files || !addImgFile.files.length) {
        setToolStatus('Eklenecek görseli seçin.', false);
        return;
      }
    }
    if (state.currentTool.id === 'add-attachments') {
      var attPdf = form.querySelector('[name="fileInput"]');
      var attFiles = form.querySelector('[name="attachments"]');
      if (!attPdf || !attPdf.files || !attPdf.files.length) {
        setToolStatus('PDF dosyası seçin.', false);
        return;
      }
      if (!attFiles || !attFiles.files || !attFiles.files.length) {
        setToolStatus('En az bir ek dosya seçin.', false);
        return;
      }
    }
    if (state.currentTool.id === 'edit-table-of-contents') {
      var bmRaw = ((form.querySelector('[name="bookmarkData"]') || {}).value || '').trim();
      if (!bmRaw) {
        setToolStatus('Yer imi JSON verisi girin.', false);
        return;
      }
      try {
        var bmParsed = JSON.parse(bmRaw);
        if (!Array.isArray(bmParsed)) throw new Error('not array');
      } catch (e) {
        setToolStatus('Yer imi JSON geçerli bir dizi olmalıdır.', false);
        return;
      }
    }
    if (state.currentTool.id === 'merge-pdfs') {
      var mergeInput = form.querySelector('[name="fileInput"]');
      if (!mergeInput || !mergeInput.files || mergeInput.files.length < 2) {
        setToolStatus('Birleştirmek için en az 2 PDF seçin.', false);
        return;
      }
    }
    if (state.currentTool.id === 'rearrange-pages') {
      if (typeof form._validateRearrange === 'function') {
        var rearrErr = form._validateRearrange();
        if (rearrErr) {
          setToolStatus(rearrErr, false);
          return;
        }
      }
      var cm = (form.querySelector('[name="customMode"]') || {}).value;
      if (cm === 'CUSTOM') {
        var pn = ((form.querySelector('[name="pageNumbers"]') || {}).value || '').trim();
        if (!pn) {
          setToolStatus('Özel sıra için sayfa düzenini belirleyin.', false);
          return;
        }
      }
    }
    if (state.currentTool.id === 'add-page-numbers') {
      if (typeof form._validateAddPageNumbers === 'function') {
        var pnErr = form._validateAddPageNumbers();
        if (pnErr) {
          setToolStatus(pnErr, false);
          return;
        }
      }
    }
    if (state.currentTool.id === 'compare') {
      var cmp1 = form.querySelector('[name="fileInput1"]');
      var cmp2 = form.querySelector('[name="fileInput2"]');
      if (!cmp1 || !cmp1.files || !cmp1.files.length) {
        setToolStatus('Belge 1 (PDF) seçin.', false);
        return;
      }
      if (!cmp2 || !cmp2.files || !cmp2.files.length) {
        setToolStatus('Belge 2 (PDF) seçin.', false);
        return;
      }
    }
    if (state.currentTool.id === 'split-pages') {
      if (!form._splitGetConfig) {
        setToolStatus('Bölme ayarları yüklenemedi.', false);
        return;
      }
      var splitCfg = form._splitGetConfig();
      if (!splitCfg.apiPath) {
        setToolStatus('Seçilen bölme yöntemi desteklenmiyor.', false);
        return;
      }
      var splitErr = window.SecuriSplit && window.SecuriSplit.validateMode(splitCfg.modeId, form);
      if (splitErr) {
        setToolStatus(splitErr, false);
        return;
      }
    }
    if (state.currentTool.id === 'crop') {
      if (typeof form._validateCrop === 'function') {
        var cropErr = form._validateCrop();
        if (cropErr) {
          setToolStatus(cropErr, false);
          return;
        }
      }
    }
    if (state.currentTool.id === 'overlay-pdf') {
      var basePdf = form.querySelector('[name="fileInput"]');
      var overlays = form.querySelector('[name="overlayFiles"]');
      if (!basePdf || !basePdf.files || !basePdf.files.length) {
        setToolStatus('Ana PDF seçin.', false);
        return;
      }
      if (!overlays || !overlays.files || !overlays.files.length) {
        setToolStatus('En az bir katman PDF seçin.', false);
        return;
      }
    }
    if (state.currentTool.id === 'remove-password') {
      if (!((form.querySelector('[name="password"]') || {}).value || '').trim()) {
        setToolStatus('Mevcut parola girin.', false);
        return;
      }
    }
    if (state.currentTool.id === 'cert-sign') {
      var certType = (form.querySelector('[name="certType"]') || {}).value || 'PKCS12';
      if (certType === 'PKCS12') {
        var p12 = form.querySelector('[name="p12File"]');
        if (!p12 || !p12.files || !p12.files.length) {
          setToolStatus('PKCS#12 (.p12/.pfx) sertifika dosyası seçin.', false);
          return;
        }
      } else if (certType === 'PEM') {
        var pk = form.querySelector('[name="privateKeyFile"]');
        var cf = form.querySelector('[name="certFile"]');
        if (!pk || !pk.files || !pk.files.length || !cf || !cf.files || !cf.files.length) {
          setToolStatus('PEM için özel anahtar ve sertifika dosyası seçin.', false);
          return;
        }
      } else if (certType === 'JKS') {
        var jks = form.querySelector('[name="jksFile"]');
        if (!jks || !jks.files || !jks.files.length) {
          setToolStatus('Java Keystore (.jks) dosyası seçin.', false);
          return;
        }
      }
    }
    if (state.currentTool.id === 'auto-redact') {
      if (form._redactSyncSelection) form._redactSyncSelection();
      var selRaw = (form.querySelector('[name="redactSelection"]') || {}).value || '{"areas":[]}';
      var sel = { areas: [] };
      try { sel = JSON.parse(selRaw); } catch (e) { sel = { areas: [] }; }
      if (!sel.areas || !sel.areas.length) {
        setToolStatus('Karartılacak en az bir alan seçin, tarama yapın veya elle alan çizin.', false);
        return;
      }
    }
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    $('toolProgressWrap').hidden = false;
    setProgressBar('toolProgressBar', 5);
    setToolStatus('Kuyruğa alınıyor…', true);
    var fd = new FormData(form);
    syncGenericCheckboxFields(form, fd);
    if (state.currentTool.id === 'add-password' || state.currentTool.id === 'change-permissions') {
      [
        'preventPrinting', 'preventPrintingFaithful', 'preventModify', 'preventModifyAnnotations',
        'preventExtractContent', 'preventExtractForAccessibility', 'preventFillInForm', 'preventAssembly'
      ].forEach(function (name) {
        var el = form.querySelector('[name="' + name + '"]');
        if (el && el.type === 'checkbox') {
          fd.set(name, el.checked ? 'true' : 'false');
        }
      });
    }
    if (state.currentTool.id === 'cert-sign') {
      ['showSignature', 'showLogo'].forEach(function (name) {
        var el = form.querySelector('[name="' + name + '"]');
        if (el && el.type === 'checkbox') {
          fd.set(name, el.checked ? 'true' : 'false');
        }
      });
    }
    fd.append('tool_id', state.currentTool.id);
    if (state.currentTool.id === 'convert' && form._convertGetFormats) {
      fd.append('_apiPath', form._convertGetFormats().apiPath);
    }
    if (state.currentTool.id === 'split-pages' && form._splitGetConfig) {
      var splitCfgSubmit = form._splitGetConfig();
      fd.append('_apiPath', splitCfgSubmit.apiPath);
      function splitBool(name) {
        var el = form.querySelector('[name="' + name + '"]');
        return el && el.checked ? 'true' : 'false';
      }
      if (splitCfgSubmit.modeId === 'byChapters') {
        fd.set('includeMetadata', splitBool('includeMetadata'));
        fd.set('allowDuplicates', splitBool('allowDuplicates'));
      }
      if (splitCfgSubmit.modeId === 'bySections') {
        fd.set('merge', splitBool('merge'));
        if ((form.querySelector('[name="splitMode"]') || {}).value !== 'CUSTOM') {
          fd.delete('pageNumbers');
        }
      }
      if (splitCfgSubmit.modeId === 'byPageDivider') {
        fd.set('duplexMode', splitBool('duplexMode'));
      }
      if (splitCfgSubmit.modeId === 'byPoster') {
        fd.set('rightToLeft', splitBool('rightToLeft'));
      }
    }
    fetch(JOBS_API, {
      method: 'POST',
      body: fd,
      credentials: 'same-origin'
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) { throw new Error(formatHttpError(t, r.status)); });
      }
      return r.json();
    }).then(function (job) {
      setToolStatus('Merkezi kuyrukta işleniyor…', true);
      startJobsPoll(job.id);
      return pollJobUntilDone(job.id, function (j) {
        setProgressBar('toolProgressBar', j.progress || 0);
        var hint = (j.progress || 0) >= 40 && j.progress < 75
          ? ' — OCR çalışıyor, lütfen bekleyin…'
          : '';
        setToolStatus(jobStatusLabel(j.status) + ' (' + (j.progress || 0) + '%)' + hint, true);
      });
    }).then(function (job) {
      setProgressBar('toolProgressBar', 100);
      var tasks = [];
      if (doSave) {
        setToolStatus('Tamamlandı — belgelere kaydediliyor…', true);
        tasks.push(
          fetchJson(JOBS_API + '/' + encodeURIComponent(job.id) + '/import-documents', { method: 'POST' })
        );
      }
      if (doDownload) {
        tasks.push(
          fetch(JOBS_API + '/' + encodeURIComponent(job.id) + '/result', { credentials: 'same-origin' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var disp = r.headers.get('Content-Disposition');
            return r.blob().then(function (blob) {
              var fallback = downloadFallbackFilename(state.currentTool && state.currentTool.id);
              var name = filenameFromDisposition(disp, fallback);
              if (state.currentTool && state.currentTool.id === 'split-pages' && !/\.zip$/i.test(name)) {
                name = name.replace(/\.(pdf|html?)$/i, '') + '.zip';
              }
              if (state.currentTool && state.currentTool.id === 'pdf-to-img' && !/\.(zip|png|jpe?g|webp|tiff?)$/i.test(name)) {
                name = name.replace(/\.pdf$/i, '') + '.zip';
              }
              if (state.currentTool && state.currentTool.id === 'extract-images' && !/\.zip$/i.test(name)) {
                name = name.replace(/\.(pdf|html?)$/i, '') + '.zip';
              }
              return { blob: blob, name: name };
            });
          })
        );
      }
      return Promise.all(tasks);
    }).then(function (results) {
      var messages = ['Tamamlandı'];
      results.forEach(function (result) {
        if (result && result.blob) {
          var url = URL.createObjectURL(result.blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = result.name;
          a.click();
          URL.revokeObjectURL(url);
          messages.push('dosya indirildi');
        } else if (result && result.documentId) {
          messages.push('belgelere eklendi');
          if (result.documentGuid) {
            messages.push('belge no: ' + result.documentGuid);
          }
        }
      });
      setToolStatus(messages.join(' — ') + '.', true);
      loadJobs();
      if (doSave) loadDocuments();
    }).catch(function (err) {
      setToolStatus('Hata: ' + formatFetchError(err).slice(0, 300), false);
    }).finally(function () {
      btn.disabled = false;
    });
  }

  function saveProfile(e) {
    e.preventDefault();
    var body = {
      displayName: $('profileDisplayName').value.trim(),
      locale: $('profileLocale').value
    };
    fetchJson(APP + '/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function () {
      var st = $('profileStatus');
      st.hidden = false;
      st.className = 'status ok';
      st.textContent = 'Profil kaydedildi.';
      return loadMe();
    }).catch(function () {
      var st = $('profileStatus');
      st.hidden = false;
      st.className = 'status err';
      st.textContent = 'Kayıt başarısız.';
    });
  }

  function route() {
    var r = parseRoute();
    if (r.view === 'belgeler' || r.view === 'arsiv') {
      setActiveNav(r.view);
      showView(r.view);
      setupFilesView(r.scope || 'documents');
      return;
    }
    if (r.view === 'araclar') {
      setActiveNav('araclar');
      showView('araclar');
      if (r.toolId) {
        if (state.tools.length) selectTool(r.toolId, false);
      } else {
        closeToolWorkspace();
      }
      return;
    }
    if (r.view === 'favoriler') {
      setActiveNav('favoriler');
      showView('favoriler');
      return;
    }
    if (r.view === 'isler') {
      setActiveNav('isler');
      showView('isler');
      loadJobs();
      return;
    }
    if (r.view === 'profil') {
      setActiveNav('profil');
      showView('profil');
      fetchJson(VAULT + '/quota').then(function (q) {
        $('profileQuota').textContent = 'Depolama: ' + formatBytes(q.usedBytes) + ' / ' + formatBytes(q.maxBytes);
      }).catch(function () {});
      return;
    }
    location.hash = '#/belgeler';
  }

  function toggleUserMenu() {
    var dd = $('userDropdown');
    var open = dd.hidden;
    dd.hidden = !open;
    $('userMenuBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeUserMenu() {
    $('userDropdown').hidden = true;
    $('userMenuBtn').setAttribute('aria-expanded', 'false');
  }

  function bindOptional(id, event, handler) {
    var el = $(id);
    if (el) el.addEventListener(event, handler);
  }

  bindOptional('userMenuBtn', 'click', function (e) {
    e.stopPropagation();
    toggleUserMenu();
  });

  document.addEventListener('click', function () { closeUserMenu(); });

  bindOptional('btnLogout', 'click', function () {
    closeUserMenu();
    state.me = null;
    window.location.replace('/oauth2/sign_out?rd=' + encodeURIComponent('/'));
  });

  bindOptional('btnRefreshJobs', 'click', loadJobs);

  var toolForm = $('toolForm');
  if (toolForm) toolForm.addEventListener('submit', onToolSubmit);
  var profileForm = $('profileForm');
  if (profileForm) profileForm.addEventListener('submit', saveProfile);

  bindOptional('folderRoot', 'click', function () {
    state.folderId = null;
    $('folderRoot').classList.add('active');
    document.querySelectorAll('.folder-item').forEach(function (b) { b.classList.remove('active'); });
    loadDocuments();
  });

  bindOptional('btnCloseActivity', 'click', closeDocumentActivity);
  var docModal = $('docModal');
  if (docModal) {
    docModal.addEventListener('click', function (e) {
      if (e.target === docModal) closeDocumentActivity();
    });
  }
  document.addEventListener('keydown', function (e) {
    var modal = $('docModal');
    if (e.key === 'Escape' && modal && !modal.hidden) closeDocumentActivity();
  });

  bindOptional('btnNewFolder', 'click', createFolder);

  var docSearchInput = $('docSearchInput');
  if (docSearchInput) {
    docSearchInput.addEventListener('input', function () {
      state.docSearchQuery = docSearchInput.value.trim();
      scheduleDocSearch();
    });
    docSearchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        docSearchInput.value = '';
        state.docSearchQuery = '';
        loadDocuments();
      }
    });
  }

  bindOptional('btnBulkClear', 'click', clearDocSelection);
  bindOptional('btnBulkArchive', 'click', function () { bulkArchive(getSelectedDocIds()); });
  bindOptional('btnBulkRestore', 'click', function () { bulkRestore(getSelectedDocIds()); });
  bindOptional('btnBulkDelete', 'click', function () { bulkDelete(getSelectedDocIds()); });
  bindOptional('btnBulkPin', 'click', function () { bulkPin(getSelectedDocIds(), true); });
  bindOptional('btnBulkUnpin', 'click', function () { bulkPin(getSelectedDocIds(), false); });

  var fileUploadInput = $('fileUploadInput');
  if (fileUploadInput) {
    fileUploadInput.addEventListener('change', function () {
      if (this.files && this.files[0]) uploadFile(this.files[0]);
      this.value = '';
    });
  }

  window.addEventListener('hashchange', route);

  Promise.all([loadBranding(), loadMe(), loadLicense(), loadTools(), loadStorageConfig()]).then(function () {
    if (!location.hash || location.hash === '#/' || location.hash === '#') {
      location.replace('#/belgeler');
    }
    route();
  }).catch(function (err) {
    if (isAuthFetchError(err)) {
      redirectToLogin();
      return;
    }
    location.replace('#/belgeler');
    route();
  });
})();
