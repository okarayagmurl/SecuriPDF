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

  function loadOpsPanel() {
    loadHealth();
    loadReadiness();
    loadBackups();
  }

  document.getElementById('btnRefreshHealth').addEventListener('click', loadHealth);
  document.getElementById('btnRefreshReadiness').addEventListener('click', loadReadiness);
  document.getElementById('btnRefreshBackups').addEventListener('click', loadBackups);

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
    document.getElementById('vaultDefaultQuota').value = quotas.default_max_bytes_per_user || '';
    document.getElementById('vaultMaxFile').value = quotas.max_file_bytes || '';
    document.getElementById('vaultSoftDelete').value = retention.soft_delete_days || '';

    const lic = data.license || {};
    document.getElementById('licenseKey').value = lic.license_key || '';
    document.getElementById('licenseExpires').value = lic.expires_at || '';
    const limits = lic.limits || {};
    document.getElementById('licenseMaxUsers').value = limits.max_users || '';
    document.getElementById('licenseMaxSessions').value = limits.max_concurrent_sessions || '';
    document.getElementById('licenseTools').value = (lic.enabled_tools || []).join(',');

    const brand = data.branding || {};
    document.getElementById('brandAppName').value = brand.app_name || '';
    document.getElementById('brandNavbar').value = brand.navbar_name || '';
    document.getElementById('brandDescription').value = brand.home_description || '';
    document.getElementById('brandLocale').value = brand.default_locale || '';
    document.getElementById('brandLangs').value = brand.langs || '';

    const sys = data.system || {};
    document.getElementById('sysMaxFileMb').value = sys.max_filesize_mb || '';
    document.getElementById('sysBodySize').value = sys.client_max_body_size || '';
    document.getElementById('sysProxyTimeout').value = sys.proxy_read_timeout || '';

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
    if (dq) body.default_max_bytes_per_user = dq;
    if (mf) body.max_file_bytes = mf;
    if (sd) body.soft_delete_days = sd;
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
    const toolsRaw = val('licenseTools');
    const body = {
      license_key: val('licenseKey') || undefined,
      expires_at: val('licenseExpires') || undefined,
      limits: {
        max_users: num('licenseMaxUsers'),
        max_concurrent_sessions: num('licenseMaxSessions')
      },
      enabled_tools: toolsRaw ? toolsRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined
    };
    try {
      const data = await api('/settings/license', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      show('licenseResult', data.license);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnLoadLicenseStatus').addEventListener('click', async () => {
    try { show('licenseResult', await api('/license')); } catch (e) { alert(e.message); }
  });

  document.getElementById('btnSaveBranding').addEventListener('click', async () => {
    const body = {
      app_name: val('brandAppName') || undefined,
      navbar_name: val('brandNavbar') || undefined,
      home_description: val('brandDescription') || undefined,
      default_locale: val('brandLocale') || undefined,
      langs: val('brandLangs') || undefined
    };
    try {
      const data = await api('/settings/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      show('brandingResult', data.branding);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('btnSaveSystem').addEventListener('click', async () => {
    const body = {
      max_filesize_mb: num('sysMaxFileMb'),
      client_max_body_size: val('sysBodySize') || undefined,
      proxy_read_timeout: num('sysProxyTimeout'),
      proxy_send_timeout: num('sysProxyTimeout')
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
    const maxBytes = num('quotaMaxBytes');
    if (!userId || !maxBytes) return alert('Kullanici ve kota girin');
    try {
      show('quotaResult', await api('/users/' + encodeURIComponent(userId) + '/quota', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxBytes: maxBytes })
      }));
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

  document.getElementById('btnLoadAudit').addEventListener('click', async () => {
    const qs = new URLSearchParams();
    if (val('auditUserId')) qs.set('userId', val('auditUserId'));
    if (val('auditAction')) qs.set('action', val('auditAction'));
    if (val('auditFrom')) qs.set('from', val('auditFrom'));
    if (val('auditTo')) qs.set('to', val('auditTo'));
    try { show('auditResult', await api('/audit?' + qs.toString())); } catch (e) { alert(e.message); }
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
    const summary = document.getElementById('usersSummary');
    summary.textContent = (data.items || []).length + ' kayit gosteriliyor (toplam ~' + (data.total || 0) + ')';
  }

  async function loadUsers() {
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
    loadUsers().catch(function () { /* ilk acilista sessiz */ });
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
})();
