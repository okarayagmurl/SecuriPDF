(function () {
  const WELCOME_MARKER = 'Welcome.pdf';

  function syncNavbarOffset() {
    var shell = document.querySelector('.securipdf-navbar-shell');
    if (!shell) {
      return;
    }
    var height = Math.ceil(shell.getBoundingClientRect().height);
    if (height > 0) {
      document.documentElement.style.setProperty('--securipdf-navbar-offset', height + 'px');
    }
  }

  function isWelcomeDocument() {
    if (window.__securipdfVaultDocumentLoaded) {
      return false;
    }

    var lastName = window.__securipdfLastFilename || '';
    if (lastName && lastName.indexOf(WELCOME_MARKER) < 0) {
      return false;
    }

    const app = window.PDFViewerApplication;
    const url = app?.url || '';
    const titleName = app?._contentDispositionFilename || app?.contentDispositionFilename || '';

    if (titleName && titleName.indexOf(WELCOME_MARKER) < 0) {
      return false;
    }

    if (url && url.indexOf(WELCOME_MARKER) < 0) {
      return false;
    }

    if (app?.pdfDocument && lastName && lastName.indexOf(WELCOME_MARKER) < 0) {
      return false;
    }

    return !url || url.indexOf(WELCOME_MARKER) >= 0 || document.title === WELCOME_MARKER;
  }

  function hideUploadPrompt() {
    const overlay = document.getElementById('securipdfUploadPrompt');
    if (overlay) {
      overlay.classList.add('hidden');
    }
  }

  window.securipdfHideUploadPrompt = hideUploadPrompt;
  window.securipdfRefreshUploadPrompt = updateUploadPrompt;

  function updateUploadPrompt() {
    const overlay = document.getElementById('securipdfUploadPrompt');
    if (!overlay) {
      return;
    }
    overlay.classList.toggle('hidden', !isWelcomeDocument());
  }

  function openLocalPdfPicker() {
    const openFileButton = document.getElementById('openFile');
    if (openFileButton) {
      openFileButton.click();
      return;
    }
    const secondaryOpenFile = document.getElementById('secondaryOpenFile');
    if (secondaryOpenFile) {
      secondaryOpenFile.click();
    }
  }

  function bindChooseButton() {
    const chooseButton = document.getElementById('securipdfChoosePdfBtn');
    if (!chooseButton) {
      return;
    }
    chooseButton.addEventListener('click', openLocalPdfPicker);
  }

  function bindPdfJsEvents() {
    const app = window.PDFViewerApplication;
    if (!app?.initializedPromise) {
      setTimeout(bindPdfJsEvents, 200);
      return;
    }

    app.initializedPromise.then(function () {
      app.eventBus.on('documentloaded', updateUploadPrompt);
      app.eventBus.on('fileinputchange', updateUploadPrompt);
      updateUploadPrompt();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    syncNavbarOffset();
    window.addEventListener('resize', syncNavbarOffset);
    window.addEventListener('load', syncNavbarOffset);
    document.querySelectorAll('.navbar-logo').forEach(function (logo) {
      if (!logo.complete) {
        logo.addEventListener('load', syncNavbarOffset);
      }
    });
    bindChooseButton();
    bindPdfJsEvents();
  });
})();
