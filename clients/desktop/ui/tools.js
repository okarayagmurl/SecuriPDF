// Field names and option values follow the Stirling-PDF 2.14.3 OpenAPI spec (/v1/api-docs).
(function () {
  const PDF = ".pdf,application/pdf";
  const IMAGES = ".jpg,.jpeg,.png,.gif,.bmp,.tif,.tiff,.webp,image/*";
  const UDF = ".udf";
  const XML = ".xml,text/xml,application/xml";
  const OFFICE = ".doc,.docx,.docm,.dot,.dotx,.rtf,.odt,.txt,.xls,.xlsx,.xlsm,.xlsb,.ods,.csv,.ppt,.pptx,.pptm,.pps,.ppsx,.odp";

  const MARGINS = [
    { value: "small", label: "Küçük" },
    { value: "medium", label: "Orta" },
    { value: "large", label: "Büyük" },
    { value: "x-large", label: "Çok büyük" },
  ];
  const COLOR_TYPES = [
    { value: "color", label: "Renkli" },
    { value: "greyscale", label: "Gri tonlamalı" },
    { value: "blackwhite", label: "Siyah-beyaz" },
  ];
  const ORIENTATIONS = [
    { value: "PORTRAIT", label: "Dikey" },
    { value: "LANDSCAPE", label: "Yatay" },
  ];
  const pageHint = "Örnek: 1,3,5-9. Tümü için all yazın.";

  const HARDWARE = "/api/v1/security/cert-sign/hardware";
  const CERTS = ".cer,.crt,.pem,.der";

  async function windowsCertificates({ get }) {
    const list = await get(`${HARDWARE}/windows-certificates`);
    const usable = (cert) => !cert.expired && !cert.notYetValid;
    return list.filter(usable).concat(list.filter((cert) => !usable(cert))).map((cert) => ({
      value: cert.alias,
      label: `${cert.subjectCommonName || cert.subject || cert.alias} · ${String(cert.notAfter || "").slice(0, 10)}` +
        (cert.expired ? " (süresi dolmuş)" : cert.notYetValid ? " (henüz geçerli değil)" : ""),
    }));
  }

  async function tokenDrivers({ get }) {
    const capabilities = await get(`${HARDWARE}/capabilities`);
    return (capabilities.detectedLibraries || []).map((lib) => ({ value: lib.path, label: `${lib.name} (${lib.path})` }));
  }

  // Personal data that is common in Turkish documents.
  const REDACT_PRESETS = {
    tckn: /(?<!\d)[1-9]\d{10}(?!\d)/gu,
    iban: /TR\s?\d{2}(?:\s?\d{4}){5}\s?\d{2}/giu,
    email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu,
    phone: /(?<!\d)(?:\+90|0)?\s?\(?5\d{2}\)?\s?\d{3}\s?\d{2}\s?\d{2}(?!\d)/gu,
    card: /(?<!\d)(?:\d{4}[ -]?){3}\d{4}(?!\d)/gu,
  };

  /** Global RegExps for the form values; throws when a regular expression is invalid. */
  function redactPatterns(v) {
    const escape = (text) => text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
    // JavaScript does not fold the Turkish dotted and dotless i into each other.
    const turkishI = (pattern) => pattern.replace(/[iİıI]/g, "[iİıI]");
    const words = v.words.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      let source = v.regex ? line : escape(line);
      if (v.ignoreCase && !v.regex) source = turkishI(source);
      if (v.wholeWord) source = `(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`;
      try {
        return new RegExp(source, v.ignoreCase ? "giu" : "gu");
      } catch {
        throw new Error(`Düzenli ifade geçersiz: ${line}`);
      }
    });
    return words.concat(v.presets.map((key) => new RegExp(REDACT_PRESETS[key])));
  }

  // The engine's own text search misplaces boxes and leaves text behind, so
  // the matches are located with PDF.js and the engine only paints the boxes
  // and turns the pages into images, which removes the text underneath.
  async function redact({ files, values, engine, note }) {
    const file = files.fileInput[0];
    const boxes = await window.SecuriPreview.textBoxes(file, redactPatterns(values));
    if (!boxes.length) throw new Error("Aranan metinler belgede bulunamadı. Taranmış bir belgeyse önce OCR uygulayın.");
    const form = new FormData();
    form.append("fileInput", file, file.name);
    form.append("redactions", JSON.stringify(boxes.map((box) => ({ ...box, color: values.redactColor }))));
    form.append("convertPDFToImage", "true");
    let bytes = await engine("/api/v1/security/redact", form);
    if (values.ocr) {
      const ocr = new FormData();
      ocr.append("fileInput", new File([bytes], file.name, { type: "application/pdf" }), file.name);
      ["tur", "eng"].forEach((language) => ocr.append("languages", language));
      Object.entries({ ocrType: "skip-text", ocrRenderType: "hocr", deskew: "false", clean: "false", cleanFinal: "false", sidecar: "false", removeImagesAfter: "false" })
        .forEach(([key, value]) => ocr.append(key, value));
      bytes = await engine("/api/v1/misc/ocr-pdf", ocr);
    }
    note(`${boxes.length} alan karartıldı`);
    return bytes;
  }

  function signError(status, detail) {
    if (/CertificateExpired/i.test(detail)) return "Seçilen sertifikanın süresi dolmuş.";
    if (/CertificateNotYetValid/i.test(detail)) return "Seçilen sertifika henüz geçerli değil.";
    if (/password|keystore|mac check|decrypt|\bPIN\b|CKR_PIN|login/i.test(detail)) return "Sertifika açılamadı. Parolayı veya PIN'i kontrol edin.";
    if (/allowed list/i.test(detail)) return "Bu kart sürücüsünün kullanılmasına izin verilmiyor.";
    if (/alias/i.test(detail)) return "Seçilen sertifika bulunamadı. Kartın takılı olduğundan emin olup listeyi yenileyin.";
    if (/desktop app/i.test(detail)) return "Donanımla imzalama yalnızca masaüstü uygulamasında kullanılabilir.";
    return detail ? `İmzalanamadı: ${detail}` : null;
  }

  window.SECURIPDF_CATEGORIES = [
    { id: "edit", title: "Düzenle" },
    { id: "ocr", title: "Metin tanıma" },
    { id: "pages", title: "Sayfalar" },
    { id: "security", title: "Güvenlik" },
    { id: "sign", title: "E-imza" },
    { id: "convert", title: "Dönüştür" },
    { id: "optimize", title: "Optimize" },
  ];

  window.SECURIPDF_TOOLS = [
    {
      id: "merge-pdfs",
      category: "edit",
      title: "PDF Birleştir",
      description: "Birden fazla PDF dosyasını tek belgede birleştirin. Dosyalar listedeki sırayla eklenir.",
      apiPath: "/api/v1/general/merge-pdfs",
      suffix: "birlesik",
      files: [{ name: "fileInput", label: "PDF dosyaları", accept: PDF, multiple: true, min: 2 }],
      fields: [
        { name: "sortType", label: "Sıralama", type: "select", default: "orderProvided", options: [
          { value: "orderProvided", label: "Listedeki sıra" },
          { value: "byFileName", label: "Dosya adına göre" },
          { value: "byDateModified", label: "Değiştirilme tarihine göre" },
          { value: "byDateCreated", label: "Oluşturulma tarihine göre" },
          { value: "byPDFTitle", label: "PDF başlığına göre" },
        ] },
        { name: "removeCertSign", label: "Sertifika imzalarını kaldır", type: "checkbox", default: true },
        { name: "generateToc", label: "İçindekiler sayfası oluştur", type: "checkbox", default: false },
      ],
    },
    {
      id: "split-pages",
      category: "edit",
      title: "PDF Böl",
      description: "PDF'i sayfa numarasına, sayfa sayısına, boyuta veya sayfa bölümlerine göre ayırın. Birden çok parça ZIP olarak kaydedilir.",
      apiPath: (v) => ({
        pages: "/api/v1/general/split-pages",
        count: "/api/v1/general/split-by-size-or-count",
        sections: "/api/v1/general/split-pdf-by-sections",
      })[v.mode],
      suffix: "bolunmus",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "mode", label: "Bölme şekli", type: "select", local: true, default: "pages", options: [
          { value: "pages", label: "Belirli sayfalardan sonra" },
          { value: "count", label: "Sayfa sayısı, belge sayısı veya boyut" },
          { value: "sections", label: "Her sayfayı parçalara ayır" },
        ] },
        { name: "pageNumbers", label: "Hangi sayfalardan sonra kesilsin", type: "text", required: true, pagePicker: "split",
          placeholder: "2,5", hint: "Önizlemede sayfaya tıklayın veya yazın. Örnek: 2,5 yazılırsa 1-2, 3-5 ve 6-son olarak bölünür.",
          showIf: { mode: "pages" } },
        { name: "splitType", label: "Ölçüt", type: "select", default: "1", showIf: { mode: "count" }, options: [
          { value: "1", label: "Her parçada şu kadar sayfa" },
          { value: "2", label: "Şu kadar belgeye böl" },
          { value: "0", label: "Her parça en fazla şu boyutta" },
        ] },
        { name: "splitValue", label: "Değer", type: "text", required: true, default: "5",
          hint: "Boyut için MB yazın, örnek: 10MB.", showIf: { mode: "count" } },
        { name: "horizontalDivisions", label: "Yatay kesim sayısı", type: "number", default: 0, min: 0, max: 10, showIf: { mode: "sections" } },
        { name: "verticalDivisions", label: "Dikey kesim sayısı", type: "number", default: 1, min: 0, max: 10, showIf: { mode: "sections" } },
        { name: "merge", label: "Parçaları tek PDF'te birleştir", type: "checkbox", default: true, showIf: { mode: "sections" } },
      ],
      constants: (v) => (v.mode === "sections" ? { pageNumbers: "all", splitMode: "SPLIT_ALL" } : {}),
    },
    {
      id: "ocr-pdf",
      category: "ocr",
      title: "OCR / Aranabilir PDF",
      description: "Taranmış belgedeki metni tanıyıp görünmez bir metin katmanı ekler; belge aranabilir ve kopyalanabilir olur. Görünüm değişmez.",
      apiPath: "/api/v1/misc/ocr-pdf",
      suffix: "aranabilir",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "languages", label: "Belge dili", type: "checks", default: ["tur", "eng"], options: [
          { value: "tur", label: "Türkçe" },
          { value: "eng", label: "İngilizce" },
          { value: "deu", label: "Almanca" },
          { value: "fra", label: "Fransızca" },
          { value: "spa", label: "İspanyolca" },
          { value: "ita", label: "İtalyanca" },
          { value: "ara", label: "Arapça" },
        ] },
        { name: "ocrType", label: "Metin içeren sayfalar", type: "select", default: "skip-text", options: [
          { value: "skip-text", label: "Atla, yalnızca taranmış sayfaları tanı" },
          { value: "force-ocr", label: "Tüm sayfaları yeniden tanı" },
        ] },
      ],
      constants: { ocrRenderType: "hocr", deskew: "false", clean: "false", cleanFinal: "false", sidecar: "false", removeImagesAfter: "false" },
      validate: (v) => (v.languages.length ? null : "En az bir dil seçin."),
    },
    {
      id: "overlay-pdf",
      category: "edit",
      title: "PDF Bindir",
      description: "Bir PDF'in sayfalarını başka bir PDF'in üzerine veya arkasına yerleştirin.",
      apiPath: "/api/v1/general/overlay-pdfs",
      suffix: "bindirilmis",
      files: [
        { name: "fileInput", label: "Ana PDF", accept: PDF },
        { name: "overlayFiles", label: "Bindirilecek PDF'ler", accept: PDF, multiple: true, min: 1 },
      ],
      fields: [
        { name: "overlayMode", label: "Yöntem", type: "select", default: "SequentialOverlay", options: [
          { value: "SequentialOverlay", label: "Sırayla" },
          { value: "InterleavedOverlay", label: "Dönüşümlü" },
          { value: "FixedRepeatOverlay", label: "Her dosyayı belirli sayıda tekrarla" },
        ] },
        { name: "counts", label: "Tekrar sayısı", type: "number", default: 1, min: 1, perFile: "overlayFiles",
          showIf: { overlayMode: "FixedRepeatOverlay" } },
        { name: "overlayPosition", label: "Konum", type: "select", default: "0", options: [
          { value: "0", label: "Önde" },
          { value: "1", label: "Arkada" },
        ] },
      ],
    },
    {
      id: "flatten",
      category: "edit",
      title: "Düzleştir",
      description: "Form alanlarını ve etkileşimli öğeleri sabit sayfa içeriğine dönüştürün.",
      apiPath: "/api/v1/misc/flatten",
      suffix: "duzlestirilmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "flattenOnlyForms", label: "Yalnızca formları düzleştir", type: "checkbox", default: true,
          hint: "Kapalıysa her sayfa görsele çevrilir; metin seçilemez ve dosya büyür." },
      ],
    },
    {
      id: "rotate-pdf",
      category: "pages",
      title: "Döndür",
      description: "Tüm sayfaları saat yönünde döndürün.",
      apiPath: "/api/v1/general/rotate-pdf",
      suffix: "dondurulmus",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "angle", label: "Açı", type: "select", default: "90", options: [
          { value: "90", label: "90°" },
          { value: "180", label: "180°" },
          { value: "270", label: "270°" },
        ] },
      ],
    },
    {
      id: "remove-pages",
      category: "pages",
      title: "Sayfa Sil",
      description: "Belirttiğiniz sayfaları PDF'ten kaldırın.",
      apiPath: "/api/v1/general/remove-pages",
      suffix: "sayfalar-silindi",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "pageNumbers", label: "Silinecek sayfalar", type: "text", required: true, pagePicker: "remove",
          placeholder: "2,4-6", hint: "Önizlemede sayfalara tıklayın veya yazın. Örnek: 1,3,5-9." },
      ],
    },
    {
      id: "extract-pages",
      category: "pages",
      title: "Sayfa Çıkar",
      description: "Yalnızca seçtiğiniz sayfaları yeni bir PDF olarak alın.",
      apiPath: "/api/v1/general/rearrange-pages",
      suffix: "secilen-sayfalar",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "pageNumbers", label: "Alınacak sayfalar", type: "text", required: true, pagePicker: "pick",
          placeholder: "1,3-5", hint: "Önizlemede sayfalara tıklayın veya yazın. Yazarken sıra değiştirilebilir." },
      ],
      constants: { customMode: "CUSTOM" },
    },
    {
      id: "rearrange-pages",
      category: "pages",
      title: "Sayfaları Sırala",
      description: "Sayfa sırasını değiştirin veya hazır bir düzen uygulayın.",
      apiPath: "/api/v1/general/rearrange-pages",
      suffix: "siralanmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "customMode", label: "Düzen", type: "select", default: "CUSTOM", options: [
          { value: "CUSTOM", label: "Kendi sıram" },
          { value: "REVERSE_ORDER", label: "Ters çevir" },
          { value: "DUPLEX_SORT", label: "Çift taraflı tarama sırası" },
          { value: "BOOKLET_SORT", label: "Kitapçık" },
          { value: "SIDE_STITCH_BOOKLET_SORT", label: "Yandan dikişli kitapçık" },
          { value: "ODD_EVEN_SPLIT", label: "Önce tek, sonra çift sayfalar" },
          { value: "REMOVE_FIRST", label: "İlk sayfayı çıkar" },
          { value: "REMOVE_LAST", label: "Son sayfayı çıkar" },
          { value: "REMOVE_FIRST_AND_LAST", label: "İlk ve son sayfayı çıkar" },
          { value: "DUPLICATE", label: "Her sayfayı çoğalt" },
        ] },
        { name: "pageNumbers", label: "Yeni sayfa sırası", type: "text", required: true, placeholder: "3,1,2",
          hint: "Örnek: 3,1,2 veya 5-1.", showIf: { customMode: "CUSTOM" } },
      ],
      constants: (v) => (v.customMode === "CUSTOM" ? {} : { pageNumbers: "all" }),
    },
    {
      id: "scale-pages",
      category: "pages",
      title: "Sayfa Ölçekle",
      description: "Sayfaları A4, Letter gibi bir boyuta getirin veya içeriği büyütüp küçültün.",
      apiPath: "/api/v1/general/scale-pages",
      suffix: "olceklenmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "pageSize", label: "Sayfa boyutu", type: "select", default: "A4", options:
          ["A0", "A1", "A2", "A3", "A4", "A5", "A6"].map((s) => ({ value: s, label: s })).concat([
            { value: "LETTER", label: "Letter" },
            { value: "LEGAL", label: "Legal" },
            { value: "KEEP", label: "Boyutu koru" },
          ]) },
        { name: "orientation", label: "Yön", type: "select", default: "PORTRAIT", options: ORIENTATIONS },
        { name: "scaleFactor", label: "İçerik ölçeği", type: "range", default: 1, min: 0.1, max: 10, step: 0.1, unit: "×" },
      ],
    },
    {
      id: "crop",
      category: "pages",
      title: "Kırp",
      description: "Sayfa kenarlarındaki boşluğu otomatik kırpın veya önizlemede kalacak alanı sürükleyerek seçin.",
      apiPath: "/api/v1/general/crop",
      suffix: "kirpilmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "autoCrop", label: "Beyaz kenarları otomatik kırp", type: "checkbox", default: true,
          hint: "Kapalıysa önizlemede kalacak alanı çizin; seçim tüm sayfalara uygulanır." },
        { name: "removeDataOutsideCrop", label: "Alan dışındaki metni sil", type: "checkbox", default: false, showIf: { autoCrop: false } },
        { name: "x", label: "Sol (x)", type: "number", default: 0, min: 0, showIf: { autoCrop: false }, advanced: true },
        { name: "y", label: "Alt (y)", type: "number", default: 0, min: 0, showIf: { autoCrop: false }, advanced: true },
        { name: "width", label: "Genişlik", type: "number", default: 595, min: 1, showIf: { autoCrop: false }, advanced: true },
        { name: "height", label: "Yükseklik", type: "number", default: 842, min: 1, showIf: { autoCrop: false }, advanced: true },
      ],
    },
    {
      id: "multi-page-layout",
      category: "pages",
      title: "Çok Sayfa Düzeni",
      description: "Birden fazla sayfayı tek kağıda yerleştirin.",
      apiPath: "/api/v1/general/multi-page-layout",
      suffix: "coklu-duzen",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "pagesPerSheet", label: "Kağıt başına sayfa", type: "select", default: "2", options:
          ["2", "4", "9", "16"].map((n) => ({ value: n, label: n })) },
        { name: "arrangement", label: "Yerleşim", type: "select", default: "BY_ROWS", options: [
          { value: "BY_ROWS", label: "Satır satır" },
          { value: "BY_COLUMNS", label: "Sütun sütun" },
        ] },
        { name: "readingDirection", label: "Okuma yönü", type: "select", default: "LTR", options: [
          { value: "LTR", label: "Soldan sağa" },
          { value: "RTL", label: "Sağdan sola" },
        ] },
        { name: "orientation", label: "Kağıt yönü", type: "select", default: "PORTRAIT", options: ORIENTATIONS },
        { name: "addBorder", label: "Sayfaların çevresine çerçeve çiz", type: "checkbox", default: false },
      ],
      constants: { mode: "DEFAULT" },
    },
    {
      id: "pdf-to-single-page",
      category: "pages",
      title: "Tek Sayfaya Dönüştür",
      description: "Tüm sayfaları alt alta birleştirerek tek uzun bir sayfa oluşturun.",
      apiPath: "/api/v1/general/pdf-to-single-page",
      suffix: "tek-sayfa",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
    },
    {
      id: "add-page-numbers",
      category: "pages",
      title: "Sayfa Numarası Ekle",
      description: "Sayfalara numara ekleyin.",
      apiPath: "/api/v1/misc/add-page-numbers",
      suffix: "numarali",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "position", label: "Konum", type: "pad", default: "8", options: [
          { value: "1", label: "Üst sol" }, { value: "2", label: "Üst orta" }, { value: "3", label: "Üst sağ" },
          { value: "4", label: "Orta sol" }, { value: "5", label: "Orta" }, { value: "6", label: "Orta sağ" },
          { value: "7", label: "Alt sol" }, { value: "8", label: "Alt orta" }, { value: "9", label: "Alt sağ" },
        ] },
        { name: "customText", label: "Metin", type: "text", default: "{n}", hint: "{n} sayfa numarası, {total} toplam sayfa. Örnek: Sayfa {n} / {total}." },
        { name: "startingNumber", label: "Başlangıç numarası", type: "number", default: 1, min: 0 },
        { name: "pagesToNumber", label: "Numaralanacak sayfalar", type: "text", default: "all", hint: pageHint },
        { name: "fontSize", label: "Yazı boyutu", type: "number", default: 12, min: 4, max: 96 },
        { name: "fontType", label: "Yazı tipi", type: "select", default: "helvetica", options: [
          { value: "helvetica", label: "Helvetica" },
          { value: "times", label: "Times" },
          { value: "courier", label: "Courier" },
        ] },
        { name: "fontColor", label: "Renk", type: "color", default: "#000000" },
        { name: "customMargin", label: "Kenar boşluğu", type: "select", default: "medium", options: MARGINS },
      ],
      constants: { pageNumbers: "all" },
    },
    {
      id: "add-stamp",
      category: "security",
      title: "Damga",
      description: "Sayfalara metin damgası ekleyin.",
      apiPath: "/api/v1/misc/add-stamp",
      suffix: "damgali",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "stampText", label: "Damga metni", type: "text", required: true, default: "GİZLİ" },
        { name: "position", label: "Konum", type: "pad", default: "5", options: [
          { value: "7", label: "Üst sol" }, { value: "8", label: "Üst orta" }, { value: "9", label: "Üst sağ" },
          { value: "4", label: "Orta sol" }, { value: "5", label: "Orta" }, { value: "6", label: "Orta sağ" },
          { value: "1", label: "Alt sol" }, { value: "2", label: "Alt orta" }, { value: "3", label: "Alt sağ" },
        ] },
        { name: "pageNumbers", label: "Sayfalar", type: "text", default: "all", hint: pageHint },
        { name: "fontSize", label: "Yazı boyutu", type: "number", default: 40, min: 4, max: 300 },
        { name: "rotation", label: "Açı", type: "range", default: 0, min: -180, max: 180, step: 5, unit: "°" },
        { name: "opacity", label: "Saydamlık", type: "range", default: 0.5, min: 0, max: 1, step: 0.05, unit: "%" },
        { name: "customColor", label: "Renk", type: "color", default: "#d3d3d3" },
        { name: "customMargin", label: "Kenar boşluğu", type: "select", default: "medium", options: MARGINS },
      ],
      constants: { stampType: "text", alphabet: "roman", overrideX: "-1", overrideY: "-1" },
    },
    {
      id: "add-watermark",
      category: "security",
      title: "Filigran",
      description: "Sayfalara tekrarlanan metin veya görsel filigran ekleyin.",
      apiPath: "/api/v1/security/add-watermark",
      suffix: "filigranli",
      files: [
        { name: "fileInput", label: "PDF dosyası", accept: PDF },
        { name: "watermarkImage", label: "Filigran görseli", accept: IMAGES, showIf: { watermarkType: "image" } },
      ],
      fields: [
        { name: "watermarkType", label: "Tür", type: "select", default: "text", options: [
          { value: "text", label: "Metin" },
          { value: "image", label: "Görsel" },
        ] },
        { name: "watermarkText", label: "Filigran metni", type: "text", default: "GİZLİ",
          showIf: { watermarkType: "text" }, required: true },
        { name: "fontSize", label: "Yazı boyutu", type: "number", default: 30, min: 4, max: 200,
          showIf: { watermarkType: "text" } },
        { name: "customColor", label: "Renk", type: "color", default: "#808080",
          showIf: { watermarkType: "text" } },
        { name: "rotation", label: "Açı", type: "range", default: 45, min: -180, max: 180, step: 5, unit: "°" },
        { name: "opacity", label: "Saydamlık", type: "range", default: 0.3, min: 0, max: 1, step: 0.05, unit: "%" },
        { name: "widthSpacer", label: "Yatay aralık", type: "range", default: 50, min: 0, max: 400, step: 5 },
        { name: "heightSpacer", label: "Dikey aralık", type: "range", default: 50, min: 0, max: 400, step: 5 },
        { name: "convertPDFToImage", label: "Sayfaları görsele çevir (filigran kaldırılamaz)", type: "checkbox", default: false },
      ],
      constants: { alphabet: "roman" },
    },
    {
      id: "add-password",
      category: "security",
      title: "Parola Ekle",
      description: "PDF'e açma parolası ve kullanım kısıtlamaları ekleyin.",
      apiPath: "/api/v1/security/add-password",
      suffix: "parolali",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "password", label: "Açma parolası", type: "password" },
        { name: "ownerPassword", label: "Yetki parolası", type: "password", hint: "Kısıtlamaları değiştirmek için gerekir. Boş bırakılabilir." },
        { name: "keyLength", label: "Şifreleme", type: "select", default: "256", options: [
          { value: "256", label: "AES 256 bit" },
          { value: "128", label: "AES 128 bit" },
        ] },
        { name: "preventPrinting", label: "Yazdırmayı engelle", type: "checkbox", default: false },
        { name: "preventExtractContent", label: "İçerik kopyalamayı engelle", type: "checkbox", default: false },
        { name: "preventModify", label: "Değiştirmeyi engelle", type: "checkbox", default: false },
        { name: "preventModifyAnnotations", label: "Not eklemeyi engelle", type: "checkbox", default: false },
        { name: "preventFillInForm", label: "Form doldurmayı engelle", type: "checkbox", default: false },
        { name: "preventAssembly", label: "Sayfa düzenlemeyi engelle", type: "checkbox", default: false },
      ],
      validate: (v) => (v.password || v.ownerPassword ? null : "En az bir parola girin."),
    },
    {
      id: "remove-password",
      category: "security",
      title: "Parola Kaldır",
      description: "Parolasını bildiğiniz PDF'in şifresini kaldırın.",
      apiPath: "/api/v1/security/remove-password",
      suffix: "parolasiz",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [{ name: "password", label: "Parola", type: "password", required: true }],
    },
    {
      id: "redact",
      category: "security",
      title: "Karartma",
      description: "Belirttiğiniz metinleri ve kişisel verileri (TC kimlik no, IBAN, e-posta, telefon, kart numarası) kalıcı olarak karartın. Sayfalar görsele çevrilir; karartılan bilgi belgede hiçbir biçimde kalmaz.",
      suffix: "karartilmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "presets", label: "Kişisel veriler", type: "checks", local: true, default: [], options: [
          { value: "tckn", label: "TC kimlik no" },
          { value: "iban", label: "IBAN" },
          { value: "email", label: "E-posta" },
          { value: "phone", label: "Cep telefonu" },
          { value: "card", label: "Kart numarası" },
        ] },
        { name: "words", label: "Karartılacak metinler", type: "textarea", local: true, placeholder: "Ahmet Yılmaz\nGizli Proje",
          hint: "Her satıra bir metin yazın." },
        { name: "ignoreCase", label: "Büyük/küçük harfe duyarsız", type: "checkbox", local: true, default: true },
        { name: "wholeWord", label: "Yalnızca tam kelimeler", type: "checkbox", local: true, default: false },
        { name: "regex", label: "Satırları düzenli ifade (regex) olarak yorumla", type: "checkbox", local: true, default: false },
        { name: "redactColor", label: "Kutu rengi", type: "color", local: true, default: "#000000" },
        { name: "ocr", label: "Karartmadan sonra metni yeniden tanı (OCR)", type: "checkbox", local: true, default: false,
          hint: "Görsele çevrilen sayfalar Türkçe ve İngilizce OCR ile yeniden aranabilir olur; karartılan alanlar tanınmaz. İşlem uzar." },
      ],
      validate: (v) => {
        try {
          return redactPatterns(v).length ? null : "Karartılacak bir metin yazın veya kişisel veri türü seçin.";
        } catch (err) {
          return err.message;
        }
      },
      usesEngine: true,
      run: redact,
    },
    {
      id: "scan-file",
      category: "security",
      title: "Virüs Tara",
      description: "Dosyayı bu bilgisayardaki Windows Defender ile tarayın. Dosya karantinaya alınmaz ve silinmez; sonuç PDF rapor olarak hazırlanır.",
      suffix: "tarama",
      files: [{ name: "fileInput", label: "Dosya", accept: "*/*" }],
      fields: [],
      async run({ files, scan, htmlToPdf, note }) {
        const file = files.fileInput[0];
        const result = await scan(file);
        note(result.clean ? "Tehdit bulunamadı" : "Tehdit bulundu");
        const { html, page } = window.SecuriFormats.scanReport(file.name, result);
        return htmlToPdf(html, page);
      },
    },
    {
      id: "cert-sign",
      category: "sign",
      title: "Dijital İmza",
      description: "PDF'i sertifikanızla imzalayın: Windows sertifika deposu (e-imza kartları dahil), PKCS#11 akıllı kart, PFX/P12 veya PEM dosyası. İmza, belgenin imzadan sonra değişmediğini kanıtlar.",
      apiPath: "/api/v1/security/cert-sign",
      suffix: "imzali",
      files: [
        { name: "fileInput", label: "PDF dosyası", accept: PDF },
        { name: "p12File", label: "Sertifika dosyası (.pfx / .p12)", accept: ".pfx,.p12", preview: false, showIf: { certType: "PKCS12" } },
        { name: "certFile", label: "Sertifika (.pem / .crt / .cer)", accept: CERTS, preview: false, showIf: { certType: "PEM" } },
        { name: "privateKeyFile", label: "Özel anahtar (.pem / .key)", accept: ".pem,.key,.der", preview: false, showIf: { certType: "PEM" } },
      ],
      fields: [
        { name: "certType", label: "Sertifika kaynağı", type: "select", default: "WINDOWS_STORE", options: [
          { value: "WINDOWS_STORE", label: "Windows sertifika deposu" },
          { value: "PKCS11", label: "Akıllı kart / token (PKCS#11)" },
          { value: "PKCS12", label: "PFX / P12 dosyası" },
          { value: "PEM", label: "PEM sertifika ve anahtar" },
        ] },
        { name: "alias", label: "Sertifika", type: "select", options: [], load: windowsCertificates, required: true,
          empty: "Özel anahtarı olan sertifika bulunamadı",
          hint: "Kartınız Windows'a tanıtıldıysa (sürücüsü kuruluysa) sertifikası burada görünür. PIN gerekirse Windows sorar.",
          showIf: { certType: "WINDOWS_STORE" } },
        { name: "pkcs11LibraryPath", label: "Kart sürücüsü", type: "select", options: [], load: tokenDrivers, required: true,
          empty: "Bilinen bir kart sürücüsü bulunamadı",
          hint: "AKİS, SafeNet, Gemalto IDPrime, OpenSC, YubiKey, SafeSign, DataKey ve ePass2003 sürücüleri tanınır.",
          showIf: { certType: "PKCS11" } },
        { name: "tokenAlias", label: "Karttaki sertifika adı (isteğe bağlı)", type: "text", local: true,
          hint: "Kartta birden çok sertifika varsa yazın; boşsa ilk sertifika kullanılır.", showIf: { certType: "PKCS11" } },
        { name: "password", label: "Parola / PIN", type: "password", required: true, showIf: { certType: ["PKCS11", "PKCS12", "PEM"] },
          hint: "Yalnızca bu işlem için kullanılır, saklanmaz." },
        { name: "reason", label: "İmza nedeni", type: "text", placeholder: "Onaylıyorum" },
        { name: "location", label: "Yer", type: "text", placeholder: "İstanbul" },
        { name: "showSignature", label: "Sayfada görünür imza kutusu ekle", type: "checkbox", default: false },
        { name: "name", label: "Kutuda görünecek ad", type: "text", showIf: { showSignature: true } },
        { name: "pageNumber", label: "Sayfa", type: "number", default: 1, min: 1, showIf: { showSignature: true } },
      ],
      constants: (v) => ({ showLogo: "false", ...(v.certType === "PKCS11" && v.tokenAlias ? { alias: v.tokenAlias } : {}) }),
      httpError: signError,
      usesEngine: true,
      // The engine signs with another certificate of the store when the alias is unknown.
      async run({ values, engine, engineGet, form }) {
        if (values.certType === "WINDOWS_STORE") {
          const certs = await windowsCertificates({ get: engineGet });
          if (!certs.some((cert) => cert.value === values.alias)) {
            throw new Error("Seçilen sertifika Windows sertifika deposunda bulunamadı. Listeyi yenileyip yeniden seçin.");
          }
        }
        return engine("/api/v1/security/cert-sign", form());
      },
    },
    {
      id: "timestamp-pdf",
      category: "sign",
      title: "Zaman Damgası",
      description: "Belgeye RFC 3161 zaman damgası ekleyerek o anda bu içerikle var olduğunu kanıtlayın. Sunucuya yalnızca belgenin SHA-256 özeti gönderilir; internet bağlantısı gerekir.",
      apiPath: "/api/v1/security/timestamp-pdf",
      suffix: "zaman-damgali",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "tsaUrl", label: "Zaman damgası sunucusu", type: "select", default: "http://timestamp.digicert.com", options: [
          { value: "http://timestamp.digicert.com", label: "DigiCert" },
          { value: "http://timestamp.sectigo.com", label: "Sectigo" },
          { value: "http://ts.ssl.com", label: "SSL.com" },
          { value: "https://freetsa.org/tsr", label: "FreeTSA" },
          { value: "http://tsa.mesign.com", label: "MeSign" },
        ] },
      ],
      httpError: (status, detail) => (/TSA|timestamp|connect|timed out|UnknownHost/i.test(detail)
        ? "Zaman damgası sunucusundan yanıt alınamadı. İnternet bağlantısını kontrol edin veya başka bir sunucu seçin."
        : null),
    },
    {
      id: "validate-signature",
      category: "sign",
      title: "İmza Doğrula",
      description: "PDF'teki dijital imzaları denetleyin: belge imzadan sonra değişmiş mi, sertifika güvenilir mi, süresi geçerli mi. Sonuç PDF rapor olarak hazırlanır.",
      suffix: "imza-raporu",
      usesEngine: true,
      files: [
        { name: "fileInput", label: "İmzalı PDF", accept: PDF },
        { name: "certFile", label: "Güvenilen kök sertifika (isteğe bağlı)", accept: CERTS, preview: false, min: 0 },
      ],
      fields: [],
      async run({ files, engine, form, htmlToPdf, note }) {
        const data = JSON.parse(new TextDecoder("utf-8").decode(await engine("/api/v1/security/validate-signature", form())));
        const results = Array.isArray(data) ? data : data.results || [];
        const verdicts = results.map((result) => window.SecuriFormats.signatureVerdict(result).level);
        note(!results.length ? "Belgede imza yok"
          : verdicts.every((level) => level === "ok") ? `${results.length} imza, tümü geçerli`
          : verdicts.includes("bad") ? `${results.length} imza, geçersiz imza var`
          : `${results.length} imza, uyarı var`);
        const { html, page } = window.SecuriFormats.signatureReport(results, files.fileInput[0].name);
        return htmlToPdf(html, page);
      },
    },
    {
      id: "remove-cert-sign",
      category: "sign",
      title: "İmzaları Kaldır",
      description: "PDF'teki dijital imzaları kaldırın. Belge içeriği değişmez; imzalı hâli gerekiyorsa orijinali saklayın.",
      apiPath: "/api/v1/security/remove-cert-sign",
      suffix: "imzasiz",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
    },
    {
      id: "pdf-to-img",
      category: "convert",
      title: "PDF → Görsel",
      description: "PDF sayfalarını görsele dönüştürün. Birden çok görsel ZIP olarak kaydedilir.",
      apiPath: "/api/v1/convert/pdf/img",
      suffix: "gorsel",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "imageFormat", label: "Biçim", type: "select", default: "png", options: [
          { value: "png", label: "PNG" },
          { value: "jpeg", label: "JPEG" },
          { value: "webp", label: "WebP" },
          { value: "gif", label: "GIF" },
          { value: "bmp", label: "BMP" },
        ] },
        { name: "singleOrMultiple", label: "Çıktı", type: "select", default: "multiple", options: [
          { value: "multiple", label: "Her sayfa ayrı görsel" },
          { value: "single", label: "Tüm sayfalar tek görselde" },
        ] },
        { name: "pageNumbers", label: "Sayfalar", type: "text", default: "all", hint: pageHint },
        { name: "colorType", label: "Renk", type: "select", default: "color", options: COLOR_TYPES },
        { name: "dpi", label: "Çözünürlük (DPI)", type: "number", default: 150, min: 36, max: 600 },
      ],
    },
    {
      id: "img-to-pdf",
      category: "convert",
      title: "Görsel → PDF",
      description: "Görselleri tek PDF belgesinde birleştirin.",
      apiPath: "/api/v1/convert/img/pdf",
      suffix: "",
      files: [{ name: "fileInput", label: "Görseller", accept: IMAGES, multiple: true, min: 1 }],
      fields: [
        { name: "fitOption", label: "Sayfaya yerleşim", type: "select", default: "maintainAspectRatio", options: [
          { value: "maintainAspectRatio", label: "Oranı koru" },
          { value: "fillPage", label: "Sayfayı doldur" },
          { value: "fitDocumentToImage", label: "Sayfa görsel boyutunda olsun" },
        ] },
        { name: "colorType", label: "Renk", type: "select", default: "color", options: COLOR_TYPES },
        { name: "autoRotate", label: "Görseli sayfaya göre otomatik döndür", type: "checkbox", default: false },
      ],
    },
    {
      id: "udf-to-pdf",
      category: "convert",
      title: "UDF → PDF",
      description: "UYAP Doküman Editörü belgesini (.udf) PDF'e dönüştürün. Yazı tipi, hizalama, tablo ve görseller korunur.",
      suffix: "",
      files: [{ name: "fileInput", label: "UDF dosyası", accept: UDF }],
      fields: [],
      async run({ files, htmlToPdf }) {
        const bytes = new Uint8Array(await files.fileInput[0].arrayBuffer());
        const { html, page } = await window.SecuriFormats.udfToHtml(bytes);
        return htmlToPdf(html, page);
      },
    },
    {
      id: "pdf-to-udf",
      category: "convert",
      title: "PDF → UDF",
      description: "PDF'teki metni UYAP Doküman Editörü belgesine (.udf) aktarın. Metin ve satırlar aktarılır; görseller ve tablo düzeni aktarılmaz.",
      suffix: "",
      outputExt: "udf",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "password", label: "PDF parolası (varsa)", type: "password", local: true },
      ],
      async run({ files, values }) {
        const lines = await window.SecuriPreview.textLines(files.fileInput[0], values.password);
        if (!lines.some((line) => line.text.trim())) throw new Error("FORMAT_NO_TEXT");
        return window.SecuriFormats.linesToUdf(lines);
      },
    },
    {
      id: "einvoice-to-pdf",
      category: "convert",
      title: "e-Fatura XML → PDF",
      description: "e-Fatura, e-Arşiv fatura veya e-İrsaliye XML dosyasını PDF'e dönüştürün. Belgede gömülü görsel şablon (XSLT) varsa o kullanılır.",
      suffix: "",
      files: [{ name: "fileInput", label: "XML dosyası", accept: XML }],
      fields: [
        { name: "template", label: "Görünüm", type: "select", local: true, default: "embedded", options: [
          { value: "embedded", label: "Belgedeki şablon (yoksa standart)" },
          { value: "standard", label: "SecuriPDF standart şablonu" },
        ] },
      ],
      async run({ files, values, htmlToPdf, note }) {
        const text = new TextDecoder("utf-8").decode(await files.fileInput[0].arrayBuffer());
        const { html, page, template } = window.SecuriFormats.invoiceToHtml(text, values.template === "embedded");
        if (values.template === "embedded" && template === "standard") note("Belgede şablon bulunamadı; standart şablon kullanıldı");
        return htmlToPdf(html, page);
      },
    },
    {
      id: "office-to-pdf",
      category: "convert",
      title: "Office → PDF",
      description: "Word, Excel veya PowerPoint belgesini bilgisayardaki Microsoft Office ile PDF'e dönüştürün. Makrolar çalıştırılmaz.",
      suffix: "",
      files: [{ name: "fileInput", label: "Office belgesi", accept: OFFICE }],
      fields: [
        { name: "format", label: "Çıktı", type: "select", local: true, default: "pdf", options: [
          { value: "pdf", label: "PDF" },
          { value: "pdfa", label: "PDF/A (arşiv; Word ve PowerPoint)" },
        ] },
      ],
      run: ({ files, values, office }) => office(files.fileInput[0], values.format),
    },
    {
      id: "pdf-to-word",
      category: "convert",
      title: "PDF → Word",
      description: "PDF'i bilgisayardaki Microsoft Word ile düzenlenebilir Word belgesine (.docx) dönüştürün. Karmaşık sayfa düzenleri birebir korunmayabilir.",
      suffix: "",
      outputExt: "docx",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
      run: ({ files, office }) => office(files.fileInput[0], "docx"),
    },
    {
      id: "pdf-to-excel",
      category: "convert",
      title: "PDF → Excel",
      description: "PDF'teki tabloları Excel çalışma kitabına (.xlsx) aktarın.",
      apiPath: "/api/v1/convert/pdf/xlsx",
      suffix: "",
      outputExt: "xlsx",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [{ name: "pageNumbers", label: "Sayfalar", type: "text", default: "all", hint: pageHint, pagePicker: true }],
    },
    {
      id: "pdf-to-csv",
      category: "convert",
      title: "PDF → CSV",
      description: "PDF'teki tabloları CSV olarak çıkarın.",
      apiPath: "/api/v1/convert/pdf/csv",
      suffix: "",
      outputExt: "csv",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [{ name: "pageNumbers", label: "Sayfalar", type: "text", default: "all", hint: pageHint, pagePicker: true }],
    },
    {
      id: "pdf-to-text",
      category: "convert",
      title: "PDF → Metin",
      description: "PDF'teki metni düz metin dosyasına aktarın.",
      apiPath: "/api/v1/convert/pdf/text",
      suffix: "",
      outputExt: "txt",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
      constants: { outputFormat: "txt" },
    },
    {
      id: "pdf-to-pdfa",
      category: "convert",
      title: "PDF → PDF/A",
      description: "PDF'i arşiv biçimine (PDF/A) dönüştürün.",
      apiPath: "/api/v1/convert/pdf/pdfa",
      suffix: "pdfa",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "outputFormat", label: "Biçim", type: "select", default: "pdfa-2b", options: [
          { value: "pdfa-1", label: "PDF/A-1b" },
          { value: "pdfa-2b", label: "PDF/A-2b" },
          { value: "pdfa-3b", label: "PDF/A-3b" },
        ] },
      ],
      constants: { strict: "false" },
    },
    {
      id: "compress-pdf",
      category: "optimize",
      title: "Sıkıştır",
      description: "PDF boyutunu küçültün. Düşük düzeyler metni korur; yüksek düzeyler görselleri yeniden kodlar.",
      apiPath: "/api/v1/misc/compress-pdf",
      suffix: "sikistirilmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "optimizeLevel", label: "Düzey", type: "select", default: "4", options: [
          { value: "1", label: "1 — kayıpsız (yapı)" },
          { value: "2", label: "2 — kayıpsız (akışlar)" },
          { value: "3", label: "3 — kayıpsız (nesneler)" },
          { value: "4", label: "4 — görselleri yeniden kodla" },
          { value: "5", label: "5 — daha küçük görseller" },
        ] },
        { name: "grayscale", label: "Gri tonlamaya çevir", type: "checkbox", default: false },
        { name: "linearize", label: "Web için doğrusal hale getir", type: "checkbox", default: false },
      ],
    },
    {
      id: "update-metadata",
      category: "optimize",
      title: "Üstveri",
      description: "PDF başlığı, yazarı, konusu ve anahtar kelimelerini düzenleyin veya tümünü silin.",
      apiPath: "/api/v1/misc/update-metadata",
      suffix: "ustveri",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "deleteAll", label: "Tüm üstveriyi sil", type: "checkbox", default: false },
        { name: "title", label: "Başlık", type: "text", showIf: { deleteAll: false } },
        { name: "author", label: "Yazar", type: "text", showIf: { deleteAll: false } },
        { name: "subject", label: "Konu", type: "text", showIf: { deleteAll: false } },
        { name: "keywords", label: "Anahtar kelimeler", type: "text", showIf: { deleteAll: false } },
      ],
    },
    {
      id: "remove-blanks",
      category: "optimize",
      title: "Boş Sayfa Sil",
      description: "Beyaz veya neredeyse boş sayfaları belgeden çıkarın.",
      suffix: "bosluksuz",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "threshold", label: "Beyaz eşiği", type: "range", default: 10, min: 0, max: 255, hint: "Düşük değer yalnızca neredeyse beyaz pikselleri boş sayar." },
        { name: "whitePercent", label: "Beyaz oranı", type: "range", default: 99.9, min: 50, max: 100, step: 0.1, unit: "%" },
      ],
      usesEngine: true,
      async run({ form, engine, note }) {
        const zip = await engine("/api/v1/misc/remove-blanks", form());
        const entries = await window.SecuriFormats.zipEntries(zip);
        const kept = entries.find((entry) => /nonBlank|non-blank|_processed/i.test(entry.name) && entry.data[0] === 0x25)
          || entries.find((entry) => entry.data[0] === 0x25);
        if (!kept) throw new Error("Boş olmayan sayfa kalmadı.");
        const blanks = entries.find((entry) => /blank/i.test(entry.name) && !/nonBlank|non-blank/i.test(entry.name));
        if (blanks) {
          const count = await window.SecuriPreview.countPages(new File([blanks.data], "blank.pdf"));
          if (count) note(`${count} boş sayfa silindi`);
        }
        return kept.data;
      },
    },
    {
      id: "repair-pdf",
      category: "optimize",
      title: "Onar",
      description: "Hasarlı veya kesik PDF yapısını onarın. Ağır hasarlı belgeler açılamayabilir.",
      suffix: "onarilmis",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [],
      run: ({ files, repair }) => repair(files.fileInput[0]),
    },
    {
      id: "sanitize-pdf",
      category: "optimize",
      title: "Temizle",
      description: "JavaScript, gömülü dosya, bağlantı ve üstveriyi belgeden çıkarın.",
      apiPath: "/api/v1/security/sanitize-pdf",
      suffix: "temiz",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "removeJavaScript", label: "JavaScript'i kaldır", type: "checkbox", default: true },
        { name: "removeEmbeddedFiles", label: "Gömülü dosyaları kaldır", type: "checkbox", default: true },
        { name: "removeLinks", label: "Bağlantıları kaldır", type: "checkbox", default: true },
        { name: "removeMetadata", label: "Üstveriyi kaldır", type: "checkbox", default: true },
        { name: "removeXMPMetadata", label: "XMP üstverisini kaldır", type: "checkbox", default: true },
        { name: "removeFonts", label: "Gömülü yazı tiplerini kaldır", type: "checkbox", default: false,
          hint: "Yazı tipleri kaldırılırsa metin başka bir bilgisayarda bozulabilir." },
      ],
    },
    {
      id: "extract-images",
      category: "optimize",
      title: "Görselleri Çıkar",
      description: "PDF'e gömülü görselleri ayrı dosyalar olarak çıkarın. Birden çok görsel ZIP olarak kaydedilir.",
      apiPath: "/api/v1/misc/extract-images",
      suffix: "gorseller",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "format", label: "Biçim", type: "select", default: "png", options: [
          { value: "png", label: "PNG" },
          { value: "jpeg", label: "JPEG" },
          { value: "gif", label: "GIF" },
        ] },
      ],
    },
    {
      id: "booklet",
      category: "pages",
      title: "Kitapçık",
      description: "Sayfaları katlanıp ciltlenecek kitapçık düzenine yerleştirin (2 sayfa / yaprak).",
      apiPath: "/api/v1/general/booklet-imposition",
      suffix: "kitapcik",
      files: [{ name: "fileInput", label: "PDF dosyası", accept: PDF }],
      fields: [
        { name: "spineLocation", label: "Sırt", type: "select", default: "LEFT", options: [
          { value: "LEFT", label: "Sol (soldan sağa)" },
          { value: "RIGHT", label: "Sağ (sağdan sola)" },
        ] },
        { name: "doubleSided", label: "Çift taraflı yazdırma", type: "checkbox", default: true },
        { name: "addGutter", label: "Cilt payı ekle", type: "checkbox", default: false },
        { name: "gutterSize", label: "Cilt payı (punto)", type: "number", default: 12, min: 0, max: 72,
          showIf: { addGutter: true } },
        { name: "addBorder", label: "Kesim çizgisi ekle", type: "checkbox", default: false },
      ],
      constants: { pagesPerSheet: "2", duplexPass: "BOTH", flipOnShortEdge: "false" },
    },
  ];
})();
