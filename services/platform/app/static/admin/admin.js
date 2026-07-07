(function () {
  const API = '/api/vault/v1/admin';

  async function api(path, options) {
    const res = await fetch(API + path, options);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) throw new Error(typeof data === 'string' ? data : (data.detail || res.statusText));
    return data;
  }

  function show(id, data) {
    document.getElementById(id).textContent = JSON.stringify(data, null, 2);
  }

  function val(id) {
    return document.getElementById(id).value.trim();
  }

  function num(id) {
    const n = parseInt(document.getElementById(id).value, 10);
    return isNaN(n) ? null : n;
  }

  var pendingPlatformLogo = null;
  var pendingCustomerLogo = null;

  var licenseCatalog = { tools: [] };
  var accessProfiles = [];
  var userAssignments = {};
  var selectedAccessProfileId = null;
  var accessProfileEditing = false;
  var selectedPackageId = null;

  function renderToolPicker(container, tools, selectedSet, opts) {
    opts = opts || {};
    var onlyLicensed = opts.onlyLicensed === true;
    var readOnly = !!opts.readOnly;
    var compact = !!opts.compact;
    if (typeof container === 'string') container = document.getElementById(container);
    if (!container) return;
    container.className = 'tool-picker' + (compact ? ' compact' : '');
    var byCat = {};
    (tools || []).forEach(function (t) {
      if (onlyLicensed && !t.licensed) return;
      var cat = t.categoryLabel || t.category || 'Diğer';
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(t);
    });
    container.innerHTML = '';
    Object.keys(byCat).sort().forEach(function (cat) {
      var group = document.createElement('div');
      group.className = 'tool-picker-group';
      var heading = document.createElement('h4');
      heading.textContent = cat;
      group.appendChild(heading);
      byCat[cat].forEach(function (t) {
        var label = document.createElement('label');
        label.className = 'tool-check' + (readOnly ? ' disabled' : '');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.setAttribute('data-tool-id', t.id);
        cb.checked = selectedSet.has(t.id);
        if (readOnly) cb.disabled = true;
        label.appendChild(cb);
        var span = document.createElement('span');
        span.innerHTML = (t.title || t.id) + ' <code>' + t.id + '</code>';
        label.appendChild(span);
        group.appendChild(label);
      });
      container.appendChild(group);
    });
  }

  function getSelectedFromPicker(containerId) {
    var root = document.getElementById(containerId);
    if (!root) return [];
    var ids = [];
    root.querySelectorAll('input[data-tool-id]:checked').forEach(function (cb) {
      ids.push(cb.getAttribute('data-tool-id'));
    });
    return ids;
  }

  function setPickerSelection(containerId, ids) {
    var set = new Set(ids || []);
    var root = document.getElementById(containerId);
    if (!root) return;
    root.querySelectorAll('input[data-tool-id]').forEach(function (cb) {
      cb.checked = set.has(cb.getAttribute('data-tool-id'));
    });
  }

  function fillLicenseFields(lic) {
    lic = lic || {};
    var keyEl = document.getElementById('licenseKey');
    if (!keyEl) return;
    keyEl.value = lic.license_key || '';
    document.getElementById('licenseExpires').value = lic.expires_at || '';
    var limits = lic.limits || {};
    document.getElementById('licenseMaxUsers').value = limits.max_users != null ? limits.max_users : '';
    document.getElementById('licenseMaxSessions').value = limits.max_concurrent_sessions != null ? limits.max_concurrent_sessions : '';
    var applyEl = document.getElementById('licenseApplyPackageLimits');
    if (applyEl) applyEl.checked = lic.apply_package_limits !== false;
    if (lic.package) selectedPackageId = lic.package;
  }

  function updateLicenseSummary(status) {
    if (!status) return;
    var pkgEl = document.getElementById('licenseSummaryPackage');
    if (!pkgEl) return;
    pkgEl.textContent = status.packageLabel || status.package || '—';
    var descEl = document.getElementById('licenseSummaryDesc');
    if (descEl) descEl.textContent = status.packageDescription || 'Paket seçin veya güncelleyin.';
    var toolsEl = document.getElementById('licenseSummaryTools');
    if (toolsEl) toolsEl.textContent = status.enabledToolCount != null ? status.enabledToolCount : (status.enabledTools || []).length;
    var expEl = document.getElementById('licenseSummaryExpiry');
    if (expEl) {
      var exp = status.expiresAt || status.expires_at;
      expEl.textContent = exp ? ('Bitiş: ' + formatDate(exp)) : 'Süresiz';
    }
    var validEl = document.getElementById('licenseSummaryValid');
    if (validEl) {
      if (status.valid) validEl.textContent = 'Geçerli';
      else if (status.expired) validEl.textContent = 'Süresi dolmuş';
      else validEl.textContent = 'Kontrol edin';
    }
  }

  function renderPackageCards(packages, currentId) {
    var el = document.getElementById('packageCards');
    if (!el) return;
    if (currentId) selectedPackageId = currentId;
    el.innerHTML = '';
    (packages || []).forEach(function (p) {
      var card = document.createElement('div');
      var selected = !!(p.selected || p.id === selectedPackageId);
      card.className = 'package-card' + (selected ? ' selected' : '');
      card.setAttribute('data-package', p.id);
      var meta = '<span>' + (p.toolCount || 0) + ' araç</span>';
      if (p.limits && p.limits.max_users) meta += '<span>' + p.limits.max_users + ' kullanıcı</span>';
      if (p.limits && p.limits.max_concurrent_sessions) meta += '<span>' + p.limits.max_concurrent_sessions + ' oturum</span>';
      card.innerHTML =
        (selected ? '<span class="package-card-badge">Seçili</span>' : '') +
        '<h3>' + (p.label || p.id) + '</h3>' +
        '<p>' + (p.description || '') + '</p>' +
        '<div class="package-card-meta">' + meta + '</div>';
      card.addEventListener('click', function () { applyPackage(p.id, p.label || p.id); });
      el.appendChild(card);
    });
  }

  async function applyPackage(packageId, label) {
    if (!confirm('"' + (label || packageId) + '" paketi uygulansın mı? Araç listesi ve limitler güncellenecek.')) return;
    try {
      var result = await api('/license/apply-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: packageId })
      });
      selectedPackageId = packageId;
      show('licenseResult', result);
      await loadLicensePanel();
    } catch (e) { alert(e.message); }
  }

  function renderLicenseToolPicker(tools, enabledSet) {
    renderToolPicker(
      document.getElementById('licenseToolPicker'),
      tools,
      enabledSet instanceof Set ? enabledSet : new Set(enabledSet || []),
      { onlyLicensed: false }
    );
  }

  async function loadLicensePanel() {
    try {
      var results = await Promise.all([
        api('/license/packages'),
        api('/tool-catalog'),
        api('/settings'),
        api('/license')
      ]);
      var pkgData = results[0];
      licenseCatalog = results[1];
      var settings = results[2];
      var status = results[3];
      fillLicenseFields((settings && settings.license) || {});
      updateLicenseSummary(status || (pkgData && pkgData.current) || {});
      renderPackageCards(pkgData.packages || [], (status && status.package) || selectedPackageId);
      var enabled = (settings.license && settings.license.enabled_tools) || status.enabledTools || [];
      renderLicenseToolPicker(licenseCatalog.tools || [], new Set(enabled));
      await loadAccessProfiles();
    } catch (e) {
      var pre = document.getElementById('licenseResult');
      if (pre) pre.textContent = e.message;
    }
  }

  async function ensureLicenseCatalog() {
    if (licenseCatalog.tools && licenseCatalog.tools.length) return;
    try {
      licenseCatalog = await api('/tool-catalog');
    } catch (e) { licenseCatalog = { tools: [] }; }
  }

  async function loadAccessProfiles() {
    await ensureLicenseCatalog();
    try {
      var data = await api('/tool-access-profiles');
      accessProfiles = data.profiles || [];
    } catch (e) {
      accessProfiles = [];
    }
    renderAccessProfileCards();
    fillAccessProfileSelects();
  }

  async function loadUserAssignments() {
    try {
      var data = await api('/users/tool-profile-assignments');
      userAssignments = data.byUser || {};
    } catch (e) {
      userAssignments = {};
    }
    renderAssignmentsList();
    fillAccessProfileSelects();
  }

  function fillAccessProfileSelects() {
    var html = '<option value="">— Lisans paketi (tam erişim) —</option>';
    accessProfiles.forEach(function (p) {
      html += '<option value="' + p.id + '">' + (p.label || p.id) + ' (' + (p.toolCount || 0) + ' araç)</option>';
    });
    document.querySelectorAll('.user-profile-select').forEach(function (sel) {
      var current = sel.value;
      sel.innerHTML = html;
      if (current) sel.value = current;
    });
    var assignSel = document.getElementById('assignProfileId');
    if (assignSel) {
      var keep = assignSel.value;
      assignSel.innerHTML = html;
      if (keep) assignSel.value = keep;
    }
  }

  function renderAccessProfileCards() {
    var el = document.getElementById('accessProfileCards');
    if (!el) return;
    el.innerHTML = '';
    if (!accessProfiles.length) {
      el.innerHTML = '<p class="hint package-loading">Henüz profil yok. «Yeni profil» ile oluşturun.</p>';
      return;
    }
    accessProfiles.forEach(function (p) {
      var card = document.createElement('div');
      var selected = p.id === selectedAccessProfileId;
      card.className = 'package-card' + (selected ? ' selected' : '');
      card.setAttribute('data-profile-id', p.id);
      var meta = '<span>' + (p.toolCount || 0) + ' araç</span>';
      if (p.userCount) meta += '<span>' + p.userCount + ' kullanıcı</span>';
      card.innerHTML =
        (selected ? '<span class="package-card-badge">Seçili</span>' : '') +
        '<h3>' + (p.label || p.id) + '</h3>' +
        '<p>' + (p.description || p.id) + '</p>' +
        '<div class="package-card-meta">' + meta + '</div>';
      card.addEventListener('click', function () { openAccessProfileEditor(p.id); });
      el.appendChild(card);
    });
  }

  function licensedToolsForPicker() {
    var tools = (licenseCatalog.tools || []).filter(function (t) { return t.licensed; });
    if (tools.length) return tools;
    return (licenseCatalog.tools || []).map(function (t) {
      return Object.assign({}, t, { licensed: true });
    });
  }

  function openAccessProfileEditor(profileId, isNew) {
    accessProfileEditing = !isNew;
    selectedAccessProfileId = profileId || null;
    renderAccessProfileCards();
    var editor = document.getElementById('accessProfileEditor');
    if (!editor) return;
    editor.hidden = false;
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });

    var idEl = document.getElementById('accessProfileId');
    var labelEl = document.getElementById('accessProfileLabel');
    var descEl = document.getElementById('accessProfileDesc');
    var metaEl = document.getElementById('accessProfileMeta');
    var titleEl = document.getElementById('accessProfileEditorTitle');
    var delBtn = document.getElementById('btnDeleteAccessProfile');

    if (isNew) {
      titleEl.textContent = 'Yeni profil';
      idEl.value = '';
      idEl.disabled = false;
      labelEl.value = '';
      descEl.value = '';
      metaEl.textContent = '';
      if (delBtn) delBtn.hidden = true;
      renderToolPicker(document.getElementById('accessProfileToolPicker'), licensedToolsForPicker(), new Set(), { onlyLicensed: true });
      return;
    }

    var prof = accessProfiles.find(function (p) { return p.id === profileId; });
    if (!prof) return;
    titleEl.textContent = 'Profil düzenle — ' + (prof.label || prof.id);
    idEl.value = prof.id;
    idEl.disabled = true;
    labelEl.value = prof.label || '';
    descEl.value = prof.description || '';
    metaEl.textContent = (prof.userCount || 0) + ' kullanıcı bu profile atanmış.';
    if (delBtn) delBtn.hidden = false;
    renderToolPicker(
      document.getElementById('accessProfileToolPicker'),
      licensedToolsForPicker(),
      new Set(prof.allowed_tools || []),
      { onlyLicensed: true }
    );
  }

  function closeAccessProfileEditor() {
    var editor = document.getElementById('accessProfileEditor');
    if (editor) editor.hidden = true;
    selectedAccessProfileId = null;
    renderAccessProfileCards();
  }

  async function saveAccessProfile() {
    var idRaw = val('accessProfileId').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    var label = val('accessProfileLabel');
    if (!idRaw || !label) return alert('Profil ID ve görünen ad zorunlu');
    var body = {
      label: label,
      description: val('accessProfileDesc') || undefined,
      allowed_tools: getSelectedFromPicker('accessProfileToolPicker')
    };
    try {
      if (accessProfileEditing && selectedAccessProfileId) {
        await api('/tool-access-profiles/' + encodeURIComponent(selectedAccessProfileId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } else {
        body.id = idRaw;
        await api('/tool-access-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        selectedAccessProfileId = idRaw;
      }
      document.getElementById('accessProfileResult').textContent = 'Profil kaydedildi.';
      await loadAccessProfiles();
      openAccessProfileEditor(selectedAccessProfileId, false);
    } catch (e) {
      document.getElementById('accessProfileResult').textContent = e.message;
    }
  }

  async function deleteAccessProfile() {
    if (!selectedAccessProfileId) return;
    if (!confirm('Profil silinsin mi: ' + selectedAccessProfileId + '?')) return;
    try {
      await api('/tool-access-profiles/' + encodeURIComponent(selectedAccessProfileId), { method: 'DELETE' });
      closeAccessProfileEditor();
      await loadAccessProfiles();
      await loadUserAssignments();
    } catch (e) { alert(e.message); }
  }

  function findUserAssignment(username) {
    if (!username) return null;
    var norm = String(username).trim().toLowerCase();
    if (userAssignments[norm]) return userAssignments[norm];
    return Object.keys(userAssignments).reduce(function (found, key) {
      if (found) return found;
      return key.trim().toLowerCase() === norm ? userAssignments[key] : null;
    }, null);
  }

  function accessProfileLabel(profileId) {
    if (!profileId) return null;
    var p = accessProfiles.find(function (x) { return x.id === profileId; });
    return p ? (p.label || p.id) : profileId;
  }

  function renderProfileBadge(username) {
    var pid = findUserAssignment(username);
    if (!pid) {
      return '<span class="profile-badge inherit" title="Lisans paketindeki tüm araçlar">Tam erişim</span>';
    }
    var label = accessProfileLabel(pid) || pid;
    return '<span class="profile-badge restrict" title="' + label + '">' + label + '</span>';
  }

  function renderProfileSelect(username) {
    var pid = findUserAssignment(username) || '';
    var html = '<select class="user-profile-select" data-user="' + username + '">';
    html += '<option value=""' + (!pid ? ' selected' : '') + '>Tam erişim</option>';
    accessProfiles.forEach(function (p) {
      html += '<option value="' + p.id + '"' + (pid === p.id ? ' selected' : '') + '>' + (p.label || p.id) + '</option>';
    });
    html += '</select>';
    return html;
  }

  function renderAssignmentsList() {
    var host = document.getElementById('userAssignmentsList');
    if (!host) return;
    var entries = Object.keys(userAssignments).sort();
    if (!entries.length) {
      host.innerHTML = '<p class="hint">Henüz kullanıcıya profil atanmadı.</p>';
      return;
    }
    host.innerHTML = entries.map(function (uid) {
      var pid = userAssignments[uid];
      return '<div class="profile-list-item">' +
        '<div><strong>' + uid + '</strong><span class="hint">' + (accessProfileLabel(pid) || pid) + '</span></div>' +
        '<button type="button" class="secondary btn-assign-edit" data-user="' + uid + '">Düzenle</button></div>';
    }).join('');
    host.querySelectorAll('.btn-assign-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var user = btn.getAttribute('data-user');
        document.getElementById('assignProfileUser').value = user;
        document.getElementById('assignProfileId').value = findUserAssignment(user) || '';
        document.getElementById('assignProfileUser').scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  async function saveUserAssignment(username, profileId) {
    await api('/users/' + encodeURIComponent(username) + '/tool-profile-assignment', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId || null })
    });
    await loadUserAssignments();
    await loadUsers();
  }

  function openUserAssignment(username) {
    if (!username) return;
    switchTab('users');
    document.getElementById('assignProfileUser').value = username;
    document.getElementById('assignProfileId').value = findUserAssignment(username) || '';
    document.getElementById('assignProfileResult').textContent = '';
    document.getElementById('assignProfileUser').scrollIntoView({ behavior: 'smooth' });
  }

  function setLogoPreview(elId, b64) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!b64) { el.innerHTML = ''; return; }
    const raw = String(b64);
    const src = raw.startsWith('data:') ? raw : 'data:image/png;base64,' + (raw.includes(',') ? raw.split(',')[1] : raw);
    el.innerHTML = '<img src="' + src + '" alt="logo">';
  }

  function fileToB64(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // Sekmeler
  document.querySelectorAll('#adminTabs .tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const tab = btn.getAttribute('data-tab');
      document.querySelectorAll('#adminTabs .tab').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('panel-' + tab).classList.add('active');
    });
  });

  function formatBytes(n) {
    if (!n && n !== 0) return '—';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var v = n;
    var u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
    return v.toFixed(u === 0 ? 0 : 1) + ' ' + units[u];
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('tr-TR'); } catch (e) { return iso; }
  }

  function esc(s) {
    if (s == null || s === '') return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function jobStatusBadge(status) {
    var labels = {
      queued: 'Kuyrukta',
      running: 'İşleniyor',
      completed: 'Tamamlandı',
      failed: 'Hata'
    };
    var label = labels[status] || status || '—';
    return '<span class="job-badge job-' + esc(status) + '">' + esc(label) + '</span>';
  }

  function formatAuditDetail(detail) {
    if (!detail || !Object.keys(detail).length) return '—';
    var s = JSON.stringify(detail);
    if (s.length > 96) s = s.slice(0, 93) + '…';
    return '<code class="detail-snippet">' + esc(s) + '</code>';
  }

  var auditPage = 1;
  var auditTotal = 0;
  var auditPageSize = 50;
  var jobsPage = 1;
  var jobsTotal = 0;
  var jobsPageSize = 50;

  function renderDashboard(data) {
    var health = data.health || {};
    var vault = health.vault || {};
    var disk = health.disk || {};
    var backups = health.backups || {};
    var lic = data.license || {};
    var jobs = data.jobs || {};
    var byStatus = jobs.byStatus || {};
    var jobSummary = jobs.summary || {};
    var setup = data.setup || {};
    var readiness = data.readiness || {};
    var profiles = data.accessProfiles || {};
    var progress = setup.progress || {};

    var grid = document.getElementById('dashStatGrid');
    if (grid) {
      grid.innerHTML =
        '<div class="dash-stat"><span class="dash-stat-label">Lisans</span><strong>' + esc(lic.packageLabel || lic.package || '—') + '</strong><span class="dash-stat-meta">' + (lic.valid ? 'Geçerli' : 'Süresi dolmuş') + ' · ' + (lic.enabledToolCount || 0) + ' araç</span></div>' +
        '<div class="dash-stat"><span class="dash-stat-label">Belgeler</span><strong>' + (vault.documents || 0) + '</strong><span class="dash-stat-meta">' + formatBytes(vault.totalUsedBytes) + ' kullanımda</span></div>' +
        '<div class="dash-stat"><span class="dash-stat-label">Disk boş</span><strong>%' + (disk.freePercent || 0) + '</strong><span class="dash-stat-meta">' + formatBytes(disk.freeBytes) + ' boş</span></div>' +
        '<div class="dash-stat"><span class="dash-stat-label">Yedekler</span><strong>' + (backups.count || 0) + '</strong><span class="dash-stat-meta">Son: ' + formatDate(backups.latestAt) + '</span></div>' +
        '<div class="dash-stat"><span class="dash-stat-label">Aktif iş</span><strong>' + ((byStatus.queued || 0) + (byStatus.running || 0)) + '</strong><span class="dash-stat-meta">Tamamlanan: ' + (byStatus.completed || 0) + '</span></div>' +
        '<div class="dash-stat"><span class="dash-stat-label">Son 24 saat</span><strong>' + (jobSummary.last24Hours || 0) + '</strong><span class="dash-stat-meta">Başarısız: ' + (jobSummary.failedLast24Hours || 0) + '</span></div>' +
        '<div class="dash-stat"><span class="dash-stat-label">Başarısız (toplam)</span><strong>' + (jobSummary.failed != null ? jobSummary.failed : (byStatus.failed || 0)) + '</strong><span class="dash-stat-meta">Son 7 gün: ' + (jobSummary.last7Days || 0) + ' iş</span></div>' +
        '<div class="dash-stat"><span class="dash-stat-label">Profiller</span><strong>' + (profiles.profileCount || 0) + '</strong><span class="dash-stat-meta">' + (profiles.assignmentCount || 0) + ' kullanıcı ataması</span></div>';
    }

    var setupSummary = document.getElementById('dashSetupSummary');
    if (setupSummary) {
      var setupOk = !!setup.complete;
      setupSummary.className = 'readiness-summary ' + (setupOk ? 'ready-ok' : 'ready-fail');
      setupSummary.textContent = setupOk
        ? 'Kurulum tamamlandı'
        : 'Kurulum: ' + (progress.done || 0) + ' / ' + (progress.total || 0) + ' adım';
    }

    var setupList = document.getElementById('dashSetupList');
    if (setupList) {
      setupList.innerHTML = '';
      (data.setupChecks || []).forEach(function (c) {
        var li = document.createElement('li');
        li.className = 'readiness-item ' + (c.ok ? 'ok' : 'fail');
        li.innerHTML = '<span class="readiness-icon">' + (c.ok ? '✓' : '○') + '</span><span>' + esc(c.label) + '</span>';
        setupList.appendChild(li);
      });
    }

    var readSummary = document.getElementById('dashReadinessSummary');
    if (readSummary) {
      var prodOk = !!readiness.ready;
      readSummary.className = 'readiness-summary ' + (prodOk ? 'ready-ok' : 'ready-fail');
      readSummary.textContent = prodOk
        ? 'Prod hazırlık: kritik kontroller geçti'
        : 'Prod hazırlık: ' + (readiness.criticalFailures || 0) + ' kritik, ' + (readiness.warningFailures || 0) + ' uyarı';
    }

    var readHint = document.getElementById('dashReadinessHint');
    if (readHint) {
      readHint.textContent = prodOk
        ? 'Ayrıntılar için Operasyon sekmesindeki hazırlık listesine bakın.'
        : 'Operasyon sekmesinden eksik maddeleri tamamlayın.';
    }

    var jobsBody = document.getElementById('dashActiveJobsBody');
    if (jobsBody) {
      var active = jobs.active || [];
      if (!active.length) {
        jobsBody.innerHTML = '<tr><td colspan="6" class="muted-cell">Aktif iş yok.</td></tr>';
      } else {
        jobsBody.innerHTML = active.map(function (j) {
          return '<tr>' +
            '<td><code>' + esc(j.id) + '</code></td>' +
            '<td>' + esc(j.userId) + '</td>' +
            '<td>' + esc(j.toolId) + '</td>' +
            '<td>' + jobStatusBadge(j.status) + '</td>' +
            '<td>' + (j.progress != null ? j.progress + '%' : '—') + '</td>' +
            '<td>' + formatDate(j.createdAt) + '</td>' +
            '</tr>';
        }).join('');
      }
    }

    var topTools = document.getElementById('dashTopTools');
    if (topTools) {
      var tools = jobs.topTools || [];
      if (!tools.length) {
        topTools.innerHTML = '<li class="hint">Henüz iş kaydı yok.</li>';
      } else {
        topTools.innerHTML = tools.map(function (t) {
          return '<li><code>' + esc(t.toolId) + '</code><span>' + t.count + ' iş</span></li>';
        }).join('');
      }
    }
  }

  async function loadDashboard() {
    try {
      var data = await api('/ops/dashboard');
      var setupData = await api('/ops/setup-checklist');
      data.setupChecks = (setupData.checks || []).filter(function (c) { return !c.ok; }).slice(0, 6);
      if (!data.setupChecks.length && setupData.checks) {
        data.setupChecks = setupData.checks.slice(0, 4);
      }
      renderDashboard(data);
      try {
        var ver = await api('/ops/version');
        var grid = document.getElementById('dashStatGrid');
        if (grid && ver && ver.version) {
          grid.innerHTML += '<div class="dash-stat"><span class="dash-stat-label">Sürüm</span><strong class="stat-small">' +
            esc(ver.version) + '</strong><span class="dash-stat-meta">UI v' + esc(String(ver.platformUiVersion || '—')) + '</span></div>';
        }
      } catch (verErr) { /* optional */ }
    } catch (e) {
      var grid = document.getElementById('dashStatGrid');
      if (grid) grid.innerHTML = '<p class="hint">' + esc(e.message) + '</p>';
    }
  }

  function updatePager(prefix, page, total, pageSize) {
    var pager = document.getElementById(prefix + 'Pager');
    var info = document.getElementById(prefix + 'PageInfo');
    var pages = Math.max(1, Math.ceil(total / pageSize));
    if (!pager || !info) return;
    if (total <= pageSize) {
      pager.hidden = true;
      return;
    }
    pager.hidden = false;
    info.textContent = 'Sayfa ' + page + ' / ' + pages + ' (' + total + ' kayıt)';
    var prev = document.getElementById(prefix + 'Prev');
    var next = document.getElementById(prefix + 'Next');
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= pages;
  }

  function renderAuditTable(data) {
    auditTotal = data.total || 0;
    var tbody = document.getElementById('auditTableBody');
    var summary = document.getElementById('auditSummary');
    if (!tbody) return;
    var items = data.items || [];
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted-cell">Kayıt bulunamadı.</td></tr>';
    } else {
      tbody.innerHTML = items.map(function (row) {
        var userCell = row.userLabel && row.userLabel !== row.userId
          ? esc(row.userLabel) + ' <span class="muted-inline">(' + esc(row.userId) + ')</span>'
          : esc(row.userLabel || row.userId);
        return '<tr>' +
          '<td class="nowrap">' + formatDate(row.timestamp) + '</td>' +
          '<td>' + userCell + '</td>' +
          '<td><code>' + esc(row.action) + '</code></td>' +
          '<td><code>' + esc(row.resource) + '</code></td>' +
          '<td>' + formatAuditDetail(row.detail) + '</td>' +
          '</tr>';
      }).join('');
    }
    if (summary) summary.textContent = items.length + ' kayıt gösteriliyor (toplam ' + auditTotal + ')';
    updatePager('audit', auditPage, auditTotal, auditPageSize);
  }

  async function loadAudit(page) {
    auditPage = page || 1;
    var qs = new URLSearchParams();
    if (val('auditUserId')) qs.set('userId', val('auditUserId'));
    if (val('auditAction')) qs.set('action', val('auditAction'));
    if (val('auditActionPrefix')) qs.set('actionPrefix', val('auditActionPrefix'));
    if (val('auditFrom')) qs.set('from', val('auditFrom'));
    if (val('auditTo')) qs.set('to', val('auditTo'));
    qs.set('page', String(auditPage));
    qs.set('size', String(auditPageSize));
    try {
      renderAuditTable(await api('/audit?' + qs.toString()));
    } catch (e) { alert(e.message); }
  }

  function buildAuditExportQuery() {
    var qs = new URLSearchParams();
    if (val('auditUserId')) qs.set('userId', val('auditUserId'));
    if (val('auditAction')) qs.set('action', val('auditAction'));
    if (val('auditActionPrefix')) qs.set('actionPrefix', val('auditActionPrefix'));
    if (val('auditFrom')) qs.set('from', val('auditFrom'));
    if (val('auditTo')) qs.set('to', val('auditTo'));
    return qs;
  }

  async function exportAuditCsv() {
    try {
      var res = await fetch(API + '/audit/export?' + buildAuditExportQuery().toString(), { credentials: 'same-origin' });
      if (!res.ok) throw new Error('CSV indirilemedi (' + res.status + ')');
      var blob = await res.blob();
      var a = document.createElement('a');
      var url = URL.createObjectURL(blob);
      a.href = url;
      a.download = 'securipdf-audit.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { alert(e.message); }
  }

  var quotaPage = 1;
  var quotaTotal = 0;
  var quotaPageSize = 50;

  function renderQuotaUsageBar(pct) {
    var level = pct >= 90 ? 'danger' : (pct >= 75 ? 'warn' : '');
    var width = Math.min(100, Math.max(0, pct));
    return '<div class="quota-usage-cell"><div class="quota-usage-bar ' + level + '"><span style="width:' + width + '%"></span></div><span class="quota-pct">' + pct + '%</span></div>';
  }

  function renderQuotaTable(data) {
    quotaTotal = data.total || 0;
    var tbody = document.getElementById('quotaTableBody');
    var summary = document.getElementById('quotaListSummary');
    var defaultHint = document.getElementById('quotaDefaultHint');
    if (defaultHint && data.defaultMaxBytes) defaultHint.textContent = formatBytes(data.defaultMaxBytes);
    if (!tbody) return;
    var items = data.items || [];
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted-cell">Kayıt yok. Kullanıcı belge yükledikçe listede görünür.</td></tr>';
    } else {
      tbody.innerHTML = items.map(function (row) {
        return '<tr>' +
          '<td><button type="button" class="linkish quota-user-pick" data-user="' + esc(row.userId) + '">' + esc(row.userId) + '</button></td>' +
          '<td>' + formatBytes(row.usedBytes) + '</td>' +
          '<td>' + formatBytes(row.maxBytes) + '</td>' +
          '<td>' + renderQuotaUsageBar(row.usagePercent || 0) + '</td>' +
          '<td><button type="button" class="secondary quota-edit-btn" data-user="' + esc(row.userId) + '" data-max="' + row.maxBytes + '">Düzenle</button></td>' +
          '</tr>';
      }).join('');
      tbody.querySelectorAll('.quota-user-pick, .quota-edit-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var user = btn.getAttribute('data-user');
          document.getElementById('quotaUserId').value = user;
          if (btn.classList.contains('quota-edit-btn')) {
            document.getElementById('quotaMaxBytes').value = btn.getAttribute('data-max') || '';
            document.getElementById('quotaMaxMb').value = '';
          }
          document.getElementById('quotaUserId').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
    }
    if (summary) summary.textContent = items.length + ' kayıt (toplam ' + quotaTotal + ')';
    updatePager('quota', quotaPage, quotaTotal, quotaPageSize);
  }

  async function loadQuotaList(page) {
    quotaPage = page || 1;
    var qs = new URLSearchParams();
    if (val('quotaSearch')) qs.set('search', val('quotaSearch'));
    qs.set('page', String(quotaPage));
    qs.set('size', String(quotaPageSize));
    try {
      renderQuotaTable(await api('/quotas?' + qs.toString()));
    } catch (e) {
      var tbody = document.getElementById('quotaTableBody');
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="muted-cell">' + esc(e.message) + '</td></tr>';
    }
  }

  function renderJobsTable(data) {
    jobsTotal = data.total || 0;
    var tbody = document.getElementById('jobsTableBody');
    var summary = document.getElementById('jobsSummary');
    if (!tbody) return;
    var items = data.items || [];
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="muted-cell">Kayıt bulunamadı.</td></tr>';
    } else {
      tbody.innerHTML = items.map(function (j) {
        var userCell = j.userLabel && j.userLabel !== j.userId
          ? esc(j.userLabel) + ' <span class="muted-inline">(' + esc(j.userId) + ')</span>'
          : esc(j.userLabel || j.userId);
        return '<tr>' +
          '<td><code>' + esc(j.id) + '</code></td>' +
          '<td><code>' + esc(j.reportId || '—') + '</code></td>' +
          '<td>' + userCell + '</td>' +
          '<td>' + esc(j.toolId) + '</td>' +
          '<td>' + jobStatusBadge(j.status) + '</td>' +
          '<td>' + (j.progress != null ? j.progress + '%' : '—') + '</td>' +
          '<td class="nowrap">' + formatDate(j.createdAt) + '</td>' +
          '<td class="nowrap">' + formatDate(j.completedAt) + '</td>' +
          '<td>' + esc(j.errorCode || '—') + '</td>' +
          '</tr>';
      }).join('');
    }
    if (summary) {
      summary.textContent = items.length + ' kayıt gösteriliyor (toplam ' + jobsTotal + '). ' + (data.privacyNote || '');
    }
    updatePager('jobs', jobsPage, jobsTotal, jobsPageSize);
  }

  async function loadJobs(page) {
    jobsPage = page || 1;
    var qs = new URLSearchParams();
    if (val('jobsUserId')) qs.set('userId', val('jobsUserId'));
    if (val('jobsStatus')) qs.set('status', val('jobsStatus'));
    if (val('jobsToolId')) qs.set('toolId', val('jobsToolId'));
    if (val('jobsReportId')) qs.set('reportId', val('jobsReportId'));
    qs.set('page', String(jobsPage));
    qs.set('size', String(jobsPageSize));
    try {
      renderJobsTable(await api('/jobs?' + qs.toString()));
    } catch (e) { alert(e.message); }
  }

  function fillDeployment(data) {
    var dep = (data && data.deployment) || {};
    document.getElementById('deployEnvironment').value = dep.environment || 'dev';
    document.getElementById('deployRetention').value = dep.backup_retention_days || 30;
    document.getElementById('deployNotes').value = dep.notes || '';
    document.getElementById('deployServerIp').value = dep.server_ip || '';
    document.getElementById('deployPublicFqdn').value = dep.public_fqdn || '';
    document.getElementById('deployKeycloakFqdn').value = dep.keycloak_fqdn || '';
    document.getElementById('deployUseHttps').checked = !!dep.use_https;
    var urls = dep.access_urls || {};
    var urlEl = document.getElementById('deployAccessUrls');
    if (urlEl) {
      urlEl.textContent = [
        'Uygulama (FQDN):     ' + (urls.app_url || '—'),
        'Uygulama (IP):       ' + (urls.app_url_ip || '—'),
        'OAuth callback:      ' + (urls.oauth_callback_url || '—'),
        'OAuth issuer:        ' + (urls.oauth_issuer_url || '—'),
        'Keycloak admin:      ' + (urls.keycloak_admin_url || '—'),
        'Cikis:               ' + (urls.sign_out_url || '—')
      ].join('\n');
    }
  }

  function renderHealthCards(data) {
    var el = document.getElementById('opsHealthCards');
    if (!data) {
      el.innerHTML = '<p class="hint">Veri alinamadi</p>';
      return;
    }
    var vault = data.vault || {};
    var disk = data.disk || {};
    var backups = data.backups || {};
    el.innerHTML =
      '<div class="stat-card"><span class="stat-label">Belgeler</span><strong>' + (vault.documents || 0) + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">Kullanilan alan</span><strong>' + formatBytes(vault.totalUsedBytes) + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">Disk bos</span><strong>%' + (disk.freePercent || 0) + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">Yedek sayisi</span><strong>' + (backups.count || 0) + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">Soft-delete</span><strong>' + (vault.softDeletedRecords || 0) + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">Son yedek</span><strong class="stat-small">' + formatDate(backups.latestAt) + '</strong></div>';
    show('opsHealthDetail', data);
  }

  function switchTab(tab) {
    document.querySelectorAll('#adminTabs .tab').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
    var btn = document.querySelector('#adminTabs .tab[data-tab="' + tab + '"]');
    if (btn) btn.classList.add('active');
    var panel = document.getElementById('panel-' + tab);
    if (panel) panel.classList.add('active');
  }

  function renderSetupChecklist(data) {
    var card = document.getElementById('setupChecklistCard');
    var summary = document.getElementById('setupProgressSummary');
    var list = document.getElementById('setupChecklistList');
    var banner = document.getElementById('setupBanner');
    if (!data || !summary || !list) return;

    var prog = data.progress || { done: 0, total: 0 };
    var complete = !!data.complete;
    summary.className = 'readiness-summary ' + (complete ? 'ready-ok' : 'ready-fail');
    summary.textContent = complete
      ? 'Kurulum tamamlandi (' + prog.done + '/' + prog.total + ')'
      : 'Kurulum devam ediyor: ' + prog.done + ' / ' + prog.total + ' adim';

    if (card) card.classList.toggle('complete', complete);
    if (banner) banner.classList.toggle('hidden', complete);

    list.innerHTML = '';
    (data.checks || []).forEach(function (c) {
      var li = document.createElement('li');
      li.className = 'readiness-item ' + (c.ok ? 'ok' : 'fail');
      var actions = '';
      if (!c.ok && c.tab) {
        actions += '<button type="button" class="secondary setup-goto" data-tab="' + c.tab + '">Git</button>';
      }
      if (!c.ok && c.manual) {
        actions += '<button type="button" class="secondary setup-ack" data-step="' + c.id + '">Tamamlandi</button>';
      }
      li.innerHTML =
        '<span class="readiness-icon">' + (c.ok ? '✓' : '○') + '</span>' +
        '<div><strong>' + c.label + '</strong>' +
        (c.hint ? '<div class="hint">' + c.hint + '</div>' : '') +
        (actions ? '<div class="setup-actions">' + actions + '</div>' : '') +
        '</div>';
      list.appendChild(li);
    });

    list.querySelectorAll('.setup-goto').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.getAttribute('data-tab'));
      });
    });
    list.querySelectorAll('.setup-ack').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        try {
          await api('/ops/setup/acknowledge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step: btn.getAttribute('data-step') })
          });
          await loadSetupChecklist();
        } catch (e) { alert(e.message); }
      });
    });
  }

  async function loadSetupChecklist() {
    try {
      renderSetupChecklist(await api('/ops/setup-checklist'));
    } catch (e) {
      var summary = document.getElementById('setupProgressSummary');
      if (summary) summary.textContent = e.message;
    }
  }

  function renderReadiness(data) {
    var summary = document.getElementById('opsReadinessSummary');
    var list = document.getElementById('opsReadinessList');
    var note = document.getElementById('opsHostBackupNote');
    if (!data) return;
    var cls = data.ready ? 'ready-ok' : 'ready-fail';
    summary.className = 'readiness-summary ' + cls;
    summary.textContent = data.ready
      ? 'Prod icin kritik kontroller gecti (' + data.warningFailures + ' uyari)'
      : data.criticalFailures + ' kritik madde basarisiz, ' + data.warningFailures + ' uyari';
    list.innerHTML = '';
    (data.checks || []).forEach(function (c) {
      var li = document.createElement('li');
      li.className = 'readiness-item ' + (c.ok ? 'ok' : 'fail') + ' sev-' + (c.severity || 'info');
      li.innerHTML =
        '<span class="readiness-icon">' + (c.ok ? '✓' : '✗') + '</span>' +
        '<div><strong>' + c.label + '</strong>' +
        (c.hint ? '<div class="hint">' + c.hint + '</div>' : '') + '</div>';
      list.appendChild(li);
    });
    note.textContent = data.hostBackupNote || '';
  }

  function renderBackups(items) {
    var tbody = document.getElementById('backupsTableBody');
    tbody.innerHTML = '';
    (items || []).forEach(function (b) {
      var tr = document.createElement('tr');
      var size = b.archiveBytes || b.folderBytes || 0;
      tr.innerHTML =
        '<td><code>' + b.id + '</code></td>' +
        '<td>' + (b.label || '—') + '</td>' +
        '<td>' + formatDate(b.createdAt) + '</td>' +
        '<td>' + ((b.stats && b.stats.documents) || 0) + '</td>' +
        '<td>' + formatBytes(size) + '</td>' +
        '<td class="backup-actions">' +
          '<button type="button" class="secondary btn-dl" data-id="' + b.id + '">Indir</button>' +
          '<button type="button" class="secondary btn-use-restore" data-id="' + b.id + '">Geri yukle</button>' +
          '<button type="button" class="danger btn-del" data-id="' + b.id + '">Sil</button>' +
        '</td>';
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.btn-dl').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.location.href = API + '/ops/backups/' + encodeURIComponent(btn.getAttribute('data-id')) + '/download';
      });
    });
    tbody.querySelectorAll('.btn-use-restore').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        document.getElementById('restoreBackupId').value = id;
        document.getElementById('restoreConfirm').value = id;
        document.getElementById('restoreConfirm').focus();
      });
    });
    tbody.querySelectorAll('.btn-del').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-id');
        if (!confirm('Yedek silinsin mi: ' + id + '?')) return;
        try {
          show('backupResult', await api('/ops/backups/' + encodeURIComponent(id), { method: 'DELETE' }));
          await loadBackups();
        } catch (e) { alert(e.message); }
      });
    });
  }

  async function loadHealth() {
    try {
      renderHealthCards(await api('/ops/health'));
    } catch (e) {
      document.getElementById('opsHealthCards').innerHTML = '<p class="hint">' + e.message + '</p>';
    }
  }

  async function loadReadiness() {
    try {
      renderReadiness(await api('/ops/readiness'));
    } catch (e) {
      document.getElementById('opsReadinessSummary').textContent = e.message;
    }
  }

  async function loadBackups() {
    try {
      var data = await api('/ops/backups');
      renderBackups(data.items || []);
    } catch (e) { alert(e.message); }
  }

  var upgradeJobPollTimer = null;
  var lastUpgradeState = null;

  function renderUpdaterStatus(updater, webAvailable) {
    var el = document.getElementById('opsUpdaterStatus');
    var applyBtn = document.getElementById('btnUpgradeApply');
    if (!el) return;
    var cfg = updater && updater.configured;
    var reach = updater && updater.reachable;
    var st = (updater && updater.status) || {};
    var err = updater && updater.error;
    el.innerHTML =
      '<div class="stat-card"><span class="stat-label">Updater yapılandırma</span><strong>' + (cfg ? 'Token var' : 'Yok') + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">Agent erişimi</span><strong>' + (reach ? 'Erişilebilir' : 'Kapalı') + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">Image arşivi</span><strong>' + (st.imagesTarExists ? 'Mevcut' : 'Yok') + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">Docker</span><strong>' + (st.dockerOk ? 'OK' : 'Hata') + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">Web güncelleme</span><strong>' + (webAvailable ? 'Hazır' : 'Hazır değil') + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">Offline dizin</span><strong class="stat-small">' + esc(st.offlineDir || '—') + '</strong></div>';
    if (applyBtn) {
      applyBtn.disabled = !webAvailable;
      applyBtn.title = webAvailable ? '' : (err || 'Ön koşullar sağlanmadı — ön kontrol çalıştırın');
    }
  }

  function renderPreflightChecks(checks) {
    var list = document.getElementById('opsPreflightList');
    if (!list) return;
    list.innerHTML = '';
    (checks || []).forEach(function (c) {
      var li = document.createElement('li');
      li.className = 'readiness-item ' + (c.ok ? 'ok' : 'fail');
      li.innerHTML =
        '<span class="readiness-icon">' + (c.ok ? '✓' : '✗') + '</span>' +
        '<span>' + esc(c.label || c.id) + (c.hint ? ' — ' + esc(c.hint) : '') + '</span>';
      list.appendChild(li);
    });
  }

  function renderUpgradeJob(job) {
    var logEl = document.getElementById('opsUpgradeJobLog');
    var resEl = document.getElementById('opsUpgradeJobResult');
    if (!job) return;
    if (logEl) logEl.textContent = (job.log || []).join('\n');
    if (resEl) {
      resEl.textContent = JSON.stringify({
        id: job.id,
        status: job.status,
        exitCode: job.exitCode,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        error: job.error
      }, null, 2);
    }
  }

  function stopUpgradeJobPoll() {
    if (upgradeJobPollTimer) {
      clearInterval(upgradeJobPollTimer);
      upgradeJobPollTimer = null;
    }
  }

  function startUpgradeJobPoll(jobId) {
    stopUpgradeJobPoll();
    if (!jobId) return;
    async function poll() {
      try {
        var data = await api('/ops/upgrade/jobs/' + encodeURIComponent(jobId));
        var job = data.job || data;
        renderUpgradeJob(job);
        if (job.status === 'succeeded' || job.status === 'failed') {
          stopUpgradeJobPoll();
          await loadVersionUpgrade();
        }
      } catch (e) {
        stopUpgradeJobPoll();
      }
    }
    poll();
    upgradeJobPollTimer = setInterval(poll, 3000);
  }

  function renderVersionUpgrade(installed, upgrade) {
    lastUpgradeState = upgrade;
    var grid = document.getElementById('opsVersionGrid');
    var summary = document.getElementById('opsUpgradeSummary');
    var detail = document.getElementById('opsUpgradeDetail');
    if (!grid || !summary || !detail) return;

    grid.innerHTML =
      '<div class="stat-card"><span class="stat-label">SecuriPDF</span><strong class="stat-small">' + esc(installed.version || '—') + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">Stirling</span><strong>' + esc(installed.stirlingVersion || '—') + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">UI (app.js)</span><strong>v' + esc(String(installed.platformUiVersion || '—')) + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">Ortam</span><strong>' + esc((installed.access && installed.access.environment) || '—') + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">FQDN</span><strong class="stat-small">' + esc((installed.access && installed.access.publicFqdn) || '—') + '</strong></div>' +
      '<div class="stat-card"><span class="stat-label">oauth2-proxy</span><strong class="stat-small">' + esc((installed.oauth2ProxyImage || '').split(':').pop() || '—') + '</strong></div>';

    var avail = upgrade && upgrade.available;
    var webReady = upgrade && upgrade.webUpgradeAvailable;
    summary.className = 'readiness-summary ' + (avail ? (webReady ? 'ready-ok' : 'ready-fail') : 'ready-ok');
    if (webReady) {
      summary.textContent = 'Web güncelleme hazır: ' + (upgrade.stagingVersion || '');
    } else if (avail) {
      summary.textContent = 'Güncelleme mevcut (CLI veya updater ön koşulları): ' + (upgrade.stagingVersion || '');
    } else {
      summary.textContent = (upgrade && upgrade.reason) ? upgrade.reason : 'Güncelleme bilgisi yok';
    }

    var staging = (upgrade && upgrade.staging) || {};
    var updater = (upgrade && upgrade.updater) || {};
    var ust = updater.status || {};
    detail.textContent = [
      'Kurulu sürüm:        ' + (installed.version || '—'),
      'Platform image:      ' + (installed.platformImage || '—'),
      'Keycloak image:      ' + (installed.keycloakImage || '—'),
      'Build:               ' + (installed.builtAt || '—'),
      '',
      'Staging sürüm:       ' + (upgrade.stagingVersion || '—'),
      'Staging changelog:   ' + (staging.changelog || '—'),
      'Staging yolu:        ' + (staging.path || upgrade.stagingPath || '—'),
      '',
      'Staging kayıt:       ' + (upgrade.registerHint || '—'),
      'CLI güncelleme:      ' + (upgrade.cliUpgrade || '—'),
      '',
      'Updater agent:       ' + (updater.reachable ? 'erişilebilir' : (updater.error || 'yapılandırılmamış')),
      'Image arşivi:        ' + (ust.imagesTarExists ? 'mevcut' : 'yok'),
      'Web güncelleme:      ' + (webReady ? 'hazır' : 'hazır değil')
    ].join('\n');

    renderUpdaterStatus(updater, !!webReady);
  }

  async function loadVersionUpgrade() {
    try {
      var installed = await api('/ops/version');
      var upgrade = await api('/ops/upgrade/available');
      renderVersionUpgrade(installed, upgrade);
    } catch (e) {
      var grid = document.getElementById('opsVersionGrid');
      var msg = e.message || String(e);
      if (msg === 'Not Found') {
        msg = 'Sürüm API yanıt vermiyor (404). Platform image güncel değil — sunucuda: cd ~/SecuriPDF && git pull && sudo bash scripts/patch-logout-deploy.sh';
      }
      if (grid) grid.innerHTML = '<p class="hint">' + esc(msg) + '</p>';
    }
  }

  function loadOpsPanel() {
    loadVersionUpgrade();
    loadHealth();
    loadReadiness();
    loadBackups();
  }

  document.getElementById('btnRefreshHealth').addEventListener('click', loadHealth);
  document.getElementById('btnRefreshReadiness').addEventListener('click', loadReadiness);
  document.getElementById('btnRefreshBackups').addEventListener('click', loadBackups);
  document.getElementById('btnRefreshVersion').addEventListener('click', loadVersionUpgrade);

  document.getElementById('btnUpgradePreflight').addEventListener('click', async function () {
    var btn = document.getElementById('btnUpgradePreflight');
    btn.disabled = true;
    try {
      var result = await api('/ops/upgrade/preflight', { method: 'POST' });
      renderPreflightChecks(result.checks || []);
      show('opsUpgradeJobResult', result);
      if (result.status) {
        renderUpdaterStatus({ configured: true, reachable: true, status: result.status }, !!(lastUpgradeState && lastUpgradeState.webUpgradeAvailable));
      }
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btnUpgradeApply').addEventListener('click', async function () {
    if (!lastUpgradeState || !lastUpgradeState.webUpgradeAvailable) {
      return alert('Web güncelleme hazır değil — staging manifest, updater agent ve image arşivi gerekli.');
    }
    if (!window.confirm('Host üzerinde upgrade-offline-stack.sh çalıştırılacak. Devam?')) return;
    var btn = document.getElementById('btnUpgradeApply');
    btn.disabled = true;
    try {
      var data = await api('/ops/upgrade/apply', { method: 'POST' });
      var job = data.job || data;
      renderUpgradeJob(job);
      show('opsUpgradeJobResult', job);
      startUpgradeJobPoll(job.id);
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = !(lastUpgradeState && lastUpgradeState.webUpgradeAvailable);
    }
  });

  document.getElementById('btnSaveStagingManifest').addEventListener('click', async function () {
    var raw = document.getElementById('upgradeStagingJson').value.trim();
    if (!raw) return alert('MANIFEST JSON gerekli');
    try {
      var manifest = JSON.parse(raw);
      var result = await api('/ops/upgrade/staging', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest)
      });
      show('upgradeStagingResult', result);
      await loadVersionUpgrade();
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnSaveDeployment').addEventListener('click', async () => {
    try {
      var data = await api('/settings/deployment', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environment: document.getElementById('deployEnvironment').value,
          backup_retention_days: parseInt(document.getElementById('deployRetention').value, 10) || 30,
          notes: val('deployNotes') || undefined,
          server_ip: val('deployServerIp') || undefined,
          public_fqdn: val('deployPublicFqdn') || undefined,
          keycloak_fqdn: val('deployKeycloakFqdn') || undefined,
          use_https: document.getElementById('deployUseHttps').checked
        })
      });
      fillDeployment(data);
      show('deployResult', data.deployment);
      loadReadiness();
      loadSetupChecklist();
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnCreateBackup').addEventListener('click', async () => {
    try {
      var manifest = await api('/ops/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: val('backupLabel') || 'manual' })
      });
      show('backupResult', manifest);
      await loadBackups();
      await loadHealth();
      await loadReadiness();
      loadSetupChecklist();
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnRestoreBackup').addEventListener('click', async () => {
    var id = val('restoreBackupId');
    var confirmId = val('restoreConfirm');
    if (!id || !confirmId) return alert('Yedek kimligi ve onay gerekli');
    if (!window.confirm('Mevcut Vault verisi uzerine yazilacak. Devam?')) return;
    try {
      show('restoreResult', await api('/ops/backups/' + encodeURIComponent(id) + '/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: confirmId })
      }));
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnPurgeSoftDeleted').addEventListener('click', async () => {
    if (!confirm('Soft-delete suresi dolmus kayitlar kalici silinecek. Devam?')) return;
    try {
      show('maintenanceResult', await api('/ops/maintenance/purge', { method: 'POST' }));
      await loadHealth();
    } catch (e) { alert(e.message); }
  });

  document.querySelector('[data-tab="ops"]').addEventListener('click', loadOpsPanel);

  function fillEmailTemplates(data) {
    var tpl = (data && data.emailTemplates) || {};
    var layout = tpl.layout || {};
    var doc = tpl.document || {};
    var test = tpl.smtp_test || {};
    var ph = document.getElementById('emailTemplatePlaceholders');
    if (ph && data && data.emailTemplatePlaceholders) {
      ph.textContent = data.emailTemplatePlaceholders;
    }
    document.getElementById('etHeaderSubtitle').value = layout.header_subtitle || '';
    document.getElementById('etFooterHtml').value = layout.footer_html || '';
    document.getElementById('etDocSubject').value = doc.subject || '';
    document.getElementById('etDocPreheader').value = doc.preheader || '';
    document.getElementById('etDocTitle').value = doc.title || '';
    document.getElementById('etDocIntroHtml').value = doc.intro_html || '';
    document.getElementById('etDocClosingHtml').value = doc.closing_html || '';
    document.getElementById('etDocPlainBody').value = doc.plain_body || '';
    document.getElementById('etTestSubject').value = test.subject || '';
    document.getElementById('etTestPreheader').value = test.preheader || '';
    document.getElementById('etTestTitle').value = test.title || '';
    document.getElementById('etTestIntroHtml').value = test.intro_html || '';
    document.getElementById('etTestSuccessHtml').value = test.success_html || '';
    document.getElementById('etTestClosingHtml').value = test.closing_html || '';
    document.getElementById('etTestPlainBody').value = test.plain_body || '';
  }

  function fillSettings(data) {
    const ldap = data.ldap || {};
    document.getElementById('ldapHost').value = ldap.host || '';
    document.getElementById('ldapBaseDn').value = ldap.base_dn || '';
    document.getElementById('ldapUsersDn').value = ldap.users_dn || '';
    document.getElementById('ldapGroupsDn').value = ldap.groups_dn || '';
    document.getElementById('ldapBindDn').value = ldap.bind_dn || '';
    document.getElementById('ldapGroupFilter').value = ldap.group_filter || '';
    document.getElementById('ldapGroupUser').value = (ldap.groups && ldap.groups.user) || '';
    document.getElementById('ldapGroupAdmin').value = (ldap.groups && ldap.groups.admin) || '';

    const vault = data.vault || {};
    const quotas = vault.quotas || {};
    const retention = vault.retention || {};
    const roots = vault.storage_roots || {};
    document.getElementById('vaultDefaultQuota').value = quotas.default_max_bytes_per_user || '';
    document.getElementById('vaultMaxFile').value = quotas.max_file_bytes || '';
    document.getElementById('vaultSoftDelete').value = retention.soft_delete_days || '';
    document.getElementById('vaultDocumentsTtlValue').value = retention.documents_ttl_value || '';
    document.getElementById('vaultDocumentsTtlUnit').value = retention.documents_ttl_unit || 'days';
    document.getElementById('vaultDocumentsPath').value = roots.documents || '';
    document.getElementById('vaultArchivePath').value = roots.archive || '';
    const ui = vault.ui || {};
    document.getElementById('vaultDefaultList').value = ui.default_document_list || 'all';

    const lic = data.license || {};
    fillLicenseFields(lic);

    const brand = data.branding || {};
    document.getElementById('brandAppName').value = brand.app_name || '';
    document.getElementById('brandNavbar').value = brand.navbar_name || '';
    document.getElementById('brandDescription').value = brand.home_description || '';
    document.getElementById('brandLocale').value = brand.default_locale || '';
    document.getElementById('brandLangs').value = brand.langs || '';
    document.getElementById('brandPrimaryColor').value = brand.primary_color || '#1d4ed8';
    document.getElementById('brandAccentColor').value = brand.accent_color || '#0f766e';
    pendingPlatformLogo = brand.platform_logo_b64 || null;
    pendingCustomerLogo = brand.customer_logo_b64 || null;
    setLogoPreview('brandPlatformPreview', pendingPlatformLogo);
    setLogoPreview('brandCustomerPreview', pendingCustomerLogo);

    const sys = data.system || {};
    document.getElementById('sysMaxFileMb').value = sys.max_filesize_mb || '';
    document.getElementById('sysBodySize').value = sys.client_max_body_size || '';
    document.getElementById('sysProxyTimeout').value = sys.proxy_read_timeout || '';
    document.getElementById('sysDebugMode').checked = !!sys.debug_mode;

    const comp = data.compliance || {};
    document.getElementById('compAnalytics').checked = !!comp.analytics_enabled;
    document.getElementById('compGoogle').checked = !!comp.google_visibility;
    document.getElementById('compSurvey').checked = comp.survey_disabled !== false;

    const smtp = data.smtp || {};
    document.getElementById('smtpEnabled').checked = !!smtp.enabled;
    document.getElementById('smtpHost').value = smtp.host || '';
    document.getElementById('smtpPort').value = smtp.port || 587;
    document.getElementById('smtpUser').value = smtp.user || '';
    document.getElementById('smtpFrom').value = smtp.from || '';
    document.getElementById('smtpSecurity').value = smtp.security || (smtp.use_tls === false ? 'none' : 'starttls');
    document.getElementById('smtpAuthEnabled').checked = !!smtp.auth_enabled;
    document.getElementById('smtpMaxAttachmentMb').value = smtp.max_attachment_mb || 25;

    show('readOnlyInfo', data.readOnly || {});
    fillDeployment(data);
    fillEmailTemplates(data);
  }

  async function loadSettings() {
    try {
      fillSettings(await api('/settings'));
    } catch (e) { console.warn('Ayarlar yuklenemedi:', e.message); }
  }

  document.getElementById('btnSaveLdap').addEventListener('click', async () => {
    const body = {
      host: val('ldapHost') || undefined,
      base_dn: val('ldapBaseDn') || undefined,
      users_dn: val('ldapUsersDn') || undefined,
      groups_dn: val('ldapGroupsDn') || undefined,
      bind_dn: val('ldapBindDn') || undefined,
      group_filter: val('ldapGroupFilter') || undefined,
      groups: {
        user: val('ldapGroupUser') || undefined,
        admin: val('ldapGroupAdmin') || undefined
      }
    };
    const pwd = val('ldapBindPassword');
    if (pwd) body.bind_password = pwd;
    try {
      const data = await api('/settings/ldap', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      fillSettings(data);
      show('ldapResult', data.ldap);
      document.getElementById('ldapBindPassword').value = '';
      loadSetupChecklist();
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnLdapTest').addEventListener('click', async () => {
    try { show('ldapResult', await api('/ldap/test')); } catch (e) { alert(e.message); }
  });

  document.getElementById('btnLdapApply').addEventListener('click', async () => {
    if (!confirm('LDAP ayarlari Keycloak federation\'a uygulanacak. Devam?')) return;
    try {
      show('ldapResult', await api('/ldap/apply', { method: 'POST' }));
      loadSetupChecklist();
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnSaveVault').addEventListener('click', async () => {
    const body = {};
    const dq = num('vaultDefaultQuota');
    const mf = num('vaultMaxFile');
    const sd = num('vaultSoftDelete');
    const ttlVal = num('vaultDocumentsTtlValue');
    const ttlUnit = val('vaultDocumentsTtlUnit');
    const dp = val('vaultDocumentsPath');
    const ap = val('vaultArchivePath');
    const dl = val('vaultDefaultList');
    if (dq) body.default_max_bytes_per_user = dq;
    if (mf) body.max_file_bytes = mf;
    if (sd) body.soft_delete_days = sd;
    if (ttlVal) body.documents_ttl_value = ttlVal;
    if (ttlUnit) body.documents_ttl_unit = ttlUnit;
    if (dp) body.documents_path = dp;
    if (ap) body.archive_path = ap;
    if (dl) body.default_document_list = dl;
    try {
      const data = await api('/settings/vault', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      show('vaultResult', data.vault);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnSaveLicense').addEventListener('click', async () => {
    const limits = {};
    const maxUsers = num('licenseMaxUsers');
    const maxSessions = num('licenseMaxSessions');
    if (maxUsers != null) limits.max_users = maxUsers;
    if (maxSessions != null) limits.max_concurrent_sessions = maxSessions;
    const body = {
      license_key: val('licenseKey') || undefined,
      expires_at: val('licenseExpires') || undefined,
      apply_package_limits: document.getElementById('licenseApplyPackageLimits').checked,
      enabled_tools: getSelectedFromPicker('licenseToolPicker')
    };
    if (Object.keys(limits).length) body.limits = limits;
    if (selectedPackageId) body.package = selectedPackageId;
    try {
      const data = await api('/settings/license', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      show('licenseResult', data.license);
      await loadLicensePanel();
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnLoadLicenseStatus').addEventListener('click', async () => {
    try {
      var status = await api('/license');
      show('licenseResult', status);
      updateLicenseSummary(status);
    } catch (e) { alert(e.message); }
  });

  var btnLicenseSelectAll = document.getElementById('btnLicenseSelectAll');
  if (btnLicenseSelectAll) {
    btnLicenseSelectAll.addEventListener('click', function () {
      var root = document.getElementById('licenseToolPicker');
      if (!root) return;
      root.querySelectorAll('input[data-tool-id]').forEach(function (cb) { cb.checked = true; });
    });
  }
  var btnLicenseSelectNone = document.getElementById('btnLicenseSelectNone');
  if (btnLicenseSelectNone) {
    btnLicenseSelectNone.addEventListener('click', function () {
      var root = document.getElementById('licenseToolPicker');
      if (!root) return;
      root.querySelectorAll('input[data-tool-id]').forEach(function (cb) { cb.checked = false; });
    });
  }
  var btnRefreshLicenseCatalog = document.getElementById('btnRefreshLicenseCatalog');
  if (btnRefreshLicenseCatalog) {
    btnRefreshLicenseCatalog.addEventListener('click', function () {
      loadLicensePanel().catch(function (e) { alert(e.message); });
    });
  }

  document.querySelector('[data-tab="license"]').addEventListener('click', function () {
    loadLicensePanel().catch(function () { /* sessiz */ });
  });

  document.getElementById('btnNewAccessProfile').addEventListener('click', function () {
    openAccessProfileEditor(null, true);
  });
  document.getElementById('btnRefreshAccessProfiles').addEventListener('click', function () {
    loadAccessProfiles().catch(function (e) { alert(e.message); });
  });
  document.getElementById('btnSaveAccessProfile').addEventListener('click', function () {
    saveAccessProfile().catch(function (e) { alert(e.message); });
  });
  document.getElementById('btnCancelAccessProfile').addEventListener('click', closeAccessProfileEditor);
  document.getElementById('btnDeleteAccessProfile').addEventListener('click', function () {
    deleteAccessProfile().catch(function (e) { alert(e.message); });
  });
  document.getElementById('btnAccessProfileSelectAll').addEventListener('click', function () {
    var root = document.getElementById('accessProfileToolPicker');
    if (!root) return;
    root.querySelectorAll('input[data-tool-id]').forEach(function (cb) { cb.checked = true; });
  });
  document.getElementById('btnAccessProfileSelectNone').addEventListener('click', function () {
    var root = document.getElementById('accessProfileToolPicker');
    if (!root) return;
    root.querySelectorAll('input[data-tool-id]').forEach(function (cb) { cb.checked = false; });
  });

  document.getElementById('btnSaveUserAssignment').addEventListener('click', async function () {
    var user = val('assignProfileUser');
    if (!user) return alert('Kullanıcı adı girin');
    try {
      await saveUserAssignment(user, val('assignProfileId') || null);
      document.getElementById('assignProfileResult').textContent = 'Atama kaydedildi.';
    } catch (e) { document.getElementById('assignProfileResult').textContent = e.message; }
  });

  document.getElementById('btnSaveBranding').addEventListener('click', async () => {
    const body = {
      app_name: val('brandAppName') || undefined,
      navbar_name: val('brandNavbar') || undefined,
      home_description: val('brandDescription') || undefined,
      default_locale: val('brandLocale') || undefined,
      langs: val('brandLangs') || undefined,
      primary_color: document.getElementById('brandPrimaryColor').value || undefined,
      accent_color: document.getElementById('brandAccentColor').value || undefined
    };
    if (pendingPlatformLogo) body.platform_logo_b64 = pendingPlatformLogo;
    if (pendingCustomerLogo) body.customer_logo_b64 = pendingCustomerLogo;
    try {
      const data = await api('/settings/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      var out = data.branding || data;
      if (data.keycloakLoginLogo) out = { branding: out, keycloakLoginLogo: data.keycloakLoginLogo };
      show('brandingResult', out);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnSyncKeycloakLogo').addEventListener('click', async function () {
    try {
      show('brandingResult', await api('/settings/branding/sync-keycloak', { method: 'POST' }));
    } catch (e) { alert(e.message); }
  });

  document.getElementById('brandPlatformLogo').addEventListener('change', async function () {
    const f = this.files && this.files[0];
    if (!f) return;
    pendingPlatformLogo = await fileToB64(f);
    setLogoPreview('brandPlatformPreview', pendingPlatformLogo);
  });

  document.getElementById('brandCustomerLogo').addEventListener('change', async function () {
    const f = this.files && this.files[0];
    if (!f) return;
    pendingCustomerLogo = await fileToB64(f);
    setLogoPreview('brandCustomerPreview', pendingCustomerLogo);
  });

  document.getElementById('btnSaveSystem').addEventListener('click', async () => {
    const body = {
      max_filesize_mb: num('sysMaxFileMb'),
      client_max_body_size: val('sysBodySize') || undefined,
      proxy_read_timeout: num('sysProxyTimeout'),
      proxy_send_timeout: num('sysProxyTimeout'),
      debug_mode: document.getElementById('sysDebugMode').checked
    };
    try {
      const data = await api('/settings/system', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      show('systemResult', { system: data.system, note: 'Nginx/Stirling icin container restart gerekebilir' });
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnSaveCompliance').addEventListener('click', async () => {
    const body = {
      analytics_enabled: document.getElementById('compAnalytics').checked,
      google_visibility: document.getElementById('compGoogle').checked,
      survey_disabled: document.getElementById('compSurvey').checked
    };
    try {
      const data = await api('/settings/compliance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      show('systemResult', data.compliance);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnSaveSmtp').addEventListener('click', async () => {
    const body = {
      enabled: document.getElementById('smtpEnabled').checked,
      host: val('smtpHost') || undefined,
      port: parseInt(document.getElementById('smtpPort').value, 10) || undefined,
      user: val('smtpUser') || undefined,
      from: val('smtpFrom') || undefined,
      security: document.getElementById('smtpSecurity').value || undefined,
      auth_enabled: document.getElementById('smtpAuthEnabled').checked,
      max_attachment_mb: parseInt(document.getElementById('smtpMaxAttachmentMb').value, 10) || undefined
    };
    const pwd = val('smtpPassword');
    if (pwd) body.password = pwd;
    try {
      const data = await api('/settings/smtp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      fillSettings(data);
      show('smtpResult', data.smtp);
      document.getElementById('smtpPassword').value = '';
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnSmtpTest').addEventListener('click', async () => {
    const recipient = val('smtpTestRecipient');
    try {
      show('smtpResult', await api('/smtp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recipient ? { recipient: recipient } : {})
      }));
    } catch (e) { alert(e.message); }
  });

  document.getElementById('smtpSecurity').addEventListener('change', function () {
    var portEl = document.getElementById('smtpPort');
    var authEl = document.getElementById('smtpAuthEnabled');
    if (this.value === 'none' && authEl) {
      authEl.checked = false;
    }
    if (!portEl || portEl.dataset.userEdited === '1') {
      return;
    }
    var defaults = { starttls: 587, ssl: 465, none: 25 };
    portEl.value = defaults[this.value] || 587;
  });
  document.getElementById('smtpPort').addEventListener('input', function () {
    this.dataset.userEdited = '1';
  });

  document.getElementById('btnSaveEmailTemplates').addEventListener('click', async () => {
    const body = {
      layout: {
        header_subtitle: val('etHeaderSubtitle') || undefined,
        footer_html: document.getElementById('etFooterHtml').value || undefined
      },
      document: {
        subject: val('etDocSubject') || undefined,
        preheader: val('etDocPreheader') || undefined,
        title: val('etDocTitle') || undefined,
        intro_html: document.getElementById('etDocIntroHtml').value || undefined,
        closing_html: document.getElementById('etDocClosingHtml').value || undefined,
        plain_body: document.getElementById('etDocPlainBody').value || undefined
      },
      smtp_test: {
        subject: val('etTestSubject') || undefined,
        preheader: val('etTestPreheader') || undefined,
        title: val('etTestTitle') || undefined,
        intro_html: document.getElementById('etTestIntroHtml').value || undefined,
        success_html: document.getElementById('etTestSuccessHtml').value || undefined,
        closing_html: document.getElementById('etTestClosingHtml').value || undefined,
        plain_body: document.getElementById('etTestPlainBody').value || undefined
      }
    };
    try {
      const data = await api('/settings/email-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      fillSettings(data);
      show('emailTemplatesResult', data.emailTemplates);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnResetEmailTemplates').addEventListener('click', async () => {
    if (!confirm('E-posta sablonlari varsayilan degerlere donsun mu?')) return;
    try {
      const data = await api('/settings/email-templates', { method: 'DELETE' });
      fillSettings(data);
      show('emailTemplatesResult', { reset: true, emailTemplates: data.emailTemplates });
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnExportAudit').addEventListener('click', exportAuditCsv);

  document.getElementById('btnLoadQuotaList').addEventListener('click', function () { loadQuotaList(1); });
  document.getElementById('quotaPrev').addEventListener('click', function () {
    if (quotaPage > 1) loadQuotaList(quotaPage - 1);
  });
  document.getElementById('quotaNext').addEventListener('click', function () {
    var pages = Math.ceil(quotaTotal / quotaPageSize);
    if (quotaPage < pages) loadQuotaList(quotaPage + 1);
  });
  document.querySelector('[data-tab="quota"]').addEventListener('click', function () { loadQuotaList(1); });

  document.getElementById('btnLoadQuota').addEventListener('click', async () => {
    const userId = val('quotaUserId');
    if (!userId) return alert('Kullanici ID girin');
    try {
      const data = await api('/users/' + encodeURIComponent(userId) + '/quota');
      document.getElementById('quotaMaxBytes').value = data.maxBytes;
      show('quotaResult', data);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnSaveQuota').addEventListener('click', async () => {
    const userId = val('quotaUserId');
    var maxBytes = num('quotaMaxBytes');
    var maxMb = num('quotaMaxMb');
    if (maxMb && !maxBytes) maxBytes = maxMb * 1024 * 1024;
    if (!userId || !maxBytes) return alert('Kullanici ve kota girin');
    try {
      show('quotaResult', await api('/users/' + encodeURIComponent(userId) + '/quota', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxBytes: maxBytes })
      }));
      await loadQuotaList(quotaPage);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnLoadTools').addEventListener('click', async () => {
    try {
      const data = await api('/tools');
      document.getElementById('toolsEnabled').value = (data.enabled || []).join(',');
      show('toolsResult', data);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnSaveTools').addEventListener('click', async () => {
    const raw = val('toolsEnabled');
    if (!raw) return alert('En az bir arac girin');
    const enabled = raw.split(',').map(s => s.trim()).filter(Boolean);
    try {
      show('toolsResult', await api('/tools', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabled })
      }));
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnExportAudit').addEventListener('click', exportAuditCsv);

  document.getElementById('btnLoadAudit').addEventListener('click', function () { loadAudit(1); });
  document.getElementById('auditPrev').addEventListener('click', function () {
    if (auditPage > 1) loadAudit(auditPage - 1);
  });
  document.getElementById('auditNext').addEventListener('click', function () {
    var pages = Math.ceil(auditTotal / auditPageSize);
    if (auditPage < pages) loadAudit(auditPage + 1);
  });

  document.getElementById('btnLoadJobs').addEventListener('click', function () { loadJobs(1); });
  document.getElementById('jobsPrev').addEventListener('click', function () {
    if (jobsPage > 1) loadJobs(jobsPage - 1);
  });
  document.getElementById('jobsNext').addEventListener('click', function () {
    var pages = Math.ceil(jobsTotal / jobsPageSize);
    if (jobsPage < pages) loadJobs(jobsPage + 1);
  });

  document.querySelector('[data-tab="dashboard"]').addEventListener('click', loadDashboard);
  document.getElementById('btnRefreshDashboard').addEventListener('click', loadDashboard);
  document.querySelector('[data-tab="audit"]').addEventListener('click', function () {
    if (auditTotal === 0) loadAudit(1);
  });

  function renderStatusBadge(u) {
    const kind = u.statusKind || 'idle';
    const label = u.statusLabel || 'Giris yok';
    return '<span class="status-badge status-' + kind + '" title="' + label + '">' + label + '</span>';
  }

  function renderUsers(data) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';
    (data.items || []).forEach(function (u) {
      const tr = document.createElement('tr');
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || '—';
      const roles = (u.roles && u.roles.length) ? u.roles.join(', ') : '—';
      tr.innerHTML =
        '<td><span class="user-link" data-user="' + (u.username || '') + '">' + (u.username || '—') + '</span></td>' +
        '<td>' + name + '</td>' +
        '<td>' + (u.email || '—') + '</td>' +
        '<td>' + roles + '</td>' +
        '<td>' + (u.source || '—') + '</td>' +
        '<td class="profile-cell">' + renderProfileSelect(u.username || '') + '</td>' +
        '<td>' + renderStatusBadge(u) + '</td>';
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.user-link').forEach(function (el) {
      el.addEventListener('click', function () {
        const username = el.getAttribute('data-user');
        if (!username) return;
        document.querySelector('[data-tab="quota"]').click();
        document.getElementById('quotaUserId').value = username;
      });
    });
    tbody.querySelectorAll('.user-profile-select').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var username = sel.getAttribute('data-user');
        saveUserAssignment(username, sel.value || null).catch(function (e) { alert(e.message); });
      });
    });
    const summary = document.getElementById('usersSummary');
    summary.textContent = (data.items || []).length + ' kayit gosteriliyor (toplam ~' + (data.total || 0) + ')';
  }

  async function loadUsers() {
    await Promise.all([loadAccessProfiles(), loadUserAssignments()]);
    const qs = new URLSearchParams();
    const search = val('userSearch');
    if (search) qs.set('search', search);
    if (document.getElementById('userFederatedOnly').checked) qs.set('federatedOnly', 'true');
    qs.set('size', '50');
    const data = await api('/users?' + qs.toString());
    renderUsers(data);
    show('usersResult', data);
  }

  document.getElementById('btnLoadUsers').addEventListener('click', async () => {
    try { await loadUsers(); } catch (e) { alert(e.message); }
  });

  document.getElementById('btnSyncUsers').addEventListener('click', async () => {
    if (!confirm('AD kullanicilari Keycloak\'a senkron edilecek. Devam?')) return;
    try {
      show('usersResult', await api('/ldap/sync?syncUsers=true&syncGroups=false', { method: 'POST' }));
      await loadUsers();
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnSyncGroups').addEventListener('click', async () => {
    if (!confirm('AD gruplari ve rol eslemeleri senkron edilecek. Devam?')) return;
    try {
      show('usersResult', await api('/ldap/sync?syncUsers=false&syncGroups=true', { method: 'POST' }));
      await loadUsers();
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnCreateLocalUser').addEventListener('click', async () => {
    const username = val('localUserName');
    const password = val('localUserPassword');
    if (!username || !password) {
      alert('Kullanici adi ve parola zorunlu');
      return;
    }
    const roles = [];
    if (document.getElementById('localRoleUser').checked) roles.push('pdf-user');
    if (document.getElementById('localRoleAdmin').checked) roles.push('pdf-admin');
    if (!roles.length) {
      alert('En az bir rol secin');
      return;
    }
    try {
      const body = {
        username: username,
        password: password,
        roles: roles
      };
      const email = val('localUserEmail');
      const firstName = val('localUserFirstName');
      const lastName = val('localUserLastName');
      if (email) body.email = email;
      if (firstName) body.firstName = firstName;
      if (lastName) body.lastName = lastName;
      show('usersResult', await api('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }));
      document.getElementById('localUserPassword').value = '';
      await loadUsers();
    } catch (e) { alert(e.message); }
  });

  document.querySelector('[data-tab="users"]').addEventListener('click', function () {
    Promise.all([loadAccessProfiles(), loadUserAssignments()]).then(function () {
      return loadUsers();
    }).catch(function () { /* ilk acilista sessiz */ });
  });

  document.getElementById('btnRefreshSetup').addEventListener('click', loadSetupChecklist);
  document.getElementById('btnSetupBannerDismiss').addEventListener('click', function () {
    switchTab('settings');
    document.getElementById('setupChecklistCard').scrollIntoView({ behavior: 'smooth' });
  });
  document.getElementById('btnSetupWizardComplete').addEventListener('click', async function () {
    if (!confirm('Tum kurulum adimlarini tamamladiginizi onayliyor musunuz?')) return;
    try {
      await api('/ops/setup/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'wizard_complete' })
      });
      await loadSetupChecklist();
    } catch (e) { alert(e.message); }
  });

  loadSettings();
  loadSetupChecklist();
  loadDashboard();
})();
