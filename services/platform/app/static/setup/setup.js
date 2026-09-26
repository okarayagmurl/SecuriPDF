(function () {
  var status = null;

  function $(id) { return document.getElementById(id); }

  function showErr(msg) {
    var el = $('errorBanner');
    if (!msg) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(path, opts).then(function (r) {
      return r.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { /* ignore */ }
        if (!r.ok) {
          var detail = (data && (data.detail || data.error)) || t || ('HTTP ' + r.status);
          if (typeof detail === 'object') detail = JSON.stringify(detail);
          throw new Error(detail);
        }
        return data;
      });
    });
  }

  function setBackendFields() {
    var b = $('storageBackend').value;
    $('storage-local').classList.toggle('hidden', b !== 'local');
    $('storage-s3').classList.toggle('hidden', b !== 's3');
    $('storage-shared').classList.toggle('hidden', b !== 'shared');
  }

  function render(data) {
    status = data;
    var complete = !!data.complete;
    $('doneBanner').classList.toggle('hidden', !complete);
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('hidden', complete);
    });
    $('stepList').classList.toggle('hidden', complete);
    if (complete) return;

    var storageOk = !!data.storageConfigured;
    var userOk = !!data.defaultUserCreated;
    document.querySelectorAll('#stepList li').forEach(function (li) {
      var step = li.getAttribute('data-step');
      li.classList.remove('done', 'current');
      if (step === 'storage' && storageOk) li.classList.add('done');
      else if (step === 'user' && userOk) li.classList.add('done');
      else if (step === 'finish' && storageOk && userOk) li.classList.add('current');
      else if (step === 'storage' && !storageOk) li.classList.add('current');
      else if (step === 'user' && storageOk && !userOk) li.classList.add('current');
    });

    var storage = data.storage || {};
    if (storage.backend) {
      $('storageBackend').value = storage.backend;
      setBackendFields();
    }
    if (storage.local && storage.local.data_path) {
      $('localDataPath').value = storage.local.data_path;
    }
    if (storage.s3) {
      $('s3Endpoint').value = storage.s3.endpoint || '';
      $('s3Bucket').value = storage.s3.bucket || '';
      $('s3Region').value = storage.s3.region || '';
      $('s3Prefix').value = storage.s3.prefix || '';
      $('s3AccessKey').value = storage.s3.access_key || '';
    }
    if (storage.shared) {
      if ($('smbHost')) $('smbHost').value = storage.shared.host || '';
      if ($('smbShare')) $('smbShare').value = storage.shared.share || '';
      if ($('smbPath')) $('smbPath').value = storage.shared.path || '';
      if ($('smbDomain')) $('smbDomain').value = storage.shared.domain || '';
      $('sharedUser').value = storage.shared.username || '';
    }
    if (data.defaultUsername) {
      $('userName').value = data.defaultUsername;
    }

    $('storageStatus').textContent = storageOk ? 'Depolama kaydedildi (' + (storage.backend || '') + ')' : '';
    $('storageStatus').className = 'status' + (storageOk ? ' ok' : '');
    $('userStatus').textContent = userOk ? 'Kullanıcı oluşturuldu: ' + (data.defaultUsername || '') : '';
    $('userStatus').className = 'status' + (userOk ? ' ok' : '');

    var list = $('finishChecklist');
    list.innerHTML =
      '<li class="' + (storageOk ? 'ok' : 'bad') + '">Depolama: ' + (storageOk ? 'hazır' : 'eksik') + '</li>' +
      '<li class="' + (userOk ? 'ok' : 'bad') + '">Varsayılan kullanıcı: ' + (userOk ? 'hazır' : 'eksik') + '</li>';
    $('btnComplete').disabled = !(storageOk && userOk);
  }

  function refresh() {
    return api('/api/setup/v1/status').then(render).catch(function (e) {
      showErr(e.message);
    });
  }

  $('storageBackend').addEventListener('change', setBackendFields);

  $('btnSaveStorage').addEventListener('click', function () {
    showErr('');
    var backend = $('storageBackend').value;
    var body = { backend: backend };
    if (backend === 'local') {
      body.data_path = $('localDataPath').value.trim();
    } else if (backend === 's3') {
      body.endpoint = $('s3Endpoint').value.trim();
      body.bucket = $('s3Bucket').value.trim();
      body.region = $('s3Region').value.trim();
      body.prefix = $('s3Prefix').value.trim();
      body.access_key = $('s3AccessKey').value.trim();
      body.secret_key = $('s3SecretKey').value;
    } else {
      body.host = $('smbHost').value.trim();
      body.share = $('smbShare').value.trim();
      body.path = $('smbPath').value.trim() || undefined;
      body.domain = $('smbDomain').value.trim() || undefined;
      body.username = $('sharedUser').value.trim();
      body.password = $('sharedPass').value;
    }
    $('btnSaveStorage').disabled = true;
    api('/api/setup/v1/storage', { method: 'POST', body: body })
      .then(function () { return refresh(); })
      .catch(function (e) {
        $('storageStatus').textContent = e.message;
        $('storageStatus').className = 'status err';
        showErr(e.message);
      })
      .finally(function () { $('btnSaveStorage').disabled = false; });
  });

  $('btnCreateUser').addEventListener('click', function () {
    showErr('');
    var pass = $('userPass').value;
    if (pass !== $('userPass2').value) {
      showErr('Parolalar eşleşmiyor');
      return;
    }
    $('btnCreateUser').disabled = true;
    api('/api/setup/v1/default-user', {
      method: 'POST',
      body: {
        username: $('userName').value.trim(),
        password: pass,
        email: $('userEmail').value.trim() || null,
      },
    })
      .then(function () {
        $('userPass').value = '';
        $('userPass2').value = '';
        return refresh();
      })
      .catch(function (e) {
        $('userStatus').textContent = e.message;
        $('userStatus').className = 'status err';
        showErr(e.message);
      })
      .finally(function () { $('btnCreateUser').disabled = false; });
  });

  $('btnComplete').addEventListener('click', function () {
    showErr('');
    $('btnComplete').disabled = true;
    api('/api/setup/v1/complete', { method: 'POST', body: {} })
      .then(function (res) {
        var gate = res && res.authGate;
        if (gate && gate.requested && gate.ok === false) {
          $('finishStatus').textContent =
            'Kurulum kaydedildi; auth kapısı yenilenemedi: ' + (gate.error || 'bilinmiyor') +
            '. oauth2-proxy yeniden başlatılabilir.';
          $('finishStatus').className = 'status err';
        } else {
          $('finishStatus').textContent = 'Tamamlandı.';
          $('finishStatus').className = 'status ok';
        }
        return refresh();
      })
      .catch(function (e) {
        showErr(e.message);
        $('finishStatus').textContent = e.message;
        $('finishStatus').className = 'status err';
        $('btnComplete').disabled = false;
      });
  });

  setBackendFields();
  refresh();
})();
