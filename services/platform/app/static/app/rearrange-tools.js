(function (global) {
  'use strict';

  var REARRANGE_MODES = [
    {
      value: 'CUSTOM',
      label: 'Özel sıra (sürükle veya düzenle)',
      desc: 'Sayfa kutularını sürükleyerek yeni sırayı belirleyin. Her kutudaki numara orijinal PDF\'teki sayfadır.'
    },
    {
      value: 'REVERSE_ORDER',
      label: 'Ters çevir',
      desc: 'Son sayfa başa gelir; sıra tamamen tersine döner (1,2,3,4 → 4,3,2,1).'
    },
    {
      value: 'DUPLEX_SORT',
      label: 'Dubleks tarama sırası',
      desc: 'Çift taraflı tarayıcıdan gelen sayfa sırasını okuma düzenine çevirir.'
    },
    {
      value: 'BOOKLET_SORT',
      label: 'Kitapçık baskısı',
      desc: 'Sayfalar kitapçık / ciltleme baskısına uygun sıraya dizilir.'
    },
    {
      value: 'ODD_EVEN_SPLIT',
      label: 'Tek / çift ayır',
      desc: 'Tek numaralı ve çift numaralı sayfalar ayrı gruplara ayrılır.'
    },
    {
      value: 'ODD_EVEN_MERGE',
      label: 'Tek / çift birleştir',
      desc: 'Ayrılmış tek/çift sayfa akışları tekrar birleştirilir.'
    },
    {
      value: 'REMOVE_FIRST',
      label: 'İlk sayfayı kaldır',
      desc: 'Belgenin ilk sayfası çıkarılır, kalan sayfalar korunur.'
    },
    {
      value: 'REMOVE_LAST',
      label: 'Son sayfayı kaldır',
      desc: 'Belgenin son sayfası çıkarılır, kalan sayfalar korunur.'
    }
  ];

  function getMode(value) {
    for (var i = 0; i < REARRANGE_MODES.length; i++) {
      if (REARRANGE_MODES[i].value === value) return REARRANGE_MODES[i];
    }
    return REARRANGE_MODES[0];
  }

  global.SecuriRearrange = {
    MODES: REARRANGE_MODES,
    getMode: getMode
  };
})(typeof window !== 'undefined' ? window : this);
