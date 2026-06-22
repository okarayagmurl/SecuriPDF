/**
 * SecuriPDF — oauth2-proxy oturum bilgisini navbar'da gösterir.
 * Auth kapalı modda (/oauth2/userinfo 401) sessizce atlanır.
 */
(function () {
  const NAV_ID = 'authUserNav';
  const NAME_ID = 'authUserName';
  const SUB_ID = 'authUserSub';
  const LABEL_ID = 'authUserLabel';
  const SIGNED_IN_LABEL_ID = 'authUserSignedInLabel';
  const DROPDOWN_ID = 'authUserDropdown';
  const SETTINGS_NAME_ID = 'authUserSettingsName';
  const SETTINGS_SIGNOUT_ID = 'authUserSettingsSignOut';

  const I18N = {
    tr: { signedInAs: 'Oturum açık', session: 'Oturum', user: 'Kullanıcı', signOut: 'Çıkış Yap' },
    en: { signedInAs: 'Signed in as', session: 'Session', user: 'User', signOut: 'Sign Out' }
  };

  function pageLang() {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (q && q.toLowerCase().startsWith('tr')) return 'tr';
    if (q) return 'en';
    const html = (document.documentElement.lang || '').toLowerCase();
    if (html.startsWith('tr')) return 'tr';
    return 'en';
  }

  function t(key) {
    const lang = pageLang();
    return (I18N[lang] || I18N.en)[key];
  }

  function applyAuthLabels() {
    const signedIn = document.getElementById(SIGNED_IN_LABEL_ID);
    const dropdown = document.getElementById(DROPDOWN_ID);
    const signOut = document.getElementById('authUserSignOutLabel');
    if (signedIn) signedIn.textContent = t('signedInAs');
    if (dropdown) dropdown.setAttribute('title', t('session'));
    if (signOut) signOut.textContent = t('signOut');
  }

  function displayName(info) {
    if (info.preferredUsername) return info.preferredUsername;
    if (info.user) return info.user;
    if (info.email) return info.email;
    return t('user');
  }

  function subtitle(info) {
    const primary = displayName(info);
    if (info.email && info.email !== primary) return info.email;
    if (info.groups && info.groups.length) return info.groups.join(', ');
    return '';
  }

  function revealUserInfo(info) {
    const name = displayName(info);
    const sub = subtitle(info);

    const nav = document.getElementById(NAV_ID);
    const nameEl = document.getElementById(NAME_ID);
    const subEl = document.getElementById(SUB_ID);
    const labelEl = document.getElementById(LABEL_ID);
    const settingsName = document.getElementById(SETTINGS_NAME_ID);
    const settingsSignOut = document.getElementById(SETTINGS_SIGNOUT_ID);

    if (nameEl) nameEl.textContent = name;
    if (labelEl) labelEl.textContent = name;
    if (subEl) {
      subEl.textContent = sub;
      subEl.classList.toggle('d-none', !sub);
    }
    if (nav) nav.classList.remove('d-none');

    if (settingsName) {
      settingsName.textContent = sub ? name + ' (' + sub + ')' : name;
      settingsName.classList.remove('d-none');
    }
    if (settingsSignOut) settingsSignOut.classList.remove('d-none');

    const isAdmin = (info.groups || []).some(function (g) {
      return g === 'pdf-admin' || (typeof g === 'string' && g.indexOf('pdf-admin') >= 0);
    }) || (info.roles || []).indexOf('pdf-admin') >= 0;
    const adminLink = document.getElementById('authUserAdminLink');
    if (adminLink && isAdmin) adminLink.classList.remove('d-none');
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyAuthLabels();

    fetch('/oauth2/userinfo', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (info) {
        if (info) revealUserInfo(info);
      })
      .catch(function () { /* auth yok veya proxy kapalı */ });
  });

  if (!window.__securipdfVaultArchiveLoaded && !window.__securipdfVaultArchiveRequested) {
    window.__securipdfVaultArchiveRequested = true;
    var archiveScript = document.createElement('script');
    archiveScript.src = '/js/securipdf-archive.js?v=9';
    archiveScript.async = true;
    document.head.appendChild(archiveScript);
  }
})();
