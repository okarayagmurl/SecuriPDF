(function (global) {
  'use strict';

  var SC = global.SecuriCrop;

  function meta(form) {
    return form._pdfFileMeta || null;
  }

  function pageCount(form) {
    var m = meta(form);
    return m && m.pageCount ? m.pageCount : null;
  }

  function appendSection(form, input) {
    var section = document.createElement('div');
    section.className = 'tool-section';
    if (input && input.sectionTitle) {
      var head = document.createElement('div');
      head.className = 'tool-section-head';
      head.innerHTML = '<span class="tool-section-title">' + escapeHtml(input.sectionTitle) + '</span>';
      section.appendChild(head);
    }
    var body = document.createElement('div');
    body.className = 'tool-section-body tp-panel';
    section.appendChild(body);
    form.appendChild(section);
    return body;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function hidden(name, value) {
    var el = document.createElement('input');
    el.type = 'hidden';
    el.name = name;
    el.value = value != null ? String(value) : '';
    return el;
  }

  function label(text) {
    var el = document.createElement('span');
    el.className = 'tp-label field-label';
    el.textContent = text;
    return el;
  }

  function hint(text) {
    var el = document.createElement('p');
    el.className = 'tp-hint compress-level-hint';
    el.textContent = text;
    return el;
  }

  function infoBox(html) {
    var el = document.createElement('div');
    el.className = 'tp-info-box';
    el.innerHTML = html;
    return el;
  }

  function tileGroup(name, options, defaultVal, ariaLabel) {
    var wrap = document.createElement('div');
    wrap.className = 'tp-tiles';
    wrap.setAttribute('role', 'group');
    if (ariaLabel) wrap.setAttribute('aria-label', ariaLabel);
    var hid = hidden(name, defaultVal);
    var tiles = [];
    options.forEach(function (opt) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tp-tile' + (String(opt.value) === String(defaultVal) ? ' active' : '');
      btn.setAttribute('data-value', opt.value);
      btn.innerHTML = opt.icon ? '<span class="tp-tile-icon">' + opt.icon + '</span>' : '';
      var cap = document.createElement('span');
      cap.className = 'tp-tile-label';
      cap.textContent = opt.label;
      btn.appendChild(cap);
      if (opt.sub) {
        var sub = document.createElement('span');
        sub.className = 'tp-tile-sub';
        sub.textContent = opt.sub;
        btn.appendChild(sub);
      }
      btn.addEventListener('click', function () {
        hid.value = String(opt.value);
        tiles.forEach(function (t) { t.classList.toggle('active', t === btn); });
        if (wrap._onChange) wrap._onChange(hid.value);
      });
      tiles.push(btn);
      wrap.appendChild(btn);
    });
    return { wrap: wrap, hidden: hid, tiles: tiles };
  }

  function sliderField(name, lbl, cfg) {
    var row = document.createElement('div');
    row.className = 'tp-slider-row';
    row.appendChild(label(lbl));
    var valEl = document.createElement('span');
    valEl.className = 'tp-slider-value';
    var hid = hidden(name, cfg.default != null ? cfg.default : cfg.min);
    var range = document.createElement('input');
    range.type = 'range';
    range.className = 'tp-slider';
    range.min = String(cfg.min);
    range.max = String(cfg.max);
    if (cfg.step != null) range.step = String(cfg.step);
    range.value = String(cfg.default != null ? cfg.default : cfg.min);
    function sync() {
      var v = cfg.step && cfg.step < 1 ? parseFloat(range.value) : parseInt(range.value, 10);
      hid.value = String(v);
      valEl.textContent = cfg.format ? cfg.format(v) : String(v);
      if (cfg.onChange) cfg.onChange(v);
    }
    range.addEventListener('input', sync);
    sync();
    row.appendChild(valEl);
    row.appendChild(range);
    row.appendChild(hid);
    if (cfg.hint) row.appendChild(hint(cfg.hint));
    return row;
  }

  function checkCard(name, cardLabel, defaultChecked, desc) {
    var card = document.createElement('label');
    card.className = 'tp-check-card';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = name;
    cb.value = 'true';
    if (defaultChecked) cb.checked = true;
    var body = document.createElement('div');
    body.className = 'tp-check-card-body';
    body.innerHTML = '<strong>' + escapeHtml(cardLabel) + '</strong>';
    if (desc) {
      var p = document.createElement('p');
      p.textContent = desc;
      body.appendChild(p);
    }
    card.appendChild(cb);
    card.appendChild(body);
    return card;
  }

  function textInput(name, lbl, cfg) {
    var row = document.createElement('label');
    row.className = 'tp-field';
    row.appendChild(label(lbl));
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'split-text-input';
    inp.name = name;
    if (cfg && cfg.placeholder) inp.placeholder = cfg.placeholder;
    if (cfg && cfg.default != null) inp.value = String(cfg.default);
    if (cfg && cfg.required) inp.required = true;
    row.appendChild(inp);
    if (cfg && cfg.hint) row.appendChild(hint(cfg.hint));
    return row;
  }

  function passwordInput(name, lbl) {
    var row = document.createElement('label');
    row.className = 'tp-field tp-password-wrap';
    row.appendChild(label(lbl));
    var inp = document.createElement('input');
    inp.type = 'password';
    inp.className = 'split-text-input';
    inp.name = name;
    inp.required = true;
    inp.autocomplete = 'current-password';
    row.appendChild(inp);
    return row;
  }

  function textareaInput(name, lbl, cfg) {
    var row = document.createElement('label');
    row.className = 'tp-field';
    row.appendChild(label(lbl));
    var ta = document.createElement('textarea');
    ta.className = 'split-text-input split-textarea';
    ta.name = name;
    ta.rows = (cfg && cfg.rows) || 6;
    if (cfg && cfg.placeholder) ta.placeholder = cfg.placeholder;
    if (cfg && cfg.default != null) ta.value = String(cfg.default);
    if (cfg && cfg.required) ta.required = true;
    row.appendChild(ta);
    if (cfg && cfg.hint) row.appendChild(hint(cfg.hint));
    return row;
  }

  function mount(body, nodes) {
    nodes.forEach(function (n) { if (n) body.appendChild(n); });
  }

  function bindMetaRefresh(form, fn) {
    var prev = form._refreshPdfPageMeta;
    form._refreshPdfPageMeta = function () {
      if (typeof prev === 'function') prev();
      fn();
    };
    fn();
  }

  /* ── Panel renderers ── */

  function panelResultDownloadNote(body, outputDesc, introHtml) {
    var T = global.SecuriTips;
    var box = infoBox(
      (introHtml || '') +
      '<p class="tp-result-note"><strong>Not:</strong> İşlem tamamlandığında sonuç dosyası otomatik indirilir.</p>' +
      '<p><strong>Çıktı:</strong> ' + outputDesc + '</p>'
    );
    body.appendChild(box);
    var note = box.querySelector('.tp-result-note');
    if (T && note) {
      T.attach(note, 'İndirme tarayıcı ayarlarınıza bağlıdır; engellenirse İşlerim sayfasından tekrar deneyin.');
    }
  }

  function panelScalePages(body, form, cleanups) {
    var P = global.SecuriPdfPreview;
    var sizes = tileGroup('pageSize', [
      { value: 'KEEP', label: 'Koru', sub: 'Mevcut boyut' },
      { value: 'A4', label: 'A4', sub: '210×297 mm' },
      { value: 'LETTER', label: 'Letter', sub: '216×279 mm' },
      { value: 'LEGAL', label: 'Legal', sub: '216×356 mm' },
      { value: 'A3', label: 'A3', sub: '297×420 mm' },
      { value: 'A5', label: 'A5', sub: '148×210 mm' }
    ], 'A4', 'Hedef sayfa boyutu');
    mount(body, [label('Hedef sayfa boyutu'), sizes.wrap, sizes.hidden]);

    var previewHost = document.createElement('div');
    previewHost.className = 'tp-scale-preview-host';
    body.appendChild(previewHost);

    var previewBar = document.createElement('div');
    previewBar.className = 'tp-preview-bar';
    previewBar.innerHTML = '<div class="tp-preview-bar-inner" style="width:100%"></div>';
    var scaleOverlay = document.createElement('div');
    scaleOverlay.className = 'tp-scale-overlay';
    scaleOverlay.hidden = true;

    if (P) {
      var previewCleanup = P.mount(previewHost, form, { showNav: true, minHeight: 200 });
      if (previewCleanup) cleanups.push(previewCleanup);
      bindMetaRefresh(form, function () {
        var has = meta(form) && meta(form).fileName;
        scaleOverlay.hidden = !has;
        previewHost.hidden = !has;
      });
      var stage = previewHost.querySelector('.ui-pdf-preview-stage');
      if (stage) {
        stage.style.position = 'relative';
        stage.appendChild(scaleOverlay);
      }
    }

    var scaleRow = sliderField('scaleFactor', 'İçerik ölçeği', {
      min: 0.1, max: 5, step: 0.05, default: 1,
      format: function (v) { return '×' + v.toFixed(2); },
      hint: '1 = orijinal boyut; 0.9 küçültür, 1.1 büyütür.',
      onChange: function (v) {
        var pct = Math.min(100, Math.round(v * 100));
        previewBar.querySelector('.tp-preview-bar-inner').style.width = pct + '%';
        scaleOverlay.style.width = pct + '%';
        scaleOverlay.style.height = pct + '%';
      }
    });
    mount(body, [previewBar, scaleRow]);
  }

  function panelMultiPageLayout(body) {
    var gridPreview = document.createElement('div');
    gridPreview.className = 'tp-grid-preview';
    function drawGrid(cols, rows) {
      gridPreview.innerHTML = '';
      gridPreview.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
      gridPreview.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)';
      for (var i = 0; i < cols * rows; i++) {
        var cell = document.createElement('span');
        cell.className = 'tp-grid-cell';
        gridPreview.appendChild(cell);
      }
    }
    var layouts = {
      '2': [1, 2], '4': [2, 2], '9': [3, 3], '16': [4, 4]
    };
    var pages = tileGroup('pagesPerSheet', [
      { value: '2', label: '2-up', sub: '1×2' },
      { value: '4', label: '4-up', sub: '2×2' },
      { value: '9', label: '9-up', sub: '3×3' },
      { value: '16', label: '16-up', sub: '4×4' }
    ], '4', 'Sayfa düzeni');
    pages.wrap._onChange = function (v) {
      var g = layouts[v] || [2, 2];
      drawGrid(g[0], g[1]);
    };
    drawGrid(2, 2);
    mount(body, [label('Sayfa / yaprak'), pages.wrap, pages.hidden, gridPreview,
      checkCard('addBorder', 'Kenarlık ekle', false, 'Sayfalar arasında ince ayırıcı çizgi gösterir.')]);
  }

  function panelOverlayPdf(body) {
    var mode = tileGroup('overlayMode', [
      { value: 'SequentialOverlay', label: 'Sıralı', sub: 'Ana PDF üzerine sırayla' },
      { value: 'InterleavedOverlay', label: 'Dönüşümlü', sub: 'Sayfaları karıştırarak' },
      { value: 'FixedRepeatOverlay', label: 'Sabit tekrar', sub: 'Katmanı tekrarla' }
    ], 'SequentialOverlay', 'Katman modu');
    var pos = tileGroup('overlayPosition', [
      { value: '0', label: 'Ön plan', sub: 'Üstte' },
      { value: '1', label: 'Arka plan', sub: 'Altta' }
    ], '0', 'Konum');
    mount(body, [label('Katman modu'), mode.wrap, mode.hidden, label('Konum'), pos.wrap, pos.hidden]);
  }

  function panelRemoveBlanks(body) {
    mount(body, [
      sliderField('threshold', 'Beyazlık eşiği', {
        min: 0, max: 255, step: 1, default: 10,
        format: function (v) { return v + ' / 255'; },
        hint: 'Pikselin beyaz sayılması için gereken minimum değer. Düşük = daha hassas.'
      }),
      sliderField('whitePercent', 'Beyaz yüzde', {
        min: 50, max: 100, step: 0.1, default: 99.9,
        format: function (v) { return '%' + v.toFixed(1); },
        hint: 'Sayfanın bu kadar yüzdesi beyazsa boş kabul edilir.'
      })
    ]);
  }

  function panelAddImage(body, form, cleanups) {
    var P = global.SecuriPdfPreview;
    var pageHidden = hidden('pageNumber', '1');
    var scaleRow = sliderField('imageScalePercent', 'Görsel boyutu (%)', {
      min: 10, max: 200, step: 5, default: 100,
      hint: 'Orijinal görsel boyutuna göre ölçek (Stirling varsayılan boyut).'
    });
    var empty = infoBox('<p>PDF seçtikten sonra önizlemede sayfa değiştirip konumu tıklayarak belirleyin. Yalnızca seçili sayfaya eklemek için «Tüm sayfalara ekle» kapalı olmalıdır.</p>');
    var workspace = document.createElement('div');
    workspace.className = 'tp-pos-workspace';
    workspace.hidden = true;
    var stage = document.createElement('div');
    stage.className = 'tp-pos-stage tp-pos-stage-pdf';
    var markerLayer = document.createElement('div');
    markerLayer.className = 'tp-pos-marker-layer';
    markerLayer.style.cssText = 'position:absolute;inset:0;z-index:2;cursor:crosshair;';
    var marker = document.createElement('div');
    marker.className = 'tp-pos-marker';
    marker.hidden = true;
    markerLayer.appendChild(marker);
    stage.appendChild(markerLayer);
    workspace.appendChild(stage);
    workspace.appendChild(hint('Sayfa üzerinde tıklayarak X/Y konumunu ayarlayın (pt).'));

    var coordRow = document.createElement('div');
    coordRow.className = 'tp-field-grid';
    ['x', 'y'].forEach(function (k) {
      var cell = document.createElement('label');
      cell.className = 'tp-field';
      cell.appendChild(label(k === 'x' ? 'X (pt)' : 'Y (pt)'));
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'split-num-input';
      inp.min = '0';
      inp.step = '1';
      inp.value = '0';
      inp.name = k;
      inp.addEventListener('input', placeMarker);
      cell.appendChild(inp);
      coordRow.appendChild(cell);
    });

    function pageSize() {
      return SC ? SC.pageDims(null) : { width: 595, height: 842 };
    }

    function placeMarker() {
      var ps = pageSize();
      var previewFrame = stage.querySelector('.ui-pdf-preview-frame');
      var refEl = previewFrame || stage;
      var rect = refEl.getBoundingClientRect();
      if (!rect.width) return;
      var scale = ps.width / rect.width;
      var x = parseInt(coordRow.querySelector('[name=x]').value, 10) || 0;
      var y = parseInt(coordRow.querySelector('[name=y]').value, 10) || 0;
      marker.hidden = false;
      marker.style.left = Math.round(x / scale) + 'px';
      marker.style.top = Math.round(y / scale) + 'px';
    }

    function clickCoords(ev) {
      var iframe = stage.querySelector('.ui-pdf-preview-frame');
      var refEl = iframe || stage.querySelector('.ui-pdf-preview-stage') || stage;
      var rect = refEl.getBoundingClientRect();
      var ps = pageSize();
      if (!rect.width || !rect.height) return null;
      var scale = ps.width / rect.width;
      var x = Math.max(0, Math.round((ev.clientX - rect.left) * scale));
      var y = Math.max(0, Math.round((ev.clientY - rect.top) * scale));
      return { x: x, y: y };
    }

    markerLayer.addEventListener('click', function (ev) {
      if (ev.target.closest('.ui-pdf-preview-nav')) return;
      var pt = clickCoords(ev);
      if (!pt) return;
      coordRow.querySelector('[name=x]').value = String(pt.x);
      coordRow.querySelector('[name=y]').value = String(pt.y);
      if (typeof form._pdfPreviewGetPage === 'function') {
        pageHidden.value = String(form._pdfPreviewGetPage());
      }
      placeMarker();
    });

    if (P) {
      stage.style.position = 'relative';
      var previewCleanup = P.mount(stage, form, { showNav: true, minHeight: 360, onPageChange: function (p) {
        pageHidden.value = String(p);
      } });
      if (previewCleanup) cleanups.push(previewCleanup);
      var previewWrap = stage.querySelector('.ui-pdf-preview-wrap');
      if (previewWrap) stage.insertBefore(previewWrap, markerLayer);
    }

    bindMetaRefresh(form, function () {
      var has = meta(form) && meta(form).fileName;
      empty.hidden = !!has;
      workspace.hidden = !has;
      if (has) placeMarker();
    });

    mount(body, [empty, workspace, coordRow, scaleRow,
      checkCard('everyPage', 'Tüm sayfalara ekle', false, 'Kapalıyken yalnızca önizlemedeki seçili sayfaya eklenir.')]);
    body.appendChild(pageHidden);
  }

  function panelPdfToSinglePage(body, form) {
    var box = infoBox('<p>Tüm sayfalar dikey olarak tek uzun PDF sayfasında birleştirilir.</p><p class="tp-meta-line">Sayfa sayısı: <strong class="tp-page-count">—</strong></p>');
    bindMetaRefresh(form, function () {
      var cnt = pageCount(form);
      var el = box.querySelector('.tp-page-count');
      if (el) el.textContent = cnt ? cnt + ' sayfa birleştirilecek' : 'PDF seçin';
    });
    body.appendChild(box);
  }

  function panelBooklet(body) {
    var spine = tileGroup('spineLocation', [
      { value: 'LEFT', label: 'Sol cilt', sub: 'Soldan ciltle' },
      { value: 'RIGHT', label: 'Sağ cilt', sub: 'Sağdan ciltle' }
    ], 'LEFT', 'Cilt konumu');
    mount(body, [label('Cilt konumu'), spine.wrap, spine.hidden,
      checkCard('addGutter', 'Cilt payı ekle', true, 'Orta birleşim hattında baskı payı bırakır.'),
      sliderField('gutterSize', 'Cilt payı (pt)', { min: 0, max: 72, step: 1, default: 12 }),
      checkCard('doubleSided', 'Çift taraflı baskı', true, 'Kitapçık baskısı için sayfa çiftlerini düzenler.'),
      checkCard('addBorder', 'Kenarlık ekle', false, 'Sayfalar arası ince çizgi.')]);
  }

  function panelSanitize(body) {
    body.appendChild(infoBox(
      '<p><strong>PDF Temizle</strong> JavaScript, gömülü dosya, meta veri ve bağlantıları kaldırır; sayfa içeriğini beyaza boyamaz.</p>' +
      '<p>Temizleme SecuriPDF üzerinde (PyMuPDF) yapılır; <strong>gömülü fontlar korunur</strong> — bozuk karakter riski yoktur.</p>'
    ));
    var list = document.createElement('div');
    list.className = 'tp-checklist';
    [
      { name: 'removeJavaScript', label: 'JavaScript kaldır', desc: 'Belgedeki otomatik scriptleri temizler.', def: true },
      { name: 'removeEmbeddedFiles', label: 'Gömülü dosyalar', desc: 'Ek dosya eklerini kaldırır.', def: true },
      { name: 'removeXMPMetadata', label: 'XMP meta verisi', desc: 'Gelişmiş XMP bilgisini siler.', def: false },
      { name: 'removeMetadata', label: 'Belge bilgisi', desc: 'Başlık, yazar vb. alanları temizler.', def: false },
      { name: 'removeLinks', label: 'Bağlantılar', desc: 'Tıklanabilir URL ve linkleri kaldırır.', def: false }
    ].forEach(function (item) {
      list.appendChild(checkCard(item.name, item.label, item.def, item.desc));
    });
    body.appendChild(list);
  }

  function panelFlatten(body) {
    mount(body, [
      infoBox('<p>Form alanları ve etkileşimli öğeler statik sayfa içeriğine dönüştürülür; artık düzenlenemez hale gelir.</p>'),
      checkCard('flattenOnlyForms', 'Yalnızca formları düzleştir', false,
        'İşaretlenmezse tüm sayfa görsele rasterize edilir; işaretlenirse yalnızca form alanları düzleştirilir.')
    ]);
  }

  function panelRemovePassword(body) {
    mount(body, [
      infoBox(
        '<p><strong>Mevcut açma parolasını</strong> aşağıdaki alana girin; koruma kaldırılır.</p>' +
        '<p>Parola alanı boş bırakılamaz. Yanlış parolada işlem hata verir.</p>'
      ),
      passwordInput('password', 'Mevcut açma parolası')
    ]);
  }

  function panelUpdateMetadata(body) {
    mount(body, [
      checkCard('deleteAll', 'Tüm meta veriyi sil', false, 'Mevcut tüm belge bilgilerini temizler.'),
      textInput('title', 'Başlık', { placeholder: 'Belge başlığı' }),
      textInput('author', 'Yazar', {}),
      textInput('subject', 'Konu', {}),
      textInput('keywords', 'Anahtar kelimeler', {})
    ]);
  }

  function panelReplaceInvert(body) {
    var mode = tileGroup('replaceAndInvertOption', [
      { value: 'HIGH_CONTRAST_COLOR', label: 'Yüksek kontrast', sub: 'Okunabilirlik' },
      { value: 'CUSTOM_COLOR', label: 'Özel renk', sub: 'Renk seçici' },
      { value: 'FULL_INVERSION', label: 'Tam ters', sub: 'Negatif' },
      { value: 'COLOR_SPACE_CONVERSION', label: 'Renk uzayı', sub: 'CMYK dönüşüm' }
    ], 'HIGH_CONTRAST_COLOR', 'İşlem modu');
    var contrastWrap = document.createElement('div');
    contrastWrap.className = 'tp-conditional';
    var contrast = tileGroup('highContrastColorCombination', [
      { value: 'WHITE_TEXT_ON_BLACK', label: 'Beyaz / Siyah' },
      { value: 'BLACK_TEXT_ON_WHITE', label: 'Siyah / Beyaz' },
      { value: 'YELLOW_TEXT_ON_BLACK', label: 'Sarı / Siyah' },
      { value: 'GREEN_TEXT_ON_BLACK', label: 'Yeşil / Siyah' }
    ], 'WHITE_TEXT_ON_BLACK', 'Kontrast kombinasyonu');
    contrastWrap.appendChild(label('Kontrast kombinasyonu'));
    contrastWrap.appendChild(contrast.wrap);
    contrastWrap.appendChild(contrast.hidden);

    var customWrap = document.createElement('div');
    customWrap.className = 'tp-conditional';
    customWrap.hidden = true;
    function colorField(name, lbl, defHex) {
      var row = document.createElement('label');
      row.className = 'tp-field';
      row.appendChild(label(lbl));
      var wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:0.5rem;align-items:center;';
      var color = document.createElement('input');
      color.type = 'color';
      color.value = defHex;
      var text = document.createElement('input');
      text.type = 'text';
      text.className = 'split-text-input';
      text.name = name;
      text.value = defHex;
      text.placeholder = defHex;
      color.addEventListener('input', function () { text.value = color.value; });
      text.addEventListener('input', function () {
        var v = text.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(v)) color.value = v;
      });
      wrap.appendChild(color);
      wrap.appendChild(text);
      row.appendChild(wrap);
      row.appendChild(hint('Stirling 24-bit renk değeri olarak gönderilir.'));
      return row;
    }
    customWrap.appendChild(colorField('backGroundColor', 'Arka plan rengi', '#000000'));
    customWrap.appendChild(colorField('textColor', 'Metin rengi', '#FFFFFF'));

    mode.wrap._onChange = function (v) {
      contrastWrap.hidden = v !== 'HIGH_CONTRAST_COLOR';
      customWrap.hidden = v !== 'CUSTOM_COLOR';
    };

    mount(body, [label('İşlem modu'), mode.wrap, mode.hidden, contrastWrap, customWrap]);
  }

  function panelPdfToImg(body) {
    var fmt = tileGroup('imageFormat', [
      { value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' },
      { value: 'webp', label: 'WebP' }, { value: 'tiff', label: 'TIFF' }
    ], 'png', 'Görsel formatı');
    var color = tileGroup('colorType', [
      { value: 'color', label: 'Renkli' }, { value: 'grayscale', label: 'Gri ton' },
      { value: 'blackwhite', label: 'S/B' }
    ], 'color', 'Renk modu');
    var out = tileGroup('singleOrMultiple', [
      { value: 'multiple', label: 'ZIP', sub: 'Sayfa başına dosya' },
      { value: 'single', label: 'Tek dosya', sub: 'Birleşik çıktı' }
    ], 'multiple', 'Çıktı yapısı');
    mount(body, [
      label('Görsel formatı'), fmt.wrap, fmt.hidden,
      sliderField('dpi', 'Çözünürlük (DPI)', { min: 72, max: 600, step: 1, default: 300 }),
      label('Renk modu'), color.wrap, color.hidden,
      label('Çıktı yapısı'), out.wrap, out.hidden
    ]);
  }

  function panelImgToPdf(body) {
    var fit = tileGroup('fitOption', [
      { value: 'maintainAspectRatio', label: 'Oranı koru', sub: 'Kenar boşluğu' },
      { value: 'fitDocumentToPage', label: 'Sığdır', sub: 'Sayfaya oturt' },
      { value: 'fillPage', label: 'Doldur', sub: 'Kırparak doldur' }
    ], 'maintainAspectRatio', 'Sayfaya sığdırma');
    mount(body, [label('Sayfaya sığdırma'), fit.wrap, fit.hidden,
      checkCard('autoRotate', 'Otomatik döndür', true, 'EXIF yönelimine göre görseli döndürür.')]);
  }

  function panelOutputFormat(body, name, options, defaultVal, title) {
    var g = tileGroup(name, options, defaultVal, title);
    mount(body, [label(title), g.wrap, g.hidden]);
  }

  function panelPdfToWord(body) {
    panelOutputFormat(body, 'outputFormat', [
      { value: 'docx', label: 'DOCX', sub: 'Word' }, { value: 'odt', label: 'ODT', sub: 'LibreOffice' }
    ], 'docx', 'Çıktı formatı');
  }

  function panelPdfToPresentation(body) {
    panelOutputFormat(body, 'outputFormat', [
      { value: 'pptx', label: 'PPTX' }, { value: 'odp', label: 'ODP' }
    ], 'pptx', 'Çıktı formatı');
  }

  function panelPdfToText(body) {
    panelOutputFormat(body, 'outputFormat', [
      { value: 'txt', label: 'TXT', sub: 'Düz metin' }, { value: 'rtf', label: 'RTF' }
    ], 'txt', 'Çıktı formatı');
  }

  function panelPdfToPdfa(body) {
    panelOutputFormat(body, 'outputFormat', [
      { value: 'pdfa-1b', label: 'PDF/A-1b' },
      { value: 'pdfa-2b', label: 'PDF/A-2b' },
      { value: 'pdfa-3b', label: 'PDF/A-3b' }
    ], 'pdfa-2b', 'PDF/A seviyesi');
  }

  function panelPdfToEpub(body) {
    panelOutputFormat(body, 'outputFormat', [
      { value: 'EPUB', label: 'EPUB' }, { value: 'AZW3', label: 'AZW3', sub: 'Kindle' }
    ], 'EPUB', 'Çıktı formatı');
    var device = tileGroup('targetDevice', [
      { value: 'TABLET_PHONE_IMAGES', label: 'Tablet / telefon', sub: 'Görselli' },
      { value: 'KINDLE_EINK_TEXT', label: 'Kindle', sub: 'Metin odaklı' }
    ], 'TABLET_PHONE_IMAGES', 'Hedef cihaz');
    mount(body, [label('Hedef cihaz'), device.wrap, device.hidden,
      checkCard('detectChapters', 'Bölüm algılama', true, 'PDF başlıklarından bölüm oluşturur.')]);
  }

  function panelPdfToCbz(body) {
    mount(body, [sliderField('dpi', 'Görsel çözünürlüğü (DPI)', { min: 72, max: 600, step: 1, default: 150 })]);
  }

  function panelPdfToCbr(body) { panelPdfToCbz(body); }

  function panelHtmlToPdf(body) {
    mount(body, [sliderField('zoom', 'Yakınlaştırma', {
      min: 0.1, max: 3, step: 0.1, default: 1,
      format: function (v) { return '×' + v.toFixed(1); }
    })]);
  }

  function panelEmlToPdf(body) {
    mount(body, [checkCard('includeAttachments', 'E-posta eklerini dahil et', true, 'EML içindeki dosya eklerini PDF\'e ekler.')]);
  }

  function panelExtractImages(body) {
    var fmt = tileGroup('format', [
      { value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'gif', label: 'GIF' }
    ], 'png', 'Görsel formatı');
    mount(body, [
      infoBox('<p>Yalnızca PDF\'e <strong>gömülü</strong> XObject görseller çıkarılır. Taranmış sayfa içeriği (tam sayfa raster) genelde gömülü görsel değildir.</p>'),
      label('Görsel formatı'), fmt.wrap, fmt.hidden,
      checkCard('allowDuplicates', 'Yinelenen görselleri kaydet', false, 'Aynı görsel birden fazla kez çıkarılır.')
    ]);
  }

  function panelScannerEffect(body) {
    var q = tileGroup('quality', [
      { value: 'low', label: 'Düşük', sub: 'Hızlı' },
      { value: 'medium', label: 'Orta', sub: 'Önerilen' },
      { value: 'high', label: 'Yüksek', sub: 'Yavaş' }
    ], 'medium', 'Kalite');
    var rot = tileGroup('rotation', [
      { value: 'none', label: 'Yok' },
      { value: 'slight', label: 'Hafif', sub: 'Önerilen' },
      { value: 'moderate', label: 'Orta' },
      { value: 'severe', label: 'Güçlü' }
    ], 'slight', 'Eğim');
    mount(body, [
      infoBox('<p>Tarama efekti Stirling üzerinde işlenir. «Yüksek» kalite bazı ortamlarda motor hatası verebilir — önce Orta deneyin.</p>'),
      label('Kalite ön ayarı'), q.wrap, q.hidden,
      label('Tarama eğimi'), rot.wrap, rot.hidden,
      checkCard('yellowish', 'Sararmış kağıt tonu', true, 'Hafif sarı kağıt efekti uygular.')
    ]);
  }

  function panelPdfToCsv(body, outputFormat) {
    mount(body, [
      hidden('outputFormat', outputFormat || 'csv'),
      textInput('pageNumbers', 'Sayfa aralığı', {
        default: 'all', placeholder: 'all veya 1,3,5-9',
        hint: 'Tüm sayfalar için "all" yazın veya virgülle ayırın.'
      })
    ]);
  }

  function panelPdfToXlsx(body) { panelPdfToCsv(body, 'xlsx'); }

  function panelCbzToPdf(body) {
    mount(body, [checkCard('optimizeForEbook', 'e-Kitap optimizasyonu', false, 'e-Kitap okuyucular için sayfa düzenini optimize eder.')]);
  }

  function panelVectorToPdf(body) {
    mount(body, [
      infoBox(
        '<p>EPS / PS / EPSF dosyası yükleyin. Stirling dönüşümü <strong>dosya uzantısına</strong> göre yapar (.eps, .ps, .epsf).</p>' +
        '<p>PCL / XPS → PDF bu sürümde GhostPDL gerektirir; desteklenmez.</p>'
      ),
      checkCard('prepress', 'Baskı ön işleme (prepress)', false, 'Ghostscript PDFSETTINGS=/prepress uygular.')
    ]);
  }

  function panelPdfToVector(body) {
    var fmt = tileGroup('outputFormat', [
      { value: 'eps', label: 'EPS' }, { value: 'ps', label: 'PS' },
      { value: 'pcl', label: 'PCL' }, { value: 'xps', label: 'XPS' }
    ], 'eps', 'Çıktı formatı');
    mount(body, [
      infoBox(
        '<p>EPS bazı Ghostscript kurulumlarında başarısız olabilir — önce <strong>PS</strong> deneyin.</p>' +
        '<p>Çıktı adı girdi PDF adından türetilir (çift uzantı eklenmez).</p>'
      ),
      label('Çıktı formatı'), fmt.wrap, fmt.hidden,
      checkCard('prepress', 'Baskı ön işleme', false, 'Profesyonel baskı için prepress modu.')
    ]);
  }

  function panelEbookToPdf(body) {
    mount(body, [
      checkCard('embedAllFonts', 'Tüm fontları göm', false, 'Calibre ebook-convert --embed-all-fonts.'),
      checkCard('optimizeForEbook', 'e-Kitap optimizasyonu', false, 'Ghostscript ile boyut/okuma optimizasyonu.'),
      checkCard('includeTableOfContents', 'İçindekiler tablosu', false, 'PDF\'e içindekiler sayfası ekler.'),
      checkCard('includePageNumbers', 'Sayfa numaraları', false, 'Sayfa numaralarını ekler.')
    ]);
  }

  function panelAutoRename(body) {
    mount(body, [checkCard('useFirstTextAsFallback', 'Başlık yoksa ilk metin satırını kullan', false,
      'Meta veride başlık yoksa belgedeki ilk metin satırı dosya adı olarak önerilir.')]);
  }

  function panelAddAttachments(body) {
    mount(body, [checkCard('convertToPdfA3b', 'PDF/A-3b uyumluluğu', false,
      'Ekleri PDF/A-3b uyumlu formata dönüştürür.')]);
  }

  function panelExtractImageScans(body) {
    mount(body, [
      sliderField('angleThreshold', 'Eğim eşiği (°)', { min: 0, max: 45, step: 1, default: 5 }),
      sliderField('tolerance', 'Tolerans', { min: 1, max: 100, step: 1, default: 35 }),
      sliderField('minArea', 'Minimum alan (px²)', { min: 100, max: 50000, step: 100, default: 5000 })
    ]);
  }

  function panelEditToc(body) {
    mount(body, [
      infoBox(
        '<p>Bu araç PDF <strong>yer imlerini</strong> (bookmark / outline) günceller — ayrı bir «içindekiler sayfası» basmaz.</p>' +
        '<p>JSON dizisi: her öğede <code>title</code> ve <code>pageNumber</code> zorunlu. Örnek:</p>' +
        '<p><code>[{"title":"Bölüm 1","pageNumber":1,"children":[]}]</code></p>' +
        '<p>Sonuç PDF\'i Acrobat / tarayıcı yer imi panelinde görünür.</p>'
      ),
      textareaInput('bookmarkData', 'Yer imi JSON', {
        required: true,
        placeholder: '[{"title":"Bölüm 1","pageNumber":1,"children":[]}]',
        hint: 'Eski "page" alanı otomatik "pageNumber"a çevrilir.'
      }),
      checkCard('replaceExisting', 'Mevcut yer imlerini değiştir', true, 'Var olan yer imlerini silip yenisiyle değiştirir.')
    ]);
  }

  function panelAutoSplit(body) {
    mount(body, [
      infoBox(
        '<p><strong>Otomatik Ayır</strong> öncelikle Stirling resmi QR ayraç sayfasını arar.</p>' +
        '<ol style="margin:0.5rem 0 0 1.1rem;padding:0">' +
        '<li>Stirling ayraç PDF\'ini yazdırın (QR: github.com/Stirling-Tools/Stirling-PDF)</li>' +
        '<li>Belgeler arasına koyup tarayın veya birleştirin</li>' +
        '<li>Tek PDF yükleyin — çıktı ZIP</li></ol>' +
        '<p style="margin-top:0.6rem"><strong>Yedek:</strong> QR yoksa platform boş (beyaz) sayfaları ayraç olarak kullanır. ' +
        'İç boş sayfalar bölünür; ayraç sayfaları çıktıya dahil edilmez.</p>' +
        '<p style="margin-top:0.4rem">Ayraç yoksa ve boş sayfa da yoksa çıktıda değişiklik olmaz — test PDF\'ine boş sayfa veya QR ekleyin.</p>' +
        '<p style="margin-top:0.4rem">Ayraç indirme: ' +
        '<a href="https://github.com/Stirling-Tools/Stirling-PDF/issues/2281" target="_blank" rel="noopener">Stirling divider sayfaları</a></p>'
      ),
      checkCard('duplexMode', 'Dubleks tarama modu', false,
        'Ayraç (QR veya boş sayfa) bulunduğunda hemen sonraki sayfayı da atar.')
    ]);
  }

  function panelInfoOnly(body, html) {
    body.appendChild(infoBox(html));
  }

  function panelFileToPdf(body) {
    panelInfoOnly(body, '<p><strong>Desteklenen formatlar:</strong> Word (DOC/DOCX/ODT), Excel (XLS/XLSX/ODS), PowerPoint (PPT/PPTX/ODP), RTF, TXT.</p><p>Office belgenizi seçip işleyin; PDF çıktısı indirilebilir.</p>');
  }

  function panelUrlToPdf(body) {
    panelInfoOnly(body,
      '<p>Tam web adresini (http:// veya https://) girin. Örnek: <code>https://example.com</code></p>' +
      '<p>Platform sayfayı indirip HTML→PDF ile dönüştürür. <strong>JavaScript çalıştırılmaz</strong>; React/Vue SPA siteler eksik veya boş görünebilir — statik HTML siteler daha iyi sonuç verir.</p>'
    );
  }

  function panelCbrToPdf(body) {
    mount(body, [
      infoBox(
        '<p>CBR dosyası <strong>.cbr</strong> veya <strong>.rar</strong> uzantılı olmalıdır (RAR arşivi içinde görseller).</p>' +
        '<p><strong>RAR5 desteklenmez</strong> (Junrar). WinRAR/7-Zip ile RAR4 olarak yeniden paketleyin veya CBZ kullanın.</p>'
      ),
      checkCard('optimizeForEbook', 'e-Kitap optimizasyonu', false, 'Ghostscript ile boyut/okuma optimizasyonu.')
    ]);
  }

  function panelMarkdownToPdf(body) {
    panelInfoOnly(body, '<p>Markdown (.md) dosyanız standart biçimlendirme ile PDF\'e dönüştürülür.</p><p>Başlıklar, listeler ve kod blokları korunur.</p>');
  }

  function panelPdfToHtml(body) {
    panelInfoOnly(body, '<p>PDF belgesi HTML web sayfasına dönüştürülür. Metin ve temel düzen korunmaya çalışılır.</p>');
  }

  function panelPdfToXml(body) {
    panelInfoOnly(body, '<p>PDF yapısı XML formatında dışa aktarılır. Gelişmiş analiz ve entegrasyon için uygundur.</p>');
  }

  function panelPdfToMarkdown(body) {
    panelInfoOnly(body, '<p>PDF içeriği Markdown (.md) formatına dönüştürülür. Başlıklar ve paragraflar mümkün olduğunca korunur.</p>');
  }

  function panelRepair(body) {
    panelResultDownloadNote(body, 'Onarılmış PDF dosyası.',
      '<p>Bozuk veya açılmayan PDF dosyalarını onarmayı dener. Yapı hataları düzeltilir; içerik mümkün olduğunca korunur.</p>');
  }

  function panelGetInfo(body) {
    panelResultDownloadNote(body, 'JSON raporu (indirilebilir).',
      '<p>Belge meta verisi, sayfa sayısı, güvenlik özellikleri ve gömülü dosyalar hakkında ayrıntılı rapor üretilir.</p>');
  }

  function panelVerify(body) {
    panelResultDownloadNote(body, 'Doğrulama JSON raporu.',
      '<p>PDF bütünlüğü, şifreleme durumu ve yapısal geçerlilik kontrol edilir.</p>');
  }

  function panelValidateSignature(body) {
    panelResultDownloadNote(body, 'İmza doğrulama JSON raporu.',
      '<p>PDF üzerindeki dijital imza doğrulanır; sertifika geçerliliği ve imza durumu raporlanır.</p>');
  }

  function panelRemoveCertSign(body) {
    panelInfoOnly(body,
      '<p>PDF üzerindeki <strong>dijital sertifika imzasını</strong> (PKCS#7) kaldırmayı dener.</p>' +
      '<p>Görsel damga / filigran imza değildir. İmza yoksa veya kaldırılamazsa işlem hata verir.</p>' +
      '<p><strong>Çıktı:</strong> İmzasız PDF.</p>'
    );
  }

  function panelUnlockForms(body) {
    panelInfoOnly(body, '<p>PDF form alanlarının düzenleme kısıtlaması kaldırılır; alanlar tekrar doldurulabilir hale gelir.</p><p><strong>Çıktı:</strong> Kilitsiz PDF formu.</p>');
  }

  function panelRemoveImage(body) {
    panelInfoOnly(body, '<p>PDF içindeki gömülü görseller kaldırılarak dosya boyutu küçültülür. Metin içeriği korunur.</p><p><strong>Çıktı:</strong> Görselsiz PDF.</p>');
  }

  function panelExtractAttachments(body) {
    panelInfoOnly(body,
      '<p>PDF\'e gömülü dosya ekleri ZIP arşivi olarak çıkarılır.</p>' +
      '<p>Ek yoksa işlem boş ZIP yerine hata verir. Önce «Ek Dosya Ekle» ile ek gömülü olduğundan emin olun.</p>' +
      '<p><strong>Çıktı:</strong> ZIP arşivi.</p>'
    );
  }

  var PANELS = {
    'scale-pages': panelScalePages,
    'multi-page-layout': panelMultiPageLayout,
    'overlay-pdf': panelOverlayPdf,
    'remove-blanks': panelRemoveBlanks,
    'add-image': panelAddImage,
    'pdf-to-single-page': panelPdfToSinglePage,
    'booklet-imposition': panelBooklet,
    'sanitize-pdf': panelSanitize,
    'flatten': panelFlatten,
    'remove-password': panelRemovePassword,
    'update-metadata': panelUpdateMetadata,
    'replace-invert-pdf': panelReplaceInvert,
    'pdf-to-img': panelPdfToImg,
    'img-to-pdf': panelImgToPdf,
    'pdf-to-word': panelPdfToWord,
    'pdf-to-presentation': panelPdfToPresentation,
    'pdf-to-text': panelPdfToText,
    'pdf-to-html': panelPdfToHtml,
    'pdf-to-pdfa': panelPdfToPdfa,
    'pdf-to-epub': panelPdfToEpub,
    'pdf-to-markdown': panelPdfToMarkdown,
    'pdf-to-xml': panelPdfToXml,
    'pdf-to-csv': panelPdfToCsv,
    'pdf-to-xlsx': panelPdfToXlsx,
    'pdf-to-cbz': panelPdfToCbz,
    'pdf-to-cbr': panelPdfToCbr,
    'html-to-pdf': panelHtmlToPdf,
    'markdown-to-pdf': panelMarkdownToPdf,
    'eml-to-pdf': panelEmlToPdf,
    'url-to-pdf': panelUrlToPdf,
    'extract-images': panelExtractImages,
    'extract-image-scans': panelExtractImageScans,
    'scanner-effect': panelScannerEffect,
    'add-attachments': panelAddAttachments,
    'extract-attachments': panelExtractAttachments,
    'auto-rename': panelAutoRename,
    'auto-split-pdf': panelAutoSplit,
    'edit-table-of-contents': panelEditToc,
    'repair': panelRepair,
    'get-info-on-pdf': panelGetInfo,
    'verify-pdf': panelVerify,
    'validate-signature': panelValidateSignature,
    'remove-cert-sign': panelRemoveCertSign,
    'unlock-pdf-forms': panelUnlockForms,
    'remove-image-pdf': panelRemoveImage,
    'cbz-to-pdf': panelCbzToPdf,
    'cbr-to-pdf': panelCbrToPdf,
    'vector-to-pdf': panelVectorToPdf,
    'pdf-to-vector': panelPdfToVector,
    'ebook-to-pdf': panelEbookToPdf,
    'file-to-pdf': panelFileToPdf
  };

  function render(form, toolId, input) {
    var fn = PANELS[toolId];
    if (!fn) return;
    var body = appendSection(form, input);
    var cleanups = [];
    form._toolPanelCleanup = function () {
      cleanups.forEach(function (c) { if (typeof c === 'function') c(); });
    };
    fn(body, form, cleanups);
  }

  global.SecuriToolPanels = { render: render };
})(typeof window !== 'undefined' ? window : this);
