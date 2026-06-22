/**
 * SecuriPDF Vault — sertifika secici (Faz 4, cert-sign araci)
 */
(function () {
  const ORCH_API = '/api/orchestration/certificates';
  const SIGN_PATHS = ['/sign', '/cert-sign'];

  function isSignToolPage() {
    return SIGN_PATHS.some(function (p) { return window.location.pathname.indexOf(p) >= 0; });
  }

  async function loadVaultCertificates() {
    const res = await fetch(ORCH_API);
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  }

  function findCertFileInput() {
    var inputs = document.querySelectorAll('input[type="file"]');
    for (var i = 0; i < inputs.length; i++) {
      var accept = (inputs[i].getAttribute('accept') || '').toLowerCase();
      if (accept.indexOf('pkcs') >= 0 || accept.indexOf('.pfx') >= 0 || accept.indexOf('.p12') >= 0) {
        return inputs[i];
      }
    }
    return inputs[0] || null;
  }

  function injectCertificatePicker() {
    if (document.getElementById('securipdf-vault-certificates')) return;
    if (!isSignToolPage()) return;

    var container = document.querySelector('form') || document.body;
    var panel = document.createElement('div');
    panel.id = 'securipdf-vault-certificates';
    panel.style.cssText = 'margin:1rem 0;padding:1rem;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc';
    panel.innerHTML = '<strong>Vault sertifikalarim</strong><div id="securipdf-cert-list">Yukleniyor...</div>';
    container.prepend(panel);

    loadVaultCertificates().then(function (items) {
      var list = document.getElementById('securipdf-cert-list');
      if (!items.length) {
        list.textContent = 'Kayitli sertifika yok. Vault API ile PFX yukleyin.';
        return;
      }
      list.innerHTML = items.map(function (item) {
        return '<button type="button" data-cert-id="' + item.id + '" style="margin:4px">' +
          (item.label || item.id) + '</button>';
      }).join(' ');
      list.querySelectorAll('button[data-cert-id]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var id = btn.getAttribute('data-cert-id');
          var url = ORCH_API + '/' + id + '/for-stirling';
          var res = await fetch(url);
          if (!res.ok) { alert('Sertifika alinamadi'); return; }
          var blob = await res.blob();
          var file = new File([blob], id + '.pfx', { type: 'application/x-pkcs12' });
          var input = findCertFileInput();
          if (input) {
            var dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            alert('Vault sertifikasi secildi: ' + id);
          } else {
            alert('Sertifika dosya alani bulunamadi');
          }
        });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', injectCertificatePicker);
  setTimeout(injectCertificatePicker, 2000);
})();
