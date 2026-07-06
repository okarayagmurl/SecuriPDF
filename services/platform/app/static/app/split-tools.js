(function (global) {
  'use strict';

  var SPLIT_MODES = [
    {
      id: 'byPages',
      label: 'Sayfa numaralarında böl',
      shortLabel: 'Sayfa numaraları',
      apiPath: '/api/v1/general/split-pages',
      hint: 'Bölünmesini istediğiniz sayfa numaralarını girin (örn. 1,5,10). Her numara o sayfadan sonra kesim yapar.'
    },
    {
      id: 'byChapters',
      label: 'Bölümlere göre böl',
      shortLabel: 'Bölümler',
      apiPath: '/api/v1/general/split-pdf-by-chapters',
      hint: 'PDF yer imi / içindekiler yapısına göre ayırır. Yer imi seviyesini seçin.'
    },
    {
      id: 'bySections',
      label: 'Sayfa bölümlerine göre böl',
      shortLabel: 'Bölümler',
      apiPath: '/api/v1/general/split-pdf-by-sections',
      hint: 'Her sayfayı yatay ve dikey parçalara böler (örn. 2x2 ızgara).'
    },
    {
      id: 'byFileSize',
      label: 'Dosya boyutuna göre böl',
      shortLabel: 'Dosya boyutu',
      apiPath: '/api/v1/general/split-by-size-or-count',
      splitType: 0,
      hint: 'Her parçanın maksimum boyutunu girin (örn. 5MB, 2MB).'
    },
    {
      id: 'byPageCount',
      label: 'Sayfa sayısına göre böl',
      shortLabel: 'Sayfa sayısı',
      apiPath: '/api/v1/general/split-by-size-or-count',
      splitType: 1,
      hint: 'Her çıktı dosyasındaki sayfa sayısını girin (örn. 10).'
    },
    {
      id: 'byDocCount',
      label: 'Belge sayısına göre böl',
      shortLabel: 'Belge sayısı',
      apiPath: '/api/v1/general/split-by-size-or-count',
      splitType: 2,
      hint: 'Oluşturulacak toplam dosya sayısını girin (örn. 5).'
    },
    {
      id: 'byPageDivider',
      label: 'Sayfa ayırıcısına göre böl',
      shortLabel: 'Sayfa ayırıcı',
      apiPath: '/api/v1/misc/auto-split-pdf',
      hint: 'Taranmış PDF\'te ayırıcı (QR/barkod) sayfalarını algılar ve belgeleri otomatik ayırır.'
    },
    {
      id: 'byPoster',
      label: 'Baskı parçalarına böl',
      shortLabel: 'Baskı parçaları',
      apiPath: '/api/v1/general/split-for-poster-print',
      hint: 'Büyük sayfaları A4/Letter gibi standart boyutlarda yazdırılabilir parçalara böler.'
    }
  ];

  var POSTER_PAGE_SIZES = ['A4', 'Letter', 'A3', 'A5', 'Legal', 'Tabloid'];

  var SECTION_SPLIT_MODES = [
    { value: 'SPLIT_ALL', label: 'Tüm sayfalar' },
    { value: 'SPLIT_ALL_EXCEPT_FIRST', label: 'İlk sayfa hariç' },
    { value: 'SPLIT_ALL_EXCEPT_LAST', label: 'Son sayfa hariç' },
    { value: 'SPLIT_ALL_EXCEPT_FIRST_AND_LAST', label: 'İlk ve son hariç' },
    { value: 'CUSTOM', label: 'Özel sayfa seçimi' }
  ];

  function getMode(id) {
    for (var i = 0; i < SPLIT_MODES.length; i++) {
      if (SPLIT_MODES[i].id === id) return SPLIT_MODES[i];
    }
    return SPLIT_MODES[0];
  }

  function getApiPath(modeId) {
    var mode = getMode(modeId);
    return mode ? mode.apiPath : '';
  }

  function validateMode(modeId, form) {
    var mode = getMode(modeId);
    if (!mode) return 'Bölme yöntemi seçin.';
    if (mode.id === 'byPages') {
      var pages = ((form.querySelector('[name="pageNumbers"]') || {}).value || '').trim();
      if (!pages) return 'Sayfa numaraları girin (örn. 1,5,10).';
      if (global.SecuriPages) {
        var maxP = form._pdfFileMeta && form._pdfFileMeta.pageCount;
        var pErr = global.SecuriPages.validate(pages, { maxPages: maxP, allowAll: false, minKeep: 0 });
        if (pErr) return pErr;
      }
    }
    if (mode.id === 'byChapters') {
      var lvl = form.querySelector('[name="bookmarkLevel"]');
      if (!lvl || lvl.value === '') return 'Yer imi seviyesi girin (0 = en üst).';
    }
    if (mode.id === 'bySections') {
      var h = form.querySelector('[name="horizontalDivisions"]');
      var v = form.querySelector('[name="verticalDivisions"]');
      if (!h || !v || Number(h.value) < 1 || Number(v.value) < 1) {
        return 'Yatay ve dikey bölüm sayısı en az 1 olmalı.';
      }
      if ((form.querySelector('[name="splitMode"]') || {}).value === 'CUSTOM') {
        var pn = ((form.querySelector('[name="pageNumbers"]') || {}).value || '').trim();
        if (!pn) return 'Özel mod için sayfa seçimi girin.';
      }
    }
    if (mode.id === 'byFileSize' || mode.id === 'byPageCount' || mode.id === 'byDocCount') {
      var sv = ((form.querySelector('[name="splitValue"]') || {}).value || '').trim();
      if (!sv) return 'Bölme değeri girin.';
      if (mode.id !== 'byFileSize' && !/^\d+$/.test(sv)) {
        return 'Sayısal bir değer girin.';
      }
    }
    if (mode.id === 'byPoster') {
      var ps = form.querySelector('[name="pageSize"]');
      var xf = form.querySelector('[name="xfactor"]');
      var yf = form.querySelector('[name="yfactor"]');
      if (!ps || !ps.value) return 'Hedef sayfa boyutu seçin.';
      if (!xf || !yf || Number(xf.value) < 1 || Number(yf.value) < 1) {
        return 'Yatay ve dikey bölüm sayısı en az 1 olmalı.';
      }
    }
    return '';
  }

  global.SecuriSplit = {
    SPLIT_MODES: SPLIT_MODES,
    POSTER_PAGE_SIZES: POSTER_PAGE_SIZES,
    SECTION_SPLIT_MODES: SECTION_SPLIT_MODES,
    getMode: getMode,
    getApiPath: getApiPath,
    validateMode: validateMode
  };
})(typeof window !== 'undefined' ? window : this);
