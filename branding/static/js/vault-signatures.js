/**
 * SecuriPDF Vault — imza secici (Faz 4, sign araci entegrasyonu)
 */
(function () {
  const ORCH_API = '/api/orchestration/signatures';

  async function loadVaultSignatures() {
    const res = await fetch(ORCH_API);
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || [];
  }

  function injectSignaturePicker() {
    if (document.getElementById('securipdf-vault-signatures')) return;
    var path = window.location.pathname;
    if (path.indexOf('/cert-sign') >= 0) return;
    if (path.indexOf('/sign') < 0) return;

    const container = document.querySelector('form') || document.body;
    const panel = document.createElement('div');
    panel.id = 'securipdf-vault-signatures';
    panel.style.cssText = 'margin:1rem 0;padding:1rem;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc';
    panel.innerHTML = '<strong>Vault imzalarim</strong><div id="securipdf-sig-list">Yukleniyor...</div>';
    container.prepend(panel);

    loadVaultSignatures().then(function (items) {
      const list = document.getElementById('securipdf-sig-list');
      if (!items.length) {
        list.textContent = 'Kayitli imza yok. Admin veya Vault API ile yukleyin.';
        return;
      }
      list.innerHTML = items.map(function (item) {
        return '<button type="button" data-sig-id="' + item.id + '" style="margin:4px">' +
          (item.label || item.id) + '</button>';
      }).join(' ');
      list.querySelectorAll('button[data-sig-id]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const id = btn.getAttribute('data-sig-id');
          const url = ORCH_API + '/' + id + '/for-stirling';
          const res = await fetch(url);
          if (!res.ok) { alert('Imza alinamadi'); return; }
          const blob = await res.blob();
          const file = new File([blob], id + '.png', { type: blob.type });
          const input = document.querySelector('input[type="file"]');
          if (input) {
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            alert('Vault imzasi secildi: ' + id);
          }
        });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', injectSignaturePicker);
})();
