(function () {
  'use strict';

  var API = '/api/app/v1/desktop';
  var PLATFORM_FIELDS = {
    tool_id: true, toolId: true, _apiPath: true, _toExt: true,
    outputDownload: true, outputSaveDocuments: true
  };
  var tauri = window.__TAURI__ && window.__TAURI__.core;
  var toolsPromise = null;

  function invoke(cmd, args, options) {
    return tauri.invoke(cmd, args, options);
  }

  function engineReady() {
    return invoke('local_engine_status')
      .then(function (status) { return !!status && status.state === 'ready'; })
      .catch(function () { return false; });
  }

  function localTools() {
    if (!toolsPromise) {
      toolsPromise = fetch(API + '/local-tools', { credentials: 'same-origin', redirect: 'manual' })
        .then(function (r) { return r.ok ? r.json() : { tools: [] }; })
        .then(function (body) { return body.tools || []; })
        .catch(function () { return []; });
    }
    return toolsPromise;
  }

  function splitForm(fd) {
    var files = [];
    var fields = {};
    fd.forEach(function (value, key) {
      if (PLATFORM_FIELDS[key]) return;
      if (value instanceof File) {
        if (value.size || value.name) files.push({ field: key, file: value });
        return;
      }
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        if (!Array.isArray(fields[key])) fields[key] = [fields[key]];
        fields[key].push(String(value));
      } else {
        fields[key] = String(value);
      }
    });
    return { files: files, fields: fields };
  }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          var detail = t;
          try { detail = JSON.parse(t).detail || t; } catch (e) { /* düz metin */ }
          var err = new Error(detail || ('HTTP ' + r.status));
          err.status = r.status;
          throw err;
        });
      }
      return r.json();
    });
  }

  function engineBody(parts, plan) {
    var body = new FormData();
    parts.files.forEach(function (item) {
      body.append(item.field, item.file, item.file.name);
    });
    Object.keys(plan.formData || {}).forEach(function (key) {
      var value = plan.formData[key];
      (Array.isArray(value) ? value : [value]).forEach(function (v) { body.append(key, v); });
    });
    var req = new Request('http://local.invalid/', { method: 'POST', body: body });
    return req.arrayBuffer().then(function (buf) {
      return { bytes: new Uint8Array(buf), contentType: req.headers.get('content-type') };
    });
  }

  function engineError(raw) {
    var code = typeof raw === 'string' ? raw : (raw && raw.message) || 'LOCAL_ENGINE_FAILED';
    var labels = {
      LOCAL_ENGINE_NOT_READY: 'Bilgisayardaki PDF motoru hazır değil',
      LOCAL_ENGINE_UNREACHABLE: 'Bilgisayardaki PDF motoruna ulaşılamadı',
      LOCAL_EMPTY_OUTPUT: 'Bilgisayardaki PDF motoru boş çıktı verdi',
      LOCAL_BAD_REQUEST: 'İstek bilgisayardaki PDF motoruna uygun değil'
    };
    var label = labels[code] || (/^LOCAL_HTTP_\d+$/.test(code)
      ? 'Bilgisayardaki PDF motoru isteği reddetti (' + code.slice(11) + ')'
      : 'Bilgisayardaki PDF motoru işlemi tamamlayamadı');
    var err = new Error(label);
    err.code = /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'LOCAL_ENGINE_FAILED';
    return err;
  }

  function canRun(toolId) {
    if (!tauri || !toolId) return Promise.resolve(false);
    return Promise.all([engineReady(), localTools()]).then(function (res) {
      return res[0] && res[1].indexOf(toolId) !== -1;
    });
  }

  function run(toolId, fd) {
    var parts = splitForm(fd);
    var apiPath = fd.get('_apiPath');
    return postJson(API + '/local-runs', {
      toolId: toolId,
      apiPath: apiPath ? String(apiPath) : null,
      formData: parts.fields,
      inputs: parts.files.map(function (item) {
        return { field: item.field, sizeBytes: item.file.size };
      })
    }).then(function (plan) {
      function finish(result) {
        return postJson(API + '/local-runs/' + encodeURIComponent(plan.runId) + '/result', result)
          .catch(function () { return null; });
      }
      return engineBody(parts, plan).then(function (req) {
        return invoke('run_local_tool', req.bytes, {
          headers: {
            'x-securipdf-api-path': plan.apiPath,
            'x-securipdf-content-type': req.contentType
          }
        });
      }).then(function (out) {
        var blob = new Blob([out]);
        return finish({ ok: true, outputBytes: blob.size }).then(function () { return blob; });
      }, function (raw) {
        var err = engineError(raw);
        return finish({ ok: false, errorCode: err.code }).then(function () { throw err; });
      });
    });
  }

  window.SecuriDesktop = { canRun: canRun, run: run };
})();
